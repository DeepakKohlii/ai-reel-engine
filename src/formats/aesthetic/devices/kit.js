export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);
export const easeIn = (x) => clamp01(x) ** 3;
export const easeInOut = (x) => ((x = clamp01(x)) < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const easeBack = (x, c = 1.5) => {
  const t = clamp01(x) - 1;
  return 1 + (c + 1) * t * t * t + c * t * t;
};
export const lerp = (a, b, k) => a + (b - a) * k;
export function seeded(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
export function line(ctx, a, b, k = 1, { color = "rgba(30,30,28,0.8)", width = 2.4, dash = null } = {}) {
  if (k <= 0) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(lerp(a.x, b.x, clamp01(k)), lerp(a.y, b.y, clamp01(k)));
  ctx.stroke();
  ctx.restore();
}
export function label(ctx, text, x, y, theme, { size = 22, color = theme.ink, align = "center", alpha = 1 } = {}) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.font = `${size}px "${theme.label}"`;
  ctx.letterSpacing = "2px";
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(String(text).toUpperCase(), x, y);
  ctx.restore();
}
