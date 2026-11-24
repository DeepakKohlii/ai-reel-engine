import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.js";
import { readJson } from "../../util.js";
import { PLUGINS } from "../../motions/index.js";

const SET_PIECES = {
  "letter fly-through": (b) => b.transition === "letter",
  "giant hero word": (b) => b.hero_size === "giant",
  "ghost words": (b) => b.ghost === "yes",
  "punch crop": (b) => b.camera === "punch",
  "flow (one item, many looks)": (b) => b.visual?.kind === "flow",
  "photo cards": (b) => b.visual?.layout === "cards",
  "before/after slider": (b) => b.visual?.layout === "slider",
  "verdict stamps": (b) => b.visual?.layout === "verdict",
  "zoom magnifier": (b) => b.visual?.layout === "zoom",
  scale: (b) => b.visual?.layout === "scale",
  duo: (b) => b.visual?.layout === "duo",
  "black-and-white closeup": (b) => b.visual?.layout === "closeup",
  "stack column": (b) => b.motion === "stack",
  slam: (b) => b.motion === "slam",
  "swatch board": (b) => ["swatches", "shades"].includes(b.visual?.kind),
  ...Object.fromEntries(Object.values(PLUGINS).map((p) => [p.name.toLowerCase(), (b) => b.visual?.layout === p.id])),
};

export async function recentReels(excludeSlug, n = 5) {
  const slugs = await fs.readdir(config.packsDir).catch(() => []);
  const out = [];
  for (const slug of slugs) {
    if (slug === excludeSlug || slug.startsWith(".") || slug.startsWith("trial-")) continue;
    const file = path.join(config.packsDir, slug, "script.json");
    const s = await readJson(file);
    if (s?.format !== "editorial" || s.stage === "text" || !s.beats?.length) continue;
    const stat = await fs.stat(file);
    out.push({ slug, s, at: stat.mtimeMs });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, n).map(({ slug, s }) => ({ slug, ...fingerprint(s) }));
}

function endingGuess(s) {
  const beats = s.beats ?? [];
  if (beats.some((b) => b.visual?.layout === "dm")) return "dm";
  const tail = beats.slice(-3).map((b) => b.visual?.layout);
  if (tail.includes("cards")) return "cards";
  if (tail.includes("corner")) return "product";
  return "text";
}

export function fingerprint(s) {
  const beats = s.beats ?? [];
  const pieces = Object.entries(SET_PIECES)
    .filter(([, test]) => beats.some(test))
    .map(([name]) => name);
  const look = Object.entries(s.look ?? {})
    .filter(([k, v]) => !(v === "no" || v === "full" || v === "color"))
    .map(([k, v]) => `${k} ${v}`);
  return {
    title: s.title,
    typeset: s.typeset ?? "editorial",
    palette: (s.palette ?? []).map((p) => `${p.name ?? ""} ${p.bg}/${p.accent}`.trim()),
    look,
    pieces,
    hook: beats.slice(0, 2).map((b) => b.voiceover).join(" "),
    cta: beats.slice(-3).map((b) => b.voiceover).join(" "),
    sticker: s.sticker?.text ?? "",
    ending: s.ending ?? endingGuess(s),
  };
}

export function varietyBrief(recent) {
  if (!recent.length) return "";
  const last = recent[0];
  const piecesLast2 = new Set(recent.slice(0, 2).flatMap((r) => r.pieces));
  return [
    "Recent reels on this channel (newest first). Make this one feel fresh next to them:",
    ...recent.map((r, i) => `${i + 1}. "${r.title}": type set ${r.typeset}${r.palette.length ? `; palette ${r.palette.join(", ")}` : ""}${r.look.length ? `; look ${r.look.join(", ")}` : ""}; set pieces ${r.pieces.join(", ") || "none"}${r.sticker ? `; sticker "${r.sticker}"` : ""}; ending ${r.ending}`),
    `- Don't reuse the last reel's type set (${last.typeset}) or its palette colours.`,
    piecesLast2.size ? `- Set pieces used in the last two reels (${[...piecesLast2].join(", ")}): skip them this time unless one is clearly the best fit for a moment; reach for ones not used recently.` : "",
    "- Exception: the creator's liked ingredients (listed in their taste) are always allowed where they fit (e.g. a list line always shows its items as photo cards); just don't lean on them for everything.",
    "- Keep every reel recognisably this channel (same quality, same voice); vary the look, not the identity.",
  ]
    .filter(Boolean)
    .join("\n");
}

const CTA_LINE = /comments? mein|list chahiye|dm mein|bhej dunga/i;
const words = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
const GLUE = new Set("hai hain ho ka ki ke ko se mein me ye yeh wo woh aur toh to bhi nahi na tum tumhe tumhara tumhari tumhare the a an is it par pe jo kya kaise ek bas sab and of in on with".split(" "));
const ALLOWED = /agli baar|usse pehle|pehle ye|ye dekh|dekh lo/;
const phrase = (w) => (w.filter((x) => !GLUE.has(x)).length >= 2 && !ALLOWED.test(w.join(" ")) ? w.join(" ") : null);

export async function recentScripts(excludeSlug = null, n = 10) {
  const slugs = await fs.readdir(config.packsDir).catch(() => []);
  const out = [];
  for (const slug of slugs) {
    if (slug === excludeSlug || slug.startsWith(".") || slug.startsWith("trial-")) continue;
    const file = path.join(config.packsDir, slug, "script.json");
    const s = await readJson(file);
    if (s?.format !== "editorial") continue;
    const lines = (s.stage === "text" ? s.lines : s.beats)?.map((l) => l.voiceover).filter(Boolean) ?? [];
    if (!lines.length) continue;
    out.push({ slug, title: s.title, shape: s.shape ?? "", lines, at: (await fs.stat(file)).mtimeMs });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, n);
}

export function usedPhrases(scripts) {
  const seen = new Map();
  scripts.forEach((s, i) => {
    const grams = new Set();
    for (const line of s.lines.filter((l) => !CTA_LINE.test(l))) {
      const w = words(line);
      for (let k = 0; k + 3 <= w.length; k++) {
        const p = phrase(w.slice(k, k + 3));
        if (p) grams.add(p);
      }
    }
    for (const g of grams) {
      const e = seen.get(g) ?? { n: 0, latest: false };
      e.n++;
      if (i === 0) e.latest = true;
      seen.set(g, e);
    }
  });
  return [...seen.entries()].filter(([, e]) => e.n >= 2).sort((a, b) => b[1].n - a[1].n).map(([g]) => g).slice(0, 40);
}

export function scriptVarietyBrief(scripts) {
  if (!scripts.length) return "";
  const shapes = scripts.slice(0, 3).map((s) => s.shape).filter(Boolean);
  const phrases = usedPhrases(scripts);
  return [
    "What this channel already said (make this one sound new):",
    ...scripts.slice(0, 6).map((s) => `- "${s.title}": opened with "${s.lines.slice(0, 2).join(" ")}"${s.shape ? ` (${s.shape})` : ""}`),
    shapes.length ? `- Don't use these shapes again yet: ${[...new Set(shapes)].join(", ")}.` : "",
    phrases.length ? `- Phrases already used on the channel (don't reuse any of them): ${phrases.map((p) => `"${p}"`).join(", ")}.` : "",
  ].filter(Boolean).join("\n");
}

const STOCK = [
  [/\brule simple hai\b|\bsimple rule\b/i, '"rule simple hai"'],
  [/\bekdum fresh\b/i, '"ekdum fresh"'],
  [/\bgame ?changer\b/i, '"game changer"'],
  [/\btrust me\b/i, '"trust me"'],
  [/\b(thaka|thake|thaki|thakaa|bimaar|bimar|murjha\w*|bejaan|tikt[ia]|nigal\w*|kha jaat[ia])\b/i, 'dramatic Hindi for how something looks ("thaka hua", "bimaar"...): use "dull", "washed out", "tired", "off"'],
  [/dost yaad|yaad aaya|us dost|dost ko (bhejo|tag)|friend ko (bhejo|tag)|\btag (karo|kar do)\b/i, 'a cringe "think of your friend / tag them" line'],
];
export function stockProblems(lines, scripts) {
  const body = lines.map((l) => l.voiceover).filter((l) => !CTA_LINE.test(l));
  const text = body.join(" \n ");
  const found = STOCK.filter(([re]) => re.test(text)).map(([, name]) => name);
  const occasions = body.filter((l) => /^(college|office|party|date|wedding|shaadi|function|weekend|trip|interview|gym)\b.{0,12}\bmein\b/i.test(l.trim())).length;
  if (occasions >= 2) found.push('a list of occasion lines ("College mein... Party mein...")');
  const used = new Set(usedPhrases(scripts));
  const repeats = new Set();
  for (const l of body) {
    const w = words(l);
    for (let k = 0; k + 3 <= w.length; k++) {
      const p = phrase(w.slice(k, k + 3));
      if (p && used.has(p)) repeats.add(p);
    }
  }
  if (repeats.size) found.push(`phrases this channel already used: ${[...repeats].map((p) => `"${p}"`).join(", ")}`);
  return found;
}

export function wordingBrief(recent) {
  if (!recent.length) return "";
  return [
    "Recent reels' openings and endings (don't reuse their wording; keep the preferred shapes but vary them):",
    ...recent.slice(0, 4).map((r) => `- Hook: "${r.hook}" | End: "${r.cta}"`),
  ].join("\n");
}
