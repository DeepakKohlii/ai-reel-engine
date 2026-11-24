import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askJson } from "../../../claude.js";
import { config } from "../../../config.js";
import { checkCode } from "../../../motions/smith.js";
import { DEVICES, learnedDir, loadDevices } from "./index.js";

const here = fileURLToPath(new URL(".", import.meta.url));

const API = `You write one animation "device" for a calm, magazine-grade men's style reel renderer (Node, @napi-rs/canvas 2D API, 1080x1920 portrait, 30 fps). A device draws on top of a model photo (or the page) from the moment its word is spoken. It is an ES module whose default export is:

export default {
  id: "snake_case_id", name: "Short Name",
  when: "One sentence: which moment of a style reel it's for.",
  uses: "Which cue fields it reads (part, to_part, side, text, status, color).",
  draw(ctx, d) { ... },     // every frame from the cue on
  sfx: [{ name: "pop" | "tick" | "swoosh" | "sweep" | "pen" | "click" | "blip" | "air", at: seconds after the cue, gain: 0.2-0.5 }],
};

d = { t, dt (seconds since the cue; animate from 0, finish within ~1 s, then hold still or breathe very gently), cue: { text, part, to_part, side ("left"|"right"|"center"), status ("good"|"bad"|""), color }, W, H, box: { x, y, w, h } (the model's box on screen), seed, theme: { ink, accent, page, head (headline font family), label (label font family) }, at(part, side) -> { x, y } screen point on the model (parts: head, face, neck, collar, shoulders, chest, sleeve, waist, belt, hips, shirt_hem, hands, cuff, thighs, knees, hem (trouser hem), ankles, feet), span(part) -> { x0, x1, y } the body's width there }.
Allowed imports ONLY: "../kit.js" (clamp01, easeOut, easeIn, easeInOut, easeBack, lerp, seeded(seed) -> random(), line(ctx, a, b, k, { color, width, dash }), label(ctx, text, x, y, theme, { size, color, align, alpha })) and "@napi-rs/canvas" (only if you need an offscreen canvas).
Rules: deterministic (no Math.random, Date, timers); no file, network or process access; one file under 200 lines; ctx.save()/restore() around changes. Look: premium and quiet — thin lines (2-3 px), the theme's ink and ONE accent, small labels, generous space, smooth easing; nothing over the face; stay between 0.12H and 0.8H and inside 0.04W-0.96W; never cover the subtitle band at the bottom. It must explain something about the clothes, not decorate.`;

const SPEC = {
  type: "object",
  additionalProperties: false,
  required: ["buildable", "reason", "code"],
  properties: {
    buildable: { type: "boolean", description: "false if it can't be done well as a 2D overlay (needs video, 3D, etc.)" },
    reason: { type: "string" },
    code: { type: "string" },
  },
};
const QA = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "problems", "code"],
  properties: { ok: { type: "boolean" }, problems: { type: "string" }, code: { type: "string", description: "When not ok: the whole fixed module; else \"\"" } },
};

function testRender(id, outDir, cue) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, "test-device.mjs"), id, outDir, JSON.stringify(cue ?? {})], { cwd: config.root, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 90000);
    child.on("close", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(out.trim().split("\n").at(-1)));
      } catch {
        resolve({ ok: false, error: (err || out || "no output").split("\n").filter((l) => !/injected env/.test(l)).slice(-6).join("\n") });
      }
    });
  });
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "device";

export async function buildDevice(spec, log = () => {}) {
  let id = slug(spec.id || spec.name);
  if (!/^[a-z]/.test(id)) id = `d_${id}`;
  if (DEVICES[id]) return id;
  await fs.mkdir(learnedDir, { recursive: true });
  const example = await fs.readFile(path.join(here, "measure.js"), "utf8");
  const task = [
    `Build this device, invented for a reel: "${spec.name}": ${spec.description}\nWhat it's for: ${spec.used_for}`,
    `Use id "${id}". Devices that already exist (don't rebuild): ${Object.values(DEVICES).map((d) => d.name).join(", ")}.`,
    `A good example device for the shape and quality bar (its import is "./kit.js" because it lives one folder up; yours must import "../kit.js"):\n\`\`\`js\n${example}\n\`\`\``,
  ].join("\n\n");
  const file = new URL(`${id}.js`, learnedDir);
  const work = path.join(config.root, "assets", "motions", ".work", `dev-${id}`);
  let first = await askJson({ system: API, task, schema: SPEC, effort: "high" });
  if (!first.buildable || !first.code.trim()) {
    log(`  New device "${spec.name}": skipped (${first.reason.slice(0, 120)})`);
    return null;
  }
  let code = first.code;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const problems = checkCode(code);
    let feedback = "";
    if (problems.length) feedback = `The code was rejected: ${problems.join("; ")}.`;
    else {
      await fs.writeFile(file, code);
      await fs.rm(work, { recursive: true, force: true });
      const res = await testRender(id, work, spec.sample_cue);
      if (!res.ok) feedback = `It failed to load or render: ${res.error}`;
      else {
        log(`  New device "${spec.name}": rendered, checking how it looks`);
        const qa = await askJson({
          system: API,
          task: `These stills (${res.times.join("s, ")}s; the cue lands just before the first) are your device "${id}" drawing on a model. Is it clean, premium, readable, explanatory, off the face, inside the safe area, and recognisably "${spec.name}: ${spec.description}"? If not, return the whole fixed module.\n\n\`\`\`js\n${code}\n\`\`\``,
          schema: QA,
          effort: "high",
          images: res.files,
        });
        if (qa.ok) {
          await fs.rm(work, { recursive: true, force: true });
          await fs.writeFile(new URL(`${id}.json`, learnedDir), JSON.stringify({ ...spec, id, at: Date.now() }, null, 2));
          await loadDevices();
          log(`  New device "${spec.name}" added to the engine`);
          return id;
        }
        log(`  New device "${spec.name}": needs work (${qa.problems.slice(0, 140)})`);
        if (!qa.code.trim()) break;
        code = qa.code;
        continue;
      }
    }
    if (attempt === 3) break;
    log(`  New device "${spec.name}": fixing (${feedback.slice(0, 140)})`);
    const fix = await askJson({ system: API, task: `${task}\n\nYour previous version:\n\`\`\`js\n${code}\n\`\`\`\n\n${feedback}\nReturn the whole fixed module.`, schema: SPEC, effort: "high" });
    if (!fix.buildable || !fix.code.trim()) break;
    code = fix.code;
  }
  await fs.rm(file, { force: true });
  await fs.rm(work, { recursive: true, force: true });
  log(`  New device "${spec.name}": couldn't get it right, the reel uses its fallback`);
  return null;
}
