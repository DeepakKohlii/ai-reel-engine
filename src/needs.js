import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { appPrompt, findAsset, hostReference } from "./library.js";
import { itemSpec } from "./formats/editorial/assets.js";
import { hash, readJson } from "./util.js";

const LOW_QUALITY = /pollinations/;

export const HOST_REFERENCE_PROMPT = `Full-body studio fashion photo of a young Indian man, 24 years old, wheatish skin, short textured black hair with a slight side part, light stubble, sharp jawline, calm confident expression, looking straight at the camera. He wears his signature outfit: an oatmeal-cream cotton overshirt worn open, a fitted white ribbed tank top underneath, relaxed wide-leg black trousers, clean white leather sneakers, and a thin silver watch on his left wrist. Standing straight, facing the camera, arms relaxed at his sides. The whole body is visible from head to toe with some empty space above the head and below the feet. Plain, even light-grey seamless studio background, soft diffused studio lighting, no props, no text, no logos. Photorealistic, sharp focus, high detail, shot on a full-frame camera with a 50mm lens. Vertical 9:16.`;

export async function listNeeds({ slug } = {}) {
  const specs = new Map();
  const add = ({ kind, tags, prompt }, pack) => {
    const clean = [...new Set((tags ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean))].sort();
    if (!clean.length) return;
    const key = hash({ kind, tags: clean });
    const spec = specs.get(key) ?? { key, kind, tags: clean, prompt: "", packs: new Set() };
    if (prompt && !spec.prompt) spec.prompt = prompt;
    spec.packs.add(pack);
    specs.set(key, spec);
  };

  const slugs = slug ? [slug] : await fs.readdir(config.packsDir).catch(() => []);
  for (const slug of slugs) {
    const s = await readJson(path.join(config.packsDir, slug, "script.json"));
    if (s?.format !== "editorial") continue;
    for (const b of s.beats ?? []) {
      const v = b.visual ?? {};
      if (v.kind === "asset") add({ kind: v.asset_kind || "model", tags: v.asset_tags, prompt: v.asset_prompt }, s.title);
      if (v.kind === "outfit" || v.kind === "compare" || v.kind === "flow") {
        for (const it of v.items ?? []) {
          const kind = (it.asset_tags ?? []).includes("model") ? "model" : "item";
          add(itemSpec(it, kind), s.title);
        }
      }
    }
    if (s.cover?.model_tags?.length) add({ kind: "model", tags: s.cover.model_tags, prompt: s.cover.model_prompt }, s.title);
  }

  const hostRef = await hostReference();
  const needs = [];
  if (!hostRef && [...specs.values()].some((x) => x.kind === "host")) {
    needs.push({
      key: "host-ref",
      kind: "host",
      tags: ["host", "host-ref", "standing"],
      packs: [...new Set([...specs.values()].filter((x) => x.kind === "host").flatMap((x) => [...x.packs]))],
      status: "missing",
      needsYou: true,
      current: null,
      hostRef: null,
      prompt: HOST_REFERENCE_PROMPT,
    });
  }
  for (const spec of specs.values()) {
    const have = await findAsset(spec.tags, { kind: spec.kind });
    if (have && !LOW_QUALITY.test(have.source ?? "")) continue;
    const needsYou = spec.kind === "host" && !hostRef;
    const pose = spec.tags.filter((t) => t !== "host").join(", ");
    const subject =
      spec.prompt ||
      (spec.kind === "host"
        ? `the channel's host, a young Indian man, standing, pose: ${pose}`
        : `${spec.kind === "item" ? "a single garment" : spec.kind === "prop" ? "an object" : "a young Indian man"}: ${spec.tags.join(", ")}`);
    needs.push({
      key: spec.key,
      kind: spec.kind,
      tags: spec.tags,
      packs: [...spec.packs],
      status: have ? "upgrade" : "missing",
      needsYou,
      current: have ? `/library/${have.file}` : null,
      hostRef: spec.kind === "host" && hostRef ? `/library/${hostRef.file}` : null,
      prompt: appPrompt({ prompt: subject, kind: spec.kind, hasReference: spec.kind === "host" && !!hostRef }),
    });
  }
  const rank = (n) => (n.status === "missing" ? 0 : 2) + (n.kind === "host" ? 0 : 1);
  return needs.sort((a, b) => rank(a) - rank(b));
}
