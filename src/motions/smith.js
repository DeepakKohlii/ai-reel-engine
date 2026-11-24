import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askJson } from "../claude.js";
import { config } from "../config.js";
import { listAssets } from "../library.js";
import { CATALOG, PLUGINS, learnedDir, reloadLearned } from "./index.js";
import { renderPreviews } from "./preview.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const EXAMPLE = path.join(here, "callouts.js");

const API = `You write one motion for a reel renderer (Node, @napi-rs/canvas, 2D canvas API, 1080x1920 portrait, 30fps). A motion is an ES module whose default export is a layout plugin:

export default {
  id: "snake_case_id", name: "Short Name", group: "layout",
  when: "One sentence: which moment of a men's style reel it's for (Hinglish script lines).",
  needs: "What the beat must provide (e.g. kind outfit with 2-4 items, one product each).",
  fallback: "cards" | "float" | "sandwich" | "corner" | "side" | "hero",   // used when the beat is too short
  minBeat: seconds of voice it needs to play out (1.5-3),
  hold: extra seconds to hold after the words (0.3-0.6),
  accepts: (v) => boolean,          // v.images.length, v.assetKind ("model" | "item" | "prop"), v.kind
  geometry({ b, beat, W, H, u, vertical }) { ... },   // once per beat, before rendering
  timing(b) { ... },                // optional: after b.visualAt / b.t1 are known
  draw(r, b, t, exit) { ... },      // every frame
  sfx: (b) => [{ kind: "image_in" | "list_item" | "punchline", name: "pop" | "tick" | "swoosh" | "whoosh" | "boom", at: seconds, gain: 0.4-0.9, priority: 1-3 }],
  demo: { voiceover: "Hinglish line", text: "On-screen words with ONE ~hero~ word", seconds: 3, visual: { kind: "asset" | "outfit" | "compare", asset_kind: "item" | "prop" | "model", asset_tags: [...], items: [{ label: "short", tags: [...] }], callouts: [] } },
};

geometry(): b.visual.images is [{ img, label, key }] (img is a loaded image with .width/.height; products and props are transparent cutouts). Store everything draw() needs in b.plugin = { id: "<same id>", ... } (plain numbers/objects and the image objects only; no canvases). Set b.textCenter = { x, y } and b.maxTextWidth for the words: the headline sits at about y = 0.2H across the top (0.05H-0.32H is theirs), so keep your visuals between about 0.34H and 0.87H (Instagram's buttons cover the bottom 13%) and inside 0.04W-0.96W. u = 1 at 1080 wide: multiply every pixel size by u.
draw(): r.ctx is the 2D context (always ctx.save()/ctx.restore() around your changes), r.W, r.H, r.u, r.stickerOf(img) returns { canvas, pad } (the cutout with a white die-cut border; draw canvas at scale rect.w / img.width, offset by pad). t is the reel time in seconds; animate from dt = t - b.visualAt (entrance starts at 0), finish the move within about b.t1 - b.visualAt - 0.4, then keep a slow drift so the frame never freezes. exit goes 0 -> 1 over the beat's last 0.14s: multiply alpha by (1 - exit). Colours come from b.theme: bg, ink (text), accent (hero colour) — never hard-code a palette (white #FFFFFF, near-black and a red/green stamp are fine). b.index is the beat number (use it to vary direction). Fonts available: "Oswald SemiBold", "Inter Bold", "Caveat" (handwriting), "Instrument Serif Italic"; always add "Symbols" as a fallback family.
Allowed imports ONLY: "../kit.js" (clamp01, easeOutCubic, easeInCubic, easeInOutCubic, easeOutBack, seeded(seed) -> random 0-1 function, isLight(hex), mix(hexA, hexB, k), drawCard(ctx, u, theme, { img, w, h, label, sticker }) draws a framed photo card centred on 0,0, penStroke(ctx, pts, k, { color, width }) draws a marker line through [[x,y],...] up to fraction k, loopPoints(cx, cy, rx, ry, seed) hand-drawn circle points, opaqueAt(img, fx, fy) whether the cutout has pixels there) and "@napi-rs/canvas" (createCanvas, only if you truly need an offscreen canvas; cache it in a module-level WeakMap).
Rules: frames must be deterministic (no Math.random, Date, timers; use seeded()). No file, network, process or dynamic import access. Keep it one self-contained file under 250 lines. It must look premium and clean: no clutter, generous spacing, smooth easing, nothing overlapping the headline area. Adapt the idea to products and outfits (shoes, jeans, shirts, watches, belts) rather than copying the source's content.`;

const SPEC = {
  type: "object",
  additionalProperties: false,
  required: ["buildable", "reason", "code"],
  properties: {
    buildable: { type: "boolean", description: "false if this idea isn't a visual motion this renderer can do well (e.g. it needs video footage, 3D, or is really a colour/font choice)" },
    reason: { type: "string" },
    code: { type: "string", description: "The whole module source, or \"\" when not buildable" },
  },
};

const QA = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "problems", "code"],
  properties: {
    ok: { type: "boolean", description: "true only if it looks clean, premium and like the reference idea" },
    problems: { type: "string" },
    code: { type: "string", description: "When not ok: the whole fixed module source. \"\" when ok." },
  },
};

const ALLOWED_IMPORTS = new Set(["../kit.js", "@napi-rs/canvas"]);
const BANNED = /\b(process|require|child_process|eval|Function\s*\(|fetch|XMLHttpRequest|globalThis|WebSocket|setTimeout|setInterval|Math\.random|Date|readFile|writeFile)\b|import\s*\(/;

export function checkCode(code) {
  const problems = [];
  for (const [, from] of code.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)) if (!ALLOWED_IMPORTS.has(from)) problems.push(`import from "${from}" isn't allowed`);
  if (/^\s*import\s+["']/m.test(code)) problems.push("bare imports aren't allowed");
  const banned = code.match(BANNED);
  if (banned) problems.push(`"${banned[0]}" isn't allowed`);
  if (!/export\s+default\s*\{/.test(code)) problems.push("the default export must be the plugin object");
  if (code.split("\n").length > 320) problems.push("too long (keep it under 250 lines)");
  return problems;
}

export function testRender(id, outDir) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, "test-motion.mjs"), id, outDir], { cwd: config.root, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 120000);
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const res = JSON.parse(out.trim().split("\n").at(-1));
        resolve(res);
      } catch {
        resolve({ ok: false, error: (err || out || `exited with ${code}`).split("\n").filter((l) => !/injected env/.test(l)).slice(-8).join("\n") || "timed out" });
      }
    });
  });
}

async function libraryTags() {
  const assets = await listAssets();
  const pick = (kind) => [...new Set(assets.filter((a) => a.kind === kind).map((a) => (a.tags ?? []).join(",")))].slice(0, 40).join(" | ");
  return `Images available for the demo (use these tags): items: ${pick("item")}\nprops: ${pick("prop")}\nmodels: ${pick("model")}`;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "motion";

async function buildOne(idea, style, log) {
  const sheets = (style.sheets ?? []).map((s) => path.join(config.root, "assets", "styles", style.id, s));
  const example = await fs.readFile(EXAMPLE, "utf8");
  const taken = new Set(CATALOG.map((m) => m.id));
  let id = slug(idea.title);
  for (let n = 2; taken.has(id); n++) id = `${slug(idea.title).slice(0, 21)}_${n}`;
  const task = [
    `Build this motion, seen in the reel "${style.name}" (the contact sheets show that reel's frames in time order):`,
    `${idea.title}: ${idea.description}\nWhy it fits: ${idea.why_it_fits}`,
    `Use id "${id}". The motions the engine already has (don't rebuild one of these): ${CATALOG.map((m) => m.name).join(", ")}.`,
    await libraryTags(),
    `A good example motion file, for the shape and quality bar (its imports are "./kit.js" because it lives one folder up; yours must import "../kit.js"):\n\`\`\`js\n${example}\n\`\`\``,
  ].join("\n\n");
  const first = await askJson({ system: API, task, schema: SPEC, effort: "high", images: sheets.slice(0, 3) });
  if (!first.buildable || !first.code.trim()) {
    log(`  "${idea.title}": skipped (${first.reason})`);
    return null;
  }
  const file = new URL(`${id}.js`, learnedDir);
  const work = path.join(config.root, "assets", "motions", ".work", id);
  let code = first.code;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const problems = checkCode(code);
    let feedback = "";
    if (problems.length) feedback = `The code was rejected: ${problems.join("; ")}.`;
    else {
      await fs.writeFile(file, code);
      await fs.rm(work, { recursive: true, force: true });
      const res = await testRender(id, work);
      if (!res.ok) feedback = `It failed to load or render: ${res.error}`;
      else {
        log(`  "${idea.title}": rendered, checking how it looks`);
        const qa = await askJson({
          system: API,
          task: `These stills (in time order: ${res.times.join("s, ")}s into the demo beat) are your motion "${id}" rendering its demo; the other images are the reference reel. Is it clean, premium, readable, inside the safe area, not overlapping the headline, and recognisably the idea "${idea.title}"? If not, return the whole fixed module.\n\nCurrent code:\n\`\`\`js\n${code}\n\`\`\``,
          schema: QA,
          effort: "high",
          images: [...res.files, ...sheets.slice(0, 1)],
        });
        if (qa.ok) {
          await fs.rm(work, { recursive: true, force: true });
          return id;
        }
        log(`  "${idea.title}": needs work (${qa.problems.slice(0, 140)})`);
        if (!qa.code.trim()) break;
        code = qa.code;
        continue;
      }
    }
    if (attempt === 3) break;
    log(`  "${idea.title}": fixing (${feedback.slice(0, 140)})`);
    const fix = await askJson({ system: API, task: `${task}\n\nYour previous version:\n\`\`\`js\n${code}\n\`\`\`\n\n${feedback}\nReturn the whole fixed module.`, schema: SPEC, effort: "high" });
    if (!fix.buildable || !fix.code.trim()) break;
    code = fix.code;
  }
  await fs.rm(file, { force: true });
  await fs.rm(work, { recursive: true, force: true });
  log(`  "${idea.title}": couldn't get it right, skipped`);
  return null;
}

export async function buildLearnedMotions(style, log = () => {}) {
  const ideas = (style.card?.worth_building ?? []).slice(0, 3);
  if (!ideas.length) return [];
  await fs.mkdir(learnedDir, { recursive: true });
  log(`Building ${ideas.length} motion${ideas.length > 1 ? "s" : ""} from this reel for the Motion library`);
  const kept = [];
  for (const idea of ideas) {
    try {
      const id = await buildOne(idea, style, log);
      if (!id) continue;
      await fs.writeFile(new URL(`${id}.json`, learnedDir), JSON.stringify({ styleId: style.id, styleName: style.name, idea: idea.title, at: Date.now() }, null, 2));
      kept.push(id);
    } catch (err) {
      log(`  "${idea.title}": failed (${err.message})`);
    }
  }
  if (!kept.length) return kept;
  await reloadLearned();
  log("Rendering preview clips for the new motions");
  await renderPreviews(kept, log);
  log(`Added to the Motion library: ${kept.map((id) => PLUGINS[id]?.name ?? id).join(", ")} (new: watch and rate them)`);
  return kept;
}
