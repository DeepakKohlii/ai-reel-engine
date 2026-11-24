import fs from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const [input, prefix, modelsDir] = process.argv.slice(2);
const GROUPS = { top: ["Upper-clothes", "Dress", "Scarf"], bottoms: ["Pants", "Skirt"], shoes: ["Left-shoe", "Right-shoe"] };
try {
  const T = await import("@huggingface/transformers");
  T.env.cacheDir = modelsDir;
  const seg = await T.pipeline("image-segmentation", "Xenova/segformer_b2_clothes");
  const img = await loadImage(await fs.readFile(input));
  const w = img.width;
  const h = img.height;
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  g.fillStyle = "#E9E9E7";
  g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0);
  const rgba = g.getImageData(0, 0, w, h).data;
  const rgb = new Uint8ClampedArray(w * h * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) [rgb[j], rgb[j + 1], rgb[j + 2]] = [rgba[i], rgba[i + 1], rgba[i + 2]];
  const res = await seg(new T.RawImage(rgb, w, h, 3));
  const a = createCanvas(w, h);
  a.getContext("2d").drawImage(img, 0, 0);
  const alpha = a.getContext("2d").getImageData(0, 0, w, h).data;
  await fs.mkdir(path.dirname(prefix), { recursive: true });
  for (const [k, labels] of Object.entries(GROUPS)) {
    const m = createCanvas(w, h);
    const mg = m.getContext("2d");
    const im = mg.createImageData(w, h);
    for (const r of res.filter((x) => labels.includes(x.label))) {
      const d = r.mask.data;
      const mw = r.mask.width;
      const mh = r.mask.height;
      for (let y = 0; y < h; y++) {
        const sy = Math.min(mh - 1, Math.floor((y * mh) / h));
        for (let x = 0; x < w; x++) {
          if (d[sy * mw + Math.min(mw - 1, Math.floor((x * mw) / w))] > 127) {
            const i = (y * w + x) * 4;
            im.data[i] = im.data[i + 1] = im.data[i + 2] = 255;
            im.data[i + 3] = alpha[i + 3];
          }
        }
      }
    }
    mg.putImageData(im, 0, 0);
    const soft = createCanvas(w, h);
    const sg = soft.getContext("2d");
    sg.filter = "blur(1.2px)";
    sg.drawImage(m, 0, 0);
    await fs.writeFile(`${prefix}-${k}.png`, soft.toBuffer("image/png"));
  }
  console.log(JSON.stringify({ ok: true }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: String(err?.message ?? err).slice(0, 300) }));
}
