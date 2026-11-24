import { askJson } from "../../claude.js";
import { config } from "../../config.js";
import { readJson } from "../../util.js";
import path from "node:path";
import { PART_NAMES } from "./body.js";
import { guessSubject } from "./engine.js";
import { KITS, kitOf, pickKit } from "./kits.js";
import { DEVICES, deviceList } from "./devices/index.js";
import { STYLE_SCHEMA, ensureNovel, kitStyle, normalizeStyle, principles, sameAxes, styleOf } from "./style.js";

export const settingsFile = path.join(config.root, "assets", "aesthetic.json");
export async function settings() {
  return { series: "Style Notes", signoff: "Save this guide and follow for more style notes.", ...(await readJson(settingsFile, {})) };
}

const WRITER = (s) => `You write the voiceover for "${s.series}": short English reels about men's style for Indian guys (18-30).

HOW IT MUST SOUND (most important):
- Plain, everyday English, the way a friend who knows clothes talks. Simple words a 15-year-old understands. Short sentences (mostly 6-12 words). One idea per sentence.
- Say the thing directly. No clever wordplay, no riddles, no abstract lines ("the cause is clothes built for standing still", "wrecked by ten"). If a line needs a second read, rewrite it.
- Concrete over clever: name the garment, the colour, the fit, the number. Point at the visuals: "like this", "look how he's wearing...", "see this?".
- Calm and confident, never hype. A little warmth is fine; no jokes that need explaining.

Here is how the benchmark actually talks (copy the TONE and the simple sentence style, never the content):
- "Take a look at these two outfits. Which one looks better to you? You might think this feels slightly off, while this feels more balanced. And one simple reason behind this is colour temperature."
- "Ryan Gosling wore this bold, retro outfit to Comic-Con. Let's recreate it. Start with a plain white tee, like this. For the pants, navy painter pants like these, and tuck the tee in. It makes your legs look longer."
- "This is Will Poulter in 2013, and this is him now. You might think he just grew up, but it's actually these three styling choices."
- "Men, before you buy your next t-shirt, check these four things. First, the collar. Don't just stretch it. Check if it has this neck tape covering the seam."
- "If you like wearing Henleys, here are four outfit ideas you can try. For a formal look, try a long sleeve navy Henley with relaxed formal trousers, a leather belt and black tassel loafers."

Substance (what makes people save it):
- Real, specific, useful: the simple why, numbers people can use (10-12 stitches per inch, one break), a test they can do in a trial room or mirror.
- Indian context where it matters (heat, Indian skin tones and body types, budgets, weddings, office, festivals), in English. Never a Hindi word.
- Brand names only for famous, widely available basics as examples; no claims about brands.

Pick the ONE shape that fits the topic best (each has its own way of talking; don't force everything into First/Second/Third):
- guide: "Men, if <problem>, follow this simple guide." then "First, ..." / "Second, ..." / "And finally, ..." (2-4 sections).
- which-looks-better: "Take a look at these two outfits. Which one looks better?" then the ONE simple reason, then 2-3 quick examples of it ("Look how he's wearing... swap it with... and it just works.").
- quality-check: "Before you buy your next <item>, check these <n> things." then each check: where to look, what good looks like, the red flag.
- one-item-n-ways: "If you like wearing <item>, here are <n> ways to style it." then "For a <occasion> look, try ..." listing the pieces.
- recreate: "<Person> wore this to <place>. Let's recreate it." then "Start with ... For the pants ... Next ... Finally ..." (only real public looks; the creator adds the photo).
- glow-up: "This is <person> then, and this is him now. ... it's actually these <n> changes." then each change and why it works (real public figures only).
- fix-one-problem: name a problem he has felt, the simple reason, then the fixes ("So try this...").
- own: a structure of your own when none of these fits the topic well (a myth vs truth, a "3 mistakes", a story, a day-to-night...). Still plain, still one clear idea.

Write for the visuals: every line must be showable with our ONE model in different outfits, product shots, colour swatches, a close-up, or a real photo/clip the creator adds (a celebrity's outfit, street style, a real event). Real people only when the shape needs them; never invent facts about them.

Hook: the first line, at most 12 words, plain and direct: who it's for or the problem, and the payoff. Use the shape's opener pattern in your own words.
Flow: it should sound like one person talking, not a list being read. No spoken numbering ("One.", "Two.", "And five."), and don't chop each point into three tiny lines (problem / look / fix): let the problem flow into its fix in one or two natural sentences ("Pants that are too long bunch up on your shoes. Get them shortened so they just touch your shoes."). Numbers can be on screen, never in the voice.
No filler: each point is the problem, what to look at, and ONE short fix sentence. No padding lines around a fix (no "Take them to a tailor." then "For about a hundred rupees, they'll...", no prices, no "Check this in the trial room before you buy", no second tip tacked on). If a line only repeats or decorates, cut it.
Ending: the last line is exactly "${s.signoff}" (for one-item-n-ways, recreate or anything that recommends products, you may instead end with "Comment <KEYWORD> for all the links." and set comment_keyword).

Length: 100-150 spoken words (35-55 seconds). Never more than 160.
Lines: write the whole voiceover as one natural paragraph first, then cut it into lines at sentence or clause breaks, 3-14 words each. For each line, "on_screen" is a short plain note of what we see then.
Also give "series_title": a short name for the reel's contents page or cover ("Garba Night Guide", "Colour Pairing Guide", "Quick Quality Check").`;

export const LINES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "angle", "shape", "facts", "hook_options", "paragraph", "series_title", "comment_keyword", "lines"],
  properties: {
    title: { type: "string" },
    angle: { type: "string", description: "Why guys will save or send this" },
    shape: { type: "string", enum: ["guide", "which-looks-better", "quality-check", "one-item-n-ways", "recreate", "glow-up", "fix-one-problem", "own"] },
    facts: { type: "array", items: { type: "string" }, description: "The specific, non-obvious things it teaches, written first" },
    hook_options: { type: "array", items: { type: "string" } },
    paragraph: { type: "string" },
    series_title: { type: "string" },
    comment_keyword: { type: "string", description: "Only if the ending asks for a comment; else \"\"" },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["voiceover", "on_screen", "beat"],
        properties: {
          voiceover: { type: "string" },
          on_screen: { type: "string" },
          beat: { type: "boolean", description: "true on the last line of each point (after its fix or payoff), where the picture needs a short pause to land before the next point; false otherwise and on the last line" },
        },
      },
    },
  },
};

const MAX_WORDS = 160;

export function hardLines(script) {
  return script.lines
    .map((l) => l.voiceover)
    .filter((v) => {
      const sentences = v.split(/(?<=[.?!])\s+/);
      const longest = Math.max(...sentences.map((x) => x.split(/\s+/).length));
      const longWords = v.split(/\s+/).filter((w) => w.replace(/[^a-z]/gi, "").length >= 10).length;
      return longest > 16 || longWords >= 2 || /;/.test(v);
    });
}
const words = (s) => s.lines.reduce((n, l) => n + l.voiceover.split(/\s+/).filter(Boolean).length, 0);

function textScript(raw, topic, extra = {}) {
  return {
    format: "aesthetic",
    stage: "text",
    approved: false,
    topic,
    title: raw.title,
    angle: raw.angle,
    shape: raw.shape,
    facts: raw.facts,
    series_title: raw.series_title,
    comment_keyword: raw.comment_keyword ?? "",
    lines: raw.lines.map((l) => ({ voiceover: String(l.voiceover).trim(), on_screen: String(l.on_screen ?? "").trim(), ...(l.beat && { beat: true }) })).filter((l) => l.voiceover),
    ...extra,
  };
}

async function recentAesthetic(exclude = null) {
  const fs = await import("node:fs/promises");
  const out = [];
  for (const slug of await fs.readdir(config.packsDir).catch(() => [])) {
    if (slug === exclude) continue;
    const file = path.join(config.packsDir, slug, "script.json");
    const s = await readJson(file);
    if (s?.format !== "aesthetic" || !s.lines?.length) continue;
    const st = await fs.stat(file);
    out.push({ title: s.title, shape: s.shape, hook: s.lines[0].voiceover, model: s.model?.description ?? "", kit: s.scenes ? s.kit || (s.look === "paper" ? "file" : "studio_guide") : "", style: s.scenes ? styleOf(s) : null, made: st.birthtimeMs || st.mtimeMs });
  }
  return out.sort((a, b) => b.made - a.made).slice(0, 8);
}

export async function writeScript({ topic, notes = "" }) {
  const s = await settings();
  const recent = await recentAesthetic();
  const task = [
    `Write the reel about: ${topic}`,
    notes && `Creator's notes: ${notes}`,
    recent.length && `Recent reels on this channel, newest first (use a DIFFERENT shape from the last two, and a different hook pattern):\n${recent.map((r) => `- "${r.title}" (${r.shape}): ${r.hook}`).join("\n")}`,
  ].filter(Boolean).join("\n\n");
  let script = textScript(await askJson({ system: WRITER(s), task, schema: LINES_SCHEMA, effort: "high" }), topic, notes ? { notes } : {});
  if (words(script) > MAX_WORDS) script = await reviseScript(script, `Too long (${words(script)} words). Cut to 130-150 words: keep the hook, every section's key fact and the ending.`);
  const hard = hardLines(script);
  if (hard.length) script = await reviseScript(script, `Make these lines plain and simple, the way a friend says it out loud (short sentences, everyday words, no clever phrasing):\n${hard.map((l) => `- "${l}"`).join("\n")}`);
  return script;
}

export async function reviseScript(script, notes) {
  const s = await settings();
  const task = [
    `Revise this reel script about "${script.topic ?? script.title}". Fix what the creator says; keep what works. Return the complete script.`,
    `Creator's notes (top priority):\n${notes || "Make it flow more naturally and teach something more specific."}`,
    `Current script (${script.shape ?? ""}):\n${script.lines.map((l, i) => `${i + 1}. ${l.voiceover}   [we see: ${l.on_screen}]`).join("\n")}`,
  ].join("\n\n");
  const raw = await askJson({ system: WRITER(s), task, schema: LINES_SCHEMA, effort: "high" });
  const keep = {};
  for (const k of ["voice", "music", "results", "previousPlan", "notes"]) if (script[k] !== undefined) keep[k] = script[k];
  if (script.stage !== "text" && script.scenes) keep.previousPlan = { model: script.model, outfits: script.outfits, items: script.items };
  return textScript(raw, script.topic ?? script.title, keep);
}

const KINDS = ["pill", "note", "dot", "box", "shift", "photo", "product", "scale", "device", "isolate", "sweep", "trace", "recolour", "texture", "vguide", "hguide", "zoom", "swap", "swatch", "item"];
const SCENE_TYPES = ["title", "index", "chapter", "look", "compare", "swatches", "build", "reference", "beforeafter", "product", "outro", "concept", "palette"];

export const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["style", "invent", "look", "subject", "model", "outfits", "items", "media", "scenes", "cover", "caption", "hashtags"],
  properties: {
    style: STYLE_SCHEMA,
    invent: {
      type: "object",
      additionalProperties: false,
      description: "At most ONE new animation device this reel needs and the engine doesn't have yet (it gets built and tested before rendering). wanted false when the existing ones are enough.",
      required: ["wanted", "id", "name", "description", "used_for"],
      properties: {
        wanted: { type: "boolean" },
        id: { type: "string", description: "snake_case id; use it in overlays as { kind: device, item: <id> }" },
        name: { type: "string" },
        description: { type: "string", description: "Exactly what it draws and how it moves (shapes, where on the body, timing), quiet and premium" },
        used_for: { type: "string" },
      },
    },
    look: { type: "string", enum: ["studio", "paper"] },
    subject: { type: "string", enum: ["top", "full"], description: "top: the reel is about shirts, tees, jackets, collars, sleeves (camera frames him head to knees, 30% closer); full: trousers, shoes, whole outfits (head to toe)" },
    model: {
      type: "object",
      additionalProperties: false,
      required: ["description"],
      properties: { description: { type: "string", description: "The one man who wears every outfit: age, build, height feel, skin tone, hair, facial hair. Make him different from recent reels' models." } },
    },
    outfits: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "description", "edit_of", "changes", "recolor"],
        properties: {
          key: { type: "string", description: "short lowercase id, e.g. slim_sneakers" },
          description: { type: "string", description: "Head to toe, every piece in its real colour, fabric and fit, including shoes" },
          edit_of: { type: "string", description: "The outfit key this look is an EDIT of (the same photo with only `changes` different), or \"\" for the reel's base look. Looks that appear one after another on screen should be edits of each other, so the change happens in place." },
          changes: { type: "string", description: "Exactly what differs from edit_of, ONE garment (\"the trousers: warm tan pleated chinos instead of grey\"); \"\" for the base" },
          recolor: { type: "string", description: "When the change is ONLY a colour (same garment, new colour): the new colour #RRGGBB. The engine makes this look itself from edit_of, pixel-perfect, no new photo. Else \"\"" },
        },
      },
    },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "label", "description"],
        properties: { key: { type: "string" }, label: { type: "string" }, description: { type: "string", description: "One product, its colour and material, for a clean product photo" } },
      },
    },
    media: {
      type: "array",
      description: "Real photos/clips the creator adds, and the few AI clips; [] when the reel doesn't need any",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "kind", "source", "need", "what", "search", "ai_prompt", "ai_from"],
        properties: {
          need: { type: "string", enum: ["must", "nice"], description: "must: only a real photo/clip can show it (a real person, a real event or crowd, real-world proof the model can't fake); nice: it would add texture but our model can show the point too (the scene falls back to the model when it isn't added)" },
          key: { type: "string", description: "short lowercase id, e.g. gosling_comiccon, street_linen, walk_in" },
          kind: { type: "string", enum: ["photo", "clip"] },
          source: { type: "string", enum: ["real", "ai"], description: "real: a real photo/clip the creator finds; ai: a short AI video (only for clips)" },
          what: { type: "string", description: "Exactly what it must show, so the creator picks the right one (who/what, framing, setting, vertical)" },
          search: { type: "string", description: "real: search words for Pinterest (photos) or Pexels/YouTube (clips); ai: \"\"" },
          ai_prompt: { type: "string", description: "ai: the image-to-video prompt (camera move, motion, 4-6 s, vertical, studio light); real: \"\"" },
          ai_from: { type: "string", description: "ai: the outfit key whose photo the creator attaches as the first frame (keeps it the same man); else \"\"" },
        },
      },
    },
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "lines", "start_word", "title", "outfit", "outfit2", "number", "thumb", "focus", "file", "reference", "reference2", "clip", "motion", "sections", "overlays"],
        properties: {
          type: { type: "string", enum: SCENE_TYPES },
          lines: { type: "array", items: { type: "integer" }, description: "0-based indexes of the consecutive lines this scene covers" },
          start_word: { type: "string", description: "Only to start mid-line (the index, cutting in on the hook's second half): the ONE word it starts on; the previous scene shares that line. Else \"\"" },
          title: { type: "string", description: "beforeafter: the two labels \"2013|Now\"; product: the check's wide heading (NECK TAPE); title/index/outro: the heading; chapter: one or two words (EVERYDAY); compare: the question; build: the big section word (FORMAL)" },
          outfit: { type: "string", description: "outfit key on screen (left one in compare); \"\" if none" },
          outfit2: { type: "string", description: "compare: the right outfit key; else \"\"" },
          number: { type: "integer", description: "chapter number; 0 otherwise" },
          thumb: { type: "string", description: "chapter: outfit or item key for the pill thumbnail; product: the item key it shows; else \"\"" },
          focus: { type: "string", enum: ["face", "torso", "legs", "feet"], description: "chapter: which part of the outfit the blurred close-up shows" },
          file: { type: "string", description: "build: tiny file tag above the big word, e.g. \"File 002 · Henley\"; else \"\"" },
          reference: { type: "string", description: "reference: the media key it shows full screen; else \"\"" },
          reference2: { type: "string", description: "beforeafter: the media key of the 'now' photo (reference = the 'before'); else \"\"" },
          clip: { type: "string", description: "chapter: a media key (clip) for its moving background, or \"\" (it then moves the outfit photo itself); else \"\"" },
          motion: { type: "string", description: "look/build scenes whose words are about a MOVEMENT (dance, spin, walk, sit, raise arms, roll a sleeve): the ai clip key of our model doing it; the still scene stands in until the creator adds it. Else \"\"" },
          sections: {
            type: "array",
            description: "index/outro only: the guide's sections, each with 1-3 outfit keys",
            items: { type: "object", additionalProperties: false, required: ["header", "outfits"], properties: { header: { type: "string" }, outfits: { type: "array", items: { type: "string" } } } },
          },
          overlays: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "at_word", "text", "status", "part", "to_part", "side", "target", "item", "color"],
              properties: {
                kind: { type: "string", enum: KINDS },
                at_word: { type: "string", description: "ONE word exactly as spoken in this scene's lines; the overlay appears as it's said" },
                text: { type: "string", description: "pill: 1-3 words; note: 2-5 words (use \\n for a line break); swatch/item: a short label; else \"\"" },
                status: { type: "string", enum: ["none", "good", "bad"] },
                part: { type: "string", enum: PART_NAMES },
                to_part: { type: "string", enum: ["", ...PART_NAMES], description: "shift only: the WRONG spot (part = the right spot); else \"\"" },
                side: { type: "string", enum: ["left", "right", "center"] },
                target: { type: "string", description: "swap: the outfit key it changes to; swatch: the outfit key a click on it switches to (or \"\")" },
                item: { type: "string", description: "swatch/item: the item key to show (or \"\" for a plain colour swatch); photo: the media key (a photo); device: the device id" },
                color: { type: "string", description: "swatch without an item: #RRGGBB; else \"\"" },
              },
            },
          },
        },
      },
    },
    cover: {
      type: "object",
      additionalProperties: false,
      required: ["kicker", "title", "sub", "image_prompt", "uses_model", "title_position", "line1", "line2", "outfit"],
      properties: {
        kicker: { type: "string", description: "Tiny tracked caps above the title: the series or type (THIS WITH THAT, DRIP TIPS, GARBA 101, FITCHECK, EP 03)" },
        title: { type: "string", description: "The cover title, 2-4 punchy words that make people tap (\"Jacket Hack\", \"Jeans & Shoes\", \"3 Kurta Looks\")" },
        sub: { type: "string", description: "Optional tiny line under the title (a name, \"GOLD VS SILVER\"); else \"\"" },
        image_prompt: { type: "string", description: "The HERO image that fills the whole cover, magazine style: a tight crop of the subject (a collar and placket, jeans cuffed over loafers, a stack of folded kurtas, a fabric close-up, an arranged flat lay), its lighting and background (dark and moody or clean studio), and where the calm space for the title is. Never a small full-body model on a plain page. Low-key light (deep shadows, muted rich tones, never bright flat colour filling the frame); the picture IS the topic (3 looks -> the three pieces folded in a stack or laid out; shoes -> the shoes close; a fit -> the garment's detail). No mouths or half faces: either no face at all, or a proper portrait. The middle of the frame calm (fabric or shadow, not buttons or a busy print) for a white title." },
        uses_model: { type: "boolean", description: "true if the hero shows our model (then it's made with his photo as the reference)" },
        title_position: { type: "string", enum: ["center", "lower", "upper"] },
        line1: { type: "string", description: "legacy: \"\"" },
        line2: { type: "string", description: "legacy: \"\"" },
        outfit: { type: "string", description: "the outfit that best sells the topic (used for the fallback crop)" },
      },
    },
    caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
  },
};

const DIRECTOR = `You are the art director and motion designer of a men's style channel. You turn an approved English voiceover into the reel's own visual design (style) and a scene plan for our engine. You have full creative control: every reel should have its own look and its own signature device, designed for its topic. One page for the whole reel, ONE model (the same man in every outfit), real photos/clips where they prove the point, and small precise graphics that appear exactly as the words are said.

Scenes (each covers one or more consecutive lines, in order, together covering every line exactly once):
- title: the hook line. The heading (a short question or promise, e.g. "Broader Frame?", "Wearing Baggy Jeans?") over the model in the outfit that shows the problem or the topic.
- index: the guide's contents, cutting in during the hook (guides and quality checks, always): same line as the title scene, starting on the word that introduces the guide (start_word, e.g. "follow" in "Men, if ..., follow this simple guide."), heading = series title ("Shoe Guide 101"), sections = "01/ Everyday" style headers, each with 1-3 outfit keys. Skip it for which-looks-better.
- chapter: a section opener line ("First, the sneakers."), drawn in the FORMAT's chapter style (title = one or two words; focus = which part of the outfit a footage-style card shows; clip = a media clip for it when real or AI footage would help).
- look: the model with explanations (the default scene).
- compare: two outfits side by side (which-looks-better, or right vs wrong): outfit (left) and outfit2 (right).
- concept: the ONE idea said plainly, full page, no model: title = the short headline ("It's the fit."), and pill overlays for the 2-4 things it breaks into (SHOULDERS, SLEEVES, LENGTH), each on the word that introduces them.
- swatches: model on the left with colour or product cards on the right; a cursor clicks one to change the outfit. Two modes: OPTIONS (cards without swaps, sliding in as a list), or a LEGEND being built (each card has a target and a swap: it lands on top of the stack, the cursor clicks it and ONE piece of the outfit changes; a pill above the stack names that card's role, e.g. LEAD -> SUPPORT -> ADD-ON). Use the legend to show a ratio or a combination by building it (lead = the biggest piece, support = the second, guest = a small accessory).
- build: the paper look, for one-item-n-ways: big section word (FORMAL), file tag, the outfit's pieces appearing one by one in a column (item overlays) next to the model.
- reference: a real photo or clip full screen (media key in reference), with camera corners; pill and colour swatch overlays work on it (swatches show as a palette row at the bottom). Use it for real people (celebrity outfits), real street style, real places and occasions, and "this is how it looks in real life" moments.
- beforeafter: before and now side by side (glow-ups, then vs now): reference + reference2 media keys (or outfit + outfit2), title "2013|Now".
- product: the ITEM itself big on the page (thumb = item key), for quality checks and detail talk: zoom, dot, note, hguide (a stitch line), pill work on its parts (collar, shoulders, sleeve, cuff, chest, hem).
- outro: the ending line: heading "Save this Guide" (or similar) with the same sections as the index; for non-guides, an outro with 2-4 of the reel's best outfits in one section.

Real photos and clips (media): good reels mix the studio model with real-world proof. NEVER force them: when our model in the right outfit can show the point (a long vs short kurta, a fit, a colour, shoes), use the model. Plan 0-4 media slots, only where real media makes the point land better than the model can, and mark each one "must" (only real media can show it: a real person, a real event or crowd) or "nice" (the model could show it too). Every reference scene still sets an outfit and overlays that make sense on the model, because a "nice" scene falls back to the model when the creator doesn't add the media:
- source real, kind photo: Pinterest-style photos (a celebrity's look, street style, an outfit in a real setting); give exact search words.
- source real, kind clip: real footage (an event clip, a street walk, a fabric close-up); search words for Pexels or YouTube.
- AI clips of OUR model (source ai, kind clip, need "must"): the creator makes them in Gemini from the outfit photo (ai_from), so ask ONLY where the point is a movement a still can't show: the line asks the viewer to DO something or says what happens when he moves ("raise both arms, like this", "sit down and check the gap", "longer ones catch your legs when you spin", "the easiest shoes to dance in", a hook about dancing). Put the key in that scene's motion field (keep the scene's type, outfit and pill; the still scene stands in until it's added). At most 2 per reel; none when nothing moves. Never a dance routine, never flashy: one small natural movement that shows the clothes. Never just for decoration, never of a real person.
  ai_prompt: one or two plain sentences of exactly what he does in 4-8 s, what the camera does (still, full body, unless it's a close-up of the feet or the sleeve), and what the viewer must SEE (the long hem wrapping round his legs mid-spin; the sneakers gripping as he turns). Same studio, no props unless the line needs one (a plain stool to sit).
Use them in reference scenes (full screen), as a chapter card's clip, or as a photo overlay beside the model ("like this"). Never AI images or videos of real people.

Overlays (on look, title, compare, swatches, build scenes), each appearing on its at_word:
- pill: a short label at the top in mono caps, status good (green tick) / bad (red cross) / none. In compare, side left/right puts it over that model.
- note: a handwritten 2-5 word note with a thin arrow to a body part (part + side).
- dot: a glowing red dot on a problem spot (part + side).
- box: a soft grey highlight box over a region of the body (part: chest = the whole top half, waist, thighs...) for lines about an area or proportion ("top heavy", "too much fabric here"); it fades after a beat.
- photo: a real photo (item = its media key, kind photo) in a framed card sliding in beside the model (he steps aside), text = a 1-3 word caption ("street style", "Ryan Gosling"). For "this is how it looks in real life" lines.
- sweep: a soft iridescent glow rising through ONE garment on the model (part chest = the top, thighs = the bottoms, feet = the shoes), inside the garment only, as the line names that piece ("The jacket is a cropped red denim..."). Builds do this automatically for each piece.
- trace: a thin line draws around ONE garment's outline: for fit and shape lines ("one straight line from waist to ankle", "short and boxy").
- recolour: the garment takes another colour live (color "#RRGGBB"), its folds and light kept: to show an alternative without a new outfit ("or try it in olive").
- texture: a fine weave of light lines spreads through the fabric: for fabric, weave and stitch talk.
- Use each of these garment effects ONCE or twice per reel, for the moment it explains best; repeated sections get different devices, never the same trick everywhere.
- isolate: colour isolation on the model: everything except ONE piece (part chest = the top, thighs = the bottoms, feet = the shoes) and his face fades to soft grey. For colour-balance lines ("one bright piece, everything else plain", "let the shoes be the only colour"). Much stronger than swatches for that idea.
- scale: the two-ended gradient bar at the top: text "Warm|Cool|0.25" (left label|right label|where the marker lands, 0-1), color "#F08A5D|#8FB4F0" (the two ends). For a spectrum idea: warm vs cool, plain vs loud, slim vs relaxed.
- product: a product card (item key + its name in text) popping beside a body part (part) with a leader line: the key piece of a recreated look ("tassel loafers" at the feet).
- device: an animation plugin (item = its id; part/to_part/side/text as the device says). Devices the engine has:
DEVICE_LIST
  You may invent ONE new device for this reel (the "invent" field) when its signature idea needs a movement none of the above can show; describe it precisely and use its id in overlays. Invent only what explains something.
- shift: right spot vs wrong spot for a POSITION rule (seam on the shoulder bone not down the arm: part shoulders, to_part sleeve; cuff at the wrist not the knuckles; hem at mid-fly not the thighs): a green tick on part, a dashed arrow to a red cross on to_part, optional 2-4 word note in text. Use it whenever the line says something sits too high/low/long; it reads even when the photos are similar.
- vguide: dashed lines down the outside of the legs (shows the leg line / taper). hguide: a dashed line across a part (shoulders, waist) to show width.
- zoom: (text "ring" adds a dashed circle around a TINY detail like stitches or a collar gap; otherwise leave text empty, no circle) the camera pushes into a part to show a detail (hem, collar, feet, sleeve...), holds, and eases back out before the scene ends (so the next shot continues from the same framing). At most one zoom per scene, and give the zoom at least two seconds of words.
- swatch: a card (item photo, or a colour with color #RRGGBB) sliding in on the right; label in text; target = the outfit it switches to (if clicking it should change the outfit); status to mark it.
- swap: the outfit changes in place to target (if a swatch has the same target, the cursor clicks that swatch first).
- item: (build) a product appears in the side column (item key, text = its label or brand-free name).
Rules:
- Something new every 1.5-2.5 seconds (a cut or an overlay), never clutter: at most 3 overlays per scene, one pill per sentence, never a dot and a pill on the same word.
- Visual rhythm: change the SCALE of the frame every 3-4 seconds: full body -> a close-up of the detail the line is about (zoom on fabric, collar, hem, shoes) -> a product shot, swatches, the scale bar or a device -> back to full body. Never more than two plain full-body model scenes in a row; a line about fabric gets a fabric close-up, a line about shoes shows the shoes big.
- The frame shows what the words say, literally: if the line says "longer ones", the screen shows a longer one (add that outfit); if it says "white sneakers", we see white sneakers; "like this" points at something that is actually on screen. Add an outfit rather than reuse one that doesn't fit the line.
- Calm flow: a scene covers at least 5 spoken words (about 2 seconds); never more than one outfit change in 3 seconds. Keep the same outfit across consecutive scenes when the lines are about the same look (it plays as one continuous shot); change outfits only when the point changes.
- A graphic needs at least 1.2 seconds on screen: don't put one on the last word or two of a scene.
- Don't zoom without a reason: a zoom is for a detail too small to see at full body (collar gap, stitching, cuff, hem break); never zoom on a part that's already big in the frame.
- When an outfit changes in place (swap), the previous labels clear; don't repeat a label for the new outfit unless it says something new.
- at_word must be ONE word that is actually spoken in that scene's lines (copy it exactly), the word the overlay illustrates.
- Same man, consistent: describe him once in model.description (age 22-30, a specific build, skin tone, hair, facial hair); every outfit description is only the clothes and shoes. At most 8 outfits and 6 items; reuse outfits across scenes instead of inventing near-duplicates.
- In-place changes (our core animation): when the outfit changes on screen, ONLY one garment changes; his face, pose, hands, light and every other piece stay exactly the same, and the new piece dissolves in place (a swap). So design outfits as a family: one base look, and each other look an edit of it (edit_of) changing ONE garment (changes). Prefer a swap on the model over cutting to a new photo whenever the line compares or fixes one piece ("swap the grey trousers for tan", "now the same outfit with loafers").
- The "problem" outfit and the "fixed" outfit should differ only in the thing being taught, so the change reads instantly. Describe the problem EXAGGERATED in the outfit description (e.g. "two sizes too big: shoulder seams 4 inches down the upper arm, body billowing out", "so tight the buttons pull into X creases"): image models soften flaws, and a flaw you can't see at a glance on a phone can't be taught.
- Parts: ${PART_NAMES.join(", ")}. "hem" is the trouser hem at the shoes; "shirt_hem" is where an untucked shirt ends; "cuff" is the shirt cuff at the wrist. side is as seen on screen.
- look: "studio" (light grey seamless) for guides, checks and comparisons; "paper" (off-white dot grid) for one-item-n-ways and build scenes.
- cover: the grid cover, full-bleed style: a full-bleed HERO image (image_prompt: a tight, beautifully lit crop of the subject that makes people stop; the imagery changes every reel) with a tiny tracked kicker and a big heavy serif title over it. The type system is the channel's constant; the picture is what varies.
- caption (English): a first line under 110 characters that makes people tap "more", then 2-4 short lines with the actual advice in searchable words, then a save line; plus 3-5 specific hashtags.`;

export async function direct(script, { recentModels = [], slug = null } = {}) {
  const s = await settings();
  const recent = await recentAesthetic(slug);
  const kitKey = script.kit && KITS[script.kit] ? script.kit : pickKit(script.shape, recent.map((r) => r.kit).filter(Boolean));
  const kit = KITS[kitKey];
  const recentStyles = recent.filter((r) => r.style).slice(0, 3);
  const task = [
    `Plan the reel "${script.title}" (${script.shape}). Series: ${s.series}. Index title: "${script.series_title}".`,
    `What the reference reels taught us (principles: follow the reasons, never copy a reference):\n${principles()}`,
    s.house_style
      ? `HOUSE STYLE (locked: the channel's brand look, the same on every reel; copy these values into the style object exactly): ${JSON.stringify(s.house_style)}. ${s.house_style.note ?? ""} You still choose, to fit THIS content: chapter, index, cover, signature, build_column, tempo, transitions and the idea sentence. Do not borrow anything from earlier reels' looks.`
      : null,
    !s.house_style && `DESIGN THIS REEL'S OWN LOOK (the style object). You have full creative freedom: combine the parts in the style schema into a look that fits THIS topic (its mood, its occasion, its colours). Invent; don't default. Worked examples of good looks learned from references (examples only, not a menu):\n${Object.entries(KITS).map(([k, v]) => `- ${v.name} (${v.from}): ${v.brief}`).join("\n")}\nThe closest worked example for this script shape is "${kit.name}"; use it only as a starting point if it truly fits.`,
    !s.house_style && recentStyles.length && `Recent reels' looks (this one must look clearly different: change the page, the type, the chapter device and the cover at least):\n${recentStyles.map((r) => `- "${r.title}": ${r.style.idea} [page ${r.style.page} ${r.style.texture}, ${r.style.headline_font}, pill ${r.style.pill}, chapter ${r.style.chapter}, index ${r.style.index}, cover ${r.style.cover}]`).join("\n")}`,
    `Scenes must use the devices your style names: chapter scenes only if style.chapter isn't "none", an index scene only if style.index isn't "none".`,
    script.notes && `Creator's notes (what they want, including real photos/clips they plan to add):\n${script.notes}`,
    `The approved lines (0-based):\n${script.lines.map((l, i) => `${i}. ${l.voiceover}   [we see: ${l.on_screen}]`).join("\n")}`,
    recentModels.length && `Recent reels' models (make this man clearly different):\n${recentModels.map((m) => `- ${m}`).join("\n")}`,
    script.previousPlan && `This reel was planned before; keep its model and outfits where the lines still fit:\n${JSON.stringify(script.previousPlan)}`,
  ].filter(Boolean).join("\n\n");
  const plan = await askJson({ system: DIRECTOR.replace("DEVICE_LIST", deviceList() || "  (none yet)"), task, schema: PLAN_SCHEMA, effort: "high" });
  const { note, ...house } = s.house_style ?? {};
  const style = s.house_style ? { ...normalizeStyle(plan.style, kitStyle(kitKey)), ...house } : ensureNovel(normalizeStyle(plan.style, kitStyle(kitKey)), recentStyles.map((r) => r.style));
  return checkPlan({ ...plan, kit: kitKey, style }, script);
}

const MATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fixes", "new_outfits"],
  properties: {
    new_outfits: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "description"], properties: { key: { type: "string" }, description: { type: "string" } } } },
    fixes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["scene", "problem", "outfit", "use_model", "drop_overlays"],
        properties: {
          scene: { type: "integer", description: "1-based scene number" },
          problem: { type: "string" },
          outfit: { type: "string", description: "the outfit key it should show (existing or new), or \"\" to keep" },
          use_model: { type: "boolean", description: "true: a reference scene whose point our model can show; it becomes a model scene (the media slot is dropped if nothing else uses it)" },
          drop_overlays: { type: "array", items: { type: "integer" }, description: "0-based indexes of overlays that contradict the words" },
        },
      },
    },
  },
};

export async function matchCheck(plan, script, log = () => {}) {
  const outfits = (plan.outfits ?? []).map((o) => `- ${o.key}: ${o.description}`).join("\n");
  const media = new Map((plan.media ?? []).map((m) => [m.key, m]));
  const rows = plan.scenes.map((sc, i) => {
    const words = sc.lines.map((l) => script.lines[l].voiceover).join(" ");
    const shows = sc.type === "reference" ? `real ${media.get(sc.reference)?.kind ?? "photo"} (${media.get(sc.reference)?.need ?? "nice"}): ${media.get(sc.reference)?.what ?? sc.reference}; model fallback: ${sc.outfit}` : `${sc.type}${sc.outfit ? `, outfit ${sc.outfit}` : ""}${sc.outfit2 ? ` vs ${sc.outfit2}` : ""}${sc.title ? `, title "${sc.title}"` : ""}`;
    const ovs = (sc.overlays ?? []).map((o, k) => `[${k}] ${o.kind}${o.text ? ` "${o.text.replace(/\n/g, " ")}"` : ""}${o.item ? ` ${o.item}` : ""}${o.target ? ` -> ${o.target}` : ""} on "${o.at_word}"${o.part ? ` (${o.part})` : ""}`).join("; ");
    return `${i + 1}. SAYS: "${words}"\n   SHOWS: ${shows}${ovs ? `\n   GRAPHICS: ${ovs}` : ""}`;
  });
  const res = await askJson({
    system: "You check a planned style reel frame by frame: does what's on screen show exactly what the voice says at that moment? You are strict about literal matches (the garment, its length, colour, fit, shoes, the 'like this' moment) and against forcing real photos or clips where the studio model in the right outfit can show the point. Only real people, real events/crowds and real-world proof need real media. Fix only real problems; return no fix for a scene that already matches.",
    task: `Outfits (each is one photo of the same model):\n${outfits}\n\nScenes:\n${rows.join("\n")}\n\nList the fixes. If a scene needs an outfit that doesn't exist (e.g. a long kurta to show 'longer ones'), add it to new_outfits (same model; describe head to toe, changing only what the line is about) and use its key.`,
    schema: MATCH_SCHEMA,
    effort: "high",
  });
  const keys = new Set(plan.outfits.map((o) => o.key));
  for (const o of res.new_outfits ?? []) if (o.key && !keys.has(o.key) && plan.outfits.length < 9) {
    plan.outfits.push(o);
    keys.add(o.key);
  }
  for (const f of res.fixes ?? []) {
    const sc = plan.scenes[f.scene - 1];
    if (!sc) continue;
    if (f.outfit && keys.has(f.outfit)) sc.outfit = f.outfit;
    if (f.use_model && sc.type === "reference") {
      sc.type = "look";
      sc.reference = "";
    }
    const drop = new Set(f.drop_overlays ?? []);
    if (drop.size) sc.overlays = (sc.overlays ?? []).filter((_, k) => !drop.has(k));
    log(`  Scene ${f.scene}: ${f.problem.slice(0, 140)}`);
  }
  const used = new Set(plan.scenes.flatMap((sc) => [sc.reference, sc.reference2, sc.clip, sc.motion, ...(sc.overlays ?? []).filter((o) => o.kind === "photo").map((o) => o.item)].filter(Boolean)));
  plan.media = (plan.media ?? []).filter((m) => used.has(m.key));
  return { plan, fixes: res.fixes ?? [], added: res.new_outfits ?? [] };
}

export async function inventDevices(plan, log = () => {}) {
  const inv = plan.invent;
  const usedIds = new Set((plan.scenes ?? []).flatMap((sc) => (sc.overlays ?? []).filter((o) => o.kind === "device").map((o) => o.item)));
  let built = null;
  if (inv?.wanted && inv.name && !DEVICES[inv.id]) {
    log(`Inventing a new animation for this reel: ${inv.name}`);
    const { buildDevice } = await import("./devices/smith.js");
    built = await buildDevice({ ...inv, sample_cue: (plan.scenes ?? []).flatMap((sc) => sc.overlays ?? []).find((o) => o.kind === "device" && o.item === inv.id) }, log).catch((err) => (log(`  couldn't build it (${err.message.slice(0, 120)})`), null));
    if (built && built !== inv.id) for (const sc of plan.scenes) for (const o of sc.overlays ?? []) if (o.kind === "device" && o.item === inv.id) o.item = built;
  }
  for (const sc of plan.scenes ?? []) sc.overlays = (sc.overlays ?? []).filter((o) => o.kind !== "device" || DEVICES[o.item]);
  return { plan, built, missing: [...usedIds].filter((id) => !DEVICES[id] && id !== built) };
}

const MOVES = [
  [/\b(spin|spins|spinning|twirl\w*|turn around)\b/i, "spin", "He turns around once on the spot at an easy, natural speed, arms relaxed, so the kurta hem swings out with the turn and settles against his legs as he faces the camera again."],
  [/\b(walk|walks|walking|stride)\b/i, "walk", "He takes two relaxed steps toward the camera and stops, the clothes moving naturally with each step."],
  [/\b(sit|sits|sitting) down\b|\bsit\b.*\bcheck\b/i, "sit", "He sits down on a plain low stool and looks down at his clothes."],
  [/\b(raise|lift) (both |your )?arms\b|\barms up\b/i, "arms_up", "He slowly raises both arms straight up over his head, holds for a second, and lowers them."],
  [/\b(dance in|to dance in|dancing in)\b/i, "step", "He shifts his weight and takes one easy step to the side and back, light on his feet, the shoes flexing naturally. A calm, small movement, not a dance."],
];
function motionClips(plan, script, scenes) {
  const ai = () => plan.media.filter((m) => m.source === "ai");
  for (const sc of scenes) {
    if (sc.motion || !sc.outfit || !["look", "build"].includes(sc.type) || ai().length >= 2) continue;
    let move, prompt, text;
    for (const i of sc.lines) {
      const hit = MOVES.find(([re]) => re.test(script.lines[i].voiceover));
      if (hit) [, move, prompt] = hit, (text = script.lines[i].voiceover);
      if (hit) break;
    }
    if (!move) continue;
    const feet = sc.focus === "feet" || /\b(shoes?|sneakers?|sandals?|loafers?|boots?|feet)\b/i.test(text);
    const key = `${sc.outfit}_${move}`;
    if (plan.media.some((m) => m.key === key)) continue;
    plan.media.push({
      key,
      kind: "clip",
      source: "ai",
      need: "must",
      what: `Our model moving, for the line: "${text}"`,
      search: "",
      ai_prompt: prompt,
      ai_from: sc.outfit,
      frame: feet ? "feet" : "full",
    });
    sc.motion = key;
  }
  for (const sc of scenes) {
    const m = plan.media.find((x) => x.key === sc.motion);
    if (m && !m.frame) m.frame = sc.focus === "feet" ? "feet" : "full";
  }
}

const COLOURS = { black: "#1E1E1E", charcoal: "#3A3B3D", grey: "#9A9B9C", gray: "#9A9B9C", "light grey": "#C9CACB", "pale grey": "#D3D3D1", "light-grey": "#C9CACB", white: "#F2F2EE", "off-white": "#EDE8DC", cream: "#EEE4CF", ivory: "#EFE8D6", beige: "#D4BE98", sand: "#CDB48E", tan: "#C19A6B", khaki: "#B9A57E", camel: "#B88A55", brown: "#7A4E2D", "mid-brown": "#7A4E2D", "dark brown": "#4E3220", chocolate: "#4A3020", rust: "#B5532F", maroon: "#6E1F2A", burgundy: "#6A1E2C", red: "#B3262E", mustard: "#D1A437", yellow: "#E3C04B", olive: "#6B6B3A", sage: "#9AA88A", green: "#4E7A55", "bottle green": "#1F4D3A", teal: "#2F7A7A", navy: "#1F2A44", blue: "#3C64A0", "light blue": "#A9C4E2", "sky-blue": "#A9C4E2", "sky blue": "#A9C4E2", denim: "#4A6A93", lilac: "#B9A6D4", pink: "#E3A9B6" };
function colourOf(text) {
  const t = String(text ?? "").toLowerCase().split(/\binstead of\b/)[0];
  const hits = Object.keys(COLOURS).filter((c) => new RegExp(`\\b${c.replace(/[-\s]/g, "[-\\s]")}\\b`).test(t)).sort((a, b) => b.length - a.length);
  return hits[0] ? COLOURS[hits[0]] : null;
}
const SHAPE_WORDS = /\b(cut|slim|wide|baggy|straight|pleated|cropped|long|short|length|fit|collar|sleeve|layer|add|chunky|loafer|derby|sneaker|boot|sandal|chino|jean|polo|tee|blazer|jacket|kurta)\b/i;
function inPlace(plan, script, scenes) {
  const outs = plan.outfits ?? [];
  const byKey = new Map(outs.map((o) => [o.key, o]));
  for (const o of outs) {
    if (!o.edit_of || /^#[0-9a-f]{6}$/i.test(o.recolor ?? "")) continue;
    const said = String(o.changes ?? "");
    const before = said.split(/\binstead of\b/i)[1] ?? "";
    const garment = (x) => (x.match(SHAPE_WORDS) ?? [])[0]?.toLowerCase();
    const sameGarment = !before || !garment(said) || garment(said) === garment(before) || /\bsame (cut|shape|fit)\b/i.test(said);
    const card = scenes.flatMap((sc) => sc.overlays ?? []).find((x) => x.kind === "swatch" && x.target === o.key && /^#[0-9a-f]{6}$/i.test(x.color ?? ""));
    const hex = card?.color ?? colourOf(said);
    if (sameGarment && hex) o.recolor = hex;
  }
  let shown = null;
  for (const sc of scenes) {
    const o = byKey.get(sc.outfit);
    const swaps = (sc.overlays ?? []).filter((x) => x.kind === "swap");
    if (["look", "swatches"].includes(sc.type) && o?.edit_of && shown && o.edit_of === shown) {
      const words = sc.lines.flatMap((l) => script.lines[l].voiceover.split(/\s+/)).map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, "")).filter(Boolean);
      const card = (sc.overlays ?? []).find((x) => x.kind === "swatch" && x.target === o.key);
      const key = String(o.changes ?? "").toLowerCase().split(/\binstead of\b/)[0];
      const named = (w) => w.length > 2 && new RegExp(`\\b${w.toLowerCase()}`).test(key) && (COLOURS[w.toLowerCase()] || SHAPE_WORDS.test(w) || /^(shirt|shirts|trousers|pants|shoes|tee|top)$/i.test(w));
      const colourWord = (w) => Object.keys(COLOURS).some((c) => c.split(/[-\s]/).includes(w.toLowerCase())) && new RegExp(`\\b${w.toLowerCase()}`).test(key);
      const hit = card?.at_word || words.find(colourWord) || words.find(named) || words.find((w) => w.length > 3) || words[0];
      sc.outfit = shown;
      if (!swaps.some((x) => x.target === o.key)) sc.overlays = [...(sc.overlays ?? []), { kind: "swap", at_word: hit, text: "", status: "", part: "chest", to_part: "", side: "center", target: o.key, item: "", color: "" }];
      if (!card && o.recolor) {
        const verdict = (sc.overlays ?? []).find((x) => x.kind === "pill" && x.status)?.status ?? "";
        const name = Object.keys(COLOURS).filter((c) => key.includes(c)).sort((a, b) => b.length - a.length)[0] ?? "";
        const sw = (sc.overlays ?? []).find((x) => x.kind === "swap" && x.target === o.key);
        sc.overlays.push({ kind: "swatch", at_word: sw.at_word, text: name, status: verdict, part: "chest", to_part: "", side: "center", target: o.key, item: "", color: o.recolor });
      }
    }
    const last = [...(sc.overlays ?? [])].reverse().find((x) => x.kind === "swap" && x.target);
    if (sc.outfit) shown = last?.target ?? sc.outfit;
  }
  const family = outs.some((o) => o.edit_of);
  const outro = scenes.at(-1);
  if (family && outro && ["outro", "index"].includes(outro.type) && shown) {
    const first = script.lines[outro.lines[0]].voiceover.split(/\s+/)[0].replace(/[^\p{L}\p{N}'-]/gu, "");
    Object.assign(outro, { type: "look", outfit: shown, sections: [], overlays: [{ kind: "pill", at_word: first, text: "Better", status: "good", part: "chest", to_part: "", side: "center", target: "", item: "", color: "" }] });
  }
  for (const sc of scenes) {
    sc.overlays = (sc.overlays ?? []).filter((x) => !(x.kind === "zoom" && ["feet", "ankles", "hem", "shoes"].includes(x.part)) && !(x.kind === "scale" && ["look", "swatches", "title", "compare", "build"].includes(sc.type)));
  }
}

export function checkPlan(plan, script) {
  const n = script.lines.length;
  const outfits = new Set(plan.outfits.map((o) => o.key));
  const items = new Set(plan.items.map((o) => o.key));
  plan.media = (plan.media ?? []).filter((m, i, all) => m.key && all.findIndex((x) => x.key === m.key) === i).map((m) => ({ ...m, source: m.kind === "photo" ? "real" : m.source, need: m.need === "must" ? "must" : "nice" }));
  plan.media = [...plan.media.filter((m) => m.source !== "ai").slice(0, 5), ...plan.media.filter((m) => m.source === "ai" && m.kind === "clip").slice(0, 3).map((m) => ({ ...m, need: "must" }))];
  for (const sc of plan.scenes) {
    if (sc.type === "reference" && sc.reference && !plan.media.some((m) => m.key === sc.reference)) plan.media.push({ key: sc.reference, kind: "photo", source: "real", what: sc.title || sc.reference, search: sc.reference.replace(/_/g, " "), ai_prompt: "", ai_from: "" });
  }
  const media = new Map(plan.media.map((m) => [m.key, m]));
  const seen = new Set();
  const scenes = [];
  for (const sc of plan.scenes) {
    const shared = sc.start_word && scenes.length ? scenes.at(-1).lines.at(-1) : -1;
    const lines = (sc.lines ?? []).filter((i) => i >= 0 && i < n && (!seen.has(i) || i === shared)).sort((a, b) => a - b);
    if (!lines.length) continue;
    if (sc.start_word && lines[0] !== shared) sc.start_word = "";
    lines.forEach((i) => seen.add(i));
    const spoken = new Set(lines.flatMap((i) => script.lines[i].voiceover.split(/\s+/)).map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")));
    if (!outfits.has(sc.outfit)) sc.outfit = plan.outfits[0]?.key ?? "";
    sc.clip = sc.type === "chapter" && media.get(sc.clip)?.kind === "clip" ? sc.clip : "";
    sc.motion = sc.type !== "chapter" && media.get(sc.motion)?.source === "ai" ? sc.motion : "";
    if (sc.type === "compare" && !outfits.has(sc.outfit2)) sc.outfit2 = plan.outfits[1]?.key ?? sc.outfit;
    sc.overlays = (sc.overlays ?? [])
      .filter((o, k, all) => o.kind !== "zoom" || all.findIndex((x) => x.kind === "zoom") === k)
      .filter((o) => spoken.has(String(o.at_word).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")))
      .filter((o) => o.kind !== "swap" || outfits.has(o.target))
      .filter((o) => o.kind !== "shift" || PART_NAMES.includes(o.to_part))
      .filter((o) => o.kind !== "photo" || media.get(o.item)?.kind === "photo")
      .map((o) => ({ ...o, item: items.has(o.item) || o.kind === "photo" ? o.item : "", target: outfits.has(o.target) ? o.target : "", status: o.status === "none" ? "" : o.status }))
      .slice(0, 4);
    for (const sec of sc.sections ?? []) sec.outfits = sec.outfits.filter((k) => outfits.has(k) || items.has(k));
    scenes.push({ ...sc, lines });
  }
  for (let i = 0; i < n; i++) {
    if (seen.has(i)) continue;
    const prev = [...scenes].reverse().find((sc) => sc.lines.at(-1) < i) ?? scenes[0];
    prev.lines = [...prev.lines, i].sort((a, b) => a - b);
  }
  scenes.sort((a, b) => a.lines[0] - b.lines[0] || (a.start_word ? 1 : 0) - (b.start_word ? 1 : 0));
  motionClips(plan, script, scenes);
  inPlace(plan, script, scenes);
  const chapters = scenes.filter((sc) => sc.type === "chapter");
  if (["guide", "quality-check", "one-item-n-ways"].includes(script.shape) && (plan.style?.index ?? kitOf(plan).index) !== "none" && chapters.length >= 2 && !scenes.some((sc) => sc.type === "index") && scenes[0]?.type === "title") {
    const hook = script.lines[scenes[0].lines.at(-1)].voiceover.split(/\s+/);
    const at = hook.findIndex((w, i) => i >= 2 && /^(follow|here|here's|these|this|check)/i.test(w));
    const word = hook[at >= 0 ? at : Math.floor(hook.length * 0.55)];
    const sections = chapters.map((ch, k) => {
      const next = chapters[k + 1]?.lines[0] ?? n;
      const looks = [...new Set(scenes.filter((sc) => sc.lines[0] > ch.lines[0] && sc.lines[0] < next).flatMap((sc) => [sc.outfit, sc.outfit2]).filter(Boolean))].slice(0, 3);
      return { header: `${String(k + 1).padStart(2, "0")}/ ${ch.title}`, outfits: looks.length ? looks : [ch.outfit] };
    });
    scenes.splice(1, 0, { type: "index", lines: [scenes[0].lines.at(-1)], start_word: word, title: script.series_title || script.title, outfit: "", outfit2: "", number: 0, thumb: "", focus: "torso", file: "", reference: "", reference2: "", clip: "", motion: "", sections, overlays: [] });
    const outro = scenes.find((sc) => sc.type === "outro");
    if (outro && !(outro.sections ?? []).length) outro.sections = sections;
  }
  const kit = { ...kitOf(plan), ...(plan.style ? { chapter: plan.style.chapter, index: plan.style.index } : {}) };
  if (kit.chapter === "none") {
    for (const sc of scenes) if (sc.type === "chapter") Object.assign(sc, { type: "look", overlays: [{ kind: "pill", at_word: script.lines[sc.lines[0]].voiceover.split(/\s+/)[0].replace(/[^\p{L}\p{N}'-]/gu, ""), text: sc.title, status: "", part: "chest", to_part: "", side: "center", target: "", item: "", color: "" }] });
  }
  if (kit.index === "none") for (let i = scenes.length - 1; i >= 0; i--) if (scenes[i].type === "index" && scenes[i].start_word) scenes.splice(i, 1);
  return { ...plan, subject: plan.subject || guessSubject({ ...plan, topic: script.topic, title: script.title }), scenes };
}
