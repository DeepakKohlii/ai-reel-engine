import path from "node:path";
import { GlobalFonts } from "@napi-rs/canvas";
import { config } from "../../config.js";

const fontDir = path.join(config.root, "node_modules", "@fontsource");
const FONTS = [
  ["anton/files/anton-latin-400-normal.woff2", "Anton"],
  ["oswald/files/oswald-latin-400-normal.woff2", "Oswald"],
  ["oswald/files/oswald-latin-600-normal.woff2", "Oswald SemiBold"],
  ["dm-serif-display/files/dm-serif-display-latin-400-normal.woff2", "DM Serif"],
  ["dm-serif-display/files/dm-serif-display-latin-400-italic.woff2", "DM Serif Italic"],
  ["playfair-display/files/playfair-display-latin-700-italic.woff2", "Playfair Italic"],
  ["allura/files/allura-latin-400-normal.woff2", "Allura"],
  ["inter/files/inter-latin-500-normal.woff2", "Inter"],
  ["inter/files/inter-latin-700-normal.woff2", "Inter Bold"],
  ["bangers/files/bangers-latin-400-normal.woff2", "Bangers"],
  ["caveat/files/caveat-latin-700-normal.woff2", "Caveat"],
  ["bebas-neue/files/bebas-neue-latin-400-normal.woff2", "Bebas Neue"],
  ["instrument-serif/files/instrument-serif-latin-400-normal.woff2", "Instrument Serif"],
  ["instrument-serif/files/instrument-serif-latin-400-italic.woff2", "Instrument Serif Italic"],
  ["archivo-black/files/archivo-black-latin-400-normal.woff2", "Archivo Black"],
  ["syne/files/syne-latin-800-normal.woff2", "Syne ExtraBold"],
  ["cormorant-garamond/files/cormorant-garamond-latin-700-normal.woff2", "Cormorant Bold"],
  ["cormorant-garamond/files/cormorant-garamond-latin-500-italic.woff2", "Cormorant Italic"],
  ["space-grotesk/files/space-grotesk-latin-400-normal.woff2", "Space Grotesk"],
  ["space-grotesk/files/space-grotesk-latin-700-normal.woff2", "Space Grotesk Bold"],
  ["permanent-marker/files/permanent-marker-latin-400-normal.woff2", "Permanent Marker"],
  ["fraunces/files/fraunces-latin-900-normal.woff2", "Fraunces Black"],
  ["fraunces/files/fraunces-latin-700-italic.woff2", "Fraunces Italic"],
];
for (const [file, family] of FONTS) GlobalFonts.registerFromPath(path.join(fontDir, file), family);
GlobalFonts.registerFromPath("/System/Library/Fonts/SFNS.ttf", "Symbols");

export const FONT_FAMILIES = [...new Set(FONTS.map(([, family]) => family))];

export const THEMES = {
  cream: { bg: "#EEE6D8", glow: "#FFF9EE", ink: "#2A2522", muted: "#6F635A", accent: "#8C1D2C", script: "#7A1F5C", grain: 0.05 },
  espresso: { bg: "#2A1715", glow: "#4B2A24", ink: "#F3EBDD", muted: "#BCA999", accent: "#D9A44B", script: "#E6C27E", grain: 0.07 },
  white: { bg: "#F6F5F2", glow: "#FFFFFF", ink: "#141414", muted: "#6A6A6A", accent: "#1E3A8A", script: "#1E3A8A", grain: 0.04 },
  butter: { bg: "#F5E6A8", glow: "#FFF6CF", ink: "#1D1A12", muted: "#6B6243", accent: "#1D1A12", script: "#8C1D2C", grain: 0.05 },
  blush: { bg: "#7A4D49", glow: "#9C6B64", ink: "#FFF3EE", muted: "#EBCFC7", accent: "#FFFFFF", script: "#F6DCA9", grain: 0.07 },
  navy: { bg: "#111A2E", glow: "#24335A", ink: "#EEF1F7", muted: "#9AA6BF", accent: "#D9A44B", script: "#C9D6FF", grain: 0.07 },
  olive: { bg: "#3A3E29", glow: "#575D3E", ink: "#F1EEDF", muted: "#C4C1A6", accent: "#E8C86C", script: "#F1EEDF", grain: 0.07 },
};
export const THEME_NAMES = Object.keys(THEMES);

export function getTheme(value, palette = []) {
  if (THEMES[value]) return THEMES[value];
  const slot = /^p([1-4])$/i.exec(value ?? "");
  if (slot && palette[Number(slot[1]) - 1]) {
    const { bg, accent, texture } = palette[Number(slot[1]) - 1];
    return { ...themeFrom(bg, accent), texture: TEXTURES.includes(texture) ? texture : "none" };
  }
  if (/^#[0-9a-f]{6}$/i.test(value ?? "")) return themeFrom(value);
  return THEMES.cream;
}

export const TEXTURES = ["none", "paper", "grid", "dots"];

function themeFrom(bg, accentIn) {
  if (!/^#[0-9a-f]{6}$/i.test(bg ?? "")) return THEMES.cream;
  const light = isLight(bg);
  const fallback = light ? "#8C1D2C" : "#E9C46A";
  const accent = /^#[0-9a-f]{6}$/i.test(accentIn ?? "") && contrast(accentIn, bg) >= 2.2 ? accentIn : fallback;
  return {
    bg,
    glow: mixHex(bg, "#FFFFFF", light ? 0.35 : 0.14),
    ink: light ? "#1B1714" : "#F6F1E9",
    muted: light ? mixHex(bg, "#000000", 0.55) : mixHex(bg, "#FFFFFF", 0.6),
    accent,
    script: accent,
    grain: light ? 0.05 : 0.07,
  };
}

function luminance(hex) {
  return hexToRgb(hex)
    .map((v) => v / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

export function parseLockup(text) {
  return String(text ?? "")
    .split(/\s+\/\s+|\s*\n\s*/)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .flatMap((raw) =>
      /^[[%]/.test(raw)
        ? [raw]
        : raw
            .split(/([~*#!][^~*#!]+?[~*#!])/)
            .map((x) => x.trim())
            .filter((x) => x && !/^[~*#!^]+$/.test(x))
            .map((x) => (/^([~*#!]).+\1$/.test(x) ? x : x.replace(/[~*#]/g, "")))
            .map((x, i, all) => (i > 0 && raw.startsWith("^") && !x.startsWith("^") && !/^[~*#!]/.test(x) ? `^${x}` : x))
            .flatMap((x) => (/^[~*#!]/.test(x) || !/\s\^/.test(x) ? [x] : x.split(/\s+(?=\^)/)))
            .map((x) => (x.startsWith("^") ? `^${x.slice(1).replace(/\^/g, "")}` : x.replace(/\^/g, ""))),
    )
    .map((raw) => {
      const m = raw.match(/^([~*#!])(.+)\1$/);
      if (m) return { text: m[2].trim(), hero: { "~": "script", "*": "serif", "#": "condensed", "!": "sticker" }[m[1]] };
      const label = raw.match(/^\[(.+)\]$/);
      if (label) return { text: label[1].trim(), label: true };
      const note = raw.match(/^%(.+)%$/);
      if (note) return { text: note[1].trim(), note: true };
      if (raw.startsWith("^")) return { text: raw.slice(1).trim(), accent: true };
      return { text: raw };
    });
}

export const TYPESETS = {
  editorial: {
    label: "Editorial (serif + script)",
    script: ["Allura", 360, { flow: true }],
    serif: ["DM Serif", 210],
    condensed: ["Anton", 220, { upper: true }],
    smallUpper: ["Oswald SemiBold", 78, { spacing: 0.04 }],
    smallLower: ["Oswald", 74],
    soloUpper: ["Anton", 150],
    soloLower: ["Playfair Italic", 140],
  },
  magazine: {
    label: "Magazine (italic serif + heavy grotesk)",
    script: ["Instrument Serif Italic", 250],
    serif: ["Fraunces Black", 190],
    condensed: ["Archivo Black", 170, { upper: true }],
    smallUpper: ["Space Grotesk Bold", 62, { spacing: 0.08 }],
    smallLower: ["Instrument Serif Italic", 86],
    soloUpper: ["Archivo Black", 130],
    soloLower: ["Instrument Serif Italic", 170],
  },
  poster: {
    label: "Poster (two-ink condensed caps)",
    twoInk: true,
    script: ["Anton", 250, { upper: true }],
    serif: ["Anton", 250, { upper: true }],
    condensed: ["Anton", 270, { upper: true }],
    smallUpper: ["Oswald SemiBold", 92, { upper: true }],
    smallLower: ["Oswald SemiBold", 92, { upper: true }],
    soloUpper: ["Anton", 190, { upper: true }],
    soloLower: ["Anton", 190, { upper: true }],
  },
  street: {
    label: "Street (marker + tall caps)",
    script: ["Permanent Marker", 200],
    serif: ["Archivo Black", 170],
    condensed: ["Bebas Neue", 280, { upper: true }],
    smallUpper: ["Bebas Neue", 104, { spacing: 0.03 }],
    smallLower: ["Space Grotesk", 70],
    soloUpper: ["Bebas Neue", 220],
    soloLower: ["Permanent Marker", 150],
  },
  luxe: {
    label: "Luxe (Garamond + spaced caps)",
    script: ["Cormorant Italic", 280],
    serif: ["Cormorant Bold", 250],
    condensed: ["Bebas Neue", 250, { upper: true, spacing: 0.06 }],
    smallUpper: ["Space Grotesk", 56, { spacing: 0.22 }],
    smallLower: ["Cormorant Italic", 90],
    soloUpper: ["Cormorant Bold", 160],
    soloLower: ["Cormorant Italic", 170],
  },
  modern: {
    label: "Modern (Syne + Fraunces)",
    script: ["Fraunces Italic", 220],
    serif: ["Fraunces Black", 190],
    condensed: ["Syne ExtraBold", 180, { upper: true }],
    smallUpper: ["Space Grotesk Bold", 64, { spacing: 0.06 }],
    smallLower: ["Space Grotesk", 66],
    soloUpper: ["Syne ExtraBold", 140],
    soloLower: ["Fraunces Italic", 160],
  },
};
export const TYPESET_NAMES = Object.keys(TYPESETS);

const role = (set, name, u, text) => {
  const [family, size, extra = {}] = set[name];
  return { family, size: size * u, spacing: extra.spacing ?? 0, script: !!extra.flow, text: extra.upper ? text.toUpperCase() : undefined, twoInk: !!set.twoInk };
};

function styleFor(piece, u, hasHero, typeset = "editorial") {
  const set = TYPESETS[typeset] ?? TYPESETS.editorial;
  const upper = piece.text === piece.text.toUpperCase() && /[A-Z]/.test(piece.text);
  if (piece.hero === "script") return role(set, "script", u, piece.text);
  if (piece.hero === "serif") return role(set, "serif", u, piece.text);
  if (piece.hero === "condensed") return role(set, "condensed", u, piece.text);
  if (piece.hero === "sticker") return { family: "Bangers", size: 240 * u, text: piece.text.toUpperCase(), spacing: 0.02 };
  if (piece.label) return { family: "Anton", size: 70 * u, text: piece.text.toUpperCase(), spacing: 0.03 };
  if (piece.note) return { family: "Caveat", size: 96 * u };
  if (!hasHero) return role(set, upper ? "soloUpper" : "soloLower", u, piece.text);
  return role(set, upper ? "smallUpper" : "smallLower", u, piece.text);
}

function measure(ctx, text, st) {
  ctx.font = `${st.size}px "${st.family}", "Symbols"`;
  ctx.letterSpacing = st.spacing ? `${st.spacing * st.size}px` : "0px";
  const m = ctx.measureText(text);
  const inkLeft = Math.max(0, m.actualBoundingBoxLeft);
  const inkWidth = Math.max(m.width, inkLeft + m.actualBoundingBoxRight);
  return {
    width: inkWidth,
    ascent: m.actualBoundingBoxAscent,
    descent: m.actualBoundingBoxDescent,
    left: inkLeft,
  };
}

export function layoutLockup(ctx, pieces, { u, maxWidth, align = "left", typeset = "editorial" }) {
  const heroIdx = pieces.findIndex((p) => p.hero);
  const laid = pieces.map((p) => ({ ...p, st: styleFor(p, u, heroIdx >= 0, typeset) }));
  const measureAll = (p) => {
    p.m = measure(ctx, p.draw, p.st);
    if (p.label) {
      p.m = { ...p.m, width: p.m.width + p.st.size * 0.7, ascent: p.m.ascent + p.st.size * 0.22, descent: p.m.descent + p.st.size * 0.22 };
    }
  };
  for (const p of laid) {
    p.draw = p.st.text ?? p.text;
    measureAll(p);
  }

  for (const p of laid) {
    if (p.m.width > maxWidth) {
      p.st = { ...p.st, size: (p.st.size * maxWidth) / p.m.width };
      measureAll(p);
    }
  }

  if (heroIdx < 0) {
    let y = 0;
    for (const p of laid) {
      p.x = -p.m.width / 2;
      p.y = y + p.m.ascent;
      y += p.m.ascent + p.m.descent + p.st.size * 0.18;
    }
    return center(laid);
  }

  const hero = laid[heroIdx];
  hero.x = -hero.m.width / 2;
  hero.y = 0;
  const heroTop = -hero.m.ascent;
  const heroLeft = hero.x;
  const heroRight = hero.x + hero.m.width;
  const script = hero.st.script;

  const before = laid.slice(0, heroIdx);
  const after = laid.slice(heroIdx + 1);

  let yBottom = heroTop - hero.st.size * (script ? 0.0 : 0.06);
  for (const p of [...before].reverse()) {
    p.y = yBottom - p.m.descent;
    p.x =
      align === "right" ? heroRight - p.m.width - hero.m.width * 0.02
      : align === "center" ? -p.m.width / 2
      : heroLeft + hero.m.width * 0.02;
    yBottom = p.y - p.m.ascent - p.st.size * 0.14;
  }

  let yTop = script ? Math.max(hero.m.descent * 0.92, hero.st.size * 0.07) : hero.m.descent + hero.st.size * 0.06;
  for (const p of after) {
    p.y = yTop + p.m.ascent;
    p.x =
      align === "right" ? heroLeft + hero.m.width * 0.02
      : align === "center" ? -p.m.width / 2
      : heroRight - p.m.width - hero.m.width * 0.02;
    yTop = p.y + p.m.descent + p.st.size * 0.14;
  }
  return center(laid);
}

function center(laid) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of laid) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x + p.m.width);
    y0 = Math.min(y0, p.y - p.m.ascent);
    y1 = Math.max(y1, p.y + p.m.descent);
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  for (const p of laid) {
    p.x -= cx;
    p.y -= cy;
  }
  return { pieces: laid, width: x1 - x0, height: y1 - y0 };
}

export function pieceColor(p, theme) {
  if (p.hero === "sticker") return "#FFD23F";
  if (p.label) return "#FFFFFF";
  if (p.note) return theme.accent;
  if (p.hero === "script") return theme.script;
  if (p.hero) return theme.accent;
  if (p.accent) return theme.accent;
  if (p.st.twoInk) return theme.ink;
  if (p.st.size > 120) return theme.ink;
  return p.text === p.text.toUpperCase() ? theme.ink : theme.muted;
}

export function drawPiece(ctx, p, color) {
  ctx.font = `${p.st.size}px "${p.st.family}", "Symbols"`;
  ctx.letterSpacing = p.st.spacing ? `${p.st.spacing * p.st.size}px` : "0px";
  if (p.label) {
    const pad = p.st.size * 0.35;
    ctx.fillStyle = "#E23A3A";
    ctx.beginPath();
    ctx.roundRect(p.x, p.y - p.m.ascent, p.m.width, p.m.ascent + p.m.descent, p.st.size * 0.18);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(p.draw, p.x + pad + p.m.left, p.y);
    return;
  }
  if (p.hero === "sticker") {
    const cx = p.x + p.m.width / 2;
    ctx.save();
    ctx.translate(cx, p.y);
    ctx.rotate((-5 * Math.PI) / 180);
    ctx.translate(-cx, -p.y);
    const off = p.st.size * 0.045;
    ctx.fillStyle = "#111111";
    ctx.fillText(p.draw, p.x + p.m.left + off, p.y + off);
    ctx.lineJoin = "round";
    ctx.lineWidth = p.st.size * 0.03;
    ctx.strokeStyle = "#111111";
    ctx.strokeText(p.draw, p.x + p.m.left, p.y);
    ctx.fillStyle = color;
    ctx.fillText(p.draw, p.x + p.m.left, p.y);
    ctx.restore();
    return;
  }
  ctx.fillStyle = color;
  ctx.fillText(p.draw, p.x + p.m.left, p.y);
}

export function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
export function mix(hex, target, t) {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
}
export function mixHex(hex, target, t) {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}
export function isLight(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
}
