import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { config } from "../../config.js";

const cacheDir = path.join(config.root, "assets", "library", "masks");
const GROUPS = {
  top: ["Upper-clothes", "Dress", "Scarf"],
  bottoms: ["Pants", "Skirt"],
  shoes: ["Left-shoe", "Right-shoe"],
};

export async function garmentMasksFor(img, key) {
  const w = img.width;
  const h = img.height;
  const files = Object.fromEntries(Object.keys(GROUPS).map((k) => [k, path.join(cacheDir, `${key}-${k}.png`)]));
  const cached = await Promise.all(Object.values(files).map((f) => fs.stat(f).catch(() => null)));
  if (cached.every(Boolean)) {
    const out = {};
    for (const [k, f] of Object.entries(files)) out[k] = await loadImage(await fs.readFile(f));
    return out;
  }
  await fs.mkdir(cacheDir, { recursive: true });
  const input = path.join(cacheDir, `${key}-input.png`);
  const c = createCanvas(w, h);
  c.getContext("2d").drawImage(img, 0, 0);
  await fs.writeFile(input, c.toBuffer("image/png"));
  const res = await new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL("./segment-worker.mjs", import.meta.url)), input, path.join(cacheDir, key), path.join(config.root, "assets", "models")], { cwd: config.root, stdio: ["ignore", "pipe", "ignore"] });
    let outp = "";
    child.stdout.on("data", (d) => (outp += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 240000);
    child.on("close", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(outp.trim().split("\n").at(-1)));
      } catch {
        resolve({ ok: false, error: "segmentation didn't finish" });
      }
    });
  });
  await fs.rm(input, { force: true });
  if (!res.ok) throw new Error(res.error);
  const out = {};
  for (const [k, f] of Object.entries(files)) out[k] = await loadImage(await fs.readFile(f));
  return out;
}
