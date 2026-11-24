import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { config } from "../config.js";
import { pickMusic } from "../render.js";
import { download, ffmpeg, mediaDuration, stripEmoji } from "../util.js";
import { findOverride, kindOf } from "../visuals.js";
import { AUDIENCE, writeCaption } from "./shared.js";
import "./editorial/design.js";

export const id = "fit";
export const label = "AI fit (Comment LINK)";

export const brief = `You plan outfit reels for a faceless Indian men's fashion page in the "mirror fit check" format: a guy in a clean room takes a mirror selfie (phone covering his face) wearing one complete outfit. Small text on top, price tags for each item, and "Comment LINK" to get the product links by DM. The model is AI-generated and dressed with virtual try-on using the real product photos, so the outfit matches the links exactly.

${AUDIENCE}

What makes these reels work: one clean, wearable, affordable outfit that looks expensive; a specific vibe (clean, corporate, korean, old money, streetwear, date night, college, wedding guest); a hook line that's short and specific ("Corporate check", "Best sweatshirt under 350", "Date night fit under 2000"); honest price points.

Write:
- look_name: short name of the outfit.
- vibe.
- hook_text: the small text at the top of the video, 2-7 words, may include a price like "under ₹999". No emoji.
- products: every item in the outfit in head-to-toe order (top layer, top, bottom, shoes, accessories), each with a short on-screen name (2-3 words, e.g. "Waffle knit sweater"), colour, and price ("₹349", or a range like "₹700-900" if unsure). If the creator gave products, use exactly those. Leave link empty; the creator fills it.
- model_prompt: a detailed prompt for an AI image of the base model wearing this exact outfit: "mirror selfie of a young Indian man, phone held in front of his face covering it, standing in a minimal room with warm beige walls and a potted plant, full body head to toe, wearing [each item with colour and fit], natural daylight, realistic iPhone photo". Describe the items precisely (fit, fabric, colour).
- video_prompt: a 5-second image-to-video motion prompt for the same shot: small natural movements (adjusts the phone, shifts weight, turns slightly to show the fit, hand into pocket), static camera, realistic, no face reveal.
- caption: Hinglish, 2-4 short lines about the fit, then "Comment LINK and I'll DM you everything", then a few keyword phrases.
- hashtags (10-15), comment_keyword (usually LINK), music_vibe.`;

export const schema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "look_name", "vibe", "hook_text", "products", "model_prompt", "video_prompt", "caption", "hashtags", "comment_keyword", "music_vibe"],
  properties: {
    title: { type: "string" },
    look_name: { type: "string" },
    vibe: { type: "string" },
    hook_text: { type: "string" },
    products: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "color", "price", "link"],
        properties: {
          name: { type: "string" },
          color: { type: "string", optionalText: true },
          price: { type: "string", optionalText: true },
          link: { type: "string", optionalText: true },
        },
      },
    },
    model_prompt: { type: "string" },
    video_prompt: { type: "string" },
    caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    comment_keyword: { type: "string" },
    music_vibe: { type: "string", optionalText: true },
  },
};

export const task = ({ topic, notes }) =>
  [`Plan a fit-check reel: ${topic}`, notes && `Products / notes from the creator:\n${notes}`].filter(Boolean).join("\n\n");

const W = 1080;
const H = 1920;
const FPS = 30;

export async function build(dir, script, log) {
  const clip = await findOverride(dir, "01");
  let source = clip;
  let preview = false;
  if (!source) {
    preview = true;
    source = path.join(dir, "visuals", "preview.jpg");
    await fs.mkdir(path.dirname(source), { recursive: true });
    try {
      await fs.access(source);
    } catch {
      log("No try-on clip uploaded yet, generating a rough AI preview image");
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(script.model_prompt)}?width=1080&height=1920&nologo=true&model=flux&seed=${Date.now() % 1e6}`;
      await download(url, source, { timeoutMs: 180_000 });
    }
  }
  const isVideo = kindOf(source) === "video";
  const srcDur = isVideo ? await mediaDuration(source) : 0;
  const total = Math.min(Math.max(isVideo ? srcDur : 8, 8), 15);
  log(`Fit reel: ${total.toFixed(1)}s from ${preview ? "AI preview (upload your try-on clip!)" : path.basename(source)}`);

  const music = await pickMusic();
  const out = path.join(dir, "rough-cut.mp4");
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  if (isVideo) args.push("-stream_loop", "-1", "-i", source);
  else args.push("-loop", "1", "-framerate", String(FPS), "-i", source);
  args.push("-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-r", String(FPS), "-i", "-");
  if (music) args.push("-stream_loop", "-1", "-i", music);
  else args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");

  const frames = Math.ceil(total * FPS);
  const base = isVideo
    ? `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},setsar=1,eq=contrast=1.04:saturation=1.06[b]`
    : `[0:v]crop=iw:ih*0.94:0:0,scale=${W * 1.1}:${H * 1.1}:force_original_aspect_ratio=increase,crop=${W * 1.1}:${H * 1.1},` +
      `zoompan=z='1+0.06*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS},setsar=1[b]`;
  const audio = music
    ? `[2:a]volume=0.9,afade=t=in:d=0.3,afade=t=out:st=${(total - 1).toFixed(2)}:d=1[a]`
    : `[2:a]anull[a]`;
  args.push(
    "-filter_complex", `${base};[b][1:v]overlay=0:0:format=auto,format=yuv420p[v];${audio}`,
    "-map", "[v]", "-map", "[a]", "-t", total.toFixed(3),
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out,
  );

  const ff = spawn("ffmpeg", args, { stdio: ["pipe", "inherit", "pipe"] });
  let stderr = "";
  ff.stderr.on("data", (d) => (stderr += d));
  const done = new Promise((resolve, reject) => {
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg: ${stderr.slice(-800)}`))));
  });
  ff.stdin.on("error", () => {});

  const overlay = new FitOverlay(script, total, preview);
  for (let f = 0; f < frames; f++) {
    if (ff.stdin.destroyed) break;
    overlay.frame(f / FPS);
    if (!ff.stdin.write(overlay.pixels())) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await done;

  await ffmpeg(["-ss", "1", "-i", out, "-frames:v", "1", path.join(dir, "cover.png")]);
  if (!music) log("No music in assets/music: the video is silent. Add a trending sound when posting on Instagram.");
}

const easeOut = (x) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);
const easeBack = (x) => {
  const t = Math.max(0, Math.min(1, x)) - 1;
  return 1 + 2.6 * t * t * t + 1.6 * t * t;
};

class FitOverlay {
  constructor(script, total, preview) {
    this.s = script;
    this.total = total;
    this.preview = preview;
    this.canvas = createCanvas(W, H);
    this.ctx = this.canvas.getContext("2d");
    this.products = script.products.filter((p) => p.name).slice(0, 5);
    this.tagStart = 1.3;
    this.tagGap = Math.min(0.8, (total - 4.2) / Math.max(this.products.length, 1));
    this.ctaAt = Math.max(total - 2.6, this.tagStart + this.products.length * this.tagGap + 0.4);
  }

  frame(t) {
    const { ctx } = this;
    ctx.clearRect(0, 0, W, H);

    const g = ctx.createLinearGradient(0, 0, 0, 520);
    g.addColorStop(0, "rgba(0,0,0,0.38)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, 520);

    const hk = easeOut((t - 0.15) / 0.5);
    if (hk > 0) {
      ctx.save();
      ctx.globalAlpha = hk;
      ctx.textAlign = "center";
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 16;
      ctx.fillStyle = "#FFFFFF";
      let size = 78;
      const hook = stripEmoji(this.s.hook_text);
      ctx.font = `${size}px "Playfair Italic", "Symbols"`;
      while (ctx.measureText(hook).width > W * 0.86 && size > 44) ctx.font = `${(size -= 3)}px "Playfair Italic", "Symbols"`;
      ctx.fillText(hook, W / 2, 300 + 18 * (1 - hk));
      if (this.s.look_name) {
        ctx.font = `30px "Oswald SemiBold", "Symbols"`;
        ctx.letterSpacing = "6px";
        ctx.fillText(stripEmoji(this.s.look_name).toUpperCase(), W / 2, 372 + 18 * (1 - hk));
      }
      ctx.restore();
    }

    this.products.forEach((p, i) => {
      const k = easeOut((t - (this.tagStart + i * this.tagGap)) / 0.45);
      if (k <= 0) return;
      const label = stripEmoji(p.name);
      const price = stripEmoji(p.price ?? "");
      const y = 1060 + i * 104;
      ctx.save();
      ctx.globalAlpha = k;
      ctx.translate(-60 * (1 - k), 0);
      ctx.font = `38px "Inter Bold", "Symbols"`;
      const lw = ctx.measureText(label).width;
      ctx.font = `38px "Inter", "Symbols"`;
      const pw = price ? ctx.measureText(price).width + 36 : 0;
      const w = lw + pw + 64;
      ctx.fillStyle = "rgba(15,15,15,0.55)";
      ctx.beginPath();
      ctx.roundRect(56, y - 50, w, 76, 38);
      ctx.fill();
      ctx.fillStyle = "#FFFFFF";
      ctx.font = `38px "Inter Bold", "Symbols"`;
      ctx.fillText(label, 88, y);
      if (price) {
        ctx.fillStyle = "#FFD66B";
        ctx.font = `38px "Inter", "Symbols"`;
        ctx.fillText(price, 88 + lw + 36, y);
      }
      ctx.restore();
    });

    const ck = easeBack((t - this.ctaAt) / 0.5);
    if (t >= this.ctaAt) {
      const kw = (this.s.comment_keyword || "LINK").toUpperCase();
      const text = `Comment "${kw}" for links`;
      ctx.save();
      ctx.translate(W / 2, 1640);
      ctx.rotate((-3 * Math.PI) / 180);
      ctx.scale(Math.max(0.01, ck), Math.max(0.01, ck));
      ctx.font = `50px "Inter Bold", "Symbols"`;
      const tw = ctx.measureText(text).width;
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 30;
      ctx.shadowOffsetY = 10;
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.roundRect(-tw / 2 - 44, -58, tw + 88, 104, 52);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.fillStyle = "#111111";
      ctx.textAlign = "center";
      ctx.fillText(text, 0, 12);
      ctx.restore();
    }

    if (this.preview) {
      ctx.save();
      ctx.font = `28px "Oswald SemiBold", "Symbols"`;
      ctx.letterSpacing = "3px";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255,80,80,0.95)";
      ctx.fillText("PREVIEW: UPLOAD YOUR TRY-ON CLIP", W / 2, 120);
      ctx.restore();
    }
  }

  pixels() {
    return Buffer.from(this.ctx.getImageData(0, 0, W, H).data.buffer);
  }
}

export async function writeDocs(dir, script) {
  await writeCaption(dir, script);
  const kw = (script.comment_keyword || "LINK").toUpperCase();
  const links = [
    `Keyword: ${kw}`,
    "",
    `Here's everything from this fit 👇`,
    ...script.products.map((p) => `• ${p.name}${p.color ? ` (${p.color})` : ""}${p.price ? `, ${p.price}` : ""}: ${p.link || "[add link]"}`),
    "",
  ].join("\n");
  await fs.writeFile(path.join(dir, "dm-links.txt"), links);

  const guide = [
    `# Try-on guide: ${script.look_name}`,
    "",
    "## 1. Base model with this outfit",
    "Use a virtual try-on tool (for example Kling AI's Virtual Try-On, free daily credits) with your saved base model image",
    "and the product photos from each store listing. That keeps the outfit identical to what you link.",
    "",
    "If you don't have a base model yet, generate one in any free image tool with this prompt and keep reusing it:",
    "",
    "```",
    script.model_prompt,
    "```",
    "",
    "## 2. Turn the photo into a 5-second clip",
    "Image-to-video in Kling, Hailuo, Vidu or Veo (free credits), 9:16, with this prompt:",
    "",
    "```",
    script.video_prompt,
    "```",
    "",
    "## 3. Build",
    "Upload the clip in the app (\"Your try-on clip\"), fill in the product links, and click Build.",
    "",
    "## 4. Post",
    "- Turn on Instagram's **AI info** label (Advanced settings). Realistic AI people must be labelled.",
    "- Add a trending sound in Instagram.",
    `- Set up ManyChat: keyword **${kw}** → send the message in \`dm-links.txt\`.`,
    "",
  ].join("\n");
  await fs.writeFile(path.join(dir, "tryon-guide.md"), guide);
  await fs.writeFile(
    path.join(dir, "script.md"),
    `# ${script.title}\n\n**Hook:** ${script.hook_text}  \n**Vibe:** ${script.vibe}\n\n${script.products.map((p) => `- ${p.name} · ${p.color} · ${p.price}`).join("\n")}\n`,
  );
}
