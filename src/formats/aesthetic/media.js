import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

export const PHOTO = /\.(jpe?g|png|webp)$/i;
export const CLIP = /\.(mp4|mov|m4v|webm)$/i;
export const refDir = (dir) => path.join(dir, "refs");

export function mediaSpecs(script) {
  const scenes = script.scenes ?? [];
  return (script.media ?? []).map((m) => ({
    ...m,
    scenes: scenes
      .map((sc, i) => (sc.reference === m.key || sc.clip === m.key || sc.motion === m.key || (sc.overlays ?? []).some((o) => o.kind === "photo" && o.item === m.key) ? i + 1 : 0))
      .filter(Boolean),
    links: links(m),
    optional: m.need === "nice",
  }));
}

function links(m) {
  const q = encodeURIComponent(m.search || m.what || m.key);
  if (m.source === "ai") return [];
  if (m.kind === "photo") return [{ label: "Pinterest (ideas)", url: `https://www.pinterest.com/search/pins/?q=${q}` }];
  return [
    { label: "Pexels", url: `https://www.pexels.com/search/videos/${q}/?orientation=portrait` },
    { label: "YouTube", url: `https://www.youtube.com/results?search_query=${q}` },
  ];
}

export function aiPrompt(m, script) {
  const outfit = (script.outfits ?? []).find((o) => o.key === m.ai_from);
  const feet = m.frame === "feet";
  return [
    "Animate the attached photo into a short live-action video. It is a real studio shot of a real man, not a printed picture: the photo itself never moves, bends, tilts or rotates, and nothing appears around its edges.",
    `Subject: the same man, face and clothes exactly as in the photo${outfit ? ` (${outfit.description})` : ""}. Every garment keeps its colour, length and fit.`,
    `Action: ${m.ai_prompt}`,
    `Camera: locked off on a tripod, no zoom, no pan, no shake. ${feet ? "Framed from the knees down, the shoes low in the frame, exactly as in the photo." : "His whole body stays in frame, exactly as in the photo."}`,
    "Setting: the same plain seamless studio background and soft even light as the photo, his soft shadow on the floor.",
    "Style: photorealistic, natural speed (no slow motion), smooth, one continuous shot, 5 seconds, vertical 9:16.",
    "Avoid: dancing routines, extra people, text, logos, music, speech, cuts, morphing faces or clothes.",
  ].join("\n");
}

export async function startFrame(dir, script, m) {
  const { readJson } = await import("../../util.js");
  const { config } = await import("../../config.js");
  const D = await import("./design.js");
  const picks = (await readJson(path.join(dir, "asset-picks.json"))) ?? {};
  const id = picks[`o:${m.ai_from}`] ?? picks[`o:${script.outfits?.[0]?.key}`];
  if (!id) throw new Error("The outfit photo isn't made yet: build the reel first");
  const { figureOnly } = await import("./index.js");
  const img = figureOnly(await loadImage(await fs.readFile(path.join(config.root, "assets", "library", `${id}.png`))));
  const c = createCanvas(D.W, D.H);
  const g = c.getContext("2d");
  g.fillStyle = script.style?.page ?? D.THEME.page;
  g.fillRect(0, 0, D.W, D.H);
  const floor = g.createLinearGradient(0, D.H * 0.75, 0, D.H);
  floor.addColorStop(0, "rgba(0,0,0,0)");
  floor.addColorStop(1, "rgba(0,0,0,0.07)");
  g.fillStyle = floor;
  g.fillRect(0, D.H * 0.75, D.W, D.H * 0.25);
  if (m.frame === "feet") D.standing(g, img, { cx: D.W / 2, feet: D.H * 0.88, height: D.H * 0.86 * 2.4 });
  else D.standing(g, img, { cx: D.W / 2, feet: D.H * 0.93, height: D.H * 0.86 });
  return c.toBuffer("image/png");
}

export async function slotFile(dir, key) {
  const files = await fs.readdir(refDir(dir)).catch(() => []);
  const f = files.find((x) => x.replace(/\.[^.]+$/, "") === key && (PHOTO.test(x) || CLIP.test(x)));
  return f ? path.join(refDir(dir), f) : null;
}

export async function loadMedia(dir, script, log = () => {}) {
  const out = {};
  const keys = {};
  const shown = new Set(mediaSpecs(script).filter((m) => m.scenes.length).map((m) => m.key));
  let clips = 0;
  for (const m of script.media ?? []) if (shown.has(m.key) && CLIP.test((await slotFile(dir, m.key)) ?? "")) clips++;
  const st = await fs.statfs(dir).catch(() => null);
  const free = st ? st.bavail * st.bsize : Infinity;
  if (clips && free < clips * 0.75e9 + 0.3e9) throw new Error(`Not enough free disk space to render this reel's ${clips} clip${clips > 1 ? "s" : ""}: about ${(clips * 0.75 + 0.3).toFixed(1)} GB needed, ${(free / 1e9).toFixed(1)} GB free. Free up some space on the Mac and build again.`);
  for (const m of script.media ?? []) {
    const file = await slotFile(dir, m.key);
    if (!file || !shown.has(m.key)) continue;
    const st = await fs.stat(file);
    keys[`media:${m.key}`] = `${path.basename(file)}:${st.size}:${Math.round(st.mtimeMs)}`;
    try {
      out[m.key] = PHOTO.test(file) ? await loadImage(await fs.readFile(file)) : await diskClip(file, path.join(dir, "render-cache", "clips"), { seconds: m.source === "ai" ? 8 : 6 });
      if (out[m.key]?.frame && m.source === "ai") {
        out[m.key].motion = await motionProfile(file, out[m.key].fps).catch(() => null);
        out[m.key].framing = m.frame === "feet" ? "feet" : "full";
      }
    } catch (err) {
      log(`Media "${m.key}": couldn't read ${path.basename(file)} (${err.message.slice(0, 120)})`);
    }
  }
  let plate = null;
  let full = null;
  for (const m of script.media ?? []) if (!full && m.source === "ai" && m.frame !== "feet" && CLIP.test((await slotFile(dir, m.key)) ?? "")) full = m;
  if (full && ["dots", "grid", "lines"].includes(script.style?.texture)) full = null;
  if (full) {
    const file = await slotFile(dir, full.key);
    const st = await fs.stat(file);
    const pf = path.join(refDir(dir), `.plate-${full.key}-${st.size}.png`);
    if (!(await fs.stat(pf).catch(() => null))) {
      for (const f of await fs.readdir(refDir(dir))) if (f.startsWith(".plate-")) await fs.rm(path.join(refDir(dir), f), { force: true });
      await fs.writeFile(pf, await makePlate(file));
      log(`Set: the studio from "${full.key.replace(/_/g, " ")}" is the background for the whole reel`);
    }
    plate = await loadImage(await fs.readFile(pf));
    keys.plate = path.basename(pf);
  }
  return { media: out, keys, plate };
}

async function blackBars(file) {
  const log = await new Promise((resolve) => {
    const ff = spawn("ffmpeg", ["-hide_banner", "-t", "3", "-i", file, "-vf", "cropdetect=limit=24:round=2:reset=0", "-f", "null", "-"]);
    let err = "";
    ff.stderr.on("data", (d) => (err += d));
    ff.on("close", () => resolve(err));
    ff.on("error", () => resolve(""));
  });
  const crops = [...log.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
  const size = /, (\d{2,5})x(\d{2,5})[, ]/.exec(log);
  if (!crops.length || !size) return "";
  const [, cw, ch] = crops.at(-1).map(Number);
  if (cw * ch > Number(size[1]) * Number(size[2]) * 0.96) return "";
  return crops.at(-1)[0];
}

export async function diskClip(file, cacheDir, { w = 720, h = 1280, fps = 24, seconds = 6 } = {}) {
  const st = await fs.stat(file);
  const id = createHash("sha1").update(`${file}:${st.size}:${st.mtimeMs}:${w}x${h}@${fps}:${seconds}`).digest("hex").slice(0, 12);
  await fs.mkdir(cacheDir, { recursive: true });
  const raw = path.join(cacheDir, `${id}.rgba`);
  if (!(await fs.stat(raw).catch(() => null))) {
    const bars = await blackBars(file);
    await new Promise((resolve, reject) => {
      const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-t", String(seconds), "-i", file, "-an", "-vf", `${bars ? `${bars},` : ""}scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${fps}`, "-f", "rawvideo", "-pix_fmt", "rgba", `${raw}.tmp`]);
      let err = "";
      ff.stderr.on("data", (d) => (err += d));
      ff.on("error", reject);
      ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-300)))));
    });
    await fs.rename(`${raw}.tmp`, raw);
  }
  const size = w * h * 4;
  const count = Math.floor((await fs.stat(raw)).size / size);
  if (!count) throw new Error("no frames");
  const canvas = createCanvas(w, h);
  const g = canvas.getContext("2d");
  const buf = Buffer.alloc(size);
  let last = -1;
  return {
    fps,
    count,
    width: w,
    height: h,
    frame(n) {
      const i = Math.max(0, Math.min(count - 1, n));
      if (i !== last) {
        const fd = openSync(raw, "r");
        readSync(fd, buf, 0, size, i * size);
        closeSync(fd);
        const im = g.createImageData(w, h);
        im.data.set(buf);
        g.putImageData(im, 0, 0);
        last = i;
      }
      return canvas;
    },
  };
}

export async function clipCheck(file) {
  const w = 72;
  const h = 128;
  const buf = await new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `fps=2,scale=${w}:${h}`, "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
    const out = [];
    ff.stdout.on("data", (d) => out.push(d));
    ff.on("error", reject);
    ff.on("close", () => resolve(Buffer.concat(out)));
  });
  const n = Math.floor(buf.length / (w * h));
  if (n < 3) return "";
  let edge = 0;
  let mid = 0;
  for (let f = 1; f < n; f++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.abs(buf[f * w * h + y * w + x] - buf[(f - 1) * w * h + y * w + x]);
      const border = x < 4 || x >= w - 4 || y < 4 || y >= h - 4;
      if (border) edge += d;
      else if (x > w * 0.25 && x < w * 0.75) mid += d;
    }
  }
  const edgeAvg = edge / ((n - 1) * (2 * 4 * h + 2 * 4 * w));
  const midAvg = mid / ((n - 1) * (w * 0.5) * (h - 8));
  if (edgeAvg > 6 && edgeAvg > midAvg * 1.2) return "The video moves the whole photo (its edges wobble) instead of the man. Make it again with the new start photo and prompt.";
  if (midAvg < 0.8) return "Nothing really moves in this clip. Make it again with the new prompt.";
  return "";
}

export const CLIP_MAP = { s: 0.665 / 0.86, fromFeet: 0.93, toFeet: 0.855 };

export async function makePlate(clipFile, { W = 1080, H = 1920 } = {}) {
  const raw = await new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", "0.05", "-i", clipFile, "-frames:v", "1", "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`, "-f", "rawvideo", "-pix_fmt", "rgba", "-"]);
    const out = [];
    ff.stdout.on("data", (d) => out.push(d));
    ff.on("error", reject);
    ff.on("close", () => resolve(Buffer.concat(out)));
  });
  const c = createCanvas(W, H);
  const g = c.getContext("2d");
  const im = g.createImageData(W, H);
  im.data.set(raw.subarray(0, W * H * 4));
  const d = im.data;
  const side = Math.round(W * 0.12);
  const med = (vals) => vals.sort((a, b) => a - b)[vals.length >> 1];
  for (let y = 0; y < H; y++) {
    const row = y * W * 4;
    const L = [0, 1, 2].map((ch) => med(Array.from({ length: side }, (_, x) => d[row + x * 4 + ch])));
    const R = [0, 1, 2].map((ch) => med(Array.from({ length: side }, (_, x) => d[row + (W - 1 - x) * 4 + ch])));
    for (let x = 0; x < W; x++) {
      const f = x / (W - 1);
      for (let ch = 0; ch < 3; ch++) d[row + x * 4 + ch] = L[ch] + (R[ch] - L[ch]) * f;
      d[row + x * 4 + 3] = 255;
    }
  }
  g.putImageData(im, 0, 0);
  const soft = createCanvas(W, H);
  const sg = soft.getContext("2d");
  sg.filter = "blur(3px)";
  sg.drawImage(c, 0, 0);
  const { s, fromFeet, toFeet } = CLIP_MAP;
  const out = createCanvas(W, H);
  const og = out.getContext("2d");
  const x0 = W / 2 - (W / 2) * s;
  const y0 = H * toFeet - H * fromFeet * s;
  const w = W * s;
  const h = H * s;
  const m = 14;
  og.drawImage(soft, m, m, W - 2 * m, H - 2 * m, x0, y0 + m * s, w, h - 2 * m * s);
  og.drawImage(soft, m, m, W - 2 * m, 2, x0, 0, w, Math.ceil(y0 + m * s) + 1);
  og.drawImage(soft, m, H - m - 2, W - 2 * m, 2, x0, Math.floor(y0 + h - m * s) - 1, w, H);
  og.drawImage(out, Math.ceil(x0) + 2, 0, 2, H, 0, 0, Math.ceil(x0) + 3, H);
  og.drawImage(out, Math.floor(x0 + w) - 4, 0, 2, H, Math.floor(x0 + w) - 3, 0, W, H);
  return out.toBuffer("image/png");
}

export async function motionProfile(file, fps = 24) {
  const w = 48;
  const h = 85;
  const buf = await new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `fps=${fps},scale=${w}:${h}`, "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
    const out = [];
    ff.stdout.on("data", (d) => out.push(d));
    ff.on("error", reject);
    ff.on("close", () => resolve(Buffer.concat(out)));
  });
  const n = Math.floor(buf.length / (w * h));
  const prof = [0];
  for (let f = 1; f < n; f++) {
    let sum = 0;
    for (let i = 0; i < w * h; i++) sum += Math.abs(buf[f * w * h + i] - buf[(f - 1) * w * h + i]);
    prof.push(sum / (w * h));
  }
  return prof;
}
