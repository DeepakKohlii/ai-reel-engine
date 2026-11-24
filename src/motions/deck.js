import { clamp01, drawCard, easeInCubic, easeInOutCubic, easeOutBack } from "./kit.js";

export default {
  id: "deck",
  name: "Swipe deck",
  group: "layout",
  when: "Going through options one by one ('pehla..., doosra..., teesra...'), alternatives, or 'ye nahi, ye nahi, ye'. A lighter, faster cousin of photo cards.",
  needs: "kind outfit or compare with 2-4 items (one product each, short lowercase labels). The last item is the one that stays on screen.",
  fallback: "cards",
  minBeat: 2.0,
  hold: 0.5,
  accepts: (v) => v.images.length >= 2,

  geometry({ b, W, H, u, vertical }) {
    const imgs = b.visual.images.slice(0, 4);
    const squash = vertical ? Math.min(1, H / ((W * 16) / 9)) ** 0.8 : 1;
    const w = (vertical ? W * 0.56 : W * 0.26) * squash;
    const h = w * 1.22;
    const cx = vertical ? W / 2 : W * 0.3;
    const cy = vertical ? Math.min(H * 0.62, H * 0.95 - h / 2) : H * 0.55;
    const flip = b.index % 2 ? 1 : -1;
    b.plugin = {
      id: "deck",
      cx, cy, w, h,
      cards: imgs.map((im, i) => ({ img: im.img, key: im.key, label: im.label, rot: (i % 2 ? 1 : -1) * (2 + i), dir: (i % 2 ? -1 : 1) * flip })),
      flicks: [],
    };
    b.textCenter = vertical ? { x: W / 2, y: H * 0.2 } : { x: W * 0.72, y: H * 0.5 };
    b.maxTextWidth = vertical ? W * 0.9 : W * 0.46;
  },

  timing(b) {
    const n = b.plugin.cards.length;
    const start = 0.75;
    const room = Math.max(b.t1 - 0.45 - b.visualAt - start, 0.4 * (n - 1));
    const gap = Math.min(0.75, Math.max(0.38, room / Math.max(n - 1, 1)));
    b.plugin.flicks = b.plugin.cards.slice(0, -1).map((_, i) => start + i * gap);
  },

  draw(r, b, t, exit) {
    const { ctx, u, W } = r;
    const d = b.plugin;
    const dt = t - b.visualAt;
    if (dt < 0) return;
    const inK = easeOutBack(dt / 0.55);
    const moved = d.flicks.reduce((m, f) => m + easeInOutCubic((dt - f - 0.05) / 0.3), 0);
    for (let i = d.cards.length - 1; i >= 0; i--) {
      const c = d.cards[i];
      const f = d.flicks[i];
      const fk = f === undefined ? 0 : easeInCubic((dt - f) / 0.32);
      if (fk >= 1) continue;
      const lay = Math.min(Math.max(i - moved, 0), 3);
      ctx.save();
      ctx.globalAlpha = clamp01(dt / 0.2) * (1 - exit);
      const s = (1 - 0.05 * lay) * (0.85 + 0.15 * inK);
      ctx.translate(d.cx + c.dir * fk * W * 0.9, d.cy + lay * 26 * u - (1 - inK) * 120 * u - fk * 60 * u);
      ctx.rotate(((c.rot * Math.min(lay, 1) * 0.8 + c.rot * 0.2 + c.dir * fk * 24) * Math.PI) / 180);
      ctx.scale(s, s);
      drawCard(ctx, u, b.theme, { img: c.img, w: d.w, h: d.h, label: c.label, sticker: r.stickerOf(c.img).canvas });
      ctx.restore();
    }
  },

  sfx: (b) => b.plugin.flicks.map((f) => ({ kind: "list_item", name: "swoosh", at: b.visualAt + f, gain: 0.6, priority: 2 })),
};
