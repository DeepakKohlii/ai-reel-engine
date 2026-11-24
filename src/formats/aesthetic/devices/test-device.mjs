import fs from "node:fs/promises";
import path from "node:path";
import { loadImage } from "@napi-rs/canvas";

const [id, outDir, cueJson] = process.argv.slice(2);
try {
  await import(new URL(`./learned/${id}.js`, import.meta.url).href);
  const { DEVICES } = await import("./index.js");
  if (!DEVICES[id]) throw new Error("the module didn't load, or its default export isn't a valid device (needs id, name and draw)");
  const { listAssets, assetPath } = await import("../../../library.js");
  const { buildTimeline, Renderer } = await import("../engine.js");
  const model = (await listAssets()).find((a) => a.kind === "model");
  const img = model ? await loadImage(await fs.readFile(assetPath(model))) : null;
  const words = "Look how this sits right here on him like this".split(" ").map((w, i) => ({ text: w, start: 0.3 + i * 0.32, end: 0.3 + i * 0.32 + 0.28 }));
  const cue = { kind: "device", at_word: "this", text: "Label", status: "", part: "waist", to_part: "knees", side: "right", target: "", item: id, color: "", ...(cueJson ? JSON.parse(cueJson) : {}) };
  const plan = { style: { chapter: "none", index: "none" }, scenes: [{ type: "look", lines: [0], outfit: "m", overlays: [cue] }] };
  const tl = buildTimeline({ plan, narration: { duration: 4.2, lines: [words] }, media: { outfit: () => img, item: () => null, ref: () => null, media: () => null, clip: () => null } });
  const at = tl.scenes[0].cues.find((c) => c.kind === "device")?.at ?? 0.6;
  const times = [0.15, 0.5, 1.0, 1.8, 2.8].map((d) => +(at + d).toFixed(2));
  const r = new Renderer(tl);
  await fs.mkdir(outDir, { recursive: true });
  const files = [];
  for (const [i, t] of times.entries()) {
    const f = path.join(outDir, `f${i}.png`);
    await fs.writeFile(f, r.frame(t).toBuffer("image/png"));
    files.push(f);
  }
  console.log(JSON.stringify({ ok: true, files, times }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: String(err?.stack ?? err).split("\n").slice(0, 6).join("\n") }));
}
