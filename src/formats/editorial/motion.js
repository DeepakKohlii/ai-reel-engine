import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { config } from "../../config.js";
import { run } from "../../util.js";
import { PLUGINS } from "../../motions/index.js";
import { drawPiece, getTheme, isLight, layoutLockup, mix, parseLockup, pieceColor } from "./design.js";

const FPS = 30;
const WIPE = 0.38;

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeOutCubic = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const easeOutExpo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp01(x)));
const easeInOutSine = (x) => -(Math.cos(Math.PI * clamp01(x)) - 1) / 2;
const easeInOutCubic = (x) => ((x = clamp01(x)) < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOutBack = (x) => {
  const c1 = 1.5;
  const t = clamp01(x) - 1;
  return 1 + (c1 + 1) * t * t * t + c1 * t * t;
};
const norm = (w) => String(w).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export function canvasSize(aspect) {
  return aspect === "16:9" ? { W: 1920, H: 1080 } : { W: 1080, H: 1920 };
}

const PERSON = new Set(["model", "host"]);
const SAFE_BOTTOM = 0.87;
export const MOTIONS = ["rise", "mask", "typewriter", "slam", "stack", "snap"];

function resolveLayout(v, align, vertical) {
  if (!v || v.kind === "none") return "type";
  if (PLUGINS[v.layout]?.accepts(v)) return v.layout;
  if (v.kind === "flow") return "flow";
  if (["outfit", "compare"].includes(v.kind) && v.layout === "cards") return "cards";
  if (v.kind === "compare" && ["slider", "verdict"].includes(v.layout)) return v.layout;
  if (["outfit", "compare"].includes(v.kind) && v.layout === "scale") return "scale";
  if (["outfit", "compare"].includes(v.kind) && v.layout === "duo" && v.images.length >= 2) return "duo";
  if (v.layout === "mosaic" && v.mosaic?.length && v.images.length) return "mosaic";
  if (["swatches", "shades", "outfit", "compare"].includes(v.kind)) return "board";
  const person = PERSON.has(v.assetKind);
  let chosen = v.layout && v.layout !== "auto" ? v.layout : null;
  if (chosen === "sandwich" && person) chosen = align === "center" ? "hero" : "side";
  if (chosen) return chosen;
  const kind = v.assetKind;
  if (kind === "prop") return "edge";
  if (kind === "item") return "sandwich";
  return align === "center" ? "hero" : "side";
}

const outlines = new WeakMap();
function stickerOutline(img) {
  if (outlines.has(img)) return outlines.get(img);
  const pad = Math.round(Math.max(img.width, img.height) * 0.028);
  const c = createCanvas(img.width + pad * 2, img.height + pad * 2);
  const g = c.getContext("2d");
  for (let a = 0; a < 24; a++) {
    const r = (a / 24) * Math.PI * 2;
    g.drawImage(img, pad + Math.cos(r) * pad, pad + Math.sin(r) * pad);
  }
  g.globalCompositeOperation = "source-in";
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = "source-over";
  g.drawImage(img, pad, pad);
  const out = { canvas: c, pad };
  outlines.set(img, out);
  return out;
}

const BODY = [
  [/\b(shoes?|sneakers?|boots?|loafers?|sole|canvas|kicks|joote|chappal|sandals?|derby|heels?)\b/i, { x: 0.12, y: 0.95 }],
  [/\b(hem|break|ankle|socks?)\b/i, { x: 0.12, y: 0.88 }],
  [/\b(jeans|pants?|trousers?|cargos?|chinos?|denim|shorts|fit|baggy|wide)\b/i, { x: 0.16, y: 0.66 }],
  [/\b(belt|waist|tuck)\b/i, { x: 0.18, y: 0.47 }],
  [/\b(watch|bracelet|wrist|ring)\b/i, { x: 0.36, y: 0.5 }],
  [/\b(shirt|tee|t-shirt|tshirt|polo|jacket|overshirt|kurta|blazer|hoodie|sweater|knit|collar|chest)\b/i, { x: 0.2, y: 0.3 }],
  [/\b(hair|face|beard|glasses|sunglasses|cap)\b/i, { x: 0.1, y: 0.07 }],
];
function noteTarget(...texts) {
  for (const t of texts) for (const [re, spot] of BODY) if (re.test(String(t ?? ""))) return spot;
  return null;
}

export function buildTimeline({ beats, narration, visuals, aspect, palette = [], typeset = "editorial", sticker = null, look = {}, musicBeats = [], keyword = "" }) {
  const size = canvasSize(aspect);
  const letterbox = look.frame === "letterbox" && size.H > size.W;
  const W = size.W;
  const H = letterbox ? Math.round(W * 1.25) : size.H;
  const u = Math.min(W, H) / 1080;
  const vertical = H > W;
  const scratch = createCanvas(10, 10).getContext("2d");

  const starts = beats.map((_, i) => narration.lines[i]?.[0]?.start);
  const timeline = beats.map((beat, i) => {
    const t0 = i === 0 ? 0 : Math.max(0, (starts[i] ?? 0) - 0.08);
    return { beat, index: i, t0 };
  });
  const total = narration.duration + 0.6;
  timeline.forEach((b, i) => (b.t1 = timeline[i + 1]?.t0 ?? total));

  let prevTheme = null;
  let prevKey = null;
  let prevRect = null;
  for (const b of timeline) {
    const { beat } = b;
    b.theme = getTheme(beat.theme, palette);
    b.wipeFrom = prevTheme && prevTheme.bg !== b.theme.bg ? prevTheme : null;
    prevTheme = b.theme;

    const v = visuals[b.index];
    b.visual = v && v.kind !== "none" && (v.images.length || v.colors.length) ? v : null;
    const align = beat.align || "left";
    b.layout = resolveLayout(b.visual, align, vertical);
    if (beat.visual?.layout === "dm") b.layout = "dm";
    if (beat.text_style === "caption" && b.layout === "side" && b.visual && PERSON.has(b.visual.assetKind)) b.layout = "hero";
    b.images = [];
    b.camera = ["punch", "rotate"].includes(beat.camera) ? beat.camera : "none";
    b.transition = beat.transition === "letter" ? "letter" : "cut";

    const person = b.visual && PERSON.has(b.visual.assetKind);
    if (b.camera === "punch" && person) b.camera = "none";
    const img = b.visual?.images[0]?.img;
    const place = (h, cx, bottom, extra = {}) => {
      const w = (img.width / img.height) * h;
      return { img, x: cx - w / 2, y: bottom - h, w, h, ...extra };
    };

    if (PLUGINS[b.layout] && b.t1 - b.t0 < PLUGINS[b.layout].minBeat - 0.3) b.layout = PLUGINS[b.layout].fallback;
    if (PLUGINS[b.layout]) PLUGINS[b.layout].geometry({ b, beat, W, H, u, vertical, align, letterbox });
    else switch (b.layout) {
      case "sandwich": {
        b.textCenter = { x: W / 2, y: vertical ? H * 0.45 : H * 0.52 };
        b.maxTextWidth = vertical ? W * 0.9 : W * 0.72;
        b.heroBehind = person;
        b.sandwich = { person, shift: align === "left" ? 0.1 : align === "right" ? -0.1 : 0 };
        break;
      }
      case "side": {
        const imageRight = align !== "right";
        const focus = person ? b.visual.focus ?? "full" : "full";
        const h =
          focus === "upper" ? (vertical ? H * 1.02 : H * 1.3)
          : focus === "lower" ? (vertical ? H * 1.45 : H * 1.8)
          : vertical ? H * 0.74 : H * 0.94;
        const bottom = focus === "upper" ? H + h * 0.26 : H * (vertical ? SAFE_BOTTOM : 0.97);
        const w = (img.width / img.height) * h;
        const cx = imageRight ? W - w / 2 + w * (focus === "full" ? 0.02 : 0.1) : w / 2 - w * (focus === "full" ? 0.02 : 0.1);
        b.images.push(place(h, cx, bottom, { enter: imageRight ? "slideLeft" : "slideRight" }));
        b.textCenter = vertical
          ? { x: imageRight ? W * 0.36 : W * 0.64, y: H * 0.36 }
          : { x: imageRight ? W * 0.36 : W * 0.64, y: H * 0.5 };
        b.maxTextWidth = vertical ? W * 0.64 : W * 0.5;
        break;
      }
      case "hero": {
        const focus = person ? b.visual.focus ?? "full" : "full";
        const h =
          focus === "upper" ? (vertical ? H * 0.74 : H * 1.0)
          : focus === "lower" ? (vertical ? H * 1.3 : H * 1.7)
          : vertical ? H * 0.68 : H * 0.84;
        const bottom = focus === "upper" ? H + h * 0.08 : H * (vertical ? SAFE_BOTTOM : 0.97);
        b.images.push(place(h, W / 2, bottom, { enter: "rise" }));
        b.textCenter = { x: W / 2, y: vertical ? H * 0.15 : H * 0.16 };
        b.maxTextWidth = W * 0.9;
        break;
      }
      case "edge": {
        const fromLeft = align === "right";
        const maxW = vertical ? W * 0.6 : W * 0.4;
        const h = Math.min(vertical ? H * 0.28 : H * 0.6, (maxW * img.height) / img.width);
        const w = (img.width / img.height) * h;
        const cx = fromLeft ? w * 0.38 : W - w * 0.38;
        b.images.push(place(h, cx, vertical ? H * 0.8 : H * 0.85, { enter: fromLeft ? "fromLeft" : "fromRight" }));
        b.textCenter = vertical ? { x: W / 2, y: H * 0.34 } : { x: fromLeft ? W * 0.62 : W * 0.38, y: H * 0.45 };
        b.maxTextWidth = vertical ? W * 0.88 : W * 0.55;
        break;
      }
      case "cards": {
        const imgs = b.visual.images.slice(0, 4);
        const n = imgs.length;
        const spots = vertical
          ? {
              1: [[0.5, 0.64, -3]],
              2: [[0.3, 0.6, -6], [0.7, 0.7, 5]],
              3: [[0.27, 0.55, -7], [0.74, 0.58, 5], [0.5, 0.83, -2]],
              4: [[0.27, 0.55, -6], [0.73, 0.57, 5], [0.3, 0.8, 4], [0.72, 0.82, -5]],
            }
          : {
              1: [[0.3, 0.5, -3]],
              2: [[0.2, 0.42, -6], [0.36, 0.62, 5]],
              3: [[0.16, 0.4, -6], [0.36, 0.38, 5], [0.26, 0.7, -3]],
              4: [[0.14, 0.35, -6], [0.35, 0.35, 5], [0.15, 0.72, 4], [0.36, 0.72, -5]],
            };
        const squash = vertical ? Math.min(1, H / ((W * 16) / 9)) ** 0.8 : 1;
        const cw = (vertical ? [0, 0.62, 0.42, 0.37, 0.34] : [0, 0.34, 0.22, 0.2, 0.19])[n] * W * squash;
        b.cards = imgs.map((im, i) => {
          const [fx, fy, rot] = spots[n][i];
          return { ...im, cx: fx * W, cy: fy * H, w: cw, h: cw * 1.2, rot, delay: 0.05 + i * 0.18 };
        });
        b.textCenter = vertical ? { x: W / 2, y: H * (n > 2 ? 0.27 : 0.3) } : { x: W * 0.7, y: H * 0.5 };
        b.maxTextWidth = vertical ? W * 0.9 : W * 0.5;
        break;
      }
      case "closeup": {
        const w = W * 1.25;
        const h = (img.height / img.width) * w;
        b.images.push({ img, x: (W - w) / 2, y: H * 0.05, w, h, enter: "zoom", mono: b.visual.style === "mono" });
        b.textCenter = { x: W / 2, y: vertical ? H * 0.5 : H * 0.55 };
        b.maxTextWidth = W * 0.92;
        b.bigText = true;
        break;
      }
      case "flow": {
        const imgs = b.visual.images.slice(0, 4);
        const [src, ...outs] = imgs;
        const fit = (im, bw, bh) => {
          const r = Math.min(bw / im.img.width, bh / im.img.height);
          return { w: im.img.width * r, h: im.img.height * r };
        };
        const top = vertical ? H * 0.31 : H * 0.14;
        const srcBox = fit(src, W * (vertical ? 0.4 : 0.22), H * (vertical ? 0.2 : 0.34));
        const sx = vertical ? W / 2 : W * 0.3;
        const rowY = vertical ? H * 0.64 : H * 0.62;
        const cell = (vertical ? W * 0.9 : W * 0.5) / Math.max(outs.length, 1);
        const x0 = vertical ? W * 0.05 : W * 0.05;
        b.flow = {
          src: { ...src, x: sx - srcBox.w / 2, y: top, w: srcBox.w, h: srcBox.h },
          outs: outs.map((o, i) => {
            const box = fit(o, cell * 0.86, H * (vertical ? 0.22 : 0.3));
            const cx = x0 + cell * (i + 0.5);
            return { ...o, x: cx - box.w / 2, y: rowY, w: box.w, h: box.h, delay: 0.55 + i * 0.2 };
          }),
        };
        b.textCenter = vertical ? { x: W / 2, y: H * 0.17 } : { x: W * 0.74, y: H * 0.5 };
        b.maxTextWidth = vertical ? W * 0.9 : W * 0.44;
        break;
      }
      case "float": {
        const h = Math.min(vertical ? H * 0.4 : H * 0.72, ((vertical ? W * 0.78 : W * 0.42) * img.height) / img.width);
        if (vertical) {
          b.images.push(place(h, W / 2, H * SAFE_BOTTOM, { enter: "rise" }));
          b.textCenter = { x: W / 2, y: H * 0.28 };
          b.maxTextWidth = W * 0.88;
        } else {
          const right = align !== "right";
          b.images.push(place(h, right ? W * 0.27 : W * 0.73, H * 0.88, { enter: "rise" }));
          b.textCenter = { x: right ? W * 0.68 : W * 0.32, y: H * 0.5 };
          b.maxTextWidth = W * 0.5;
        }
        break;
      }
      case "board": {
        if (vertical) {
          b.textCenter = { x: W / 2, y: H * 0.29 };
          b.visualBox = { x: W * 0.07, y: H * 0.42, w: W * 0.86, h: H * 0.4 };
          b.maxTextWidth = W * 0.88;
        } else {
          const textRight = align !== "right";
          b.textCenter = { x: textRight ? W * 0.71 : W * 0.29, y: H * 0.5 };
          b.visualBox = { x: textRight ? W * 0.05 : W * 0.53, y: H * 0.1, w: W * 0.42, h: H * 0.8 };
          b.maxTextWidth = W * 0.42;
        }
        break;
      }
      case "dm": {
        const last = b.index === beats.length - 1;
        const kwBeat = /comment/i.test(beat.voiceover);
        b.dm = { keyword: String(keyword || "").toUpperCase(), phase: kwBeat && !last ? "comment" : "dm", box: { x: W * 0.08, y: H * 0.62, w: W * 0.84, h: 120 * u } };
        b.textCenter = { x: W / 2, y: H * 0.3 };
        b.maxTextWidth = W * 0.88;
        break;
      }
      case "corner": {
        const maxW = vertical ? W * 0.46 : W * 0.3;
        const h = Math.min(vertical ? H * 0.3 : H * 0.5, (maxW * img.height) / img.width);
        const w = (img.width / img.height) * h;
        b.images.push(place(h, W - w * 0.42, H * (vertical ? 0.95 : 0.97), { enter: "fromRight" }));
        b.textCenter = { x: vertical ? W * 0.46 : W * 0.4, y: H * (vertical ? 0.4 : 0.42) };
        b.maxTextWidth = vertical ? W * 0.82 : W * 0.6;
        break;
      }
      case "mosaic": {
        const pool = b.visual.mosaic;
        let seed = (b.index + 3) * 7919;
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        const tiles = [];
        let k = 0;
        for (let y = -H * 0.12; y < H * 1.1; ) {
          const rowH = H * (0.1 + rnd() * 0.1);
          for (let x = -W * (0.1 + rnd() * 0.06); x < W * 1.1; ) {
            const im = pool[k++ % pool.length];
            const ar = im.img.width / im.img.height;
            let w = Math.min(Math.max(rowH * ar, W * 0.08), W * 0.3);
            let h = w / ar;
            if (h > rowH * 1.15) {
              h = rowH * 1.15;
              w = h * ar;
            }
            tiles.push({ img: im.img, x, y: y + (rowH - h) / 2, w, h, order: rnd() });
            x += w * 0.94;
          }
          y += rowH * 0.93;
        }
        const dur = Math.max(b.t1 - b.t0, 1.2);
        const interval = Math.min(0.1, Math.max(0.035, (dur * 0.4) / tiles.length));
        tiles.sort((a, c) => a.order - c.order).forEach((tile, i) => (tile.delay = i * interval));
        const slideAt = tiles.length * interval + Math.min(0.5, dur * 0.12);
        const hero = b.visual.images[0];
        const hw = W * 0.52;
        const hh = Math.min(hw * 1.25, H * 0.42);
        b.mosaic = {
          tiles,
          slideAt,
          slideDur: Math.max(0.35, Math.min(1, dur - slideAt - 0.15)),
          shift: W * 0.1 * (b.index % 2 ? -1 : 1),
          hero: { img: hero.img, label: hero.label ?? "", w: hw, h: hh, cx: W / 2, cy: H * 0.56 },
        };
        b.textCenter = { x: W / 2, y: H * 0.13 };
        b.maxTextWidth = W * 0.9;
        break;
      }
      case "duo": {
        const [big, small] = b.visual.images;
        const gw = W * 1.15;
        const gh = (big.img.height / big.img.width) * gw;
        const gx = W * 0.5 - gw * 0.46;
        const gy = H * 0.62 - gh * 0.2;
        b.images.push({ img: big.img, key: big.key, x: gx, y: gy, w: gw, h: gh, enter: "zoom" });
        const sh = H * 0.26;
        const sw = (small.img.width / small.img.height) * sh;
        const shoulderY = gy + gh * 0.2;
        b.images.push({ img: small.img, key: small.key, x: gx + gw * 0.24 - sw / 2, y: shoulderY - sh * 0.93, w: sw, h: sh, enter: "rise" });
        b.textCenter = { x: W / 2, y: H * 0.17 };
        b.maxTextWidth = W * 0.9;
        break;
      }
      case "slider": {
        const [a, c] = b.visual.images;
        const box = vertical ? { x: W * 0.07, y: H * 0.33, w: W * 0.86, h: H * 0.52 } : { x: W * 0.05, y: H * 0.1, w: W * 0.46, h: H * 0.8 };
        b.slider = { box, a, b: c ?? a };
        b.textCenter = vertical ? { x: W / 2, y: H * 0.18 } : { x: W * 0.76, y: H * 0.5 };
        b.maxTextWidth = vertical ? W * 0.9 : W * 0.4;
        break;
      }
      case "verdict": {
        const imgs = b.visual.images.slice(0, 2);
        const cw = vertical ? W * 0.41 : W * 0.21;
        const cy = vertical ? H * 0.6 : H * 0.56;
        const xs = imgs.length === 1 ? [0.5] : vertical ? [0.27, 0.73] : [0.2, 0.44];
        b.cards = imgs.map((im, i) => ({ ...im, cx: xs[i] * W, cy, w: cw, h: cw * 1.35, rot: i ? 2 : -2, delay: 0.05 + i * 0.55, stamp: imgs.length === 1 ? "yes" : i === 0 ? "no" : "yes" }));
        b.textCenter = vertical ? { x: W / 2, y: H * 0.24 } : { x: W * 0.76, y: H * 0.5 };
        b.maxTextWidth = vertical ? W * 0.9 : W * 0.4;
        break;
      }
      case "zoom": {
        const h = vertical ? H * 0.64 : H * 0.86;
        const modelLeft = align !== "left";
        b.images.push(place(h, modelLeft ? W * 0.3 : W * 0.7, H * (vertical ? SAFE_BOTTOM : 0.97), { enter: "rise" }));
        const target = noteTarget(beat.text, beat.voiceover) ?? { x: 0.12, y: 0.93 };
        b.zoom = { target, r: (vertical ? W : H) * 0.2, cx: modelLeft ? W * 0.72 : W * 0.28, factor: 2.4 };
        b.textCenter = { x: W / 2, y: vertical ? H * 0.15 : H * 0.14 };
        b.maxTextWidth = W * 0.9;
        break;
      }
      case "scale": {
        const imgs = b.visual.images.slice(0, 4);
        const n = imgs.length;
        const x0 = W * (n > 3 ? 0.14 : 0.19);
        const x1 = W - x0;
        const y = vertical ? H * 0.66 : H * 0.72;
        b.scale = {
          y, x0, x1,
          bw: Math.min(((x1 - x0) / Math.max(n - 1, 1)) * (n > 1 ? 0.98 : 1.5), x0 * 2 - W * 0.06),
          bh: vertical ? H * 0.3 : H * 0.4,
          stops: imgs.map((im, i) => ({ ...im, x: n === 1 ? W / 2 : x0 + ((x1 - x0) * i) / (n - 1), delay: 0.35 + i * 0.45 })),
        };
        b.textCenter = { x: W / 2, y: vertical ? H * 0.22 : H * 0.2 };
        b.maxTextWidth = W * 0.9;
        break;
      }
      default: {
        b.textCenter = { x: W / 2, y: H * (vertical ? 0.45 : 0.5) };
        b.maxTextWidth = W * (vertical ? 0.88 : 0.8);
      }
    }

    const layout = layoutLockup(scratch, parseLockup(beat.text), { u, maxWidth: b.maxTextWidth, align, typeset });
    b.pieces = layout.pieces;
    b.lockHeight = layout.height;
    b.motion = MOTIONS.includes(beat.motion) ? beat.motion : "rise";
    if (b.motion === "stack" && b.layout === "type") {
      const narrow = layoutLockup(scratch, parseLockup(beat.text), { u, maxWidth: W * 0.66, align, typeset });
      b.pieces = narrow.pieces;
      layout.height = narrow.height;
      b.lockHeight = narrow.height;
    }
    for (const p of b.pieces) p.motion = b.motion === "stack" ? "rise" : b.motion;
    b.ghost = look.ghost === "yes" || beat.ghost === "yes";

    if (b.sandwich && img) {
      const lockTop = b.textCenter.y - layout.height / 2;
      const cx = W / 2 + W * b.sandwich.shift;
      if (b.sandwich.person) {
        let h = Math.max(vertical ? H * 0.52 : H * 0.82, layout.height * 2.4);
        h = Math.min(h, (H * (vertical ? SAFE_BOTTOM : 0.97) - lockTop) / 0.7);
        b.images.push(place(h, cx, lockTop - h * 0.3 + h, { enter: "rise" }));
      } else {
        const maxW = vertical ? W * 0.72 : W * 0.46;
        const h = Math.min(vertical ? H * 0.32 : H * 0.56, (maxW * img.height) / img.width);
        b.images.push(place(h, cx, b.textCenter.y + h * 0.62, { enter: "rise" }));
      }
    }

    if (b.visual && !person && ["edge", "float", "sandwich", "side", "hero", "corner"].includes(b.layout)) {
      b.images.forEach((im, j) => Object.assign(im, { sticker: true, tilt: ((b.index * 7 + j * 3) % 9) - 4 }));
    }

    if (b.heroBehind && b.images[0] && beat.hero_size !== "giant") {
      const hero = b.pieces.find((p) => p.hero && p.hero !== "sticker");
      if (hero && hero.m.width < b.images[0].w * 0.5 * 2.6) b.heroBehind = false;
    }

    if (beat.hero_size === "giant") {
      const hero = b.pieces.find((p) => p.hero && p.hero !== "sticker");
      if (hero) {
        const rest = layoutLockup(scratch, parseLockup(beat.text).filter((p) => !p.hero || p.hero === "sticker"), { u, maxWidth: b.maxTextWidth, align, typeset });
        const f = (W * 1.18) / Math.max(hero.m.width, 1);
        hero.st = { ...hero.st, size: hero.st.size * f };
        hero.m = { ...hero.m, width: hero.m.width * f, ascent: hero.m.ascent * f, descent: hero.m.descent * f, left: (hero.m.left ?? 0) * f };
        Object.assign(hero, { abs: true, giant: true, x: -W * 0.09, y: hero.m.ascent * 0.9 });
        const order = parseLockup(beat.text).map((p) => p.text);
        b.pieces = [...rest.pieces, hero].sort((a, c) => order.indexOf(a.text) - order.indexOf(c.text));
        b.lockHeight = rest.height;
        b.textCenter = { ...b.textCenter, y: Math.max(b.textCenter.y, hero.m.ascent + rest.height / 2 + 30 * u) };
        b.heroBehind = !person;
      }
    }

    if ((b.layout === "hero" || b.layout === "zoom") && b.images[0] && (b.visual.focus ?? "full") === "full" && beat.hero_size !== "giant" && beat.text_style !== "caption") {
      const r = b.images[0];
      const top = b.textCenter.y + layout.height / 2 + 36 * u;
      if (r.y < top) {
        const bottom = r.y + r.h;
        const h = bottom - top;
        const w = (r.img.width / r.img.height) * h;
        Object.assign(r, { x: r.x + (r.w - w) / 2, y: top, w, h });
      }
    }

    if (person && b.images[0] && !b.heroBehind && b.layout !== "closeup" && beat.text_style !== "caption") {
      const pad = 26 * u;
      const tb = { x0: b.textCenter.x - layout.width / 2 - pad, x1: b.textCenter.x + layout.width / 2 + pad, y0: b.textCenter.y - b.lockHeight / 2 - pad, y1: b.textCenter.y + b.lockHeight / 2 + pad };
      const r = b.images[0];
      const body = () => ({ x0: r.x + r.w * 0.1, x1: r.x + r.w * 0.9, y0: r.y + r.h * 0.02, y1: r.y + r.h });
      const hits = () => {
        const bb = body();
        return bb.x0 < tb.x1 && bb.x1 > tb.x0 && bb.y0 < tb.y1 && bb.y1 > tb.y0;
      };
      const anchorX = r.x + r.w / 2 > W / 2 ? "right" : r.x + r.w / 2 < W / 2 - W * 0.05 ? "left" : "center";
      for (let k = 0; k < 24 && hits() && r.h > H * 0.42; k++) {
        const nh = r.h * 0.94;
        const nw = r.w * 0.94;
        const bottom = Math.min(r.y + r.h, H * (vertical ? SAFE_BOTTOM : 0.97) + r.h * 0.3);
        r.x = anchorX === "right" ? r.x + r.w - nw : anchorX === "left" ? r.x : r.x + (r.w - nw) / 2;
        r.y = bottom - nh;
        r.w = nw;
        r.h = nh;
      }
      if (hits()) {
        const top = Math.max(H * 0.06, r.y - 30 * u - b.lockHeight);
        b.textCenter = { ...b.textCenter, y: top + b.lockHeight / 2 };
      }
    }

    if (b.visual?.plinth === "yes" && b.images[0]) {
      const r = b.images[0];
      const ph = H * 0.1;
      const floor = Math.min(r.y + r.h, H * (letterbox ? 0.97 : SAFE_BOTTOM));
      const nh = floor - ph - r.y;
      if (nh > H * 0.2) {
        const nw = (r.w * nh) / r.h;
        Object.assign(r, { x: r.x + (r.w - nw) / 2, w: nw, h: nh });
      }
      b.plinth = { cx: r.x + r.w / 2, top: r.y + r.h - 8 * u, w: Math.max(r.w * 0.95, W * 0.42), h: ph };
    }

    const key = b.visual?.images[0]?.key ?? null;
    b.continues = key && key === prevKey && b.images.length > 0;
    if (b.continues && prevRect) {
      const r = b.images[0];
      const moved = Math.abs(r.x - prevRect.x) + Math.abs(r.y - prevRect.y) + Math.abs(r.h - prevRect.h) > 4 * u;
      if (moved) r.from = { x: prevRect.x, y: prevRect.y, w: prevRect.w, h: prevRect.h };
    }
    prevKey = b.images.length ? key : null;
    prevRect = b.images[0] ?? null;

    if (b.images[0]) {
      const r = b.images[0];
      const toLeft = r.x + r.w / 2 > W / 2;
      const hero = b.pieces.find((x) => x.hero)?.text ?? "";
      const lockBottom = b.textCenter.y + b.lockHeight / 2;
      for (const p of b.pieces.filter((x) => x.note)) {
        p.abs = true;
        p.x = toLeft ? Math.max(W * 0.04, r.x - p.m.width - W * 0.02) : Math.min(W * 0.96 - p.m.width, r.x + r.w + W * 0.02);
        const target = person ? noteTarget(p.text, hero, beat.voiceover) : null;
        if (target) {
          const ex = r.x + r.w * (toLeft ? 0.5 - target.x : 0.5 + target.x);
          const ey = Math.min(r.y + r.h * target.y, H * SAFE_BOTTOM - 10 * u);
          p.y = Math.min(Math.max(ey - 150 * u, lockBottom + 110 * u), H * SAFE_BOTTOM - 60 * u);
          const sx = p.x + p.m.width * (toLeft ? 0.75 : 0.25);
          const sy = p.y + p.m.descent + 12 * u;
          p.arrow = { sx, sy, ex, ey: Math.max(ey, sy + 30 * u), bend: toLeft ? -1 : 1 };
          continue;
        }
        const visibleTop = Math.max(r.y, 0);
        const visibleH = Math.min(r.y + r.h, H) - visibleTop;
        p.y = Math.max(lockBottom + 110 * u, visibleTop + visibleH * 0.42);
        const sx = p.x + p.m.width * (toLeft ? 0.75 : 0.25);
        const sy = p.y + p.m.descent + 12 * u;
        const ex = toLeft ? r.x + r.w * 0.24 : r.x + r.w * 0.76;
        const ey = p.y - 60 * u;
        p.arrow = { sx, sy, ex, ey, bend: toLeft ? -1 : 1 };
      }
    }

    for (const p of b.pieces) p.ghost = b.ghost;
    const words = narration.lines[b.index] ?? [];
    let cursor = 0;
    b.pieces.forEach((p, k) => {
      const first = norm(p.text.split(/\s+/)[0]);
      const j = words.findIndex((w, idx) => idx >= cursor && norm(w.text) === first);
      if (j >= 0) {
        p.at = words[j].start - 0.1;
        cursor = j + p.text.split(/\s+/).length;
      } else {
        p.at = b.t0 + ((b.t1 - b.t0) * 0.5 * k) / Math.max(b.pieces.length, 1);
      }
      if (b.wipeFrom) p.at = Math.max(p.at, b.t0 + WIPE * 0.6);
      if (k > 0) p.at = Math.max(p.at, b.pieces[k - 1].at);
      p.at = Math.max(p.at, b.t0);
      p.dur = Math.max(0.18, Math.min(p.hero ? 0.55 : 0.32, (b.t1 - 0.14 - p.at) * 0.6));
    });
    if (beat.text_style === "caption") {
      const spoken = narration.lines[b.index] ?? [];
      const hero = norm(b.pieces.find((p) => p.hero)?.text?.split(/\s+/)[0] ?? "");
      const accent = norm(b.pieces.find((p) => p.accent)?.text?.split(/\s+/)[0] ?? "");
      const base = 64 * u;
      const words = spoken.map((w) => {
        const serif = hero && norm(w.text) === hero;
        const font = serif ? `${base * 1.1}px "Instrument Serif Italic", "Symbols"` : `${base}px "Inter Bold", "Symbols"`;
        scratch.font = font;
        return { text: w.text, at: w.start - 0.03, font, serif, accent: accent && norm(w.text) === accent, width: scratch.measureText(w.text).width };
      });
      scratch.font = `${base}px "Inter Bold"`;
      const space = scratch.measureText(" ").width;
      const lines = [[]];
      let lineW = 0;
      for (const w of words) {
        if (lineW + w.width > W * 0.84 && lines.at(-1).length) {
          lines.push([]);
          lineW = 0;
        }
        lines.at(-1).push(w);
        lineW += w.width + space;
      }
      const lineH = base * 1.3;
      const lastY = H * (letterbox ? 0.9 : 0.84);
      lines.forEach((ln, li) => {
        const total = ln.reduce((a, w) => a + w.width, 0) + space * (ln.length - 1);
        let x = W / 2 - total / 2;
        for (const w of ln) {
          Object.assign(w, { x, y: lastY - (lines.length - 1 - li) * lineH });
          x += w.width + space;
        }
      });
      b.caption = { words };
      const captionTop = lastY - (lines.length - 1) * lineH - base * 1.05;
      for (const r of b.images) {
        const floor = captionTop - 26 * u;
        if (r.y + r.h > floor && r.h > 0) {
          const nh = Math.max(floor - Math.max(r.y, H * 0.06), H * 0.25);
          const nw = (r.w * nh) / r.h;
          Object.assign(r, { x: r.x + (r.w - nw) / 2, y: floor - nh, w: nw, h: nh });
        }
      }
    }
    b.visualAt = b.continues ? b.t0 - 5 : b.t0 + (b.wipeFrom ? WIPE * 0.5 : 0.02);
    const snap = (x) => {
      if (look.beat_sync !== "yes" || !musicBeats.length) return x;
      const nb = musicBeats.reduce((best, m) => (Math.abs(m - x) < Math.abs(best - x) ? m : best), musicBeats[0]);
      return Math.abs(nb - x) < 0.15 && nb >= b.t0 && nb < b.t1 - 0.2 ? nb : x;
    };
    if (!b.continues) b.visualAt = snap(b.visualAt);
    b.cameraAt = snap(b.t0 + 0.05);
    if (b.plugin) PLUGINS[b.plugin.id].timing?.(b);
    b.nextContinues = false;
  }
  timeline.forEach((b, i) => {
    if (timeline[i + 1]?.continues) b.nextContinues = true;
  });
  const VARIED = ["rise", "drop", "scaleIn", "slideLeft", "slideRight"];
  let lastEnter = null;
  for (const b of timeline) {
    const im = b.images[0];
    if (!im || b.continues) continue;
    if (["hero", "float", "sandwich"].includes(b.layout)) {
      const options = VARIED.filter((e) => e !== lastEnter);
      im.enter = options[(b.index * 3 + 1) % options.length];
      for (const other of b.images.slice(1)) other.enter = im.enter;
    }
    lastEnter = im.enter;
  }
  timeline.forEach((b, i) => {
    const next = timeline[i + 1];
    if (!b.images.length || b.nextContinues || !next?.images?.length) return;
    const e = next.images[0].enter;
    b.exitDir = ["slideRight", "fromLeft"].includes(e) ? 1 : ["slideLeft", "fromRight"].includes(e) ? -1 : e === "drop" ? 2 : -1;
  });
  let run = null;
  for (const b of timeline) {
    if (b.continues && run) {
      run.t1 = b.t1;
      b.runStep = timeline[b.index - 1].runStep + 1;
    } else {
      run = { t0: b.t0, t1: b.t1 };
      b.runStep = 0;
    }
    b.imageRun = run;
  }

  let group = [];
  const flush = () => {
    group.forEach((b, j) => (b.stackPrev = group.slice(0, j)));
    group = [];
  };
  for (const b of timeline) {
    const joins = b.motion === "stack" && b.layout === "type";
    if (joins && group.length && group.at(-1).theme.bg === b.theme.bg) group.push(b);
    else {
      flush();
      if (joins) group.push(b);
    }
  }
  flush();
  timeline.forEach((b, i) => (b.nextStacks = !!timeline[i + 1]?.stackPrev?.includes(b)));

  let stickerAt = null;
  if (sticker?.text && sticker.beat >= 1 && timeline[sticker.beat - 1]) stickerAt = timeline[sticker.beat - 1].t0 + 0.15;
  if (stickerAt != null) {
    const clear = H * (vertical ? 0.1 : 0.14);
    for (const b of timeline) {
      if (b.t1 <= stickerAt || !b.lockHeight) continue;
      const top = b.textCenter.y - b.lockHeight / 2;
      if (top < clear) b.textCenter = { ...b.textCenter, y: b.textCenter.y + (clear - top) };
      for (const p of b.pieces.filter((x) => x.giant)) {
        const drop = clear + 10 * u - (p.y - p.m.ascent);
        if (drop > 0) {
          p.y += drop;
          b.textCenter = { ...b.textCenter, y: b.textCenter.y + drop };
        }
      }
    }
  }
  for (const b of timeline) {
    if (!b.lockHeight || !b.textCenter) continue;
    const margin = H * 0.045;
    const top = b.textCenter.y - b.lockHeight / 2;
    const bottom = b.textCenter.y + b.lockHeight / 2;
    if (top < margin) b.textCenter = { ...b.textCenter, y: b.textCenter.y + (margin - top) };
    else if (bottom > H - margin) b.textCenter = { ...b.textCenter, y: b.textCenter.y - (bottom - (H - margin)) };
  }
  for (const b of timeline) {
    if (!b.cards?.length || !b.lockHeight || !vertical) continue;
    const lockBottom = b.textCenter.y + b.lockHeight / 2 + 24 * u;
    const top = Math.min(...b.cards.map((c) => c.cy - c.h / 2));
    if (top >= lockBottom) continue;
    const bottom = Math.max(...b.cards.map((c) => c.cy + c.h / 2));
    const room = H * 0.97 - lockBottom;
    const k = Math.min(1, room / (bottom - top));
    for (const c of b.cards) {
      const newTop = lockBottom + (c.cy - c.h / 2 - top) * k;
      c.w *= k;
      c.h *= k;
      c.cy = newTop + c.h / 2;
    }
  }

  return {
    W, H, u, total, timeline,
    sticker: stickerAt != null ? { text: sticker.text, at: stickerAt } : null,
    look,
    outW: size.W,
    outH: size.H,
    offY: letterbox ? Math.round((size.H - H) / 2) : 0,
  };
}

export class EditorialRenderer {
  constructor(tl) {
    Object.assign(this, tl);
    this.canvas = createCanvas(this.W, this.H);
    this.ctx = this.canvas.getContext("2d");
    this.look = this.look ?? {};
    this.out = this.offY ? createCanvas(this.outW, this.outH) : this.canvas;
    this.bgCache = new Map();
    this.grain = makeGrain(512);
  }

  stickerOf(img) {
    return stickerOutline(img);
  }

  background(theme) {
    const cacheKey = `${theme.bg}-${theme.texture ?? "none"}`;
    if (this.bgCache.has(cacheKey)) return this.bgCache.get(cacheKey);
    const { W, H } = this;
    const c = createCanvas(W, H);
    const g = c.getContext("2d");
    g.fillStyle = theme.bg;
    g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.55);
    glow.addColorStop(0, hexA(theme.glow, 0.9));
    glow.addColorStop(1, hexA(theme.glow, 0));
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
    const vig = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.max(W, H) * 0.8);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, isLight(theme.bg) ? "rgba(60,40,20,0.10)" : "rgba(0,0,0,0.35)");
    g.fillStyle = vig;
    g.fillRect(0, 0, W, H);
    drawTexture(g, W, H, theme, this.u);
    this.bgCache.set(cacheKey, c);
    return c;
  }

  frame(t, pass = "all") {
    const { ctx, W, H, timeline } = this;
    const b = timeline.find((x) => t >= x.t0 && t < x.t1) ?? timeline.at(-1);
    const el = String(pass).startsWith("el:") ? String(pass).split(":") : null;
    const elIs = (kind, k) => !!el && el[1] === kind && (k === undefined || Number(el[2]) === k);
    const on = (layer) => !el && (pass === "all" || pass === layer);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    if (pass !== "all" && pass !== "bg") ctx.clearRect(0, 0, W, H);

    if (on("bg")) {
      const wipeP = b.wipeFrom ? easeInOutSine((t - b.t0) / WIPE) : 1;
      if (wipeP < 1) {
        ctx.drawImage(this.background(b.wipeFrom), 0, 0);
        const edge = W * (1 - wipeP);
        const soft = W * 0.18;
        ctx.save();
        ctx.beginPath();
        ctx.rect(edge, 0, W - edge + 1, H);
        ctx.clip();
        ctx.drawImage(this.background(b.theme), 0, 0);
        ctx.restore();
        const grad = ctx.createLinearGradient(edge - soft, 0, edge, 0);
        grad.addColorStop(0, hexA(b.theme.bg, 0));
        grad.addColorStop(1, hexA(b.theme.bg, 1));
        ctx.fillStyle = grad;
        ctx.fillRect(edge - soft, 0, soft, H);
      } else {
        ctx.drawImage(this.background(b.theme), 0, 0);
      }
    }

    const life = clamp01((t - b.t0) / Math.max(b.t1 - b.t0, 0.001));
    const exit = clamp01((t - (b.t1 - 0.14)) / 0.14);
    const push = 1 + 0.03 * life;
    const imageExit = b.nextContinues ? 0 : b.exitDir ? clamp01((t - (b.t1 - 0.26)) / 0.26) : exit;

    this.motionAmt = 0;
    ctx.save();
    if (b.camera === "rotate") {
      const e = clamp01((t - (b.t1 - 0.5)) / 0.5) ** 3;
      if (e > 0) {
        ctx.translate(W / 2, H / 2);
        ctx.rotate(((b.index % 2 ? -1 : 1) * 8 * e * Math.PI) / 180);
        ctx.scale(1 + 0.25 * e, 1 + 0.25 * e);
        ctx.translate(-W / 2, -H / 2);
        this.motionAmt = Math.max(this.motionAmt, e);
      }
    }
    if (b.camera === "punch") {
      const pt = t - (b.cameraAt ?? b.t0);
      if (pt >= 0 && pt < 0.15) this.motionAmt = Math.max(this.motionAmt, 1 - pt / 0.15);
    }
    const mono = this.look.cutouts === "mono" && b.visual?.exempt !== "yes";

    if (b.motion === "stack" && b.layout === "type") {
      if (on("front") || elIs("piece", 0)) this.drawStack(b, t, b.nextStacks ? 0 : exit);
    } else {
      const behind = b.heroBehind ? b.pieces.filter((p) => p.hero && p.hero !== "sticker" && (!p.abs || p.giant)) : [];
      const front = b.pieces.filter((p) => !behind.includes(p));
      const onePiece = el && el[1] === "piece" ? b.pieces[Number(el[2])] : null;
      if (on("back") && !b.caption) this.drawPieces(b, behind, t, push, exit);
      if (onePiece && behind.includes(onePiece) && !b.caption) this.drawPieces(b, [onePiece], t, push, exit);
      const set = on("img") || elIs("set");
      const img = (k) => on("img") || elIs("img", k);
      if (set || (el && el[1] === "img")) {
        if (set && b.layout === "board") this.drawBoard(b, t, exit);
        if (img(0) && b.plinth) this.drawPlinth(b, t, imageExit);
        if (mono) ctx.filter = "grayscale(1) contrast(1.15)";
        if (set) {
          if (b.cards) this.drawCards(b, t, exit);
          if (b.flow) this.drawFlow(b, t, exit);
          if (b.slider) this.drawSlider(b, t, exit);
          if (b.scale) this.drawScale(b, t, exit);
          if (b.mosaic) this.drawMosaic(b, t, exit);
          if (b.dm) this.drawDm(b, t, exit);
          if (b.plugin) PLUGINS[b.plugin.id].draw(this, b, t, exit);
        }
        for (const [i, im] of b.images.entries()) if (img(i)) this.drawImage(b, im, t, i * 0.1, imageExit);
        if (img(0) && b.zoom && b.images[0]) this.drawZoom(b, t, imageExit);
        ctx.filter = "none";
        if (img(0) && b.plinth) this.drawSmoke(b, t, imageExit);
      }
      const overImage = b.images.length > 0 || !!b.cards || !!b.flow || !!b.slider || !!b.scale || !!b.mosaic || !!b.plugin;
      if (on("front")) {
        if (b.caption) this.drawCaption(b, t);
        else {
          this.drawPieces(b, front, t, push, exit, overImage);
          for (const p of b.pieces) if (p.arrow) this.drawArrow(p, b.theme, t, exit);
        }
      } else if (onePiece) {
        if (b.caption) {
          if (Number(el[2]) === 0) this.drawCaption(b, t);
        } else if (front.includes(onePiece)) {
          this.drawPieces(b, [onePiece], t, push, exit, overImage);
          if (onePiece.arrow) this.drawArrow(onePiece, b.theme, t, exit);
        }
      }
    }
    ctx.restore();
    if ((on("front") || elIs("sticker")) && this.sticker) this.drawSticker(t);
    if ((pass === "all" || elIs("fly")) && b.transition === "letter") this.letterFly(b, t);
    if (pass === "all" && this.look.chroma === "yes" && this.motionAmt > 0.05) this.chroma(Math.max(1, Math.round(4 * this.u * this.motionAmt)));

    if (on("bg")) this.drawGrain(b);
    ctx.restore();
  }

  drawGrain(b) {
    const { ctx, W, H } = this;
    ctx.save();
    ctx.globalAlpha = b.theme.grain;
    ctx.globalCompositeOperation = "overlay";
    if (!this.grainTick || this.grainTick++ % 2 === 0) {
      this.grainTick ||= 1;
      this.grainOffset = [Math.floor(Math.random() * 512), Math.floor(Math.random() * 512)];
    }
    const [ox, oy] = this.grainOffset;
    for (let x = -ox; x < W; x += 512) for (let y = -oy; y < H; y += 512) ctx.drawImage(this.grain, x, y);
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
  }

  drawStack(b, t, exit) {
    const { ctx, u } = this;
    const lines = [...(b.stackPrev ?? []), b];
    const gap = 40 * u;
    const k = easeOutCubic((t - b.t0) / 0.35);
    const offsets = [];
    let y = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      offsets[i] = y;
      if (i > 0) y += lines[i].lockHeight / 2 + gap + lines[i - 1].lockHeight / 2;
    }
    const scroll = lines.length > 1 ? (b.lockHeight / 2 + gap + lines[lines.length - 2].lockHeight / 2) * (1 - k) : 0;
    const drift = (t - (lines[0].t0 ?? b.t0)) * 0.6;

    ctx.save();
    ctx.translate(b.textCenter.x, b.textCenter.y + 140 * u);
    ctx.scale(0.86, 0.86);
    ctx.rotate(((-7 + drift) * Math.PI) / 180);
    ctx.transform(1, 0, -0.22, 1, 0, 0);
    ctx.translate(0, scroll);
    lines.forEach((line, i) => {
      const age = lines.length - 1 - i;
      ctx.save();
      ctx.translate(0, -offsets[i]);
      if (age === 0) {
        for (const p of line.pieces) this.drawAnimatedPiece(p, line.theme, t, exit);
      } else {
        ctx.globalAlpha = Math.pow(0.62, age) * (1 - exit);
        for (const p of line.pieces) drawPiece(ctx, p, pieceColor(p, line.theme));
      }
      ctx.restore();
    });
    ctx.restore();
  }

  drawPieces(b, pieces, t, push, exit, overImage = false) {
    const { ctx } = this;
    if (overImage && b.images.length) {
      for (const p of pieces) {
        if (p.hero || p.label || p.note || t < p.at) continue;
        const x = p.abs ? p.x : b.textCenter.x + p.x * push;
        const y = p.abs ? p.y : b.textCenter.y + p.y * push;
        const w = p.m.width * (p.abs ? 1 : push);
        const top = y - p.m.ascent * (p.abs ? 1 : push);
        const hit = b.images.some((r) => x < r.x + r.w * 0.85 && x + w > r.x + r.w * 0.15 && top < r.y + r.h && y > r.y + r.h * 0.05);
        if (!hit) continue;
        const pad = p.st.size * 0.22;
        ctx.save();
        ctx.globalAlpha = 0.78 * clamp01((t - p.at) / 0.2) * (1 - exit);
        ctx.fillStyle = b.theme.bg;
        ctx.beginPath();
        ctx.roundRect(x - pad, top - pad * 0.7, w + pad * 2, (y - top) + p.m.descent + pad * 1.4, pad);
        ctx.fill();
        ctx.restore();
      }
    }
    const rel = pieces.filter((p) => !p.abs);
    if (rel.length) {
      ctx.save();
      ctx.translate(b.textCenter.x, b.textCenter.y);
      ctx.scale(push, push);
      for (const p of rel) this.drawAnimatedPiece(p, b.theme, t, exit, overImage);
      ctx.restore();
    }
    for (const p of pieces.filter((x) => x.abs)) this.drawAnimatedPiece(p, b.theme, t, exit, overImage);
  }

  drawAnimatedPiece(p, theme, t, exit, overImage = false) {
    const { ctx, u } = this;
    const dt = t - p.at;
    if (dt < 0) {
      if (p.ghost && !p.note && !p.label && p.hero !== "sticker" && !p.giant) {
        ctx.save();
        ctx.globalAlpha = 0.35 * (1 - exit);
        drawPiece(ctx, p, "#9EA2AA");
        ctx.restore();
      }
      return;
    }
    const hero = !!p.hero;
    const pop = p.hero === "sticker" || p.label;
    const motion = p.motion ?? "rise";
    const halo = (draw) => {
      if (overImage && !p.label && p.hero !== "sticker") {
        ctx.shadowColor = hexA(theme.bg, 0.95);
        ctx.shadowBlur = (p.hero ? 30 : 22) * u;
        draw();
        draw();
        ctx.shadowBlur = (p.hero ? 12 : 8) * u;
      }
      draw();
    };

    ctx.save();
    if (pop) {
      const k = easeOutBack(dt / Math.max(p.dur, 0.3));
      ctx.globalAlpha = clamp01(k) * (1 - exit);
      const s = 0.6 + 0.4 * k;
      const cx = p.x + p.m.width / 2;
      const cy = p.y - p.m.ascent / 2;
      ctx.translate(cx, cy);
      ctx.scale(s, s);
      ctx.translate(-cx, -cy);
    } else if (motion === "mask") {
      const k = easeOutExpo(dt / Math.max(p.dur, 0.35));
      ctx.globalAlpha = 1 - exit;
      const h = p.m.ascent + p.m.descent;
      const pad = p.st.size * 0.3;
      ctx.beginPath();
      ctx.rect(p.x - pad, p.y - p.m.ascent - pad * 0.4, p.m.width + pad * 2, h + pad * 0.8);
      ctx.clip();
      ctx.translate(0, (h + pad) * (1 - k));
    } else if (motion === "snap") {
      ctx.globalAlpha = 1 - exit;
      const k = clamp01(dt / 0.12);
      const s = 1 + 0.3 * (1 - k) - 0.04 * Math.sin(Math.PI * k);
      const cx = p.x + p.m.width / 2;
      const cy = p.y - p.m.ascent / 2;
      ctx.translate(cx, cy);
      ctx.scale(s, s);
      ctx.translate(-cx, -cy);
    } else if (motion === "typewriter") {
      const chars = [...p.draw];
      const perChar = hero ? 0.045 : 0.028;
      const n = Math.min(chars.length, Math.floor(dt / perChar) + 1);
      ctx.globalAlpha = 1 - exit;
      halo(() => drawPiece(ctx, { ...p, draw: chars.slice(0, n).join("") }, pieceColor(p, theme)));
      ctx.restore();
      return;
    } else if (motion === "slam" && hero) {
      const k = easeOutCubic(dt / 0.2);
      const s = 2.4 - 1.4 * k;
      const shake = dt > 0.2 && dt < 0.5 ? Math.sin(dt * 90) * (0.5 - dt) * 22 * u : 0;
      ctx.globalAlpha = clamp01(dt / 0.08) * (1 - exit);
      const cx = p.x + p.m.width / 2;
      const cy = p.y - p.m.ascent / 2;
      ctx.translate(cx + shake, cy);
      ctx.scale(s, s);
      ctx.transform(1, 0, -0.18 * (1 - k), 1, 0, 0);
      ctx.translate(-cx, -cy);
      if (dt < 0.2) ctx.filter = `blur(${(6 * (1 - k) * u).toFixed(1)}px)`;
    } else {
      const k = hero ? easeOutExpo(dt / p.dur) : easeOutCubic(dt / p.dur);
      const alpha = clamp01(k) * (1 - exit);
      if (alpha <= 0.001) return ctx.restore();
      const blur = (hero ? 16 : 9) * (1 - clamp01(k)) * u + 8 * exit * u;
      ctx.globalAlpha = alpha;
      ctx.filter = blur > 0.4 ? `blur(${blur.toFixed(1)}px)` : "none";
      if (hero) {
        const s = 1.07 - 0.07 * k;
        const cx = p.x + p.m.width / 2;
        ctx.translate(cx, p.y);
        ctx.scale(s, s);
        ctx.translate(-cx, -p.y);
        if (p.hero === "script") {
          const reveal = easeInOutSine(dt / (p.dur * 1.1));
          const pad = p.st.size * 0.4;
          ctx.beginPath();
          ctx.rect(p.x - pad, p.y - p.m.ascent - pad, (p.m.width + pad * 2) * reveal, p.m.ascent + p.m.descent + pad * 2);
          ctx.clip();
        }
      } else {
        ctx.translate(0, 14 * u * (1 - k));
      }
    }
    halo(() => drawPiece(ctx, p, pieceColor(p, theme)));
    ctx.restore();
  }

  drawImage(b, im, t, delay, exit) {
    const { ctx, u, W } = this;
    const dt = t - b.visualAt - delay;
    if (dt < 0) return;
    const k = im.enter === "fromLeft" || im.enter === "fromRight" ? easeOutBack(dt / 0.5) : easeOutCubic(dt / 0.5);
    const alpha = clamp01(dt / 0.3) * (b.exitDir ? 1 - clamp01((exit - 0.7) / 0.3) : 1 - exit);
    if (alpha <= 0.001) return;
    const run = b.imageRun ?? b;
    const drift = 1 + Math.min(0.012 * Math.max(t - run.t0, 0), 0.07);
    const step = Math.min(b.runStep ?? 0, 3);
    const punch = step ? 1 + 0.05 * (step - 1) + 0.05 * easeInOutCubic((t - b.t0) / 0.45) : 1;
    let dx = 0;
    let dy = 0;
    if (im.enter === "rise") dy = 60 * u * (1 - k);
    if (im.enter === "slideLeft") dx = 90 * u * (1 - k);
    if (im.enter === "slideRight") dx = -90 * u * (1 - k);
    if (im.enter === "fromLeft") dx = -(im.x + im.w) * (1 - k);
    if (im.enter === "fromRight") dx = (W - im.x) * (1 - k);
    if (im.enter === "drop") dy = -this.H * 0.22 * (1 - easeOutBack(dt / 0.55));
    if (b.exitDir && exit > 0) {
      const e = exit ** 2;
      if (b.exitDir === 2) dy += this.H * 0.35 * e;
      else dx += b.exitDir * W * 0.6 * e;
    }
    let s = (1.04 - 0.04 * clamp01(k)) * drift * punch;
    if (im.enter === "scaleIn") s *= 0.72 + 0.28 * easeOutBack(dt / 0.5);
    if (im.enter === "zoom") s = (1.14 - 0.14 * clamp01(k)) * drift * punch;

    ctx.save();
    ctx.globalAlpha = alpha;
    if (b.camera === "punch" && delay === 0) {
      const pt = t - (b.cameraAt ?? b.t0);
      if (pt >= 0) {
        const p = easeOutCubic(pt / 0.1);
        const target = noteTarget(b.beat.text, b.beat.voiceover) ?? { x: 0, y: 0.1 };
        const tx = Math.min(Math.max(im.x + im.w * 0.5, this.W * 0.2), this.W * 0.8);
        const ty = Math.min(Math.max(im.y + im.h * Math.min(target.y, 0.9), this.H * 0.25), this.H * 0.78);
        const z = 1 + 1.6 * p;
        ctx.translate(tx + (this.W / 2 - tx) * p, ty + (this.H * 0.55 - ty) * p);
        ctx.scale(z, z);
        ctx.translate(-tx, -ty);
        if (p < 1) ctx.filter = `${ctx.filter !== "none" ? ctx.filter : ""} blur(${((1 - p) * 10 * u).toFixed(1)}px)`.trim();
      }
    }
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowBlur = 44 * u;
    ctx.shadowOffsetY = 20 * u;
    let { x, y, w, h } = im;
    if (im.from && b.continues) {
      const g = easeInOutCubic((t - b.t0) / 0.55);
      x = im.from.x + (x - im.from.x) * g;
      y = im.from.y + (y - im.from.y) * g;
      w = im.from.w + (w - im.from.w) * g;
      h = im.from.h + (h - im.from.h) * g;
    }
    const cx = x + w / 2 + dx;
    const by = y + h + dy;
    ctx.translate(cx, by);
    ctx.scale(s, s);
    if (im.mono) ctx.filter = "grayscale(1) contrast(1.12)";
    if (im.sticker) {
      const pop = easeOutBack(dt / 0.45);
      ctx.translate(0, -h / 2);
      ctx.rotate(((im.tilt ?? 0) * Math.PI) / 180);
      ctx.scale(0.6 + 0.4 * pop, 0.6 + 0.4 * pop);
      ctx.translate(0, h / 2);
      const { canvas, pad } = stickerOutline(im.img);
      const k = w / im.img.width;
      ctx.drawImage(canvas, -w / 2 - pad * k, -h - pad * k, canvas.width * k, canvas.height * k);
    } else ctx.drawImage(im.img, -w / 2, -h, w, h);
    ctx.restore();
  }

  drawCards(b, t, exit) {
    const { ctx, u } = this;
    const light = isLight(b.theme.bg);
    for (const c of b.cards) {
      const dt = t - b.visualAt - c.delay;
      if (dt < 0) continue;
      const k = easeOutBack(dt / 0.55);
      ctx.save();
      ctx.globalAlpha = clamp01(dt / 0.2) * (1 - exit);
      ctx.translate(c.cx, c.cy);
      ctx.rotate(((c.rot + (1 - clamp01(k)) * 8) * Math.PI) / 180);
      ctx.scale(1.15 - 0.15 * k, 1.15 - 0.15 * k);
      ctx.shadowColor = "rgba(0,0,0,0.3)";
      ctx.shadowBlur = 40 * u;
      ctx.shadowOffsetY = 18 * u;
      const border = 16 * u;
      ctx.fillStyle = light ? "#FFFFFF" : "#F7F3EC";
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      ctx.shadowColor = "transparent";
      ctx.fillStyle = light ? mix(b.theme.bg, "#FFFFFF", 0.55) : "#ECE6DC";
      const labelH = c.label ? 70 * u : 0;
      ctx.fillRect(-c.w / 2 + border, -c.h / 2 + border, c.w - border * 2, c.h - border * 2 - labelH);
      const bw = c.w - border * 4;
      const bh = c.h - border * 4 - labelH;
      const r = Math.min(bw / c.img.width, bh / c.img.height);
      const iw = c.img.width * r;
      const ih = c.img.height * r;
      ctx.drawImage(c.img, -iw / 2, -c.h / 2 + border * 2 + (bh - ih) / 2, iw, ih);
      if (c.label) {
        ctx.fillStyle = "#1B1714";
        ctx.font = `${54 * u}px "Caveat", "Symbols"`;
        ctx.textAlign = "center";
        ctx.fillText(c.label.toLowerCase(), 0, c.h / 2 - border - 18 * u);
      }
      if (c.stamp) this.drawStamp(c, dt - 0.4);
      ctx.restore();
    }
  }

  drawFlow(b, t, exit) {
    const { ctx, u } = this;
    const f = b.flow;
    const dt = t - b.visualAt;
    if (dt < 0) return;
    const fade = 1 - exit;
    const drawBox = (im, k) => {
      ctx.save();
      ctx.globalAlpha = clamp01(k) * fade;
      ctx.shadowColor = "rgba(0,0,0,0.25)";
      ctx.shadowBlur = 36 * u;
      ctx.shadowOffsetY = 14 * u;
      const s = 0.9 + 0.1 * clamp01(k);
      ctx.translate(im.x + im.w / 2, im.y + im.h / 2);
      ctx.scale(s, s);
      ctx.drawImage(im.img, -im.w / 2, -im.h / 2, im.w, im.h);
      ctx.restore();
      if (im.label) {
        ctx.save();
        ctx.globalAlpha = clamp01(k) * fade;
        ctx.font = `${30 * u}px "Oswald SemiBold", "Symbols"`;
        ctx.letterSpacing = `${2.4 * u}px`;
        ctx.textAlign = "center";
        ctx.fillStyle = b.theme.ink;
        ctx.fillText(im.label.toUpperCase(), im.x + im.w / 2, im.y + im.h + 46 * u);
        ctx.restore();
      }
    };
    drawBox(f.src, easeOutCubic(dt / 0.4));
    const sx = f.src.x + f.src.w / 2;
    const sy = f.src.y + f.src.h + (f.src.label ? 72 : 20) * u;
    f.outs.forEach((o, i) => {
      const lineK = easeInOutSine((dt - 0.28 - i * 0.15) / 0.6);
      const ex = o.x + o.w / 2;
      const ey = o.y - 24 * u;
      const pts = bezierPoints(sx, sy, sx, (sy + ey) / 2, ex, (sy + ey) / 2, ex, ey, 48);
      if (lineK > 0) {
        const n = Math.max(2, Math.round(pts.length * lineK));
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.strokeStyle = b.theme.accent;
        ctx.lineWidth = 5 * u;
        ctx.lineCap = "round";
        ctx.shadowColor = b.theme.accent;
        ctx.shadowBlur = 16 * u;
        ctx.beginPath();
        pts.slice(0, n).forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
        const [tx, ty] = pts[n - 1];
        ctx.fillStyle = "#FFFFFF";
        ctx.shadowBlur = 24 * u;
        ctx.beginPath();
        ctx.arc(tx, ty, 9 * u * (lineK < 1 ? 1 : 0.6), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      drawBox(o, easeOutCubic((dt - o.delay) / 0.4));
    });
  }

  drawMosaic(b, t, exit) {
    const { ctx, u } = this;
    const m = b.mosaic;
    const dt = t - b.visualAt;
    if (dt < 0) return;
    const slide = easeOutCubic((dt - m.slideAt) / m.slideDur);
    ctx.save();
    ctx.globalAlpha = 1 - exit;
    for (const tile of m.tiles) {
      const sd = dt - tile.delay;
      if (sd < 0) continue;
      const k = easeOutBack(sd / 0.12);
      const s = 0.85 + 0.15 * k;
      const cx = tile.x + tile.w / 2 + m.shift * slide;
      const cy = tile.y + tile.h / 2;
      ctx.save();
      ctx.globalAlpha *= clamp01(sd / 0.06);
      ctx.translate(cx, cy);
      ctx.scale(s, s);
      ctx.drawImage(tile.img, -tile.w / 2, -tile.h / 2, tile.w, tile.h);
      ctx.restore();
    }
    if (slide > 0) {
      ctx.fillStyle = hexA(b.theme.bg, 0.35 * slide);
      ctx.fillRect(0, 0, this.W, this.H);
    }
    const hd = dt - m.slideAt - 0.1;
    if (hd > 0) {
      const h = m.hero;
      const k = easeOutBack(hd / 0.4);
      ctx.save();
      ctx.globalAlpha = clamp01(hd / 0.12) * (1 - exit);
      ctx.translate(h.cx, h.cy + 40 * u * (1 - clamp01(k)));
      ctx.scale(0.8 + 0.2 * k, 0.8 + 0.2 * k);
      ctx.shadowColor = "rgba(0,0,0,0.28)";
      ctx.shadowBlur = 50 * u;
      ctx.shadowOffsetY = 22 * u;
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.roundRect(-h.w / 2, -h.h / 2, h.w, h.h, 26 * u);
      ctx.fill();
      ctx.shadowColor = "transparent";
      const capH = h.label ? 80 * u : 0;
      const r = Math.min((h.w * 0.84) / h.img.width, (h.h - capH - h.w * 0.12) / h.img.height);
      ctx.drawImage(h.img, (-h.img.width * r) / 2, -h.h / 2 + h.w * 0.06, h.img.width * r, h.img.height * r);
      if (h.label) {
        ctx.fillStyle = "#1B1714";
        ctx.font = `${58 * u}px "Caveat", "Symbols"`;
        ctx.textAlign = "center";
        ctx.fillText(h.label.toLowerCase(), 0, h.h / 2 - 28 * u);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  drawDm(b, t, exit) {
    const { ctx, u, W } = this;
    const d = b.dm;
    const dt = t - b.visualAt;
    if (dt < 0) return;
    const light = isLight(b.theme.bg);
    const card = light ? "#FFFFFF" : "#1F1F24";
    const ink = light ? "#111111" : "#F5F5F5";
    const soft = light ? "#8A8A8E" : "#A0A0A8";
    const { x, y, w, h } = d.box;
    ctx.save();
    ctx.globalAlpha = clamp01(dt / 0.25) * (1 - exit);
    const rise = d.phase === "dm" ? 0 : (1 - easeOutCubic(dt / 0.4)) * 40 * u;
    ctx.translate(0, rise);
    ctx.shadowColor = "rgba(0,0,0,0.18)";
    ctx.shadowBlur = 30 * u;
    ctx.fillStyle = card;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
    ctx.fill();
    ctx.shadowColor = "transparent";
    const g = ctx.createLinearGradient(x + 30 * u, y, x + 100 * u, y + h);
    g.addColorStop(0, "#F58529");
    g.addColorStop(0.5, "#DD2A7B");
    g.addColorStop(1, "#8134AF");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x + h / 2, y + h / 2, h * 0.32, 0, Math.PI * 2);
    ctx.fill();
    const typed = d.phase === "comment" ? Math.max(0, Math.min(d.keyword.length, Math.floor((dt - 0.35) / 0.09))) : d.keyword.length;
    const posted = d.phase === "dm" || dt > 0.35 + d.keyword.length * 0.09 + 0.35;
    ctx.font = `600 ${44 * u}px "Inter Bold", "Symbols"`;
    ctx.textBaseline = "middle";
    ctx.fillStyle = typed && !posted ? ink : soft;
    const showTyped = typed && !posted;
    const text = showTyped ? d.keyword.slice(0, typed) : "Add a comment...";
    ctx.fillText(text, x + h * 0.95, y + h / 2);
    if (showTyped && typed < d.keyword.length && Math.floor(dt * 3) % 2 === 0) {
      const cw = ctx.measureText(text).width;
      ctx.fillRect(x + h * 0.95 + cw + 6 * u, y + h * 0.3, 4 * u, h * 0.4);
    }
    ctx.font = `${42 * u}px "Inter Bold", "Symbols"`;
    ctx.fillStyle = showTyped ? "#0095F6" : soft;
    ctx.textAlign = "right";
    ctx.fillText("Post", x + w - h * 0.45, y + h / 2);
    ctx.textAlign = "left";
    if (posted) {
      const pk = easeOutBack(clamp01((dt - (d.phase === "dm" ? 0 : 0.35 + d.keyword.length * 0.09 + 0.35)) / 0.35));
      const cy = y - 130 * u;
      ctx.save();
      ctx.globalAlpha *= clamp01(pk);
      ctx.translate(x + 40 * u, cy + 20 * u * (1 - pk));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(30 * u, 30 * u, 30 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ink;
      ctx.font = `${38 * u}px "Inter Bold", "Symbols"`;
      ctx.fillText("you", 82 * u, 18 * u);
      ctx.font = `${46 * u}px "Inter Bold", "Symbols"`;
      ctx.fillText(d.keyword, 82 * u, 62 * u);
      ctx.restore();
    }
    ctx.restore();
    if (d.phase === "dm") {
      const nd = dt - 0.4;
      if (nd > 0) {
        const k = easeOutBack(nd / 0.45);
        const nw = W * 0.86;
        const nh = 150 * u;
        const nx = (W - nw) / 2;
        const ny = this.H * 0.44 - (1 - k) * 260 * u;
        ctx.save();
        ctx.globalAlpha = clamp01(nd / 0.15) * (1 - exit);
        ctx.shadowColor = "rgba(0,0,0,0.25)";
        ctx.shadowBlur = 40 * u;
        ctx.shadowOffsetY = 14 * u;
        ctx.fillStyle = card;
        ctx.beginPath();
        ctx.roundRect(nx, ny, nw, nh, 36 * u);
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.fillStyle = b.theme.accent;
        ctx.beginPath();
        ctx.arc(nx + 75 * u, ny + nh / 2, 42 * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = isLight(b.theme.accent) ? "#111" : "#FFF";
        ctx.font = `${40 * u}px "Inter Bold", "Symbols"`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("DM", nx + 75 * u, ny + nh / 2 + 2 * u);
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = ink;
        ctx.font = `${40 * u}px "Inter Bold", "Symbols"`;
        ctx.fillText("New message", nx + 140 * u, ny + 62 * u);
        ctx.fillStyle = soft;
        ctx.font = `${36 * u}px "Inter", "Symbols"`;
        ctx.fillText(`Tumhari ${d.keyword.toLowerCase()} list ready hai`, nx + 140 * u, ny + 110 * u);
        ctx.restore();
      }
    }
  }

  drawCaption(b, t) {
    const { ctx, u } = this;
    ctx.save();
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = hexA(b.theme.bg, 0.85);
    ctx.shadowBlur = 18 * u;
    for (const w of b.caption.words) {
      const dt = t - w.at;
      if (dt < 0) continue;
      const k = clamp01(dt / 0.08);
      ctx.globalAlpha = k;
      ctx.font = w.font;
      ctx.fillStyle = w.accent ? b.theme.accent : b.theme.ink;
      ctx.fillText(w.text, w.x, w.y + 4 * u * (1 - k));
    }
    ctx.restore();
  }

  drawPlinth(b, t, exit) {
    const { ctx, u } = this;
    const pl = b.plinth;
    const dt = t - b.visualAt;
    if (dt < 0) return;
    const k = easeOutCubic(dt / 0.5);
    const d = pl.h * 0.35;
    const x = pl.cx - pl.w / 2 - d / 2;
    const y = pl.top + (1 - k) * 60 * u;
    ctx.save();
    ctx.globalAlpha = clamp01(dt / 0.25) * (1 - exit);
    const a = b.theme.accent;
    const poly = (pts, fill) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
      ctx.fill();
    };
    poly([[x, y + d], [x + d, y], [x + d + pl.w, y], [x + pl.w, y + d]], mix(a, "#FFFFFF", 0.22));
    poly([[x + pl.w, y + d], [x + d + pl.w, y], [x + d + pl.w, y + pl.h], [x + pl.w, y + d + pl.h]], mix(a, "#000000", 0.3));
    poly([[x, y + d], [x + pl.w, y + d], [x + pl.w, y + d + pl.h], [x, y + d + pl.h]], a);
    ctx.restore();
  }

  drawSmoke(b, t, exit) {
    const { ctx, u } = this;
    const pl = b.plinth;
    const dt = t - b.visualAt;
    if (dt < 0) return;
    ctx.save();
    ctx.globalAlpha = clamp01(dt / 0.6) * (1 - exit) * 0.55;
    for (let i = 0; i < 7; i++) {
      const phase = i * 1.7;
      const x = pl.cx + (i - 3) * pl.w * 0.2 + Math.sin(t * 0.7 + phase) * 26 * u;
      const y = pl.top + pl.h * 1.05 - Math.abs(Math.sin(t * 0.45 + phase)) * 22 * u;
      const r = (90 + 30 * Math.sin(t * 0.9 + phase)) * u;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,0.75)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  letterFly(b, t) {
    const next = this.timeline[b.index + 1];
    const hero = b.pieces.find((p) => p.hero && p.hero !== "sticker") ?? b.pieces[0];
    if (!next || !hero) return;
    const start = Math.max(b.t1 - 0.4, hero.at + 0.55);
    if (b.t1 - start < 0.22) return;
    const e = clamp01((t - start) / (b.t1 - start));
    if (e <= 0) return;
    const { ctx, W, H } = this;
    const glyph = (this.glyphs ??= new Map()).get(b.index) ?? this.makeGlyph(b, hero);
    this.glyphs.set(b.index, glyph);
    this.peer ??= new EditorialRenderer({ ...this, peer: null, glyphs: null });
    this.peer.frame(next.t0 + 0.03);
    const z = 1 + 26 * e ** 3;
    const [gx, gy] = glyph.anchor;
    const fx = glyph.x + gx * glyph.scale;
    const fy = glyph.y + gy * glyph.scale;
    const tx = fx + (W / 2 - fx) * e;
    const ty = fy + (H / 2 - fy) * e;
    const place = (g) => {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.translate(tx, ty);
      g.scale(z * glyph.scale, z * glyph.scale);
      g.translate(-gx, -gy);
    };
    const buf = (this.flyBuf ??= createCanvas(W, H));
    const bctx = buf.getContext("2d");
    if (glyph.counter) {
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.globalCompositeOperation = "source-over";
      bctx.clearRect(0, 0, W, H);
      bctx.drawImage(this.peer.canvas, 0, 0);
      bctx.globalCompositeOperation = "destination-in";
      place(bctx);
      bctx.drawImage(glyph.counter, 0, 0);
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.globalCompositeOperation = "source-over";
      ctx.drawImage(buf, 0, 0);
    }
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, W, H);
    place(bctx);
    bctx.drawImage(glyph.body, 0, 0);
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.globalCompositeOperation = "source-in";
    bctx.fillStyle = glyph.color;
    bctx.fillRect(0, 0, W, H);
    bctx.globalCompositeOperation = "source-over";
    ctx.drawImage(buf, 0, 0);
    this.motionAmt = Math.max(this.motionAmt ?? 0, e);
  }

  makeGlyph(b, hero) {
    const text = String(hero.draw ?? hero.st.text ?? hero.text);
    const chars = [...text];
    let idx = -1;
    for (const c of "OQDBPRAobdpqaeg0469") if ((idx = chars.indexOf(c)) >= 0) break;
    idx = Math.max(idx, 0);
    const ch = chars[idx] ?? text[0];
    const S = 600;
    const c = createCanvas(S, S);
    const g = c.getContext("2d");
    g.font = `${S * 0.8}px "${hero.st.family}", "Symbols"`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#FFFFFF";
    g.fillText(ch, S / 2, S / 2);
    const data = g.getImageData(0, 0, S, S).data;
    const inGlyph = (i) => data[i * 4 + 3] > 110;
    const outside = new Uint8Array(S * S);
    const stack = [];
    for (let i = 0; i < S; i++) stack.push(i, (S - 1) * S + i, i * S, i * S + S - 1);
    while (stack.length) {
      const i = stack.pop();
      if (outside[i] || inGlyph(i)) continue;
      outside[i] = 1;
      const x = i % S;
      const y = (i / S) | 0;
      if (x > 0) stack.push(i - 1);
      if (x < S - 1) stack.push(i + 1);
      if (y > 0) stack.push(i - S);
      if (y < S - 1) stack.push(i + S);
    }
    const counter = createCanvas(S, S);
    const cg = counter.getContext("2d");
    const img = cg.createImageData(S, S);
    let n = 0;
    let sx = 0;
    let sy = 0;
    let [minX, minY, maxX, maxY] = [S, S, 0, 0];
    for (let i = 0; i < S * S; i++) {
      if (inGlyph(i)) {
        const x = i % S;
        const y = (i / S) | 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (!outside[i] && !inGlyph(i)) {
        img.data[i * 4 + 3] = 255;
        n++;
        sx += i % S;
        sy += (i / S) | 0;
      }
    }
    cg.putImageData(img, 0, 0);
    const scratch = this.ctx;
    scratch.save();
    scratch.font = `${hero.st.size}px "${hero.st.family}", "Symbols"`;
    scratch.letterSpacing = hero.st.spacing ? `${hero.st.spacing * hero.st.size}px` : "0px";
    const before = scratch.measureText(chars.slice(0, idx).join("")).width;
    const mc = scratch.measureText(ch);
    scratch.restore();
    const baseX = (hero.abs ? hero.x : b.textCenter.x + hero.x) + (hero.m.left ?? 0) + before;
    const baseY = hero.abs ? hero.y : b.textCenter.y + hero.y;
    const inkTop = baseY - mc.actualBoundingBoxAscent;
    const inkLeft = baseX - mc.actualBoundingBoxLeft;
    const scale = (mc.actualBoundingBoxAscent + mc.actualBoundingBoxDescent) / Math.max(maxY - minY, 1);
    return {
      body: c,
      counter: n > 200 ? counter : null,
      anchor: n > 200 ? [sx / n, sy / n] : [(minX + maxX) / 2, (minY + maxY) / 2],
      scale,
      x: inkLeft - minX * scale,
      y: inkTop - minY * scale,
      color: pieceColor(hero, b.theme),
    };
  }

  chroma(px) {
    const { W, H } = this;
    this.chromaBufs ??= [0, 1, 2, 3].map(() => createCanvas(W, H));
    const [src, r, g, bl] = this.chromaBufs;
    const s = src.getContext("2d");
    s.clearRect(0, 0, W, H);
    s.drawImage(this.canvas, 0, 0);
    for (const [c, color] of [[r, "#FF0000"], [g, "#00FF00"], [bl, "#0000FF"]]) {
      const x = c.getContext("2d");
      x.globalCompositeOperation = "source-over";
      x.clearRect(0, 0, W, H);
      x.drawImage(src, 0, 0);
      x.globalCompositeOperation = "multiply";
      x.fillStyle = color;
      x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = "source-over";
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(r, -px, 0);
    ctx.drawImage(g, 0, 0);
    ctx.drawImage(bl, px, 0);
    ctx.restore();
  }

  drawStamp(c, dt) {
    if (dt < 0) return;
    const { ctx, u } = this;
    const k = easeOutBack(dt / 0.35);
    const r = c.w * 0.19;
    ctx.save();
    ctx.translate(c.w / 2 - r * 0.55, -c.h / 2 + r * 0.55);
    ctx.rotate(-0.2);
    ctx.scale(2.2 - 1.2 * clamp01(k), 2.2 - 1.2 * clamp01(k));
    ctx.globalAlpha *= clamp01(dt / 0.12);
    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowBlur = 16 * u;
    ctx.fillStyle = c.stamp === "no" ? "#E0393E" : "#1E9E5A";
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = r * 0.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (c.stamp === "no") {
      const d = r * 0.42;
      ctx.moveTo(-d, -d);
      ctx.lineTo(d, d);
      ctx.moveTo(d, -d);
      ctx.lineTo(-d, d);
    } else {
      ctx.moveTo(-r * 0.45, r * 0.02);
      ctx.lineTo(-r * 0.12, r * 0.35);
      ctx.lineTo(r * 0.48, -r * 0.35);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawSlider(b, t, exit) {
    const { ctx, u } = this;
    const { box, a, b: after } = b.slider;
    const dt = t - b.visualAt;
    if (dt < 0) return;
    const appear = easeOutCubic(dt / 0.45);
    const p = easeInOutCubic((dt - 0.75) / 0.9);
    const light = isLight(b.theme.bg);
    const focus = b.visual?.focus ?? "full";
    const fit = (img) => {
      const sy = focus === "lower" ? img.height * 0.45 : 0;
      const sh = focus === "lower" ? img.height * 0.55 : focus === "upper" ? img.height * 0.55 : img.height;
      const r = Math.min((box.w * 0.94) / img.width, (box.h * 0.94) / sh);
      const w = img.width * r;
      const h = sh * r;
      ctx.drawImage(img, 0, sy, img.width, sh, box.x + (box.w - w) / 2, box.y + box.h - h - box.h * 0.03, w, h);
    };
    ctx.save();
    ctx.globalAlpha = clamp01(dt / 0.25) * (1 - exit);
    ctx.translate(0, 50 * u * (1 - appear));
    ctx.fillStyle = mix(b.theme.bg, light ? "#000000" : "#FFFFFF", 0.07);
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, 34 * u);
    ctx.fill();
    ctx.save();
    ctx.clip();
    fit(a.img);
    const edge = box.x + box.w * (1 - p);
    if (p > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(edge, box.y, box.x + box.w - edge, box.h);
      ctx.clip();
      ctx.fillStyle = mix(b.theme.bg, light ? "#000000" : "#FFFFFF", 0.12);
      ctx.fillRect(edge, box.y, box.x + box.w - edge, box.h);
      fit(after.img);
      ctx.restore();
    }
    ctx.restore();
    if (p > 0.001 && p < 0.999) {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(edge - 3 * u, box.y, 6 * u, box.h);
      ctx.beginPath();
      ctx.arc(edge, box.y + box.h / 2, 34 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = b.theme.bg;
      ctx.font = `${34 * u}px "Oswald SemiBold", "Symbols"`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("‹ ›", edge, box.y + box.h / 2);
    }
    const label = (p < 0.5 ? a.label : after.label) || (p < 0.5 ? "BEFORE" : "AFTER");
    ctx.font = `${34 * u}px "Oswald SemiBold", "Symbols"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const tw = ctx.measureText(label.toUpperCase()).width + 44 * u;
    ctx.fillStyle = p < 0.5 ? "#1B1714" : b.theme.accent;
    ctx.beginPath();
    ctx.roundRect(box.x + box.w / 2 - tw / 2, box.y + box.h - 30 * u, tw, 60 * u, 30 * u);
    ctx.fill();
    ctx.fillStyle = p < 0.5 ? "#FFFFFF" : isLight(b.theme.accent) ? "#1B1714" : "#FFFFFF";
    ctx.fillText(label.toUpperCase(), box.x + box.w / 2, box.y + box.h);
    ctx.restore();
  }

  drawZoom(b, t, exit) {
    const { ctx, u, H } = this;
    const z = b.zoom;
    const im = b.images[0];
    const dt = t - b.visualAt - 0.55;
    if (dt < 0) return;
    const k = clamp01(easeOutBack(dt / 0.5));
    const shoes = z.target.y > 0.9;
    const towards = z.cx > im.x + im.w / 2 ? 1 : -1;
    const sx = im.x + im.w * (0.5 + (shoes ? 0.13 * towards : z.target.x > 0.3 ? z.target.x : 0));
    const sy = Math.min(im.y + im.h * (shoes ? 0.945 : z.target.y), H * SAFE_BOTTOM - 20 * u);
    const cyEnd = Math.min(Math.max(sy - z.r * 0.4, H * 0.38), H * 0.78 - z.r);
    const R = z.r * k;
    const cx = sx + (z.cx - sx) * k;
    const cy = sy + (cyEnd - sy) * k;
    const r0 = z.r / z.factor;
    ctx.save();
    ctx.globalAlpha = clamp01(dt / 0.15) * (1 - exit);
    ctx.strokeStyle = b.theme.accent;
    ctx.lineWidth = 5 * u;
    ctx.beginPath();
    ctx.arc(sx, sy, r0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx, sy - r0);
    ctx.lineTo(cx, cy - R);
    ctx.moveTo(sx, sy + r0);
    ctx.lineTo(cx, cy + R);
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = mix(b.theme.bg, "#FFFFFF", 0.12);
    ctx.fill();
    ctx.clip();
    const f = z.factor * (0.4 + 0.6 * k);
    ctx.drawImage(im.img, cx - (sx - im.x) * f, cy - (sy - im.y) * f, im.w * f, im.h * f);
    ctx.restore();
    ctx.lineWidth = 9 * u;
    ctx.strokeStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 5 * u;
    ctx.strokeStyle = b.theme.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 7 * u, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawScale(b, t, exit) {
    const { ctx, u } = this;
    const s = b.scale;
    const dt = t - b.visualAt;
    if (dt < 0) return;
    ctx.save();
    ctx.globalAlpha = 1 - exit;
    const draw = easeOutCubic(dt / 0.35);
    ctx.strokeStyle = hexA(b.theme.ink, 0.35);
    ctx.lineWidth = 6 * u;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(s.x0, s.y);
    ctx.lineTo(s.x0 + (s.x1 - s.x0) * draw, s.y);
    ctx.stroke();
    const stops = s.stops;
    let mx = stops[0].x;
    for (let i = 1; i < stops.length; i++) {
      const p = easeInOutCubic((dt - stops[i - 1].delay) / (stops[i].delay - stops[i - 1].delay));
      if (p > 0) mx = stops[i - 1].x + (stops[i].x - stops[i - 1].x) * p;
    }
    stops.forEach((st, i) => {
      const sd = dt - st.delay;
      const last = i === stops.length - 1;
      ctx.fillStyle = sd >= 0 ? (last ? b.theme.accent : b.theme.ink) : hexA(b.theme.ink, 0.35);
      ctx.beginPath();
      ctx.arc(st.x, s.y, 12 * u, 0, Math.PI * 2);
      ctx.fill();
      if (sd < 0) return;
      const k = easeOutBack(sd / 0.4);
      const r = Math.min(s.bw / st.img.width, s.bh / st.img.height);
      const w = st.img.width * r;
      const h = st.img.height * r;
      ctx.save();
      ctx.translate(st.x, s.y - 34 * u);
      ctx.scale(0.5 + 0.5 * k, 0.5 + 0.5 * k);
      ctx.globalAlpha *= clamp01(sd / 0.15);
      ctx.drawImage(st.img, -w / 2, -h, w, h);
      ctx.restore();
      if (st.label) {
        ctx.globalAlpha = (1 - exit) * clamp01(sd / 0.2);
        ctx.fillStyle = last ? b.theme.accent : b.theme.ink;
        ctx.font = `${(last ? 46 : 38) * u}px "Oswald SemiBold", "Symbols"`;
        ctx.textAlign = "center";
        ctx.fillText(st.label.toUpperCase(), st.x, s.y + 64 * u);
        ctx.globalAlpha = 1 - exit;
      }
    });
    ctx.fillStyle = b.theme.accent;
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 5 * u;
    ctx.beginPath();
    ctx.arc(mx, s.y, 22 * u * draw, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawArrow(p, theme, t, exit) {
    const { ctx, u } = this;
    const k = easeInOutSine((t - p.at - 0.15) / 0.45);
    if (k <= 0) return;
    const a = p.arrow;
    const mx = (a.sx + a.ex) / 2 + a.bend * 90 * u;
    const my = Math.min(a.sy, a.ey) - 40 * u;
    const pts = bezierPoints(a.sx, a.sy, mx, my + 120 * u, mx, my, a.ex, a.ey, 40);
    const n = Math.max(2, Math.round(pts.length * k));
    ctx.save();
    ctx.globalAlpha = 1 - exit;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 5 * u;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    pts.slice(0, n).forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    if (k >= 1) {
      const [x1, y1] = pts.at(-3);
      const [x2, y2] = pts.at(-1);
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const len = 30 * u;
      ctx.beginPath();
      ctx.moveTo(x2 - len * Math.cos(ang - 0.5), y2 - len * Math.sin(ang - 0.5));
      ctx.lineTo(x2, y2);
      ctx.lineTo(x2 - len * Math.cos(ang + 0.5), y2 - len * Math.sin(ang + 0.5));
      ctx.stroke();
    }
    ctx.restore();
  }

  drawSticker(t) {
    const { ctx, u, W, H } = this;
    const st = this.sticker;
    const dt = t - st.at;
    if (dt < 0) return;
    const text = st.text.toUpperCase();
    ctx.save();
    const k = easeOutBack(dt / 0.45);
    const wiggle = Math.sin(clamp01((dt - 0.4) / 0.5) * Math.PI * 3) * (1 - clamp01((dt - 0.4) / 0.5)) * 4;
    const x = W * 0.76 + (1 - clamp01(k)) * W * 0.4;
    const y = H * 0.058;
    ctx.translate(x, y);
    ctx.rotate(((-6 + wiggle) * Math.PI) / 180);
    ctx.scale(0.85 + 0.15 * k, 0.85 + 0.15 * k);
    ctx.font = `${40 * u}px "Archivo Black", "Symbols"`;
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = "#FFD23F";
    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowBlur = 20 * u;
    ctx.shadowOffsetY = 8 * u;
    ctx.beginPath();
    ctx.roundRect(-tw / 2 - 22 * u, -40 * u, tw + 44 * u, 66 * u, 10 * u);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.fillStyle = "#111111";
    ctx.textAlign = "center";
    ctx.fillText(text, 0, 8 * u);
    ctx.restore();
  }

  drawBoard(b, t, exit) {
    const { ctx, u } = this;
    const v = b.visual;
    const box = b.visualBox;
    const dt = t - b.visualAt;
    if (dt < 0) return;
    const fade = 1 - exit;

    const fitInto = (img, w, h) => {
      const r = Math.min(w / img.width, h / img.height);
      return { w: img.width * r, h: img.height * r };
    };
    const label = (text, x, y, delay, color, align = "center") => {
      const k = easeOutCubic((dt - delay) / 0.4);
      if (k <= 0 || !text) return;
      ctx.save();
      ctx.globalAlpha = k * fade;
      ctx.font = `${30 * u}px "Oswald SemiBold", "Symbols"`;
      ctx.letterSpacing = `${2.4 * u}px`;
      ctx.textAlign = align;
      ctx.fillStyle = color ?? b.theme.ink;
      ctx.fillText(String(text).toUpperCase(), x, y + 10 * u * (1 - k));
      ctx.restore();
    };
    const imgAt = (img, x, y, w, h, delay) => {
      const k = easeOutCubic((dt - delay) / 0.5);
      if (k <= 0) return;
      ctx.save();
      ctx.globalAlpha = k * fade;
      ctx.shadowColor = "rgba(0,0,0,0.28)";
      ctx.shadowBlur = 40 * u;
      ctx.shadowOffsetY = 18 * u;
      ctx.drawImage(img, x, y + 50 * u * (1 - k), w, h);
      ctx.restore();
    };

    if (v.kind === "swatches" && v.colors.length) {
      const style = v.style ?? "tiles";
      if (style === "pills") return this.drawPills(v.colors, box, dt, fade);
      if (style === "strokes") return this.drawStrokes(v.colors, box, dt, fade, b.theme);
      const n = v.colors.length;
      const cols = Math.min(n, n === 4 ? 2 : 3);
      const rows = Math.ceil(n / cols);
      const labelH = 60 * u;
      const size = Math.min((box.w - (cols - 1) * 36 * u) / cols, (box.h - rows * labelH - (rows - 1) * 24 * u) / rows, 300 * u);
      const gridW = cols * size + (cols - 1) * 36 * u;
      const gridH = rows * (size + labelH) + (rows - 1) * 24 * u;
      const x0 = box.x + (box.w - gridW) / 2;
      const y0 = box.y + (box.h - gridH) / 2;
      v.colors.forEach((c, i) => {
        const x = x0 + (i % cols) * (size + 36 * u);
        const y = y0 + Math.floor(i / cols) * (size + labelH + 24 * u);
        const delay = i * 0.09;
        const k = easeOutBack((dt - delay) / 0.45);
        if (k <= 0) return;
        ctx.save();
        ctx.globalAlpha = clamp01(k) * fade;
        ctx.translate(x + size / 2, y + size / 2);
        ctx.scale(0.8 + 0.2 * k, 0.8 + 0.2 * k);
        ctx.shadowColor = "rgba(0,0,0,0.22)";
        ctx.shadowBlur = 30 * u;
        ctx.shadowOffsetY = 12 * u;
        ctx.fillStyle = c.hex;
        ctx.beginPath();
        ctx.roundRect(-size / 2, -size / 2, size, size, size * 0.14);
        ctx.fill();
        ctx.restore();
        label(c.name, x + size / 2, y + size + 44 * u, delay + 0.1);
      });
      return;
    }

    if (v.kind === "shades" && v.colors[0]) {
      const base = v.colors[0].hex;
      const cols = 5;
      const rows = 3;
      const w = Math.min(box.w, box.h * 1.55);
      const h = w / 1.55;
      const x0 = box.x + (box.w - w) / 2;
      const y0 = box.y + (box.h - h) / 2;
      const k = easeOutCubic(dt / 0.5);
      ctx.save();
      ctx.globalAlpha = k * fade;
      ctx.translate(x0 + w / 2, y0 + h / 2);
      ctx.scale(0.92 + 0.08 * k, 0.92 + 0.08 * k);
      ctx.shadowColor = "rgba(0,0,0,0.25)";
      ctx.shadowBlur = 40 * u;
      ctx.shadowOffsetY = 16 * u;
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, 40 * u);
      ctx.fillStyle = base;
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.clip();
      const tw = w / cols;
      const th = h / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const tk = easeOutCubic((dt - (r + c) * 0.05) / 0.4);
          const f = (c / (cols - 1)) * 0.9 + (r / (rows - 1)) * 0.25 - 0.45;
          ctx.globalAlpha = tk * fade;
          ctx.fillStyle = f < 0 ? mix(base, "#FFFFFF", -f * 1.1) : mix(base, "#000000", f * 0.9);
          ctx.fillRect(-w / 2 + c * tw, -h / 2 + r * th, tw + 1, th + 1);
        }
      }
      ctx.restore();
      label(v.colors[0].name, box.x + box.w / 2, y0 + h + 60 * u, 0.3);
      return;
    }

    if ((v.kind === "outfit" || v.kind === "compare") && v.images.length) {
      const items = v.images.slice(0, 4);
      const n = items.length;
      const gap = (v.kind === "compare" ? 140 : 60) * u;
      const cellW = (box.w - gap * (n - 1)) / n;
      const imgH = box.h - 80 * u;
      items.forEach((it, i) => {
        const x = box.x + i * (cellW + gap);
        const { w, h } = fitInto(it.img, cellW * 1.05, imgH);
        const delay = i * 0.14;
        imgAt(it.img, x + (cellW - w) / 2, box.y + (imgH - h) / 2, w, h, delay);
        label(it.label, x + cellW / 2, box.y + imgH + 56 * u, delay + 0.15);
        if (i < n - 1) {
          const k = easeOutCubic((dt - delay - 0.1) / 0.3);
          ctx.save();
          ctx.globalAlpha = k * fade;
          ctx.textAlign = "center";
          ctx.fillStyle = v.kind === "compare" ? b.theme.script : b.theme.muted;
          ctx.font = v.kind === "compare" ? `${170 * u}px "Allura"` : `${80 * u}px "Anton"`;
          ctx.fillText(v.kind === "compare" ? "vs" : "+", x + cellW + gap / 2, box.y + imgH / 2 + 30 * u);
          ctx.restore();
        }
      });
    }
  }

  drawPills(colors, box, dt, fade) {
    const { ctx, u } = this;
    const n = colors.length;
    const pw = Math.min(box.w * 0.7, 620 * u);
    const ph = Math.min((box.h / (n * 0.74 + 0.26)) * 1, 150 * u);
    const step = ph * 0.74;
    const totalH = step * (n - 1) + ph;
    const x = box.x + (box.w - pw) / 2;
    const y0 = box.y + (box.h - totalH) / 2;
    colors.forEach((c, i) => {
      const k = easeOutCubic((dt - i * 0.08) / 0.4);
      if (k <= 0) return;
      const y = y0 + i * step - 40 * u * (1 - k);
      ctx.save();
      ctx.globalAlpha = k * fade;
      ctx.shadowColor = "rgba(0,0,0,0.3)";
      ctx.shadowBlur = 26 * u;
      ctx.shadowOffsetY = 10 * u;
      ctx.fillStyle = c.hex;
      ctx.beginPath();
      ctx.roundRect(x, y, pw, ph, ph / 2);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.font = `${24 * u}px "Oswald SemiBold", "Symbols"`;
      ctx.letterSpacing = `${2 * u}px`;
      ctx.fillStyle = isLight(c.hex) ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.75)";
      ctx.fillText(`${c.name.toUpperCase()}  ${c.hex.toUpperCase()}`, x + ph * 0.45, y + ph * 0.36);
      ctx.restore();
    });
  }

  drawStrokes(colors, box, dt, fade, theme) {
    const { ctx, u } = this;
    const n = colors.length;
    const sw = Math.min(box.w * 0.82, 760 * u);
    const sh = Math.min(box.h / (n * 1.25), 130 * u);
    const gap = sh * 0.25;
    const totalH = n * sh + (n - 1) * gap;
    const x = box.x + (box.w - sw) / 2;
    const y0 = box.y + (box.h - totalH) / 2;
    colors.forEach((c, i) => {
      const reveal = easeInOutSine((dt - i * 0.12) / 0.45);
      if (reveal <= 0) return;
      const y = y0 + i * (sh + gap);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.beginPath();
      ctx.rect(x - sh, y - sh, (sw + sh * 2) * reveal, sh * 3);
      ctx.clip();
      ctx.shadowColor = "rgba(0,0,0,0.22)";
      ctx.shadowBlur = 18 * u;
      ctx.shadowOffsetY = 8 * u;
      ctx.fillStyle = c.hex;
      brushPath(ctx, x, y, sw, sh, i + 1);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.clip();
      const rnd = seeded(i * 97 + 13);
      for (let s = 0; s < 14; s++) {
        ctx.strokeStyle = rnd() > 0.5 ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)";
        ctx.lineWidth = (1 + rnd() * 3) * u;
        const yy = y + rnd() * sh;
        ctx.beginPath();
        ctx.moveTo(x, yy);
        ctx.lineTo(x + sw, yy + (rnd() - 0.5) * 6 * u);
        ctx.stroke();
      }
      ctx.restore();
      if (c.name && reveal > 0.9) {
        ctx.save();
        ctx.globalAlpha = fade * clamp01((reveal - 0.9) * 10);
        ctx.font = `${26 * u}px "Oswald SemiBold", "Symbols"`;
        ctx.letterSpacing = `${2 * u}px`;
        ctx.fillStyle = theme.muted;
        ctx.textAlign = "right";
        ctx.fillText(c.name.toUpperCase(), x + sw, y + sh + 30 * u);
        ctx.restore();
      }
    });
  }

  output(pass = "all") {
    if (this.out === this.canvas) return this.canvas;
    const o = this.out.getContext("2d");
    o.clearRect(0, 0, this.outW, this.outH);
    if (pass === "all" || pass === "bg") {
      o.fillStyle = "#000000";
      o.fillRect(0, 0, this.outW, this.outH);
    }
    o.drawImage(this.canvas, 0, this.offY);
    return this.out;
  }

  pixels(pass = "all") {
    const c = this.output(pass);
    return Buffer.from(c.getContext("2d").getImageData(0, 0, c.width, c.height).data.buffer);
  }
}

function brushPath(ctx, x, y, w, h, seed) {
  const rnd = seeded(seed);
  const steps = 24;
  ctx.beginPath();
  ctx.moveTo(x + h * 0.4, y + h * 0.06);
  for (let i = 1; i <= steps; i++) {
    const px = x + h * 0.4 + ((w - h * 0.4) * i) / steps;
    const taper = i > steps * 0.8 ? ((i - steps * 0.8) / (steps * 0.2)) * h * 0.18 : 0;
    ctx.lineTo(px, y + h * 0.04 + (rnd() - 0.5) * h * 0.08 + taper);
  }
  ctx.quadraticCurveTo(x + w + h * 0.08, y + h * 0.5, x + w - h * 0.05, y + h * 0.82);
  for (let i = steps; i >= 1; i--) {
    const px = x + h * 0.4 + ((w - h * 0.4) * i) / steps;
    const taper = i > steps * 0.8 ? ((i - steps * 0.8) / (steps * 0.2)) * h * 0.14 : 0;
    ctx.lineTo(px, y + h * 0.96 + (rnd() - 0.5) * h * 0.08 - taper);
  }
  ctx.bezierCurveTo(x - h * 0.05, y + h * 1.0, x - h * 0.08, y + h * 0.02, x + h * 0.4, y + h * 0.06);
  ctx.closePath();
}

function bezierPoints(x0, y0, x1, y1, x2, y2, x3, y3, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const mt = 1 - t;
    pts.push([
      mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3,
      mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3,
    ]);
  }
  return pts;
}

function drawTexture(g, W, H, theme, u) {
  const tex = theme.texture ?? "none";
  if (tex === "none") return;
  const ink = isLight(theme.bg) ? "0,0,0" : "255,255,255";
  if (tex === "grid" || tex === "paper") {
    const rnd = seeded(7);
    for (const [cols, alpha] of [[9, 0.16], [22, 0.08]]) {
      const rows = Math.round((cols * H) / W);
      const n = createCanvas(cols, rows);
      const nx = n.getContext("2d");
      const img = nx.createImageData(cols, rows);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 128 + (rnd() - 0.5) * 255;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      nx.putImageData(img, 0, 0);
      g.save();
      g.globalAlpha = alpha;
      g.globalCompositeOperation = "soft-light";
      g.imageSmoothingEnabled = true;
      g.drawImage(n, 0, 0, W, H);
      g.restore();
    }
    g.save();
    g.lineWidth = 1.6 * u;
    for (let i = 0; i < 12; i++) {
      const x0 = rnd() * W;
      const y0 = rnd() * H;
      const ang = rnd() * Math.PI;
      const len = (0.3 + rnd() * 0.5) * Math.max(W, H);
      const x1 = x0 + Math.cos(ang) * len;
      const y1 = y0 + Math.sin(ang) * len;
      g.strokeStyle = `rgba(255,255,255,0.18)`;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
      g.strokeStyle = `rgba(0,0,0,0.07)`;
      g.beginPath();
      g.moveTo(x0 + 2 * u, y0 + 2 * u);
      g.lineTo(x1 + 2 * u, y1 + 2 * u);
      g.stroke();
    }
    g.restore();
  }
  if (tex === "grid") {
    g.save();
    g.strokeStyle = `rgba(${ink},0.09)`;
    g.lineWidth = 1.5 * u;
    const step = 54 * u;
    g.beginPath();
    for (let x = step / 2; x < W; x += step) (g.moveTo(x, 0), g.lineTo(x, H));
    for (let y = step / 2; y < H; y += step) (g.moveTo(0, y), g.lineTo(W, y));
    g.stroke();
    g.restore();
  }
  if (tex === "dots") {
    g.save();
    g.fillStyle = `rgba(${ink},0.16)`;
    const step = 44 * u;
    for (let x = step / 2; x < W; x += step) {
      for (let y = step / 2; y < H; y += step) {
        g.beginPath();
        g.arc(x, y, 2.4 * u, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
  }
}

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export async function renderVideo(tl, { narrationFile, musicFile, musicStart = 0, sfxFile, out, log, cacheDir = null }) {
  const audioIn = ["-i", narrationFile];
  CODE_VERSION = codeVersion();
  let next = 2;
  let voice = "[1:a]apad,loudnorm=I=-14:TP=-1.5[vo]";
  let bed = "[vo]";
  if (sfxFile) {
    audioIn.push("-i", sfxFile);
    voice += `;[${next}:a]volume=${config.sfxVolume}[sx];[vo][sx]amix=inputs=2:duration=first:normalize=0[vs]`;
    bed = "[vs]";
    next++;
  }
  const master = `loudnorm=I=${config.finalLufs}:TP=-1:LRA=9`;
  let audio = `${voice};${bed}${master}[a]`;
  if (musicFile) {
    audioIn.push("-stream_loop", "-1", "-ss", String(musicStart), "-i", musicFile);
    audio =
      `${voice};${bed}asplit=2[v1][v2];[${next}:a]loudnorm=I=${config.musicLufs}:TP=-2,` +
      `afade=t=out:st=${Math.max(tl.total - 1.5, 0).toFixed(2)}:d=1.5[m];` +
      `[m][v2]sidechaincompress=threshold=0.05:ratio=6:attack=20:release=300[md];` +
      `[v1][md]amix=inputs=2:duration=first:normalize=0,${master}[a]`;
  }
  const audioOut = ["-filter_complex", audio, "-map", "0:v", "-map", "[a]", "-t", tl.total.toFixed(3), "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out];

  if (!cacheDir) {
    await encodeFrames(tl, 0, Math.ceil(tl.total * FPS), [...audioIn], [...audioOut.slice(0, -3), ...VIDEO_CODEC, ...audioOut.slice(-3)], log);
    return;
  }

  await fs.mkdir(cacheDir, { recursive: true });
  const total = Math.ceil(tl.total * FPS);
  const pieces = tl.timeline.map((b, i) => {
    const f0 = i === 0 ? 0 : Math.round(b.t0 * FPS);
    const f1 = i === tl.timeline.length - 1 ? total : Math.round(tl.timeline[i + 1].t0 * FPS);
    return { i, f0, f1, file: path.join(cacheDir, `beat-${String(i + 1).padStart(2, "0")}-${beatSignature(tl, i, f0, f1)}.mp4`) };
  }).filter((p) => p.f1 > p.f0);
  const todo = [];
  for (const p of pieces) if (!(await fs.stat(p.file).catch(() => null))) todo.push(p);
  log(todo.length === pieces.length ? `Render: all ${pieces.length} beats` : `Render: ${todo.length} of ${pieces.length} beats changed, reusing the rest`);
  for (const [k, p] of todo.entries()) {
    await encodeFrames(tl, p.f0, p.f1, [], [...VIDEO_CODEC, "-an", `${p.file}.tmp.mp4`], () => {});
    await fs.rename(`${p.file}.tmp.mp4`, p.file);
    log(`Render: beat ${p.i + 1} (${k + 1}/${todo.length})`);
  }
  const keep = new Set(pieces.map((p) => path.basename(p.file)));
  for (const f of await fs.readdir(cacheDir)) if (!keep.has(f)) await fs.rm(path.join(cacheDir, f), { force: true });

  const list = path.join(cacheDir, "..", "beats.txt");
  await fs.writeFile(list, pieces.map((p) => `file '${p.file.replace(/'/g, "'\\''")}'`).join("\n"));
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, ...audioIn, ...audioOut.slice(0, -3), "-c:v", "copy", ...audioOut.slice(-3)]);
}

const VIDEO_CODEC = ["-c:v", "libx264", "-preset", "medium", "-crf", "19", "-maxrate", "10M", "-bufsize", "20M", "-pix_fmt", "yuv420p", "-r", String(FPS)];

async function encodeFrames(tl, f0, f1, inputs, outputArgs, log) {
  const r = new EditorialRenderer(tl);
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${tl.outW ?? tl.W}x${tl.outH ?? tl.H}`, "-r", String(FPS), "-i", "-", ...inputs, ...outputArgs];
  const ff = spawn("ffmpeg", args, { stdio: ["pipe", "inherit", "pipe"] });
  let stderr = "";
  ff.stderr.on("data", (d) => (stderr += d));
  const done = new Promise((resolve, reject) => {
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg: ${stderr.slice(-800)}`))));
  });
  let lastPct = -1;
  for (let f = f0; f < f1; f++) {
    r.frame(f / FPS);
    if (!ff.stdin.write(r.pixels())) await new Promise((res) => ff.stdin.once("drain", res));
    const pct = Math.floor(((f - f0) / (f1 - f0)) * 10) * 10;
    if (pct !== lastPct) {
      lastPct = pct;
      log(`Render: ${pct}%`);
    }
  }
  ff.stdin.end();
  await done;
}

const codeFiles = (dir) =>
  readdirSync(fileURLToPath(new URL(dir, import.meta.url)), { withFileTypes: true })
    .filter((f) => f.isFile() && f.name.endsWith(".js"))
    .map((f) => readFileSync(fileURLToPath(new URL(`${dir}${f.name}`, import.meta.url)), "utf8"))
    .sort();
function codeVersion() {
  let learned = [];
  try {
    learned = codeFiles("../../motions/learned/");
  } catch {}
  return createHash("sha1")
    .update(readFileSync(fileURLToPath(import.meta.url)))
    .update(readFileSync(fileURLToPath(new URL("./design.js", import.meta.url))))
    .update([...codeFiles("../../motions/"), ...learned].join("\n"))
    .digest("hex")
    .slice(0, 8);
}
let CODE_VERSION = codeVersion();
function beatSignature(tl, i, f0, f1) {
  const json = (b) =>
    b &&
    JSON.stringify(b, (k, v) => {
      if (k === "stackPrev") return (v ?? []).map((x) => ({ i: x.index, pieces: x.pieces, theme: x.theme, t0: x.t0, t1: x.t1 }));
      if (v && typeof v === "object" && typeof v.width === "number" && typeof v.height === "number" && typeof v.getContext !== "function" && !Array.isArray(v) && v.constructor && v.constructor !== Object) {
        return `img:${v.width}x${v.height}:${v.src ?? ""}`;
      }
      return v;
    });
  return createHash("sha1")
    .update(
      [
        CODE_VERSION, tl.W, tl.H, tl.outH ?? "", FPS, f0, f1,
        JSON.stringify(tl.sticker ?? null),
        JSON.stringify(tl.look ?? {}),
        json(tl.timeline[i]),
        tl.timeline[i].transition === "letter" ? json(tl.timeline[i + 1]) : "",
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 12);
}

export function stillAt(tl, t) {
  const r = new EditorialRenderer(tl);
  r.frame(t);
  return r.output().encode("png");
}

function makeGrain(size) {
  const c = createCanvas(size, size);
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function hexA(hex, a) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${a})`;
}

export async function renderElement(tl, { pass, f0, f1, out }) {
  const r = new EditorialRenderer(tl);
  const w = tl.outW ?? tl.W;
  const h = tl.outH ?? tl.H;
  const ff = spawn(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${w}x${h}`, "-r", String(FPS), "-i", "-",
      "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le", "-qscale:v", "24", "-vendor", "apl0", "-r", String(FPS), out,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let stderr = "";
  ff.stderr.on("data", (d) => (stderr += d));
  const done = new Promise((resolve, reject) => {
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg (${pass}): ${stderr.slice(-600)}`))));
  });
  let seen = false;
  for (let f = f0; f < f1; f++) {
    r.frame(f / FPS, pass);
    const px = r.pixels(pass);
    if (!seen) for (let i = 3; i < px.length; i += 4 * 53) if (px[i] > 8) { seen = true; break; }
    if (!ff.stdin.write(px)) await new Promise((res) => ff.stdin.once("drain", res));
  }
  ff.stdin.end();
  await done;
  if (!seen) {
    await fs.rm(out, { force: true });
    return { empty: true };
  }
  return { empty: false };
}

export async function renderLayer(tl, { pass, out, log }) {
  const r = new EditorialRenderer(tl);
  const frames = Math.ceil(tl.total * FPS);
  const codec =
    pass === "bg"
      ? ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-maxrate", "8M", "-bufsize", "16M", "-pix_fmt", "yuv420p"]
      : ["-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le", "-qscale:v", "24", "-vendor", "apl0"];
  const ff = spawn(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${tl.outW ?? tl.W}x${tl.outH ?? tl.H}`, "-r", String(FPS), "-i", "-",
      ...codec, "-r", String(FPS), out,
    ],
    { stdio: ["pipe", "inherit", "pipe"] },
  );
  let stderr = "";
  ff.stderr.on("data", (d) => (stderr += d));
  const done = new Promise((resolve, reject) => {
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg (${pass}): ${stderr.slice(-600)}`))));
  });
  let lastPct = -1;
  for (let f = 0; f < frames; f++) {
    r.frame(f / FPS, pass);
    if (!ff.stdin.write(r.pixels(pass))) await new Promise((res) => ff.stdin.once("drain", res));
    const pct = Math.floor((f / frames) * 4) * 25;
    if (pct !== lastPct) {
      lastPct = pct;
      log(`  ${pass}: ${pct}%`);
    }
  }
  ff.stdin.end();
  await done;
  return { frames };
}
