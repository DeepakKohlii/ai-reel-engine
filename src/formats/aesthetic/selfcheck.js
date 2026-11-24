import fs from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { askJson } from "../../claude.js";
import { readJson, writeJson } from "../../util.js";
import { Renderer } from "./engine.js";
import { PART_NAMES, partName } from "./body.js";
import { principles } from "./style.js";

const FIXES = {
  type: "object",
  additionalProperties: false,
  required: ["problems"],
  properties: {
    problems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["scene", "problem", "fix", "part", "at_word", "outfit", "overlay"],
        properties: {
          scene: { type: "integer", description: "1-based scene number" },
          problem: { type: "string", description: "What's wrong, in one plain sentence" },
          fix: { type: "string", enum: ["add_zoom", "no_auto_zoom", "set_outfit", "drop_overlay", "drop_all_overlays", "make_look", "none"] },
          part: { type: "string", enum: ["", ...PART_NAMES], description: "add_zoom: the body part" },
          at_word: { type: "string", description: "add_zoom: the spoken word it lands on" },
          outfit: { type: "string", description: "set_outfit: the outfit key" },
          overlay: { type: "integer", description: "drop_overlay: 0-based overlay index; else -1" },
        },
      },
    },
  },
};

async function sheets(tl, dir) {
  const r = new Renderer(tl);
  const fw = 180;
  const fh = 320;
  const per = 3;
  const rowsPerSheet = 4;
  const files = [];
  const scenes = tl.scenes;
  for (let s0 = 0; s0 < scenes.length; s0 += rowsPerSheet * 2) {
    const group = scenes.slice(s0, s0 + rowsPerSheet * 2);
    const rows = Math.ceil(group.length / 2);
    const c = createCanvas(fw * per * 2 + 20, rows * (fh + 46));
    const g = c.getContext("2d");
    g.fillStyle = "#000";
    g.fillRect(0, 0, c.width, c.height);
    group.forEach((s, k) => {
      const x0 = (k % 2) * (fw * per + 20);
      const y0 = Math.floor(k / 2) * (fh + 46);
      [s.t0 + 0.15, (s.t0 + s.t1) / 2, s.t1 - 0.12].forEach((t, j) => g.drawImage(r.frame(t), x0 + j * fw, y0, fw, fh));
      g.fillStyle = "#FF0";
      g.font = "16px sans-serif";
      g.fillText(`${s.index + 1} ${s.type}: ${s.words.map((w) => w.text).join(" ")}`.slice(0, 74), x0 + 4, y0 + fh + 18);
      g.fillStyle = "#AAA";
      g.fillText(`${s.t0.toFixed(1)}-${s.t1.toFixed(1)}s`, x0 + 4, y0 + fh + 38);
    });
    const f = path.join(dir, `review-${files.length + 1}.png`);
    await fs.writeFile(f, c.toBuffer("image/png"));
    files.push(f);
  }
  return files;
}

export async function selfCheck(dir, script, { tl }, log = () => {}) {
  const work = path.join(dir, "review");
  await fs.mkdir(work, { recursive: true });
  const files = await sheets(tl, work);
  const list = script.scenes.map((sc, i) => `${i + 1}. ${sc.type}${sc.outfit ? ` (${sc.outfit})` : ""}: "${sc.lines.map((l) => script.lines[l].voiceover).join(" ")}" | graphics: ${(sc.overlays ?? []).map((o, k) => `[${k}] ${o.kind}${o.text ? ` "${o.text}"` : ""} on "${o.at_word}"`).join("; ") || "none"}`).join("\n");
  const res = await askJson({
    system: "You are the strict reviewer of a short style reel. The creator has already told us, many times, what they reject; your job is to catch every one of those problems in the frames before they see it, and fix it. Each row of stills is one scene: its start, middle and end, with the words spoken under it. Report only real problems you can see, each with one fix from the menu.",
    task: [
      `What the creator likes and rejects (follow every line):\n${principles()}`,
      `Outfits: ${(script.outfits ?? []).map((o) => `${o.key}: ${o.description}`).join(" | ")}`,
      `Scenes:\n${list}`,
      "Check especially: does each frame show what its words say at that moment (the garment, the part, the shoes)? Is anything rushed, cluttered or bland (the same full-body shot for long)? Text over the model? Circles or graphics that aren't needed? A label about something not on screen?",
    ].join("\n\n"),
    schema: FIXES,
    effort: "high",
    images: files,
  });
  let changed = 0;
  const keys = new Set((script.outfits ?? []).map((o) => o.key));
  for (const p of res.problems ?? []) {
    const sc = script.scenes[p.scene - 1];
    if (!sc || p.fix === "none") continue;
    const base = { text: "", status: "", part: "chest", to_part: "", side: "center", target: "", item: "", color: "" };
    if (p.fix === "add_zoom" && p.part && p.at_word) sc.overlays = [...(sc.overlays ?? []), { ...base, kind: "zoom", at_word: p.at_word, part: partName(p.part) }];
    else if (p.fix === "no_auto_zoom") sc.no_auto_zoom = true;
    else if (p.fix === "set_outfit" && keys.has(p.outfit)) sc.outfit = p.outfit;
    else if (p.fix === "drop_overlay" && p.overlay >= 0) sc.overlays = (sc.overlays ?? []).filter((_, k) => k !== p.overlay);
    else if (p.fix === "drop_all_overlays") sc.overlays = [];
    else if (p.fix === "make_look" && sc.type === "reference" && sc.outfit) sc.type = "look";
    else continue;
    changed++;
    log(`  Fixed scene ${p.scene}: ${p.problem.slice(0, 140)}`);
  }
  await fs.rm(work, { recursive: true, force: true });
  return { changed, problems: res.problems ?? [] };
}
