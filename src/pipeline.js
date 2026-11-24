import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { getFormat } from "./script.js";
import { readJson, writeJson } from "./util.js";

export const packDir = (slug) => path.join(config.packsDir, path.basename(slug));

const running = new Map();

export async function getStatus(slug) {
  return running.get(slug) ?? (await readJson(path.join(packDir(slug), "status.json"), { state: "idle", log: [] }));
}

export async function savePack(slug, script) {
  const dir = packDir(slug);
  await fs.mkdir(path.join(dir, "overrides"), { recursive: true });
  await writeJson(path.join(dir, "script.json"), script);
  if (script.stage !== "text") await getFormat(script.format).writeDocs(dir, script);
}

export function startBuild(slug, { final = false } = {}) {
  startJob(slug, (s, log) => build(s, log, { final }), final ? "Done. Final voice recorded, reel is ready." : "Done. Rough cut is ready.");
}

export function startDavinciExport(slug) {
  startJob(
    slug,
    async (s, log) => {
      const dir = packDir(s);
      const script = await readJson(path.join(dir, "script.json"));
      if (script?.format !== "editorial") throw new Error("DaVinci export is available for Style rules reels");
      const { exportDavinci } = await import("./formats/editorial/davinci.js");
      await exportDavinci(dir, script, log);
    },
    "Done. DaVinci export is ready.",
  );
}

export function startPolish(slug, notes = "") {
  startJob(
    slug,
    async (s, log) => {
      const dir = packDir(s);
      const script = await readJson(path.join(dir, "script.json"));
      if (!["editorial", "aesthetic"].includes(script?.format)) throw new Error("Rewrites are for Style rules and Aesthetic reels");
      log(notes ? `Rewriting with your notes: ${notes.slice(0, 160)}` : "Rewriting for a more natural flow");
      const better =
        script.format === "aesthetic"
          ? await (await import("./formats/aesthetic/writer.js")).reviseScript(script, notes)
          : await (await import("./formats/editorial/scriptwriter.js")).reviseScript(script, notes, { slug: s });
      await writeJson(path.join(dir, "script.before-rewrite.json"), script);
      await savePack(s, better);
    },
    "Done. Read the new script and approve it when it's right.",
  );
}

export function startApprove(slug) {
  startJob(
    slug,
    async (s, log) => {
      const dir = packDir(s);
      let script = await readJson(path.join(dir, "script.json"));
      if (script?.stage === "text" && script.format === "aesthetic") {
        log("Planning the reel: scenes, the model and his outfits, the graphics on each word");
        const { direct } = await import("./formats/aesthetic/writer.js");
        const others = (await listPacks()).filter((p) => p.format === "aesthetic" && p.slug !== s).slice(0, 6);
        const recentModels = [];
        for (const p of others) {
          const o = await readJson(path.join(packDir(p.slug), "script.json"));
          if (o?.model?.description) recentModels.push(o.model.description);
        }
        const plan = await direct(script, { recentModels, slug: s });
        log("Checking every frame against its words");
        await (await import("./formats/aesthetic/writer.js")).matchCheck(plan, script, log);
        await (await import("./formats/aesthetic/writer.js")).inventDevices(plan, log);
        const { stage, previousPlan, ...words } = script;
        script = { ...words, ...plan, approved: true };
      } else if (script?.stage === "text") {
        const { artDirect } = await import("./formats/editorial/scriptwriter.js");
        const { pickStyle, updateStyle } = await import("./learn.js");
        const pick = await pickStyle(script.styleChoice ?? "auto");
        const names = pick?.styles.map((s) => `"${s.name}"`).join(", ");
        log(
          `Designing the reel from your approved script${
            pick?.mode === "full" ? `, copying the learned style ${names} (trial)` : pick ? `, borrowing a few ingredients from ${names}` : ""
          }`,
        );
        script = await artDirect(script, pick, s);
        for (const s of pick?.styles ?? []) await updateStyle(s.id, { uses: (s.uses ?? 0) + 1, lastUsed: Date.now() });
      } else {
        script.approved = true;
      }
      await savePack(s, script);
      await build(s, log);
      await checkAndFix(s, log);
    },
    "Done. Rough cut is ready (self-checked).",
  );
}

async function checkAndFix(slug, log) {
  const dir = packDir(slug);
  const script = await readJson(path.join(dir, "script.json"));
  if (script?.format === "aesthetic") {
    try {
      log("Reviewing every scene against your rules");
      const A = await import("./formats/aesthetic/index.js");
      const { selfCheck } = await import("./formats/aesthetic/selfcheck.js");
      const prep = await A.prepare(dir, script, () => {}, { generate: false });
      const { changed } = await selfCheck(dir, script, prep, log);
      if (changed) {
        await savePack(slug, script);
        log(`Applying ${changed} fix${changed > 1 ? "es" : ""}`);
        await build(slug, log);
      } else log("  Nothing to fix");
    } catch (err) {
      log(`  Review skipped (${err.message.slice(0, 120)})`);
    }
    return;
  }
  if (script?.format !== "editorial") return;
  try {
    const { selfCheck, verifyFixes } = await import("./formats/editorial/selfcheck.js");
    const { fixed } = await selfCheck(dir, script, log);
    if (fixed) {
      log("Applying the fixes");
      await build(slug, log);
      const again = await readJson(path.join(dir, "script.json"));
      if (await verifyFixes(dir, again, log)) await build(slug, log);
    }
  } catch (err) {
    log(`  Self-check skipped (${err.message.slice(0, 120)})`);
  }
}

export function startSelfCheck(slug) {
  startJob(slug, (s, log) => checkAndFix(s, log), "Done. Self-check finished.");
}

function startJob(slug, job, doneMsg) {
  if (running.get(slug)?.state === "running") return;
  const status = { state: "running", step: "starting", log: [], startedAt: Date.now() };
  running.set(slug, status);
  const log = (msg) => {
    status.log.push(msg);
    status.step = msg;
  };
  job(slug, log)
    .then(() => {
      status.state = "done";
      log(doneMsg);
    })
    .catch((err) => {
      status.state = "error";
      log(`Error: ${err.message}`);
      console.error(err);
    })
    .finally(async () => {
      await writeJson(path.join(packDir(slug), "status.json"), status);
      running.delete(slug);
    });
}

async function build(slug, log, opts = {}) {
  const dir = packDir(slug);
  const script = await readJson(path.join(dir, "script.json"));
  if (!script) throw new Error("No script.json in this pack");
  const format = getFormat(script.format);
  await format.writeDocs(dir, script);
  await format.build(dir, script, log, opts);
}

export async function listPacks() {
  const slugs = await fs.readdir(config.packsDir).catch(() => []);
  const packs = [];
  for (const slug of slugs) {
    const script = await readJson(path.join(packDir(slug), "script.json"));
    if (!script) continue;
    const stat = await fs.stat(path.join(packDir(slug), "script.json"));
    packs.push({ slug, title: script.title, topic: script.topic, format: script.format ?? "classic", updated: stat.mtimeMs });
  }
  return packs.sort((a, b) => b.updated - a.updated);
}
