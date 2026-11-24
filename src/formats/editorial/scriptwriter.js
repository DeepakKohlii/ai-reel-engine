import { askJson } from "../../claude.js";
import { performanceContext } from "../../results.js";
import { publicSchema } from "../../schema-check.js";
import { validateScript } from "../../script.js";
import { AUDIENCE } from "../shared.js";
import { brief, schema } from "./index.js";
import { PLUGINS, libraryBrief, ratingOf } from "../../motions/index.js";

const WRITER = `You write the voiceover for "Style rules" reels: a faceless Instagram channel about men's style in India. Editorial kinetic typography over outfit images, 25-40 seconds, one styling rule per reel.

${AUDIENCE}

How it must sound:
- A sharp, friendly 22-year-old stylist casually explaining to a friend. Respectful: always "tum" (karo, dekho, likho, pehno); never "tu", "tera/tere" or bare commands ("kar", "kar lo", "ruk").
- How something looks is said in the everyday English word guys use: "dull", "washed out", "tired", "off", "sharp", "clean", "balanced", "cheap". Never dramatic or literal Hindi for it ("thaka hua", "bimaar", "murjhaya", "bejaan", "tikti hai", "nigal leti hai", "kha jaati hai"): it sounds odd and the creator has rejected it many times.
- Natural urban Hinglish the way guys actually talk, with plenty of everyday English ("shoes dikh hi nahi rahe", "fit ekdum off lagta hai", "look balanced ho jaata hai"). No bookish or hard Hindi ("tikti hai", "nigal leti hai"), no forced literal metaphors ("jeans shoe kha jaati hai"), no clipped caption-speak. Simple words.
- One flow: the lines, read one after another, are one person talking. Every line leads into the next and makes sense by ear alone, without seeing the picture.

Substance first (this is what makes people save and send a reel):
- Teach something he doesn't already know: the WHY behind the advice (undertone, contrast, proportion, fabric, fit), a quick test he can do in front of the mirror, a number (1-2 inches, 3 shades apart), or a surprising exception. Every reel has at least 2 specific, non-obvious facts. "Ye colour achha lagta hai" is not information; why it works, and how to check it on yourself, is.
- Be concrete: name the actual colours, fabrics, fits, lengths and situations. No filler lines that only sound good.

Pick ONE shape that suits the topic (and differs from recent reels; see below):
- Myth-bust: a belief he has, why it's wrong, what's actually true, how to check.
- Mirror test: a 5-second test he can do right now, what the result means, what to do for each result.
- Wrong vs right: one outfit fixed step by step, each step with its reason.
- Countdown: 3 specific points, building to the most important one (promise it early: "teesra wala sabse zaroori hai").
- Diagnosis: "agar tumhare saath ye hota hai..." (a symptom he recognises), the hidden cause, the fix.
- Science/why: the one principle behind a whole category of advice, then 2 quick applications.
- Challenge: "pause karo aur check karo..." then reveal what he should have noticed.
Keep an open loop: raise a question or promise early and pay it off late, so he watches to the end.

Hook (first 1-2 lines, the most important part): make him stop in under 2 seconds with something specific. Rotate between types: a counter-intuitive claim ("Black shirt tumhe mota dikhata hai"), a precise situation he's been in, a mistake he's making right now, a result he wants, or a heads-up ("Agli baar X pehno, usse pehle ye dekh lo", the creator's favourite, but not every time). Never a generic statement, a question he can answer with "no", or a slow build-up.

Ending: one CTA only, split over 2-3 lines, in this shape: "Agar tumhe saare X ki list chahiye," / "toh comments mein KEYWORD likho," / "main list tumhare DM mein bhej dunga." People send a reel because it's useful or because it names a situation they know too well, never because a line asks them to think of someone: no "dost yaad aaya?", "tag that friend" or "us dost ko bhejo" type lines, they sound cringe.
No greetings, no "aaj hum baat karenge", no follow/tag/share asks.

Never use these stock moves (they make every reel sound the same): "Rule simple hai", "Simple rule:", "ekdum fresh", "game changer", "trust me", a list of occasions in the form "College mein X. Party mein Y. Office mein Z.", ending the teaching part with a one-line slogan every time, and any phrase listed below as already used on this channel.

Lines:
- Write the "paragraph" first: the whole voiceover as one natural spoken paragraph, full sentences joined the way people talk ("kyunki", "toh", "matlab", "aur agar", "isliye"), each thought leading into the next. No telegraphic fragments ("Camel jacket ka fix end mein", "shade aur undertone skin jaise"), no list of mini-sentences. Then cut that exact paragraph, word for word, into lines at natural phrase breaks: a line can end mid-sentence (the voice is recorded in one take, so line breaks add no pauses).
- Length: 10-16 lines and 70-95 spoken words in total (about 30-38 seconds). Never more than 100 words: a tight reel keeps people watching; a long one loses them. Lines are 3-12 spoken words; short on-screen text never means short speech. Vary starts; don't open several lines with "Toh".
- voiceover: exactly what's said, Roman-script Hinglish, numbers as spoken words, no emoji.
- on_screen: what appears on screen for that line: words from that line, same order, you may drop filler, but it must read as a clear phrase on its own (never drop the subject: "Shoes dikh hi nahi rahe?" -> "SHOES / dikh hi nahi rahe?", not "dikh hi / nahi rahe?"). Use " / " between the stacked lines of text, 2-6 words total, CAPS for the key word.

Before answering: write the whole voiceover as one paragraph, read it out loud in your head, fix anything that sounds written, odd or hard, then cut it into lines. Then check every sentence: would a 19-year-old understand it the first time he hears it, without seeing the screen? If he'd have to work out what it means, say it fully and plainly. No shortened grammar that drops the verb or the object ("toh ye colour upar nahi" -> "toh ye colour shirt mein mat pehno"), no pronoun he can't place, no unusual word where a common one exists ("gardan" -> "skin", "neck"). The advice must be correct enough that a professional stylist would nod.`;

const LINES = {
  type: "object",
  additionalProperties: false,
  required: ["title", "angle", "facts", "shape", "hook_options", "paragraph", "comment_keyword", "lines"],
  properties: {
    title: { type: "string" },
    angle: { type: "string", description: "One or two sentences: why guys will save and share this" },
    facts: { type: "array", items: { type: "string" }, description: "The 2-4 specific, non-obvious things this reel teaches (with the why), written before the lines" },
    shape: { type: "string", enum: ["myth-bust", "mirror test", "wrong vs right", "countdown", "diagnosis", "science/why", "challenge"] },
    hook_options: { type: "array", items: { type: "string" }, description: "5 different hooks of different types; the script uses the strongest" },
    paragraph: { type: "string", description: "The whole voiceover as one natural spoken paragraph; lines are this, cut at phrase breaks" },
    comment_keyword: { type: "string" },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["voiceover", "on_screen"],
        properties: { voiceover: { type: "string" }, on_screen: { type: "string" } },
      },
    },
  },
};

const asText = (lines) => lines.map((l, i) => `${i + 1}. ${l.voiceover}   [on screen: ${l.on_screen}]`).join("\n");

function textScript(raw, topic, extra = {}) {
  return {
    format: "editorial",
    stage: "text",
    approved: false,
    topic,
    title: String(raw.title ?? topic),
    angle: String(raw.angle ?? ""),
    comment_keyword: String(raw.comment_keyword ?? ""),
    shape: String(raw.shape ?? ""),
    facts: (raw.facts ?? []).map(String),
    lines: (raw.lines ?? []).map((l) => ({ voiceover: String(l.voiceover ?? "").trim(), on_screen: String(l.on_screen ?? "").trim() })).filter((l) => l.voiceover),
    ...extra,
  };
}

const MAX_WORDS = 100;
const wordCount = (s) => s.lines.reduce((n, l) => n + l.voiceover.split(/\s+/).filter(Boolean).length, 0);
async function tighten(script) {
  const n = wordCount(script);
  if (n <= MAX_WORDS) return script;
  const shorter = await reviseScript(script, `It's too long: ${n} spoken words (about ${Math.round(n / 2.6)} seconds). Cut it to 80-95 words so it's under 40 seconds: drop repeats and weaker examples, merge lines, keep the hook, the key facts, the open loop's payoff and the CTA.`, { skipTighten: true });
  return wordCount(shorter) < n ? shorter : script;
}

export async function writeScript({ topic, notes = "" }) {
  const { recentScripts, scriptVarietyBrief } = await import("./variety.js");
  const scripts = await recentScripts(null);
  const task = [`Write the reel about: ${topic}`, notes && `Creator's notes: ${notes}`, scriptVarietyBrief(scripts), await performanceContext()]
    .filter(Boolean)
    .join("\n\n");
  const raw = await askJson({ system: WRITER, task, schema: LINES, effort: "high" });
  return tighten(await freshen(textScript(raw, topic), scripts));
}

async function freshen(script, scripts) {
  const { stockProblems } = await import("./variety.js");
  const problems = stockProblems(script.lines, scripts);
  if (!problems.length) return script;
  const fixed = await reviseScript(script, `It sounds like the channel's older reels. Rewrite those lines in new words (keep the facts, the hook if it's strong, and the CTA): ${problems.join("; ")}.`, { skipTighten: true, skipFreshen: true });
  return stockProblems(fixed.lines, scripts).length < problems.length ? fixed : script;
}

export function linesOf(script) {
  if (script.stage === "text") return script.lines;
  const plain = (t) => String(t ?? "").replace(/%[^%]*%/g, "").replace(/[~#*!^[\]]/g, "").replace(/\s*\/\s*/g, " / ").replace(/^\s*\/\s*|\s*\/\s*$/g, "").trim();
  return (script.beats ?? []).map((b) => ({ voiceover: b.voiceover, on_screen: plain(b.text) }));
}

export async function reviseScript(script, notes, { skipTighten = false, skipFreshen = false, slug = null } = {}) {
  const { recentScripts, scriptVarietyBrief } = await import("./variety.js");
  const others = (await recentScripts(slug)).filter((s) => s.title !== script.title);
  const task = [
    `Revise this reel script about "${script.topic ?? script.title}". Fix what the creator says; keep everything that already works. Return the complete script.`,
    `Creator's notes (top priority):\n${notes || "Make it flow more naturally, like one person talking."}`,
    `Current script:\nTitle: ${script.title}\nComment keyword: ${script.comment_keyword}\n${asText(linesOf(script))}`,
    scriptVarietyBrief(others),
  ].filter(Boolean).join("\n\n");
  const raw = await askJson({ system: WRITER, task, schema: LINES, effort: "high" });
  const keep = {};
  for (const k of ["aspect", "voice", "music", "sfx", "results", "styleChoice"]) if (script[k] !== undefined) keep[k] = script[k];
  keep.previousDesign =
    script.stage === "text"
      ? script.previousDesign
      : { typeset: script.typeset, palette: script.palette, sticker: script.sticker, beats: script.beats.map((b) => ({ voiceover: b.voiceover, text: b.text, visual: b.visual })) };
  if (!keep.previousDesign) delete keep.previousDesign;
  const out = textScript(raw, script.topic ?? script.title, keep);
  const fresh = skipFreshen ? out : await freshen(out, others);
  return skipTighten ? fresh : tighten(fresh);
}

const SHOE_WORDS = /\b(shoes?|sneakers?|sole|boots?|loafers?|joote|chappal|kicks)\b/i;
export function enforceRules(script, prefs = null) {
  const beats = script.beats ?? [];
  const isModel = (v) => v?.asset_kind === "model" || (v?.items ?? []).some((it) => (it.asset_tags ?? []).includes("model"));
  for (const b of beats) {
    const v = b.visual;
    if (isModel(v) && SHOE_WORDS.test(b.voiceover) && !["zoom", "closeup", "duo"].includes(v.layout)) v.focus = "lower";
  }
  const product =
    beats.map((b) => b.visual).find((v) => v?.kind === "asset" && v.asset_kind === "item") ??
    beats.flatMap((b) => (b.visual?.items ?? []).filter((it) => !(it.asset_tags ?? []).includes("model")).map((it) => ({ asset_tags: it.asset_tags, asset_prompt: it.asset_prompt })))[0];
  const cap = Math.max(1, Math.floor(beats.length * 0.3));
  const modelBeats = beats.map((b, i) => (b.visual?.kind === "asset" && b.visual.asset_kind === "model" ? i : -1)).filter((i) => i >= 0);
  const garmentsOf = (b) => (b.visual.asset_tags ?? []).filter((t) => t !== "model" && (/\s/.test(t) || /^(shirt|tee|tshirt|jacket|jeans|chinos|trousers|kurta|polo|shoes|sneakers|loafers|boots|blazer|overshirt)$/.test(t)));
  const named = (b) => garmentsOf(b).filter((g) => g.split(" ").some((w) => new RegExp(`\\b${w}\\b`, "i").test(b.voiceover))).length;
  let extra = modelBeats.length - cap;
  for (const i of modelBeats.filter((i) => i > 0).sort((a, c) => named(beats[c]) - named(beats[a]))) {
    if (extra <= 0) break;
    const b = beats[i];
    const garments = garmentsOf(b);
    const inLine = garments.filter((g) => g.split(" ").some((w) => new RegExp(`\\b${w}\\b`, "i").test(b.voiceover)));
    const pick = (inLine.length >= 2 ? inLine : [...inLine, ...garments].filter((g, k, a) => a.indexOf(g) === k)).slice(0, 3);
    if (pick.length < 2) continue;
    const near = [beats[i - 1], beats[i + 1]].some((x) => x?.visual?.layout === "cards");
    b.visual = {
      ...b.visual,
      kind: "outfit",
      asset_kind: "item",
      layout: near ? "auto" : "cards",
      focus: "full",
      asset_tags: [],
      asset_prompt: "",
      items: pick.map((g) => ({ label: g, hex: "", asset_tags: g.split(" "), asset_prompt: `${g}, product photo` })),
    };
    if (b.text_style === "caption") b.text_style = "lockup";
    if (b.camera === "punch") b.camera = "none";
    extra--;
  }
  for (const b of beats) if (b.camera === "punch" && b.visual?.asset_kind === "model") b.camera = "none";

  const SWAP = { cards: "scale", scale: "cards", flow: "cards", slider: "verdict", verdict: "slider", mosaic: "cards", duo: "hero", zoom: "side", deck: "cards", pick: "cards", callouts: "float", reveal: "float" };
  for (let i = beats.length - 1; i > 0; i--) {
    const a = beats[i - 1].visual;
    const c = beats[i].visual;
    if (!a || !c || a.layout !== c.layout || !SWAP[a.layout]) continue;
    const alt = SWAP[a.layout];
    const prev = beats[i - 2]?.visual?.layout;
    a.layout = alt !== prev ? alt : "float";
  }
  let trials = 0;
  for (const b of beats) {
    const v = b.visual;
    const plugin = v && PLUGINS[v.layout];
    if (!plugin) continue;
    const r = ratingOf(plugin, prefs);
    if (r === "dislike" || r === "new" || (r === "trial" && trials++ > 0)) v.layout = plugin.fallback;
  }
  const textOnly = beats.map((b, i) => (b.visual?.kind === "none" ? i : -1)).filter((i) => i >= 0);
  const keep = new Set([0, beats.length - 1, beats.length - 2]);
  if (product && textOnly.length > 3) {
    for (const i of textOnly) {
      if (keep.has(i) || beats[i - 1]?.visual?.layout === "corner" || beats[i + 1]?.visual?.layout === "corner") continue;
      Object.assign(beats[i].visual, { kind: "asset", asset_kind: "item", layout: "corner", asset_tags: [...(product.asset_tags ?? [])], asset_prompt: product.asset_prompt ?? "" });
    }
  }
  return script;
}

const ENDINGS = ["dm", "cards", "product"];
export function endingOf(s) {
  const beats = s.beats ?? [];
  if (beats.some((b) => b.visual?.layout === "dm")) return "dm";
  const tail = beats.slice(-3).map((b) => b.visual?.layout);
  if (tail.includes("cards")) return "cards";
  if (tail.includes("corner")) return "product";
  return "text";
}
export async function varyEnding(script, slug) {
  const { recentReels } = await import("./variety.js");
  const recent = (await recentReels(slug, 2)).map((r) => r.ending);
  const choice = ENDINGS.find((e) => !recent.includes(e)) ?? "dm";
  const beats = script.beats;
  const kwIdx = beats.findIndex((b) => /comment/i.test(b.voiceover));
  if (kwIdx < 0) return;
  const last = beats.length - 1;
  const product =
    beats.map((b) => b.visual).find((v) => v?.kind === "asset" && v.asset_kind === "item") ??
    beats.flatMap((b) => (b.visual?.items ?? []).filter((it) => !(it.asset_tags ?? []).includes("model")))[0];
  if (choice === "dm") {
    for (const i of new Set([kwIdx, last])) Object.assign(beats[i].visual, { kind: "none", layout: "dm" });
  } else if (choice === "product" && product) {
    for (const i of new Set([kwIdx, last])) Object.assign(beats[i].visual, { kind: "asset", asset_kind: "item", layout: "corner", asset_tags: [...(product.asset_tags ?? [])], asset_prompt: product.asset_prompt ?? "" });
  }
  script.ending = choice;
}

const plainWords = (t) => String(t ?? "").toLowerCase().replace(/%[^%]*%/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export async function artDirect(script, pick = null, slug = null) {
  const style = pick?.mode === "full" ? pick.styles[0] : null;
  const lines = script.lines;
  const task = [
    `Art-direct this reel about "${script.topic ?? script.title}". The spoken script is APPROVED and final.`,
    `Use exactly ${lines.length} beats, one per line below, in order. Each beat's "voiceover" is the line word for word. Each beat's "text" uses exactly the on-screen words given, in the same order and nothing else spoken, only adding the lockup markup (" / " breaks, one hero with ~ * # or !, ^accent, [LABEL]) and optionally one short %note%. Design everything else: typeset, palette, sticker, visuals, cover, caption, hashtags, music vibe. Title "${script.title}", comment keyword "${script.comment_keyword}".`,
    `The approved lines:\n${asText(lines)}`,
  ].join("\n\n");
  const prev = script.previousDesign;
  const taskWithPrev = prev
    ? `${task}\n\nThis reel was designed before. Keep what worked from it, but the creator's standing imagery rules (show the subject, models on at most ~30% of beats, no words over a model, a product in the corner of type-led beats) always win over the old design. Keep its typeset ("${prev.typeset}") and palette, and for every line that says the same thing as an old line (even if the wording changed a little), reuse that old beat's visual exactly (same kind, layout, style, items, asset_tags and asset_prompt) so the same images are reused. Only design new visuals for genuinely new lines.\nPrevious design:\n${prev.beats.map((b, i) => `${i + 1}. "${b.voiceover}" -> ${JSON.stringify(b.visual)}`).join("\n")}\nPrevious palette: ${JSON.stringify(prev.palette)}`
    : task;
  const { styleBrief, ingredientsBrief, prefsBrief, loadPrefs } = await import("../../learn.js");
  const { recentReels, varietyBrief } = await import("./variety.js");
  const prefs = await loadPrefs();
  const taste = [await prefsBrief(), libraryBrief(prefs), varietyBrief(await recentReels(slug))].filter(Boolean).join("\n\n");
  const taskFinal = (taste ? `${taste}\n\n` : "") + (style
    ? `${taskWithPrev}\n\nTRIAL: copy this learned style's whole format for this reel.\n${styleBrief(style)}`
    : pick?.mode === "borrow"
      ? `${taskWithPrev}\n\n${ingredientsBrief(pick.styles)}`
      : taskWithPrev);
  const raw = await askJson({ system: brief, task: taskFinal, schema: publicSchema(schema), effort: "high" });
  const full = validateScript(raw, "editorial");
  full.beats = full.beats.slice(0, lines.length);
  lines.forEach((l, i) => {
    const b = full.beats[i];
    if (!b) return;
    b.voiceover = l.voiceover;
    b.speak = "";
    const same = prev?.beats.find((o) => plainWords(o.voiceover) === plainWords(l.voiceover));
    if (same?.visual && !["model", "host"].includes(same.visual.asset_kind) && !(same.visual.items ?? []).some((it) => (it.asset_tags ?? []).includes("model"))) b.visual = same.visual;
    if (plainWords(b.text) !== plainWords(l.on_screen)) b.text = l.on_screen;
  });
  if (full.beats.length < lines.length) throw new Error("The design step dropped some lines. Try Approve again.");
  const out = enforceRules({ ...full, format: "editorial", topic: script.topic, title: script.title, comment_keyword: script.comment_keyword, approved: true }, prefs);
  await varyEnding(out, slug);
  if (style) {
    out.styleId = style.id;
    out.styleName = style.name;
    out.sfxRules = style.card.sound.sfx_rules.map(({ event, sound }) => ({ event, sound }));
    out.sfx = style.card.sound.density;
    if (style.card.engine_settings?.look) out.look = { ...(out.look ?? {}), ...style.card.engine_settings.look };
  }
  for (const k of ["aspect", "voice", "music", "sfx"]) if (script[k] !== undefined) out[k] = script[k];
  delete out.stage;
  delete out.lines;
  delete out.previousDesign;
  return out;
}
