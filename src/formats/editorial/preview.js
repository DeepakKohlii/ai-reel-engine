import { resolveVisuals } from "./assets.js";
import { buildTimeline, stillAt } from "./motion.js";

export async function previewBeat({ beat, aspect = "9:16", prevTheme = null, palette = [], typeset = "editorial", look = {} }) {
  const words = String(beat.voiceover ?? "").split(/\s+/).filter(Boolean);
  let t = 0.05;
  const line = words.map((w) => {
    const o = { text: w, start: t + 1, end: t + 1.25 };
    t += 0.28;
    return o;
  });
  const { visuals } = await resolveVisuals({ beats: [beat], generate: false });
  const tl = buildTimeline({
    beats: [{ ...beat, text: "", visual: { kind: "none" }, theme: prevTheme ?? beat.theme }, beat],
    narration: { duration: t + 1.6, lines: [[{ text: "", start: 0, end: 0 }], line] },
    visuals: [{ kind: "none", images: [], colors: [] }, visuals[0]],
    aspect,
    palette,
    typeset,
    look,
  });
  return stillAt(tl, tl.total - 0.35);
}
