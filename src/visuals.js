import fs from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { config } from "./config.js";
import { download, hash, pad, readJson, writeJson } from "./util.js";

const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export const kindOf = (file) => {
  const ext = path.extname(file).toLowerCase();
  if (VIDEO_EXT.has(ext)) return "video";
  if (IMAGE_EXT.has(ext)) return "image";
  return null;
};

export async function findOverride(packDir, n) {
  const dir = path.join(packDir, "overrides");
  const files = await fs.readdir(dir).catch(() => []);
  const match = files.find((f) => f.startsWith(`scene-${n}.`) && kindOf(f));
  return match ? path.join(dir, match) : null;
}

export async function gatherVisuals(packDir, script, log) {
  const dir = path.join(packDir, "visuals");
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(packDir, "overrides"), { recursive: true });
  const usedStockIds = new Set();
  const results = [];

  for (const [i, scene] of script.scenes.entries()) {
    const n = pad(i + 1);
    const override = await findOverride(packDir, n);
    if (override) {
      log(`Visual: scene ${n} uses your file ${path.basename(override)}`);
      results.push({ file: override, kind: kindOf(override), source: "your upload" });
      continue;
    }

    const metaFile = path.join(dir, `scene-${n}.json`);
    const key = hash({ t: scene.visual_type, q: scene.stock_query, p: scene.ai_prompt, pexels: !!config.pexelsKey });
    let meta = await readJson(metaFile);
    if (!meta || meta.key !== key) {
      log(`Visual: scene ${n} (${scene.visual_type})`);
      meta = { key, ...(await fetchVisual(dir, n, scene, usedStockIds, log)) };
      await writeJson(metaFile, meta);
    }
    if (meta.stockId) usedStockIds.add(meta.stockId);
    results.push(meta);
  }
  return results;
}

async function fetchVisual(dir, n, scene, usedStockIds, log) {
  const attempts = [];
  if (scene.visual_type === "stock_video") attempts.push(() => pexelsVideo(dir, n, scene.stock_query, usedStockIds));
  attempts.push(() => aiImage(dir, n, scene.ai_prompt));
  attempts.push(() => pexelsPhoto(dir, n, scene.stock_query, usedStockIds));
  if (scene.visual_type !== "stock_video") attempts.push(() => pexelsVideo(dir, n, scene.stock_query, usedStockIds));

  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (result) return result;
    } catch (err) {
      log(`  ${err.message}`);
    }
  }
  log(`  No visual found for scene ${n}, using a placeholder card. Upload your own clip for it.`);
  return placeholder(dir, n, scene.on_screen_text);
}

async function pexelsVideo(dir, n, query, used) {
  if (!config.pexelsKey) return null;
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=10`;
  const res = await fetch(url, { headers: { Authorization: config.pexelsKey } });
  if (!res.ok) throw new Error(`Pexels video search ${res.status}`);
  const { videos = [] } = await res.json();
  const video = videos.find((v) => !used.has(`v${v.id}`) && v.duration >= 3) ?? videos[0];
  if (!video) return null;
  const files = video.video_files
    .filter((f) => f.file_type === "video/mp4" && f.height > f.width)
    .sort((a, b) => a.width - b.width);
  const file = files.find((f) => f.width >= 1080) ?? files.at(-1) ?? video.video_files[0];
  const dest = path.join(dir, `scene-${n}.mp4`);
  await download(file.link, dest);
  return { file: dest, kind: "video", source: `Pexels video by ${video.user?.name ?? "unknown"}`, stockId: `v${video.id}` };
}

async function pexelsPhoto(dir, n, query, used) {
  if (!config.pexelsKey) return null;
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=10`;
  const res = await fetch(url, { headers: { Authorization: config.pexelsKey } });
  if (!res.ok) throw new Error(`Pexels photo search ${res.status}`);
  const { photos = [] } = await res.json();
  const photo = photos.find((p) => !used.has(`p${p.id}`)) ?? photos[0];
  if (!photo) return null;
  const dest = path.join(dir, `scene-${n}.jpg`);
  await download(photo.src.portrait ?? photo.src.large2x, dest);
  return { file: dest, kind: "image", source: `Pexels photo by ${photo.photographer}`, stockId: `p${photo.id}` };
}

async function aiImage(dir, n, prompt) {
  const dest = path.join(dir, `scene-${n}.jpg`);
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const seed = Math.floor(Math.random() * 1e6);
    const url =
      `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
      `?width=1080&height=1920&nologo=true&model=flux&seed=${seed}`;
    try {
      await download(url, dest, { timeoutMs: 180_000 });
      if ((await fs.stat(dest)).size < 20_000) throw new Error("AI image came back empty");
      return { file: dest, kind: "image", source: "AI image (Pollinations/Flux)", cropBottom: 0.06 };
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  throw lastError;
}

async function placeholder(dir, n, text) {
  const { width, height } = config.video;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, width, height);
  g.addColorStop(0, "#1b1b1f");
  g.addColorStop(1, "#3a2f1f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  const dest = path.join(dir, `scene-${n}.png`);
  await fs.writeFile(dest, await canvas.encode("png"));
  return { file: dest, kind: "image", source: `placeholder (${text})` };
}
