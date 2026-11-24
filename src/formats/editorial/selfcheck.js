import fs from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { askJson } from "../../claude.js";
import { ffmpeg, readJson, writeJson } from "../../util.js";
import { schema } from "./index.js";

const MOTIONS = beatPropsEarly().motion.enum.join(" | ");
const LAYOUTS = beatPropsEarly().visual.properties.layout.enum.join(" | ");
function beatPropsEarly() {
  return schema.properties.beats.items.properties;
}

const QA = `You are the final quality check for a short Instagram reel (men's style, India) before the creator sees it. You get contact sheets: each tile is one moment of the reel, labelled with its beat number and whether it's mid-animation or settled. Be strict and practical: flag only things a viewer would notice or that look amateur.

Check every beat for:
- Text covering a face or the thing the line is about (shoes, the garment being discussed).
- Text that's cut off, overlapping other text, or unreadable against what's behind it.
- A model that's too small to read, badly cropped, or with shoes cut off when shoes matter.
- Image animations that look clumsy or cheap (odd pedestals, awkward tilts, jarring jumps), and visuals that don't match the words.
- Empty or dead-looking frames, and anything that looks broken or glitchy.
- Not showing the subject: a reel about shoes (or any item) showing full-body models instead of the item, or models on too many beats (more than about a third). Fix with focus lower (for shoes/bottoms) or "manual" for a product shot.
- Any words sitting behind or over a model (a standing rule: words go beside or above him). Fix with layout side (and align away from him) or layout hero.
- A text-only beat that feels empty: suggest "manual" with a product for the bottom-right corner (layout corner).
- A line about a list, options or several items that doesn't show the items (it should show them as photo cards: flag it as "manual" with the items to show).
- Anything that goes against the creator's taste listed below.

For each problem, give the smallest fix as ONE beat field set to EXACTLY one of its allowed values (copy the value word for word; anything else can't be applied):
- camera: none | punch | rotate
- transition: cut | letter
- hero_size: normal | giant
- ghost: no | yes
- motion: ${MOTIONS}
- align: left | right | center   (which side the words sit; the image goes to the other side)
- layout: ${LAYOUTS}
- focus: full | lower | upper   (full = head to toe, lower = waist down, upper = chest up)
- plinth: no | yes
- image: product   (the picture is empty, wrong or doesn't match the line: swap it for the reel's own main product, tucked in the corner)
What the layouts do (so a fix doesn't make things worse): sandwich = the model stands inside the words and the hero word may tuck BEHIND him (never use it to fix text overlapping a model); side = model on one side, words on the other (the usual fix for text over a model: set align to the side away from him); hero = outfit under a headline; float = image below the words; cards = photo cards under the words; closeup = chest-up with a giant word.
Use field "manual" (value = what to change) only when it needs a new image or different words. Frames labelled "moving" are mid-transition on purpose (a letter fly-through or camera move): judge readability on the settled frames. Don't flag things that are fine.`;

const FIXABLE = ["camera", "transition", "hero_size", "ghost", "motion", "align", "layout", "focus", "plinth", "image", "manual"];
const REPORT = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "issues"],
  properties: {
    verdict: { type: "string", description: "One or two sentences on the reel's overall state" },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["beat", "severity", "problem", "field", "value"],
        properties: {
          beat: { type: "integer" },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          problem: { type: "string" },
          field: { type: "string", enum: FIXABLE },
          value: { type: "string", description: "The new value for the field (or what to change, for manual)" },
        },
      },
    },
  },
};

const beatProps = schema.properties.beats.items.properties;
const allowed = (field, value) => {
  if (field === "image") return value === "product";
  const spec = ["layout", "focus", "plinth"].includes(field) ? beatProps.visual.properties[field] : beatProps[field];
  return spec?.enum?.includes(value);
};

async function frames(dir, script, work) {
  const tl = await readJson(path.join(dir, "timeline.json"));
  const cut = path.join(dir, "rough-cut.mp4");
  const shots = [];
  tl.scenes.forEach((s, i) => {
    const b = script.beats[i] ?? {};
    const settle = b.transition === "letter" || b.camera === "rotate" ? 0.55 : 0.2;
    shots.push({ beat: i + 1, label: `B${i + 1}`, t: s.start + Math.max(s.duration - settle, s.duration * 0.6) });
    if ((b.camera && b.camera !== "none") || b.transition === "letter") shots.push({ beat: i + 1, label: `B${i + 1} moving`, t: s.start + s.duration - 0.25 });
    else if (s.duration > 1.2) shots.push({ beat: i + 1, label: `B${i + 1} early`, t: s.start + 0.45 });
  });
  for (const [k, sh] of shots.entries()) {
    sh.file = path.join(work, `q${String(k).padStart(3, "0")}.png`);
    await ffmpeg(["-ss", Math.max(sh.t, 0).toFixed(2), "-i", cut, "-frames:v", "1", "-vf", "scale=240:-2", sh.file]);
  }
  return shots;
}

async function sheets(shots, work) {
  const out = [];
  const cols = 6;
  const rows = 3;
  for (let s = 0; s * cols * rows < shots.length; s++) {
    const chunk = shots.slice(s * cols * rows, (s + 1) * cols * rows);
    const first = await loadImage(await fs.readFile(chunk[0].file));
    const c = createCanvas(cols * first.width, Math.ceil(chunk.length / cols) * first.height);
    const g = c.getContext("2d");
    for (const [i, sh] of chunk.entries()) {
      const img = await loadImage(await fs.readFile(sh.file));
      const x = (i % cols) * first.width;
      const y = Math.floor(i / cols) * first.height;
      g.drawImage(img, x, y, first.width, first.height);
      g.fillStyle = "rgba(0,0,0,0.8)";
      g.fillRect(x, y, 118, 28);
      g.fillStyle = "#FFE14D";
      g.font = "bold 18px Inter";
      g.fillText(sh.label, x + 6, y + 20);
    }
    const file = path.join(work, `sheet-${s + 1}.png`);
    await fs.writeFile(file, c.toBuffer("image/png"));
    out.push(file);
  }
  return out;
}

function mainProduct(script) {
  const beats = script.beats ?? [];
  const asset = beats.map((b) => b.visual).find((v) => v?.kind === "asset" && v.asset_kind === "item" && v.asset_tags?.length);
  if (asset) return asset;
  return beats.flatMap((b) => (b.visual?.items ?? []).filter((it) => !(it.asset_tags ?? []).includes("model")))[0] ?? null;
}

export async function selfCheck(dir, script, log) {
  const work = path.join(dir, "selfcheck");
  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(work, { recursive: true });
  log("Self-check: looking at every beat");
  const shots = await frames(dir, script, work);
  const images = await sheets(shots, work);
  const { prefsBrief } = await import("../../learn.js");
  const beats = script.beats
    .map((b, i) => `B${i + 1}: "${b.voiceover}" | on screen: ${b.text} | ${b.visual?.kind} ${b.visual?.layout} ${b.visual?.focus ?? ""} | camera ${b.camera ?? "none"}, transition ${b.transition ?? "cut"}, hero ${b.hero_size ?? "normal"}${b.visual?.plinth === "yes" ? ", plinth" : ""}`)
    .join("\n");
  const task = [(await prefsBrief()) || "", `The reel's beats:\n${beats}`].filter(Boolean).join("\n\n");
  const report = await askJson({ system: QA, task, schema: REPORT, effort: "high", images });

  let fixed = 0;
  for (const is of report.issues) {
    const b = script.beats[is.beat - 1];
    if (!b || is.field === "manual" || is.severity === "low" || !allowed(is.field, is.value)) continue;
    if (is.field === "image") {
      const product = mainProduct(script);
      if (!product) continue;
      is.before = structuredClone(b.visual);
      b.visual = { ...b.visual, kind: "asset", asset_kind: "item", layout: "corner", focus: "full", items: [], asset_tags: [...product.asset_tags], asset_prompt: product.asset_prompt ?? "" };
      is.applied = true;
      fixed++;
      continue;
    }
    const onVisual = ["layout", "focus", "plinth"].includes(is.field);
    is.before = onVisual ? b.visual[is.field] : b[is.field];
    if (onVisual) b.visual[is.field] = is.value;
    else b[is.field] = is.value;
    is.applied = true;
    fixed++;
  }
  script.qa = { at: Date.now(), verdict: report.verdict, issues: report.issues };
  await writeJson(path.join(dir, "script.json"), script);
  const open = report.issues.filter((i) => !i.applied && i.severity !== "low");
  log(`Self-check: ${report.issues.length} issue(s), ${fixed} fixed automatically${open.length ? `, ${open.length} need you` : ""}`);
  return { fixed, open, report };
}

export async function verifyFixes(dir, script, log) {
  const fixedBeats = [...new Set((script.qa?.issues ?? []).filter((i) => i.applied).map((i) => i.beat))];
  if (!fixedBeats.length) return 0;
  const work = path.join(dir, "selfcheck", "verify");
  await fs.mkdir(work, { recursive: true });
  log(`Self-check: re-checking the ${fixedBeats.length} fixed beat(s)`);
  const all = await frames(dir, script, work);
  const shots = all.filter((s) => fixedBeats.includes(s.beat));
  const images = await sheets(shots, work);
  const beats = fixedBeats.map((n) => { const b = script.beats[n - 1]; return `B${n}: "${b.voiceover}" | on screen: ${b.text} | ${b.visual?.kind} ${b.visual?.layout}`; }).join("\n");
  const report = await askJson({ system: QA, task: `These beats were just changed to fix problems. Report only problems that are still there (or new ones the change caused).\n${beats}`, schema: REPORT, effort: "high", images });
  let undone = 0;
  for (const n of fixedBeats) {
    const bad = report.issues.find((i) => i.beat === n && i.severity !== "low");
    if (!bad) continue;
    const b = script.beats[n - 1];
    for (const is of script.qa.issues.filter((i) => i.beat === n && i.applied)) {
      if (is.field === "image") b.visual = is.before;
      else if (["layout", "focus", "plinth"].includes(is.field)) b.visual[is.field] = is.before;
      else b[is.field] = is.before;
      is.applied = false;
      is.problem = `${is.problem} (tried ${is.field} = ${is.value}, it didn't help: ${bad.problem})`;
      is.value = bad.field === "manual" ? bad.value : `${bad.field} = ${bad.value}`;
      undone++;
    }
  }
  await writeJson(path.join(dir, "script.json"), script);
  log(`Self-check: ${fixedBeats.length - new Set(script.qa.issues.filter((i) => !i.applied && fixedBeats.includes(i.beat)).map((i) => i.beat)).size} fix(es) confirmed${undone ? `, ${undone} undone (needs you)` : ""}`);
  return undone;
}
