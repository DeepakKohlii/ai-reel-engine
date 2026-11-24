import fs from "node:fs/promises";
import path from "node:path";
import { loadImage } from "@napi-rs/canvas";
import { config } from "../../config.js";
import { assetPath, listAssets } from "../../library.js";
import { mixSfx } from "../../sfx.js";
import { generateNarration } from "../../voice.js";
import { readJson } from "../../util.js";
import { buildTimeline, renderVideo, sfxCues } from "./engine.js";

const slug = process.argv[2] ?? "aesthetic-test-shoes";
const dir = path.join(config.packsDir, slug);
const plan = await readJson(path.join(dir, "plan.json"));
const log = (m) => console.log(m);

const assets = await listAssets();
const load = async (id) => {
  const a = assets.find((x) => x.id === id);
  return a ? loadImage(await fs.readFile(assetPath(a))) : null;
};
const outfits = {};
for (const [k, id] of Object.entries(plan.outfits ?? {})) outfits[k] = await load(id);
const items = {};
for (const [k, id] of Object.entries(plan.items ?? {})) items[k] = await load(id);

const narration = await generateNarration(dir, plan.lines.map((l) => l.voiceover), log, {}, { language: "en" });
const tl = buildTimeline({ plan, narration, media: { outfit: (k) => outfits[k] ?? null, item: (k) => items[k] ?? null, ref: () => null } });
const sfx = path.join(dir, "sfx.wav");
await mixSfx(sfxCues(tl), tl.total, sfx);
await renderVideo(tl, { voice: narration.file, sfx, out: path.join(dir, "rough-cut.mp4"), cacheDir: path.join(dir, "render-cache"), mediaKeys: { ...plan.outfits, ...plan.items }, log });
await fs.writeFile(path.join(dir, "timeline.json"), JSON.stringify({ total: tl.total, scenes: tl.scenes.map((s) => ({ type: s.type, t0: +s.t0.toFixed(2), t1: +s.t1.toFixed(2), cues: s.cues.map((c) => ({ kind: c.kind, at: +c.at.toFixed(2), word: c.at_word })) })) }, null, 2));
console.log("done", tl.total.toFixed(1), "s");
