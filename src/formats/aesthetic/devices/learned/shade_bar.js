import { clamp01, easeInOut, easeOut, label } from "../kit.js";

export default {
  id: "shade_bar",
  name: "Shade bar",
  when: "Shades of one colour family worn together (grey with black, beige on beige).",
  uses: "color = '#light|#dark', text = label (SAME FAMILY), side = which side of him",
  draw(ctx, d) {
    const [c0, c1] = String(d.cue.color || "#D9D9D6|#141414").split("|");
    const right = d.cue.side !== "left";
    const span = d.span("chest");
    const x = right ? Math.min(span.x1 + 120, d.W - 110) : Math.max(span.x0 - 120, 110);
    const top = d.H * 0.3;
    const len = d.H * 0.36;
    const k = easeInOut(d.dt / 0.6);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.12)";
    ctx.shadowBlur = 16;
    const gr = ctx.createLinearGradient(0, top, 0, top + len);
    gr.addColorStop(0, c0);
    gr.addColorStop(1, c1);
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.roundRect(x - 26, top, 52, len * k, 26);
    ctx.fill();
    ctx.shadowColor = "transparent";
    for (const [f, delay] of [[0.22, 0.6], [0.86, 0.8]]) {
      const mk = easeOut((d.dt - delay) / 0.35);
      if (mk <= 0) continue;
      const y = top + len * f;
      ctx.globalAlpha = mk;
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y, 18 * mk, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (d.cue.text) label(ctx, d.cue.text, x, top + len + 46, d.theme, { size: 22, alpha: clamp01((d.dt - 0.9) / 0.3) });
    ctx.restore();
  },
  sfx: [{ name: "sweep", at: 0, gain: 0.28 }, { name: "pop", at: 0.6, gain: 0.25 }, { name: "pop", at: 0.8, gain: 0.25 }],
};
