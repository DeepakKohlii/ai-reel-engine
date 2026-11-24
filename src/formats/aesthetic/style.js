import { readFileSync } from "node:fs";
import path from "node:path";
import { config } from "../../config.js";
import { KITS } from "./kits.js";

export const HEAD_FONTS = {
  "Instrument Serif": { italic: "Instrument Serif Italic", note: "light editorial serif (titles)" },
  "DM Serif": { italic: "DM Serif Italic", note: "high-contrast display serif" },
  "Cormorant Bold": { italic: "Cormorant Italic", note: "classic, festive, luxurious" },
  "Fraunces Black": { italic: "Fraunces Italic", note: "chunky soft serif, warm and confident" },
  "Playfair Italic": { italic: "Playfair Italic", note: "elegant italic only" },
  Anton: { italic: null, note: "tall condensed caps (big section words)" },
  "Bebas Neue": { italic: null, note: "condensed caps, lighter than Anton" },
  "Archivo Black": { italic: null, note: "heavy grotesk, poster-like" },
  "Syne ExtraBold": { italic: null, note: "wide, modern, tracked caps" },
  "Space Grotesk Bold": { italic: null, note: "techy grotesk, product / quality talk" },
};
export const LABEL_FONTS = ["Plex Mono Medium", "Space Grotesk Bold", "Inter Bold"];
export const TEXTURES = ["sweep", "plain", "dots", "grid", "lines", "grain"];
export const PILLS = ["outline", "solid", "tag", "text"];
export const CHAPTERS = ["pill", "header", "check", "stack", "label", "number", "none"];
export const INDEXES = ["rows", "grid", "cards", "list", "none"];
export const COVERS = ["callouts", "grid", "versus", "checklist", "photo", "beforenow", "type"];
export const TRANSITIONS = ["xfade", "wipe", "cut", "slide"];

export const STYLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["idea", "page", "texture", "corners", "accent", "headline_font", "headline_italic", "headline_upper", "label_font", "pill", "chapter", "index", "tempo", "transitions", "cover", "signature", "build_column"],
  properties: {
    idea: { type: "string", description: "One sentence: the reel's visual idea and why it suits THIS topic (e.g. 'festival poster: warm cream page, chunky serif, marigold accent, outfits built piece by piece like a shopping list')" },
    page: { type: "string", description: "Background colour, light, #RRGGBB (e.g. #EDEDEB studio grey, #F4EFE7 cream, #F7F1E3 warm paper, #EEF1EE sage mist)" },
    texture: { type: "string", enum: TEXTURES },
    corners: { type: "boolean", description: "camera-viewfinder corner marks" },
    accent: { type: "string", description: "One accent colour #RRGGBB used sparingly (markers, numbers, hairlines), picked from the topic (marigold for Navratri, denim blue for jeans...)" },
    headline_font: { type: "string", enum: Object.keys(HEAD_FONTS) },
    headline_italic: { type: "boolean" },
    headline_upper: { type: "boolean" },
    label_font: { type: "string", enum: LABEL_FONTS },
    pill: { type: "string", enum: PILLS, description: "outline: white pill with ink line; solid: ink pill, white text; tag: square label with an accent bar; text: just small caps with an underline" },
    chapter: { type: "string", enum: CHAPTERS, description: "how a section opens: pill (blurred moving close-up + pill), header ('01/ NAME' at the top for the section), check (dark footage + CHECK: 01), stack (tilted photo cards), label (huge condensed word), number (a giant numeral + the word beside the model), none" },
    index: { type: "string", enum: INDEXES, description: "contents page: rows of looks, a 2x2 grid, dark cards, a numbered list, or none" },
    tempo: { type: "string", enum: ["calm", "crisp"], description: "calm: soft eases, longer holds; crisp: quicker pops and cuts" },
    transitions: { type: "array", items: { type: "string", enum: TRANSITIONS }, description: "1-3 transitions this reel rotates through" },
    cover: { type: "string", enum: COVERS },
    signature: { type: "string", description: "The ONE device this reel leans on and repeats (scale bar, swatch click, piece-by-piece build, product cards, before/now, photo cards, shift arrows...) and how" },
    build_column: { type: "string", enum: ["left", "right"], description: "build scenes: which side the pieces stack on" },
  },
};

const KIT_STYLE = {
  studio_guide: { page: "#ECECEA", texture: "sweep", corners: false, accent: "#FF5733", headline_font: "Instrument Serif", headline_italic: true, headline_upper: false, label_font: "Plex Mono Medium", pill: "outline", tempo: "calm", transitions: ["xfade", "wipe", "cut"] },
  wheel_guide: { page: "#ECECEA", texture: "sweep", corners: false, accent: "#7C5CFF", headline_font: "Instrument Serif", headline_italic: true, headline_upper: false, label_font: "Plex Mono Medium", pill: "outline", tempo: "calm", transitions: ["xfade", "cut"] },
  versus: { page: "#EEEEEC", texture: "sweep", corners: false, accent: "#F08A5D", headline_font: "Instrument Serif", headline_italic: true, headline_upper: false, label_font: "Plex Mono Medium", pill: "outline", tempo: "calm", transitions: ["xfade", "cut"] },
  check: { page: "#E9E9E6", texture: "sweep", corners: false, accent: "#2DB25B", headline_font: "Syne ExtraBold", headline_italic: false, headline_upper: true, label_font: "Space Grotesk Bold", pill: "outline", tempo: "crisp", transitions: ["cut", "xfade"] },
  file: { page: "#F4F2EE", texture: "dots", corners: true, accent: "#1E1E1C", headline_font: "Anton", headline_italic: false, headline_upper: true, label_font: "Plex Mono Medium", pill: "text", tempo: "crisp", transitions: ["cut", "slide"] },
  recreate: { page: "#FBFBFA", texture: "plain", corners: false, accent: "#D7263D", headline_font: "Instrument Serif", headline_italic: true, headline_upper: false, label_font: "Space Grotesk Bold", pill: "solid", tempo: "crisp", transitions: ["cut", "slide"] },
  glow: { page: "#F4EFE7", texture: "grain", corners: true, accent: "#B08D57", headline_font: "Instrument Serif", headline_italic: true, headline_upper: false, label_font: "Plex Mono Medium", pill: "outline", tempo: "calm", transitions: ["xfade", "wipe"] },
};
export function kitStyle(kitKey) {
  const k = KITS[kitKey] ?? KITS.studio_guide;
  return { idea: k.brief, ...KIT_STYLE[kitKey in KIT_STYLE ? kitKey : "studio_guide"], chapter: k.chapter, index: k.index, cover: k.cover, signature: "", build_column: kitKey === "recreate" ? "right" : "left" };
}

export function styleOf(plan = {}) {
  const kitKey = KITS[plan.kit] ? plan.kit : plan.look === "paper" ? "file" : "studio_guide";
  return normalizeStyle(plan.style, kitStyle(kitKey));
}

const HEX = /^#[0-9a-f]{6}$/i;
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};
const pick = (v, list, d) => (list.includes(v) ? v : d);

export function normalizeStyle(raw = {}, fallback = kitStyle("studio_guide")) {
  const s = { ...fallback, ...raw };
  if (!HEX.test(s.page ?? "") || lum(s.page) < 0.78) s.page = fallback.page;
  if (!HEX.test(s.accent ?? "")) s.accent = fallback.accent;
  s.texture = pick(s.texture, TEXTURES, fallback.texture);
  s.headline_font = s.headline_font in HEAD_FONTS ? s.headline_font : fallback.headline_font;
  if (!HEAD_FONTS[s.headline_font].italic) s.headline_italic = false;
  s.label_font = pick(s.label_font, LABEL_FONTS, fallback.label_font);
  s.pill = pick(s.pill, PILLS, fallback.pill);
  s.chapter = pick(s.chapter, CHAPTERS, fallback.chapter);
  s.index = pick(s.index, INDEXES, fallback.index);
  s.cover = pick(s.cover, COVERS, fallback.cover);
  s.tempo = s.tempo === "crisp" ? "crisp" : "calm";
  s.transitions = [...new Set((s.transitions ?? []).filter((x) => TRANSITIONS.includes(x)))].slice(0, 3);
  if (!s.transitions.length) s.transitions = fallback.transitions;
  s.build_column = s.build_column === "right" ? "right" : "left";
  return s;
}

const AXES = [
  ["page", (s) => s.page.toLowerCase()],
  ["texture", (s) => s.texture],
  ["headline", (s) => `${s.headline_font}|${s.headline_upper}`],
  ["pill", (s) => s.pill],
  ["chapter", (s) => s.chapter],
  ["index", (s) => s.index],
  ["cover", (s) => s.cover],
  ["accent", (s) => s.accent.toLowerCase()],
];
export function sameAxes(a, b) {
  return AXES.filter(([, f]) => b && f(a) === f(b)).map(([k]) => k);
}
const ROTATE = {
  page: ["#ECECEA", "#F4EFE7", "#F2F0EA", "#EEF1EE", "#F6F1EA", "#FBFBFA"],
  texture: TEXTURES,
  headline: Object.keys(HEAD_FONTS),
  pill: PILLS,
  cover: ["callouts", "grid", "type"],
  accent: ["#C8553D", "#2F6690", "#B08D57", "#7C5CFF", "#2E7D5B", "#D4A017"],
};
export function ensureNovel(style, recent = []) {
  const s = { ...style };
  const [last, before] = recent;
  for (const [ref, need] of [[last, 4], [before, 3]]) {
    if (!ref) continue;
    let same = sameAxes(s, ref);
    for (const axis of ["page", "headline", "pill", "texture", "accent", "cover"]) {
      if (AXES.length - same.length >= need) break;
      if (!same.includes(axis)) continue;
      const list = ROTATE[axis];
      const cur = axis === "headline" ? s.headline_font : s[axis];
      const next = list[(list.indexOf(cur) + 1 + list.length) % list.length];
      if (axis === "headline") {
        s.headline_font = next;
        s.headline_upper = !HEAD_FONTS[next].italic;
        if (!HEAD_FONTS[next].italic) s.headline_italic = false;
      } else s[axis] = next;
      same = sameAxes(s, ref);
    }
  }
  return s;
}

export function principles() {
  try {
    return readFileSync(path.join(config.root, "assets", "aesthetic-principles.md"), "utf8");
  } catch {
    return "";
  }
}
