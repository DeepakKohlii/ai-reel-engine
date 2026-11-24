import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { assetPath, findAsset, generateAsset, listAssets, markUsed } from "../../library.js";
import { config } from "../../config.js";
import { mixSfx } from "../../sfx.js";
import { exists, readJson, writeJson } from "../../util.js";
import { generateNarration } from "../../voice.js";
import * as D from "./design.js";
import { fitDifference, partPoint } from "./body.js";
import { STAGE, buildTimeline, renderVideo, sfxCues } from "./engine.js";
import { aiPrompt, loadMedia, mediaSpecs } from "./media.js";
import { COVERS } from "./covers.js";
import { kitOf } from "./kits.js";
import { HEAD_FONTS, styleOf } from "./style.js";

export const id = "aesthetic";
export const label = "Aesthetic (English, magazine style)";
export const schema = {
  type: "object",
  required: ["title", "lines"],
  properties: {
    title: { type: "string" },
    lines: { type: "array", items: { type: "object", required: ["voiceover"], properties: { voiceover: { type: "string" } } } },
  },
};
export const brief = "";
export const task = () => {
  throw new Error("Aesthetic reels are written from the Aesthetic reels page.");
};

const FLAW = /\b(oversized|baggy|too (tight|loose|long|short|big|small|wide)|tight across|tent|droop|billow|sagging|pulling|creases|ill-fitting|boxy)\b/i;
const FLAW_NOTE = " The fit problem described must be obvious at a glance on a phone screen, exaggerated rather than subtle: it should look clearly wrong next to a well-fitted version.";

const POSE = "standing straight and relaxed, facing the camera, arms by his sides, full body head to toe with both shoes clearly visible, centred in the frame";

export function imageSpecs(script) {
  const scenesUsing = (pred) => (script.scenes ?? []).map((s, i) => (pred(s) ? i + 1 : 0)).filter(Boolean);
  const base = script.outfits?.[0]?.key;
  const outfits = (script.outfits ?? []).map((o, i) => ({
    key: `o:${o.key}`,
    kind: "model",
    label: o.key.replace(/_/g, " "),
    tags: ["model", "aesthetic", ...o.key.split("_")],
    prompt:
      i === 0
        ? `Model: ${script.model?.description ?? "a young Indian man"}. Wearing: ${o.description}. ${POSE}`
        : o.edit_of && o.changes
          ? `Edit the reference photo. ${/^adds?\b/i.test(o.changes) ? `Add ONLY ${o.changes.replace(/^adds?\s+(a layer:\s*)?/i, "").replace(/;\s*everything else unchanged\.?$/i, "")}` : `Change ONLY ${o.changes}`}. Keep everything else exactly identical, pixel for pixel: the same man, face, expression, hair, pose, hand positions, every other garment with its creases, the light, the framing and the photo size.${FLAW.test(o.changes) ? FLAW_NOTE : ""}`
          : `The exact same man as in the reference photo (identical face, hair, build and skin tone), same pose and framing. Wearing: ${o.description}.${FLAW.test(o.description) ? FLAW_NOTE : ""} ${POSE}`,
    referenceKey: i === 0 ? null : `o:${o.edit_of && (script.outfits ?? []).some((x) => x.key === o.edit_of) ? o.edit_of : base}`,
    beats: scenesUsing((s) => s.outfit === o.key || s.outfit2 === o.key || (s.overlays ?? []).some((v) => v.target === o.key)),
  }));
  const items = (script.items ?? []).map((it) => ({
    key: `i:${it.key}`,
    kind: "item",
    label: it.label,
    tags: String(it.label).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2),
    prompt: it.description,
    referenceKey: null,
    beats: scenesUsing((s) => s.thumb === it.key || (s.overlays ?? []).some((v) => v.item === it.key)),
  }));
  const cover = script.cover?.image_prompt
    ? [{ key: "c:cover", kind: "cover", label: "cover image", tags: ["cover", "aesthetic", ...String(script.title ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2).slice(0, 4)], prompt: script.cover.image_prompt, referenceKey: script.cover.uses_model ? `o:${base}` : null, beats: [0] }]
    : [];
  const depth = (k, n = 0) => {
    const o = (script.outfits ?? []).find((x) => x.key === k);
    return o?.edit_of && n < 9 ? depth(o.edit_of, n + 1) + 1 : 0;
  };
  outfits.sort((a, b) => depth(a.key.slice(2)) - depth(b.key.slice(2)));
  return [...outfits, ...items, ...cover];
}

function alphaBox(img) {
  const w = img.width;
  const h = img.height;
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    if (d[(y * w + x) * 4 + 3] > 24) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { x0: Math.max(0, x0 - 2), y0: Math.max(0, y0 - 2), x1: Math.min(w - 1, x1 + 2), y1: Math.min(h - 1, y1 + 2) };
}

async function lockOutfits(script, loaded, masksFor, log) {
  const { changedGroups, lockOutfit, recolour } = await import("./lock.js");
  const raw = (k) => loaded[`o:${k}`]?.raw;
  const outs = script.outfits ?? [];
  const groupOfText = (said) => (/\b(shoe|sneaker|loafer|boot|sandal|derby)/i.test(said) ? "shoes" : /\b(trouser|pant|jean|chino|short|pyjama)/i.test(said) ? "bottoms" : "top");
  for (let pass = 0; pass < 6; pass++) for (const o of outs) {
    if (!/^#[0-9a-f]{6}$/i.test(o.recolor ?? "") || !o.edit_of || loaded[`o:${o.key}`] || !raw(o.edit_of)) continue;
    const p = loaded[`o:${o.edit_of}`];
    const grp = groupOfText(o.changes ?? "");
    let src = o.edit_of;
    for (let n = 0; n < 9; n++) {
      const so = outs.find((x) => x.key === src);
      if (!so?.edit_of || !/^#[0-9a-f]{6}$/i.test(so.recolor ?? "") || groupOfText(so.changes ?? "") !== grp) break;
      src = so.edit_of;
    }
    const sp = loaded[`o:${src}`];
    const masks = await masksFor(sp.raw, `${sp.id}-raw-${sp.raw.width}x${sp.raw.height}`);
    const tinted = recolour(sp.raw, masks[grp], o.recolor);
    const { lockOutfit } = await import("./lock.js");
    const c = sp === p ? tinted : lockOutfit(p.raw, tinted, masks, masks, [grp]);
    loaded[`o:${o.key}`] = { img: figureOnly(c), raw: c, id: `${p.id}-rc-${o.recolor.slice(1)}`, recoloured: true };
    log(`  ${o.key.replace(/_/g, " ")}: made from ${o.edit_of.replace(/_/g, " ")} with the ${groupOfText(o.changes ?? "")} in ${o.recolor}`);
  }
  const order = [];
  for (const sc of script.scenes ?? []) {
    if (sc.outfit) order.push(sc.outfit);
    for (const o of sc.overlays ?? []) if (o.kind === "swap" && o.target) order.push(o.target);
  }
  const locked = {};
  const chains = [];
  const chainOf = {};
  for (let i = 1; i < order.length; i++) {
    const [a, b] = [order[i - 1], order[i]];
    if (a === b || locked[b] || !raw(a) || !raw(b)) continue;
    const base = locked[a] ?? raw(a);
    const { register } = await import("./lock.js");
    const bImg = register(alignTo(raw(b), base), base);
    const ka = locked[a] ? `lock-${a}` : `${loaded[`o:${a}`].id}-raw`;
    const ma = await masksFor(base, `${ka}-${base.width}x${base.height}`);
    const mb = await masksFor(bImg, `${loaded[`o:${b}`].id}-on-${ka}-${base.width}x${base.height}`);
    const said = String((script.outfits ?? []).find((o) => o.key === b)?.changes ?? "").toLowerCase();
    const named = [
      /\b(shoe|sneaker|loafer|boot|sandal|derby|derbies|oxford shoes|mojari|jutti)/.test(said) && "shoes",
      /\b(trouser|pant|jean|chino|short|pyjama|dhoti|skirt)/.test(said) && "bottoms",
      /\b(shirt|tee|t-shirt|polo|kurta|top|sweater|knit|hoodie|jacket|blazer|overshirt|layer|coat|vest)/.test(said) && "top",
    ].filter(Boolean);
    const groups = named.length ? named : changedGroups(base, bImg, ma, mb);
    if (!groups.length) continue;
    if (groups.length === 3) {
      log(`  ${b.replace(/_/g, " ")}: isn't an edit of ${a.replace(/_/g, " ")} (the whole man changed), so it can't change in place: make it as an edit in Gemini (its prompt says how)`);
      continue;
    }
    locked[b] = lockOutfit(base, bImg, ma, mb, groups);
    const { toneOf } = await import("./lock.js");
    if (groups.length === 1 && mb[groups[0]]) loaded[`o:${b}`].tone = toneOf(bImg, mb[groups[0]]);
    const chain = chainOf[a] ?? (chains.push([a]), chains.at(-1));
    chain.push(b);
    chainOf[a] = chainOf[b] = chain;
    log(`  ${b.replace(/_/g, " ")}: changes only the ${groups.join(" and ")}, everything else stays exactly as before`);
  }
  for (const chain of chains) {
    for (const k of chain) {
      const v = loaded[`o:${k}`];
      if (locked[k]) {
        v.raw = locked[k];
        v.id = `${v.id}-lock-${chain[0]}`;
      }
      v.lock = chain[0];
    }
  }
}

function alignTo(img, ref) {
  if (img.width === ref.width && img.height === ref.height) return img;
  const a = figureBox(ref);
  const b = figureBox(img);
  const k = (a.y1 - a.y0) / Math.max(1, b.y1 - b.y0);
  const out = createCanvas(ref.width, ref.height);
  const g = out.getContext("2d");
  g.imageSmoothingQuality = "high";
  const cxA = (a.x0 + a.x1) / 2;
  const cxB = (b.x0 + b.x1) / 2;
  g.drawImage(img, cxA - cxB * k, a.y1 - b.y1 * k, img.width * k, img.height * k);
  return out;
}

function figureBox(img) {
  const w = img.width;
  const h = img.height;
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (d[(y * w + x) * 4 + 3] > 24) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 < 0 ? { x0: 0, y0: 0, x1: w - 1, y1: h - 1 } : { x0: Math.max(0, x0 - 2), y0: Math.max(0, y0 - 2), x1: Math.min(w - 1, x1 + 2), y1: Math.min(h - 1, y1 + 2) };
}
function cropTo(img, b) {
  const out = createCanvas(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1);
  out.getContext("2d").drawImage(img, b.x0, b.y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

export function figureOnly(img) {
  const w = img.width;
  const h = img.height;
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    if (d[(y * w + x) * 4 + 3] > 24) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return img;
  x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(w - 1, x1 + 2); y1 = Math.min(h - 1, y1 + 2);
  if (x0 < w * 0.02 && y0 < h * 0.02 && x1 > w * 0.98 && y1 > h * 0.98) return img;
  const out = createCanvas(x1 - x0 + 1, y1 - y0 + 1);
  out.getContext("2d").drawImage(img, x0, y0, x1 - x0 + 1, y1 - y0 + 1, 0, 0, x1 - x0 + 1, y1 - y0 + 1);
  return out;
}

async function resolveMedia(dir, script, { generate, log }) {
  const picksFile = path.join(dir, "asset-picks.json");
  const picks = await readJson(picksFile, {});
  const assets = await listAssets();
  const byId = new Map(assets.map((a) => [a.id, a]));
  const loaded = {};
  for (const spec of imageSpecs(script)) {
    let asset = byId.get(picks[spec.key]) ?? null;
    if (!asset && spec.kind === "item") asset = await findAsset(spec.tags, { kind: "item" });
    if (spec.kind === "cover" && !asset && !generate) continue;
    const paintable = spec.kind === "model" && /^#[0-9a-f]{6}$/i.test((script.outfits ?? []).find((o) => `o:${o.key}` === spec.key)?.recolor ?? "");
    if (!asset && generate && !paintable) {
      const ref = spec.referenceKey ? picks[spec.referenceKey] : null;
      log(`Image: ${spec.kind === "model" ? "outfit" : spec.kind === "cover" ? "cover" : "product"} "${spec.label}"${ref ? " (same man as the first outfit)" : ""}`);
      try {
        asset = await generateAsset({ prompt: spec.prompt, tags: spec.tags, kind: spec.kind, referenceIds: ref ? [ref] : [], refMode: /^Edit the reference photo/.test(spec.prompt) ? "edit" : "person" });
        byId.set(asset.id, asset);
      } catch (err) {
        log(`  couldn't make it (${err.message.slice(0, 120)}); a placeholder stands in`);
      }
    }
    if (!asset) continue;
    if (picks[spec.key] !== asset.id) {
      picks[spec.key] = asset.id;
      await markUsed(asset.id);
    }
    const raw = await loadImage(await fs.readFile(assetPath(asset)));
    loaded[spec.key] = { img: spec.kind === "cover" ? raw : figureOnly(raw), id: asset.id, raw };
  }
  const { garmentMasksFor: masksFor0 } = await import("./segment.js");
  try {
    await lockOutfits(script, loaded, masksFor0, log);
  } catch (err) {
    log(`  In-place outfit changes skipped (${err.message.slice(0, 120)})`);
  }
  const sets = new Map();
  for (const [key, v] of Object.entries(loaded)) {
    if (!key.startsWith("o:")) continue;
    const k = `${v.raw.width}x${v.raw.height}`;
    sets.set(k, [...(sets.get(k) ?? []), v]);
  }
  for (const group of sets.values()) {
    if (group.length < 2) continue;
    const box = group.map((v) => alphaBox(v.raw)).reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));
    for (const v of group) {
      const out = createCanvas(box.x1 - box.x0 + 1, box.y1 - box.y0 + 1);
      out.getContext("2d").drawImage(v.raw, box.x0, box.y0, out.width, out.height, 0, 0, out.width, out.height);
      v.img = out;
    }
  }
  for (const v of Object.values(loaded)) {
    if (v.lock && v.img) v.img.__lock = v.lock;
    delete v.raw;
  }
  await writeJson(picksFile, picks);
  const { garmentMasksFor } = await import("./segment.js");
  const { registerMasks } = await import("./engine.js");
  for (const [key, v] of Object.entries(loaded)) {
    if (!key.startsWith("o:")) continue;
    try {
      registerMasks(v.img, await garmentMasksFor(v.img, `${v.id}-${v.img.width}x${v.img.height}`));
    } catch (err) {
      log(`  Garment masks skipped for ${key.slice(2)} (${err.message.slice(0, 100)})`);
    }
  }
  const refs = {};
  const refDir = path.join(dir, "refs");
  for (const f of await fs.readdir(refDir).catch(() => [])) {
    const name = f.replace(/\.[^.]+$/, "");
    if (/\.(jpe?g|png|webp)$/i.test(f)) refs[name] = await loadImage(await fs.readFile(path.join(refDir, f)));
  }
  return { loaded, refs };
}

const CLIP = /\.(mp4|mov|m4v|webm)$/i;
async function chapterClips(dir, script, log) {
  const refDir = path.join(dir, "refs");
  const brollDir = path.join(config.root, "assets", "broll");
  const refs = (await fs.readdir(refDir).catch(() => [])).filter((f) => CLIP.test(f));
  const broll = (await fs.readdir(brollDir).catch(() => [])).filter((f) => CLIP.test(f));
  const used = new Set();
  const clips = {};
  const keys = {};
  for (const [i, sc] of (script.scenes ?? []).entries()) {
    if (sc.type !== "chapter") continue;
    const n = sc.number || i;
    const word = String(sc.title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    let file = refs.find((f) => f.replace(CLIP, "").toLowerCase() === `chapter-${n}`) ?? refs.find((f) => word && f.replace(CLIP, "").toLowerCase() === word);
    file = file ? path.join(refDir, file) : null;
    if (!file) {
      const want = new Set(`${sc.title} ${sc.outfit} ${sc.focus} ${script.topic ?? ""}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
      const scored = broll.filter((f) => !used.has(f)).map((f) => [f, f.toLowerCase().split(/[^a-z0-9]+/).filter((w) => want.has(w) || want.has(w.replace(/s$/, ""))).length]).sort((a, b) => b[1] - a[1]);
      if (scored[0]?.[1] > 0) {
        used.add(scored[0][0]);
        file = path.join(brollDir, scored[0][0]);
      }
    }
    if (!file) continue;
    try {
      clips[`chapter-${n}`] = await decodeClip(file);
      const st = await fs.stat(file);
      keys[`clip:chapter-${n}`] = `${path.basename(file)}:${st.size}`;
      log(`Chapter ${n}: footage from ${path.basename(file)}`);
    } catch (err) {
      log(`Chapter ${n}: couldn't read ${path.basename(file)} (${err.message.slice(0, 100)})`);
    }
  }
  return { clips, keys };
}

async function decodeClip(file, { w = 360, h = 640, fps = 24, seconds = 5 } = {}) {
  const buf = await new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-t", String(seconds), "-i", file, "-vf", `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${fps}`, "-f", "rawvideo", "-pix_fmt", "rgba", "-"]);
    const out = [];
    let err = "";
    ff.stdout.on("data", (d) => out.push(d));
    ff.stderr.on("data", (d) => (err += d));
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(err.slice(-300)))));
  });
  const size = w * h * 4;
  const frames = [];
  for (let o = 0; o + size <= buf.length; o += size) {
    const c = createCanvas(w, h);
    const g = c.getContext("2d");
    const im = g.createImageData(w, h);
    im.data.set(buf.subarray(o, o + size));
    g.putImageData(im, 0, 0);
    frames.push(c);
  }
  if (!frames.length) throw new Error("no frames");
  return { frames, fps };
}

export async function prepare(dir, script, log, { final = false, generate = true } = {}) {
  if (generate) await (await import("./autofill.js")).autofill(dir, script, log);
  const { loaded, refs } = await resolveMedia(dir, script, { generate, log });
  const { clips, keys: clipKeys } = await chapterClips(dir, script, log);
  const { media: slots, keys: slotKeys, plate } = await loadMedia(dir, script, log);
  const missing = (script.media ?? []).filter((m) => !slots[m.key]);
  const name = (m) => m.key.replace(/_/g, " ");
  const real = missing.filter((m) => m.source !== "ai");
  const ai = missing.filter((m) => m.source === "ai");
  if (real.length) log(`Photos & clips still to add: ${real.map(name).join(", ")} (placeholders stand in until you upload them).`);
  if (ai.length) log(`AI clips to make in Gemini (${ai.length}): ${ai.map(name).join(", ")}. Start photo and prompt are in Photos & clips; the still scenes stand in until then.`);
  const beats = script.lines.map((l, i) => (l.beat && i < script.lines.length - 1 ? i : -1)).filter((i) => i >= 0);
  const narration = await generateNarration(dir, script.lines.map((l) => l.voiceover), log, script.voice ?? {}, { final, language: "en", beats });
  const norm = (k) => String(k ?? "").toLowerCase().replace(/[^a-z0-9_]/g, "");
  const media = {
    outfit: (k) => loaded[`o:${k}`]?.img ?? loaded[`i:${k}`]?.img ?? null,
    item: (k) => loaded[`i:${k}`]?.img ?? loaded[`o:${k}`]?.img ?? null,
    ref: (k) => refs[k] ?? refs[norm(k)] ?? null,
    clip: (k) => clips[k] ?? null,
    media: (k) => slots[k] ?? null,
    cover: () => loaded["c:cover"]?.img ?? null,
    plate: () => plate,
    tone: (k) => loaded[`o:${k}`]?.tone ?? null,
  };
  for (const w of fitWarnings(script, media)) log(w);
  const tl = buildTimeline({ plan: script, narration, media });
  const mediaKeys = { ...Object.fromEntries(Object.entries(loaded).map(([k, v]) => [k, v.id])), ...clipKeys, ...slotKeys };
  return { tl, narration, mediaKeys, media, slots };
}

export function fitWarnings(script, media) {
  const out = [];
  const LENGTH = new Set(["shirt_hem", "cuff", "hem", "sleeve", "ankles", "feet", "knees"]);
  const scenes = script.scenes ?? [];
  const statusOf = (sc, st) => (sc.overlays ?? []).filter((o) => o.status === st && !LENGTH.has(o.part));
  const seen = new Set();
  scenes.forEach((sc, i) => {
    for (const bad of statusOf(sc, "bad")) {
      const swap = (sc.overlays ?? []).filter((o) => o.kind === "swap" && o.target).find((o) => sc.overlays.indexOf(o) < sc.overlays.indexOf(bad));
      const badKey = swap?.target ?? sc.outfit;
      const near = [...scenes.slice(Math.max(0, i - 3), i).reverse(), ...scenes.slice(i + 1, i + 4)].find((x) => x.outfit && x.outfit !== badKey && statusOf(x, "good").length);
      if (!near || seen.has(badKey)) continue;
      const a = media.outfit(badKey);
      const b = media.outfit(near.outfit);
      if (!a || !b) continue;
      const d = fitDifference(a, b);
      seen.add(badKey);
      if (d < 0.09) out.push(`⚠ Image "${badKey.replace(/_/g, " ")}" looks almost the same as "${near.outfit.replace(/_/g, " ")}" (only ${(d * 100).toFixed(0)}% different in body width). The reel can't show the problem: remake it with the flaw exaggerated (the prompt in image-prompts.md now asks for that).`);
    }
  });
  return out;
}

export async function build(dir, script, log, { final = false } = {}) {
  if (!script.scenes?.length) throw new Error("Approve the script first: it isn't planned yet.");
  try {
    await buildInner(dir, script, log, { final });
  } finally {
    await fs.rm(path.join(dir, "render-cache", "clips"), { recursive: true, force: true });
  }
}

async function buildInner(dir, script, log, { final }) {
  const { tl, narration, mediaKeys, media, slots } = await prepare(dir, script, log, { final });
  const sfx = path.join(dir, "audio", "sfx.wav");
  await mixSfx(sfxCues(tl), tl.total, sfx);
  const m = script.music ?? {};
  const musicPath = m.file ? path.join(config.musicDir, path.basename(m.file)) : null;
  const music = musicPath && m.mode !== "off" && (await exists(musicPath)) ? musicPath : null;
  log(`Render: ${tl.scenes.length} scenes, ${tl.total.toFixed(1)}s`);
  await renderVideo(tl, { voice: narration.file, sfx, music, musicStart: m.start ?? 0, out: path.join(dir, "rough-cut.mp4"), cacheDir: path.join(dir, "render-cache"), mediaKeys, log });
  await renderCover(dir, script, media, slots);
  await writeJson(path.join(dir, "timeline.json"), {
    total: tl.total,
    scenes: tl.scenes.map((s) => ({ scene: s.index + 1, start: +s.t0.toFixed(2), duration: +(s.t1 - s.t0).toFixed(2), source: s.type })),
  });
  log("Done. Rough cut is ready.");
}

const COVER_PART = [
  [/collar|neck/i, "collar"], [/shoulder/i, "shoulders"], [/sleeve|cuff|wrist/i, "cuff"], [/length|hem|tuck/i, "shirt_hem"],
  [/body|chest|fit|waist|torso/i, "waist"], [/pant|jean|trouser|chino|leg|taper/i, "knees"], [/shoe|sneaker|boot|loafer/i, "feet"],
];
export async function renderCover(dir, script, media, slots = {}) {
  const c = createCanvas(D.W, D.H);
  const g = c.getContext("2d");
  const style = styleOf(script);
  D.useStyle(style, HEAD_FONTS);
  const kit = { ...kitOf(script), headline: "theme", cover: style.cover };
  g.drawImage(D.page(), 0, 0);
  if (style.corners) D.corners(g);
  const has = (t, n = 1) => (script.scenes ?? []).filter((sc) => sc.type === t).length >= n;
  const ok = { versus: has("compare"), beforenow: has("beforeafter"), checklist: has("chapter", 2), grid: has("chapter", 2) || has("build", 2) }[kit.cover] ?? true;
  if (!ok) kit.cover = "type";
  if (kit.cover === "versus" && !media.cover?.()) await COVERS.versus(g, script, media, slots, kit);
  else await COVERS.hero(g, script, media, slots, kit);
  await fs.writeFile(path.join(dir, "cover.png"), c.toBuffer("image/png"));
}

async function coverCallouts(g, script, media) {
  const settings = await (await import("./writer.js")).settings();
  const cover = script.cover ?? {};
  const L = 84;
  const R = D.W - 84;
  const chapters = (script.scenes ?? []).filter((sc) => sc.type === "chapter").slice(0, 4);
  g.fillStyle = D.INK;
  g.font = `24px "Plex Mono Medium"`;
  g.letterSpacing = "5px";
  g.textAlign = "left";
  g.fillText(String(settings.series).toUpperCase(), L, 318);
  g.textAlign = "right";
  g.fillText(chapters.length ? `${String(chapters.length).padStart(2, "0")} CHECKS` : "GUIDE", R, 318);
  g.letterSpacing = "0px";
  g.fillStyle = "rgba(30,30,28,0.55)";
  g.fillRect(L, 340, R - L, 1.5);
  if (cover.line1) D.headline(g, cover.line1, { y: 452, size: 96, italic: true });
  if (cover.line2) {
    let size = 176;
    g.font = `${size}px "Instrument Serif"`;
    while (g.measureText(cover.line2).width > R - L && size > 100) g.font = `${(size -= 6)}px "Instrument Serif"`;
    D.title(g, cover.line2, { y: 452 + size * 0.92, size, italic: false });
  }
  const img = media.outfit(cover.outfit || script.outfits?.[0]?.key);
  const feet = 1588;
  const height = 860;
  const rect = img ? D.standing(g, img, { cx: STAGE.cx, feet, height }) : { x: D.W / 2 - 140, y: feet - height, w: 280, h: height };
  let lastY = { left: 0, right: 0 };
  chapters.forEach((ch, i) => {
    const part = COVER_PART.find(([re]) => re.test(ch.title ?? ""))?.[1] ?? ["shoulders", "waist", "cuff", "knees"][i];
    const side = i % 2 ? "right" : "left";
    const p = partPoint(rect, img, part, side);
    let y = Math.max(p.y - 20, lastY[side] + 150, rect.y + 60);
    lastY[side] = y;
    const lx = side === "left" ? L + 150 : R - 150;
    const fromX = side === "left" ? lx + 20 : lx - 20;
    D.dashed(g, fromX, y - 14, p.x, p.y, { color: "rgba(30,30,28,0.6)", width: 2, dash: [7, 6] });
    g.save();
    g.fillStyle = "#FFFFFF";
    g.strokeStyle = D.INK;
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(p.x, p.y, 9, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
    g.fillStyle = D.INK;
    g.textAlign = side === "left" ? "right" : "left";
    g.font = `52px "Instrument Serif Italic"`;
    g.fillText(String(i + 1).padStart(2, "0"), lx, y);
    g.font = `21px "Plex Mono Medium"`;
    g.letterSpacing = "3px";
    String(ch.title ?? "").toUpperCase().split(/\s*&\s*|\s+and\s+/i).slice(0, 2).forEach((w, k) => g.fillText(k ? `& ${w}` : w, lx, y + 36 + k * 28));
    g.letterSpacing = "0px";
  });
  D.cropCorners(g, { x0: 52, y0: 262, x1: D.W - 52, y1: 1662 });
  g.fillStyle = "rgba(30,30,28,0.55)";
  g.fillRect(L, 1612, R - L, 1.5);
  g.fillStyle = D.INK;
  g.font = `22px "Plex Mono Medium"`;
  g.letterSpacing = "5px";
  g.textAlign = "left";
  g.fillText("SAVE THIS GUIDE", L, 1648);
  g.textAlign = "right";
  g.font = `34px "Instrument Serif Italic"`;
  g.letterSpacing = "0px";
  g.fillText(script.series_title || "", R, 1650);
}

export async function writeDocs(dir, script) {
  const tags = (script.hashtags ?? []).map((h) => (h.startsWith("#") ? h : `#${h}`)).slice(0, 5).join(" ");
  if (script.caption) await fs.writeFile(path.join(dir, "caption.txt"), `${script.caption}\n\n${tags}\n`);
  const lines = (script.lines ?? []).map((l, i) => `${i + 1}. ${l.voiceover}${l.on_screen ? `  _(${l.on_screen})_` : ""}`).join("\n");
  await fs.writeFile(path.join(dir, "script.md"), `# ${script.title}\n\n${script.angle ?? ""}\n\n${lines}\n`);
  if (script.outfits?.length) {
    const specs = imageSpecs(script);
    const md = [
      `# Images for "${script.title}"`,
      "",
      "Make these in Gemini or ChatGPT and upload each one in the reel's Images panel.",
      "Make the FIRST outfit first; for every other outfit, attach that first photo as the reference so it's the same man.",
      "",
      `**The model:** ${script.model?.description ?? ""}`,
      "",
      ...specs.map((s) => `## ${s.kind === "model" ? "Outfit" : "Product"}: ${s.label}\n\n${s.prompt}\n`),
    ].join("\n");
    await fs.writeFile(path.join(dir, "image-prompts.md"), md);
  }
  const slots = mediaSpecs(script);
  if (slots.length) {
    const md = [
      `# Photos & clips for "${script.title}"`,
      "",
      "Upload each one in the reel's Photos & clips panel (or save it as refs/<key>.jpg / .mp4 in this folder).",
      "",
      ...slots.map((m) =>
        [
          `## ${m.key} (${m.source === "ai" ? "AI clip" : `real ${m.kind}`}, scene ${m.scenes.join(", ") || "-"})`,
          "",
          m.what,
          "",
          ...(m.source === "ai" ? [`Make it in Gemini (Video): attach the start photo (Photos & clips panel, "Download start photo"), paste this prompt, vertical 9:16.`, "", "```", aiPrompt(m, script), "```"] : m.links.map((l) => `- ${l.label}: ${l.url}`)),
          "",
        ].join("\n"),
      ),
    ].join("\n");
    await fs.writeFile(path.join(dir, "media-prompts.md"), md);
  }
}
