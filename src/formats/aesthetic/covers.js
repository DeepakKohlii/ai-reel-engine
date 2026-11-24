import * as D from "./design.js";
import { settings } from "./writer.js";

async function masthead(g, right, { ink = D.INK } = {}) {
  const s = await settings();
  g.save();
  g.fillStyle = ink;
  g.font = `24px "Plex Mono Medium"`;
  g.letterSpacing = "5px";
  g.textAlign = "left";
  g.fillText(String(s.series).toUpperCase(), 84, 318);
  g.textAlign = "right";
  g.fillText(String(right).toUpperCase(), D.W - 84, 318);
  g.restore();
}

const still = (m) => (m?.frame ? m.frame(Math.min(12, m.count - 1)) : m);

function fill(g, img, { x = 0, y = 0, w = D.W, h = D.H, fy = 0.35 } = {}) {
  if (!img) return false;
  const sc = Math.max(w / img.width, h / img.height);
  g.save();
  g.imageSmoothingQuality = "high";
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.drawImage(img, x + w / 2 - (img.width * sc) / 2, y + (h - img.height * sc) * fy, img.width * sc, img.height * sc);
  g.restore();
  return true;
}

const titleOf = (script) => `${script.cover?.line1 ?? ""} ${script.cover?.line2 ?? ""}`.trim() || script.title;

async function grid(g, script, media, _slots, kit) {
  const scenes = (script.scenes ?? []).filter((sc) => ["build", "chapter", "look"].includes(sc.type) && sc.outfit);
  const tiles = [];
  for (const sc of scenes) {
    if (sc.type === "chapter" || sc.type === "build") {
      if (!tiles.some((t) => t.outfit === sc.outfit)) tiles.push({ outfit: sc.outfit, label: sc.title ?? "" });
    }
  }
  await masthead(g, script.series_title || "");
  const condensed = D.THEME.upper || !D.THEME.headItalic;
  D.headline(g, titleOf(script), { y: 470, size: condensed ? 104 : 100 });
  const top = 540;
  const cw = (D.W - 168) / 2;
  const ch = 540;
  g.save();
  g.strokeStyle = "rgba(30,30,28,0.3)";
  g.setLineDash([3, 9]);
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(D.W / 2, top + 20);
  g.lineTo(D.W / 2, top + ch * 2 - 20);
  g.moveTo(100, top + ch);
  g.lineTo(D.W - 100, top + ch);
  g.stroke();
  g.restore();
  tiles.slice(0, 4).forEach((tile, i) => {
    const x = 84 + cw * (i % 2);
    const y = top + ch * Math.floor(i / 2);
    const img = media.outfit(tile.outfit);
    if (img) D.standing(g, img, { cx: x + cw * 0.55, feet: y + ch - 24, height: ch * 0.7 });
    g.fillStyle = D.INK;
    g.textAlign = "left";
    if (condensed) {
      let fs = 50;
      g.font = `${fs}px "${D.THEME.head}"`;
      while (g.measureText(tile.label.toUpperCase()).width > cw - 40 && fs > 26) g.font = `${(fs -= 4)}px "${D.THEME.head}"`;
      g.fillText(tile.label.toUpperCase(), x + 14, y + 80);
    } else {
      g.font = `20px "Plex Mono Medium"`;
      g.fillText(String(i + 1).padStart(2, "0"), x + 14, y + 60);
      g.font = `46px "${D.THEME.headItalic ?? D.THEME.head}"`;
      g.fillText(tile.label, x + 14, y + 110);
    }
  });
}

async function versus(g, script, media) {
  const cmps = (script.scenes ?? []).filter((sc) => sc.type === "compare");
  const cmp = cmps.at(-1) ?? {};
  const verdict = (side) => (cmp.overlays ?? []).filter((o) => o.kind === "pill" && o.side === side).at(-1);
  await masthead(g, script.series_title || "");
  const cover = script.cover ?? {};
  if (cover.line1) D.title(g, cover.line1, { y: 400, size: 88 });
  D.headline(g, cover.line2 || script.title, { y: 540, size: 128, italic: false });
  for (const [i, key] of [cmp.outfit, cmp.outfit2].entries()) {
    const img = media.outfit(key);
    const cx = D.W * (i ? 0.72 : 0.28);
    if (img) D.standing(g, img, { cx, feet: 1630, height: 900 });
    const v = verdict(i ? "right" : "left");
    D.pill(g, v?.text || `Outfit ${i + 1}`, { x: cx, y: 690, size: 28, status: v?.status || null });
  }
}

async function checklist(g, script, media) {
  const checks = (script.scenes ?? []).filter((sc) => sc.type === "chapter");
  const item = (script.scenes ?? []).find((sc) => sc.type === "product")?.thumb;
  await masthead(g, `${String(checks.length).padStart(2, "0")} checks`);
  const cover = script.cover ?? {};
  D.title(g, cover.line1 || "Quick quality", { y: 450, size: 96 });
  D.headline(g, cover.line2 || "check", { kind: "wide", y: 560, size: 80 });
  const img = media.item(item) ?? media.outfit(cover.outfit);
  if (img) {
    const sc = Math.min(760 / img.width, 600 / img.height);
    g.save();
    g.shadowColor = "rgba(0,0,0,0.18)";
    g.shadowBlur = 40;
    g.drawImage(img, D.W / 2 - (img.width * sc) / 2, 630, img.width * sc, img.height * sc);
    g.restore();
  }
  checks.slice(0, 4).forEach((ch, i) => D.darkCard(g, i + 1, ch.title ?? "", { x: D.W / 2, y: 1310 + i * 94, h: 82, w: 700 }));
}

async function photo(g, script, media, slots) {
  const ref = (script.scenes ?? []).find((sc) => sc.type === "reference" && sc.reference);
  const pic = still(slots[ref?.reference]);
  if (!fill(g, pic)) {
    const img = media.outfit(script.cover?.outfit || script.outfits?.[0]?.key);
    if (img) D.standing(g, img, { cx: D.W / 2, feet: 1400, height: 980 });
  }
  if (pic) {
    const fade = g.createLinearGradient(0, 1050, 0, 1700);
    fade.addColorStop(0, "rgba(0,0,0,0)");
    fade.addColorStop(1, "rgba(0,0,0,0.62)");
    g.fillStyle = fade;
    g.fillRect(0, 1050, D.W, 650);
  }
  const ink = pic ? "#FFFFFF" : D.INK;
  D.cropCorners(g, { x0: 52, y0: 262, x1: D.W - 52, y1: 1662, color: pic ? "rgba(255,255,255,0.8)" : undefined });
  await masthead(g, "Recreated", { ink });
  const cover = script.cover ?? {};
  if (cover.line1) D.title(g, cover.line1, { y: 1470, size: 84, color: ink });
  D.title(g, cover.line2 || script.title, { y: 1600, size: 120, italic: false, color: ink });
}

async function beforenow(g, script, media, slots) {
  const ba = (script.scenes ?? []).find((sc) => sc.type === "beforeafter") ?? {};
  const [la = "Before", lb = "Now"] = String(ba.title || "").split("|");
  [[ba.reference, ba.outfit, la], [ba.reference2, ba.outfit2, lb]].forEach(([ref, outfit, label], i) => {
    const x = i ? D.W / 2 + 4 : 0;
    const ok = fill(g, still(slots[ref]), { x, y: 240, w: D.W / 2 - 4, h: 1440, fy: 0.3 });
    if (!ok) {
      const img = media.outfit(outfit);
      if (img) D.standing(g, img, { cx: x + D.W / 4, feet: 1440, height: 940 });
    }
    g.save();
    g.fillStyle = ok ? "#FFFFFF" : D.INK;
    g.shadowColor = ok ? "rgba(0,0,0,0.45)" : "transparent";
    g.shadowBlur = 16;
    g.font = `72px "Instrument Serif Italic"`;
    g.textAlign = "center";
    g.fillText(label, x + D.W / 4, 420);
    g.restore();
  });
  g.fillStyle = "rgba(244,239,231,0.94)";
  g.fillRect(0, 1480, D.W, 200);
  D.title(g, titleOf(script), { y: 1610, size: 92, italic: true });
}

async function type(g, script, media) {
  await masthead(g, script.series_title || "");
  const words = titleOf(script).split(/\s+/);
  const lines = [];
  const per = Math.ceil(words.length / (words.length > 4 ? 3 : 2));
  for (let i = 0; i < words.length; i += per) lines.push(words.slice(i, i + per).join(" "));
  let y = 470;
  for (const l of lines) {
    D.headline(g, l, { y, size: 150, italic: false });
    y += 150;
  }
  g.fillStyle = D.THEME.accent;
  g.fillRect(D.W / 2 - 60, y - 90, 120, 6);
  const img = media.outfit(script.cover?.outfit || script.outfits?.[0]?.key);
  if (img) D.standing(g, img, { cx: D.W / 2, feet: 1640, height: Math.max(600, 1640 - y - 10) });
}

const COVER_TITLE = "Fraunces Black";
async function hero(g, script, media) {
  const cover = script.cover ?? {};
  const img = media.cover?.();
  if (img) {
    g.save();
    g.filter = "saturate(0.82) brightness(0.86) contrast(1.06)";
    fill(g, img, { fy: 0.4 });
    g.restore();
    const vig = g.createRadialGradient(D.W / 2, D.H * 0.5, D.H * 0.25, D.W / 2, D.H * 0.5, D.H * 0.75);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.45)");
    g.fillStyle = vig;
    g.fillRect(0, 0, D.W, D.H);
  }
  else {
    const m = media.outfit(cover.outfit || script.outfits?.[0]?.key);
    if (m) {
      const sc = (D.W * 1.35) / m.width;
      g.drawImage(m, D.W / 2 - (m.width * sc) / 2, 330 - m.height * sc * 0.1, m.width * sc, m.height * sc);
    }
  }
  const pos = { upper: 0.36, center: 0.52, lower: 0.72 }[cover.title_position] ?? 0.52;
  const cy = 240 + 1440 * pos;
  const band = g.getImageData(140, Math.round(cy - 160), D.W - 280, 320).data;
  let sum = 0;
  for (let i = 0; i < band.length; i += 16) sum += 0.299 * band[i] + 0.587 * band[i + 1] + 0.114 * band[i + 2];
  const light = sum / (band.length / 16) > 200;
  const ink = light ? D.INK : "#FFFFFF";
  if (!light) {
    const sc = g.createLinearGradient(0, cy - 420, 0, cy + 420);
    sc.addColorStop(0, "rgba(0,0,0,0)");
    sc.addColorStop(0.5, "rgba(0,0,0,0.28)");
    sc.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = sc;
    g.fillRect(0, cy - 420, D.W, 840);
  }
  const title = String(cover.title || `${cover.line1 ?? ""} ${cover.line2 ?? ""}`.trim() || script.title);
  const words = title.split(/\s+/);
  let best = [title];
  if (words.length > 1) {
    let bestDiff = Infinity;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(" ");
      const b = words.slice(i).join(" ");
      const diff = Math.abs(a.length - b.length);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = [a, b];
      }
    }
  }
  let size = 170;
  g.font = `${size}px "${COVER_TITLE}"`;
  g.letterSpacing = "-3px";
  while (Math.max(...best.map((l) => g.measureText(l).width)) > D.W - 170 && size > 80) g.font = `${(size -= 6)}px "${COVER_TITLE}"`;
  const lead = size * 0.86;
  const top = cy - ((best.length - 1) * lead) / 2 + size * 0.32;
  g.save();
  g.fillStyle = ink;
  g.textAlign = "center";
  if (!light) {
    g.shadowColor = "rgba(0,0,0,0.35)";
    g.shadowBlur = 24;
  }
  best.forEach((l, i) => g.fillText(l, D.W / 2, top + i * lead));
  g.shadowColor = "transparent";
  g.font = `24px "Space Grotesk Bold"`;
  g.letterSpacing = "9px";
  if (cover.kicker) g.fillText(String(cover.kicker).toUpperCase(), D.W / 2 + 4, top - size * 0.95);
  if (cover.sub) g.fillText(String(cover.sub).toUpperCase(), D.W / 2 + 4, top + (best.length - 1) * lead + size * 0.62);
  g.restore();
}

export const COVERS = { grid, versus, checklist, photo, beforenow, type, hero };
