import { createCanvas } from "@napi-rs/canvas";

const GROUPS = ["top", "bottoms", "shoes"];

function px(c) {
  return c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
}
function canvasOf(img) {
  const c = createCanvas(img.width, img.height);
  c.getContext("2d").drawImage(img, 0, 0);
  return c;
}

export function changedGroups(a, b, ma, mb) {
  const A = px(canvasOf(a));
  const B = px(canvasOf(b));
  const out = [];
  for (const k of GROUPS) {
    if (!ma?.[k] || !mb?.[k]) continue;
    const MA = px(canvasOf(ma[k]));
    const MB = px(canvasOf(mb[k]));
    let n = 0;
    let diff = 0;
    let onlyOne = 0;
    for (let i = 3; i < A.length; i += 16) {
      const ia = MA[i] > 128;
      const ib = MB[i] > 128;
      if (!ia && !ib) continue;
      n++;
      if (ia !== ib) onlyOne++;
      diff += (Math.abs(A[i - 3] - B[i - 3]) + Math.abs(A[i - 2] - B[i - 2]) + Math.abs(A[i - 1] - B[i - 1])) / 3;
    }
    if (n < 50) continue;
    const lim = k === "shoes" ? [32, 0.18] : [22, 0.07];
    if (diff / n > lim[0] || onlyOne / n > lim[1]) out.push(k);
  }
  return out;
}

export function lockOutfit(prev, next, mp, mn, groups) {
  const w = prev.width;
  const h = prev.height;
  const mask = createCanvas(w, h);
  const mg = mask.getContext("2d");
  for (const k of groups) {
    if (mp?.[k]) mg.drawImage(mp[k], 0, 0, w, h);
    if (mn?.[k]) mg.drawImage(mn[k], 0, 0, w, h);
  }
  const grown = createCanvas(w, h);
  const gg = grown.getContext("2d");
  const r = Math.max(4, Math.round(w / 70));
  for (const f of [0.5, 1]) for (let a = 0; a < 16; a++) gg.drawImage(mask, Math.cos((a / 16) * Math.PI * 2) * r * f, Math.sin((a / 16) * Math.PI * 2) * r * f);
  const soft = createCanvas(w, h);
  const sg = soft.getContext("2d");
  sg.filter = `blur(${Math.max(2, r * 0.35)}px)`;
  sg.drawImage(grown, 0, 0);
  const inside = createCanvas(w, h);
  const ig = inside.getContext("2d");
  ig.drawImage(next, 0, 0, w, h);
  ig.globalCompositeOperation = "destination-in";
  ig.drawImage(soft, 0, 0);
  const hole = createCanvas(w, h);
  const hg = hole.getContext("2d");
  const hr = Math.max(4, Math.round(w / 60));
  for (const k of groups) if (mp?.[k]) for (const f of [0.5, 1]) for (let a = 0; a < 12; a++) hg.drawImage(mp[k], Math.cos((a / 12) * Math.PI * 2) * hr * f, Math.sin((a / 12) * Math.PI * 2) * hr * f, w, h);
  const P = px(canvasOf(prev));
  const nc = createCanvas(w, h);
  nc.getContext("2d").drawImage(next, 0, 0, w, h);
  const N = px(nc);
  const S = px(soft);
  const HO = px(hole);
  const out = createCanvas(w, h);
  const g = out.getContext("2d");
  const im = g.createImageData(w, h);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const m = Math.max(S[i + 3], HO[i + 3]) / 255;
    const pa = P[i + 3] / 255;
    const na = N[i + 3] / 255;
    const a = na * m + pa * (1 - m);
    d[i + 3] = Math.round(a * 255);
    if (a <= 0) continue;
    for (let k = 0; k < 3; k++) d[i + k] = Math.round((N[i + k] * na * m + P[i + k] * pa * (1 - m)) / a);
  }
  g.putImageData(im, 0, 0);
  return out;
}

export function register(img, ref) {
  const w = ref.width;
  const h = ref.height;
  const f = 4;
  const sw = Math.round(w / f);
  const sh = Math.round(h / f);
  const grey = (src, dx = 0, dy = 0, k = 1) => {
    const c = createCanvas(sw, sh);
    const g = c.getContext("2d");
    g.fillStyle = "#808080";
    g.fillRect(0, 0, sw, sh);
    const sc = (k * w) / src.width / f;
    g.drawImage(src, (w / 2 + dx - (src.width * k * (w / src.width)) / 2) / f, (h * 0.12 + dy - h * 0.12 * k) / f, src.width * sc, src.height * sc);
    const d = g.getImageData(0, 0, sw, sh).data;
    const out = new Float32Array(sw * sh);
    for (let i = 0; i < out.length; i++) out[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
    return out;
  };
  const R = grey(ref);
  const rows = Math.round(sh * 0.2);
  const cost = (dx, dy, k) => {
    const G = grey(img, dx, dy, k);
    let s = 0;
    for (let i = 0; i < rows * sw; i++) s += Math.abs(G[i] - R[i]);
    return s;
  };
  let best = { dx: 0, dy: 0, k: 1, c: cost(0, 0, 1) };
  for (const [step, range, ks] of [[8, 32, [0.97, 0.985, 1, 1.015, 1.03]], [2, 8, [best.k - 0.008, best.k - 0.004, best.k, best.k + 0.004, best.k + 0.008]], [1, 2, [0]]]) {
    const b0 = { ...best };
    const kList = ks[0] === 0 ? [b0.k] : ks;
    for (const k of kList) for (let dx = b0.dx - range; dx <= b0.dx + range; dx += step) for (let dy = b0.dy - range; dy <= b0.dy + range; dy += step) {
      const c = cost(dx, dy, k);
      if (c < best.c) best = { dx, dy, k, c };
    }
  }
  const out = createCanvas(w, h);
  const g = out.getContext("2d");
  g.imageSmoothingQuality = "high";
  const k = best.k * (w / img.width);
  g.drawImage(img, w / 2 + best.dx - (img.width * k) / 2, h * 0.12 + best.dy - h * 0.12 * best.k, img.width * k, img.height * k);
  return out;
}

export function recolour(img, mask, hex) {
  const w = img.width;
  const h = img.height;
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const im = g.getImageData(0, 0, w, h);
  const d = im.data;
  const mc = createCanvas(w, h);
  mc.getContext("2d").drawImage(mask, 0, 0, w, h);
  const m = mc.getContext("2d").getImageData(0, 0, w, h).data;
  const T = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  let sum = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (m[i + 3] > 128) {
    sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    n++;
  }
  const mean = Math.max(8, n ? sum / n : 128);
  for (let i = 0; i < d.length; i += 4) {
    const a = m[i + 3] / 255;
    if (a <= 0) continue;
    const gain = mean < 50 ? 0.32 : mean < 90 ? 0.55 : 0.8;
    const r = Math.max(0.6, Math.min(1.3, 1 + ((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / mean - 1) * gain));
    for (let k = 0; k < 3; k++) d[i + k] = d[i + k] * (1 - a) + Math.min(255, T[k] * r) * a;
  }
  g.putImageData(im, 0, 0);
  return c;
}

export function toneOf(img, mask) {
  const w = 64;
  const h = Math.round((img.height / img.width) * 64);
  const a = createCanvas(w, h);
  a.getContext("2d").drawImage(img, 0, 0, w, h);
  const m = createCanvas(w, h);
  m.getContext("2d").drawImage(mask, 0, 0, w, h);
  const d = a.getContext("2d").getImageData(0, 0, w, h).data;
  const md = m.getContext("2d").getImageData(0, 0, w, h).data;
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (md[i + 3] > 200 && d[i + 3] > 200) {
    for (let k = 0; k < 3; k++) sum[k] += d[i + k];
    n++;
  }
  if (!n) return null;
  return `#${sum.map((v) => Math.round(v / n).toString(16).padStart(2, "0")).join("")}`;
}
