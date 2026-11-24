import { clamp01, easeInOut, easeOut, label, line } from "./kit.js";

export default {
  id: "measure",
  name: "Tape measure",
  when: "A length or position rule (where a hem should end, how long a sleeve is, a gap of two fingers).",
  uses: "part = where it starts, cue.to_part = where it ends, text = the label",
  draw(ctx, d) {
    const side = d.cue.side === "left" ? "left" : "right";
    const a = d.at(d.cue.part || "waist", side);
    const b = d.at(d.cue.to_part || "knees", side);
    const spans = [d.span(d.cue.part || "waist"), d.span(d.cue.to_part || "knees")];
    const x = side === "right" ? Math.max(...spans.map((p) => p.x1)) + 34 : Math.min(...spans.map((p) => p.x0)) - 34;
    const top = { x, y: Math.min(a.y, b.y) };
    const bot = { x, y: Math.max(a.y, b.y) };
    const k = easeInOut(d.dt / 0.7);
    ctx.save();
    const len = (bot.y - top.y) * k;
    ctx.fillStyle = d.theme.accent;
    ctx.globalAlpha = 0.22;
    ctx.fillRect(x - 9, top.y, 18, len);
    ctx.globalAlpha = 1;
    for (let y = 0; y <= len; y += 24) line(ctx, { x: x - 9, y: top.y + y }, { x: x - 9 + (y % 120 === 0 ? 16 : 9), y: top.y + y }, 1, { color: d.theme.ink, width: 1.6 });
    line(ctx, { x: x - 22, y: top.y }, { x: x + 22, y: top.y }, clamp01(d.dt / 0.2), { color: d.theme.ink, width: 2.4 });
    if (k >= 1) line(ctx, { x: x - 22, y: bot.y }, { x: x + 22, y: bot.y }, 1, { color: d.theme.ink, width: 2.4 });
    if (d.cue.text) label(ctx, d.cue.text, x + (side === "right" ? 34 : -34), bot.y, d.theme, { align: side === "right" ? "left" : "right", alpha: easeOut((d.dt - 0.6) / 0.4) });
    ctx.restore();
  },
  sfx: [{ name: "sweep", at: 0, gain: 0.3 }, { name: "click", at: 0.7, gain: 0.35 }],
};
