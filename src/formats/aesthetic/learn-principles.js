import fs from "node:fs/promises";
import path from "node:path";
import { askJson } from "../../claude.js";
import { config } from "../../config.js";
import { DEVICES } from "./devices/index.js";
import { principles } from "./style.js";

const file = path.join(config.root, "assets", "aesthetic-principles.md");

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["new_principles", "device_ideas"],
  properties: {
    new_principles: { type: "array", items: { type: "string" }, description: "0-5 short principles this reel teaches that the current list doesn't already say (the why, in general terms; never its exact layout or content)" },
    device_ideas: {
      type: "array",
      description: "0-2 animations it uses that our engine lacks, that would help explain clothes in OTHER reels too",
      items: { type: "object", additionalProperties: false, required: ["id", "name", "description", "used_for"], properties: { id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, used_for: { type: "string" } } },
    },
  },
};

export async function learnPrinciples(style, { sheets = [], transcript = "", log = () => {} } = {}) {
  const res = await askJson({
    system: "You are a creative director who studies reference reels to understand WHY they work, so an engine can design new, original reels for a men's style channel. Think in principles (structure, hierarchy, pacing, proof, motion that explains, type, colour), not templates. Be selective: only what is genuinely new and transferable.",
    task: [
      `A new reference reel: "${style.name}". ${style.card?.summary ?? ""}`,
      transcript && `What it says: ${transcript}`,
      `What the engine already knows:\n${principles()}`,
      `Devices the engine already has: ${Object.values(DEVICES).map((d) => d.name).join(", ")} (plus pills, notes, dots, dashed guides, zoom rings, swatches + cursor, scale bar, product cards, photo cards, before/now, piece-by-piece builds).`,
      "The contact sheets show its frames in order. What does it teach that's new?",
    ].filter(Boolean).join("\n\n"),
    schema: SCHEMA,
    effort: "high",
    images: sheets.slice(0, 3),
  });
  const added = (res.new_principles ?? []).map((p) => p.trim()).filter(Boolean).slice(0, 5);
  if (added.length) {
    await fs.appendFile(file, `\n## Learned from "${style.name}"\n${added.map((p) => `- ${p}`).join("\n")}\n`);
    log(`Aesthetic engine: learned ${added.length} new principle${added.length > 1 ? "s" : ""}`);
  }
  const built = [];
  if ((res.device_ideas ?? []).length) {
    const { buildDevice } = await import("./devices/smith.js");
    for (const idea of res.device_ideas.slice(0, 2)) {
      const id = await buildDevice(idea, log).catch(() => null);
      if (id) built.push(id);
    }
  }
  return { added, built };
}
