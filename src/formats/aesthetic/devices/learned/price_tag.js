import { clamp01, easeOut, label } from "../kit.js";

export default {
  id: "price_tag",
  name: "Swinging price tag",
  when: "A price or cost is said (what something costs, 'expensive', a budget).",
  uses: "part = what it prices, side = left/right, text = the price",
  draw(ctx, d) {
    const side = d.cue.side === "left" ? "left" : "right";
    const p = d.at(d.cue.part || "chest", side);
    const dir = side === "left" ? -1 : 1;
    const span = d.span(d.cue.part || "chest");
    const ax = (side === "left" ? span.x0 - 70 : span.x1 + 70);
    const anchor = { x: ax, y: Math.max(40, p.y - 260) };
    const drop = easeOut(d.dt / 0.45);
    const ang = d.dt < 0.45 ? 0.5 * dir : 0.5 * dir * Math.exp(-(d.dt - 0.45) * 3.2) * Math.cos((d.dt - 0.45) * 9);
    const len = 230 * drop + 10;
    const tx = anchor.x + Math.sin(ang) * len;
    const ty = anchor.y + Math.cos(ang) * len - (1 - drop) * 300;
    ctx.save();
    ctx.globalAlpha = clamp01(d.dt / 0.12);
    ctx.strokeStyle = "rgba(30,30,28,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(anchor.x, anchor.y - (1 - drop) * 300);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.translate(tx, ty);
    ctx.rotate(-ang * 0.6);
    const w = 170, h = 82;
    ctx.shadowColor = "rgba(0,0,0,0.16)";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = "#FBF7EE";
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 22, 0);
    ctx.lineTo(w / 2 - 22, 0);
    ctx.lineTo(w / 2, 20);
    ctx.lineTo(w / 2, h);
    ctx.lineTo(-w / 2, h);
    ctx.lineTo(-w / 2, 20);
    ctx.closePath();
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.fillStyle = "rgba(30,30,28,0.35)";
    ctx.beginPath();
    ctx.arc(0, 14, 5, 0, Math.PI * 2);
    ctx.fill();
    label(ctx, d.cue.text || "₹ —", 0, 52, d.theme, { size: 30 });
    ctx.restore();
  },
  sfx: [{ name: "swoosh", at: 0, gain: 0.28 }, { name: "tick", at: 0.45, gain: 0.3 }],
};
