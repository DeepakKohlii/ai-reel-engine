import fs from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { removeBackground } from "@imgly/background-removal-node";
import { config } from "./config.js";
import { exists, hash, readJson, writeJson } from "./util.js";

const dir = path.join(config.root, "assets", "library");
const indexFile = path.join(dir, "library.json");
const recolorDir = path.join(dir, ".recolored");

export const libraryDir = dir;

export async function listAssets() {
  return (await readJson(indexFile, [])).filter((a) => a && a.file);
}

async function saveIndex(items) {
  await fs.mkdir(dir, { recursive: true });
  await writeJson(indexFile, items);
}

const normTags = (tags) =>
  [...new Set((Array.isArray(tags) ? tags : String(tags).split(","))
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean))];

const GENERIC = new Set(["prop", "model", "host", "item", "host-ref"]);
const COLOUR_TAGS = new Set(
  "black white off-white ivory cream beige tan camel brown cognac chocolate navy blue olive green sage khaki grey gray charcoal silver gold maroon burgundy wine red rust mustard yellow pink peach lavender purple teal".split(" "),
);

export async function findAsset(tags, { kind, exclude = new Set() } = {}) {
  const all = normTags(tags);
  const specific = all.filter((t) => !GENERIC.has(t));
  const want = specific.length ? specific : all;
  if (!want.length) return null;
  let best = null;
  for (const a of await listAssets()) {
    if (kind && a.kind !== kind) continue;
    if (exclude.has(a.id)) continue;
    const have = new Set(a.tags);
    if (want.some((t) => COLOUR_TAGS.has(t) && !have.has(t))) continue;
    const score = want.filter((t) => have.has(t)).length / want.length;
    if (score < (a.kind === "model" || a.kind === "host" ? 1 : a.kind === "item" ? 0.67 : 0.5)) continue;
    const quality = /pollinations/.test(a.source ?? "") ? 0 : 60;
    const rank = score * 100 + quality - (a.uses ?? 0);
    if (!best || rank > best.rank) best = { rank, asset: a };
  }
  return best?.asset ?? null;
}

export async function markUsed(id) {
  const items = await listAssets();
  const a = items.find((x) => x.id === id);
  if (a) {
    a.uses = (a.uses ?? 0) + 1;
    await saveIndex(items);
  }
}

export async function addAsset(buffer, { tags, kind = "item", source = "upload", prompt = "", cropBottom = 0, keepBackground = false, trim = true }) {
  if (kind === "cover") keepBackground = true;
  await fs.mkdir(dir, { recursive: true });
  let img = await loadImage(buffer);
  if (cropBottom) img = await crop(img, 0, 0, img.width, Math.round(img.height * (1 - cropBottom)));

  let png;
  const isPng = buffer.length > 8 && buffer.readUInt32BE(0) === 0x89504e47;
  if (isPng && !cropBottom && hasTransparency(img)) png = Buffer.from(buffer);
  else if (keepBackground) {
    png = isPng && !cropBottom ? Buffer.from(buffer) : await toPng(img);
  } else {
    const input = await toPng(img);
    const blob = await removeBackground(new Blob([input], { type: "image/png" }), {
      model: "medium",
      output: { format: "image/png" },
    });
    const cut = await defringe(await fullResMask(img, Buffer.from(await blob.arrayBuffer())));
    png = trim ? await trimAlpha(cut) : cut;
  }

  const id = `${kind}-${hash([tags, Date.now(), Math.random()])}`;
  const file = `${id}.png`;
  await fs.writeFile(path.join(dir, file), png);
  const items = await listAssets();
  const asset = { id, file, kind, tags: normTags(tags), source, prompt, uses: 0, created: Date.now(), blurFace: false };
  items.push(asset);
  await saveIndex(items);
  return asset;
}

export async function updateAsset(id, { tags, kind, blurFace }) {
  const items = await listAssets();
  const a = items.find((x) => x.id === id);
  if (!a) throw new Error("Asset not found");
  if (tags) a.tags = normTags(tags);
  if (kind) a.kind = kind;
  if (typeof blurFace === "boolean") a.blurFace = blurFace;
  await saveIndex(items);
  return a;
}

export async function deleteAsset(id) {
  const items = await listAssets();
  const a = items.find((x) => x.id === id);
  if (!a) return;
  await fs.rm(path.join(dir, a.file), { force: true });
  await saveIndex(items.filter((x) => x.id !== id));
}

export const assetPath = (a) => path.join(dir, a.file);

let queue = Promise.resolve();
export function generateAsset({ prompt, tags, kind = "item", referenceIds = [], refMode = "edit" }) {
  prompt = String(prompt ?? "").replace(/,?\s*(die[- ]cut\s+)?sticker(\s+style)?(\s+with\s+a\s+(thick\s+)?white\s+(border|outline))?/gi, "");
  const job = queue.then(() => generateChecked({ prompt, tags, kind, referenceIds, refMode }));
  queue = job.catch(() => {});
  return job;
}

async function generateChecked({ prompt, tags, kind, referenceIds, refMode }) {
  const want = kind === "item" ? normTags(tags).find((t) => COLOUR_CHECKS[t]) : null;
  let asset = await generateNow({ prompt, tags, kind, referenceIds, refMode });
  for (let attempt = 1; want && attempt <= 2; attempt++) {
    const [h, sat, v] = await averageHsv(asset);
    if (COLOUR_CHECKS[want](h, sat, v)) break;
    await deleteAsset(asset.id);
    asset = await generateNow({ prompt: `entirely ${want} coloured, ${want} ${prompt}, the item is clearly ${want}`, tags, kind, referenceIds, refMode });
  }
  return asset;
}

const COLOUR_CHECKS = {
  black: (h, s, v) => v < 0.3,
  white: (h, s, v) => v > 0.72 && s < 0.22,
  "off-white": (h, s, v) => v > 0.68 && s < 0.28,
  ivory: (h, s, v) => v > 0.68 && s < 0.3,
  cream: (h, s, v) => v > 0.65 && s < 0.35,
  grey: (h, s, v) => s < 0.18 && v > 0.25 && v < 0.8,
  charcoal: (h, s, v) => s < 0.25 && v < 0.45,
  navy: (h, s, v) => h > 190 && h < 260 && v < 0.5,
  blue: (h, s, v) => h > 185 && h < 260,
  brown: (h, s, v) => h < 45 && v < 0.6 && s > 0.2,
  tan: (h, s, v) => h > 15 && h < 50 && v > 0.45 && s > 0.2,
  olive: (h, s, v) => h > 40 && h < 100 && v < 0.6,
  green: (h, s, v) => h > 70 && h < 170,
  red: (h, s, v) => (h < 15 || h > 340) && s > 0.35,
  maroon: (h, s, v) => (h < 20 || h > 330) && v < 0.5 && s > 0.3,
};

async function averageHsv(asset) {
  const img = await loadImage(await fs.readFile(assetPath(asset)));
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  let [r, g, b, n] = [0, 0, 0, 0];
  for (let i = 0; i < d.length; i += 16) {
    if (d[i + 3] > 200) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
      n++;
    }
  }
  [r, g, b] = [r / n / 255, g / n / 255, b / n / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const dlt = max - min;
  let h = 0;
  if (dlt) h = max === r ? 60 * (((g - b) / dlt) % 6) : max === g ? 60 * ((b - r) / dlt + 2) : 60 * ((r - g) / dlt + 4);
  if (h < 0) h += 360;
  return [h, max ? dlt / max : 0, max];
}

export const imageProvider = () =>
  config.gemini.key ? "gemini" : config.cloudflare.accountId && config.cloudflare.token ? "cloudflare" : "pollinations";

const STYLE = {
  item: "high-end e-commerce product photograph of this single item, true-to-life material texture (leather grain, fabric weave, stitching, metal hardware with realistic reflections), accurate colour, three-quarter view, whole item visible and centered, soft natural contact shadow, plain light grey seamless studio background, no person, no mannequin, no hands, no text, no logo, photorealistic, sharp focus",
  model:
    "full body head to toe fashion lookbook photo, standing, the whole figure including both shoes clearly visible with space below the feet, plain light grey seamless studio background, soft even lighting, photorealistic, sharp focus, no text, no logo",
  host:
    "full body head to toe photo, plain light grey seamless studio background, soft even lighting, photorealistic, sharp focus, no text, no logo",
  prop: "studio product photo, centered, whole object visible, plain light grey seamless background, soft lighting, no text, no logo",
  cover:
    "editorial magazine cover photograph, vertical 9:16, the subject fills the frame as a tight crop, rich true-to-life texture, dramatic soft directional light, premium fashion campaign quality, calm negative space in the middle of the frame for a title, photorealistic, no text, no letters, no logo, no watermark",
};

export async function hostReference() {
  const hosts = (await listAssets()).filter((a) => a.kind === "host");
  const good = hosts.filter((a) => !/pollinations/.test(a.source ?? ""));
  return hosts.find((a) => a.tags.includes("host-ref")) ?? good.sort((a, b) => a.created - b.created)[0] ?? null;
}

async function generateNow({ prompt, tags, kind, referenceIds, refMode = "edit" }) {
  const refs = [];
  const all = await listAssets();
  for (const id of referenceIds) {
    const a = all.find((x) => x.id === id);
    if (a) refs.push(a);
  }
  if (kind === "host" && !refs.length) {
    const ref = await hostReference();
    if (ref) refs.push(ref);
  }

  if (imageProvider() === "gemini") {
    const buf = await generateGemini(appPrompt({ prompt, kind, hasReference: refs.length > 0, refMode }), kind, refs);
    return addAsset(buf, { tags, kind, source: `ai (gemini${refs.length ? ", with reference" : ""})`, prompt });
  }

  if (imageProvider() === "cloudflare") {
    let full = `${withLook(prompt, kind, refs.length > 0)}, ${STYLE[kind] ?? STYLE.prop}`;
    if (refs.length && kind === "model" && refMode === "person") {
      full = `The same man as in image 0, with an identical face, hairstyle, skin tone and build, standing in the same pose and framing, now dressed differently. ${full}`;
    } else if (refs.length && kind === "host") {
      full = `The same man as in image 0, with an identical face, hairstyle, skin tone and outfit. ${full}`;
    } else if (refs.length && kind === "model") {
      full = `Edit image 0: the same man, same face, same pose, same clothes and same jeans wash as in image 0, changing only what this describes: ${full}`;
    }
    const buf = await generateCloudflare(full, kind, refs);
    return addAsset(buf, { tags, kind, source: `ai (flux 2${refs.length ? ", with reference" : ""})`, prompt });
  }

  const full = `${withLook(prompt, kind, refs.length > 0)}, ${STYLE[kind] ?? STYLE.prop}`;
  const [w, h] = kind === "model" || kind === "host" || kind === "cover" ? [832, 1472] : [1024, 1024];
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const seed = Math.floor(Math.random() * 1e6);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(full)}?width=${w}&height=${h}&nologo=true&model=flux&seed=${seed}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!res.ok) throw new Error(`AI image ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 20_000) throw new Error("AI image came back empty");
      return await addAsset(buf, { tags, kind, source: "ai (pollinations)", prompt, cropBottom: 0.06 });
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 4000 * attempt));
    }
  }
  throw lastError;
}

const LOOKS = [
  "slim build, short textured hair, clean-shaven, wheatish skin",
  "athletic build, side-parted hair, light stubble, medium brown skin",
  "lean build, curly hair, short beard, dusky skin",
  "average build, crew cut, clean-shaven, fair wheatish skin",
  "broad-shouldered build, wavy medium hair, trimmed beard, brown skin",
  "tall slim build, quiff hairstyle, light moustache and stubble, wheatish skin",
  "stocky build, buzz cut, full short beard, dusky skin",
  "medium build, messy fringe, clean-shaven, medium brown skin",
];
function variedLook(prompt) {
  let h = 0;
  for (const c of String(prompt)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `a different face from any previous image: ${LOOKS[h % LOOKS.length]}, age ${21 + (h % 8)}`;
}
const withLook = (prompt, kind, hasReference) => (kind === "model" && !hasReference && !/same man/i.test(prompt) && !/^Model:/i.test(prompt) ? `${prompt}, ${variedLook(prompt)}` : prompt);

export function appPrompt({ prompt, kind, hasReference, refMode = "edit" }) {
  prompt = withLook(prompt, kind, hasReference);
  const frame = kind === "model" || kind === "host" || kind === "cover" ? "Vertical 9:16 photo." : "Square photo.";
  const ref =
    hasReference && (kind === "host" || (kind === "model" && refMode === "person"))
      ? "Use the attached photo as the reference: the exact same man with an identical face, hairstyle, skin tone and outfit. "
      : hasReference
        ? "Use the attached photo(s) as reference. "
        : "";
  return `${ref}${prompt}. ${STYLE[kind] ?? STYLE.prop}. ${frame} Photorealistic.`;
}

async function generateGemini(prompt, kind, refs) {
  const { key, model } = config.gemini;
  const parts = [{ text: prompt }];
  for (const ref of refs.slice(0, 3)) {
    parts.push({ inline_data: { mime_type: "image/png", data: (await refPng(ref, 1024)).toString("base64") } });
  }
  const aspectRatio = kind === "model" || kind === "host" || kind === "cover" ? "9:16" : "1:1";
  const call = (generationConfig) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }], generationConfig }),
      signal: AbortSignal.timeout(180_000),
    });
  let res = await call({ responseModalities: ["IMAGE"], imageConfig: { aspectRatio } });
  if (res.status === 400) res = await call({ responseModalities: ["TEXT", "IMAGE"] });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini image ${res.status}: ${data.error?.message ?? res.statusText}`);
  const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData || p.inline_data);
  const b64 = part?.inlineData?.data ?? part?.inline_data?.data;
  if (!b64) {
    const reason = data.candidates?.[0]?.finishReason ?? data.promptFeedback?.blockReason ?? "no image returned";
    throw new Error(`Gemini didn't return an image (${reason})`);
  }
  return Buffer.from(b64, "base64");
}

async function generateCloudflare(prompt, kind, refs) {
  const { accountId, token, model } = config.cloudflare;
  const [w, h] = kind === "model" || kind === "host" || kind === "cover" ? [768, 1344] : [1024, 1024];
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("width", String(w));
  form.append("height", String(h));
  for (const [i, ref] of refs.slice(0, 4).entries()) {
    form.append(`input_image_${i}`, new Blob([await smallPng(ref)], { type: "image/png" }), `ref${i}.png`);
  }
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        signal: AbortSignal.timeout(180_000),
      });
      const type = res.headers.get("content-type") ?? "";
      if (type.startsWith("image/")) return Buffer.from(await res.arrayBuffer());
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        const msg = data.errors?.map((e) => e.message).join("; ") || res.statusText;
        const err = new Error(`Cloudflare image ${res.status}: ${msg}`);
        if (res.status === 401 || res.status === 403) throw Object.assign(err, { fatal: true });
        throw err;
      }
      const b64 = data.result?.image;
      if (!b64) throw new Error("Cloudflare returned no image");
      return Buffer.from(b64, "base64");
    } catch (err) {
      lastError = err;
      if (err.fatal) break;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  throw lastError;
}

const smallPng = (asset) => refPng(asset, 500);

export async function refPng(asset, maxSide) {
  const img = await loadImage(await fs.readFile(assetPath(asset)));
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const c = createCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#D9D9D9";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.encode("png");
}

export async function recolored(asset, hex) {
  const out = path.join(recolorDir, `${asset.id}-${hex.replace("#", "")}.png`);
  if (await exists(out)) return out;
  await fs.mkdir(recolorDir, { recursive: true });
  const img = await loadImage(await fs.readFile(assetPath(asset)));
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  const lum = (i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  let sum = 0;
  let n = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 128) (sum += lum(i)), n++;
  const avg = sum / Math.max(n, 1) || 1;
  const [tr, tg, tb] = [1, 3, 5].map((o) => parseInt(hex.replace("#", "").slice(o - 1, o + 1), 16));
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue;
    const s = Math.pow(lum(i) / avg, 0.85);
    px[i] = Math.min(255, tr * s);
    px[i + 1] = Math.min(255, tg * s);
    px[i + 2] = Math.min(255, tb * s);
  }
  ctx.putImageData(data, 0, 0);
  await fs.writeFile(out, await c.encode("png"));
  return out;
}

export async function faceBlurred(asset) {
  const out = path.join(recolorDir, `${asset.id}-faceblur.png`);
  if (await exists(out)) return out;
  await fs.mkdir(recolorDir, { recursive: true });
  const img = await loadImage(await fs.readFile(assetPath(asset)));
  const W = img.width;
  const H = img.height;
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, W, H);

  const spans = [];
  for (let y = 0; y < H; y++) {
    let x0 = -1;
    let x1 = -1;
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 60) {
        if (x0 < 0) x0 = x;
        x1 = x;
      }
    }
    spans.push(x0 < 0 ? null : [x0, x1]);
  }
  const top = spans.findIndex(Boolean);
  const bottom = spans.findLastIndex(Boolean);
  const fh = bottom - top;
  if (top < 0 || fh < 50) return assetPath(asset);
  const width = (y) => (spans[y] ? spans[y][1] - spans[y][0] : 0);

  const refRows = [];
  for (let y = top + Math.round(fh * 0.03); y < top + Math.round(fh * 0.07); y++) refRows.push(width(y));
  const ref = refRows.sort((a, b) => a - b)[Math.floor(refRows.length / 2)] || width(top + 5);
  let shoulders = -1;
  for (let y = top + Math.round(fh * 0.06); y < top + fh * 0.4; y++) {
    if (width(y) > ref * 1.75) {
      shoulders = y;
      break;
    }
  }
  const headBottom = shoulders > 0 ? shoulders - (shoulders - top) * 0.1 : top + fh * 0.14;
  const headH = headBottom - top;
  const cy = top + headH * 0.6;
  const row = spans[Math.round(cy)] ?? spans[top];
  const cx = (row[0] + row[1]) / 2;
  const rx = Math.max((row[1] - row[0]) * 0.42, headH * 0.3);
  const ry = headH * 0.42;

  const blur = createCanvas(W, H);
  const b = blur.getContext("2d");
  b.filter = `blur(${Math.max(6, rx * 0.28).toFixed(1)}px)`;
  b.drawImage(img, 0, 0);
  b.filter = "none";
  b.globalCompositeOperation = "destination-in";
  b.save();
  b.translate(cx, cy);
  b.scale(1, ry / rx);
  const g = b.createRadialGradient(0, 0, rx * 0.55, 0, 0, rx);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  b.fillStyle = g;
  b.fillRect(-rx, -rx, rx * 2, rx * 2);
  b.restore();
  ctx.drawImage(blur, 0, 0);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(img, 0, 0);
  await fs.writeFile(out, await c.encode("png"));
  return out;
}

function hasTransparency(img) {
  const c = createCanvas(64, 64);
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0, 64, 64);
  const d = g.getImageData(0, 0, 64, 64).data;
  let clear = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 20) clear++;
  return clear > 64 * 64 * 0.05;
}

async function fullResMask(img, cutPng) {
  const cut = await loadImage(cutPng);
  const w = img.width;
  const h = img.height;
  const m = createCanvas(w, h);
  const mg = m.getContext("2d");
  mg.imageSmoothingQuality = "high";
  mg.drawImage(cut, 0, 0, w, h);
  const alpha = mg.getImageData(0, 0, w, h).data;
  const o = createCanvas(w, h);
  const og = o.getContext("2d");
  og.drawImage(img, 0, 0);
  const px = og.getImageData(0, 0, w, h);
  for (let i = 3; i < px.data.length; i += 4) px.data[i] = alpha[i];
  og.putImageData(px, 0, 0);
  return o.toBuffer("image/png");
}

async function toPng(img) {
  const c = createCanvas(img.width, img.height);
  c.getContext("2d").drawImage(img, 0, 0);
  return c.encode("png");
}

async function crop(img, x, y, w, h) {
  const c = createCanvas(w, h);
  c.getContext("2d").drawImage(img, x, y, w, h, 0, 0, w, h);
  return loadImage(await c.encode("png"));
}

export async function defringe(pngBuffer) {
  const img = await loadImage(pngBuffer);
  const W = img.width;
  const H = img.height;
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, W, H);
  const px = data.data;
  const a0 = new Uint8ClampedArray(W * H);
  for (let i = 0; i < W * H; i++) a0[i] = px[i * 4 + 3];

  const a1 = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let m = 255;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) { m = 0; continue; }
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const v = xx < 0 || xx >= W ? 0 : a0[yy * W + xx];
          if (v < m) m = v;
        }
      }
      const soft = Math.max(0, Math.min(1, (m - 28) / (255 - 28)));
      a1[y * W + x] = Math.round(Math.pow(soft, 1.15) * 255);
    }
  }

  const R = 3;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (a1[i] === 0 || a0[i] >= 250) continue;
      let [r, g, b, n] = [0, 0, 0, 0];
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          const j = yy * W + xx;
          if (a0[j] >= 250) {
            r += px[j * 4];
            g += px[j * 4 + 1];
            b += px[j * 4 + 2];
            n++;
          }
        }
      }
      if (n) {
        px[i * 4] = r / n;
        px[i * 4 + 1] = g / n;
        px[i * 4 + 2] = b / n;
      }
    }
  }
  for (let i = 0; i < W * H; i++) px[i * 4 + 3] = a1[i];
  ctx.putImageData(data, 0, 0);
  return c.encode("png");
}

async function trimAlpha(pngBuffer) {
  const img = await loadImage(pngBuffer);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height);
  let [x0, y0, x1, y1] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error("Background removal left nothing. Try a clearer image.");
  const pad = 4;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad);
  y1 = Math.min(height - 1, y1 + pad);
  const out = createCanvas(x1 - x0 + 1, y1 - y0 + 1);
  out.getContext("2d").drawImage(img, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.encode("png");
}
