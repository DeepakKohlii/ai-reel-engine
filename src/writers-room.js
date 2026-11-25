import { withTemplate } from "./templates.js";
import { askJson } from "./claude.js";
import { getFormat, validateScript } from "./script.js";
import { publicSchema } from "./schema-check.js";
import { performanceContext } from "./results.js";

const PASS_SCORE = 9;
const MAX_ROUNDS = 4;
const FULL_REWRITE_BELOW = 8;

const CRITERIA = {
  hook: "First 1-2 beats stop the scroll: one short sentence, a helpful heads-up ('Agli baar baggy jeans pehno, usse pehle ye dekh lo' is the channel's preferred shape), a specific callout or a result they want, an open loop. No greetings, no 'aaj hum baat karenge', no slow setup.",
  rule: "ONE rule, and it lands as a line short and sharp enough to repeat to a friend (under 7 words). Not three half-rules.",
  specificity: "Concrete colours, items, fits, occasions and price ranges. No generic filler ('confidence is key', 'dress well', 'style is personal').",
  proof: "Every claim is shown on screen (wrong vs right, same item two ways, before and after), not just said.",
  retention: "The loop opened in the hook closes only at the payoff, there's a headfake, no dead or repeated beats, and something changes on screen every 1.5-2 seconds, including the ending: any beat over 8 spoken words (often the CTA) is too long and must be split.",
  save_share: "A takeaway worth saving (a formula, a cheat, a list) that people would send to a friend without being asked.",
  flow: "Read ALL the voiceover lines one after another as a single paragraph (it's shown below as 'Heard as'). It must sound like one person casually explaining to a friend: each line leads naturally into the next, simple everyday words, no odd jumps, no line that only makes sense with the picture.",
  language: "Sounds like a sharp 22-year-old Indian stylist talking to a friend, respectfully: always 'tum' (karo, dekho, likho), never 'tu/tere/tera' or bare commands like 'kar', 'kar lo', 'ruk' (each one is a problem to flag). Natural spoken Hinglish the way urban Indian guys actually talk (plenty of everyday English: 'shoes dikh hi nahi rahe', 'fit ekdum off lagta hai'), no hard or bookish Hindi ('tikti hai', 'upar tikti', 'nigal leti'), no forced literal metaphors ('jeans shoe kha jaati hai'), no clipped fragments that sound weird on screen ('shoes gayab lagte hain?'). not textbook Hindi, not cringe, not preachy, easy for the voice to read with good rhythm.",
  accuracy: "The styling advice is actually correct and wouldn't embarrass the channel in front of a real stylist.",
  visuals: "Images match the words beat by beat, models are dressed exactly as described with shoes visible when outfits or bottoms matter, and the imagery is mixed: models in at most ~40% of beats (used for proof), product and prop sticker cutouts, swatches and type-only breathers for the rest, never the same model image in more than two places. Before/after pairs differ only in the thing being taught. Hero styles and layouts vary, slams and stickers are rare enough to hit.",
  cta: "Exactly ONE spoken ask at the end, in the channel's shape: 'Agar tumhe saare X ki list chahiye, toh comments mein KEYWORD likho, main list tumhare DM mein bhej dunga.' Extra tag/share/follow/save lines stacked on top dilute it and count against the score.",
};

const EDITOR = `You are the head of content for a premium faceless Instagram channel about men's style in India ("Style rules" reels: editorial kinetic typography over cutout outfit images, Hinglish voiceover, 25-40 seconds). The channel posts less but every reel must be top-notch, the kind that gets saved, shared and rewatched. You have final say on every script, and you are hard to impress: a 7 is a decent reel, an 8 is good, a 9 is one you'd be proud to post, a 10 is rare.

You review a script against these standards (score each 1-10):
${Object.entries(CRITERIA)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}

How the engine works (don't flag these as problems): model images are always generated full body, head to toe, and the focus setting (full, lower = waist down, upper = chest up) crops that image on screen, so a 'lower' beat with a full-body prompt is correct. Repeating the same model across 2-3 consecutive beats is intentional (the image holds while the words change). Swatches, shades, cards and flow lines are designed graphics, not photos.

Be specific. Point at beat numbers, quote the line, and say exactly what to write instead. Don't list problems that don't matter. Also write 5 alternative opening hooks (the first voiceover line, Hinglish, under 8 words each) using different angles (a mistake callout, a result they want, a contrarian claim, a question, a quick "POV"), and pick the strongest hook overall, which may be the original.`;

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scores", "overall", "verdict", "strengths", "problems", "hooks", "best_hook"],
  properties: {
    scores: {
      type: "object",
      additionalProperties: false,
      required: Object.keys(CRITERIA),
      properties: Object.fromEntries(Object.keys(CRITERIA).map((k) => [k, { type: "number" }])),
    },
    overall: { type: "number", description: "1-10, one decimal" },
    verdict: { type: "string", description: "One or two sentences: is this ready to post, and what's holding it back" },
    strengths: { type: "array", items: { type: "string" } },
    problems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["beat", "problem", "fix"],
        properties: {
          beat: { type: "integer", description: "Beat number, or 0 for the whole reel" },
          problem: { type: "string" },
          fix: { type: "string", description: "Exactly what to change or write instead" },
        },
      },
    },
    hooks: { type: "array", items: { type: "string" } },
    best_hook: { type: "string" },
  },
};

function readable(script) {
  const beats = script.beats.map((b, i) => {
    const v = b.visual ?? {};
    const items = (v.items ?? []).map((it) => it.label).filter(Boolean);
    const shows =
      v.kind === "asset"
        ? `${v.asset_kind} ${v.layout}${v.asset_kind === "model" ? ` (${v.focus || "full"} body)` : ""}: ${v.asset_prompt || v.asset_tags?.join(", ")}`
        : v.kind === "none"
          ? "typography only"
          : `${v.kind} ${v.layout}: ${items.join(", ") || (v.colors ?? []).map((c) => c.name).join(", ")}`;
    return `${i + 1}. "${b.voiceover}"\n   on screen: ${b.text} | ${b.motion} | ${b.theme}\n   shows: ${shows}`;
  });
  return [
    `Title: ${script.title}`,
    `Angle: ${script.angle}`,
    `Type set: ${script.typeset}. Palette: ${(script.palette ?? []).map((p) => `${p.name} ${p.bg}/${p.accent}`).join(", ")}`,
    script.sticker && `Sticker: "${script.sticker.text}" at beat ${script.sticker.beat}`,
    `Comment keyword: ${script.comment_keyword}`,
    "",
    `Heard as (the whole voiceover in one go):\n"${script.beats.map((b) => b.voiceover).join(" ")}"`,
    "",
    ...beats,
  ]
    .filter((x) => x != null && x !== false)
    .join("\n");
}

export async function reviewScript(script, topic, notes = "") {
  const task = [
    `Review this Style rules reel script${topic ? ` about "${topic}"` : ""}.`,
    notes &&
      `The creator's own notes on this script (top priority; list each one that isn't fully fixed yet as a problem, and score it down):\n${notes}`,
    readable(script),
    await performanceContext(),
  ]
    .filter(Boolean)
    .join("\n\n");
  return askJson({ system: withTemplate(EDITOR, script.template), task, schema: REVIEW_SCHEMA, effort: "high" });
}

async function rewrite(f, script, review, topic, earlier = [], failed = null) {
  const notes = review.problems.map((p) => `- ${p.beat ? `Beat ${p.beat}` : "Whole reel"}: ${p.problem} -> ${p.fix}`).join("\n");
  const task = [
    `Rewrite this reel about "${topic}" so it's top-notch. Your head of content scored it ${review.overall}/10: ${review.verdict}`,
    `Fix every one of these:\n${notes}`,
    `Open with this hook (adapt it to flow if needed): ${review.best_hook}`,
    earlier.length &&
      `Earlier rounds already fixed these; don't bring any of them back:\n${earlier.map((p) => `- ${p.problem}`).join("\n")}`,
    failed &&
      `A previous attempt at this rewrite scored lower (${failed.overall}/10: ${failed.verdict}). Avoid what it got wrong:\n${failed.problems.map((p) => `- ${p.problem}`).join("\n")}`,
    review.strengths.length && `Keep what works:\n- ${review.strengths.join("\n- ")}`,
    "Return the complete script (every field, every beat), not just the changes.",
    `The current script as JSON:\n${JSON.stringify(script)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const raw = await askJson({ system: f.id === "editorial" ? withTemplate(f.brief, script.template) : f.brief, task, schema: publicSchema(f.schema), effort: "high" });
  return validateScript(raw, f.id);
}

async function patch(f, script, review, topic, earlier = [], failed = null) {
  const beatSchema = f.schema.properties.beats.items;
  const schema = publicSchema({
    type: "object",
    additionalProperties: false,
    required: ["edits", "sticker", "comment_keyword", "caption"],
    properties: {
      edits: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["beat", "beats"],
          properties: {
            beat: { type: "integer", description: "Beat number (1-based) in the current script" },
            beats: { type: "array", description: "What replaces it: one beat, several (split), or [] to cut it", items: beatSchema },
          },
        },
      },
      sticker: f.schema.properties.sticker,
      comment_keyword: { type: "string" },
      caption: { type: "string" },
    },
  });
  const notes = review.problems.map((p) => `- ${p.beat ? `Beat ${p.beat}` : "Whole reel"}: ${p.problem} -> ${p.fix}`).join("\n");
  const task = [
    `Polish this reel about "${topic}". Your head of content scored it ${review.overall}/10: ${review.verdict}`,
    `Fix these notes by editing ONLY the beats involved (replace, split or cut them); leave every other beat exactly as it is:\n${notes}`,
    earlier.length && `Already fixed in earlier rounds, don't bring back:\n${earlier.map((p) => `- ${p.problem}`).join("\n")}`,
    failed && `A previous attempt scored lower (${failed.overall}/10: ${failed.verdict}). Avoid:\n${failed.problems.map((p) => `- ${p.problem}`).join("\n")}`,
    "Also return the sticker (its beat number counted in the edited script), the comment keyword and the caption, updated if the edits affect them. The voiceover across beats must still flow as one natural speech.",
    `The current beats, numbered:\n${script.beats.map((b, i) => `${i + 1}. ${JSON.stringify(b)}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const raw = await askJson({ system: f.id === "editorial" ? withTemplate(f.brief, script.template) : f.brief, task, schema, effort: "high" });
  const beats = [...script.beats];
  const edits = [...(raw.edits ?? [])].filter((e) => e.beat >= 1 && e.beat <= beats.length).sort((a, b) => b.beat - a.beat);
  for (const e of edits) beats.splice(e.beat - 1, 1, ...(e.beats ?? []));
  const { review: _old, ...rest } = script;
  return validateScript({ ...rest, beats, sticker: raw.sticker, comment_keyword: raw.comment_keyword, caption: raw.caption }, f.id);
}

const summary = (review, rounds) => ({
  overall: review.overall,
  scores: review.scores,
  verdict: review.verdict,
  strengths: review.strengths,
  problems: review.problems,
  hooks: review.hooks,
  rounds,
  at: Date.now(),
});

export async function polish(script, { topic = script.topic ?? script.title, log = () => {}, notes = "" } = {}) {
  const f = getFormat(script.format);
  const history = [];
  const earlier = [];
  let current = script;
  log("Editor: reviewing the script");
  let review = await reviewScript(current, topic, notes);
  history.push(review.overall);
  log(`Editor: ${review.overall}/10. ${review.verdict}`);
  let failed = null;
  for (let round = 1; round <= MAX_ROUNDS && (review.overall < PASS_SCORE || (notes && round === 1)); round++) {
    const full = review.overall < FULL_REWRITE_BELOW;
    log(`${full ? "Rewrite" : "Beat edits"} ${round}: fixing ${review.problems.length} notes`);
    const next = await (full ? rewrite : patch)(f, current, review, topic, earlier, failed);
    log("Editor: reviewing the rewrite");
    const again = await reviewScript(next, topic, notes);
    history.push(again.overall);
    log(`Editor: ${again.overall}/10. ${again.verdict}`);
    if (again.overall < review.overall) {
      log("  weaker than the version before, trying again from the best one");
      failed = again;
      continue;
    }
    earlier.push(...review.problems);
    failed = null;
    current = next;
    review = again;
  }
  const out = { ...current, topic: script.topic ?? topic, review: summary(review, history) };
  for (const k of ["aspect", "voice", "music", "sfx", "picks"]) if (script[k] !== undefined && out[k] === undefined) out[k] = script[k];
  return out;
}
