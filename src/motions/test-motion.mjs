import fs from "node:fs/promises";
import path from "node:path";

const [id, outDir] = process.argv.slice(2);
try {
  await import(new URL(`./learned/${id}.js`, import.meta.url).href);
  const { PLUGINS } = await import("./index.js");
  const p = PLUGINS[id];
  if (!p) throw new Error("the module didn't load, or its default export isn't a valid motion (needs id, name, accepts, geometry, draw, minBeat and a fallback from the list)");
  if (!p.demo?.visual) throw new Error("the motion needs a demo with a visual");
  const { renderDemoStills } = await import("./preview.js");
  const secs = Math.max(p.demo.seconds ?? 3, p.minBeat + 0.8);
  const times = [0.55, 1.1, 1.8, secs * 0.7, secs - 0.2].map((t) => +t.toFixed(2));
  const tl = await renderDemoStills(id, outDir, times);
  const used = tl.timeline.find((b) => b.plugin?.id === id);
  if (!used) throw new Error("the demo beat didn't use the motion: its demo images weren't found in the library (use the listed tags) or accepts() returned false");
  const files = (await fs.readdir(outDir)).filter((f) => f.endsWith(".png")).sort().map((f) => path.join(outDir, f));
  if (!files.length) throw new Error("no frames were rendered");
  console.log(JSON.stringify({ ok: true, files, times }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: String(err?.stack ?? err).split("\n").slice(0, 6).join("\n") }));
}
