import { clamp01, easeOutBack, easeOutCubic, opaqueAt } from "./kit.js";

const SPOTS = [
  [/sole|heel|base|bottom|hem|cuff|hemline/, 0.86],
  [/toe/, 0.72],
  [/stitch|welt|seam/, 0.64],
  [/logo|brand|badge|dial|buckle|button|pocket/, 0.55],
  [/upper|panel|body|colou?r|fabric|leather|suede|material/, 0.4],
  [/lace|laces|eyelet|tongue|strap|band|loop/, 0.3],
  [/collar|neck|top|waist|lug/, 0.14],
];
const spotY = (label, i) => SPOTS.find(([re]) => re.test(String(label).toLowerCase()))?.[1] ?? [0.3, 0.55, 0.8][i % 3];

export default {
  id: "callouts",
  name: "Detail callouts",
  group: "layout",
  when: "Naming what makes one product right: 'plain upper, patla sole, chhota logo', the details to check before buying, what makes it premium.",
  needs: "One product image (kind asset, asset_kind item, or outfit with 1 item) and visual.callouts: 2-3 labels of 1-2 words, each naming a part of it (sole, upper, logo, laces, stitching, buckle).",
  fallback: "float",
  minBeat: 2.0,
  hold: 0.5,
  accepts: (v) => v.images.length >= 1,

  geometry({ b, beat, W, H, u, vertical }) {
    const im = b.visual.images[0];
    const labels = (beat.visual?.callouts ?? []).map((s) => String(s).replace(/[~#*!^%[\]]/g, "").trim()).filter(Boolean).slice(0, 3);
    if (!labels.length && im.label) labels.push(im.label);
    const maxW = W * (vertical ? 0.58 : 0.36);
    const maxH = H * (vertical ? 0.4 : 0.56);
    const s = Math.min(maxW / im.img.width, maxH / im.img.height);
    const w = im.img.width * s;
    const h = im.img.height * s;
    const cx = vertical ? W * 0.37 : W * 0.24;
    const cy = vertical ? H * 0.58 : H * 0.55;
    const rect = { x: cx - w / 2, y: cy - h / 2, w, h };
    const lx = Math.max(rect.x + rect.w + 40 * u, vertical ? W * 0.62 : W * 0.4);
    const marks = labels.map((text, i) => {
      const fy = spotY(text, i);
      let fx = 0.5;
      const pref = [0.74, 0.5, 0.3][i % 3];
      for (const f of [pref, pref + 0.08, pref - 0.08, 0.5, 0.62, 0.38]) {
        if (opaqueAt(im.img, f, fy)) {
          fx = f;
          break;
        }
      }
      return { text: text.toUpperCase(), dot: { x: rect.x + rect.w * fx, y: rect.y + rect.h * fy }, delay: 0.5 + i * 0.4, lx };
    });
    let last = -Infinity;
    for (const m of [...marks].sort((a, c) => a.dot.y - c.dot.y)) {
      m.ly = Math.max(m.dot.y - 30 * u, last + 120 * u);
      last = m.ly;
    }
    b.plugin = { id: "callouts", im, rect, marks };
    b.textCenter = vertical ? { x: W / 2, y: H * 0.2 } : { x: W * 0.74, y: H * 0.5 };
    b.maxTextWidth = vertical ? W * 0.9 : W * 0.42;
  },

  draw(r, b, t, exit) {
    const { ctx, u } = r;
    const { im, rect, marks } = b.plugin;
    const dt = t - b.visualAt;
    if (dt < 0) return;
    const fade = 1 - exit;
    const k = easeOutBack(dt / 0.5);
    const drift = 1 + 0.012 * Math.max(dt - 0.5, 0);
    const { canvas, pad } = r.stickerOf(im.img);
    const ks = rect.w / im.img.width;
    ctx.save();
    ctx.globalAlpha = clamp01(dt / 0.2) * fade;
    ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.scale((0.7 + 0.3 * k) * drift, (0.7 + 0.3 * k) * drift);
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowBlur = 40 * u;
    ctx.shadowOffsetY = 18 * u;
    ctx.drawImage(canvas, -rect.w / 2 - pad * ks, -rect.h / 2 - pad * ks, canvas.width * ks, canvas.height * ks);
    ctx.restore();

    const accent = b.theme.accent;
    for (const m of marks) {
      const mt = dt - m.delay;
      if (mt < 0) continue;
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      const dx = cx + (m.dot.x - cx) * drift;
      const dy = cy + (m.dot.y - cy) * drift;
      ctx.save();
      ctx.globalAlpha = fade;
      const pk = easeOutBack(mt / 0.3);
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(dx, dy, 9 * u * pk, 0, Math.PI * 2);
      ctx.fill();
      const ring = clamp01(mt / 0.6);
      if (ring < 1) {
        ctx.strokeStyle = accent;
        ctx.globalAlpha = fade * (1 - ring);
        ctx.lineWidth = 3 * u;
        ctx.beginPath();
        ctx.arc(dx, dy, (9 + 30 * ring) * u, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = fade;
      }
      const bend = [dx + Math.min((m.lx - dx) * 0.35, 80 * u), m.ly];
      const end = [m.lx - 16 * u, m.ly];
      const lk = easeOutCubic((mt - 0.1) / 0.35);
      if (lk > 0) {
        const seg1 = Math.hypot(bend[0] - dx, bend[1] - dy);
        const seg2 = Math.max(end[0] - bend[0], 0);
        const len = (seg1 + seg2) * lk;
        const a = Math.min(1, len / Math.max(seg1, 1));
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3 * u;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(dx, dy);
        ctx.lineTo(dx + (bend[0] - dx) * a, dy + (bend[1] - dy) * a);
        if (len > seg1) ctx.lineTo(bend[0] + Math.min(len - seg1, seg2), m.ly);
        ctx.stroke();
      }
      const tk = easeOutCubic((mt - 0.35) / 0.35);
      if (tk > 0) {
        const room = r.W * 0.95 - m.lx;
        let size = 46 * u;
        ctx.font = `${size}px "Oswald SemiBold", "Symbols"`;
        ctx.letterSpacing = `${2.5 * u}px`;
        let tw = ctx.measureText(m.text).width;
        if (tw > room) {
          size *= room / tw;
          ctx.font = `${size}px "Oswald SemiBold", "Symbols"`;
          tw = ctx.measureText(m.text).width;
        }
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        ctx.save();
        ctx.beginPath();
        ctx.rect(m.lx - 4 * u, m.ly - size, tw * tk + 8 * u, size * 2);
        ctx.clip();
        ctx.fillStyle = b.theme.ink;
        ctx.fillText(m.text, m.lx, m.ly);
        ctx.restore();
      }
      ctx.restore();
    }
  },

  sfx: (b) => b.plugin.marks.map((m) => ({ kind: "list_item", name: "tick", at: b.visualAt + m.delay, gain: 0.55, priority: 2 })),
};
