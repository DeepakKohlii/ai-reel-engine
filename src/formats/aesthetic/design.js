import path from "node:path";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { config } from "../../config.js";
import "../editorial/design.js";

const fontDir = path.join(config.root, "node_modules", "@fontsource");
for (const [file, family] of [
  ["ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2", "Plex Mono"],
  ["ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2", "Plex Mono Medium"],
  ["newsreader/files/newsreader-latin-400-italic.woff2", "Newsreader Italic"],
]) GlobalFonts.registerFromPath(path.join(fontDir, file), family);

export const W = 1080;
export const H = 1920;

export const INK = "#1E1E1C";
export const MUTED = "#6B6A66";
export const GOOD = "#2DB25B";
export const BAD = "#E5484D";
export const HOT = "#FF5733";

export const THEME = { head: "Instrument Serif", headItalic: "Instrument Serif Italic", italic: true, upper: false, label: "Plex Mono Medium", pill: "outline", accent: "#FF5733", page: "#ECECEA", texture: "sweep", corners: false };
export function useStyle(style, fonts = {}) {
  if (!style) return;
  Object.assign(THEME, {
    head: style.headline_font,
    headItalic: fonts[style.headline_font]?.italic ?? null,
    italic: !!style.headline_italic,
    upper: !!style.headline_upper,
    label: style.label_font,
    pill: style.pill,
    accent: style.accent,
    page: style.page,
    texture: style.texture,
    corners: !!style.corners,
  });
}
const labelFont = (size) => `${size}px "${THEME.label}"`;

const isLightHex = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 170;
};

const bgCache = new Map();
export function page() {
  if (THEME.plate) return THEME.plate;
  const key = `page:${THEME.page}:${THEME.texture}`;
  if (bgCache.has(key)) return bgCache.get(key);
  const c = createCanvas(W, H);
  const g = c.getContext("2d");
  g.fillStyle = THEME.page;
  g.fillRect(0, 0, W, H);
  const t = THEME.texture;
  if (t === "sweep") {
    const glow = g.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, H * 0.6);
    glow.addColorStop(0, "rgba(255,255,255,0.5)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
    const floor = g.createLinearGradient(0, H * 0.72, 0, H);
    floor.addColorStop(0, "rgba(0,0,0,0)");
    floor.addColorStop(1, "rgba(0,0,0,0.08)");
    g.fillStyle = floor;
    g.fillRect(0, H * 0.72, W, H * 0.28);
  } else if (t === "dots") {
    const warm = /^#?([0-9a-f]{6})$/i.exec(THEME.page ?? "") && (() => {
      const n = parseInt(THEME.page.replace("#", ""), 16);
      return (n >> 16) - (n & 255) > 14;
    })();
    g.fillStyle = warm ? "rgba(90,80,65,0.16)" : "rgba(105,108,116,0.24)";
    for (let y = 24; y < H; y += 32) for (let x = 24; x < W; x += 32) {
      g.beginPath();
      g.arc(x, y, 1.6, 0, Math.PI * 2);
      g.fill();
    }
  } else if (t === "grid" || t === "lines") {
    g.strokeStyle = "rgba(60,55,45,0.08)";
    g.lineWidth = 1.5;
    for (let y = 60; y < H; y += 60) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }
    if (t === "grid") for (let x = 60; x < W; x += 60) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
    }
  } else if (t === "grain") {
    const im = g.getImageData(0, 0, W, H);
    let seed = 7;
    for (let i = 0; i < im.data.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const n = ((seed >>> 24) - 128) * 0.06;
      im.data[i] += n;
      im.data[i + 1] += n;
      im.data[i + 2] += n;
    }
    g.putImageData(im, 0, 0);
  }
  bgCache.set(key, c);
  return c;
}

export function background(kind = "studio") {
  if (kind === "custom") return page();
  if (bgCache.has(kind)) return bgCache.get(kind);
  const c = createCanvas(W, H);
  const g = c.getContext("2d");
  if (kind === "white" || kind === "cream") {
    g.fillStyle = kind === "white" ? "#FBFBFA" : "#F4EFE7";
    g.fillRect(0, 0, W, H);
    const floor = g.createLinearGradient(0, H * 0.7, 0, H);
    floor.addColorStop(0, "rgba(0,0,0,0)");
    floor.addColorStop(1, kind === "white" ? "rgba(0,0,0,0.035)" : "rgba(90,60,30,0.06)");
    g.fillStyle = floor;
    g.fillRect(0, H * 0.7, W, H * 0.3);
  } else if (kind === "paper") {
    g.fillStyle = "#F4F2EE";
    g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(120,110,95,0.16)";
    for (let y = 22; y < H; y += 30) for (let x = 22; x < W; x += 30) {
      g.beginPath();
      g.arc(x, y, 1.4, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    const base = g.createLinearGradient(0, 0, 0, H);
    base.addColorStop(0, "#E9E9E7");
    base.addColorStop(0.62, "#F1F1EF");
    base.addColorStop(0.8, "#E7E7E4");
    base.addColorStop(1, "#DCDCD9");
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, H * 0.6);
    glow.addColorStop(0, "rgba(255,255,255,0.55)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
    const vig = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.78);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.07)");
    g.fillStyle = vig;
    g.fillRect(0, 0, W, H);
  }
  bgCache.set(kind, c);
  return c;
}

export function corners(g, { inset = 36, len = 34, color = "rgba(30,30,28,0.55)", width = 2 } = {}) {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = width;
  for (const [x, y, sx, sy] of [[inset, inset, 1, 1], [W - inset, inset, -1, 1], [inset, H - inset, 1, -1], [W - inset, H - inset, -1, -1]]) {
    g.beginPath();
    g.moveTo(x, y + sy * len);
    g.lineTo(x, y);
    g.lineTo(x + sx * len, y);
    g.stroke();
  }
  g.restore();
}

export function cropCorners(g, { x0, y0, x1, y1, len = 34, color = "rgba(30,30,28,0.55)", width = 2 } = {}) {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = width;
  for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
    g.beginPath();
    g.moveTo(x, y + sy * len);
    g.lineTo(x, y);
    g.lineTo(x + sx * len, y);
    g.stroke();
  }
  g.restore();
}

export function standing(g, img, { cx = W / 2, feet = H * 0.86, height = H * 0.62, alpha = 1, shadow = true, only = "" } = {}) {
  const h = height;
  const w = (img.width / img.height) * h;
  g.save();
  g.globalAlpha = alpha;
  if (shadow) {
    const sh = g.createRadialGradient(cx, feet, 0, cx, feet, w * 0.55);
    sh.addColorStop(0, "rgba(0,0,0,0.22)");
    sh.addColorStop(1, "rgba(0,0,0,0)");
    g.save();
    g.translate(cx, feet);
    g.scale(1, 0.12);
    g.translate(-cx, -feet);
    g.fillStyle = sh;
    g.fillRect(cx - w, feet - w, w * 2, w * 2);
    g.restore();
  }
  if (only !== "shadow") {
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(img, cx - w / 2, feet - h, w, h);
  }
  g.restore();
  return { x: cx - w / 2, y: feet - h, w, h };
}

export function title(g, text, { y = H * 0.1, size = 84, italic = true, color = INK, alpha = 1 } = {}) {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.font = `${size}px "${italic ? "Instrument Serif Italic" : "Instrument Serif"}"`;
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.letterSpacing = "-1px";
  g.fillText(text, W / 2, y);
  g.restore();
}

export function subtitle(g, text, { y = H * 0.885, size = 34, alpha = 1, color = "#4A4946" } = {}) {
  if (!text) return;
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.font = `${size}px "Newsreader Italic"`;
  g.textAlign = "center";
  g.fillText(text, W / 2, y);
  g.restore();
}

export function bigLabel(g, text, { x = 64, y = 250, size = 118, file = "", alpha = 1 } = {}) {
  g.save();
  g.globalAlpha = alpha;
  if (file) {
    g.font = `20px "Plex Mono Medium"`;
    g.fillStyle = INK;
    g.letterSpacing = "1px";
    g.fillText(file.toUpperCase(), x + 4, y - size * 0.98);
  }
  const caps = THEME.upper || !THEME.headItalic;
  g.font = `${caps ? size : size * 1.05}px "${caps ? THEME.head : THEME.headItalic}"`;
  g.letterSpacing = "0px";
  g.fillStyle = INK;
  g.fillText(caps ? text.toUpperCase() : text, x, y);
  g.restore();
}

export function sectionHeader(g, text, { x = 96, y = 380, right = W - 96, k = 1, alpha = 1 } = {}) {
  g.save();
  g.globalAlpha = alpha;
  g.font = labelFont(24);
  g.letterSpacing = "1.5px";
  g.fillStyle = "#3A3936";
  g.textBaseline = "middle";
  g.fillText(text.toUpperCase(), x, y);
  const tw = g.measureText(text.toUpperCase()).width;
  g.strokeStyle = "rgba(30,30,28,0.35)";
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x + tw + 22, y);
  g.lineTo(x + tw + 22 + (right - x - tw - 22) * k, y);
  g.stroke();
  g.restore();
}

export function pill(g, text, { x, y, status = null, scale = 1, alpha = 1, size = 30 } = {}) {
  g.save();
  g.globalAlpha = alpha;
  g.translate(x, y);
  g.scale(scale, scale);
  g.font = labelFont(size);
  g.letterSpacing = "1px";
  g.textAlign = "left";
  const label = text.toUpperCase();
  const tw = g.measureText(label).width;
  const dot = status ? size * 0.95 : 0;
  const style = THEME.pill;
  const w = tw + 40 + (dot ? dot + 10 : 0);
  const h = size * 1.75;
  let ink = INK;
  if (style === "solid") {
    g.fillStyle = INK;
    g.beginPath();
    g.roundRect(-w / 2, -h / 2, w, h, h / 2);
    g.fill();
    ink = "#FFFFFF";
  } else if (style === "tag") {
    g.fillStyle = "#FFFFFF";
    g.shadowColor = "rgba(0,0,0,0.12)";
    g.shadowBlur = 12;
    g.fillRect(-w / 2, -h / 2, w, h);
    g.shadowColor = "transparent";
    g.fillStyle = THEME.accent;
    g.fillRect(-w / 2, -h / 2, 7, h);
  } else if (style === "text") {
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-w / 2 + 20, h / 2 - 6);
    g.lineTo(-w / 2 + 20 + tw, h / 2 - 6);
    g.stroke();
  } else {
    g.fillStyle = "#FFFFFF";
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(-w / 2, -h / 2, w, h, h / 2);
    g.fill();
    g.stroke();
  }
  g.fillStyle = ink;
  g.textBaseline = "middle";
  g.fillText(label, -w / 2 + 20, 1);
  if (status) {
    const cx = w / 2 - 18 - dot / 2;
    g.fillStyle = status === "good" ? GOOD : BAD;
    g.beginPath();
    g.arc(cx, 0, dot / 2, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#FFFFFF";
    g.lineWidth = 2.4;
    g.lineCap = "round";
    g.beginPath();
    if (status === "good") {
      g.moveTo(cx - dot * 0.22, 0);
      g.lineTo(cx - dot * 0.05, dot * 0.17);
      g.lineTo(cx + dot * 0.24, -dot * 0.18);
    } else {
      const d = dot * 0.18;
      g.moveTo(cx - d, -d);
      g.lineTo(cx + d, d);
      g.moveTo(cx + d, -d);
      g.lineTo(cx - d, d);
    }
    g.stroke();
  }
  g.restore();
}

export function note(g, text, { x, y, to, k = 1, size = 46, align = "left", alpha = 1 } = {}) {
  g.save();
  g.globalAlpha = alpha * Math.min(1, k * 2);
  g.font = `${size}px "Caveat"`;
  g.fillStyle = INK;
  g.textAlign = align;
  const lines = text.split("\n");
  lines.forEach((l, i) => g.fillText(l, x, y + i * size * 0.9));
  g.restore();
  if (!to || k <= 0) return;
  const sx = x + (align === "right" ? -size : align === "center" ? 0 : size * 0.6);
  const sy = y + (lines.length - 1) * size * 0.9 + size * 0.35;
  const mx = (sx + to.x) / 2 + (to.x > sx ? -1 : 1) * Math.abs(to.y - sy) * 0.35;
  const my = (sy + to.y) / 2;
  const t = Math.min(1, k);
  const pts = [];
  for (let i = 0; i <= 40 * t; i++) {
    const u = i / 40;
    pts.push([(1 - u) ** 2 * sx + 2 * (1 - u) * u * mx + u * u * to.x, (1 - u) ** 2 * sy + 2 * (1 - u) * u * my + u * u * to.y]);
  }
  if (pts.length < 2) return;
  g.save();
  g.globalAlpha = alpha;
  g.strokeStyle = INK;
  g.lineWidth = 2.2;
  g.lineCap = "round";
  g.beginPath();
  pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
  g.stroke();
  if (t >= 1) {
    const [ax, ay] = pts.at(-1);
    const [bx, by] = pts.at(-4);
    const ang = Math.atan2(ay - by, ax - bx);
    g.beginPath();
    g.moveTo(ax - Math.cos(ang - 0.45) * 16, ay - Math.sin(ang - 0.45) * 16);
    g.lineTo(ax, ay);
    g.lineTo(ax - Math.cos(ang + 0.45) * 16, ay - Math.sin(ang + 0.45) * 16);
    g.stroke();
  }
  g.restore();
}

export function hotDot(g, x, y, { r = 13, k = 1, pulse = 0 } = {}) {
  if (k <= 0) return;
  g.save();
  const halo = g.createRadialGradient(x, y, 0, x, y, r * (3 + pulse));
  halo.addColorStop(0, "rgba(255,87,51,0.45)");
  halo.addColorStop(1, "rgba(255,87,51,0)");
  g.fillStyle = halo;
  g.beginPath();
  g.arc(x, y, r * (3 + pulse), 0, Math.PI * 2);
  g.fill();
  g.fillStyle = HOT;
  g.beginPath();
  g.arc(x, y, r * k, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

export function mark(g, x, y, { status = "good", k = 1, r = 17 } = {}) {
  if (k <= 0) return;
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  g.shadowColor = "rgba(0,0,0,0.18)";
  g.shadowBlur = 10;
  g.fillStyle = status === "good" ? GOOD : BAD;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.shadowColor = "transparent";
  g.strokeStyle = "#FFFFFF";
  g.lineWidth = 3.2;
  g.lineCap = "round";
  g.beginPath();
  if (status === "good") {
    g.moveTo(-7, 0.5);
    g.lineTo(-2, 5.5);
    g.lineTo(7.5, -5);
  } else {
    g.moveTo(-6, -6);
    g.lineTo(6, 6);
    g.moveTo(6, -6);
    g.lineTo(-6, 6);
  }
  g.stroke();
  g.restore();
}

export function curveArrow(g, a, b, { k = 1, bend = 1, color = "rgba(30,30,28,0.8)" } = {}) {
  if (k <= 0) return;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const s = { x: a.x + (dx / len) * 22, y: a.y + (dy / len) * 22 };
  const e = { x: b.x - (dx / len) * 24, y: b.y - (dy / len) * 24 };
  const mx = (s.x + e.x) / 2 + (-dy / len) * len * 0.28 * bend;
  const my = (s.y + e.y) / 2 + (dx / len) * len * 0.28 * bend;
  const pts = [];
  for (let i = 0; i <= 40 * Math.min(1, k); i++) {
    const u = i / 40;
    pts.push([(1 - u) ** 2 * s.x + 2 * (1 - u) * u * mx + u * u * e.x, (1 - u) ** 2 * s.y + 2 * (1 - u) * u * my + u * u * e.y]);
  }
  if (pts.length < 2) return;
  g.save();
  g.strokeStyle = color;
  g.lineWidth = 2.4;
  g.lineCap = "round";
  g.setLineDash([9, 7]);
  g.beginPath();
  pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
  g.stroke();
  if (k >= 1) {
    g.setLineDash([]);
    const [ax, ay] = pts.at(-1);
    const [bx, by] = pts.at(-4);
    const ang = Math.atan2(ay - by, ax - bx);
    g.beginPath();
    g.moveTo(ax - Math.cos(ang - 0.45) * 15, ay - Math.sin(ang - 0.45) * 15);
    g.lineTo(ax, ay);
    g.lineTo(ax - Math.cos(ang + 0.45) * 15, ay - Math.sin(ang + 0.45) * 15);
    g.stroke();
  }
  g.restore();
}

export function dashed(g, x0, y0, x1, y1, { k = 1, color = "rgba(30,30,28,0.75)", width = 2.4, dash = [12, 9] } = {}) {
  if (k <= 0) return;
  g.save();
  g.strokeStyle = color;
  g.lineWidth = width;
  g.setLineDash(dash);
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k);
  g.stroke();
  g.restore();
}

export function highlight(g, x, y, w, h, { k = 1 } = {}) {
  if (k <= 0 || w <= 0 || h <= 0) return;
  g.save();
  g.globalAlpha = k;
  g.fillStyle = "rgba(30,30,28,0.14)";
  g.strokeStyle = "rgba(30,30,28,0.28)";
  g.lineWidth = 2;
  const grow = 0.94 + 0.06 * k;
  const cx = x + w / 2;
  const cy = y + h / 2;
  g.translate(cx, cy);
  g.scale(grow, grow);
  g.beginPath();
  g.roundRect(-w / 2, -h / 2, w, h, 6);
  g.fill();
  g.stroke();
  const ex = -w / 2 + 34;
  const ey = -h / 2 + 30;
  g.strokeStyle = "rgba(30,30,28,0.6)";
  g.fillStyle = "rgba(30,30,28,0.6)";
  g.lineWidth = 2.4;
  g.beginPath();
  g.moveTo(ex - 15, ey);
  g.quadraticCurveTo(ex, ey - 12, ex + 15, ey);
  g.quadraticCurveTo(ex, ey + 12, ex - 15, ey);
  g.stroke();
  g.beginPath();
  g.arc(ex, ey, 4.5, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

export function ring(g, x, y, r, { k = 1, color = "rgba(255,255,255,0.9)" } = {}) {
  if (k <= 0) return;
  g.save();
  g.strokeStyle = color;
  g.lineWidth = 2.6;
  g.setLineDash([9, 8]);
  g.beginPath();
  g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(k, 0.9995));
  g.stroke();
  g.restore();
}

export function swatch(g, { x, y, color, label = "", size = 170, alpha = 1, mark = null, img = null, glyph = "", press = 0, markK = 1 } = {}) {
  g.save();
  g.globalAlpha = alpha;
  if (press) {
    const sc = 1 - 0.05 * press;
    g.translate(x + size / 2, y + size * 0.61);
    g.scale(sc, sc);
    g.translate(-(x + size / 2), -(y + size * 0.61));
  }
  g.shadowColor = "rgba(0,0,0,0.14)";
  g.shadowBlur = 22;
  g.shadowOffsetY = 8;
  g.fillStyle = "#FFFFFF";
  g.beginPath();
  g.roundRect(x, y, size, size * 1.22, 10);
  g.fill();
  g.shadowColor = "transparent";
  const p = size * 0.08;
  if (img) {
    const s = Math.min((size - p * 2) / img.width, (size - p * 2) / img.height);
    g.drawImage(img, x + size / 2 - (img.width * s) / 2, y + p + (size - p * 2) / 2 - (img.height * s) / 2, img.width * s, img.height * s);
  } else {
    g.fillStyle = color;
    g.beginPath();
    g.roundRect(x + p, y + p, size - p * 2, size - p * 2, 6);
    g.fill();
    if (glyph) {
      g.fillStyle = isLightHex(color) ? INK : "#FFFFFF";
      g.font = `${Math.round(size * 0.42)}px "${THEME.head}"`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(glyph, x + size / 2, y + size / 2 + size * 0.02);
      g.textAlign = "left";
      g.textBaseline = "alphabetic";
    }
  }
  if (label) {
    g.fillStyle = INK;
    g.font = `${Math.round(size * 0.1)}px "Plex Mono Medium"`;
    g.letterSpacing = "0.5px";
    g.fillText(label.toUpperCase(), x + p, y + size * 1.13);
  }
  if (mark && markK > 0) {
    const cx = x + size / 2;
    const cy = y + size / 2;
    g.save();
    g.translate(cx, cy);
    g.scale(markK, markK);
    g.translate(-cx, -cy);
    if (glyph) {
      g.fillStyle = mark === "good" ? "rgba(46,125,80,0.82)" : "rgba(30,30,28,0.55)";
      g.beginPath();
      g.roundRect(x + p, y + p, size - p * 2, size - p * 2, 6);
      g.fill();
    }
    g.strokeStyle = !img && !glyph && isLightHex(color) ? "rgba(30,30,28,0.75)" : "#FFFFFF";
    g.lineWidth = 4;
    g.lineCap = "round";
    g.beginPath();
    if (mark === "good") {
      g.moveTo(cx - 14, cy);
      g.lineTo(cx - 4, cy + 11);
      g.lineTo(cx + 16, cy - 12);
    } else {
      g.moveTo(cx - 11, cy - 11);
      g.lineTo(cx + 11, cy + 11);
      g.moveTo(cx + 11, cy - 11);
      g.lineTo(cx - 11, cy + 11);
    }
    g.stroke();
    g.restore();
  }
  g.restore();
}

export function cursor(g, x, y, { press = 0, alpha = 1 } = {}) {
  g.save();
  g.globalAlpha = alpha;
  g.translate(x, y);
  g.scale(1.45 - press * 0.15, 1.45 - press * 0.15);
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(0, 22);
  g.lineTo(5.5, 17);
  g.lineTo(9.5, 26);
  g.lineTo(13, 24.5);
  g.lineTo(9, 15.5);
  g.lineTo(16, 15.5);
  g.closePath();
  g.fillStyle = "#111111";
  g.strokeStyle = "#FFFFFF";
  g.lineWidth = 1.6;
  g.fill();
  g.stroke();
  g.restore();
}

export function chapterPill(g, { n, word, thumb, x = W / 2, y = H * 0.48, scale = 1, alpha = 1 } = {}) {
  g.save();
  g.globalAlpha = alpha;
  g.translate(x, y);
  g.scale(scale, scale);
  g.font = `112px "Anton"`;
  const tw = g.measureText(word.toUpperCase()).width;
  const th = 150;
  const w = th + 40 + tw + 46;
  const h = th + 28;
  g.shadowColor = "rgba(0,0,0,0.25)";
  g.shadowBlur = 30;
  g.fillStyle = "#FFFFFF";
  g.beginPath();
  g.roundRect(-w / 2, -h / 2, w, h, 20);
  g.fill();
  g.shadowColor = "transparent";
  const tx = -w / 2 + 14;
  const ty = -h / 2 + 14;
  g.save();
  g.beginPath();
  g.roundRect(tx, ty, th, th, 12);
  g.clip();
  g.fillStyle = "#2B2B2A";
  g.fillRect(tx, ty, th, th);
  if (thumb) {
    const s = Math.max(th / thumb.width, th / thumb.height);
    g.drawImage(thumb, tx + th / 2 - (thumb.width * s) / 2, ty + th / 2 - (thumb.height * s) / 2, thumb.width * s, thumb.height * s);
  }
  g.fillStyle = "rgba(0,0,0,0.25)";
  g.fillRect(tx, ty + th * 0.62, th, th * 0.38);
  g.fillStyle = "#FFFFFF";
  g.font = `34px "Plex Mono Medium"`;
  g.fillText(String(n).padStart(2, "0"), tx + 12, ty + th - 14);
  g.restore();
  g.fillStyle = INK;
  g.font = `112px "Anton"`;
  g.textBaseline = "middle";
  g.fillText(word.toUpperCase(), tx + th + 30, 6);
  g.restore();
}

export function blurredCloseup(g, img, { focusY = 0.75, zoom = 2.6, pan = 0 } = {}) {
  const s = (W / img.width) * zoom;
  const w = img.width * s;
  const h = img.height * s;
  g.save();
  g.filter = "blur(16px) brightness(0.5) contrast(1.15) saturate(0.9)";
  g.fillStyle = "#3F3F3D";
  g.fillRect(0, 0, W, H);
  g.drawImage(img, W / 2 - w / 2 + pan * 30, H / 2 - h * focusY - pan * 40, w, h);
  g.filter = "none";
  const vig = g.createRadialGradient(W / 2, H * 0.48, H * 0.18, W / 2, H * 0.48, H * 0.75);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.45)");
  g.fillStyle = vig;
  g.fillRect(0, 0, W, H);
  g.restore();
}

export function headline(g, text, { kind = "theme", y = H * 0.105, size, alpha = 1, color = INK, italic } = {}) {
  if (kind === "theme") {
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = color;
    const ital = (italic ?? THEME.italic) && THEME.headItalic;
    const fam = ital ? THEME.headItalic : THEME.head;
    const label = THEME.upper ? text.toUpperCase() : text;
    const caps = THEME.upper || !THEME.headItalic;
    let sz = size ?? (caps ? 84 : 88);
    g.font = `${sz}px "${fam}"`;
    g.letterSpacing = caps && /Syne|Space/.test(fam) ? "5px" : "0px";
    while (g.measureText(label).width > W - 130 && sz > 40) g.font = `${(sz -= 4)}px "${fam}"`;
    g.textAlign = "center";
    g.fillText(label, W / 2, y);
    g.restore();
    return;
  }
  if (kind === "condensed") {
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = color;
    let sz = size ?? 104;
    g.font = `${sz}px "Anton"`;
    while (g.measureText(text.toUpperCase()).width > W - 140 && sz > 50) g.font = `${(sz -= 4)}px "Anton"`;
    g.textAlign = "center";
    g.fillText(text.toUpperCase(), W / 2, y);
    g.restore();
  } else if (kind === "wide") {
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = color;
    let sz = size ?? 58;
    g.font = `${sz}px "Syne ExtraBold"`;
    g.letterSpacing = "6px";
    while (g.measureText(text.toUpperCase()).width > W - 140 && sz > 30) g.font = `${(sz -= 3)}px "Syne ExtraBold"`;
    g.textAlign = "center";
    g.fillText(text.toUpperCase(), W / 2, y);
    g.restore();
  } else title(g, text, { y, size: size ?? 86, italic: italic ?? true, color, alpha });
}

export function checkTitle(g, n, word, { k = 1, y = H * 0.47 } = {}) {
  g.save();
  g.globalAlpha = clamp(k * 1.6);
  g.fillStyle = "rgba(255,255,255,0.8)";
  g.font = `22px "Plex Mono Medium"`;
  g.letterSpacing = "4px";
  g.textAlign = "center";
  g.fillText(`CHECK: ${String(n).padStart(2, "0")}`, W / 2, y - 92);
  g.fillStyle = "#FFFFFF";
  let sz = 84;
  g.font = `${sz}px "Syne ExtraBold"`;
  g.letterSpacing = "5px";
  const lines = wrapWords(g, word.toUpperCase(), W - 160);
  while (lines.length > 2 && sz > 50) {
    g.font = `${(sz -= 6)}px "Syne ExtraBold"`;
    lines.splice(0, lines.length, ...wrapWords(g, word.toUpperCase(), W - 160));
  }
  lines.forEach((l, i) => g.fillText(l, W / 2 + (1 - k) * 0, y + i * sz * 1.02 + (1 - k) * 20));
  g.restore();
}

export function photoStack(g, photos, n, word, { k = 1, cx = W / 2, cy = H * 0.47 } = {}) {
  const cw = 560;
  const ch = 700;
  const back = [...photos.slice(1, 3)].reverse();
  const angles = [-0.09, 0.07];
  back.forEach((img, i) => {
    const a = angles[i] * k;
    drawCard(g, img, { cx: cx + (i ? 46 : -46) * k, cy: cy + 14, w: cw, h: ch, angle: a, alpha: clamp(k * 1.4), dim: 0.35 });
  });
  drawCard(g, photos[0], { cx, cy: cy + (1 - k) * 40, w: cw, h: ch, angle: 0.02 * (1 - k), alpha: clamp(k * 1.6) });
  g.save();
  g.globalAlpha = clamp((k - 0.3) * 2);
  g.fillStyle = "#FFFFFF";
  g.font = `150px "Instrument Serif"`;
  g.textAlign = "right";
  g.shadowColor = "rgba(0,0,0,0.35)";
  g.shadowBlur = 20;
  g.fillText(String(n).padStart(2, "0"), cx + cw / 2 - 30, cy - ch / 2 + 150);
  g.textAlign = "left";
  g.font = `56px "Syne ExtraBold"`;
  g.letterSpacing = "3px";
  g.fillText(word.toUpperCase(), cx - cw / 2 + 36, cy + ch / 2 - 46);
  g.restore();
}

function drawCard(g, img, { cx, cy, w, h, angle = 0, alpha = 1, dim = 0 }) {
  g.save();
  g.globalAlpha = alpha;
  g.translate(cx, cy);
  g.rotate(angle);
  g.shadowColor = "rgba(0,0,0,0.28)";
  g.shadowBlur = 34;
  g.shadowOffsetY = 12;
  g.fillStyle = "#2B2A28";
  g.beginPath();
  g.roundRect(-w / 2, -h / 2, w, h, 26);
  g.fill();
  g.shadowColor = "transparent";
  g.beginPath();
  g.roundRect(-w / 2, -h / 2, w, h, 26);
  g.clip();
  if (img) {
    const sc = Math.max(w / img.width, h / img.height);
    g.drawImage(img, -(img.width * sc) / 2, -h / 2 - Math.max(0, img.height * sc - h) * 0.12, img.width * sc, img.height * sc);
  }
  const shade = g.createLinearGradient(0, 0, 0, h / 2);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.55)");
  g.fillStyle = shade;
  g.fillRect(-w / 2, 0, w, h / 2);
  if (dim) {
    g.fillStyle = `rgba(0,0,0,${dim})`;
    g.fillRect(-w / 2, -h / 2, w, h);
  }
  g.restore();
}

export function scaleBar(g, { left = "Warm", right = "Cool", from = "#F08A5D", to = "#8FB4F0", value = 0.5, k = 1, y = H * 0.17, x0 = 120, x1 = W - 120 } = {}) {
  g.save();
  g.globalAlpha = clamp(k * 2);
  g.font = `20px "Plex Mono Medium"`;
  g.letterSpacing = "2px";
  g.fillStyle = INK;
  g.textAlign = "left";
  g.fillText(left.toUpperCase(), x0, y - 26);
  g.textAlign = "right";
  g.fillText(right.toUpperCase(), x1, y - 26);
  const w = (x1 - x0) * easeOut(k);
  const grad = g.createLinearGradient(x0, 0, x1, 0);
  grad.addColorStop(0, from);
  grad.addColorStop(1, to);
  g.fillStyle = grad;
  g.beginPath();
  g.roundRect(x0, y - 9, Math.max(w, 1), 18, 9);
  g.fill();
  const mx = x0 + (x1 - x0) * value;
  g.fillStyle = INK;
  g.beginPath();
  g.moveTo(mx, y + 2);
  g.lineTo(mx - 14, y + 26);
  g.lineTo(mx + 14, y + 26);
  g.closePath();
  if (k > 0.6) g.fill();
  g.restore();
}

export function productCard(g, img, label, { x, y, to, k = 1, w = 300, h = 230 } = {}) {
  if (k <= 0) return;
  g.save();
  if (to) {
    g.strokeStyle = "rgba(30,30,28,0.7)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x - w / 2, y + h / 2 - 20);
    g.lineTo(x - w / 2 + (to.x - (x - w / 2)) * k, y + h / 2 - 20 + (to.y - (y + h / 2 - 20)) * k);
    g.stroke();
    if (k >= 1) {
      g.fillStyle = INK;
      g.beginPath();
      g.arc(to.x, to.y, 6, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.translate(x, y);
  g.scale(0.85 + 0.15 * easeOut(k), 0.85 + 0.15 * easeOut(k));
  g.globalAlpha = clamp(k * 1.5);
  g.shadowColor = "rgba(0,0,0,0.16)";
  g.shadowBlur = 24;
  g.shadowOffsetY = 8;
  g.fillStyle = "#FFFFFF";
  g.beginPath();
  g.roundRect(-w / 2, -h / 2, w, h + 46, 16);
  g.fill();
  g.shadowColor = "transparent";
  if (img) {
    const sc = Math.min((w - 40) / img.width, (h - 30) / img.height);
    g.drawImage(img, -(img.width * sc) / 2, -h / 2 + 15 + (h - 30 - img.height * sc) / 2, img.width * sc, img.height * sc);
  }
  g.fillStyle = INK;
  g.font = `24px "Space Grotesk Bold"`;
  g.textAlign = "left";
  g.fillText(label, -w / 2 + 20, h / 2 + 26);
  g.restore();
}

export function darkCard(g, n, word, { x, y, w = 760, h = 132, k = 1, img = null, done = true } = {}) {
  if (k <= 0) return;
  g.save();
  g.globalAlpha = clamp(k * 1.6);
  g.translate(x + (1 - easeOut(k)) * 60, y);
  g.rotate(-0.012);
  g.shadowColor = "rgba(0,0,0,0.3)";
  g.shadowBlur = 24;
  g.shadowOffsetY = 10;
  g.fillStyle = "#1F1F1E";
  g.beginPath();
  g.roundRect(-w / 2, -h / 2, w, h, 14);
  g.fill();
  g.shadowColor = "transparent";
  if (img) {
    g.save();
    g.beginPath();
    g.roundRect(-w / 2, -h / 2, w, h, 14);
    g.clip();
    g.globalAlpha *= 0.38;
    const sc = Math.max(w / img.width, h / img.height) * 1.6;
    g.drawImage(img, -(img.width * sc) / 2, -(img.height * sc) * 0.35, img.width * sc, img.height * sc);
    g.restore();
  }
  g.fillStyle = "rgba(255,255,255,0.75)";
  g.font = `20px "Plex Mono Medium"`;
  g.textAlign = "left";
  g.fillText(String(n).padStart(2, "0"), -w / 2 + 30, -h / 2 + 38);
  g.fillStyle = "#FFFFFF";
  g.font = `40px "Space Grotesk Bold"`;
  g.letterSpacing = "2px";
  g.fillText(word.toUpperCase(), -w / 2 + 30, h / 2 - 30);
  if (done) {
    g.fillStyle = GOOD;
    g.beginPath();
    g.arc(w / 2 - 44, h / 2 - 44, 16, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#FFFFFF";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(w / 2 - 51, h / 2 - 44);
    g.lineTo(w / 2 - 46, h / 2 - 39);
    g.lineTo(w / 2 - 37, h / 2 - 49);
    g.stroke();
  }
  g.restore();
}

function wrapWords(g, text, max) {
  const out = [];
  let line = "";
  for (const w of text.split(/\s+/)) {
    const next = line ? `${line} ${w}` : w;
    if (line && g.measureText(next).width > max) {
      out.push(line);
      line = w;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}
const clamp = (x) => Math.max(0, Math.min(1, x));
const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);

export function bigNumber(g, n, word, { k = 1, x = 70, y = H * 0.5 } = {}) {
  g.save();
  g.globalAlpha = clamp(k * 1.5);
  g.fillStyle = THEME.accent;
  const fam = THEME.headItalic && THEME.italic ? THEME.headItalic : THEME.head;
  g.font = `420px "${fam}"`;
  g.textAlign = "left";
  g.fillText(String(n).padStart(2, "0"), x - 10 + (1 - easeOut(k)) * -40, y);
  g.fillStyle = INK;
  g.font = labelFont(26);
  g.letterSpacing = "4px";
  g.fillText(word.toUpperCase(), x + 8, y + 70);
  g.restore();
}

export function listRow(g, n, word, { y, k = 1, x0 = 110, x1 = W - 110 } = {}) {
  g.save();
  g.globalAlpha = clamp(k * 1.6);
  g.fillStyle = THEME.accent;
  g.font = labelFont(26);
  g.textAlign = "left";
  g.fillText(String(n).padStart(2, "0"), x0, y);
  g.fillStyle = INK;
  const caps = THEME.upper || !THEME.headItalic;
  g.font = `${caps ? 64 : 70}px "${THEME.italic && THEME.headItalic ? THEME.headItalic : THEME.head}"`;
  g.fillText(caps ? word.toUpperCase() : word, x0 + 90, y + 10);
  g.strokeStyle = "rgba(30,30,28,0.25)";
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x0, y + 46);
  g.lineTo(x0 + (x1 - x0) * easeOut(k), y + 46);
  g.stroke();
  g.restore();
}
