import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { resolveVisuals } from "../formats/editorial/assets.js";
import { buildTimeline, renderVideo, stillAt } from "../formats/editorial/motion.js";
import { buildSfxTrack } from "../sfx.js";
import { ffmpeg, readJson, writeJson } from "../util.js";
import { CATALOG, PLUGINS } from "./index.js";

export const previewDir = path.join(config.root, "assets", "motions");
const indexFile = path.join(previewDir, "previews.json");

const V = (kind, layout, extra = {}) => ({ kind, layout, style: "tiles", asset_kind: "item", focus: "full", asset_tags: [], asset_prompt: "", colors: [], items: [], exempt: "no", plinth: "no", callouts: [], ...extra });
const item = (label, ...tags) => ({ label, hex: "", asset_tags: tags, asset_prompt: "" });
const model = (...tags) => V("asset", "side", { asset_kind: "model", asset_tags: ["model", ...tags] });
const NONE = V("none", "auto");
const SHOES = [item("chunky", "sneakers", "white", "chunky"), item("canvas", "sneakers", "white", "canvas"), item("loafers", "loafers", "suede", "tan"), item("boots", "boots", "black", "chunky")];

const DEMOS = {
  letter_fly: [["Agli baar baggy jeans pehno", "Agli baar ~BAGGY~ jeans", NONE, { transition: "letter" }, 2.4], ["Toh shoes pe dhyan do", "Shoes pe / *dhyan do*", model("baggy jeans", "chunky sneakers"), { align: "left" }, 2.2]],
  ghost_words: [["Plain upper, patla sole, chhota logo", "Plain upper / patla sole / ~chhota logo~", V("asset", "corner", { asset_tags: ["sneakers", "white"] }), { ghost: "yes" }, 3]],
  giant_word: [["Sabse zaroori hai fit", "Sabse zaroori / ~FIT~", model("navy tee", "light jeans"), { hero_size: "giant", align: "center" }, 2.8]],
  slam: [["Ye galti mat karna", "Ye ~GALTI~ / mat karna", NONE, { motion: "slam" }, 2.4]],
  snap: [["Clean, simple, sharp", "Clean / simple / ~sharp~", V("asset", "corner", { asset_tags: ["loafers", "tan"] }), { motion: "snap" }, 2.4]],
  stack: [["Pehla fit", "Pehla ~FIT~", NONE, { motion: "stack" }, 1.2], ["Doosra colour", "Doosra ~COLOUR~", NONE, { motion: "stack" }, 1.2], ["Teesra shoes", "Teesra ~SHOES~", NONE, { motion: "stack" }, 1.4]],
  caption: [["Ek plain white sneaker sab kuch sambhal leta hai", "Ek plain ~white~ sneaker", V("asset", "hero", { asset_tags: ["sneakers", "white", "canvas"] }), { text_style: "caption" }, 3.2]],
  punch: [["Dekho hem kaise pool ho raha hai", "Hem ~pool~ ho raha hai", model("baggy jeans", "hem pooling"), { camera: "punch", align: "left" }, 2.6]],
  rotate_push: [["Aur yahi sabse bada mistake hai", "Sabse bada ~MISTAKE~", model("mistake", "black belt"), { camera: "rotate", align: "left" }, 2.6]],
  cards: [["Chunky, canvas, loafers, boots", "Tumhare ~options~", V("outfit", "cards", { items: SHOES }), {}, 3]],
  flow: [["Ek white sneaker, teen looks", "1 sneaker / ~3 looks~", V("flow", "auto", { items: [item("white sneaker", "sneakers", "white"), item("casual", "model", "olive tee", "white sneakers"), item("smart", "model", "sky blue shirt", "white sneakers"), item("festive", "model", "yellow kurta", "white sneakers")] }), {}, 3.4]],
  slider: [["Same jeans, bas shoes badle", "Same jeans / ~shoes badle~", V("compare", "slider", { items: [item("flat canvas", "model", "baggy jeans", "flat canvas"), item("chunky sole", "model", "baggy jeans", "chunky sneakers", "white tee")] }), {}, 3]],
  verdict: [["Slim sneakers nahi, chunky sneakers haan", "~Galat~ vs sahi", V("compare", "verdict", { items: [item("slim", "sneakers", "white", "canvas"), item("chunky", "sneakers", "white", "chunky")] }), {}, 3]],
  zoom: [["Dekho shoes kaise dab gaye", "Shoes ~dab~ gaye", V("asset", "zoom", { asset_kind: "model", asset_tags: ["model", "baggy jeans", "slim sneakers"] }), { align: "left" }, 3]],
  scale: [["Slim, straight, phir baggy", "Fit ka ~order~", V("outfit", "scale", { items: [item("slim", "silhouette", "slim jeans"), item("straight", "silhouette", "straight jeans"), item("baggy", "silhouette", "baggy jeans")] }), {}, 3]],
  mosaic: [["Tumhe ye sab nahi chahiye, bas ye ek", "Bas ~ye ek~", V("asset", "mosaic", { asset_tags: ["sneakers", "white", "chunky"] }), {}, 3.4]],
  duo: [["Fit bhi, detail bhi", "Fit bhi / ~detail bhi~", V("outfit", "duo", { items: [item("close", "model", "navy tee", "light jeans"), item("full", "model", "navy tee", "light jeans", "chunky sneakers")] }), {}, 3]],
  closeup: [["Confidence yahin se aata hai", "~CONFIDENCE~", V("asset", "closeup", { asset_kind: "model", asset_tags: ["model", "olive", "overshirt"], style: "mono" }), {}, 2.6]],
  corner: [["Rule simple hai, jitna plain utna versatile", "Jitna ~plain~ / utna versatile", V("asset", "corner", { asset_tags: ["sneakers", "white", "canvas"] }), {}, 3]],
  dm_ending: [["Comments mein SHOES likho", "Comments mein / ~SHOES~", V("none", "dm"), {}, 2.6], ["Main list tumhare DM mein bhej dunga", "List tumhare ~DM~ mein", V("none", "dm"), {}, 2.4]],
  plinth: [["Ye hai hero look", "Hero ~look~", V("asset", "hero", { asset_kind: "model", asset_tags: ["model", "navy tee", "light jeans", "chunky sneakers"], plinth: "yes" }), { align: "center" }, 3]],
  callouts: [["Plain upper, patla sole, chhota logo", "Kya ~check~ karein", V("asset", "callouts", { asset_tags: ["sneakers", "white", "chunky"], callouts: ["plain upper", "small logo", "chunky sole"] }), {}, 3.4]],
  deck: [["Chunky, canvas, loafers, ya boots", "Kaunsa ~pair~", V("outfit", "deck", { items: SHOES }), {}, 3.4]],
  pick: [["In sab mein se sirf ye ek", "Sirf ~ye ek~", V("outfit", "pick", { items: SHOES }), {}, 3.4]],
  reveal: [["Ye hai woh ek sneaker", "Woh ~ek~ sneaker", V("asset", "reveal", { asset_tags: ["sneakers", "white", "chunky"] }), {}, 2.8]],
};

const PALETTE = [
  { name: "ink", bg: "#15171C", accent: "#E8C872", texture: "none" },
  { name: "bone", bg: "#EFEBE3", accent: "#C2452D", texture: "paper" },
  { name: "sage", bg: "#DDE3D6", accent: "#1F4B3A", texture: "none" },
  { name: "denim", bg: "#1B2A4A", accent: "#9CC3E6", texture: "grid" },
];

async function codeHash(m) {
  const files = ["../formats/editorial/motion.js", "../formats/editorial/design.js", ...(await fs.readdir(new URL(".", import.meta.url))).filter((f) => f.endsWith(".js")).map((f) => `./${f}`)];
  if (m.learned) files.push(`./learned/${m.id}.js`);
  const h = createHash("sha1");
  for (const f of files.sort()) h.update(await fs.readFile(new URL(f, import.meta.url)).catch(() => ""));
  return h.digest("hex").slice(0, 10);
}

function demoFor(id) {
  if (DEMOS[id]) return DEMOS[id];
  const d = PLUGINS[id]?.demo;
  if (!d) return null;
  const v = d.visual ?? {};
  const visual = V(v.kind ?? "outfit", id, {
    asset_kind: v.asset_kind ?? "item",
    asset_tags: v.asset_tags ?? [],
    items: (v.items ?? []).map((it) => item(it.label ?? "", ...(it.tags ?? []))),
    callouts: v.callouts ?? [],
  });
  return [[d.voiceover ?? "Ye dekho", d.text ?? "Ye ~dekho~", visual, {}, Math.max(d.seconds ?? 3, PLUGINS[id].minBeat + 0.8)]];
}

export async function listPreviews() {
  const idx = await readJson(indexFile, {});
  return CATALOG.map((m) => ({ id: m.id, file: idx[m.id]?.file ? `/motions/${idx[m.id].file}` : null, at: idx[m.id]?.at ?? null }));
}

export async function renderPreviews(ids = null, log = () => {}) {
  await fs.mkdir(previewDir, { recursive: true });
  const idx = await readJson(indexFile, {});
  const want = CATALOG.filter((m) => (!ids || ids.includes(m.id)) && demoFor(m.id));
  let n = 0;
  for (const [k, m] of want.entries()) {
    const hash = await codeHash(m);
    if (idx[m.id]?.hash === hash && idx[m.id]?.file) continue;
    log(`Motion preview: ${m.name} (${k + 1}/${want.length})`);
    try {
      const file = `${m.id}-${hash}.mp4`;
      await renderDemo(m.id, path.join(previewDir, file), k);
      if (idx[m.id]?.file && idx[m.id].file !== file) await fs.rm(path.join(previewDir, idx[m.id].file), { force: true });
      idx[m.id] = { file, hash, at: Date.now() };
      await writeJson(indexFile, idx);
      n++;
    } catch (err) {
      log(`  ${m.name}: couldn't render (${err.message})`);
    }
  }
  log(n ? `Motion previews: ${n} rendered` : "Motion previews: all up to date");
  return n;
}

async function buildDemo(id, k) {
  const demo = demoFor(id);
  const beats = demo.map(([voiceover, text, visual, extra], i) => ({ voiceover, text, visual: structuredClone(visual), theme: `p${((k + i) % PALETTE.length) + 1}`, align: "center", motion: "rise", camera: "none", transition: "cut", hero_size: "normal", ghost: "no", text_style: "lockup", ...extra }));
  let t = 0.25;
  const lines = demo.map(([voiceover, , , , secs]) => {
    const words = voiceover.split(/\s+/);
    const step = Math.min(0.32, (secs - 0.9) / words.length);
    const line = words.map((w, j) => ({ text: w, start: t + j * step, end: t + j * step + step * 0.9 }));
    t += secs;
    return line;
  });
  const { visuals } = await resolveVisuals({ beats, generate: false });
  return buildTimeline({ beats, narration: { duration: t - 0.2, lines }, visuals, aspect: "9:16", palette: PALETTE, typeset: k % 2 ? "magazine" : "editorial", keyword: "SHOES" });
}

export async function renderDemoStills(id, dir, times) {
  const tl = await buildDemo(id, CATALOG.findIndex((m) => m.id === id));
  await fs.mkdir(dir, { recursive: true });
  for (const t of times) await fs.writeFile(path.join(dir, `${id}-${t.toFixed(2)}.png`), await stillAt(tl, t));
  return tl;
}

async function renderDemo(id, out, k) {
  const tl = await buildDemo(id, k);
  const tmp = `${out}.work`;
  await fs.mkdir(tmp, { recursive: true });
  const silence = path.join(tmp, "silence.wav");
  await ffmpeg(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", (tl.total + 0.2).toFixed(2), silence]);
  const sfx = path.join(tmp, "sfx.wav");
  await buildSfxTrack(tl, sfx, "subtle", { keyword: "SHOES" });
  await renderVideo(tl, { narrationFile: silence, sfxFile: sfx, out, log: () => {} });
  await fs.rm(tmp, { recursive: true, force: true });
}
