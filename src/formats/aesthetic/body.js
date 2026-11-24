import { opaqueAt } from "../../motions/kit.js";

export const PARTS = {
  head: { y: 0.055, dx: 0 },
  face: { y: 0.075, dx: 0 },
  hair: { y: 0.02, dx: 0 },
  neck: { y: 0.14, dx: 0 },
  collar: { y: 0.16, dx: 0.06 },
  shoulders: { y: 0.19, dx: 0.3 },
  chest: { y: 0.27, dx: 0.14 },
  sleeve: { y: 0.3, dx: 0.36 },
  waist: { y: 0.44, dx: 0.17 },
  belt: { y: 0.45, dx: 0.06 },
  hips: { y: 0.5, dx: 0.21 },
  shirt_hem: { y: 0.53, dx: 0.17 },
  hands: { y: 0.5, dx: 0.34 },
  cuff: { y: 0.49, dx: 0.37 },
  thighs: { y: 0.6, dx: 0.13 },
  knees: { y: 0.72, dx: 0.12 },
  hem: { y: 0.925, dx: 0.14 },
  ankles: { y: 0.945, dx: 0.12 },
  feet: { y: 0.975, dx: 0.14 },
};
export const PART_NAMES = Object.keys(PARTS);

export function partPoint(rect, img, part, side = "center") {
  const p = PARTS[part] ?? PARTS.chest;
  const s = side === "left" ? -1 : side === "right" ? 1 : 0;
  let fx = 0.5 + s * p.dx;
  if (img && s && !opaqueAt(img, fx, p.y)) {
    for (let k = 1; k <= 14; k++) {
      const out = fx + s * 0.015 * k;
      const inn = fx - s * 0.015 * k;
      if (out > 0.02 && out < 0.98 && opaqueAt(img, out, p.y)) { fx = out; break; }
      if ((inn - 0.5) * s > 0.02 && opaqueAt(img, inn, p.y)) { fx = inn; break; }
    }
  }
  return { x: rect.x + rect.w * fx, y: rect.y + rect.h * p.y };
}

export function partSpan(rect, img, part) {
  const p = PARTS[part] ?? PARTS.chest;
  let l = 0.5;
  let r = 0.5;
  if (img) {
    for (let f = 0.5; f > 0.02; f -= 0.01) if (opaqueAt(img, f, p.y)) l = f;
    for (let f = 0.5; f < 0.98; f += 0.01) if (opaqueAt(img, f, p.y)) r = f;
  } else {
    l = 0.5 - p.dx - 0.08;
    r = 0.5 + p.dx + 0.08;
  }
  return { x0: rect.x + rect.w * l, x1: rect.x + rect.w * r, y: rect.y + rect.h * p.y };
}

export function fitDifference(a, b) {
  const width = (img, part) => {
    const sp = partSpan({ x: 0, y: 0, w: img.width / img.height, h: 1 }, img, part);
    return sp.x1 - sp.x0;
  };
  let most = 0;
  for (const part of ["shoulders", "chest", "waist", "hips"]) {
    const wa = width(a, part);
    const wb = width(b, part);
    most = Math.max(most, Math.abs(wa - wb) / Math.max(wb, 1e-6));
  }
  return most;
}

const SYNONYMS = { knee: "knees", shoe: "feet", shoes: "feet", sneakers: "feet", sandals: "feet", foot: "feet", ankle: "ankles", thigh: "thighs", hip: "hips", shoulder: "shoulders", sleeves: "sleeve", cuffs: "cuff", wrist: "cuff", hand: "hands", torso: "chest", top: "chest", fabric: "chest", legs: "thighs", leg: "thighs", trousers: "thighs", pants: "thighs", hemline: "hem", trouser_hem: "hem", kurta_hem: "shirt_hem", neckline: "collar" };
export function partName(p, fallback = "chest") {
  const k = String(p ?? "").toLowerCase().trim().replace(/\s+/g, "_");
  if (PARTS[k]) return k;
  if (SYNONYMS[k]) return SYNONYMS[k];
  if (PARTS[`${k}s`]) return `${k}s`;
  if (PARTS[k.replace(/s$/, "")]) return k.replace(/s$/, "");
  return fallback;
}
