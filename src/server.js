import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import multer from "multer";
import { config } from "./config.js";
import { getStatus, listPacks, packDir, savePack, startApprove, startBuild, startDavinciExport, startPolish, startSelfCheck } from "./pipeline.js";
import { getResults, saveResults } from "./results.js";
import { addAsset, appPrompt, deleteAsset, findAsset, generateAsset, hostReference, imageProvider, libraryDir, listAssets, updateAsset } from "./library.js";
import { collectSpecs } from "./formats/editorial/assets.js";
import { previewBeat } from "./formats/editorial/preview.js";
import { applyPronunciations, finalVoiceInfo, loadPronunciations, pronunciationFile, sarvamSpeak, ttsEngine } from "./voice.js";
import { listNeeds } from "./needs.js";
import { ideasPrompt, lastIdeas, saveIdeas, trendingIdeas } from "./ideas.js";
import {
  formatList,
  generateIdeas,
  generateScript,
  manualIdeasPrompt,
  manualScriptPrompt,
  parseJsonReply,
  scriptProvider,
  validateScript,
} from "./script.js";
import { pad, readJson, run, slugify, writeJson } from "./util.js";
import { kindOf } from "./visuals.js";

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(config.root, "public"), { extensions: ["html"] }));
app.use("/fonts", express.static(path.join(config.root, "node_modules", "@fontsource")));
app.use("/packs", express.static(config.packsDir));
app.use("/library", express.static(libraryDir));
app.use("/styles", express.static(path.join(config.root, "assets", "styles")));
app.use("/motions", express.static(path.join(config.root, "assets", "motions")));

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: err.message });
  });

app.get("/api/health", (_req, res) =>
  res.json({
    claude: scriptProvider(),
    elevenlabs: !!(config.elevenLabsKey && config.elevenLabsVoiceId),
    pexels: !!config.pexelsKey,
    images: imageProvider(),
    voice: ttsEngine(),
  }),
);

const recentTopics = async () => (await listPacks()).slice(0, 30).map((p) => p.topic).filter(Boolean);

app.get("/api/formats", (_req, res) => res.json(formatList()));
app.get("/api/layouts", wrap(async (_req, res) => {
  const { schema } = await import("./formats/editorial/index.js");
  res.json(schema.properties.beats.items.properties.visual.properties.layout.enum);
}));

app.post("/api/ideas", wrap(async (req, res) => {
  if ((req.body.format ?? "editorial") === "editorial") return res.json({ ideas: await trendingIdeas({ recent: await recentTopics() }) });
  res.json({ ideas: await generateIdeas({ format: req.body.format, recent: await recentTopics() }) });
}));

app.get("/api/ideas/last", wrap(async (_req, res) => res.json(await lastIdeas())));

const writing = new Map();

app.post("/api/create", wrap(async (req, res) => {
  const { topic, hook, notes } = req.body;
  if (!topic?.trim()) return res.status(400).json({ error: "Topic is required" });
  const id = Date.now().toString(36);
  const job = { state: "running", step: "Writing the script", log: ["Writing the script"] };
  const log = (msg) => {
    job.log.push(msg);
    job.step = msg;
  };
  writing.set(id, job);
  (async () => {
    const extra = [hook && `Open with this hook (adapt it if needed): ${hook}`, notes].filter(Boolean).join("\n");
    const { writeScript } = req.body.format === "aesthetic" ? await import("./formats/aesthetic/writer.js") : await import("./formats/editorial/scriptwriter.js");
    const script = await writeScript({ topic: topic.trim(), notes: extra });
    const slug = slugify(topic);
    await savePack(slug, script);
    Object.assign(job, { state: "done", slug });
  })().catch((err) => {
    console.error(err);
    Object.assign(job, { state: "error", error: err.message });
  });
  res.json({ id });
}));

app.get("/api/create/:id", (req, res) => {
  const job = writing.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Unknown job" });
  res.json(job);
});

app.get("/api/instagram", wrap(async (_req, res) => res.json(await (await import("./instagram.js")).status())));
app.post("/api/instagram/connect", wrap(async (req, res) => {
  const IG = await import("./instagram.js");
  const me = await IG.connect(req.body?.token);
  await IG.sync();
  res.json({ ok: true, username: me.username });
}));
app.post("/api/instagram/sync", wrap(async (_req, res) => res.json(await (await import("./instagram.js")).sync())));
app.post("/api/instagram/disconnect", wrap(async (_req, res) => {
  await (await import("./instagram.js")).disconnect();
  res.json({ ok: true });
}));

app.get("/api/packs/:slug/results", wrap(async (req, res) => res.json((await getResults(req.params.slug)) ?? {})));
app.put("/api/packs/:slug/results", wrap(async (req, res) => res.json(await saveResults(req.params.slug, req.body ?? {}))));

app.post("/api/packs/:slug/polish", wrap(async (req, res) => {
  startPolish(path.basename(req.params.slug), String(req.body?.notes ?? "").slice(0, 3000));
  res.json({ ok: true });
}));

app.put("/api/packs/:slug/lines", wrap(async (req, res) => {
  const slug = path.basename(req.params.slug);
  const script = await readJson(path.join(packDir(slug), "script.json"));
  if (script?.stage !== "text") return res.status(400).json({ error: "This script is already designed; use Rewrite with my notes." });
  const lines = (req.body?.lines ?? []).map((l) => ({ voiceover: String(l.voiceover ?? "").trim(), on_screen: String(l.on_screen ?? "").trim(), ...(l.beat && { beat: true }) })).filter((l) => l.voiceover);
  if (!lines.length) return res.status(400).json({ error: "The script needs at least one line." });
  await savePack(slug, { ...script, lines });
  res.json({ ok: true });
}));

app.post("/api/packs/:slug/approve", wrap(async (req, res) => {
  const slug = path.basename(req.params.slug);
  const file = path.join(packDir(slug), "script.json");
  const script = await readJson(file);
  if (!script) return res.status(404).json({ error: "Pack not found" });
  startApprove(slug);
  res.json({ ok: true });
}));

app.get("/api/packs/:slug/needs", wrap(async (req, res) => res.json(await listNeeds({ slug: path.basename(req.params.slug) }))));

app.post("/api/prompt", wrap(async (req, res) => {
  const { kind, format, topic, notes } = req.body;
  if (kind === "ideas") {
    const recent = await recentTopics();
    return res.json({ prompt: (format ?? "editorial") === "editorial" ? await ideasPrompt(recent) : manualIdeasPrompt({ format, recent }) });
  }
  if (!topic?.trim()) return res.status(400).json({ error: "Topic is required" });
  res.json({ prompt: manualScriptPrompt({ format, topic: topic.trim(), notes }) });
}));

app.post("/api/import", wrap(async (req, res) => {
  const { topic, reply, format } = req.body;
  let data;
  try {
    data = parseJsonReply(reply ?? "");
  } catch (err) {
    return res.status(400).json({ error: `Couldn't read that reply: ${err.message}. Paste Claude's whole answer.` });
  }
  if (Array.isArray(data.ideas)) {
    await saveIdeas(data.ideas);
    return res.json({ ideas: data.ideas });
  }
  let script;
  try {
    script = validateScript(data, format);
  } catch (err) {
    return res.status(400).json({ error: `${err.message}. Make sure the right format is selected.` });
  }
  script.topic = topic?.trim() || script.title;
  const slug = slugify(script.topic);
  await savePack(slug, script);
  if (req.body.build) startBuild(slug);
  res.json({ slug, script });
}));

app.post("/api/script", wrap(async (req, res) => {
  const { topic, notes, format } = req.body;
  if (!topic?.trim()) return res.status(400).json({ error: "Topic is required" });
  const script = await generateScript({ format, topic: topic.trim(), notes });
  const slug = slugify(topic);
  await savePack(slug, script);
  if (req.body.build) startBuild(slug);
  res.json({ slug, script });
}));

async function finalVoiceStatus(dir, script) {
  if (ttsEngine() !== "elevenlabs" || !["editorial", "aesthetic"].includes(script.format) || script.stage === "text") return null;
  const lexicon = await loadPronunciations();
  const ready = script.format === "aesthetic" || (script.speakMode === "mixed" && script.beats.every((b) => b.speak));
  const lines = script.format === "aesthetic" ? script.lines.map((l) => applyPronunciations(l.voiceover, lexicon)) : script.beats.map((b) => applyPronunciations(ready ? b.speak : b.voiceover, lexicon));
  const { key, chars } = finalVoiceInfo(lines, { english: script.format === "aesthetic" });
  const meta = await readJson(path.join(dir, "audio", "final-voice.json"));
  return { recorded: ready && meta?.key === key, outdated: !!meta && meta.key !== key, chars };
}

app.get("/api/packs", wrap(async (_req, res) => res.json(await listPacks())));

app.get("/api/packs/:slug", wrap(async (req, res) => {
  const dir = packDir(req.params.slug);
  const script = await readJson(path.join(dir, "script.json"));
  if (!script) return res.status(404).json({ error: "Pack not found" });
  const files = await fs.readdir(dir).catch(() => []);
  const overrides = await fs.readdir(path.join(dir, "overrides")).catch(() => []);
  res.json({
    slug: req.params.slug,
    script,
    status: await getStatus(req.params.slug),
    timeline: await readJson(path.join(dir, "timeline.json")),
    hasCut: files.includes("rough-cut.mp4"),
    hasDavinci: files.includes("davinci"),
    finalVoice: await finalVoiceStatus(dir, script),
    overrides,
  });
}));

app.put("/api/packs/:slug/script", wrap(async (req, res) => {
  let script;
  try {
    script = validateScript(req.body, req.body.format);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const before = await readJson(path.join(packDir(req.params.slug), "script.json"));
  const saidFor = new Map((before?.beats ?? []).filter((b) => b.speak).map((b) => [b.speak, b.voiceover]));
  for (const b of script.beats ?? []) if (b.speak && saidFor.has(b.speak) && saidFor.get(b.speak) !== b.voiceover) b.speak = "";
  await savePack(req.params.slug, { ...req.body, ...script });
  res.json({ ok: true });
}));

app.post("/api/preview-beat", wrap(async (req, res) => {
  const png = await previewBeat(req.body);
  res.type("png").send(png);
}));

app.post("/api/packs/:slug/build", wrap(async (req, res) => {
  const script = await readJson(path.join(packDir(req.params.slug), "script.json"));
  if (script?.approved === false) return res.status(400).json({ error: "Approve the script first (Script review, at the top). Nothing is generated before that." });
  startBuild(req.params.slug, { final: req.body?.final === true });
  res.json({ ok: true });
}));

app.post("/api/packs/:slug/selfcheck", wrap(async (req, res) => {
  startSelfCheck(path.basename(req.params.slug));
  res.json({ ok: true });
}));

app.post("/api/packs/:slug/davinci", wrap(async (req, res) => {
  startDavinciExport(req.params.slug);
  res.json({ ok: true });
}));

app.post("/api/packs/:slug/reveal", wrap(async (req, res) => {
  const target = path.join(packDir(req.params.slug), req.body.folder === "davinci" ? "davinci" : "");
  await run("open", [target]);
  res.json({ ok: true });
}));

app.get("/api/packs/:slug/status", wrap(async (req, res) => res.json(await getStatus(req.params.slug))));

const upload = multer({ dest: path.join(config.packsDir, ".uploads"), limits: { fileSize: 300 * 1024 * 1024 } });

const learning = new Map();
app.post("/api/references/:name", express.raw({ type: "*/*", limit: "200mb" }), wrap(async (req, res) => {
  const name = path.basename(req.params.name).replace(/[^\w.-]+/g, "_");
  const dir = path.join(config.root, "assets", "references");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), req.body);
  res.set("Access-Control-Allow-Origin", "*").json({ ok: true, bytes: req.body.length });
}));

app.post("/api/styles/learn", upload.single("file"), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Upload the reel's video file (so the sound can be studied too)." });
  const id = Date.now().toString(36);
  const job = { state: "running", step: "Starting", log: [] };
  learning.set(id, job);
  const log = (m) => {
    job.log.push(m);
    job.step = m;
  };
  const { learnFromReel } = await import("./learn.js");
  learnFromReel({ file: req.file.path, link: String(req.body.link ?? "").slice(0, 500), notes: String(req.body.notes ?? "").slice(0, 1000), log })
    .then(async (style) => {
      job.styleId = style.id;
      try {
        const { buildLearnedMotions } = await import("./motions/smith.js");
        job.motions = await buildLearnedMotions(style, log);
      } catch (err) {
        log(`Couldn't build its motions: ${err.message}`);
      }
      Object.assign(job, { state: "done" });
    })
    .catch((err) => {
      console.error(err);
      Object.assign(job, { state: "error", error: err.message });
    })
    .finally(() => fs.rm(req.file.path, { force: true }));
  res.json({ id });
}));
app.post("/api/styles/:id/motions", wrap(async (req, res) => {
  const style = await (await import("./learn.js")).getStyle(req.params.id);
  if (!style) return res.status(404).json({ error: "Style not found" });
  const id = Date.now().toString(36);
  const job = { state: "running", step: "Starting", log: [] };
  learning.set(id, job);
  const log = (m) => {
    job.log.push(m);
    job.step = m;
  };
  const { buildLearnedMotions } = await import("./motions/smith.js");
  buildLearnedMotions(style, log)
    .then((motions) => Object.assign(job, { state: "done", motions }))
    .catch((err) => Object.assign(job, { state: "error", error: err.message }));
  res.json({ id });
}));
app.get("/api/styles/learn/:id", (req, res) => res.json(learning.get(req.params.id) ?? { state: "unknown" }));
app.get("/api/styles", wrap(async (_req, res) => res.json(await (await import("./learn.js")).listStyles())));
app.patch("/api/styles/:id", wrap(async (req, res) => {
  const patch = {};
  if (typeof req.body.active === "boolean") patch.active = req.body.active;
  if (typeof req.body.name === "string" && req.body.name.trim()) patch.name = req.body.name.trim().slice(0, 60);
  res.json(await (await import("./learn.js")).updateStyle(req.params.id, patch));
}));
app.delete("/api/styles/:id", wrap(async (req, res) => {
  await (await import("./learn.js")).deleteStyle(req.params.id);
  res.json({ ok: true });
}));
app.put("/api/packs/:slug/style", wrap(async (req, res) => {
  const slug = path.basename(req.params.slug);
  const file = path.join(packDir(slug), "script.json");
  const script = await readJson(file);
  if (!script) return res.status(404).json({ error: "Pack not found" });
  script.styleChoice = String(req.body.choice ?? "auto");
  await writeJson(file, script);
  res.json({ ok: true });
}));

app.post("/api/packs/:slug/scenes/:n/override", upload.single("file"), wrap(async (req, res) => {
  const ext = path.extname(req.file?.originalname ?? "").toLowerCase();
  if (!req.file || !kindOf(ext)) return res.status(400).json({ error: "Upload an mp4/mov/webm video or a jpg/png/webp image" });
  const dir = path.join(packDir(req.params.slug), "overrides");
  const n = pad(Number(req.params.n));
  for (const f of await fs.readdir(dir).catch(() => [])) if (f.startsWith(`scene-${n}.`)) await fs.rm(path.join(dir, f));
  await fs.rename(req.file.path, path.join(dir, `scene-${n}${ext}`));
  res.json({ ok: true });
}));

app.delete("/api/packs/:slug/scenes/:n/override", wrap(async (req, res) => {
  const dir = path.join(packDir(req.params.slug), "overrides");
  const n = pad(Number(req.params.n));
  for (const f of await fs.readdir(dir).catch(() => [])) if (f.startsWith(`scene-${n}.`)) await fs.rm(path.join(dir, f));
  res.json({ ok: true });
}));

app.get("/api/library", wrap(async (_req, res) => res.json(await listAssets())));
app.get("/api/library/needs", wrap(async (_req, res) => res.json(await listNeeds())));

app.post("/api/library", upload.single("file"), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose an image" });
  try {
    const buf = await fs.readFile(req.file.path);
    const asset = await addAsset(buf, {
      tags: req.body.tags ?? "",
      kind: req.body.kind || "item",
      source: "upload",
      keepBackground: req.body.keepBackground === "true",
    });
    res.json(asset);
  } finally {
    await fs.rm(req.file.path, { force: true });
  }
}));

app.post("/api/library/generate", wrap(async (req, res) => {
  const { prompt, tags, kind } = req.body;
  if (!prompt?.trim()) return res.status(400).json({ error: "Write a prompt" });
  const referenceIds = [].concat(req.body.referenceIds ?? []).filter(Boolean);
  res.json(await generateAsset({ prompt, tags: tags ?? "", kind: kind || "item", referenceIds }));
}));

app.patch("/api/library/:id", wrap(async (req, res) => res.json(await updateAsset(req.params.id, req.body))));
app.delete("/api/library/:id", wrap(async (req, res) => {
  await deleteAsset(req.params.id);
  res.json({ ok: true });
}));

app.get("/api/pronunciation", wrap(async (_req, res) => res.json(await loadPronunciations())));
app.put("/api/pronunciation", wrap(async (req, res) => {
  const clean = {};
  for (const [k, v] of Object.entries(req.body ?? {})) if (String(k).trim() && String(v).trim()) clean[String(k).trim().toLowerCase()] = String(v).trim();
  await writeJson(pronunciationFile, clean);
  res.json(clean);
}));

app.post("/api/voice-test", wrap(async (req, res) => {
  const { provider = "sarvam", speaker, text } = req.body;
  const line = String(text || "Baggy jeans ke saath slim sneakers? Bhai, pair chhote lag rahe hain.").slice(0, 300);
  const dir = path.join(config.packsDir, ".voice-tests");
  await fs.mkdir(dir, { recursive: true });
  const out = path.join(dir, `${provider}-${speaker || "default"}-${Date.now()}.mp3`);
  if (provider === "sarvam") {
    if (!config.sarvam.key) return res.status(400).json({ error: "Add SARVAM_API_KEY to .env and restart." });
    const said = applyPronunciations(line, await loadPronunciations());
    await sarvamSpeak(said, out, { speaker: speaker || config.sarvam.speaker, pace: Number(req.body.pace) || config.sarvam.pace });
  } else {
    return res.status(400).json({ error: "Only Sarvam voices can be tested here for now." });
  }
  res.json({ url: `/packs/.voice-tests/${path.basename(out)}` });
}));

app.get("/api/music", wrap(async (_req, res) => {
  const files = (await fs.readdir(config.musicDir).catch(() => [])).filter((f) => /\.(mp3|m4a|wav|aac)$/i.test(f));
  res.json(files);
}));

app.post("/api/music", upload.single("file"), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose an audio file" });
  const name = path.basename(req.file.originalname).replace(/[^\w.\- ]+/g, "_");
  if (!/\.(mp3|m4a|wav|aac)$/i.test(name)) {
    await fs.rm(req.file.path, { force: true });
    return res.status(400).json({ error: "Use an mp3, m4a, wav or aac file" });
  }
  await fs.mkdir(config.musicDir, { recursive: true });
  await fs.rename(req.file.path, path.join(config.musicDir, name));
  res.json({ file: name });
}));

async function reelSpecs(slug) {
  const dir = packDir(slug);
  const script = await readJson(path.join(dir, "script.json"));
  if (!script) throw new Error("Pack not found");
  const picksFile = path.join(dir, "asset-picks.json");
  const picks = await readJson(picksFile, {});
  const specs = script.format === "aesthetic" ? (await import("./formats/aesthetic/index.js")).imageSpecs(script) : collectSpecs(script);
  return { dir, script, picks, picksFile, specs };
}

const specPrompt = (spec) =>
  spec.prompt || (spec.kind === "host" ? `standing, pose: ${spec.tags.filter((t) => t !== "host").join(", ")}` : spec.tags.join(", "));

app.get("/api/packs/:slug/images", wrap(async (req, res) => {
  const { specs, picks } = await reelSpecs(req.params.slug);
  const assets = await listAssets();
  const hostRef = await hostReference();
  const out = [];
  for (const spec of specs) {
    const current = assets.find((a) => a.id === picks[spec.key]) ?? (await findAsset(spec.tags, { kind: spec.kind }));
    out.push({
      key: spec.key,
      kind: spec.kind,
      tags: spec.tags,
      label: spec.label ?? "",
      beats: spec.beats,
      prompt: specPrompt(spec),
      appPrompt: appPrompt({ prompt: specPrompt(spec), kind: spec.kind, hasReference: spec.kind === "host" && !!hostRef }),
      current: current ? { id: current.id, url: `/library/${current.file}`, source: current.source } : null,
    });
  }
  res.json(out);
}));

async function setPick(slug, key, asset) {
  const { picks, picksFile } = await reelSpecs(slug);
  picks[key] = asset.id;
  await writeJson(picksFile, picks);
}

app.post("/api/packs/:slug/images/:key/regenerate", wrap(async (req, res) => {
  const { specs } = await reelSpecs(req.params.slug);
  const spec = specs.find((x) => x.key === req.params.key);
  if (!spec) return res.status(404).json({ error: "Image not found in this reel" });
  if (spec.kind === "host" && !(await hostReference())) {
    return res.status(400).json({ error: "Upload the host reference photo first (Asset library), then host poses can be generated." });
  }
  const { picks } = await reelSpecs(req.params.slug);
  const ref = spec.referenceKey ? picks[spec.referenceKey] : null;
  const asset = await generateAsset({ prompt: req.body.prompt?.trim() || specPrompt(spec), tags: spec.tags, kind: spec.kind, referenceIds: ref ? [ref] : [], refMode: "person" });
  await setPick(req.params.slug, spec.key, asset);
  res.json(asset);
}));

app.post("/api/packs/:slug/images/:key/upload", upload.single("file"), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose an image" });
  try {
    const { specs } = await reelSpecs(req.params.slug);
    const spec = specs.find((x) => x.key === req.params.key);
    if (!spec) return res.status(404).json({ error: "Image not found in this reel" });
    const asset = await addAsset(await fs.readFile(req.file.path), { tags: spec.tags, kind: spec.kind, source: "upload", trim: !String(spec.key).startsWith("o:") });
    await setPick(req.params.slug, spec.key, asset);
    res.json(asset);
  } finally {
    await fs.rm(req.file.path, { force: true });
  }
}));

async function reelMedia(slug) {
  const dir = packDir(path.basename(slug));
  const script = await readJson(path.join(dir, "script.json"));
  if (!script) throw new Error("Pack not found");
  return { dir, script, M: await import("./formats/aesthetic/media.js") };
}

app.get("/api/packs/:slug/media", wrap(async (req, res) => {
  const { dir, script, M } = await reelMedia(req.params.slug);
  const out = [];
  for (const m of M.mediaSpecs(script)) {
    const file = await M.slotFile(dir, m.key);
    const st = file ? await fs.stat(file) : null;
    out.push({
      ...m,
      aiText: m.source === "ai" ? M.aiPrompt(m, script) : "",
      startFrame: m.source === "ai" ? `/api/packs/${encodeURIComponent(path.basename(req.params.slug))}/media/${encodeURIComponent(m.key)}/start.png` : "",
      file: file ? { url: `/packs/${path.basename(req.params.slug)}/refs/${encodeURIComponent(path.basename(file))}?v=${Math.round(st.mtimeMs)}`, video: M.CLIP.test(file) } : null,
    });
  }
  res.json(out);
}));

app.get("/api/packs/:slug/media/:key/start.png", wrap(async (req, res) => {
  const { dir, script, M } = await reelMedia(req.params.slug);
  const slot = (script.media ?? []).find((m) => m.key === req.params.key && m.source === "ai");
  if (!slot) return res.status(404).json({ error: "No AI clip with that name in this reel" });
  res.type("png").set("Content-Disposition", `attachment; filename="${slot.key}-start.png"`).send(await M.startFrame(dir, script, slot));
}));

app.post("/api/packs/:slug/media/:key", upload.single("file"), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a photo or a clip" });
  try {
    const { dir, script, M } = await reelMedia(req.params.slug);
    const slot = (script.media ?? []).find((m) => m.key === req.params.key);
    if (!slot) return res.status(404).json({ error: "That photo/clip isn't in this reel's plan" });
    const ext = path.extname(req.file.originalname || "").toLowerCase();
    const ok = slot.kind === "photo" ? M.PHOTO.test(ext) : M.CLIP.test(ext) || M.PHOTO.test(ext);
    if (!ok) return res.status(400).json({ error: slot.kind === "photo" ? "Use a jpg, png or webp photo" : "Use an mp4, mov or webm clip (or a photo)" });
    if (slot.source === "ai" && M.CLIP.test(ext)) {
      const warning = await M.clipCheck(req.file.path).catch(() => "");
      if (warning) {
        await fs.mkdir(path.join(M.refDir(dir), "rejected"), { recursive: true });
        await fs.rename(req.file.path, path.join(M.refDir(dir), "rejected", `${slot.key}-${Date.now()}${ext}`));
        return res.status(400).json({ error: warning });
      }
    }
    await fs.mkdir(M.refDir(dir), { recursive: true });
    const old = await M.slotFile(dir, slot.key);
    if (old) await fs.rm(old, { force: true });
    await fs.rename(req.file.path, path.join(M.refDir(dir), `${slot.key}${ext}`));
    res.json({ ok: true });
  } finally {
    await fs.rm(req.file.path, { force: true }).catch(() => {});
  }
}));

app.delete("/api/packs/:slug/media/:key", wrap(async (req, res) => {
  const { dir, M } = await reelMedia(req.params.slug);
  const file = await M.slotFile(dir, path.basename(req.params.key));
  if (file) await fs.rm(file, { force: true });
  res.json({ ok: true });
}));

app.post("/api/packs/:slug/caption", wrap(async (req, res) => {
  const slug = path.basename(req.params.slug);
  const dir = packDir(slug);
  const script = await readJson(path.join(dir, "script.json"));
  if (!script) return res.status(404).json({ error: "Pack not found" });
  const { rewriteCaption } = await import("./formats/editorial/caption.js");
  await rewriteCaption(dir, script, String(req.body?.notes ?? "").slice(0, 1000));
  await writeJson(path.join(dir, "script.json"), script);
  res.json({ caption: script.caption, hashtags: script.hashtags });
}));

app.get("/api/aesthetic/settings", wrap(async (_req, res) => res.json(await (await import("./formats/aesthetic/writer.js")).settings())));
app.put("/api/aesthetic/settings", wrap(async (req, res) => {
  const { settingsFile } = await import("./formats/aesthetic/writer.js");
  const series = String(req.body?.series ?? "").trim().slice(0, 40);
  const signoff = String(req.body?.signoff ?? "").trim().slice(0, 120);
  await writeJson(settingsFile, { ...(series && { series }), ...(signoff && { signoff }) });
  res.json({ ok: true });
}));

const motionJob = { state: "idle", log: [] };
app.get("/api/motions", wrap(async (_req, res) => {
  const { CATALOG, ratingOf } = await import("./motions/index.js");
  const { listPreviews } = await import("./motions/preview.js");
  const { loadPrefs } = await import("./learn.js");
  const prefs = await loadPrefs();
  const previews = new Map((await listPreviews()).map((p) => [p.id, p]));
  res.json({
    job: motionJob,
    motions: CATALOG.map((m) => ({ ...m, rating: ratingOf(m, prefs), preview: previews.get(m.id)?.file ?? null })),
  });
}));
app.put("/api/motions/:id", wrap(async (req, res) => {
  const { CATALOG } = await import("./motions/index.js");
  const { loadPrefs, prefsFile } = await import("./learn.js");
  const m = CATALOG.find((x) => x.id === req.params.id);
  const rating = String(req.body?.rating ?? "");
  if (!m || !["like", "dislike", "trial", "ok"].includes(rating)) return res.status(400).json({ error: "Unknown motion or rating" });
  const prefs = await loadPrefs();
  prefs.ingredients ??= {};
  if (rating === "ok" || (rating === "trial" && !m.builtIn && !m.learned)) delete prefs.ingredients[m.pref];
  else prefs.ingredients[m.pref] = rating;
  await writeJson(prefsFile, prefs);
  res.json({ ok: true });
}));
app.post("/api/motions/previews", wrap(async (_req, res) => {
  if (motionJob.state === "running") return res.json(motionJob);
  Object.assign(motionJob, { state: "running", log: [] });
  const { renderPreviews } = await import("./motions/preview.js");
  renderPreviews(null, (line) => motionJob.log.push(line))
    .then(() => (motionJob.state = "done"))
    .catch((err) => Object.assign(motionJob, { state: "error", error: err.message }));
  res.json(motionJob);
}));

await fs.mkdir(config.packsDir, { recursive: true });
app.listen(config.port, () => {
  console.log(`Reel engine running at http://localhost:${config.port}`);
  import("./instagram.js").then((IG) => IG.startAutoSync());
});
