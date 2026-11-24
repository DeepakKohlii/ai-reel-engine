import fs from "node:fs/promises";
import { loadImage } from "@napi-rs/canvas";
import { assetPath, faceBlurred, findAsset, generateAsset, hostReference, imageProvider, listAssets, markUsed } from "../../library.js";
import { hash, pad } from "../../util.js";

const HEX = /^#[0-9a-f]{6}$/i;
const cleanLabel = (l) => String(l ?? "").replace(/%[^%]*%?/g, "").replace(/[~#*!^[\]]/g, "").replace(/\s+/g, " ").trim();
const PERSON = new Set(["model", "host"]);
const COLOURS =
  /\b(black|white|off white|ivory|cream|beige|tan|camel|brown|dark brown|cognac|chocolate|navy|blue|sky blue|olive|green|bottle green|sage|khaki|grey|gray|charcoal|silver|gold|maroon|burgundy|wine|red|rust|mustard|yellow|pink|peach|lavender|purple|teal)\b/i;

export function itemSpec(item, kind = "item") {
  const label = String(item.label ?? "");
  const colour = label.match(COLOURS)?.[0]?.toLowerCase();
  const tags = [...(item.asset_tags ?? [])];
  if (colour && !tags.some((t) => t.toLowerCase() === colour)) tags.push(colour);
  let prompt = String(item.asset_prompt ?? "")
    .replace(/,?\s*(in\s+)?light gr[ae]y( colou?r)?/gi, "")
    .trim();
  if (label && !COLOURS.test(prompt)) prompt = `${label.toLowerCase()}${prompt ? `, ${prompt}` : ""}`;
  return { kind, tags, prompt, label };
}

export const specKey = ({ tags = [], prompt = "", kind }) => hash({ tags, prompt, kind });

export function collectSpecs(script) {
  const specs = new Map();
  const add = (spec, where) => {
    const key = specKey(spec);
    const s = specs.get(key) ?? { ...spec, key, beats: [] };
    s.beats.push(where);
    specs.set(key, s);
  };
  (script.beats ?? []).forEach((b, i) => {
    const v = b.visual ?? {};
    if (v.kind === "asset") add({ kind: v.asset_kind || "model", tags: v.asset_tags ?? [], prompt: v.asset_prompt ?? "" }, i + 1);
    if (v.kind === "outfit" || v.kind === "compare" || v.kind === "flow") {
      for (const item of v.items ?? []) {
        const kind = (item.asset_tags ?? []).includes("model") ? "model" : "item";
        add(itemSpec(item, kind), i + 1);
      }
    }
  });
  if (script.cover?.model_tags?.length) {
    add({ kind: "model", tags: script.cover.model_tags, prompt: script.cover.model_prompt ?? "" }, "cover");
  }
  return [...specs.values()];
}

export async function resolveVisuals({ beats, picks = {}, generate = true, log = () => {} }) {
  const assets = await listAssets();
  const byId = new Map(assets.map((a) => [a.id, a]));
  const used = new Set();

  let lastModel = null;
  const resolve = async ({ tags = [], prompt = "", kind, reuse = false }) => {
    const key = specKey({ tags, prompt, kind });
    let asset = byId.get(picks[key]) ?? null;
    if (asset && /pollinations/.test(asset.source ?? "")) {
      const better = await findAsset(tags, { kind: asset.kind });
      if (better && !/pollinations/.test(better.source ?? "")) asset = better;
    }
    if (!asset) asset = await findAsset(tags, { kind, exclude: reuse || kind === "host" ? new Set() : used });
    const hostRef = kind === "host" ? await hostReference() : null;
    const canGenerate = generate && (kind !== "host" || hostRef);
    const genPrompt = prompt || (kind === "host" ? `standing, pose: ${tags.filter((t) => t !== "host").join(", ")}` : "");
    const lowQuality = asset && /pollinations/.test(asset.source ?? "") && imageProvider() !== "pollinations";
    if (lowQuality && genPrompt && canGenerate) asset = null;
    if (!asset && !(genPrompt && canGenerate)) asset = await findAsset(tags, { kind });
    if (!asset && genPrompt && canGenerate) {
      log(`Asset: generating ${kind} "${tags.join(", ")}"`);
      try {
        const same = kind === "model" && lastModel && /\bsame\b/i.test(genPrompt);
        if (same) log("  using the earlier model image as reference, so only the difference changes");
        asset = await generateAsset({ prompt: genPrompt, tags, kind, referenceIds: same ? [lastModel] : [] });
        byId.set(asset.id, asset);
      } catch (err) {
        log(`  couldn't generate it (${err.message})`);
      }
    }
    if (!asset) return null;
    if (generate && picks[key] !== asset.id) await markUsed(asset.id);
    picks[key] = asset.id;
    used.add(asset.id);
    if (asset.kind === "model") lastModel = asset.id;
    const file = PERSON.has(asset.kind) && asset.blurFace === true ? await faceBlurred(asset) : assetPath(asset);
    return { img: await loadImage(await fs.readFile(file)), key: asset.id };
  };

  const visuals = [];
  for (const [i, beat] of beats.entries()) {
    const v = beat.visual ?? { kind: "none" };
    const out = {
      kind: v.kind,
      layout: v.layout ?? "auto",
      style: v.style ?? "tiles",
      assetKind: v.asset_kind || "model",
      focus: v.focus ?? "full",
      exempt: v.exempt ?? "no",
      plinth: v.plinth ?? "no",
      images: [],
      colors: (v.colors ?? []).filter((c) => HEX.test(c.hex)),
    };
    if (v.kind === "asset") {
      const r = await resolve({ tags: v.asset_tags, prompt: v.asset_prompt, kind: out.assetKind });
      if (r) out.images.push(r);
    } else if (v.kind === "outfit" || v.kind === "compare" || v.kind === "flow") {
      for (const item of (v.items ?? []).slice(0, 4)) {
        const kind = (item.asset_tags ?? []).includes("model") ? "model" : "item";
        const r = await resolve(itemSpec(item, kind));
        if (r) out.images.push({ ...r, label: cleanLabel(item.label) });
      }
    }
    if (v.layout === "mosaic") {
      const heroKey = out.images[0]?.key;
      const pool = assets.filter((a) => a.kind === "item" && a.id !== heroKey);
      let seed = (i + 1) * 9301;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const chosen = pool.map((a) => [rnd(), a]).sort((x, y) => x[0] - y[0]).slice(0, 18).map(([, a]) => a);
      out.mosaic = [];
      for (const a of chosen) {
        try {
          out.mosaic.push({ img: await loadImage(await fs.readFile(assetPath(a))), key: a.id });
        } catch {}
      }
    }
    if (v.kind === "flow" && out.images.length < 2) out.kind = out.images.length ? "outfit" : "none";
    if (["asset", "outfit", "compare"].includes(v.kind) && !out.images.length) {
      if (generate) log(`  beat ${pad(i + 1)}: no image, showing ${out.colors.length ? "swatches" : "typography only"}`);
      out.kind = out.colors.length ? "swatches" : "none";
    }
    if (["swatches", "shades"].includes(v.kind) && !out.colors.length) out.kind = "none";
    visuals.push(out);
  }
  return { visuals, resolve };
}
