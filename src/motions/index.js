import fs from "node:fs/promises";
import callouts from "./callouts.js";
import deck from "./deck.js";
import pick from "./pick.js";
import reveal from "./reveal.js";

const HAND_MADE = [callouts, deck, pick, reveal];
export const PLUGINS = Object.fromEntries(HAND_MADE.map((p) => [p.id, p]));
export const learnedDir = new URL("./learned/", import.meta.url);

export function validPlugin(p) {
  return (
    p && typeof p === "object" && /^[a-z][a-z0-9_]{2,30}$/.test(p.id ?? "") && typeof p.name === "string" &&
    typeof p.accepts === "function" && typeof p.geometry === "function" && typeof p.draw === "function" &&
    typeof p.minBeat === "number" && ["cards", "float", "sandwich", "corner", "side", "hero"].includes(p.fallback)
  );
}

const BUILT_IN = [
  { id: "letter_fly", name: "Letter fly-through", group: "transition", use: 'beat transition "letter"', when: "Out of the hook into the next beat, on a hero word with O, D, B, P, R or A. Once per reel." },
  { id: "ghost_words", name: "Ghost words", group: "text", use: 'beat ghost "yes"', when: "A rule or list line: the words wait pale and fill in as spoken." },
  { id: "giant_word", name: "Giant hero word", group: "text", use: 'beat hero_size "giant"', when: "The single biggest word of the reel, pinned to the top." },
  { id: "slam", name: "Slam", group: "text", use: 'beat motion "slam"', when: "Punchlines and head-fakes, 1-3 per reel." },
  { id: "snap", name: "Snap words", group: "text", use: 'beat motion "snap"', when: "Fast lyric-video energy: words pop on in one frame." },
  { id: "stack", name: "Stack column", group: "text", use: 'motion "stack" on 3-5 consecutive text-only beats', when: "A fast list or rant built as one tilted column." },
  { id: "caption", name: "Word-by-word caption", group: "text", use: 'beat text_style "caption"', when: "Quiet premium moments where the garment is the hero." },
  { id: "punch", name: "Punch crop", group: "camera", use: 'beat camera "punch"', when: "A punchline on a held shot: instant crop onto the detail. 2-4 per reel." },
  { id: "rotate_push", name: "Rotate push", group: "camera", use: 'beat camera "rotate"', when: "Tilts and pushes out of a beat." },
  { id: "cards", name: "Photo cards", group: "layout", use: 'layout "cards" (outfit, 2-4 items)', when: "Any list, options or picks, including the CTA list.", pref: "list_as_cards" },
  { id: "flow", name: "Flow (one item, many looks)", group: "layout", use: 'kind "flow"', when: "One item into 2-3 looks or occasions." },
  { id: "slider", name: "Before/after slider", group: "layout", use: 'layout "slider" (compare, 2 items)', when: "Same outfit, one change." },
  { id: "verdict", name: "Verdict stamps", group: "layout", use: 'layout "verdict" (compare, 2 items)', when: "Wrong vs right." },
  { id: "zoom", name: "Zoom magnifier", group: "layout", use: 'layout "zoom" (asset model)', when: "Pointing at a detail on a model (shoes, hem, collar)." },
  { id: "scale", name: "Scale", group: "layout", use: 'layout "scale" (outfit, 2-4 items in order)', when: "An order: slim -> straight -> baggy, budget -> premium." },
  { id: "mosaic", name: "Mosaic", group: "layout", use: 'layout "mosaic"', when: "'You don't need all this, just this ONE piece'. Once per reel." },
  { id: "duo", name: "Duo", group: "layout", use: 'layout "duo" (2 images of the same model)', when: "A close-up with a tiny full-body figure on its shoulder." },
  { id: "closeup", name: "Close-up + giant word", group: "layout", use: 'layout "closeup" (asset model)', when: "One emotional or punchline beat on a model." },
  { id: "corner", name: "Corner product", group: "layout", use: 'layout "corner" (asset item/prop)', when: "A type-led beat that needs a supporting product." },
  { id: "dm_ending", name: "Comment → DM ending", group: "ending", use: 'layout "dm" on the comment and last beats', when: "The CTA ending (rotates with cards and product endings)." },
  { id: "plinth", name: "Plinth + smoke", group: "layout", use: 'visual plinth "yes"', when: "Hero outfit reveal on a cube." },
];

export const CATALOG = [];
const layoutEnums = [];
function rebuild() {
  CATALOG.splice(0, CATALOG.length,
    ...BUILT_IN.map((m) => ({ ...m, builtIn: true, pref: m.pref ?? m.id })),
    ...Object.values(PLUGINS).map((p) => ({
      id: p.id, name: p.name, group: p.group ?? "layout", use: `layout "${p.id}"`, when: p.when, needs: p.needs, minBeat: p.minBeat,
      builtIn: false, learned: !!p.learned, source: p.source ?? null, pref: p.id,
    })),
  );
  for (const e of layoutEnums) for (const id of Object.keys(PLUGINS)) if (!e.includes(id)) e.push(id);
}

export async function reloadLearned() {
  for (const [id, p] of Object.entries(PLUGINS)) if (p.learned) delete PLUGINS[id];
  const files = (await fs.readdir(learnedDir).catch(() => [])).filter((f) => f.endsWith(".js")).sort();
  for (const f of files) {
    try {
      const url = new URL(f, learnedDir);
      const stat = await fs.stat(url);
      const p = (await import(`${url.href}?v=${stat.mtimeMs}`)).default;
      const source = JSON.parse(await fs.readFile(new URL(f.replace(/\.js$/, ".json"), learnedDir), "utf8").catch(() => "null"));
      if (validPlugin(p) && !HAND_MADE.some((h) => h.id === p.id)) PLUGINS[p.id] = { ...p, learned: true, source };
    } catch (err) {
      console.error(`Motion ${f} didn't load: ${err.message}`);
    }
  }
  rebuild();
}
await reloadLearned();

export function ratingOf(m, prefs) {
  const r = prefs?.ingredients?.[m.pref ?? m.id];
  return r ?? (m.builtIn ? "ok" : m.learned ? "new" : "trial");
}

export function pluginLayouts() {
  const e = Object.keys(PLUGINS);
  layoutEnums.push(e);
  return e;
}

export function libraryBrief(prefs) {
  const lines = Object.values(PLUGINS)
    .map((p) => ({ p, r: ratingOf(p, prefs) }))
    .filter(({ r }) => r !== "dislike" && r !== "new")
    .map(({ p, r }) => `- ${p.id} (${p.name}${r === "trial" ? ", ON TRIAL: at most one trial motion per reel, only where it clearly fits" : r === "like" ? ", the creator likes it" : ""}): ${p.when} Needs: ${p.needs} Beat at least ${p.minBeat}s of voice.`);
  if (!lines.length) return "";
  return ["Motion library (extra set pieces, via visual.layout; they count as set pieces and follow the same variety rules):", ...lines].join("\n");
}
