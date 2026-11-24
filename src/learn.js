import fs from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { askJson } from "./claude.js";
import { config } from "./config.js";
import { PLUGINS } from "./motions/index.js";
import { FONT_FAMILIES, TYPESET_NAMES } from "./formats/editorial/design.js";
import { MOTIONS } from "./formats/editorial/motion.js";
import { ffmpeg, hash, mediaDuration, readJson, run, writeJson } from "./util.js";

export const stylesDir = path.join(config.root, "assets", "styles");

export const SFX_EVENTS = ["hook", "cut", "hero_word", "text_word", "sticker", "image_in", "color_change", "list_item", "punchline", "cta_keyword"];
export const SFX_SOUNDS = ["whoosh", "swoosh", "pop", "tick", "boom", "none"];
const LAYOUTS = ["sandwich", "side", "hero", "float", "edge", "cards", "closeup", "slider", "verdict", "zoom", "scale", "flow", "mosaic", "duo", "corner", ...Object.keys(PLUGINS)];

export async function listStyles() {
  const ids = await fs.readdir(stylesDir).catch(() => []);
  const out = [];
  for (const id of ids) {
    const s = await readJson(path.join(stylesDir, id, "style.json"));
    if (s) out.push(s);
  }
  return out.sort((a, b) => b.created - a.created);
}

export const getStyle = (id) => readJson(path.join(stylesDir, path.basename(String(id)), "style.json"));

export async function updateStyle(id, patch) {
  const file = path.join(stylesDir, path.basename(id), "style.json");
  const s = await readJson(file);
  if (!s) throw new Error("Style not found");
  Object.assign(s, patch);
  await writeJson(file, s);
  return s;
}

export async function deleteStyle(id) {
  await fs.rm(path.join(stylesDir, path.basename(id)), { recursive: true, force: true });
}

async function probe(file) {
  const out = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate", "-of", "json", file]);
  const st = JSON.parse(out).streams?.[0] ?? {};
  const [n, d] = String(st.r_frame_rate ?? "30/1").split("/").map(Number);
  const hasAudio = (await run("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file])).trim().length > 0;
  return { width: st.width, height: st.height, fps: d ? n / d : 30, duration: await mediaDuration(file), hasAudio };
}

async function sceneCuts(file, threshold = 0.28) {
  const { stderr } = await runErr("ffmpeg", ["-hide_banner", "-i", file, "-an", "-vf", `scale=240:-2,select='gt(scene,${threshold})',showinfo`, "-f", "null", "-"]);
  const times = [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
  return times.filter((t, i) => i === 0 || t - times[i - 1] > 0.4);
}

function runErr(cmd, args) {
  return new Promise((resolve) => {
    import("node:child_process").then(({ spawn }) => {
      const child = spawn(cmd, args);
      let stderr = "";
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", () => resolve({ stderr }));
      child.on("error", () => resolve({ stderr }));
    });
  });
}

async function sampleFrames(file, dir, duration, cuts) {
  const times = [];
  for (let t = 0.3; t < duration; t += 1) times.push(t);
  for (const c of cuts) times.push(c + 0.2);
  times.sort((a, b) => a - b);
  const picked = [];
  for (const t of times) if (t < duration - 0.05 && (!picked.length || t - picked.at(-1) > 0.45)) picked.push(t);
  const step = Math.max(1, Math.ceil(picked.length / 36));
  const chosen = picked.filter((_, i) => i % step === 0).slice(0, 36);
  const frames = [];
  for (const [i, t] of chosen.entries()) {
    const out = path.join(dir, `f${String(i).padStart(2, "0")}.png`);
    await ffmpeg(["-ss", t.toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale=300:-2", out]);
    frames.push({ t, file: out });
  }
  return frames;
}

async function contactSheets(frames, dir) {
  const sheets = [];
  const cols = 4;
  const rows = 3;
  for (let s = 0; s * cols * rows < frames.length; s++) {
    const chunk = frames.slice(s * cols * rows, (s + 1) * cols * rows);
    const first = await loadImage(await fs.readFile(chunk[0].file));
    const w = first.width;
    const h = first.height;
    const c = createCanvas(cols * w, Math.ceil(chunk.length / cols) * h);
    const g = c.getContext("2d");
    g.fillStyle = "#000";
    g.fillRect(0, 0, c.width, c.height);
    for (const [i, f] of chunk.entries()) {
      const img = await loadImage(await fs.readFile(f.file));
      const x = (i % cols) * w;
      const y = Math.floor(i / cols) * h;
      g.drawImage(img, x, y, w, h);
      g.fillStyle = "rgba(0,0,0,0.75)";
      g.fillRect(x, y, 78, 30);
      g.fillStyle = "#fff";
      g.font = "bold 20px Inter";
      g.fillText(`${f.t.toFixed(1)}s`, x + 8, y + 22);
    }
    const out = path.join(dir, `sheet-${s + 1}.png`);
    await fs.writeFile(out, c.toBuffer("image/png"));
    sheets.push(out);
  }
  return sheets;
}

async function measureColours(frames) {
  const hist = new Map();
  const perFrame = [];
  for (const f of frames) {
    const img = await loadImage(await fs.readFile(f.file));
    const c = createCanvas(60, Math.round((60 * img.height) / img.width));
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const border = new Map();
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
        hist.set(key, (hist.get(key) ?? 0) + 1);
        if (x < 3 || x >= c.width - 3 || y < 3 || y >= c.height - 3) border.set(key, (border.get(key) ?? 0) + 1);
      }
    }
    const bg = [...border.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    perFrame.push({ t: +f.t.toFixed(1), bg: toHex(bg) });
  }
  const total = [...hist.values()].reduce((a, b) => a + b, 0);
  const top = [...hist.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
    .map(([k, n]) => ({ hex: toHex(k), share: +((n / total) * 100).toFixed(1) }));
  return { top, perFrame };
}

const toHex = (k) =>
  k == null ? null : `#${[(k >> 8) & 15, (k >> 4) & 15, k & 15].map((v) => (v * 17).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

const RATE = 22050;

export async function readPcm(file, dir) {
  const raw = path.join(dir, "audio.f32");
  await ffmpeg(["-i", file, "-vn", "-ac", "1", "-ar", String(RATE), "-f", "f32le", raw]);
  const buf = await fs.readFile(raw);
  await fs.rm(raw);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
}

export function soundHits(pcm, { near = null, window = 0.12 } = {}) {
  const hop = Math.round(RATE * 0.01);
  const win = hop * 2;
  const db = [];
  for (let i = 0; i + win < pcm.length; i += hop) {
    let e = 0;
    for (let j = 0; j < win; j++) e += pcm[i + j] ** 2;
    db.push(10 * Math.log10(e / win + 1e-10));
  }
  const hits = [];
  let last = -1;
  for (let k = 15; k < db.length; k++) {
    let before = 0;
    for (let j = k - 15; j < k - 2; j++) before += db[j];
    before /= 13;
    const rise = db[k] - before;
    if (rise > 9 && db[k] > -38 && k - last > 12) {
      let end = k;
      while (end < db.length - 1 && end - k < 120 && db[end] > db[k] - 14) end++;
      const bands = bandShare(pcm, k * hop);
      hits.push({ t: +(k * 0.01).toFixed(2), rise: +rise.toFixed(1), dur: +((end - k) * 0.01).toFixed(2), ...bands, guess: guessSound(bands, (end - k) * 0.01) });
      last = k;
    }
  }
  const mean = db.reduce((a, b) => a + b, 0) / Math.max(db.length, 1);
  const gated = near ? hits.filter((h) => near.some((c) => Math.abs(c - h.t) < window)) : hits;
  return { hits: gated.sort((a, b) => b.rise - a.rise).slice(0, 60).sort((a, b) => a.t - b.t), meanDb: +mean.toFixed(1), allHits: hits.length };
}

function bandShare(pcm, at) {
  const N = 2048;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (pcm[at + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  fft(re, im);
  let low = 0;
  let mid = 0;
  let high = 0;
  for (let i = 1; i < N / 2; i++) {
    const f = (i * RATE) / N;
    const p = re[i] ** 2 + im[i] ** 2;
    if (f < 250) low += p;
    else if (f < 3000) mid += p;
    else high += p;
  }
  const s = low + mid + high || 1;
  return { low: +(low / s).toFixed(2), mid: +(mid / s).toFixed(2), high: +(high / s).toFixed(2) };
}

function guessSound({ low, high }, dur) {
  if (low > 0.55 && dur > 0.25) return "boom / bass hit";
  if (high > 0.4 && dur >= 0.18) return "whoosh / swoosh";
  if (dur < 0.12) return high > 0.3 ? "click / tick" : "pop";
  return low > 0.4 ? "thump / beat" : "pop / ding / accent";
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < len / 2; j++) {
        const wr = Math.cos(ang * j);
        const wi = Math.sin(ang * j);
        const ur = re[i + j];
        const ui = im[i + j];
        const vr = re[i + j + len / 2] * wr - im[i + j + len / 2] * wi;
        const vi = re[i + j + len / 2] * wi + im[i + j + len / 2] * wr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr;
        im[i + j + len / 2] = ui - vi;
      }
    }
  }
}

export async function transcribe(file, dir, duration, log) {
  if (!config.sarvam.key) return [];
  const parts = [];
  for (let t = 0; t < duration; t += 20) {
    const clip = path.join(dir, `speech-${Math.round(t)}.wav`);
    await ffmpeg(["-ss", String(t), "-t", "20", "-i", file, "-vn", "-ac", "1", "-ar", "16000", clip]);
    try {
      const fd = new FormData();
      fd.append("file", new Blob([await fs.readFile(clip)], { type: "audio/wav" }), "clip.wav");
      fd.append("model", "saarika:v2.5");
      fd.append("language_code", "unknown");
      const res = await fetch("https://api.sarvam.ai/speech-to-text", { method: "POST", headers: { "api-subscription-key": config.sarvam.key }, body: fd });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.transcript) parts.push({ from: t, to: Math.min(t + 20, duration), text: data.transcript });
      else log(`  speech-to-text skipped a piece (${res.status})`);
    } finally {
      await fs.rm(clip, { force: true });
    }
  }
  return parts;
}

const ANALYST = `You are a senior short-form video designer and sound designer. You study a reel frame by frame (timestamped contact sheets) together with measurements taken from the file (scene cuts, on-screen colours, sound hits, the transcript) and write a precise, reusable style card, so a reel engine can adapt the style for a men's fashion channel in India. Describe what is actually there; be specific (sizes relative to the frame, positions, timings, colours as hex). Learn the style, never the content: no copying of their words, topics or images.

The engine it's for already has (use these names; only list something as missing if it's genuinely not below):
- Word lockups: small words + one hero word in script, serif, condensed or comic-sticker style (yellow, tilted, hard shadow), accent-coloured words, red label pills [LABEL], handwritten notes with hand-drawn curly arrows pointing at the right body part.
- Text motions: rise (soft blur-in), mask (slide up from behind a line), typewriter, slam (huge skewed hit with shake), stack (tilted 3D column of lines building up, lyric-video style).
- Layouts: sandwich (person standing inside the words, hero word tucked BEHIND him = depth layering), side (big cutout bleeding off one side), hero (outfit shot under a headline), float, edge (prop peeking/sliding in from the frame edge), cards (tilted polaroid/scrapbook photo cards with handwritten labels), closeup (chest-up with a giant word, optional black-and-white), flow (one item branching into 2-3 looks with animated connector lines = branch/tree diagram), slider (before/after divider reveal), verdict (red cross / green tick stamps), zoom (magnifier on a detail), scale (items on a line with a sliding marker), board (colour swatch stacks, paint strokes, shade grids). Also mosaic (frame packed with product cutouts that slide aside for the one hero piece), duo (tiny full-body figure on a giant close-up), corner (product tucked in the bottom-right of a type beat), dm (comment box typing the keyword, then a DM notification), and the motion library: ${Object.values(PLUGINS).map((p) => `${p.id} (${p.name}: ${p.when})`).join(", ")}.
- Backgrounds: solid colours per section with soft colour wipes between sections, textures (crumpled paper, grid paper, dot grid), film grain, a different palette every reel.
- Cutouts: models, products, props (props/products as die-cut white-border stickers that pop in), held shots that drift and punch in on each new line.
- A mid-reel engagement sticker (e.g. "Save karo") that sweeps across and parks in a corner; the comment keyword shown as a sticker word with its own pop.
- Sound: whoosh, swoosh, pop, tick, boom placed on moments (colour changes, images entering, stickers, labels, list items, slams, the comment keyword), subtle or punchy density; music ducked under the voice.
- Look options: letterbox (4:5 window between black bars), black-and-white cutouts with one colour exception, two-ink poster type (typeset "poster"), ghost words (pale until spoken), chromatic RGB fringe on fast moves, beat sync to the music.
- Camera and transitions: snap word pops (lyric style), punch (instant extreme crop with blur), rotate-push, letter fly-through (dive into a letter of the hero word, next shot through its hole), giant hero word pinned to the top behind the model, plinth with smoke, duo (tiny figure on a giant close-up of the same person).
- Fonts it can draw: ${FONT_FAMILIES.join(", ")}.
Curate, don't catalogue. Keep ONLY what is genuinely useful for this channel (a faceless Indian men's style channel: cutout models and garments, Hinglish voiceover, premium and clean, one styling rule per reel) and would look good in it:
- Skip anything tied to the source's own content or genre (rap lyrics, memes, film posters, the creator's face), anything cheesy or odd for a style channel, heavy 3D/VFX, and anything that needs footage or assets we don't have.
- visual_devices, transitions and sfx_rules: only the parts worth borrowing, each one something the engine has or can clearly do. It's fine to list just two or three.
- worth_building: at most 3 new features, and only ones you're confident a 2D canvas engine can build well AND that would clearly lift this channel's reels. If nothing qualifies, leave it empty. Never list overkill.`;

const STYLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "summary", "typography", "colors", "visual_devices", "transitions", "pacing", "sound", "script", "engine_settings", "worth_building"],
  properties: {
    name: { type: "string", description: "Short memorable name for this style, 2-4 words" },
    summary: { type: "string", description: "2-3 sentences: what makes this reel look and feel distinctive" },
    typography: {
      type: "object",
      additionalProperties: false,
      required: ["fonts", "layout", "effects", "animation"],
      properties: {
        fonts: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["role", "look", "closest_ours", "google_font"],
            properties: {
              role: { type: "string", description: "hero word / small words / label / caption / sticker" },
              look: { type: "string" },
              closest_ours: { type: "string", enum: FONT_FAMILIES },
              google_font: { type: "string", description: "Closest free Google Font, if ours isn't close" },
            },
          },
        },
        layout: { type: "string", description: "Where text sits, size, alignment, case, how many words at once" },
        effects: { type: "string", description: "Stroke, shadow, highlight boxes, per-word colour, outlines" },
        animation: { type: "string", description: "How words arrive and leave, with timings" },
      },
    },
    colors: {
      type: "object",
      additionalProperties: false,
      required: ["palettes", "usage"],
      properties: {
        palettes: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "bg", "accent", "text"],
            properties: {
              name: { type: "string", description: "Name plus any notes (texture, gradient, secondary colours)" },
              bg: { type: "string", description: "Only a #RRGGBB hex" },
              accent: { type: "string", description: "Only a #RRGGBB hex" },
              text: { type: "string", description: "Only a #RRGGBB hex" },
            },
          },
        },
        usage: { type: "string" },
      },
    },
    visual_devices: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "how", "when", "engine"],
        properties: {
          name: { type: "string" },
          how: { type: "string", description: "What it looks like and how it moves" },
          when: { type: "string", description: "What moment in the script it's used for" },
          engine: { type: "string", enum: ["have", "partial", "missing"] },
        },
      },
    },
    transitions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "how", "timing"],
        properties: { name: { type: "string" }, how: { type: "string" }, timing: { type: "string" } },
      },
    },
    pacing: {
      type: "object",
      additionalProperties: false,
      required: ["avg_shot_seconds", "words_per_second", "notes"],
      properties: { avg_shot_seconds: { type: "number" }, words_per_second: { type: "number" }, notes: { type: "string" } },
    },
    sound: {
      type: "object",
      additionalProperties: false,
      required: ["music", "voice", "sfx_rules", "density", "notes"],
      properties: {
        music: { type: "string", description: "Genre, energy, level under the voice, when it changes" },
        voice: { type: "string" },
        sfx_rules: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["event", "sound", "how"],
            properties: {
              event: { type: "string", enum: SFX_EVENTS },
              sound: { type: "string", enum: SFX_SOUNDS },
              how: { type: "string", description: "How often / how loud / exact feel" },
            },
          },
        },
        density: { type: "string", enum: ["subtle", "punchy"] },
        notes: { type: "string" },
      },
    },
    script: {
      type: "object",
      additionalProperties: false,
      required: ["hook", "structure", "cta", "tone"],
      properties: { hook: { type: "string" }, structure: { type: "string" }, cta: { type: "string" }, tone: { type: "string" } },
    },
    engine_settings: {
      type: "object",
      additionalProperties: false,
      required: ["typeset", "motions", "layouts", "sticker", "textures", "look", "camera"],
      properties: {
        look: {
          type: "object",
          additionalProperties: false,
          required: ["frame", "cutouts", "ghost", "chroma", "beat_sync"],
          properties: {
            frame: { type: "string", enum: ["full", "letterbox"] },
            cutouts: { type: "string", enum: ["color", "mono"] },
            ghost: { type: "string", enum: ["no", "yes"] },
            chroma: { type: "string", enum: ["no", "yes"] },
            beat_sync: { type: "string", enum: ["no", "yes"] },
          },
        },
        camera: { type: "string", description: "Which camera moves it uses and how often: punch (extreme crop), rotate (tilt-push), letter fly-through, giant hero words, plinth, duo (tiny + giant same person)" },
        typeset: { type: "string", enum: TYPESET_NAMES },
        motions: { type: "array", items: { type: "string", enum: MOTIONS } },
        layouts: { type: "array", items: { type: "string", enum: LAYOUTS } },
        sticker: { type: "string", description: "How engagement/comment stickers should look and behave" },
        textures: { type: "string" },
      },
    },
    worth_building: {
      type: "array",
      description: "0-3 features worth building for this channel; empty if none qualify",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description", "why_it_fits"],
        properties: {
          title: { type: "string" },
          description: { type: "string", description: "Concrete enough to build: what it looks like, timings" },
          why_it_fits: { type: "string", description: "Where it would lift a men's style reel" },
        },
      },
    },
  },
};

export async function learnFromReel({ file, link = "", notes = "", log = () => {} }) {
  const stat = await fs.stat(file);
  const id = `style-${hash({ size: stat.size, name: path.basename(file), at: Date.now() }).slice(0, 10)}`;
  const dir = path.join(stylesDir, id);
  const work = path.join(dir, "frames");
  await fs.mkdir(work, { recursive: true });
  try {
    log("Reading the video");
    const info = await probe(file);
    const cuts = await sceneCuts(file);
    const changes = await sceneCuts(file, 0.06);
    log(`  ${info.duration.toFixed(1)}s, ${cuts.length} hard cuts, ${changes.length} visual changes`);
    log("Sampling frames and measuring colours");
    const frames = await sampleFrames(file, work, info.duration, [...new Set([...cuts, ...changes])]);
    const colours = await measureColours(frames);
    const sheets = await contactSheets(frames, dir);
    let sound = { hits: [], meanDb: null };
    let speech = [];
    if (info.hasAudio) {
      log("Listening: sound hits and speech");
      const moments = await sceneCuts(file, 0.02);
      sound = soundHits(await readPcm(file, dir), { near: moments, window: 0.1 });
      speech = await transcribe(file, dir, info.duration, log);
      log(`  ${sound.hits.length} sound hits, ${speech.length ? "transcript ready" : "no transcript"}`);
    } else log("  (no audio in this file)");
    await fs.rm(work, { recursive: true, force: true });

    const words = speech.map((p) => p.text).join(" ").split(/\s+/).filter(Boolean).length;
    const measurements = {
      duration: +info.duration.toFixed(1),
      size: `${info.width}x${info.height}`,
      hard_cuts_s: cuts.map((c) => +c.toFixed(2)),
      visual_changes_s: changes.map((c) => +c.toFixed(2)),
      avg_shot_s: +(info.duration / (Math.max(cuts.length, changes.length) + 1)).toFixed(2),
      words_per_second: info.duration ? +(words / info.duration).toFixed(2) : 0,
      colours_on_screen: colours.top,
      background_per_frame: colours.perFrame,
      sound_effect_hits: sound.hits,
      sudden_sounds_total: sound.allHits,
      mean_loudness_db: sound.meanDb,
      transcript: speech,
    };
    await writeJson(path.join(dir, "measurements.json"), measurements);

    log("Studying the style (Claude)");
    const task = [
      `Study this reel and write its style card.${link ? ` Source: ${link}` : ""}${notes ? `\nWhat the creator wants to learn from it: ${notes}` : ""}`,
      `The contact sheets show frames in time order; each has its time in the top-left corner.`,
      `Measurements from the file. sound_effect_hits are sudden sounds that land exactly on a change on screen (about 75% are real sound effects; quiet ones under music are missed), each with its low/mid/high frequency share, length and a rough guess of the sound type. Line them up with the frames at the same time to work out which on-screen moments get which sound:\n${JSON.stringify(measurements)}`,
    ].join("\n\n");
    const card = await askJson({ system: ANALYST, task, schema: STYLE_SCHEMA, effort: "high", images: sheets });
    card.worth_building = (card.worth_building ?? []).slice(0, 3);
    const hex = (v) => String(v ?? "").match(/#[0-9a-f]{6}/i)?.[0]?.toUpperCase() ?? "#888888";
    card.colors.palettes = card.colors.palettes.map((p) => ({ ...p, bg: hex(p.bg), accent: hex(p.accent), text: hex(p.text) }));
    const style = {
      id,
      name: card.name,
      created: Date.now(),
      active: true,
      uses: 0,
      source: { link, notes, duration: measurements.duration, file: path.basename(file) },
      sheets: sheets.map((s) => path.basename(s)),
      card,
    };
    await writeJson(path.join(dir, "style.json"), style);
    log(`Learned "${card.name}"`);
    try {
      const { learnPrinciples } = await import("./formats/aesthetic/learn-principles.js");
      await learnPrinciples(style, { sheets, transcript: speech.map((p) => p.text).join(" "), log });
    } catch (err) {
      log(`  (Aesthetic principles skipped: ${err.message.slice(0, 120)})`);
    }
    return style;
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true });
    throw err;
  }
}

export function styleBrief(style) {
  const c = style.card;
  return [
    `Learned style "${style.name}": ${c.summary}`,
    `Adapt it to this reel (don't copy the source's content):`,
    c.engine_settings.look ? `- Look (set these in "look"): ${JSON.stringify(c.engine_settings.look)}. Camera: ${c.engine_settings.camera ?? ""}` : "",
    `- Type set: ${c.engine_settings.typeset}. Typography: ${c.typography.layout}. Effects: ${c.typography.effects}. Text animation: ${c.typography.animation}.`,
    `- Colours (adapt into this reel's palette, keep the feel): ${c.colors.palettes.map((p) => `${p.name} bg ${p.bg} / accent ${p.accent}`).join("; ")}. ${c.colors.usage}`,
    `- Motions to favour: ${c.engine_settings.motions.join(", ")}. Layouts to favour: ${c.engine_settings.layouts.join(", ")}. Backgrounds: ${c.engine_settings.textures}.`,
    `- Devices: ${c.visual_devices.filter((d) => d.engine !== "missing").map((d) => `${d.name} (${d.when})`).join("; ")}.`,
    `- Stickers: ${c.engine_settings.sticker}.`,
    `- Pacing: about ${c.pacing.avg_shot_seconds}s per shot. ${c.pacing.notes}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function pickStyle(choice) {
  if (choice === "none") return null;
  if (String(choice ?? "").startsWith("full:")) {
    const style = await getStyle(choice.slice(5));
    return style ? { mode: "full", styles: [style] } : null;
  }
  const active = (await listStyles()).filter((s) => s.active);
  const styles = choice && choice !== "auto" ? active.filter((s) => s.id === choice) : active;
  return styles.length ? { mode: "borrow", styles } : null;
}

export const prefsFile = path.join(config.root, "assets", "preferences.json");
export const loadPrefs = () => readJson(prefsFile, { ingredients: {}, notes: [] });
export async function prefsBrief() {
  const p = await loadPrefs();
  const liked = Object.entries(p.ingredients ?? {}).filter(([, v]) => v === "like").map(([k]) => k.replace(/_/g, " "));
  const disliked = Object.entries(p.ingredients ?? {}).filter(([, v]) => v === "dislike").map(([k]) => k.replace(/_/g, " "));
  if (!liked.length && !disliked.length && !p.notes?.length) return "";
  return [
    "The creator's taste (from reels they reviewed):",
    liked.length && `- Likes: ${liked.join(", ")}. Use these where they fit.`,
    disliked.length && `- Never use: ${disliked.join(", ")}.`,
    ...(p.notes ?? []).map((n) => `- ${n}`),
  ]
    .filter(Boolean)
    .join("\n");
}

export function ingredientsBrief(styles) {
  const lines = styles.flatMap((s) => {
    const c = s.card;
    return [
      `From "${s.name}":`,
      ...c.visual_devices.filter((d) => d.engine !== "missing").map((d) => `- ${d.name}: ${d.how} (used for: ${d.when})`),
      c.engine_settings?.camera ? `- Camera moves: ${c.engine_settings.camera}` : "",
    ];
  });
  return [
    `Learned ingredients you may borrow (these are NOT this reel's style: keep this reel's own look, palette and type set, don't copy anything wholesale). Borrow the technique, not the source's colours or mood: adapt every ingredient to this reel's own palette, type set and feel (two-ink type can be any two colours from this palette; black-and-white is just one option, never required). Pick 1-3 that genuinely suit specific moments of this script and use each on one or two beats only, through the beat fields (camera punch/rotate, transition letter, hero_size giant, visual plinth, layout duo/slider/verdict/zoom/scale/flow, motion snap/slam). Leave "look" at its defaults.`,
    ...lines.filter(Boolean),
  ].join("\n");
}
