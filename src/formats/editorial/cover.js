import { createCanvas } from "@napi-rs/canvas";
import { getTheme } from "./design.js";

export async function renderCover(cover, { modelImg, palette = [] } = {}) {
  const W = 1080;
  const H = 1920;
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");
  const theme = getTheme(cover.theme || "p1", palette);

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.7, H * 0.5, 0, W * 0.7, H * 0.5, W);
  glow.addColorStop(0, withAlpha(theme.glow, 0.95));
  glow.addColorStop(1, withAlpha(theme.glow, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const top = 240;
  const bottom = 1680;
  const left = 64;

  const ops = [];
  const text = (...args) => ops.push(() => drawText(...args));
  const drawText = (str, font, color, x, y, { spacing = 0, shadow = true } = {}) => {
    ctx.save();
    ctx.font = font;
    ctx.letterSpacing = `${spacing}px`;
    ctx.fillStyle = color;
    if (shadow) {
      ctx.shadowColor = "rgba(0,0,0,0.25)";
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 4;
    }
    ctx.fillText(str, x, y);
    ctx.restore();
  };
  const fitSize = (str, family, max, maxWidth) => {
    let size = max;
    ctx.font = `${size}px "${family}", "Symbols"`;
    while (ctx.measureText(str).width > maxWidth && size > 40) {
      size -= 4;
      ctx.font = `${size}px "${family}", "Symbols"`;
    }
    return size;
  };

  let y = top + 70;

  if (cover.badge) {
    ctx.font = `30px "Oswald SemiBold", "Symbols"`;
    ctx.letterSpacing = "4px";
    const label = cover.badge.toUpperCase();
    const bw = ctx.measureText(label).width + 48;
    const by = y;
    ops.push(() => {
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(left, by - 44, bw, 62, 31);
      ctx.stroke();
    });
    text(label, ctx.font, theme.ink, left + 24, y, { spacing: 4, shadow: false });
    y += 60;
  }

  if (cover.kicker) {
    const size = fitSize(cover.kicker.toUpperCase(), "Anton", 190, W * 0.8);
    y += size * 0.95;
    text(cover.kicker.toUpperCase(), `${size}px "Anton", "Symbols"`, theme.ink, left, y);
  }

  const headline = (cover.headline ?? "").toUpperCase();
  const hSize = fitSize(headline, "Anton", 300, W - left * 2);
  y += hSize * 0.92;
  text(headline, `${hSize}px "Anton", "Symbols"`, theme.accent, left - 4, y);
  const modelTop = y + 40;

  if (cover.connector) {
    text(cover.connector, `150px "Allura", "Symbols"`, theme.script, left + 20, y + 110);
    y += 70;
  }

  if (cover.subline) {
    const words = cover.subline.toUpperCase().split(/\s+/);
    const lines = [];
    ctx.font = `118px "Anton", "Symbols"`;
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > W * 0.52 && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    y += 40;
    for (const l of lines.slice(0, 3)) {
      const size = fitSize(l, "Anton", 118, W * 0.55);
      y += size * 1.0;
      text(l, `${size}px "Anton", "Symbols"`, theme.ink, left, y);
    }
  }

  if (cover.tagline) {
    y += 70;
    const ly = y;
    ops.push(() => {
      ctx.fillStyle = theme.muted;
      ctx.fillRect(left, ly - 12, 60, 3);
    });
    text(cover.tagline.toUpperCase(), `32px "Inter Bold", "Symbols"`, theme.muted, left + 80, y, { spacing: 3, shadow: false });
  }

  if (modelImg) {
    const h = Math.min(1100, bottom - 40 - modelTop);
    const w = (modelImg.width / modelImg.height) * h;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowBlur = 50;
    ctx.shadowOffsetY = 20;
    ctx.drawImage(modelImg, W - w - 30, bottom - 40 - h, w, h);
    ctx.restore();
  }
  for (const op of ops) op();

  const swatches = (cover.swatches ?? []).slice(0, 4);
  if (swatches.length) {
    const size = 128;
    const gap = 26;
    const sy = bottom - size - 70;
    swatches.forEach((s, i) => {
      const x = left + i * (size + gap);
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.3)";
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 8;
      ctx.fillStyle = s.hex;
      ctx.beginPath();
      ctx.roundRect(x, sy, size, size, 18);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.font = `24px "Oswald SemiBold", "Symbols"`;
      ctx.letterSpacing = "2px";
      ctx.textAlign = "center";
      ctx.fillStyle = theme.ink;
      ctx.fillText(s.name.toUpperCase(), x + size / 2, sy + size + 40);
      ctx.restore();
    });
  }

  return c.encode("png");
}

function withAlpha(hex, a) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${a})`;
}
