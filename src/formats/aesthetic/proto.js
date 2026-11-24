import fs from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { assetPath, listAssets } from "../../library.js";
import * as D from "./design.js";

const out = process.argv[2] ?? "aesthetic-proto";
await fs.mkdir(out, { recursive: true });
const assets = await listAssets();
const img = async (id) => loadImage(await fs.readFile(assetPath(assets.find((a) => a.id === id))));

const M = {
  slim: await img("model-b178f5c40898"),
  pool: await img("model-38524377e161"),
  chunky: await img("model-5eaa047d85c2"),
  rugby: await img("model-9544b62deac1"),
  overshirt: await img("model-1408a7a06da8"),
  boots: await img("model-3afa3e8e87ac"),
};
const I = {
  tee: await img("item-e6f09563f3a2"),
  jeans: await img("item-e72e46837813"),
  chunky: await img("item-ec21025891ec"),
  boots: await img("item-f0133f3e9be3"),
  canvas: await img("item-fa24c91bc718"),
};

async function frame(name, draw) {
  const c = createCanvas(D.W, D.H);
  const g = c.getContext("2d");
  await draw(g);
  await fs.writeFile(path.join(out, `${name}.png`), c.toBuffer("image/png"));
}

await frame("a-title", (g) => {
  g.drawImage(D.background("studio"), 0, 0);
  D.title(g, "Wearing Baggy Jeans?", { y: 205 });
  const r = D.standing(g, M.slim, { height: D.H * 0.66, feet: D.H * 0.84 });
  D.dashed(g, r.x - 30, r.y + r.h * 0.94, r.x + r.w + 30, r.y + r.h * 0.94);
  D.subtitle(g, "your shoes");
});

await frame("b-index", (g) => {
  g.drawImage(D.background("studio"), 0, 0);
  D.title(g, "Shoe Guide 101", { y: 250, italic: false, size: 92 });
  const rows = [
    ["01/ Sneakers", [M.chunky, M.rugby]],
    ["02/ Casual", [M.overshirt, M.slim]],
    ["03/ Boots", [M.boots]],
  ];
  rows.forEach(([head, figs], i) => {
    const y = 390 + i * 420;
    D.sectionHeader(g, head, { y });
    figs.forEach((m, k) => D.standing(g, m, { cx: D.W / 2 + (k - (figs.length - 1) / 2) * 220, feet: y + 350, height: 300, shadow: true }));
  });
  D.subtitle(g, "the right pair");
});

await frame("c-chapter", (g) => {
  D.blurredCloseup(g, M.chunky, { focusY: 0.86, zoom: 1.7 });
  const thumb = createCanvas(400, 400);
  const tg = thumb.getContext("2d");
  tg.fillStyle = "#E9E9E7";
  tg.fillRect(0, 0, 400, 400);
  tg.drawImage(I.chunky, 20, 120, 360, (360 * I.chunky.height) / I.chunky.width);
  D.chapterPill(g, { n: 1, word: "Sneakers", thumb });
  D.subtitle(g, "first,", { color: "rgba(255,255,255,0.75)" });
});

await frame("d-annotate", (g) => {
  g.drawImage(D.background("studio"), 0, 0);
  const r = D.standing(g, M.pool, { height: D.H * 0.7, feet: D.H * 0.85 });
  D.pill(g, "Slim sneakers", { x: D.W / 2, y: 190, status: "bad" });
  const ankle = { x: r.x + r.w * 0.66, y: r.y + r.h * 0.95 };
  D.hotDot(g, r.x + r.w * 0.35, r.y + r.h * 0.955);
  D.hotDot(g, ankle.x, ankle.y);
  D.note(g, "Hem\nswallows\nthe shoe", { x: r.x + r.w + 10, y: r.y + r.h * 0.62, to: { x: ankle.x + 28, y: ankle.y - 20 } });
  D.dashed(g, r.x + r.w * 0.2, r.y + r.h * 0.5, r.x + r.w * 0.2, r.y + r.h * 0.98);
  D.dashed(g, r.x + r.w * 0.8, r.y + r.h * 0.5, r.x + r.w * 0.8, r.y + r.h * 0.98);
  D.subtitle(g, "disappear,");
});

await frame("e-swatch", (g) => {
  g.drawImage(D.background("studio"), 0, 0);
  const r = D.standing(g, M.chunky, { cx: D.W * 0.42, height: D.H * 0.68, feet: D.H * 0.85 });
  D.pill(g, "Chunky sole", { x: D.W * 0.42, y: 190, status: "good" });
  D.swatch(g, { x: D.W * 0.7, y: D.H * 0.4, img: I.canvas, label: "Flat canvas", mark: "bad" });
  D.swatch(g, { x: D.W * 0.7, y: D.H * 0.4 + 240, img: I.chunky, label: "Chunky sole" });
  D.cursor(g, D.W * 0.7 + 110, D.H * 0.4 + 330);
  D.subtitle(g, "balances it.");
  void r;
});

await frame("f-paper", (g) => {
  g.drawImage(D.background("paper"), 0, 0);
  D.corners(g);
  D.bigLabel(g, "Streetwear", { file: "File 004 · Baggy jeans", y: 300 });
  D.standing(g, M.rugby, { cx: D.W * 0.64, height: D.H * 0.66, feet: D.H * 0.86 });
  [[I.tee, 470], [I.jeans, 720], [I.chunky, 1010]].forEach(([im, y]) => {
    const w = 170;
    g.drawImage(im, 110, y, w, (w * im.height) / im.width);
  });
  D.subtitle(g, "with retro runners");
});

await frame("g-cover", (g) => {
  g.drawImage(D.background("studio"), 0, 0);
  D.title(g, "Shoes for", { y: 230, size: 96 });
  D.title(g, "Baggy Jeans", { y: 330, size: 128, italic: false });
  D.standing(g, M.chunky, { height: D.H * 0.6, feet: D.H * 0.86 });
  g.font = `24px "Plex Mono Medium"`;
  g.fillStyle = D.INK;
  g.textAlign = "center";
  g.letterSpacing = "3px";
  g.fillText("STYLE NOTES · 01", D.W / 2, D.H * 0.93);
});

console.log("done", out);
