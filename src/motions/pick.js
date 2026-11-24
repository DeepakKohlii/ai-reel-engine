import { clamp01, drawCard, easeOutBack, easeOutCubic, loopPoints, penStroke } from "./kit.js";

export default {
  id: "pick",
  name: "Pick one",
  group: "layout",
  when: "Eliminating options down to the right one: 'in sab mein se sirf ye', 'teen galat, ek sahi', the one pair worth buying.",
  needs: "kind outfit with 3-4 items (one product each, short lowercase labels). The FIRST item is the right pick; the rest get struck off.",
  fallback: "cards",
  minBeat: 2.2,
  hold: 0.55,
  accepts: (v) => v.images.length >= 3,

  geometry({ b, W, H, u, vertical }) {
    const imgs = b.visual.images.slice(0, 4);
    const n = imgs.length;
    const squash = vertical ? Math.min(1, H / ((W * 16) / 9)) ** 0.8 : 1;
    const w = (vertical ? W * 0.4 : W * 0.18) * squash;
    const h = w * 1.2;
    const gx = w * 1.12;
    const gy = h * 1.08;
    const ox = vertical ? W / 2 : W * 0.3;
    const oy = vertical ? Math.min(H * 0.62, H * 0.95 - gy) : H * 0.55;
    const slots = n === 4
      ? [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]
      : [[-0.5, -0.5], [0.5, -0.5], [0, 0.5]];
    const pickSlot = b.index % n;
    const order = imgs.map((_, i) => (i === 0 ? pickSlot : i <= pickSlot ? i - 1 : i));
    const tiles = imgs.map((im, i) => {
      const [sx, sy] = slots[order[i]];
      return { img: im.img, key: im.key, label: im.label, cx: ox + sx * gx, cy: oy + sy * gy, rot: ((order[i] * 5) % 7) - 3, delay: order[i] * 0.1, pick: i === 0 };
    });
    const wrong = tiles.filter((x) => !x.pick);
    wrong.forEach((x, k) => (x.strike = 0.75 + k * 0.32));
    const circleAt = 0.75 + wrong.length * 0.32 + 0.1;
    b.plugin = { id: "pick", tiles, w, h, circleAt };
    b.textCenter = vertical ? { x: W / 2, y: H * 0.19 } : { x: W * 0.72, y: H * 0.5 };
    b.maxTextWidth = vertical ? W * 0.9 : W * 0.46;
  },

  draw(r, b, t, exit) {
    const { ctx, u } = r;
    const d = b.plugin;
    const dt = t - b.visualAt;
    if (dt < 0) return;
    const fade = 1 - exit;
    const ck = clamp01((dt - d.circleAt) / 0.5);
    for (const x of [...d.tiles].sort((a, c) => a.pick - c.pick)) {
      const k = easeOutBack((dt - x.delay) / 0.45);
      if (dt < x.delay) continue;
      const struck = x.strike !== undefined ? clamp01((dt - x.strike) / 0.25) : 0;
      const lift = x.pick ? easeOutBack(ck) : 0;
      ctx.save();
      ctx.globalAlpha = clamp01((dt - x.delay) / 0.15) * fade;
      ctx.translate(x.cx, x.cy);
      ctx.rotate(((x.rot * (1 - lift)) * Math.PI) / 180);
      const s = (0.8 + 0.2 * k) * (1 + 0.08 * lift) * (1 - 0.04 * struck);
      ctx.scale(s, s);
      drawCard(ctx, u, b.theme, { img: x.img, w: d.w, h: d.h, label: x.label, sticker: r.stickerOf(x.img).canvas });
      if (struck > 0) {
        ctx.fillStyle = `rgba(20,18,16,${0.42 * struck})`;
        ctx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
        const m = d.w * 0.3;
        const k1 = clamp01(struck * 2);
        const k2 = clamp01(struck * 2 - 1);
        penStroke(ctx, [[-m, -m], [m * (-1 + 2 * k1), m * (-1 + 2 * k1)]], 1, { color: "#FFFFFF", width: 11 * u });
        if (k2 > 0) penStroke(ctx, [[m, -m], [m - 2 * m * k2, -m + 2 * m * k2]], 1, { color: "#FFFFFF", width: 11 * u });
      }
      ctx.restore();
      if (x.pick && ck > 0) {
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.shadowColor = "rgba(0,0,0,0.25)";
        ctx.shadowBlur = 10 * u;
        penStroke(ctx, loopPoints(x.cx, x.cy, d.w * 0.66, d.h * 0.62, b.index + 1), easeOutCubic(ck), { color: b.theme.accent, width: 10 * u });
        ctx.restore();
      }
    }
  },

  sfx: (b) => [
    ...b.plugin.tiles.filter((x) => !x.pick).map((x) => ({ kind: "list_item", name: "tick", at: b.visualAt + x.strike, gain: 0.6, priority: 2 })),
    { kind: "punchline", name: "pop", at: b.visualAt + b.plugin.circleAt + 0.1, gain: 0.85, priority: 3 },
  ],
};
