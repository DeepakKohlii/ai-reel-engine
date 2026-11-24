import { askJson } from "./claude.js";

const RULES = {
  mixed: `- Hindi/Urdu words: Devanagari (pair -> पैर, hai -> है, mein -> में, kapde -> कपड़े, tumhe -> तुम्हें).
- English words stay in English letters exactly as normally spelled (baggy jeans, chunky, sneakers, shoes, canvas, list, comments, return, style).
- Short forms stay as written (DM, SHOES, T-shirt); money and numbers as the words spoken (₹4K -> चार हज़ार).
- End sentences with । (danda), keep commas and question marks: they drive the pauses.
Example: "Agli baar baggy jeans pehno, usse pehle ye dekh lo." -> "अगली बार baggy jeans पहनो, उससे पहले ये देख लो।"`,
  devanagari: `- Everything in Devanagari, spelled the way it's said, English words included (baggy -> बैगी, jeans -> जींस, shoes -> शूज़, canvas -> कैनवस, DM -> डी एम, 4K -> चार हज़ार).
- Keep all punctuation; it drives the pauses.`,
};

const system = (mode) => `You prepare Hinglish voiceover lines for an Indian text-to-speech voice, so every word is pronounced the way a young urban Indian guy says it.
${RULES[mode] ?? RULES.mixed}
- Keep the exact meaning and word order; don't add, drop or translate anything.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lines"],
  properties: { lines: { type: "array", items: { type: "string" } } },
};

export async function makeSpeakable(lines, mode = "mixed") {
  const task = `Rewrite these ${lines.length} lines (same count, same order):\n${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}`;
  const { lines: out } = await askJson({ system: system(mode), task, schema: SCHEMA, effort: "low" });
  if (!Array.isArray(out) || out.length !== lines.length) throw new Error("Speakable rewrite returned the wrong number of lines");
  return out.map((l, i) => String(l || lines[i]).trim());
}

export function remapWords(narration, romanLines) {
  const lines = narration.lines.map((ws, i) => {
    const roman = String(romanLines[i] ?? "").split(/\s+/).filter(Boolean);
    if (!ws?.length || !roman.length) return ws ?? [];
    const start = ws[0].start;
    const end = ws.at(-1).end;
    const weights = roman.map((w) => w.length + 2);
    const total = weights.reduce((a, b) => a + b, 0);
    let t = start;
    return roman.map((text, k) => {
      const len = ((end - start) * weights[k]) / total;
      const w = { text, start: t, end: t + len * 0.92 };
      t += len;
      return w;
    });
  });
  return { ...narration, lines };
}
