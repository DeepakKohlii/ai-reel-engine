import { createCanvas } from "@napi-rs/canvas";
import { isLight, mix } from "../formats/editorial/design.js";

export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const easeOutCubic = (x) => 1 - Math.pow(1 - clamp01(x), 3);
export const easeInCubic = (x) => clamp01(x) ** 3;
export const easeInOutCubic = (x) => ((x = clamp01(x)) < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const easeOutBack = (x, c1 = 1.5) => {
  const t = clamp01(x) - 1;
  return 1 + (c1 + 1) * t * t * t + c1 * t * t;
};

export function seeded(seed) {
  let s = Math.max(1, Math.floor(seed)) % 2147483647;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export { isLight, mix };

export function drawCard(ctx, u, theme, { img, w, h, label, sticker = null }) {
  const light = isLight(theme.bg);
  const border = 14 * u;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 40 * u;
  ctx.shadowOffsetY = 18 * u;
  ctx.fillStyle = light ? "#FFFFFF" : "#F7F3EC";
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.shadowColor = "transparent";
  ctx.fillStyle = light ? mix(theme.bg, "#FFFFFF", 0.55) : "#ECE6DC";
  const labelH = label ? 64 * u : 0;
  ctx.fillRect(-w / 2 + border, -h / 2 + border, w - border * 2, h - border * 2 - labelH);
  const bw = w - border * 4;
  const bh = h - border * 4 - labelH;
  const src = sticker ?? img;
  const r = Math.min(bw / src.width, bh / src.height);
  ctx.drawImage(src, -(src.width * r) / 2, -h / 2 + border * 2 + (bh - src.height * r) / 2, src.width * r, src.height * r);
  if (label) {
    ctx.fillStyle = "#1B1714";
    ctx.font = `${50 * u}px "Caveat", "Symbols"`;
    ctx.textAlign = "center";
    ctx.fillText(String(label).toLowerCase(), 0, h / 2 - border - 16 * u);
  }
  ctx.restore();
}

export function penStroke(ctx, pts, k, { color, width }) {
  if (k <= 0 || pts.length < 2) return;
  const n = Math.max(2, Math.round(pts.length * clamp01(k)));
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  pts.slice(0, n).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  ctx.restore();
}

export function loopPoints(cx, cy, rx, ry, seed = 1, n = 64) {
  const rnd = seeded(seed * 97 + 13);
  const start = -Math.PI * 0.6;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = start + (i / n) * Math.PI * 2.15;
    const wob = 1 + (rnd() - 0.5) * 0.03 + (i / n) * 0.06;
    pts.push([cx + Math.cos(a) * rx * wob, cy + Math.sin(a) * ry * wob]);
  }
  return pts;
}

const alphaCache = new WeakMap();
export function opaqueAt(img, fx, fy) {
  let data = alphaCache.get(img);
  if (!data) {
    const s = 96;
    const c = createCanvas(s, s);
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, s, s);
    data = { s, px: g.getImageData(0, 0, s, s).data };
    alphaCache.set(img, data);
  }
  const x = Math.min(data.s - 1, Math.max(0, Math.round(fx * (data.s - 1))));
  const y = Math.min(data.s - 1, Math.max(0, Math.round(fy * (data.s - 1))));
  return data.px[(y * data.s + x) * 4 + 3] > 128;
}
