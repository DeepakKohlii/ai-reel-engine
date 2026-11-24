import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { run } from "../../util.js";
import { partName, partPoint, partSpan } from "./body.js";
import * as D from "./design.js";
import { kitOf } from "./kits.js";
import { HEAD_FONTS, styleOf } from "./style.js";
import { DEVICES } from "./devices/index.js";
import { CLIP_MAP } from "./media.js";

export const FPS = 30;
const { W, H } = D;

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const easeIn = (x) => Math.pow(clamp01(x), 3);
const easeInOut = (x) => ((x = clamp01(x)) < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeBack = (x, c = 1.25) => {
  const t = clamp01(x) - 1;
  return 1 + (c + 1) * t * t * t + c * t * t;
};
const norm = (w) => String(w).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export const STAGE = { cx: W / 2, feet: H * 0.855, height: H * 0.665 };

export function buildTimeline({ plan, narration, media }) {
  const total = narration.duration + 0.7;
  const lineWords = narration.lines.map((ws) => ws ?? []);
  const need = new Map((plan.media ?? []).map((m) => [m.key, m.need ?? "must"]));
  const scenes = plan.scenes.map((s, i) => {
    const missing = s.type === "reference" && s.reference && !media?.media?.(s.reference) && !media?.ref?.(s.reference);
    if (s.motion && media?.media?.(s.motion)?.frame) return { ...s, index: i, type: "motion", stillType: s.type };
    return { ...s, index: i, ...(missing && need.get(s.reference) === "nice" && s.outfit ? { type: "look", wasReference: s.reference } : {}) };
  });
  for (const [i, s] of scenes.entries()) {
    const first = Math.min(...(s.lines?.length ? s.lines : [0]));
    let w = lineWords[first]?.[0];
    let words = (s.lines ?? []).flatMap((l) => lineWords[l] ?? []);
    if (s.start_word) {
      const j = (lineWords[first] ?? []).findIndex((x, k) => k > 0 && norm(x.text) === norm(s.start_word));
      if (j > 0) {
        w = lineWords[first][j];
        words = words.slice(j);
      }
    }
    s.t0 = i === 0 ? 0 : Math.max(0, (w?.start ?? 0) - 0.06);
    s.words = words;
  }
  scenes.forEach((s, i) => {
    s.t1 = scenes[i + 1]?.t0 ?? total;
    s.words = s.words.filter((w) => w.start < s.t1 - 0.02);
  });
  for (let i = scenes.length - 1; i > 0; i--) {
    const s = scenes[i];
    const p = scenes[i - 1];
    if (s.type !== "look" || s.frame_part || p.frame_part || s.enter_force || !["look", "title"].includes(p.type) || s.t1 - s.t0 >= 1.4 || !s.words.length) continue;
    const swap = s.outfit && s.outfit !== p.outfit ? [{ kind: "swap", at_word: s.words[0].text, target: s.outfit }] : [];
    p.overlays = [...(p.overlays ?? []), ...swap, ...(s.overlays ?? []).filter((o) => o.kind !== "zoom")];
    p.words = [...p.words, ...s.words];
    p.lines = [...new Set([...(p.lines ?? []), ...(s.lines ?? [])])];
    p.t1 = s.t1;
    scenes.splice(i, 1);
  }
  scenes.forEach((s, i) => (s.index = i));
  for (const s of scenes) {
    let cursor = 0;
    s.cues = (s.overlays ?? []).map((o, k) => {
      const want = norm(String(o.at_word ?? "").split(/\s+/)[0]);
      let j = want ? s.words.findIndex((w, idx) => idx >= cursor && norm(w.text) === want) : -1;
      if (j < 0 && want) j = s.words.findIndex((w) => norm(w.text) === want);
      if (j >= 0) cursor = j + 1;
      const at = j >= 0 ? s.words[j].start - 0.05 : s.t0 + ((s.t1 - s.t0) * (k + 1)) / ((s.overlays?.length ?? 0) + 2);
      return { ...o, part: o.part ? partName(o.part) : o.part, to_part: o.to_part ? partName(o.to_part, "") : o.to_part, at: Math.max(s.t0 + 0.05, Math.min(at, s.t1 - 0.25)) };
    });
    s.cues = breathe(s);
    for (const sw of s.cues.filter((c) => c.kind === "swap" && c.target)) {
      const card = s.cues.find((c) => c.kind === "swatch" && c.target === sw.target);
      if (card && sw.at < card.at + 0.55) sw.at = Math.min(card.at + 0.55, s.t1 - 0.2);
    }
    s.cues.sort((a, b) => a.at - b.at);
  }
  settle(scenes);
  const cardReel = scenes.some((s) => s.type === "swatches" || s.cues.some((c) => c.kind === "swatch"));
  if (cardReel) for (const s of scenes) Object.assign(s, { no_auto_zoom: true, still: true });
  for (const s of scenes) {
    if (!s.frame_part) continue;
    s.cues = s.cues.filter((c) => c.kind !== "zoom");
    s.cues.unshift({ kind: "zoom", at: s.t0 - 2, part: partName(s.frame_part), side: s.frame_side || "center", auto: true });
    s.keepZoom = true;
    s.no_auto_zoom = true;
  }
  const BUILD_FX = ["sweep", "trace", "texture"];
  const used = new Set(scenes.flatMap((s) => s.cues.filter((c) => FX.has(c.kind) && !c.auto).map((c) => c.kind)));
  let nb = 0;
  for (const s of scenes) {
    if (s.type !== "build") continue;
    const fx = BUILD_FX.filter((f) => !used.has(f))[nb++] ?? null;
    if (!fx) continue;
    const pieces = s.cues.filter((x) => x.kind === "item").map((c) => {
      const t = String(c.text || c.item || "").toLowerCase();
      const part = /sandal|shoe|sneaker|loafer|boot|jutti|mojari/.test(t) ? "feet" : /pant|trouser|jean|chino|pyjama|short|denim/.test(t) ? "thighs" : /kurta|shirt|jacket|tee|t-shirt|sweater|hoodie|blazer|polo|henley|overshirt/.test(t) ? "chest" : "";
      return { c, part };
    }).filter((p) => p.part);
    const targets = fx === "sweep" ? pieces : pieces.slice(0, 1);
    for (const p of targets) s.cues.push({ kind: fx, at: p.c.at + 0.1, part: p.part, auto: true });
    s.cues.sort((a, b) => a.at - b.at);
  }
  rhythm(scenes);
  follow(scenes);
  scenes.forEach((s, i) => {
    const n = scenes[i + 1];
    if (!n || n.type !== "look" || n.outfit !== endOutfit(s)) return;
    const last = s.cues.filter((c) => c.kind === "zoom").at(-1);
    const first = n.cues.find((c) => c.kind === "zoom");
    if (last && first && area(last.part) === area(first.part) && first.at - n.t0 < 1.6) {
      s.keepZoom = true;
      first.at = n.t0 - 0.7;
      first.part = last.part;
      n.zoomedIn = true;
    }
  });
  plan = { ...plan, subject: plan.subject || guessSubject(plan) };
  const style = styleOf(plan);
  const kit = { ...kitOf(plan), background: "custom", chapter: style.chapter, index: style.index, headline: "theme", cover: style.cover, transitions: style.transitions, tempo: style.tempo };
  let section = null;
  let count = 0;
  for (const s of scenes) {
    if (s.type === "chapter") section = { n: s.number || ++count, title: s.title ?? "" };
    if (s.type === "outro") section = null;
    s.section = section;
  }
  flow(scenes, { ...plan, kit });
  linger(scenes);
  const words = scenes.flatMap((s) => s.words.map((w) => ({ ...w, dark: ["chapter", "reference"].includes(s.type) })));
  const chunks = [];
  for (const [i, w] of words.entries()) {
    const cur = chunks.at(-1);
    const prev = words[i - 1];
    const join = cur && cur.words.length < 2 && !/[,.?!;:]$/.test(prev.text) && w.start - prev.end < 0.3;
    if (join) cur.words.push(w);
    else chunks.push({ words: [w] });
  }
  chunks.forEach((c, i) => {
    c.text = c.words.map((w) => w.text).join(" ");
    c.start = c.words[0].start - 0.03;
    c.end = chunks[i + 1] ? chunks[i + 1].words[0].start - 0.03 : c.words.at(-1).end + 0.5;
    c.dark = c.words[0].dark;
  });
  const stageLeft = scenes.some((s) => s.type === "swatches" || s.cues.some((c) => c.kind === "swatch"));
  return { total, look: kit.background, kit, style, kitKey: plan.kit ?? "", series: plan.series ?? "", subject: plan.subject, scenes, chunks, media, outfits: plan.outfits ?? [], stageLeft };
}

function breathe(s) {
  if (["concept", "palette"].includes(s.type)) return [...s.cues].sort((a, b) => a.at - b.at);
  const kept = [];
  for (const c of [...s.cues].sort((a, b) => a.at - b.at)) {
    const last = kept.filter((k) => !["swap", "zoom", "flash"].includes(k.kind)).at(-1);
    if (c.kind === "dot" && kept.some((k) => k.kind === "pill" && Math.abs(k.at - c.at) < 0.7)) continue;
    if (!["swap", "zoom", "flash"].includes(c.kind) && last && c.at - last.at < 0.55) {
      const at = last.at + 0.55;
      if (at > s.t1 - 0.35) continue;
      c.at = at;
    }
    kept.push(c);
  }
  return kept;
}

const LASTS = new Set(["note", "dot", "hguide", "vguide", "box", "shift", "pill", "photo", "product", "scale", "device", "isolate", "lift", "trace", "recolour", "texture"]);
function linger(scenes) {
  scenes.forEach((s, i) => {
    const next = scenes[i + 1];
    const short = ["concept", "compare", "palette"].includes(s.type) ? [] : s.cues.filter((c) => LASTS.has(c.kind) && !c.carried && s.t1 - c.at < 1.2);
    if (!short.length) return;
    s.cues = s.cues.filter((c) => !short.includes(c));
    if (next?.enter === "hold" && !next.cues.some((c) => c.kind === "swap" && c.at - next.t0 < 1)) {
      s.cues.push(...short);
      next.cues.unshift(...short.map((c) => ({ ...c, carried: true, until: c.at + 1.6 })));
    }
  });
}

const PART_WORDS = [
  [/^(collar|collars|neck|neckline)$/, "collar"],
  [/^shoulders?$/, "shoulders"],
  [/^(sleeves?|cuffs?|wrists?|elbows?)$/, "cuff"],
  [/^(knees?|hem|hems|length|longer|long|short|shorter|calf)$/, "thighs"],
  [/^(pants|trousers|jeans|pyjamas?|chinos|churidar)$/, "thighs"],
  [/^(waist|waistband|belt)$/, "waist"],
  [/^(fabric|cotton|linen|polyester|silk|print|prints|breathes?|sweat|buttons?|chest|texture|weave|embroidery)$/, "chest"],
];
const UPPER = new Set(["head", "face", "hair", "neck", "collar", "shoulders", "chest", "sleeve"]);
const LIVELY = new Set(["zoom", "device", "photo", "swatch", "product", "scale", "box", "item", "isolate", "sweep", "lift", "trace", "recolour", "texture"]);
function rhythm(scenes) {
  let run = 0;
  for (const s of scenes) {
    const model = s.type === "look" || s.type === "title";
    if (!model || s.no_auto_zoom || s.cues.some((c) => LIVELY.has(c.kind))) {
      run = 0;
      continue;
    }
    const dur = s.t1 - s.t0;
    if (s.type === "look" && run + dur > 3.5 && dur >= 1.8 && s.words.length) {
      let hit = null;
      for (const w of s.words) {
        const part = PART_WORDS.find(([re]) => re.test(norm(w.text)))?.[1];
        if (part) {
          hit = { w, part };
          break;
        }
      }
      const w = hit?.w ?? s.words[Math.min(1, s.words.length - 1)];
      const part = hit?.part ?? "chest";
      const at = Math.max(s.t0 + 0.15, Math.min(w.start - 0.05, s.t1 - 1.7));
      s.cues.push({ kind: "zoom", at, part, side: part === "cuff" ? "right" : "center", auto: true });
      s.cues.sort((a, b) => a.at - b.at);
      run = 0;
    } else run += dur;
  }
}

function groupArea(tl, key) {
  const p = groupPart(tl, key);
  return p === "ankles" ? "feet" : p === "thighs" ? "legs" : "chest";
}

function groupPart(tl, key) {
  const said = String(tl.outfits?.find((o) => o.key === key)?.changes ?? "").toLowerCase();
  if (/\b(shoe|sneaker|loafer|boot|sandal|derby)/.test(said)) return "ankles";
  if (/\b(trouser|pant|jean|chino|short|pyjama)/.test(said)) return "thighs";
  if (/\b(shirt|tee|polo|kurta|top|sweater|knit|jacket|blazer|layer|coat)/.test(said)) return "chest";
  return null;
}

const SMALL = new Set(["collar", "cuff"]);
const AREA = { sleeve: "arm", cuff: "arm", hands: "arm", collar: "neck", neck: "neck", face: "head", head: "head", hair: "head", feet: "feet", ankles: "feet", hem: "feet", knees: "legs", thighs: "legs", waist: "waist", belt: "waist", hips: "waist", shirt_hem: "waist", chest: "chest", shoulders: "chest" };
const area = (part) => AREA[part] ?? part;
const PIECE_ROWS = {
  chest: (b) => [Math.max(0, b.collar - 0.03), b.hem + 0.04],
  neck: (b) => [Math.max(0, b.collar - 0.03), b.hem + 0.04],
  arm: (b) => [Math.max(0, b.collar - 0.03), b.hem + 0.04],
  legs: (b) => [b.hem - 0.02, 1],
  feet: (b) => [b.feet - 0.04, 1],
};
function follow(scenes) {
  for (const s of scenes) {
    if (s.type !== "look" || s.no_auto_zoom || s.t1 - s.t0 < 1.6) continue;
    const asks = [
      ...s.words.map((w) => ({ at: w.start, part: PART_WORDS.find(([re]) => re.test(norm(w.text)))?.[1] })).filter((x) => x.part),
      ...s.cues.filter((c) => ["note", "dot", "device", "shift", "box"].includes(c.kind) && c.part).map((c) => ({ at: c.at + 0.05, part: c.part })),
    ].sort((a, b) => a.at - b.at);
    for (const ask of asks) {
      const cur = s.cues.filter((c) => c.kind === "zoom" && c.at <= ask.at).at(-1);
      const at = Math.max(s.t0 + 0.1, ask.at - 0.15);
      const move = cur ? area(cur.part) !== area(ask.part) && ask.at - cur.at >= 0.9 && s.t1 - ask.at >= 0.8 : SMALL.has(ask.part) && s.t1 - ask.at >= 1.3 && !s.cues.some((c) => c.kind === "zoom");
      if (move) {
        s.cues.push({ kind: "zoom", at, part: ask.part, side: area(ask.part) === "arm" ? "right" : "center", auto: true });
        s.cues.sort((a, b) => a.at - b.at);
      }
    }
  }
}

function settle(scenes) {
  const changes = [];
  scenes.forEach((s, i) => {
    if (i && s.outfit && s.outfit !== endOutfit(scenes[i - 1])) changes.push(s.t0);
    for (const c of s.cues) if (c.kind === "swap") changes.push(c.at);
  });
  changes.sort((a, b) => a - b);
  for (const s of scenes) {
    const sw = s.cues.find((c) => c.kind === "swap" && !PIECE_ROWS[area(c.part)] && (changes.find((x) => x > c.at + 0.01) ?? Infinity) - c.at < 2.5);
    if (sw) s.cues = s.cues.filter((c) => c.at < sw.at);
    const swaps = s.cues.filter((c) => c.kind === "swap");
    s.cues = s.cues.filter((c) => c.kind === "swap" || c.kind === "zoom" || c.kind === "swatch" || !swaps.some((w) => w.at > c.at && w.at - c.at < 0.8));
    for (const c of s.cues) {
      const w = swaps.filter((x) => x.at <= c.at).at(-1);
      if (w && c.kind !== "swap" && c.at - w.at < 0.5) c.at = Math.min(w.at + 0.5, s.t1 - 0.3);
    }
  }
}

const endOutfit = (s) => s.cues?.filter((c) => c.kind === "swap" && c.target).at(-1)?.target ?? s.outfit;

export function guessSubject(plan) {
  const text = `${plan.topic ?? ""} ${plan.title ?? ""}`.toLowerCase();
  if (/\b(shirts?|tees?|t-shirts?|polos?|jackets?|blazers?|collars?|sleeves?|kurtas?|sweaters?|hoodies?|overshirts?|layering|necklines?)\b/.test(text)) return "top";
  return "full";
}

const LOW_PARTS = new Set(["knees", "hem", "ankles", "feet"]);
const FRAMING = { top: 1.3, full: 1 };

function flow(scenes, plan) {
  let turn = 0;
  const ROTATION = plan.kit?.transitions?.length ? plan.kit.transitions : ["xfade", "wipe", "cut"];
  scenes.forEach((s, i) => {
    const p = scenes[i - 1];
    const lows = (s.cues ?? []).some((c) => LOW_PARTS.has(c.part) && ["note", "dot", "zoom", "vguide", "hguide"].includes(c.kind));
    const cards = scenes.some((x) => x.type === "swatches" || (x.overlays ?? []).some((o) => o.kind === "swatch"));
    s.framing = !cards && ["look", "title"].includes(s.type) && plan.subject === "top" && !lows ? "top" : "full";
    s.exit = "";
    if (s.enter_force) s.enter = s.enter_force;
    else if (!p) s.enter = "cut";
    else if (s.type === "chapter") {
      s.enter = "blurin";
    } else if (p.type === "chapter") s.enter = ["pill", "check"].includes(plan.kit?.chapter) ? "pullback" : "xfade";
    else if (s.type === "look" && ["look", "title"].includes(p.type) && endOutfit(p) === s.outfit) s.enter = "hold";
    else if (s.type === "index" && s.start_word) s.enter = "xfade";
    else if (s.type === "compare" && ["look", "motion"].includes(p.type) && [s.outfit, s.outfit2].includes(endOutfit(p))) s.enter = "cut";
    else if (["outro", "compare"].includes(s.type)) s.enter = "xfade";
    else if (s.type === "reference") s.enter = "cut";
    else if (!["build", "index", "outro", "compare", "beforeafter", "product", "swatches"].includes(s.type)) {
      const samePlace = ["look", "title", "swatches"].includes(p.type) && ["look", "title", "swatches"].includes(s.type);
      s.enter = !samePlace || p.enter === "xfade" ? "cut" : "xfade";
    } else {
      s.enter = ROTATION[turn++ % ROTATION.length];
      if (s.enter === p.enter && s.enter !== "cut" && ROTATION.length > 1) s.enter = ROTATION[turn++ % ROTATION.length];
    }
    s.from = p ? { type: p.type, framing: p.framing ?? "full", outfit: p.outfit, focus: p.focus } : null;
  });
  scenes.forEach((s, i) => {
    const n = scenes[i + 1];
    s.zoomBack = !!n && ((["hold", "xfade"].includes(n.enter) && ["look", "title"].includes(n.type)) || (n.type === "compare" && [n.outfit, n.outfit2].includes(endOutfit(s))));
  });
  scenes.forEach((s, i) => (s.runT0 = s.enter === "hold" ? scenes[i - 1].runT0 : s.t0));
}

export function camera(s, t, m) {
  const anchor = { x: m.rect.x + m.rect.w / 2, y: m.rect.y };
  let z0 = FRAMING[s.framing] ?? 1;
  if (s.enter === "hold" && s.from && s.from.framing !== s.framing) {
    const a = FRAMING[s.from.framing] ?? 1;
    z0 = a + (z0 - a) * easeInOut((t - s.t0) / 0.6);
  }
  if (!s.still) z0 *= 1 + Math.min(0.035, 0.005 * Math.max(0, t - (s.runT0 ?? s.t0)));
  const view = { f: anchor, sx: anchor.x, sy: anchor.y, z: z0, k: 0, zoom: null };
  const z = zoomState(s, t);
  let f = anchor;
  if (z) {
    f = pointOn(m, z.cue.part || "chest", z.cue.side || "center");
    if (z.prev && z.blend < 1) {
      const p = pointOn(m, z.prev.part || "chest", z.prev.side || "center");
      f = { x: p.x + (f.x - p.x) * z.blend, y: p.y + (f.y - p.y) * z.blend };
    }
  }
  const bx = anchor.x + (f.x - anchor.x) * z0;
  const by = anchor.y + (f.y - anchor.y) * z0;
  const k = z ? z.k : 0;
  const zz = z0 * (1 + (ZOOM[s.framing] ?? 0.95) * k);
  view.f = f;
  view.sx = bx + (W / 2 - bx) * k;
  view.sy = by + (H * 0.46 - by) * k;
  view.z = zz;
  view.k = k;
  view.zoom = z;
  view.map = (p) => ({ x: view.sx + (p.x - f.x) * view.z, y: view.sy + (p.y - f.y) * view.z });
  return view;
}
const ZOOM = { top: 0.7, full: 0.95 };

export function zoomTimes(s, c) {
  const inEnd = c.at + 0.6;
  let outStart = Math.max(inEnd + 1.1, s.t1 - 0.6);
  let outDur = 0.55;
  if (outStart + 0.3 > s.t1) {
    outStart = Math.max(inEnd + 0.25, s.t1 - 0.5);
    outDur = Math.max(0.2, s.t1 - outStart - 0.02);
  }
  const stays = s.keepZoom || s.zoomBack === false || outStart + 0.2 > s.t1;
  return { inEnd, outStart, outDur, stays };
}

function zoomState(s, t) {
  const zs = (s.cues ?? []).filter((x) => x.kind === "zoom").sort((a, b) => a.at - b.at);
  let i = -1;
  for (let j = 0; j < zs.length; j++) if (zs[j].at <= t) i = j;
  if (i < 0) return null;
  const c = zs[i];
  const prev = zs[i - 1] ?? null;
  const last = zs.at(-1);
  const zt = zoomTimes(s, last);
  const blend = easeInOut((t - c.at) / 0.6);
  const kout = c === last && !zt.stays ? easeInOut((t - zt.outStart) / zt.outDur) : 0;
  return { cue: c, prev, blend, kin: prev ? 1 : blend, k: (prev ? 1 : blend) * (1 - kout), kout, ...zt };
}

export class Renderer {
  constructor(tl) {
    this.tl = tl;
    this.canvas = createCanvas(W, H);
    this.g = this.canvas.getContext("2d");
    this.cache = new Map();
    this.pool = [createCanvas(W, H), createCanvas(W, H), createCanvas(W, H)];
    D.useStyle(tl.style, HEAD_FONTS);
    Object.assign(STAGE, tl.stageLeft ? { cx: W * 0.37, feet: H * 0.885, height: H * 0.74 } : { cx: W / 2, feet: H * 0.855, height: H * 0.665 });
    D.THEME.plate = tl.media?.plate?.() ?? null;
    if (D.THEME.plate) {
      const c = createCanvas(8, 8);
      const cg = c.getContext("2d");
      cg.drawImage(D.THEME.plate, 0, 0, 8, 8);
      const p = cg.getImageData(0, 0, 8, 8).data;
      const avg = [0, 1, 2].map((k) => Math.round(Array.from({ length: 16 }, (_, i) => p[(i + 8) * 4 + k]).reduce((a, b) => a + b) / 16));
      D.THEME.page = `#${avg.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
      D.THEME.corners = false;
    }
    for (const c of [this.canvas, ...this.pool]) c.getContext("2d").imageSmoothingQuality = "high";
  }

  img(kind, key) {
    return key ? this.tl.media[kind]?.(key) ?? null : null;
  }

  frame(t) {
    const { g, tl } = this;
    const i = Math.max(0, tl.scenes.findIndex((x) => t >= x.t0 && t < x.t1));
    const s = tl.scenes[t >= tl.scenes.at(-1).t1 ? tl.scenes.length - 1 : i];
    this.composite(g, s, t, 0);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.subtitle(g, t, s);
    g.restore();
    return this.canvas;
  }

  composite(g, s, t, depth) {
    const lt = t - s.t0;
    const p = this.tl.scenes[s.index - 1];
    const enter = depth === 0 && p ? s.enter : "cut";
    const T = ({ xfade: 0.45, wipe: 0.75, blurin: 0.45, pullback: 0.6, slide: 0.5 }[enter] ?? 0) * (this.tl.kit.tempo === "crisp" ? 0.8 : 1);
    if (enter === "pullback" && lt < T) {
      const own = this.pool[depth * 2];
      this.raw(own.getContext("2d"), s, t);
      const k = easeOut(lt / T);
      reset(g);
      g.fillStyle = "#D9D8D5";
      g.fillRect(0, 0, W, H);
      g.filter = k < 1 ? `blur(${(1 - k) * 18}px)` : "none";
      const z = 1 + 0.14 * (1 - k);
      g.drawImage(own, W / 2 - (W * z) / 2, H * 0.4 - H * 0.4 * z, W * z, H * z);
      g.filter = "none";
      const fade = 1 - clamp01(lt / 0.32);
      if (fade > 0) {
        const prev = this.pool[depth * 2 + 1];
        this.composite(prev.getContext("2d"), p, t, depth + 1);
        g.globalAlpha = fade;
        g.drawImage(prev, 0, 0);
        g.globalAlpha = 1;
      }
      return;
    }
    this.raw(g, s, t);
    if (lt >= T || !p) return;
    const prev = this.pool[depth * 2 + 1];
    this.composite(prev.getContext("2d"), p, t, depth + 1);
    reset(g);
    if (enter === "slide") {
      const e = easeInOut(lt / T);
      const own = this.pool[2];
      const og = own.getContext("2d");
      reset(og);
      og.drawImage(g.canvas, 0, 0);
      reset(g);
      g.drawImage(prev, -W * e, 0);
      g.drawImage(own, W * (1 - e), 0);
    } else if (enter === "wipe") {
      const edge = -60 + (W + 120) * easeInOut(lt / T);
      g.save();
      g.beginPath();
      g.rect(edge, 0, W - edge, H);
      g.clip();
      g.drawImage(prev, 0, 0);
      g.restore();
      for (let b = 0; b < 4; b++) {
        g.save();
        g.globalAlpha = 1 - (b + 1) / 5;
        g.beginPath();
        g.rect(edge - (b + 1) * 12, 0, 12, H);
        g.clip();
        g.drawImage(prev, 0, 0);
        g.restore();
      }
      g.fillStyle = "rgba(255,255,255,0.7)";
      g.fillRect(edge - 2, 0, 3, H);
    } else {
      g.globalAlpha = 1 - easeInOut(lt / T);
      g.drawImage(prev, 0, 0);
      g.globalAlpha = 1;
    }
  }

  raw(g, s, t) {
    reset(g);
    g.save();
    (SCENES[s.type] ?? SCENES.look).call(this, g, s, t, t - s.t0);
    g.restore();
  }

  outfitAt(s, t, base = s.outfit, side = null) {
    let cur = base;
    let prev = null;
    let at = -1;
    let cue = null;
    for (const c of s.cues) {
      if (c.kind !== "swap" || c.at > t || (side && (c.side ?? "center") !== side)) continue;
      prev = cur;
      cur = c.target || cur;
      at = c.at;
      cue = c;
    }
    const part = cue && PIECE_ROWS[area(cue.part)] ? area(cue.part) : null;
    const locked = prev && this.img("outfit", cur)?.__lock && this.img("outfit", cur).__lock === this.img("outfit", prev)?.__lock;
    if (cue?.reveal === "slider") return { cur, prev, k: at < 0 ? 1 : clamp01((t - at) / 1.1), part, reveal: "slider" };
    return { cur, prev, k: at < 0 ? 1 : part || locked ? clamp01((t - at) / (locked ? 1.0 : 0.9)) : easeInOut((t - at) / 0.35), part };
  }

  dotReveal(g, pimg, img, opts, which, k, alpha) {
    if (which === "legs" || which === "waist") return this.lineReveal(g, pimg, img, opts, which, k, alpha);
    if (which !== "chest" && which !== "neck" && which !== "arm") return this.columnReveal(g, pimg, img, opts, which, k, alpha);
    const rect = D.standing(g, img, { ...opts, alpha, only: "shadow" });
    const flip = easeInOut((k - 0.4) / 0.13);
    D.standing(g, img, { ...opts, alpha, shadow: false });
    if (flip < 1) D.standing(g, pimg, { ...opts, alpha: alpha * (1 - flip), shadow: false });
    if (k >= 1) return rect;
    const mk = which === "feet" ? "feet" : which === "legs" ? "legs" : "chest";
    const mA = garmentMask(pimg, mk);
    const mB = garmentMask(img, mk);
    const [a0, a1] = maskRows(mA);
    const [b0, b1] = maskRows(mB);
    const y0 = rect.y + rect.h * Math.min(a0, b0) - 10;
    const y1 = rect.y + rect.h * Math.max(a1, b1) + 10;
    const mm = (this._dotsM ??= createCanvas(W, H));
    const mg = mm.getContext("2d");
    reset(mg);
    mg.clearRect(0, 0, W, H);
    mg.drawImage(mA, rect.x, rect.y, rect.w, rect.h);
    mg.drawImage(mB, rect.x, rect.y, rect.w, rect.h);
    const veil = Math.sin(clamp01((k - 0.12) / 0.6) * Math.PI);
    if (veil > 0.01) {
      this._veil ??= createCanvas(W, H);
      const vg = this._veil.getContext("2d");
      reset(vg);
      vg.clearRect(0, 0, W, H);
      vg.fillStyle = "#FFFFFF";
      vg.fillRect(0, 0, W, H);
      vg.globalCompositeOperation = "destination-in";
      vg.drawImage(mm, 0, 0);
      reset(vg);
      g.save();
      g.globalAlpha = 0.16 * veil * alpha;
      g.drawImage(this._veil, 0, 0);
      g.restore();
    }
    const cw = 15;
    const ch = 18;
    const seed = (n) => {
      const v = Math.sin(n * 12.9898) * 43758.5453;
      return v - Math.floor(v);
    };
    const env = clamp01(k / 0.25) * (1 - clamp01((k - 0.62) / 0.36));
    this._dots ??= createCanvas(W, H);
    const dg = this._dots.getContext("2d");
    reset(dg);
    dg.clearRect(0, 0, W, H);
    dg.font = `${ch - 4}px "Plex Mono"`;
    dg.textAlign = "center";
    dg.textBaseline = "middle";
    dg.fillStyle = "#FFFFFF";
    const frame = Math.floor(k * 24);
    for (let col = 0, x0 = rect.x - cw; x0 < rect.x + rect.w + cw; col++, x0 += cw) {
      if (seed(col * 3.1) < 0.15) continue;
      const len = 6 + Math.floor(seed(col * 7.3) * 10);
      const span = y1 - y0 + len * ch;
      const head = y0 + ((seed(col * 1.7) + k * (0.9 + seed(col * 5.1) * 0.6)) % 1) * span;
      for (let r = 0; r < len; r++) {
        const y = head - r * ch;
        if (y < y0 || y > y1) continue;
        dg.globalAlpha = env * (1 - r / len) * (r === 0 ? 1 : 0.7);
        dg.fillText(seed(col * 13 + r * 17 + frame) > 0.5 ? "1" : "0", x0 + cw / 2, y);
      }
    }
    dg.globalAlpha = 1;
    dg.globalCompositeOperation = "destination-in";
    dg.drawImage(mm, 0, 0);
    reset(dg);
    g.save();
    g.globalAlpha = 0.9 * alpha;
    g.drawImage(this._dots, 0, 0);
    g.restore();
    return rect;
  }

  lineReveal(g, pimg, img, opts, which, k, alpha) {
    const rect = D.standing(g, img, { ...opts, alpha, only: "shadow" });
    D.standing(g, img, { ...opts, alpha, shadow: false });
    if (k >= 1) return rect;
    const mA = garmentMask(pimg, "legs");
    const mB = garmentMask(img, "legs");
    const [a0, a1] = maskRows(mA);
    const [b0, b1] = maskRows(mB);
    const y0 = rect.y + rect.h * Math.min(a0, b0) - 6;
    const y1 = rect.y + rect.h * Math.max(a1, b1) + 6;
    const edge = y0 + (y1 - y0) * easeInOut(k / 0.95);
    const mm = (this._dotsM ??= createCanvas(W, H));
    const mg = mm.getContext("2d");
    reset(mg);
    mg.clearRect(0, 0, W, H);
    for (let a = 0; a < 10; a++) {
      const ox = Math.cos((a / 10) * Math.PI * 2) * 5;
      const oy = Math.sin((a / 10) * Math.PI * 2) * 5;
      mg.drawImage(mA, rect.x + ox, rect.y + oy, rect.w, rect.h);
      mg.drawImage(mB, rect.x + ox, rect.y + oy, rect.w, rect.h);
    }
    this._rev ??= createCanvas(W, H);
    const rg = this._rev.getContext("2d");
    reset(rg);
    rg.clearRect(0, 0, W, H);
    D.standing(rg, pimg, { ...opts, shadow: false });
    rg.globalCompositeOperation = "destination-in";
    rg.drawImage(mm, 0, 0);
    rg.globalCompositeOperation = "destination-out";
    const soft = rg.createLinearGradient(0, edge - 6, 0, edge + 6);
    soft.addColorStop(0, "rgba(0,0,0,1)");
    soft.addColorStop(1, "rgba(0,0,0,0)");
    rg.fillStyle = "#000";
    rg.fillRect(0, 0, W, Math.max(0, edge - 6));
    rg.fillStyle = soft;
    rg.fillRect(0, edge - 6, W, 12);
    reset(rg);
    g.save();
    g.globalAlpha = alpha;
    g.drawImage(this._rev, 0, 0);
    g.restore();
    this._dots ??= createCanvas(W, H);
    const dg = this._dots.getContext("2d");
    reset(dg);
    dg.clearRect(0, 0, W, H);
    const lg = dg.createLinearGradient(0, edge - 14, 0, edge + 14);
    lg.addColorStop(0, "rgba(255,255,255,0)");
    lg.addColorStop(0.5, "rgba(255,255,255,0.95)");
    lg.addColorStop(1, "rgba(255,255,255,0)");
    dg.fillStyle = lg;
    dg.fillRect(0, edge - 14, W, 28);
    dg.globalCompositeOperation = "destination-in";
    dg.drawImage(mm, 0, 0);
    reset(dg);
    g.save();
    g.globalAlpha = 0.7 * alpha * Math.sin(Math.min(1, k / 0.95) * Math.PI) ** 0.4;
    g.drawImage(this._dots, 0, 0);
    g.restore();
    return rect;
  }

  columnReveal(g, pimg, img, opts, which, k, alpha) {
    const rect = D.standing(g, img, { ...opts, alpha, only: "shadow" });
    D.standing(g, img, { ...opts, alpha, shadow: false });
    if (k >= 1) return rect;
    const mk = which === "feet" ? "feet" : which === "legs" ? "legs" : "chest";
    const mA = garmentMask(pimg, mk);
    const mB = garmentMask(img, mk);
    const [a0, a1] = maskRows(mA);
    const [b0, b1] = maskRows(mB);
    const y0 = rect.y + rect.h * Math.min(a0, b0) - 10;
    const y1 = rect.y + rect.h * Math.max(a1, b1) + 10;
    const cw = 17;
    const ch = 21;
    const trail = 9 * ch;
    const seed = (n) => {
      const v = Math.sin(n * 12.9898) * 43758.5453;
      return v - Math.floor(v);
    };
    const cols = [];
    for (let col = 0, x0 = rect.x - cw; x0 < rect.x + rect.w + cw; col++, x0 += cw) {
      const p = clamp01((k - seed(col * 3.7 + 1) * 0.28) / 0.5);
      cols.push({ x0, col, p, head: y0 + (y1 - y0 + trail) * easeInOut(p) });
    }
    const mm = (this._dotsM ??= createCanvas(W, H));
    const mg = mm.getContext("2d");
    reset(mg);
    mg.clearRect(0, 0, W, H);
    for (let a = 0; a < 10; a++) {
      const ox = Math.cos((a / 10) * Math.PI * 2) * 5;
      const oy = Math.sin((a / 10) * Math.PI * 2) * 5;
      mg.drawImage(mA, rect.x + ox, rect.y + oy, rect.w, rect.h);
      mg.drawImage(mB, rect.x + ox, rect.y + oy, rect.w, rect.h);
    }
    this._rev ??= createCanvas(W, H);
    const rg = this._rev.getContext("2d");
    reset(rg);
    rg.clearRect(0, 0, W, H);
    D.standing(rg, pimg, { ...opts, shadow: false });
    rg.globalCompositeOperation = "destination-in";
    rg.drawImage(mm, 0, 0);
    this._cut ??= createCanvas(W, H);
    const cg = this._cut.getContext("2d");
    reset(cg);
    cg.clearRect(0, 0, W, H);
    cg.filter = "blur(3px)";
    cg.fillStyle = "#000";
    for (const c of cols) if (c.p > 0) cg.fillRect(Math.floor(c.x0) - 7, y0 - 40, cw + 14, Math.max(0, c.head - ch * 1.5 - y0 + 40));
    if (cols.every((c) => c.p >= 1)) cg.fillRect(0, 0, W, H);
    cg.filter = "none";
    rg.globalCompositeOperation = "destination-out";
    rg.drawImage(this._cut, 0, 0);
    reset(rg);
    g.save();
    g.globalAlpha = alpha;
    g.drawImage(this._rev, 0, 0);
    g.restore();
    this._dots ??= createCanvas(W, H);
    const dg = this._dots.getContext("2d");
    reset(dg);
    dg.clearRect(0, 0, W, H);
    dg.font = `${ch - 4}px "Plex Mono"`;
    dg.textAlign = "center";
    dg.textBaseline = "middle";
    dg.fillStyle = "#FFFFFF";
    const frame = Math.floor(k * 24);
    for (const c of cols) {
      if (c.p <= 0 || c.p >= 1) continue;
      for (let r = 0; r < 12; r++) {
        const y = c.head - r * ch;
        if (y < y0 || y > y1) continue;
        dg.globalAlpha = (1 - r / 12) * (r === 0 ? 1 : 0.8);
        dg.fillText(seed(c.col * 13 + r * 17 + frame) > 0.5 ? "1" : "0", c.x0 + cw / 2, y);
      }
    }
    dg.globalAlpha = 1;
    dg.globalCompositeOperation = "destination-in";
    dg.drawImage(mm, 0, 0);
    reset(dg);
    g.save();
    g.globalAlpha = 0.85 * alpha;
    g.drawImage(this._dots, 0, 0);
    g.restore();
    return rect;
  }

  model(g, s, t, { cx = STAGE.cx, feet = STAGE.feet, height = STAGE.height, side = null, base = s.outfit, alpha = 1, dim = 0, still = false } = {}) {
    const { cur, prev, k, part, reveal } = this.outfitAt(s, t, base, side);
    const img = this.img("outfit", cur);
    const drift = still || this.tl.stageLeft ? 1 : 1 + 0.012 * clamp01((t - s.t0) / Math.max(s.t1 - s.t0, 1));
    const opts = { cx, feet, height: height * drift };
    if (dim) g.filter = `saturate(${1 - 0.5 * dim}) brightness(${1 + 0.12 * dim})`;
    let rect = null;
    const pimgL = prev ? this.img("outfit", prev) : null;
    if (reveal === "slider" && prev && k < 1 && img && pimgL) {
      const a = alpha * (1 - dim * 0.45);
      rect = D.standing(g, pimgL, { ...opts, alpha: a, only: "shadow" });
      const e = easeInOut(k);
      const x0 = rect.x - 60;
      const edge = x0 + (rect.w + 120) * e;
      for (const [im, clip] of [[pimgL, [edge, W]], [img, [0, edge]]]) {
        g.save();
        g.beginPath();
        g.rect(clip[0], 0, clip[1] - clip[0], H);
        g.clip();
        D.standing(g, im, { ...opts, alpha: a, shadow: false });
        g.restore();
      }
      if (e > 0 && e < 1) {
        g.save();
        g.fillStyle = "rgba(255,255,255,0.9)";
        g.shadowColor = "rgba(0,0,0,0.18)";
        g.shadowBlur = 10;
        g.fillRect(edge - 1.5, rect.y - 30, 3, rect.h + 60);
        g.restore();
      }
    } else if (prev && k < 1 && img && pimgL && img.__lock && img.__lock === pimgL.__lock && img.width === pimgL.width && img.height === pimgL.height) {
      rect = this.dotReveal(g, pimgL, img, opts, part ?? groupArea(this.tl, cur), clamp01(k), alpha * (1 - dim * 0.45));
    } else if (prev && k < 1 && part && img && this.img("outfit", prev)) {
      const pimg = this.img("outfit", prev);
      const a = alpha * (1 - dim * 0.45);
      const k2 = 0;
      const x = k >= 0.62 ? 1 : 0;
      rect = D.standing(g, pimg, { ...opts, alpha: a });
      if (x > 0) D.standing(g, img, { ...opts, alpha: a * x, shadow: false });
      const b1 = Math.sin(clamp01(k / 0.36) * Math.PI) * 0.22;
      const b2 = Math.sin(clamp01((k - 0.36) / 0.64) * Math.PI) * 0.34;
      const glow = Math.max(0, b1) + Math.max(0, b2);
      if (glow > 0.01) {
        const which = part === "legs" ? "legs" : part === "feet" ? "feet" : "chest";
        if (!this._swapM) this._swapM = createCanvas(W, H);
        const M = this._swapM.getContext("2d");
        reset(M);
        M.clearRect(0, 0, W, H);
        M.filter = "blur(14px)";
        for (const im of [pimg, img]) M.drawImage(garmentMask(im, which), rect.x, rect.y, rect.w, rect.h);
        M.filter = "none";
        M.globalCompositeOperation = "source-in";
        M.fillStyle = "#FFFDF8";
        M.fillRect(0, 0, W, H);
        reset(M);
        g.save();
        g.globalAlpha = Math.min(0.4, glow) * a;
        g.drawImage(this._swapM, 0, 0);
        g.restore();
      }
      if (k2 > 0) D.standing(g, img, { ...opts, alpha: a * k2, shadow: false });
    } else if (prev && k < 1) {
      const pimg = this.img("outfit", prev);
      if (pimg) D.standing(g, pimg, { ...opts, alpha: alpha * (1 - dim * 0.45), shadow: true });
      if (img) rect = D.standing(g, img, { ...opts, alpha: alpha * k * (1 - dim * 0.45), shadow: false });
    } else if (img) {
      const iso = g !== PROBE && live(s, t).filter((c) => c.kind === "isolate").at(-1);
      if (iso) rect = this.isolated(g, img, opts, iso, t, alpha);
      else rect = D.standing(g, img, { ...opts, alpha: alpha * (1 - dim * 0.45) });
      if (g !== PROBE) this.garmentFx(g, s, t, img, rect, opts);
    } else rect = placeholder(g, opts, cur);
    g.filter = "none";
    return { rect: rect ?? { x: cx - 150, y: feet - height, w: 300, h: height }, img };
  }

  garmentFx(g, s, t, img, rect, opts) {
    for (const c of s.cues) {
      if (!FX.has(c.kind) || t < c.at) continue;
      const dt = t - c.at;
      const which = area(c.part || "chest");
      const mask = garmentMask(img, which);
      const next = s.cues.find((x) => x.at > c.at + 0.4 && x.kind !== "zoom" && x !== c);
      const end = c.kind === "recolour" ? (next ? next.at : s.t1) : c.at + (c.kind === "sweep" ? 1.6 : 2.2);
      if (c.kind === "flash") {
        if (dt > 1.0) continue;
        const pulse = Math.abs(Math.sin((dt / 1.0) * Math.PI * 2)) ** 1.5;
        if (pulse > 0.01) flashFx(g, img, rect, mask, 0.42 * pulse);
        continue;
      }
      if (t > end + 0.45) continue;
      const k = easeInOut(dt / 0.45) * (1 - easeInOut((t - end) / 0.45));
      if (c.kind === "sweep") sweep(g, img, rect, which, dt / 1.3);
      else if (c.kind === "trace") traceFx(g, img, rect, mask, k, dt);
      else if (c.kind === "recolour") recolourFx(g, img, rect, mask, k, c.color);
      else if (c.kind === "texture") textureFx(g, img, rect, mask, k, dt);
    }
  }

  isolated(g, img, opts, cue, t, alpha) {
    const scene = this.tl.scenes.find((x) => x.cues?.includes(cue));
    const next = scene?.cues.find((c) => c.at > cue.at + 0.5 && c.kind !== "isolate");
    const back = Math.min(cue.at + 1.8, next ? next.at - 0.1 : Infinity);
    const k = easeInOut((t - cue.at) / 0.45) * (1 - easeInOut((t - back) / 0.5));
    const rect = D.standing(g, img, { ...opts, alpha: alpha * (1 - 0.72 * k) });
    if (k <= 0) return rect;
    const b = garmentBands(img);
    g.save();
    g.beginPath();
    g.rect(rect.x - 20, rect.y, rect.w + 40, rect.h * b.collar);
    g.clip();
    g.globalAlpha = alpha * k;
    D.standing(g, img, { ...opts, shadow: false });
    g.restore();
    const piece = maskedPiece(img, garmentMask(img, area(cue.part || "chest")));
    g.save();
    g.globalAlpha = alpha * k;
    g.drawImage(piece, rect.x, rect.y, rect.w, rect.h);
    g.restore();
    return rect;
  }

  shot(g, s, t, opts = {}) {
    const probe = this.model(PROBE, s, t, { ...opts, still: true });
    const v = camera(s, t, probe);
    g.save();
    g.translate(v.sx, v.sy);
    g.scale(v.z, v.z);
    g.translate(-v.f.x, -v.f.y);
    const m = this.model(g, s, t, { ...opts, still: true });
    g.restore();
    if (v.k > 0.55 && /ring|circle/i.test(v.zoom?.cue?.text ?? "") && !(v.zoom.prev && v.zoom.blend < 1)) D.ring(g, v.sx, v.sy, 170, { k: easeOut((t - v.zoom.cue.at - 0.33) / 0.45), color: `rgba(30,30,28,${0.7 * clamp01((v.k - 0.55) / 0.3)})` });
    this.annotations(g, s, t, m, v.map);
    return { m, v };
  }

  annotations(g, s, t, m, map = (p) => p) {
    const tl = map({ x: m.rect.x, y: m.rect.y });
    const br = map({ x: m.rect.x + m.rect.w, y: m.rect.y + m.rect.h });
    const R = { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
    const onScreen = (p) => p.y > H * 0.13 && p.y < H * 0.8 && p.x > 30 && p.x < W - 30;
    for (const c of live(s, t)) {
      const dt = t - c.at;
      if (c.kind === "vguide") {
        const a = spanOn(m, ["thighs", "knees"].includes(c.part) ? c.part : "thighs");
        const b = spanOn(m, "hem");
        const k = easeInOut(dt / 0.55);
        for (const [x0, x1] of [[a.x0, b.x0], [a.x1, b.x1]]) {
          const p0 = map({ x: x0 - 8, y: a.y });
          const p1 = map({ x: x1 - 8, y: b.y });
          D.dashed(g, p0.x, p0.y, p1.x, p1.y, { k });
        }
      } else if (c.kind === "hguide") {
        const sp = spanOn(m, c.part || "shoulders");
        const p0 = map({ x: sp.x0 - 40 / Math.max(1, R.w / m.rect.w), y: sp.y });
        const p1 = map({ x: sp.x1 + 40 / Math.max(1, R.w / m.rect.w), y: sp.y });
        if (onScreen(p0)) D.dashed(g, p0.x, p0.y, p1.x, p1.y, { k: easeInOut(dt / 0.5) });
      } else if (c.kind === "dot") {
        const p = map(pointOn(m, c.part || "waist", c.side || "right"));
        if (onScreen(p)) D.hotDot(g, p.x, p.y, { k: easeBack(dt / 0.3, 2), pulse: 0.5 + 0.5 * Math.sin(dt * 3.2) });
      } else if (c.kind === "box") {
        const [top, bottom] = BOX[c.part] ?? BOX.chest;
        const sp = spanOn(m, c.part === "feet" || c.part === "hem" ? "hem" : "chest");
        const p0 = map({ x: Math.min(sp.x0, m.rect.x + m.rect.w * 0.12) - 16, y: m.rect.y + m.rect.h * top });
        const p1 = map({ x: Math.max(sp.x1, m.rect.x + m.rect.w * 0.88) + 16, y: m.rect.y + m.rect.h * bottom });
        const k = easeOut(dt / 0.35) * (1 - clamp01((dt - 1.6) / 0.5));
        if (k > 0) D.highlight(g, p0.x, Math.max(p0.y, H * 0.13), p1.x - p0.x, Math.min(p1.y, H * 0.8) - Math.max(p0.y, H * 0.13), { k });
      } else if (c.kind === "device") {
        const dev = DEVICES[c.item];
        if (!dev) continue;
        const d = {
          t, dt, cue: c, W, H, box: R, seed: s.index * 31 + Math.round(c.at * 10),
          theme: { ink: D.INK, accent: D.THEME.accent, page: D.THEME.page, head: D.THEME.head, label: D.THEME.label },
          at: (part, side = "center") => map(pointOn(m, part, side)),
          span: (part) => {
            const sp = spanOn(m, part);
            const a = map({ x: sp.x0, y: sp.y });
            const b = map({ x: sp.x1, y: sp.y });
            return { x0: a.x, x1: b.x, y: a.y };
          },
        };
        g.save();
        try {
          dev.draw(g, d);
        } catch {}
        g.restore();
        reset(g);
      } else if (c.kind === "product") {
        const p = map(pointOn(m, c.part || "feet", c.side === "left" ? "left" : "right"));
        const right = p.x < W * 0.62;
        const x = right ? Math.min(p.x + 330, W - 175) : Math.max(p.x - 330, 175);
        const y = Math.min(Math.max(p.y - 170, H * 0.18), H * 0.62);
        D.productCard(g, this.img("item", c.item), c.text || "", { x, y, to: p, k: easeOut(dt / 0.45) });
      } else if (c.kind === "shift") {
        const side = c.side === "right" ? "right" : "left";
        const good = map(pointOn(m, c.part || "shoulders", side));
        const bad = map(pointOn(m, c.to_part || "sleeve", side));
        if (!onScreen(good) || !onScreen(bad)) continue;
        D.mark(g, good.x, good.y, { status: "good", k: easeBack(dt / 0.3, 2) });
        const ak = easeInOut((dt - 0.4) / 0.5);
        if (ak > 0) D.curveArrow(g, good, bad, { k: ak, bend: side === "left" ? -1 : 1 });
        if (dt > 0.85) D.mark(g, bad.x, bad.y, { status: "bad", k: easeBack((dt - 0.85) / 0.3, 2) });
        if (c.text && dt > 1) {
          const tx = side === "left" ? Math.max(Math.min(good.x, bad.x) - 40, 250) : Math.min(Math.max(good.x, bad.x) + 40, W - 250);
          D.note(g, c.text, { x: tx, y: Math.min((good.y + bad.y) / 2 - 30, H * 0.7), k: easeOut((dt - 1) / 0.5), align: side === "left" ? "right" : "left" });
        }
      } else if (c.kind === "note") {
        const side = this.tl.stageLeft ? "right" : c.side === "left" ? "left" : "right";
        const target = map(pointOn(m, c.part || "waist", side));
        if (!onScreen(target)) continue;
        const textX = side === "right" ? Math.min(Math.max(R.x + R.w * 0.98 + 18, target.x + 60), W - 250) : Math.max(Math.min(R.x + R.w * 0.02 - 18, target.x - 60), 250);
        const textY = Math.min(Math.max(target.y - 210, 330), H * 0.7);
        D.note(g, c.text || "", { x: textX, y: textY, to: { x: target.x + (side === "right" ? 14 : -14), y: target.y - 6 }, k: easeOut(dt / 0.6), align: side === "right" ? "left" : "right" });
      }
    }
  }

  topPill(g, s, t, { y = H * 0.105, side = null, x = W / 2, size, fade = 1 } = {}) {
    const pills = live(s, t).filter((c) => c.kind === "pill" && (!side || (c.side ?? "center") === side));
    const cur = pills.at(-1);
    if (!cur) return null;
    const prev = pills.at(-2);
    const dt = t - cur.at;
    if (fade <= 0) return cur;
    if (prev && dt < 0.12) D.pill(g, prev.text, { x, y, status: statusOf(prev), alpha: fade * (1 - dt / 0.12), scale: 1 - (dt / 0.12) * 0.1, size });
    const k = easeBack(dt / 0.3);
    D.pill(g, cur.text, { x, y, status: dt > 0.12 ? statusOf(cur) : null, alpha: fade * clamp01(dt / 0.12), scale: 0.86 + 0.14 * k, size });
    return cur;
  }

  swatches(g, s, t, { x = W * 0.73, y0 = H * 0.5, size = 150, legend = false, m = null } = {}) {
    const cards = s.cues.filter((c) => c.kind === "swatch");
    const swaps = s.cues.filter((c) => c.kind === "swap");
    const step = size * 1.22 + 30;
    const ys = [];
    cards.forEach((c, i) => {
      const part = c.part && c.part !== "chest" ? c.part : groupPart(this.tl, c.target) ?? c.part;
      let y = m && part ? pointOn(m, partName(part), "center").y - size * 0.6 : y0 - i * step;
      for (const o of ys) if (Math.abs(y - o) < step) y = o + step;
      ys.push(y);
    });
    let top = Infinity;
    cards.forEach((c, i) => {
      const dt = t - c.at;
      if (dt < 0) return;
      const k = easeBack(clamp01(dt / 0.5), 1.25);
      const y = ys[i];
      top = Math.min(top, y);
      const cx = x + (1 - k) * (W - x + 60);
      const sw = swaps.find((w) => c.target && w.target === c.target && w.at >= c.at - 0.05);
      const mark = statusOf(c);
      const tc = sw ? Math.max(c.at + 0.55, sw.at - 0.1) : mark ? c.at + 0.75 : null;
      const press = tc != null && t >= tc && t < tc + 0.16 ? Math.sin(((t - tc) / 0.16) * Math.PI) : 0;
      const markK = tc != null && t >= tc ? easeBack(clamp01((t - tc) / 0.28), 1.6) : 0;
      const img = c.item ? this.img("item", c.item) : null;
      const glyph = c.glyph || (/^(XXS|XS|S|M|L|XL|XXL|\d{2})$/i.test(String(c.text ?? "").trim()) ? String(c.text).trim().toUpperCase() : "");
      D.swatch(g, { x: cx, y, size, color: (c.target && this.tl.media?.tone?.(c.target)) || c.color || "#ECEBE7", img, label: glyph ? "SIZE" : c.text || "", glyph, alpha: clamp01(dt / 0.12), mark: tc != null ? mark || (sw ? "good" : null) : null, markK, press });
      c._pos = { x: cx + size / 2, y: y + size / 2 };
      if (sw && tc != null && t >= tc && t < tc + 0.9) {
        const wk = clamp01((t - tc) / 0.9);
        g.save();
        for (const off of [0, 0.18]) {
          const rk = clamp01((wk - off) / (1 - off));
          if (rk <= 0) continue;
          g.globalAlpha = 0.45 * (1 - rk);
          g.strokeStyle = c.color || "#888";
          g.lineWidth = 3;
          g.beginPath();
          g.arc(c._pos.x, c._pos.y, 90 + 520 * easeOut(rk), 0, Math.PI * 2);
          g.stroke();
        }
        g.restore();
      }
      if (tc == null) return;
      const leave = (tc ?? c.at + 0.55) + 0.12;
      if (t > leave + 0.45) return;
      const ride = { x: c._pos.x + size * 0.08, y: c._pos.y + size * 0.05 };
      const out = easeIn(clamp01((t - leave) / 0.42));
      D.cursor(g, ride.x + out * (W - ride.x + 60), ride.y + out * 30, { press, alpha: 1 - clamp01((t - leave - 0.3) / 0.15) });
    });
    this._stackTop = top;
  }

  pieceColumn(g, items, t, { cx, from = 1, box = 230, weight = 175 } = {}) {
    if (!items.length) return;
    const gap = 42;
    const rows = items.map((c) => {
      const img = this.img("item", c.item);
      if (!img) return { c, img, w: box * 0.7, h: box * 0.7 };
      const sc = Math.min(box / img.width, box / img.height, weight / Math.sqrt(img.width * img.height));
      return { c, img, w: img.width * sc, h: img.height * sc };
    });
    const labelH = 46;
    const total = rows.reduce((n, r) => n + r.h + labelH, 0) + gap * (rows.length - 1);
    let y = Math.max(H * 0.2, H * 0.5 - total / 2);
    for (const r of rows) {
      const dt = t - r.c.at;
      const top = y;
      y += r.h + labelH + gap;
      if (dt < 0) continue;
      const ik = easeOut(dt / 0.35);
      g.save();
      g.globalAlpha = ik;
      g.translate(from * (1 - ik) * 60, 0);
      if (r.img) {
        g.shadowColor = "rgba(0,0,0,0.12)";
        g.shadowBlur = 18;
        g.shadowOffsetY = 6;
        g.drawImage(r.img, cx - r.w / 2, top, r.w, r.h);
        g.shadowColor = "transparent";
      }
      if (r.c.text) {
        g.font = `22px "${D.THEME.label}"`;
        g.fillStyle = D.INK;
        g.textAlign = "center";
        g.fillText(r.c.text, cx, top + r.h + 32);
      }
      g.restore();
    }
  }

  indexGrid(g, s, t, lt) {
    studio(g, this.tl.kit);
    const kit = this.tl.kit;
    const k = easeOut(lt / 0.4);
    if (s.title) D.headline(g, s.title, { y: H * 0.12, alpha: k });
    const rows = (s.sections ?? []).slice(0, 4);
    const cols = rows.length <= 2 ? rows.length : 2;
    const cellW = (W - 140) / Math.max(cols, 1);
    const cellH = rows.length > 2 ? H * 0.34 : H * 0.6;
    const top = H * 0.17;
    g.save();
    g.strokeStyle = "rgba(30,30,28,0.3)";
    g.setLineDash([3, 9]);
    g.lineWidth = 2;
    const dk = easeInOut((lt - 0.1) / 0.6);
    if (cols > 1) {
      g.beginPath();
      g.moveTo(W / 2, top + 20);
      g.lineTo(W / 2, top + 20 + (cellH * Math.ceil(rows.length / 2) - 40) * dk);
      g.stroke();
    }
    if (rows.length > 2) {
      g.beginPath();
      g.moveTo(90, top + cellH);
      g.lineTo(90 + (W - 180) * dk, top + cellH);
      g.stroke();
    }
    g.restore();
    rows.forEach((row, i) => {
      const cx = 70 + cellW * (i % cols) + cellW / 2;
      const cy = top + cellH * Math.floor(i / cols);
      const quick = s.t1 - s.t0 < 2;
      const rk = easeOut((lt - (quick ? 0.1 : 0.25) - i * (quick ? 0.09 : 0.16)) / (quick ? 0.3 : 0.45));
      if (rk <= 0) return;
      const label = String(row.header ?? "").replace(/^\s*\d+\s*\/\s*/, "");
      const key = row.outfits?.[0];
      const img = key ? this.img("outfit", key) ?? this.img("item", key) : null;
      const fh = cellH * 0.62;
      if (img) D.standing(g, img, { cx: cx + cellW * 0.08, feet: cy + cellH - 24 + (1 - rk) * 16, height: fh, alpha: rk });
      g.save();
      g.globalAlpha = rk;
      g.fillStyle = D.INK;
      g.textAlign = "left";
      if (D.THEME.upper || !D.THEME.headItalic) {
        g.font = `20px "${D.THEME.label}"`;
        g.fillText(String(i + 1).padStart(2, "0"), cx - cellW / 2 + 24, cy + 52);
        let fs = 54;
        g.font = `${fs}px "${D.THEME.head}"`;
        while (g.measureText(label.toUpperCase()).width > cellW - 48 && fs > 26) g.font = `${(fs -= 4)}px "${D.THEME.head}"`;
        g.fillText(label.toUpperCase(), cx - cellW / 2 + 24, cy + 52 + fs + 6);
      } else {
        g.font = `20px "Plex Mono Medium"`;
        g.fillText(String(i + 1).padStart(2, "0"), cx - cellW / 2 + 26, cy + 56);
        g.font = `48px "${D.THEME.headItalic ?? D.THEME.head}"`;
        g.fillText(label, cx - cellW / 2 + 26, cy + 108);
      }
      g.restore();
    });
  }

  indexCards(g, s, t, lt) {
    studio(g, this.tl.kit);
    const k = easeOut(lt / 0.4);
    D.headline(g, s.title ?? "", { y: H * 0.15, alpha: k });
    const rows = (s.sections ?? []).slice(0, 5);
    rows.forEach((row, i) => {
      const label = String(row.header ?? "").replace(/^\s*\d+\s*\/\s*/, "");
      const key = row.outfits?.[0];
      const img = key ? this.img("item", key) ?? this.img("outfit", key) : null;
      D.darkCard(g, i + 1, label, { x: W / 2, y: H * 0.27 + i * 170, k: easeOut((lt - 0.2 - i * 0.14) / 0.45), img });
    });
  }

  footage(g, s, t, lt) {
    const dur = s.t1 - s.t0;
    const slot = s.clip ? this.img("media", s.clip) : null;
    const clip = this.img("clip", `chapter-${s.number || s.index}`);
    if (slot?.frame) softFrame(g, slot.frame(Math.floor(lt * slot.fps)), { blur: 9, z: 1.04 + 0.03 * clamp01(lt / dur) });
    else if (slot) softFrame(g, slot, { blur: 9, z: 1.04 + 0.05 * clamp01(lt / dur) });
    else if (clip?.frames?.length) {
      const fr = clip.frames[Math.floor(lt * (clip.fps ?? FPS)) % clip.frames.length];
      softFrame(g, fr, { blur: 9, z: 1.04 + 0.03 * clamp01(lt / dur) });
    } else {
      const shots = this.chapterShots(s);
      const cut = dur >= 1.6 && shots[1] ? dur * 0.52 : Infinity;
      const [shot, st] = lt < cut ? [shots[0], lt] : [shots[1], lt - cut];
      this.handheld(g, shot, st, t);
    }
    grain(g, Math.floor(t * FPS));
  }

  sectionPhotos(s, t) {
    const key = `photos-${s.index}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const rest = this.tl.scenes.slice(s.index + 1);
    const end = rest.findIndex((x) => x.type === "chapter" || x.type === "outro");
    const sec = rest.slice(0, end < 0 ? undefined : end);
    const photos = [];
    for (const x of sec) {
      const m = x.reference ? this.img("media", x.reference) : null;
      if (m) photos.push(m.frame ? m.frame(0) : m);
    }
    if (s.clip) {
      const m = this.img("media", s.clip);
      if (m) photos.unshift(m.frame ? m.frame(0) : m);
    }
    for (const x of [s, ...sec]) if (x.outfit && photos.length < 3) photos.push(this.img("outfit", x.outfit));
    const out = photos.filter(Boolean).slice(0, 3);
    this.cache.set(key, out.length ? out : [null]);
    return this.cache.get(key);
  }

  sectionHead(g, s, t) {
    if (this.tl.kit.chapter !== "header" || !s.section) return;
    const k = s.type === "chapter" ? easeInOut((t - s.t0 - 0.05) / 0.6) : 1;
    D.sectionHeader(g, `${String(s.section.n).padStart(2, "0")}/ ${s.section.title}`, { x: 70, right: W - 70, y: H * 0.055, k, alpha: clamp01(k * 3) });
  }

  scale(g, s, t) {
    const c = live(s, t).filter((x) => x.kind === "scale").at(-1);
    if (!c) return;
    const [left = "Warm", right = "Cool", value = "0.5"] = String(c.text || "").split("|");
    const [from, to] = String(c.color || "").split("|");
    const dt = t - c.at;
    const v = 0.5 + (clamp01(Number(value)) - 0.5) * easeInOut((dt - 0.3) / 0.7);
    D.scaleBar(g, { left, right, from: /^#/.test(from ?? "") ? from : undefined, to: /^#/.test(to ?? "") ? to : undefined, value: v, k: easeOut(dt / 0.5), y: H * 0.165 });
  }

  palette(g, s, t) {
    const sw = live(s, t).filter((c) => c.kind === "swatch");
    if (!sw.length) return;
    const size = 92;
    const gap = 18;
    const x0 = W / 2 - (sw.length * size + (sw.length - 1) * gap) / 2;
    sw.forEach((c, i) => {
      const k = easeBack((t - c.at) / 0.32, 1.6);
      if (k <= 0) return;
      const x = x0 + i * (size + gap) + size / 2;
      const y = H * 0.79;
      g.save();
      g.translate(x, y);
      g.scale(k, k);
      g.shadowColor = "rgba(0,0,0,0.3)";
      g.shadowBlur = 14;
      g.fillStyle = c.color || "#CCCCCC";
      g.fillRect(-size / 2, -size / 2, size, size);
      g.shadowColor = "transparent";
      g.strokeStyle = "rgba(255,255,255,0.9)";
      g.lineWidth = 3;
      g.strokeRect(-size / 2, -size / 2, size, size);
      g.restore();
      if (c.text && k > 0.6) {
        g.save();
        g.fillStyle = "#FFFFFF";
        g.font = `18px "Plex Mono Medium"`;
        g.textAlign = "center";
        g.fillText(c.text.toUpperCase(), x, y + size / 2 + 28);
        g.restore();
      }
    });
  }

  photoCard(g, s, t) {
    const c = live(s, t).filter((x) => x.kind === "photo").at(-1);
    if (!c) return 0;
    const k = easeOut((t - c.at) / 0.5);
    const img = this.img("media", c.item);
    const w = 400;
    const h = 520;
    const x = W * 0.74 + (1 - k) * 420;
    const y = H * 0.4;
    g.save();
    g.globalAlpha = clamp01(k * 1.5);
    g.translate(x, y);
    g.rotate(0.035 * (1 - k * 0.4));
    g.shadowColor = "rgba(0,0,0,0.22)";
    g.shadowBlur = 30;
    g.shadowOffsetY = 10;
    g.fillStyle = "#FFFFFF";
    g.fillRect(-w / 2 - 14, -h / 2 - 14, w + 28, h + 74);
    g.shadowColor = "transparent";
    g.save();
    g.beginPath();
    g.rect(-w / 2, -h / 2, w, h);
    g.clip();
    const fr = img?.frame ? img.frame(Math.floor((t - c.at) * img.fps)) : img;
    if (fr) {
      const sc = Math.max(w / fr.width, h / fr.height);
      g.drawImage(fr, -(fr.width * sc) / 2, -h / 2 - (fr.height * sc - h) * 0.25, fr.width * sc, fr.height * sc);
    } else {
      g.fillStyle = "#D8D7D3";
      g.fillRect(-w / 2, -h / 2, w, h);
      g.fillStyle = D.MUTED;
      g.font = `20px "Plex Mono"`;
      g.textAlign = "center";
      g.fillText("ADD PHOTO", 0, 0);
    }
    g.restore();
    if (c.text) {
      g.fillStyle = D.INK;
      g.font = `30px "Instrument Serif Italic"`;
      g.textAlign = "center";
      g.fillText(c.text, 0, h / 2 + 44);
    }
    g.restore();
    return k;
  }

  subtitle(g, t, s) {
    const c = this.tl.chunks.find((x) => t >= x.start && t < x.end);
    if (!c) return;
    const light = c.dark || this.tl.look === "paper" ? false : false;
    const onDark = (s.type === "chapter" && ["pill", "check"].includes(this.tl.kit.chapter)) || (s.type === "reference" && (this.img("media", s.reference) || this.img("ref", s.reference))) || (s.type === "beforeafter" && s.reference);
    if (onDark) {
      g.save();
      g.shadowColor = "rgba(0,0,0,0.45)";
      g.shadowBlur = 12;
      D.subtitle(g, c.text, { color: "rgba(255,255,255,0.92)", size: 38 });
      g.restore();
    } else D.subtitle(g, c.text, { size: 36, color: light ? "#FFF" : "#4A4946" });
  }
}

const pointOn = (m, part, side) => (m.pointOf ? m.pointOf(part, side) : partPoint(m.rect, m.img, part, side));
const spanOn = (m, part) => (m.spanOf ? m.spanOf(part) : partSpan(m.rect, m.img, part));

function reset(g) {
  g.imageSmoothingQuality = "high";
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.filter = "none";
  g.globalCompositeOperation = "source-over";
}

function live(s, t) {
  const swaps = s.cues.filter((c) => c.kind === "swap" && c.at <= t);
  const since = swaps.length ? swaps.at(-1).at : -Infinity;
  return s.cues.filter((c) => c.at <= t && (c.until == null || t < c.until) && (c.at >= since || c.kind === "zoom"));
}

const MASKS = new WeakMap();
const SEG = new WeakMap();
export function registerMasks(img, masks) {
  SEG.set(img, masks);
}
const groupOf = (which) => (which === "feet" ? "shoes" : ["legs", "waist"].includes(which) ? "bottoms" : "top");
const BOXES = new WeakMap();
function maskRows(mask) {
  if (BOXES.has(mask)) return BOXES.get(mask);
  const w = 48;
  const h = 160;
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  g.drawImage(mask, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  let y0 = 1;
  let y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 60) {
    y0 = Math.min(y0, y / h);
    y1 = Math.max(y1, (y + 1) / h);
  }
  const out = y1 > y0 ? [y0, y1] : [0.15, 0.55];
  BOXES.set(mask, out);
  return out;
}
export function garmentMask(img, which) {
  const seg = SEG.get(img)?.[groupOf(which)];
  if (seg) return seg;
  let byImg = MASKS.get(img);
  if (!byImg) MASKS.set(img, (byImg = {}));
  if (byImg[which]) return byImg[which];
  const b = garmentBands(img);
  const [y0, y1] = which === "feet" ? [b.feet, 1] : ["legs", "waist"].includes(which) ? [b.hem, b.feet] : [b.collar, b.hem];
  const w = img.width;
  const h = img.height;
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const im = g.getImageData(0, 0, w, h);
  const d = im.data;
  const skin = (r, gg, bb) => r > 95 && gg > 40 && bb > 20 && r > gg && r > bb && r - Math.min(gg, bb) > 15 && Math.abs(r - gg) > 15 && r - bb > 30 && r < 250;
  for (let y = 0; y < h; y++) {
    const fy = y / h;
    const inBand = fy >= y0 && fy <= y1;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const keep = inBand && d[i + 3] > 128 && !(which !== "feet" && skin(d[i], d[i + 1], d[i + 2]) && !skin(d[i] * 0.9, d[i + 1], d[i + 2] * 1.4));
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = keep ? d[i + 3] : 0;
    }
  }
  g.putImageData(im, 0, 0);
  byImg[which] = c;
  return c;
}

const PIECES = new WeakMap();
function maskedPiece(img, mask) {
  let byImg = PIECES.get(img);
  if (!byImg) PIECES.set(img, (byImg = new Map()));
  if (byImg.has(mask)) return byImg.get(mask);
  const c = createCanvas(img.width, img.height);
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = "destination-in";
  g.drawImage(mask, 0, 0, img.width, img.height);
  byImg.set(mask, c);
  return c;
}

function flashFx(g, img, rect, mask, a) {
  const c = createCanvas(Math.round(rect.w), Math.round(rect.h));
  const cg = c.getContext("2d");
  cg.drawImage(mask, 0, 0, c.width, c.height);
  cg.globalCompositeOperation = "source-in";
  cg.fillStyle = "#FFFFFF";
  cg.fillRect(0, 0, c.width, c.height);
  g.save();
  g.globalAlpha = a;
  g.drawImage(c, rect.x, rect.y, rect.w, rect.h);
  g.restore();
}

const FX = new Set(["sweep", "lift", "trace", "recolour", "texture", "flash"]);

function liftFx(g, img, rect, mask, k) {
  if (k <= 0) return;
  const piece = maskedPiece(img, mask);
  const veil = silhouette(img, D.THEME.page);
  g.save();
  g.globalAlpha = 0.5 * k;
  g.drawImage(veil, rect.x, rect.y, rect.w, rect.h);
  g.restore();
  const sc = 1 + 0.035 * k;
  const cx = rect.x + rect.w / 2;
  const [y0, y1] = maskRows(mask);
  const cy = rect.y + rect.h * (y0 + y1) / 2;
  g.save();
  g.translate(cx, cy);
  g.scale(sc, sc);
  g.translate(-cx, -cy);
  g.shadowColor = `rgba(0,0,0,${0.28 * k})`;
  g.shadowBlur = 36;
  g.shadowOffsetY = 14;
  g.drawImage(piece, rect.x, rect.y, rect.w, rect.h);
  g.restore();
}

function traceFx(g, img, rect, mask, k, dt) {
  if (k <= 0) return;
  const ring = outline(img, mask);
  const [y0, y1] = maskRows(mask);
  const reveal = easeInOut(dt / 0.9);
  g.save();
  g.beginPath();
  g.rect(rect.x - 40, rect.y + rect.h * (y0 - 0.01), rect.w + 80, rect.h * (y1 - y0 + 0.02) * reveal);
  g.clip();
  g.globalAlpha = k;
  g.drawImage(ring, rect.x, rect.y, rect.w, rect.h);
  g.restore();
}

function recolourFx(g, img, rect, mask, k, color) {
  if (k <= 0 || !/^#[0-9a-f]{6}$/i.test(color ?? "")) return;
  const piece = maskedPiece(img, mask);
  const c = createCanvas(img.width, img.height);
  const cg = c.getContext("2d");
  cg.drawImage(piece, 0, 0);
  cg.globalCompositeOperation = "color";
  cg.fillStyle = color;
  cg.fillRect(0, 0, c.width, c.height);
  cg.globalCompositeOperation = "destination-in";
  cg.drawImage(mask, 0, 0, c.width, c.height);
  g.save();
  g.globalAlpha = k;
  g.drawImage(c, rect.x, rect.y, rect.w, rect.h);
  g.restore();
}

function textureFx(g, img, rect, mask, k, dt) {
  if (k <= 0) return;
  const weave = weaveOf(img, mask);
  const [y0, y1] = maskRows(mask);
  g.save();
  g.beginPath();
  g.rect(rect.x - 10, rect.y + rect.h * y0, rect.w + 20, rect.h * (y1 - y0) * easeInOut(dt / 1.1));
  g.clip();
  g.globalAlpha = 0.85 * k;
  g.globalCompositeOperation = "screen";
  g.drawImage(weave, rect.x, rect.y, rect.w, rect.h);
  g.restore();
}

const FXC = new WeakMap();
function fxCache(obj, key, make) {
  let m = FXC.get(obj);
  if (!m) FXC.set(obj, (m = new Map()));
  if (!m.has(key)) m.set(key, make());
  return m.get(key);
}
function silhouette(img, color) {
  return fxCache(img, `sil:${color}`, () => {
    const c = createCanvas(img.width, img.height);
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  });
}
function outline(img, mask) {
  return fxCache(mask, `ring:${D.THEME.accent}`, () => {
    const w = img.width;
    const h = img.height;
    const r = Math.max(2, Math.round(w / 140));
    const c = createCanvas(w, h);
    const g = c.getContext("2d");
    for (let a = 0; a < 16; a++) g.drawImage(mask, Math.cos((a / 16) * Math.PI * 2) * r, Math.sin((a / 16) * Math.PI * 2) * r, w, h);
    g.globalCompositeOperation = "destination-out";
    g.drawImage(mask, 0, 0, w, h);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = "#FFFFFF";
    g.fillRect(0, 0, w, h);
    const out = createCanvas(w, h);
    const og = out.getContext("2d");
    og.globalAlpha = 0.55;
    og.filter = "blur(2px) brightness(0.2)";
    og.drawImage(c, 0, 0);
    og.filter = "none";
    og.globalAlpha = 1;
    og.drawImage(c, 0, 0);
    return out;
  });
}
function weaveOf(img, mask) {
  return fxCache(mask, "weave", () => {
    const w = img.width;
    const h = img.height;
    const c = createCanvas(w, h);
    const g = c.getContext("2d");
    const step = Math.max(6, Math.round(w / 34));
    g.strokeStyle = "rgba(255,255,255,0.55)";
    g.lineWidth = Math.max(1, w / 500);
    for (let x = -h; x < w; x += step) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + h, h);
      g.stroke();
      g.beginPath();
      g.moveTo(x + h, 0);
      g.lineTo(x, h);
      g.stroke();
    }
    g.globalCompositeOperation = "destination-in";
    g.drawImage(mask, 0, 0, w, h);
    return c;
  });
}

const SWEEP_BUF = new WeakMap();
const VIVID = new WeakMap();
function vivid(img, mask) {
  if (VIVID.has(mask)) return VIVID.get(mask);
  const c = createCanvas(48, 64);
  const cg = c.getContext("2d");
  cg.drawImage(img, 0, 0, 48, 64);
  cg.globalCompositeOperation = "destination-in";
  cg.drawImage(mask, 0, 0, 48, 64);
  const d = cg.getImageData(0, 0, 48, 64).data;
  let sat = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    const mx = Math.max(d[i], d[i + 1], d[i + 2]);
    sat += mx ? (mx - Math.min(d[i], d[i + 1], d[i + 2])) / mx : 0;
    n++;
  }
  const out = n > 20 && sat / n > 0.4;
  VIVID.set(mask, out);
  return out;
}
function sweep(g, img, rect, which, k) {
  if (k <= 0 || k >= 1.25) return;
  const mask = garmentMask(img, which);
  let buf = SWEEP_BUF.get(img);
  if (!buf) SWEEP_BUF.set(img, (buf = createCanvas(img.width, img.height)));
  const bg = buf.getContext("2d");
  bg.setTransform(1, 0, 0, 1, 0, 0);
  bg.globalCompositeOperation = "source-over";
  bg.clearRect(0, 0, buf.width, buf.height);
  const [y0, y1] = maskRows(mask);
  const span = (y1 - y0) * img.height;
  const band = span * 0.55;
  const e = easeInOut(Math.min(k, 1));
  const cy = y1 * img.height + band * 0.5 - (span + band) * e;
  const grad = bg.createLinearGradient(0, cy - band / 2, 0, cy + band / 2);
  if (vivid(img, mask)) {
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.5, "rgba(255,250,240,0.5)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
  } else {
    grad.addColorStop(0, "rgba(120,180,255,0)");
    grad.addColorStop(0.3, "rgba(150,170,255,0.75)");
    grad.addColorStop(0.55, "rgba(205,150,255,0.85)");
    grad.addColorStop(0.8, "rgba(255,120,200,0.7)");
    grad.addColorStop(1, "rgba(255,120,200,0)");
  }
  bg.fillStyle = grad;
  bg.fillRect(0, cy - band / 2, buf.width, band);
  bg.globalCompositeOperation = "destination-in";
  bg.drawImage(mask, 0, 0);
  g.save();
  g.globalAlpha = 0.9 * (1 - clamp01((k - 1) / 0.25));
  g.globalCompositeOperation = "screen";
  g.drawImage(buf, rect.x, rect.y, rect.w, rect.h);
  g.restore();
}

const BANDS = new WeakMap();
function garmentBands(img) {
  if (BANDS.has(img)) return BANDS.get(img);
  const w = 60;
  const h = 200;
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;
  const at = (fx, fy) => {
    const x = Math.round(fx * (w - 1));
    const y = Math.round(fy * (h - 1));
    const i = (y * w + x) * 4;
    return [px[i], px[i + 1], px[i + 2], px[i + 3]];
  };
  const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  const ref = [0.3, 0.33, 0.36].map((fy) => at(0.4, fy)).reduce((a, p) => a.map((v, i) => v + p[i] / 3), [0, 0, 0, 0]);
  let hem = 0.55;
  for (let fy = 0.4; fy < 0.9; fy += 0.005) {
    if ([0, 0.01, 0.02].every((d) => dist(at(0.42, fy + d), ref) > 90 && at(0.42, fy + d)[3] > 100)) {
      hem = fy;
      break;
    }
  }
  const legs = at(0.42, Math.min(hem + 0.12, 0.85));
  let feet = 0.9;
  for (let fy = Math.max(hem + 0.15, 0.82); fy < 0.99; fy += 0.005) {
    const p = at(0.4, fy);
    const q = at(0.6, fy);
    if ((p[3] > 100 && dist(p, legs) > 110) || (q[3] > 100 && dist(q, legs) > 110)) {
      feet = fy - 0.01;
      break;
    }
  }
  const out = { collar: 0.135, hem, feet };
  BANDS.set(img, out);
  return out;
}

const BOX = {
  collar: [0.12, 0.24], neck: [0.12, 0.24], face: [0.01, 0.14], head: [0.01, 0.14],
  shoulders: [0.15, 0.48], chest: [0.15, 0.48], sleeve: [0.15, 0.52], waist: [0.36, 0.56], belt: [0.38, 0.54],
  hips: [0.4, 0.6], shirt_hem: [0.44, 0.6], hands: [0.42, 0.56], cuff: [0.42, 0.56],
  thighs: [0.48, 0.74], knees: [0.62, 0.82], hem: [0.84, 1], ankles: [0.84, 1], feet: [0.88, 1.01],
};

const statusOf = (c) => (c.status === "good" ? "good" : c.status === "bad" ? "bad" : null);

function placeholder(g, { cx, feet, height }, key) {
  const w = height * 0.32;
  g.save();
  g.fillStyle = "rgba(30,30,28,0.08)";
  g.beginPath();
  g.roundRect(cx - w / 2, feet - height, w, height, w / 2);
  g.fill();
  g.fillStyle = D.MUTED;
  g.font = `22px "Plex Mono"`;
  g.textAlign = "center";
  g.fillText(String(key ?? "image").toUpperCase(), cx, feet - height / 2);
  g.restore();
  return { x: cx - w / 2, y: feet - height, w, h: height };
}

function studio(g, kit) {
  g.drawImage(D.background(kit.background), 0, 0);
  if (kit.background === "paper" || (kit.background === "custom" && D.THEME.corners)) D.corners(g);
}

const PROBE = createCanvas(4, 4).getContext("2d");

const SCENES = {
  title(g, s, t, lt) {
    studio(g, this.tl.kit);
    this.sectionHead(g, s, t);
    const italic = /\?\s*$/.test(s.title ?? "") || s.title_style === "italic";
    this.shot(g, s, t, this.tl.stageLeft ? {} : { feet: H * 0.86, height: H * 0.64 });
    const k = easeOut(lt / 0.45);
    D.headline(g, s.title ?? "", { kind: this.tl.kit.headline, y: H * 0.105 + (1 - k) * 14, italic, alpha: k, size: this.tl.kit.headline === "serif" ? (italic ? 86 : 92) : undefined });
  },

  look(g, s, t) {
    studio(g, this.tl.kit);
    this.sectionHead(g, s, t);
    const pc = live(s, t).filter((x) => x.kind === "photo").at(-1);
    const aside = pc ? easeInOut((t - pc.at) / 0.5) : 0;
    const firstCard = s.cues.find((c) => c.kind === "swatch" && c.at <= t + 0.1);
    const prev = this.tl.scenes[s.index - 1];
    const carried = s.enter === "hold" && prev?.cues?.some((c) => c.kind === "swatch") ? 0.12 * (1 - easeInOut((t - s.t0) / 0.6)) : 0;
    const room = this.tl.stageLeft ? 0 : firstCard ? 0.12 * easeInOut((t - firstCard.at + 0.1) / 0.5) : carried;
    const { v, m } = this.shot(g, s, t, aside || room ? { cx: STAGE.cx - W * (0.23 * aside + room) } : {});
    this.photoCard(g, s, t);
    const upper = v.zoom && UPPER.has(v.zoom.cue.part || "chest") && v.k > 0.5;
    this.topPill(g, s, t, { x: W / 2 - W * 0.23 * aside, y: upper ? H * 0.79 : H * 0.105 });
    this.swatches(g, s, t, { x: this.tl.stageLeft ? W * 0.69 : undefined, size: this.tl.stageLeft ? 185 : undefined, m: v.k > 0.05 ? null : m });
  },

  compare(g, s, t, lt) {
    studio(g, this.tl.kit);
    this.sectionHead(g, s, t);
    const k = easeOut(lt / 0.45);
    const k0 = s.index === 0 ? 1 : k;
    if (s.title) D.headline(g, s.title, { kind: this.tl.kit.headline, y: H * 0.095, italic: true, alpha: k0, size: this.tl.kit.headline === "serif" ? 72 : undefined });
    const zc = s.cues.find((c) => c.kind === "zoom");
    const zk = zc ? easeInOut((t - zc.at) / 0.7) : 1;
    const zoom = 1 + 0.38 * (1 - zk);
    g.save();
    g.translate(W / 2, H * 0.2);
    g.scale(zoom, zoom);
    g.translate(-W / 2, -H * 0.2);
    const sides = [
      ["left", W * 0.28, s.outfit],
      ["right", W * 0.72, s.outfit2],
    ];
    const p = this.tl.scenes[s.index - 1];
    const from = p && ["look", "motion"].includes(p.type) ? endOutfit(p) : null;
    const split = from && (from === s.outfit || from === s.outfit2) ? easeInOut(lt / 0.7) : 1;
    for (const [side, cx0, base] of sides) {
      const stays = base === from;
      const cx = split < 1 ? (stays ? W / 2 + (cx0 - W / 2) * split : cx0 + (side === "left" ? -1 : 1) * W * 0.5 * (1 - split)) : cx0;
      const bad = s.cues.filter((c) => c.kind === "pill" && (c.side ?? "center") === side && c.at <= t).at(-1)?.status === "bad";
      const m = this.model(g, s, t, { cx, feet: H * 0.875, height: H * 0.66, side, base, dim: bad ? clamp01((t - (s.cues.filter((c) => c.kind === "pill" && c.side === side && c.at <= t).at(-1)?.at ?? t)) / 0.4) : 0 });
      const label = side === "left" ? "Outfit 1" : "Outfit 2";
      const custom = this.topPill(g, s, t, { side, x: cx, y: m.rect.y - 46, size: 24 });
      if (!custom && !s.cues.some((c) => c.kind === "pill" && c.side === side)) D.pill(g, label, { x: cx, y: m.rect.y - 46, size: 24, alpha: k });
      this.annotations(g, { ...s, cues: s.cues.filter((c) => (c.side ?? "center") === side && c.kind !== "pill") }, t, m);
    }
    g.restore();
  },

  swatches(g, s, t) {
    studio(g, this.tl.kit);
    this.sectionHead(g, s, t);
    const m = this.model(g, s, t, this.tl.stageLeft ? {} : { cx: W * 0.4 });
    this.annotations(g, s, t, m);
    const cards = s.cues.filter((c) => c.kind === "swatch");
    const legend = cards.length >= 2 && cards.some((c) => c.target) && s.cues.some((c) => c.kind === "swap");
    this.swatches(g, s, t, { x: W * 0.69, legend, m, size: this.tl.stageLeft ? 185 : 150 });
    if (legend) {
      if (Number.isFinite(this._stackTop)) this.topPill(g, s, t, { x: W * 0.7 + 85, y: this._stackTop - 58, size: 26 });
    } else this.topPill(g, s, t, { x: W * 0.4 });
  },

  chapter(g, s, t, lt) {
    const style = this.tl.kit.chapter;
    const k = easeOut((lt - 0.05) / 0.55);
    const n = s.number || s.section?.n || 1;
    if (style === "check") {
      this.footage(g, s, t, lt);
      g.fillStyle = "rgba(10,10,10,0.55)";
      g.fillRect(0, 0, W, H);
      D.checkTitle(g, n, s.title ?? "", { k });
    } else if (style === "stack") {
      studio(g, this.tl.kit);
      D.photoStack(g, this.sectionPhotos(s, t), n, s.title ?? "", { k: easeBack((lt - 0.05) / 0.6, 1.2) });
    } else if (style === "label") {
      studio(g, this.tl.kit);
      g.save();
      g.globalAlpha = clamp01(lt / 0.2);
      g.fillStyle = D.INK;
      g.font = `22px "Plex Mono Medium"`;
      g.letterSpacing = "3px";
      g.textAlign = "center";
      g.fillText(`${s.file || `FILE ${String(n).padStart(3, "0")}`}`.toUpperCase(), W / 2, H * 0.4);
      g.restore();
      D.headline(g, s.title ?? "", { kind: "condensed", size: 230, y: H * 0.4 + 230 + (1 - k) * 30, alpha: k });
    } else if (style === "number") {
      studio(g, this.tl.kit);
      const next = this.tl.scenes.slice(s.index + 1).find((x) => x.outfit);
      const img = this.img("outfit", next?.outfit ?? s.outfit);
      if (img) D.standing(g, img, { cx: W * 0.7, feet: H * 0.84 + (1 - k) * 20, height: H * 0.56, alpha: k });
      D.bigNumber(g, n, s.title ?? "", { k, y: H * 0.5 });
    } else if (style === "header" || style === "none") {
      studio(g, this.tl.kit);
      this.sectionHead(g, s, t);
      g.save();
      g.globalAlpha = k;
      g.fillStyle = D.MUTED;
      g.font = `26px "Plex Mono Medium"`;
      g.letterSpacing = "4px";
      g.textAlign = "center";
      g.fillText(String(n).padStart(2, "0"), W / 2, H * 0.4);
      g.restore();
      D.headline(g, s.title ?? "", { italic: true, size: D.THEME.upper ? 104 : 132, y: H * 0.47 + (1 - k) * 24, alpha: k });
      g.save();
      g.strokeStyle = "rgba(30,30,28,0.4)";
      g.lineWidth = 1.5;
      const hw = 220 * easeInOut((lt - 0.2) / 0.6);
      g.beginPath();
      g.moveTo(W / 2 - hw, H * 0.5);
      g.lineTo(W / 2 + hw, H * 0.5);
      g.stroke();
      g.restore();
    } else {
      this.footage(g, s, t, lt);
      const thumbKey = `th-${s.index}`;
      if (!this.cache.has(thumbKey)) this.cache.set(thumbKey, makeThumb(this.img("item", s.thumb) ?? this.img("outfit", s.thumb ?? s.outfit), s.focus));
      const pk = easeBack((lt - 0.08) / 0.4, 1.5);
      const float = Math.sin(lt * 2.2) * 4;
      D.chapterPill(g, { n, word: s.title ?? "", thumb: this.cache.get(thumbKey), y: H * 0.48 + float, scale: 0.4 + 0.6 * pk, alpha: clamp01((lt - 0.08) / 0.12) });
    }
  },

  index(g, s, t, lt) {
    const style = this.tl.kit.index === "none" ? "grid" : this.tl.kit.index;
    if (style === "grid") return this.indexGrid(g, s, t, lt);
    if (style === "cards") return this.indexCards(g, s, t, lt);
    if (style === "list") {
      studio(g, this.tl.kit);
      D.headline(g, s.title ?? "", { y: H * 0.15, alpha: easeOut(lt / 0.4) });
      (s.sections ?? []).slice(0, 5).forEach((row, i) => {
        const y = H * 0.27 + i * 230;
        const rk = easeOut((lt - 0.2 - i * 0.14) / 0.45);
        D.listRow(g, i + 1, String(row.header ?? "").replace(/^\s*\d+\s*\/\s*/, ""), { y, k: rk });
        const img = row.outfits?.[0] ? this.img("outfit", row.outfits[0]) ?? this.img("item", row.outfits[0]) : null;
        if (img && rk > 0) D.standing(g, img, { cx: W - 200, feet: y + 30, height: 200, alpha: rk });
      });
      return;
    }
    studio(g, this.tl.kit);
    const k = easeOut(lt / 0.4);
    D.headline(g, s.title ?? "", { kind: this.tl.kit.headline, y: H * 0.13, italic: false, size: this.tl.kit.headline === "serif" ? 92 : undefined, alpha: k });
    const rows = s.sections ?? [];
    const top = H * 0.2;
    const rowH = Math.min(470, (H * 0.66) / Math.max(rows.length, 1));
    rows.forEach((row, i) => {
      const y = top + i * rowH + 10;
      const rk = (lt - 0.2 - i * 0.14) / 0.45;
      D.sectionHeader(g, row.header ?? "", { y, k: easeInOut(rk), alpha: clamp01(rk * 2) });
      const figs = (row.outfits ?? []).slice(0, 4);
      figs.forEach((key, j) => {
        const fk = easeOut((lt - 0.3 - i * 0.14 - j * 0.07) / 0.4);
        if (fk <= 0) return;
        const img = this.img("outfit", key) ?? this.img("item", key);
        const fh = rowH * 0.72;
        const cx = W / 2 + (j - (figs.length - 1) / 2) * Math.min(230, (W * 0.7) / Math.max(figs.length, 1));
        if (img) D.standing(g, img, { cx, feet: y + rowH * 0.86 + (1 - fk) * 18, height: fh, alpha: fk });
        else placeholder(g, { cx, feet: y + rowH * 0.86, height: fh }, key);
      });
    });
  },

  build(g, s, t, lt) {
    studio(g, this.tl.kit);
    const k = easeOut(lt / 0.35);
    const right = this.tl.style.build_column === "right";
    D.bigLabel(g, s.title ?? "", { file: s.file ?? "", y: 300, alpha: k });
    const m = this.model(g, s, t, { cx: right ? W * 0.38 : W * 0.64, height: H * 0.64, feet: H * 0.86 });
    const items = s.cues.filter((c) => c.kind === "item");
    this.pieceColumn(g, items, t, { cx: right ? W - 200 : 190, from: right ? 1 : -1 });
    this.annotations(g, { ...s, cues: s.cues.filter((c) => c.kind !== "item") }, t, m);
  },

  beforeafter(g, s, t, lt) {
    studio(g, this.tl.kit);
    const [la = "Before", lb = "Now"] = String(s.title || "").split("|");
    const halves = [
      [s.reference ? this.img("media", s.reference) : null, s.outfit, la, 0],
      [s.reference2 ? this.img("media", s.reference2) : null, s.outfit2, lb, 1],
    ];
    const at = s.cues.find((c) => c.kind === "pill")?.at ?? s.t0 + (s.t1 - s.t0) * 0.4;
    for (const [media, outfit, label, i] of halves) {
      const k = i ? easeInOut((t - at) / 0.5) : easeOut(lt / 0.4);
      if (k <= 0) continue;
      const x = i ? W / 2 + 4 : 0;
      const w = W / 2 - 4;
      g.save();
      g.beginPath();
      g.rect(x, 0, w * (i ? k : 1), H);
      g.clip();
      g.globalAlpha = i ? 1 : k;
      const fr = media?.frame ? media.frame(Math.floor(lt * media.fps)) : media;
      if (fr) {
        const sc = Math.max(w / fr.width, H / fr.height);
        g.drawImage(fr, x + w / 2 - (fr.width * sc) / 2, H * 0.42 - fr.height * sc * 0.42, fr.width * sc, fr.height * sc);
      } else {
        const img = this.img("outfit", outfit);
        if (img) D.standing(g, img, { cx: x + w / 2, feet: H * 0.84, height: H * 0.6 });
        else placeholder(g, { cx: x + w / 2, feet: H * 0.84, height: H * 0.6 }, outfit || "photo");
      }
      g.restore();
      g.save();
      g.globalAlpha = clamp01(k * 1.5);
      g.fillStyle = fr ? "#FFFFFF" : D.INK;
      g.shadowColor = fr ? "rgba(0,0,0,0.4)" : "transparent";
      g.shadowBlur = 14;
      g.font = `64px "Instrument Serif Italic"`;
      g.textAlign = "center";
      g.fillText(label, x + w / 2, H * 0.14);
      g.restore();
    }
    this.topPill(g, { ...s, cues: s.cues.filter((c) => c.kind !== "pill" || c.at > at + 0.01) }, t);
  },

  product(g, s, t, lt) {
    studio(g, this.tl.kit);
    const key = s.thumb || s.cues.find((c) => c.item)?.item || s.outfit;
    const img = this.img("item", key) ?? this.img("outfit", key);
    const bw = W * 0.8;
    const bh = H * 0.56;
    const sc = img ? Math.min(bw / img.width, bh / img.height) : 1;
    const rect = img ? { x: W / 2 - (img.width * sc) / 2, y: H * 0.47 - (img.height * sc) / 2, w: img.width * sc, h: img.height * sc } : { x: W * 0.2, y: H * 0.25, w: W * 0.6, h: H * 0.45 };
    const m = { rect, img, pointOf: (part, side) => itemPoint(rect, part, side), spanOf: (part) => itemSpan(rect, part) };
    const v = camera({ ...s, framing: "full" }, t, m);
    g.save();
    g.translate(v.sx, v.sy);
    g.scale(v.z, v.z);
    g.translate(-v.f.x, -v.f.y);
    if (img) {
      g.shadowColor = "rgba(0,0,0,0.18)";
      g.shadowBlur = 40;
      g.shadowOffsetY = 18;
      g.drawImage(img, rect.x, rect.y, rect.w, rect.h);
    } else placeholder(g, { cx: W / 2, feet: rect.y + rect.h, height: rect.h }, key);
    g.restore();
    if (v.k > 0.55 && /ring|circle/i.test(v.zoom?.cue?.text ?? "")) D.ring(g, v.sx, v.sy, 190, { k: easeOut((t - v.zoom.cue.at - 0.33) / 0.45), color: `rgba(255,255,255,${0.9 * clamp01((v.k - 0.55) / 0.3)})` });
    this.annotations(g, s, t, m, v.map);
    if (this.tl.kit.headline === "wide" && s.title) D.headline(g, s.title, { kind: "wide", y: H * 0.11, size: 52, alpha: easeOut(lt / 0.4) });
    this.topPill(g, s, t, { y: this.tl.kit.headline === "wide" && s.title ? H * 0.155 : H * 0.105, fade: 1 - clamp01(v.k / 0.25) });
    this.scale(g, s, t);
  },

  reference(g, s, t, lt) {
    const media = this.img("media", s.reference) ?? this.img("ref", s.reference);
    g.fillStyle = media ? "#1A1A19" : D.THEME.page;
    g.fillRect(0, 0, W, H);
    const frame = media?.frame ? media.frame(Math.floor(lt * media.fps)) : media;
    if (frame) {
      const z = media?.frame ? 1.02 : 1.02 + 0.06 * easeInOut(lt / Math.max(s.t1 - s.t0, 1));
      const sc = Math.max(W / frame.width, H / frame.height) * z;
      g.drawImage(frame, W / 2 - (frame.width * sc) / 2, H * 0.45 - (frame.height * sc) * 0.45, frame.width * sc, frame.height * sc);
      const fade = g.createLinearGradient(0, H * 0.7, 0, H);
      fade.addColorStop(0, "rgba(0,0,0,0)");
      fade.addColorStop(1, "rgba(0,0,0,0.42)");
      g.fillStyle = fade;
      g.fillRect(0, H * 0.7, W, H * 0.3);
    } else {
      g.save();
      g.strokeStyle = "rgba(30,30,28,0.35)";
      g.setLineDash([10, 10]);
      g.lineWidth = 2;
      g.strokeRect(110, H * 0.2, W - 220, H * 0.56);
      g.setLineDash([]);
      g.fillStyle = D.MUTED;
      g.font = `26px "${D.THEME.label}"`;
      g.textAlign = "center";
      g.fillText("PHOTO / CLIP GOES HERE", W / 2, H * 0.47);
      g.fillStyle = D.INK;
      g.fillText(String(s.reference ?? "").replace(/_/g, " ").toUpperCase(), W / 2, H * 0.47 + 44);
      g.restore();
    }
    D.corners(g, { color: media ? "rgba(255,255,255,0.75)" : "rgba(30,30,28,0.5)" });
    this.topPill(g, s, t);
    this.palette(g, s, t);
  },
};
SCENES.outro = SCENES.index;

SCENES.palette = function (g, s, t, lt) {
  studio(g, this.tl.kit);
  const k = easeOut(lt / 0.4);
  if (s.title) D.headline(g, s.title, { kind: this.tl.kit.headline, y: H * 0.3, italic: false, alpha: k, size: 110 });
  const dots = s.cues.filter((c) => c.kind === "pill" && c.status !== "bad");
  const loud = s.cues.find((c) => c.kind === "pill" && c.status === "bad");
  const r = 74;
  const gap = 40;
  const row = dots.length * (2 * r) + (dots.length - 1) * gap;
  const y = H * 0.47;
  dots.forEach((c, i) => {
    const cx = W / 2 - row / 2 + r + i * (2 * r + gap);
    const dt = t - c.at;
    g.save();
    g.setLineDash([8, 10]);
    g.strokeStyle = "rgba(30,30,28,0.28)";
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(cx, y, r, 0, Math.PI * 2 * 0.9995);
    g.stroke();
    g.restore();
    if (dt < 0) return;
    const kk = easeBack(clamp01(dt / 0.35), 1.7);
    g.save();
    g.fillStyle = c.color || "#888";
    g.shadowColor = "rgba(0,0,0,0.14)";
    g.shadowBlur = 16;
    g.beginPath();
    g.arc(cx, y, r * kk, 0, Math.PI * 2);
    g.fill();
    g.restore();
    if (c.text) D.pill(g, String(c.text).toUpperCase(), { x: cx, y: y + r + 50, size: 22, alpha: clamp01(dt / 0.2) });
  });
  if (dots.length && t > dots.at(-1).at + 0.4) D.pill(g, `${dots.length} COLOURS`, { x: W / 2, y: H * 0.64, size: 30, status: "good", alpha: clamp01((t - dots.at(-1).at - 0.4) / 0.2) });
  if (loud) {
    const dt = t - loud.at;
    if (dt > 0) {
      const xRest = W / 2 + row / 2 + r + 26;
      let x;
      let rot = 0;
      if (dt < 0.35) x = W + r + (xRest - W - r) * easeOut(dt / 0.35);
      else {
        const b = clamp01((dt - 0.45) / 0.55);
        x = xRest + (W + 2 * r - xRest) * (b * b);
        rot = b * 1.4;
      }
      g.save();
      g.translate(x, y);
      g.rotate(rot);
      g.fillStyle = loud.color || "#39FF14";
      g.beginPath();
      g.arc(0, 0, r * 0.8, 0, Math.PI * 2);
      g.fill();
      if (dt > 0.35) {
        g.strokeStyle = "#FFFFFF";
        g.lineWidth = 7;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(-18, -18);
        g.lineTo(18, 18);
        g.moveTo(18, -18);
        g.lineTo(-18, 18);
        g.stroke();
      }
      g.restore();
      if (dt > 0.4) D.pill(g, String(loud.text || "TOO LOUD").toUpperCase(), { x: W / 2, y: H * 0.72, size: 26, status: "bad", alpha: clamp01((dt - 0.4) / 0.2) });
    }
  }
};

SCENES.concept = function (g, s, t, lt) {
  studio(g, this.tl.kit);
  const words = String(s.title ?? "").split(/\s+/).filter(Boolean);
  let size = 168;
  g.save();
  g.font = `${size}px "${D.THEME.head}"`;
  while (g.measureText(String(s.title ?? "")).width > W - 140 && size > 80) g.font = `${(size -= 6)}px "${D.THEME.head}"`;
  g.textBaseline = "alphabetic";
  const widths = words.map((w) => g.measureText(`${w} `).width);
  const total = widths.reduce((a, b) => a + b, 0) - g.measureText(" ").width;
  let x = W / 2 - total / 2;
  const y = H * 0.43;
  words.forEach((w, i) => {
    const k = easeOut((lt - 0.05 - i * 0.12) / 0.4);
    g.globalAlpha = k;
    g.fillStyle = i === words.length - 1 ? D.THEME.accent || D.INK : D.INK;
    g.fillText(w, x, y + (1 - k) * 26);
    x += widths[i];
  });
  g.restore();
  const labels = s.cues.filter((c) => c.kind === "pill");
  if (!labels.length) return;
  const gap = 22;
  let ls = 32;
  let lw;
  g.save();
  for (;;) {
    g.font = `${ls}px "${D.THEME.label}"`;
    lw = labels.map((c) => g.measureText(String(c.text).toUpperCase()).width + ls * 2);
    if (lw.reduce((a, b) => a + b, 0) + gap * (labels.length - 1) <= W - 80 || ls <= 18) break;
    ls -= 2;
  }
  g.restore();
  const row = lw.reduce((a, b) => a + b, 0) + gap * (labels.length - 1);
  let lx = W / 2 - row / 2;
  const ly = H * 0.535;
  const hk = easeInOut((t - labels[0].at + 0.2) / 0.5);
  g.save();
  g.strokeStyle = "rgba(30,30,28,0.25)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(W / 2 - (row / 2) * hk, ly - 46);
  g.lineTo(W / 2 + (row / 2) * hk, ly - 46);
  g.stroke();
  g.restore();
  labels.forEach((c, i) => {
    const same = labels.slice(0, i).filter((x) => Math.abs(x.at - c.at) < 0.05).length;
    const dt = t - c.at - same * 0.16;
    const cx = lx + lw[i] / 2;
    lx += lw[i] + gap;
    if (dt < 0) return;
    const k = easeBack(clamp01(dt / 0.35), 1.6);
    if (c.color) {
      const cols = String(c.color).split("|");
      const r = 30 * easeBack(clamp01(dt / 0.35), 1.6);
      g.save();
      cols.forEach((col, j) => {
        g.fillStyle = col;
        g.strokeStyle = "rgba(30,30,28,0.18)";
        g.lineWidth = 2;
        g.beginPath();
        g.arc(cx + (j - (cols.length - 1) / 2) * 34, ly - 110, r, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      });
      g.restore();
    }
    D.pill(g, String(c.text).toUpperCase(), { x: cx, y: ly + (1 - clamp01(dt / 0.25)) * 18, size: ls, alpha: clamp01(dt / 0.15), scale: 0.85 + 0.15 * k, status: c.status || null });
  });
  if (s.stripes_in) stripes(g, s.stripes_in, lt / 0.5, "out");
};

SCENES.motion = function (g, s, t, lt) {
  studio(g, this.tl.kit);
  const clip = this.img("media", s.motion);
  const dur = Math.max(s.t1 - s.t0, 0.5);
  const key = `win-${s.index}`;
  if (!this.cache.has(key)) {
    const len = clip.count / clip.fps;
    const want = Math.min(len, dur * 1.4);
    let best = 0;
    if (Number.isFinite(s.clip_start)) best = Math.round(s.clip_start * clip.fps);
    else if (clip.motion?.length && want < len) {
      const m = clip.motion;
      const n = Math.round(want * clip.fps);
      let sum = m.slice(0, n).reduce((a, b) => a + b, 0);
      let top = sum;
      for (let i = 1; i + n <= m.length; i++) {
        sum += m[i + n - 1] - m[i - 1];
        if (sum > top) [top, best] = [sum, i];
      }
      best = Math.max(0, best - Math.round(clip.fps * 0.25));
    }
    this.cache.set(key, { start: best, rate: Number.isFinite(s.clip_start) ? 1 : Math.max(1, want / dur) });
  }
  const win = this.cache.get(key);
  const tkey = `tgt-${s.index}`;
  if (!this.cache.has(tkey)) {
    const full = clip.framing === "full" && D.THEME.plate;
    const { s: k, fromFeet, toFeet } = CLIP_MAP;
    const r = full ? { x: W / 2 - (W * k) / 2, y: H * toFeet - H * fromFeet * k, w: W * k, h: H * k } : { x: 0, y: 0, w: W, h: H };
    const sums = [0, 0, 0];
    let n = 0;
    for (const fx of [0.1, 0.8]) {
      const px = g.getImageData(Math.round(r.x + r.w * fx), Math.round(r.y + r.h * 0.25), Math.max(2, Math.round(r.w * 0.1)), Math.round(r.h * 0.35)).data;
      for (let i = 0; i < px.length; i += 16) (sums[0] += px[i]), (sums[1] += px[i + 1]), (sums[2] += px[i + 2]), n++;
    }
    this.cache.set(tkey, sums.map((v) => v / Math.max(1, n)));
  }
  const fr = this.matchedFrame(clip, win.start + Math.floor(lt * clip.fps * win.rate), s.index, this.cache.get(tkey));
  if (clip.framing === "full" && D.THEME.plate) {
    const { s: k, fromFeet, toFeet } = CLIP_MAP;
    const w = W * k;
    const h = H * k;
    const x0 = W / 2 - w / 2;
    const y0 = H * toFeet - H * fromFeet * k;
    const tmp = this.pool[2];
    const tg = tmp.getContext("2d");
    reset(tg);
    tg.clearRect(0, 0, W, H);
    tg.drawImage(fr, x0, y0, w, h);
    tg.globalCompositeOperation = "destination-in";
    const fx = tg.createLinearGradient(x0, 0, x0 + w, 0);
    fx.addColorStop(0, "rgba(0,0,0,0)");
    fx.addColorStop(0.12, "rgba(0,0,0,1)");
    fx.addColorStop(0.88, "rgba(0,0,0,1)");
    fx.addColorStop(1, "rgba(0,0,0,0)");
    tg.fillStyle = fx;
    tg.fillRect(0, 0, W, H);
    const fy = tg.createLinearGradient(0, 0, 0, H);
    fy.addColorStop(0, "rgba(0,0,0,0)");
    fy.addColorStop(Math.max(0, y0 / H), "rgba(0,0,0,0)");
    fy.addColorStop(Math.min(0.5, (y0 + h * 0.1) / H), "rgba(0,0,0,1)");
    fy.addColorStop(Math.min(0.99, (y0 + h * 0.88) / H), "rgba(0,0,0,1)");
    fy.addColorStop(Math.min(1, (y0 + h) / H), "rgba(0,0,0,0)");
    fy.addColorStop(1, "rgba(0,0,0,0)");
    tg.fillStyle = fy;
    tg.fillRect(0, 0, W, H);
    reset(tg);
    g.drawImage(tmp, 0, 0);
  } else {
    const sc = Math.max(W / fr.width, H / fr.height) * 1.08;
    g.drawImage(fr, W / 2 - (fr.width * sc) / 2, H * 0.47 - (fr.height * sc) * 0.47, fr.width * sc, fr.height * sc);
    if (["dots", "grid", "lines"].includes(D.THEME.texture)) keyToPage(g);
  }
  if (D.THEME.corners) D.corners(g);
  const [fx, fy, fh] = s.figure ?? [0.5, 0.855 - 0.665, 0.665];
  const fig = { rect: { x: W * fx - H * fh * 0.19, y: H * fy, w: H * fh * 0.38, h: H * fh }, img: null };
  this.annotations(g, s, t, fig);
  this.sectionHead(g, s, t);
  this.topPill(g, s, t, clip.framing === "feet" ? {} : { y: H * 0.8 });
  if (s.stripes_out) stripes(g, s.stripes_out, easeInOut((t - (s.t1 - 0.42)) / 0.42), "in");
};

function stripes(g, colours, k, mode) {
  if (k <= 0 || !colours?.length) return;
  const n = colours.length;
  const w = W / n;
  g.save();
  colours.forEach((c, i) => {
    const kk = clamp01(k * 1.35 - (i / n) * 0.35);
    const e = easeInOut(kk);
    const h = mode === "in" ? H * e : H * (1 - e);
    g.fillStyle = c;
    if (mode === "in") g.fillRect(i * w - 1, 0, w + 2, h);
    else g.fillRect(i * w - 1, H - h, w + 2, h);
  });
  g.restore();
}

function keyToPage(g) {
  const pg = D.page();
  const pd = pg.getContext("2d").getImageData(0, 0, W, H).data;
  const im = g.getImageData(0, 0, W, H);
  const d = im.data;
  const n = /^#?([0-9a-f]{6})$/i.exec(D.THEME.page ?? "#FAFAF8");
  const v = parseInt(n?.[1] ?? "FAFAF8", 16);
  const pr = v >> 16;
  const pgc = (v >> 8) & 255;
  const pb = v & 255;
  const C = 6;
  const cw = Math.ceil(W / C);
  const ch = Math.ceil(H / C);
  const like = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const i = (Math.min(H - 1, y * C + 3) * W + Math.min(W - 1, x * C + 3)) * 4;
    like[y * cw + x] = Math.max(Math.abs(d[i] - pr), Math.abs(d[i + 1] - pgc), Math.abs(d[i + 2] - pb)) < 22 ? 1 : 0;
  }
  const bg = new Uint8Array(cw * ch);
  const stack = [];
  for (let x = 0; x < cw; x++) stack.push(x, (ch - 1) * cw + x);
  for (let y = 0; y < ch; y++) stack.push(y * cw, y * cw + cw - 1);
  while (stack.length) {
    const q = stack.pop();
    if (bg[q] || !like[q]) continue;
    bg[q] = 1;
    const x = q % cw;
    if (x > 0) stack.push(q - 1);
    if (x < cw - 1) stack.push(q + 1);
    if (q >= cw) stack.push(q - cw);
    if (q < cw * (ch - 1)) stack.push(q + cw);
  }
  for (let i = 0; i < d.length; i += 4) {
    const px = (i / 4) % W;
    const py = Math.floor(i / 4 / W);
    if (!bg[Math.floor(py / C) * cw + Math.floor(px / C)]) continue;
    const diff = Math.max(Math.abs(d[i] - pr), Math.abs(d[i + 1] - pgc), Math.abs(d[i + 2] - pb));
    if (diff >= 22) continue;
    const w = diff <= 10 ? 1 : (22 - diff) / 12;
    d[i] += (pd[i] - d[i]) * w;
    d[i + 1] += (pd[i + 1] - d[i + 1]) * w;
    d[i + 2] += (pd[i + 2] - d[i + 2]) * w;
  }
  g.putImageData(im, 0, 0);
}

Renderer.prototype.matchedFrame = function (clip, n, sceneIndex, target) {
  const fr = clip.frame(n);
  const w = fr.width;
  const h = fr.height;
  if (!this._match || this._match.canvas.width !== w || this._match.canvas.height !== h) {
    const c = createCanvas(w, h);
    this._match = { canvas: c, g: c.getContext("2d"), gains: new Map() };
  }
  const { canvas, g: mg, gains } = this._match;
  reset(mg);
  mg.drawImage(fr, 0, 0);
  const im = mg.getImageData(0, 0, w, h);
  const d = im.data;
  const sums = [0, 0, 0];
  let count = 0;
  const sx = Math.max(2, Math.round(w * 0.09));
  for (let y = Math.round(h * 0.25); y < h * 0.6; y += 6) {
    for (const x0 of [Math.round(w * 0.03), w - Math.round(w * 0.03) - sx]) {
      for (let x = x0; x < x0 + sx; x += 4) {
        const i = (y * w + x) * 4;
        sums[0] += d[i];
        sums[1] += d[i + 1];
        sums[2] += d[i + 2];
        count++;
      }
    }
  }
  const want = sums.map((v, k) => Math.max(0.72, Math.min(1.3, target[k] / Math.max(1, v / count))));
  const prev = gains.get(sceneIndex);
  const gain = prev ? prev.map((v, k) => v + (want[k] - v) * 0.15) : want;
  gains.set(sceneIndex, gain);
  if (gain.every((v) => Math.abs(v - 1) < 0.01)) return fr;
  const lut = gain.map((gk) => Uint8ClampedArray.from({ length: 256 }, (_, v) => v * gk));
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[0][d[i]];
    d[i + 1] = lut[1][d[i + 1]];
    d[i + 2] = lut[2][d[i + 2]];
  }
  mg.putImageData(im, 0, 0);
  return canvas;
};

const ITEM_PARTS = {
  collar: [0.5, 0.06], neck: [0.5, 0.06], shoulders: [0.24, 0.1], chest: [0.5, 0.3], sleeve: [0.1, 0.28], cuff: [0.06, 0.4],
  waist: [0.5, 0.62], belt: [0.5, 0.62], hips: [0.5, 0.7], shirt_hem: [0.5, 0.94], hem: [0.5, 0.94], hands: [0.08, 0.42],
  thighs: [0.5, 0.5], knees: [0.5, 0.6], ankles: [0.5, 0.9], feet: [0.5, 0.85], face: [0.5, 0.2], head: [0.5, 0.15], hair: [0.5, 0.1],
};
function itemPoint(rect, part, side) {
  const [fx, fy] = ITEM_PARTS[part] ?? [0.5, 0.4];
  const x = side === "right" && fx < 0.5 ? 1 - fx : fx;
  return { x: rect.x + rect.w * x, y: rect.y + rect.h * fy };
}
function itemSpan(rect, part) {
  const [, fy] = ITEM_PARTS[part] ?? [0.5, 0.4];
  return { x0: rect.x + rect.w * 0.12, x1: rect.x + rect.w * 0.88, y: rect.y + rect.h * fy };
}

const FOCUS_Y = { face: 0.1, torso: 0.3, legs: 0.68, feet: 0.9 };
const ALT = { face: { fy: 0.16, fx: 0.12, zoom: 3.4 }, torso: { fy: 0.22, fx: 0.2, zoom: 2.9 }, legs: { fy: 0.8, fx: -0.12, zoom: 2.8 }, feet: { fy: 0.93, fx: 0.1, zoom: 3 } };
Renderer.prototype.chapterShots = function (s) {
  const key = `shots-${s.index}`;
  if (this.cache.has(key)) return this.cache.get(key);
  const rest = this.tl.scenes.slice(s.index + 1);
  const end = rest.findIndex((x) => x.type === "chapter");
  const next = rest.slice(0, end < 0 ? undefined : end).find((x) => x.outfit && x.type !== "index");
  const a = this.img("outfit", s.outfit) ?? this.img("item", s.thumb);
  const nextImg = next && next.outfit !== s.outfit ? this.img("outfit", next.outfit) : null;
  const focus = s.focus in FOCUS_Y ? s.focus : "torso";
  const shots = [
    a && { img: a, fy: FOCUS_Y[focus], fx: 0, zoom: focus === "face" ? 3.2 : 2.1, dir: 1, seed: s.index * 7 + 1 },
    nextImg ? { img: nextImg, fy: FOCUS_Y[focus], fx: 0, zoom: 2.4, dir: -1, seed: s.index * 7 + 3 } : a && { img: a, ...ALT[focus], dir: -1, seed: s.index * 7 + 5 },
  ];
  this.cache.set(key, shots);
  return shots;
};

Renderer.prototype.handheld = function (g, shot, st, t) {
  this.small ??= createCanvas(W / 4, H / 4);
  const sg = this.small.getContext("2d");
  reset(sg);
  sg.fillStyle = "#8E8D89";
  sg.fillRect(0, 0, W / 4, H / 4);
  if (shot) {
    const { img, fy, fx = 0, zoom, dir, seed } = shot;
    const sc = ((W / 4) / img.width) * zoom * (1 + 0.025 * st);
    const w = img.width * sc;
    const h = img.height * sc;
    const swayX = 3.2 * Math.sin(st * 1.3 + seed) + 1.4 * Math.sin(st * 3.1 + seed * 2);
    const swayY = 2.2 * Math.sin(st * 1.7 + seed * 3);
    const tilt = dir * 14 * st;
    const blur = 3.2 + 1.3 * Math.sin(st * 2.4 + seed);
    sg.save();
    sg.filter = `blur(${blur.toFixed(2)}px) brightness(0.86) contrast(1.06) saturate(0.92)`;
    sg.translate(W / 8, H / 8);
    sg.rotate(0.006 * Math.sin(st * 1.1 + seed));
    sg.drawImage(img, -w / 2 - w * fx + swayX, -h * fy + swayY - tilt, w, h);
    sg.restore();
  }
  reset(g);
  g.imageSmoothingQuality = "high";
  g.drawImage(this.small, 0, 0, W, H);
  vignette(g);
};

function softFrame(g, fr, { blur = 9, z = 1 } = {}) {
  const sc = Math.max(W / fr.width, H / fr.height) * z;
  reset(g);
  g.filter = `blur(${blur}px) brightness(0.88)`;
  g.drawImage(fr, W / 2 - (fr.width * sc) / 2, H / 2 - (fr.height * sc) / 2, fr.width * sc, fr.height * sc);
  g.filter = "none";
  vignette(g);
}

function vignette(g) {
  const v = g.createRadialGradient(W / 2, H * 0.48, H * 0.2, W / 2, H * 0.48, H * 0.78);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.38)");
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
}

const GRAIN = [];
function grain(g, f) {
  if (!GRAIN.length) {
    for (let n = 0; n < 4; n++) {
      const c = createCanvas(270, 480);
      const cg = c.getContext("2d");
      const im = cg.createImageData(270, 480);
      let seed = 97 + n * 131;
      for (let i = 0; i < im.data.length; i += 4) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const v = seed >>> 24;
        im.data[i] = im.data[i + 1] = im.data[i + 2] = v;
        im.data[i + 3] = 255;
      }
      cg.putImageData(im, 0, 0);
      GRAIN.push(c);
    }
  }
  g.save();
  g.globalAlpha = 0.07;
  g.globalCompositeOperation = "overlay";
  g.drawImage(GRAIN[f % GRAIN.length], 0, 0, W, H);
  g.restore();
}

function makeThumb(img, focus) {
  const c = createCanvas(320, 320);
  const g = c.getContext("2d");
  g.fillStyle = "#E7E6E3";
  g.fillRect(0, 0, 320, 320);
  if (!img) return c;
  if (img.height > img.width * 1.4) {
    const fy = { face: 0.08, torso: 0.3, legs: 0.68, feet: 0.9 }[focus] ?? 0.6;
    const s = 320 / (img.width * 0.55);
    g.drawImage(img, 160 - (img.width * s) / 2, 160 - img.height * s * fy, img.width * s, img.height * s);
  } else {
    const s = Math.min(280 / img.width, 280 / img.height);
    g.drawImage(img, 160 - (img.width * s) / 2, 160 - (img.height * s) / 2, img.width * s, img.height * s);
  }
  return c;
}

const MOVES = new Set(["zoomin", "zoomout", "riser", "swoosh", "sweep", "air"]);
export function sfxCues(tl) {
  const ev = [];
  const turn = {};
  const add = (names, at, gain, priority = 1) => {
    const list = [].concat(names);
    const key = list.join("|");
    const name = list[(turn[key] = (turn[key] ?? -1) + 1) % list.length];
    ev.push({ name, at, gain, priority });
  };
  for (const s of tl.scenes) {
    if (s.type === "chapter") {
      const style = tl.kit?.chapter;
      if (style === "pill" || style === "check") {
        add("riser", s.t0 - 0.55, 0.3, 3);
        add("thump", s.t0 + 0.1, style === "check" ? 0.7 : 0.55, 3);
      } else if (style === "stack") {
        add("swoosh", s.t0 + 0.02, 0.4, 3);
        add("thump", s.t0 + 0.35, 0.4, 3);
      } else add("sweep", s.t0 + 0.1, 0.32, 3);
    }
    if (s.enter === "pullback") add("zoomout", s.t0 + 0.02, 0.32, 2);
    if (s.enter === "wipe") add("swoosh", s.t0, 0.28, 1);
    if (s.type === "index" || s.type === "outro") (s.sections ?? []).forEach((_, i) => add("click", s.t0 + 0.25 + i * 0.14, 0.32, 1));
    if (s.stripes_out) add("swoosh", s.t1 - 0.42, 0.36, 3);
    if (s.type === "palette") {
      const loud = s.cues.find((c) => c.kind === "pill" && c.status === "bad");
      if (loud) add("thump", loud.at + 0.35, 0.4, 2);
    }
    for (const c of s.cues.filter((x) => !x.carried && (s.type !== "motion" || ["pill", "device", "note", "vguide", "hguide", "dot"].includes(x.kind)))) {
      if (c.kind === "pill") add(["blip", "click"], c.at + 0.02, 0.42, 2);
      else if (c.kind === "dot") add("pop", c.at + 0.02, 0.3, 1);
      else if (c.kind === "note") add("pen", c.at + 0.04, 0.34, 1);
      else if (c.kind === "hguide" || c.kind === "vguide") add("sweep", c.at, 0.3, 1);
      else if (c.kind === "box") add("air", c.at, 0.3, 1);
      else if (c.kind === "isolate") add("air", c.at, 0.32, 2);
      else if (c.kind === "sweep" && !c.auto) add("air", c.at, 0.3, 1);
      else if (c.kind === "lift") add("air", c.at, 0.3, 1);
      else if (c.kind === "trace") add("sweep", c.at, 0.28, 1);
      else if (c.kind === "texture") add("sweep", c.at + 0.1, 0.26, 1);
      else if (c.kind === "recolour") add("blip", c.at, 0.3, 1);
      else if (c.kind === "photo") add("swoosh", c.at, 0.34, 2);
      else if (c.kind === "product") add(["pop", "blip"], c.at + 0.05, 0.38, 2);
      else if (c.kind === "scale") add("sweep", c.at + 0.25, 0.3, 1);
      else if (c.kind === "device") for (const e of (DEVICES[c.item]?.sfx ?? []).slice(0, 3)) if (["pop", "tick", "swoosh", "sweep", "pen", "click", "blip", "air"].includes(e.name)) add(e.name, c.at + Math.max(0, Math.min(3, Number(e.at) || 0)), Math.max(0.1, Math.min(0.6, Number(e.gain) || 0.3)), 1);
      else if (c.kind === "shift") {
        add("pop", c.at + 0.02, 0.3, 1);
        add("sweep", c.at + 0.45, 0.28, 1);
        add("blip", c.at + 0.9, 0.34, 1);
      }
      else if (c.kind === "swatch") add("swoosh", c.at, 0.34, 1);
      else if (c.kind === "swap") {
        add("click", c.at - 0.06, 0.5, 2);
        if (PIECE_ROWS[area(c.part)]) {
          add("blip", c.at + 0.12, 0.26, 1);
          add("air", c.at + 0.5, 0.3, 2);
        }
      }
      else if (c.kind === "flash") add("blip", c.at + 0.02, 0.28, 1);
      else if (c.kind === "item") add(["pop", "blip"], c.at, 0.36, 1);
      else if (c.kind === "zoom") {
        const z = zoomTimes(s, c);
        add("zoomin", c.at, 0.38, 3);
        if (!z.stays) add("zoomout", z.outStart, 0.3, 2);
      }
    }
  }
  const kept = { move: [], hit: [] };
  for (const e of ev.filter((x) => x.at >= 0 && x.at < tl.total).sort((a, b) => a.at - b.at)) {
    const lane = kept[MOVES.has(e.name) ? "move" : "hit"];
    const prev = lane.at(-1);
    if (prev && e.at - prev.at < 0.3) {
      if (e.priority > prev.priority) lane[lane.length - 1] = e;
      continue;
    }
    lane.push(e);
  }
  return [...kept.move, ...kept.hit].sort((a, b) => a.at - b.at);
}

const CODE = createHash("sha1")
  .update(readFileSync(fileURLToPath(import.meta.url)))
  .update(readFileSync(fileURLToPath(new URL("./design.js", import.meta.url))))
  .update(readFileSync(fileURLToPath(new URL("./body.js", import.meta.url))))
  .update(readFileSync(fileURLToPath(new URL("./lock.js", import.meta.url))))
  .update(readFileSync(fileURLToPath(new URL("./index.js", import.meta.url))))
  .digest("hex")
  .slice(0, 8);
const VIDEO = ["-c:v", "libx264", "-preset", "slow", "-crf", "15", "-pix_fmt", "yuv420p", "-r", String(FPS)];

export async function renderVideo(tl, { voice, sfx = null, music = null, musicStart = 0, out, cacheDir, mediaKeys = {}, log = () => {} }) {
  await fs.mkdir(cacheDir, { recursive: true });
  const totalFrames = Math.ceil(tl.total * FPS);
  const pieces = tl.scenes.map((s, i) => {
    const f0 = i === 0 ? 0 : Math.round(s.t0 * FPS);
    const f1 = i === tl.scenes.length - 1 ? totalFrames : Math.round(tl.scenes[i + 1].t0 * FPS);
    const sig = createHash("sha1")
      .update(JSON.stringify({ CODE, f0, f1, look: tl.look, s: plain(s), prev: plain(tl.scenes[i - 1]), next: plain(tl.scenes[i + 1]), media: mediaKeys, chunks: tl.chunks.filter((c) => c.end > f0 / FPS && c.start < f1 / FPS) }))
      .digest("hex")
      .slice(0, 12);
    return { i, f0, f1, file: path.join(cacheDir, `scene-${String(i + 1).padStart(2, "0")}-${sig}.mp4`) };
  }).filter((p) => p.f1 > p.f0);
  const todo = [];
  for (const p of pieces) if (!(await fs.stat(p.file).catch(() => null))) todo.push(p);
  log(todo.length === pieces.length ? `Render: all ${pieces.length} scenes` : `Render: ${todo.length} of ${pieces.length} scenes changed, reusing the rest`);
  const r = new Renderer(tl);
  for (const [k, p] of todo.entries()) {
    await encode(r, p.f0, p.f1, `${p.file}.tmp.mp4`);
    await fs.rename(`${p.file}.tmp.mp4`, p.file);
    log(`Render: scene ${p.i + 1} (${k + 1}/${todo.length})`);
  }
  const keep = new Set(pieces.map((p) => path.basename(p.file)));
  for (const f of await fs.readdir(cacheDir)) if (!keep.has(f) && f !== "clips") await fs.rm(path.join(cacheDir, f), { force: true });
  const list = path.join(cacheDir, "..", "scenes.txt");
  await fs.writeFile(list, pieces.map((p) => `file '${p.file.replace(/'/g, "'\\''")}'`).join("\n"));

  const inputs = ["-f", "concat", "-safe", "0", "-i", list, "-i", voice];
  let filter = "[1:a]apad,loudnorm=I=-14:TP=-1.5[vo]";
  let bed = "[vo]";
  let n = 2;
  if (sfx) {
    inputs.push("-i", sfx);
    filter += `;[${n}:a]volume=0.9[sx];[vo][sx]amix=inputs=2:duration=first:normalize=0[vs]`;
    bed = "[vs]";
    n++;
  }
  if (music) {
    inputs.push("-stream_loop", "-1", "-ss", String(musicStart), "-i", music);
    filter +=
      `;${bed}asplit=2[b1][b2];[${n}:a]loudnorm=I=-30:TP=-3,afade=t=out:st=${Math.max(tl.total - 1.5, 0).toFixed(2)}:d=1.5[m];` +
      `[m][b2]sidechaincompress=threshold=0.05:ratio=5:attack=20:release=350[md];[b1][md]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1:LRA=9[a]`;
  } else filter += `;${bed}loudnorm=I=-14:TP=-1:LRA=9[a]`;
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", filter, "-map", "0:v", "-map", "[a]", "-t", tl.total.toFixed(3), "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]);
}

const plain = (s) => (s ? { ...s, cues: s.cues.map(({ _pos, ...c }) => c) } : null);

async function encode(r, f0, f1, out) {
  const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-r", String(FPS), "-i", "-", ...VIDEO, out], { stdio: ["pipe", "ignore", "pipe"] });
  let err = "";
  ff.stderr.on("data", (d) => (err += d));
  const done = new Promise((res, rej) => {
    ff.on("error", rej);
    ff.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg: ${err.slice(-400)}`))));
  });
  for (let f = f0; f < f1; f++) {
    const c = r.frame(f / FPS);
    const px = Buffer.from(c.getContext("2d").getImageData(0, 0, W, H).data.buffer);
    if (!ff.stdin.write(px)) await new Promise((res) => ff.stdin.once("drain", res));
  }
  ff.stdin.end();
  await done;
}

export function stillAt(tl, t) {
  return new Renderer(tl).frame(t).toBuffer("image/png");
}
