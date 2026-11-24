import { createCanvas } from "@napi-rs/canvas";
import { clamp01, easeInOutCubic, easeOutCubic } from "./kit.js";

const shineCache = new WeakMap();

export default {
  id: "reveal",
  name: "Block reveal + glint",
  group: "layout",
  when: "Revealing THE product the reel is about ('ye hai woh ek sneaker'), the answer after a build-up, a premium piece.",
  needs: "One product image (kind asset, asset_kind item or prop). Once per reel.",
  fallback: "sandwich",
  minBeat: 1.6,
  hold: 0.35,
  accepts: (v) => v.images.length >= 1 && !["model", "host"].includes(v.assetKind),

  geometry({ b, W, H, u, vertical }) {
    const im = b.visual.images[0];
    const maxW = W * (vertical ? 0.76 : 0.44);
    const maxH = H * (vertical ? 0.4 : 0.62);
    const s = Math.min(maxW / im.img.width, maxH / im.img.height);
    const w = im.img.width * s;
    const h = im.img.height * s;
    const cx = vertical ? W / 2 : W * 0.3;
    const cy = vertical ? H * 0.61 : H * 0.55;
    const block = { x: vertical ? W * 0.06 : W * 0.04, y: cy - h / 2 - 40 * u, w: vertical ? W * 0.88 : W * 0.52, h: h + 80 * u };
    b.plugin = { id: "reveal", im, rect: { x: cx - w / 2, y: cy - h / 2, w, h }, block, dir: b.index % 2 ? -1 : 1 };
    b.textCenter = vertical ? { x: W / 2, y: H * 0.2 } : { x: W * 0.74, y: H * 0.5 };
    b.maxTextWidth = vertical ? W * 0.9 : W * 0.42;
  },

  draw(r, b, t, exit) {
    const { ctx, u } = r;
    const { im, rect, block, dir } = b.plugin;
    const dt = t - b.visualAt;
    if (dt < 0) return;
    const fade = 1 - exit;
    const grow = easeInOutCubic(dt / 0.32);
    const shrink = easeInOutCubic((dt - 0.36) / 0.34);
    const shown = dt >= 0.3;
    if (shown) {
      const drift = 1 + 0.015 * Math.max(dt - 0.3, 0);
      const settle = 1.06 - 0.06 * easeOutCubic((dt - 0.3) / 0.6);
      const { canvas, pad } = r.stickerOf(im.img);
      const ks = rect.w / im.img.width;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
      ctx.scale(settle * drift, settle * drift);
      ctx.shadowColor = "rgba(0,0,0,0.28)";
      ctx.shadowBlur = 44 * u;
      ctx.shadowOffsetY = 20 * u;
      ctx.drawImage(canvas, -rect.w / 2 - pad * ks, -rect.h / 2 - pad * ks, canvas.width * ks, canvas.height * ks);
      ctx.shadowColor = "transparent";
      const g = (dt - 0.95) / 0.7;
      if (g > 0 && g < 1) {
        let sh = shineCache.get(canvas);
        if (!sh) {
          sh = createCanvas(canvas.width, canvas.height);
          shineCache.set(canvas, sh);
        }
        const sg = sh.getContext("2d");
        sg.globalCompositeOperation = "source-over";
        sg.clearRect(0, 0, sh.width, sh.height);
        const bx = (-0.4 + 1.8 * easeInOutCubic(g)) * sh.width;
        const grad = sg.createLinearGradient(bx - sh.width * 0.25, 0, bx + sh.width * 0.25, sh.height * 0.4);
        grad.addColorStop(0, "rgba(255,255,255,0)");
        grad.addColorStop(0.5, "rgba(255,255,255,0.75)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        sg.fillStyle = grad;
        sg.fillRect(0, 0, sh.width, sh.height);
        sg.globalCompositeOperation = "destination-in";
        sg.drawImage(canvas, 0, 0);
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = fade * 0.85;
        ctx.drawImage(sh, -rect.w / 2 - pad * ks, -rect.h / 2 - pad * ks, canvas.width * ks, canvas.height * ks);
      }
      ctx.restore();
    }
    if (grow > 0 && shrink < 1) {
      const x0 = dir > 0 ? block.x + block.w * shrink : block.x + block.w * (1 - grow);
      const x1 = dir > 0 ? block.x + block.w * grow : block.x + block.w * (1 - shrink);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.fillStyle = b.theme.accent;
      ctx.fillRect(Math.min(x0, x1), block.y, Math.abs(x1 - x0), block.h);
      ctx.restore();
    }
    void clamp01;
  },

  sfx: (b) => [
    { kind: "image_in", name: "swoosh", at: b.visualAt, gain: 0.6, priority: 2 },
    { kind: "punchline", name: "tick", at: b.visualAt + 1.0, gain: 0.45, priority: 1 },
  ],
};
