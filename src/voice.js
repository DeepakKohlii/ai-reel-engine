import { spawn } from "node:child_process";
import { makeSpeakable } from "./speakable.js";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { exists, ffmpeg, hash, mediaDuration, pad, readJson, run, writeJson } from "./util.js";

export async function generateVoice(packDir, script, log, { final = false } = {}) {
  const audioDir = path.join(packDir, "audio");
  await fs.mkdir(audioDir, { recursive: true });
  const engine = final && config.elevenLabsKey && config.elevenLabsVoiceId ? "elevenlabs" : "mac";
  if (engine === "mac") log(`Voice: free macOS "${config.macVoice}" draft voice${final ? " (no ElevenLabs key/voice set)" : ""}.`);

  const results = [];
  for (const [i, scene] of script.scenes.entries()) {
    const n = pad(i + 1);
    const audioFile = path.join(audioDir, `scene-${n}.mp3`);
    const metaFile = path.join(audioDir, `scene-${n}.json`);
    const key = hash({ text: scene.voiceover, engine, voice: config.elevenLabsVoiceId, speed: config.voiceSpeed });

    let meta = await readJson(metaFile);
    if (!meta || meta.key !== key) {
      log(`Voice: scene ${n}`);
      const words =
        engine === "elevenlabs"
          ? await elevenLabs(scene.voiceover, audioFile, {
              previous: script.scenes[i - 1]?.voiceover,
              next: script.scenes[i + 1]?.voiceover,
            })
          : await macSay(scene.voiceover, audioFile);
      const duration = await mediaDuration(audioFile);
      meta = { key, duration, words: words ?? evenTimings(scene.voiceover, duration) };
      await writeJson(metaFile, meta);
    }
    results.push({ file: audioFile, ...meta });
  }
  return results;
}

async function elevenLabs(text, dest, opts) {
  try {
    return await elevenLabsWith(opts.voiceId || config.elevenLabsVoiceId, text, dest, opts);
  } catch (err) {
    if (err.paidPlanRequired && config.sarvam.key) {
      const e = new Error("Your ElevenLabs voice needs the paid Starter plan; using Sarvam until then.");
      e.useSarvam = true;
      throw e;
    }
    if (err.paidPlanRequired && config.elevenLabsFallbackVoiceId) {
      opts.log?.(`  Your voice needs a paid ElevenLabs plan; using the free "${config.elevenLabsFallbackName}" voice for now.`);
      opts.usedFallback = true;
      return elevenLabsWith(config.elevenLabsFallbackVoiceId, text, dest, opts);
    }
    throw err;
  }
}

async function elevenLabsWith(voiceId, text, dest, { previous, next, english }) {
  const lively = english && /v3/.test(config.elevenLabsModel);
  if (lively) text = `${EN_STYLE.tag} ${text}`;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": config.elevenLabsKey, "content-type": "application/json" },
    body: JSON.stringify(
      /v3/.test(config.elevenLabsModel)
        ? { text, model_id: config.elevenLabsModel, voice_settings: { stability: lively ? EN_STYLE.stability : 0.5, similarity_boost: 0.8, speed: config.voiceSpeed } }
        : {
            text,
            model_id: config.elevenLabsModel,
            previous_text: previous,
            next_text: next,
            voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.45, speed: config.voiceSpeed },
          },
    ),
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`ElevenLabs ${res.status}: ${body.slice(0, 300)}`);
    err.paidPlanRequired = res.status === 402;
    throw err;
  }
  const data = await res.json();
  await fs.writeFile(dest, Buffer.from(data.audio_base64, "base64"));
  const words = data.alignment ? wordsFromAlignment(data.alignment) : null;
  return words && lively ? words.filter((w) => !/^\[[^\]]*\]$/.test(w.text)) : words;
}

function wordsFromAlignment({ characters, character_start_times_seconds: starts, character_end_times_seconds: ends }) {
  const words = [];
  let current = null;
  characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      if (current) words.push(current);
      current = null;
    } else if (current) {
      current.text += ch;
      current.end = ends[i];
    } else {
      current = { text: ch, start: starts[i], end: ends[i] };
    }
  });
  if (current) words.push(current);
  return words;
}

async function macSay(text, dest) {
  const aiff = dest.replace(/\.mp3$/, ".aiff");
  const rate = Math.round(185 * config.voiceSpeed);
  await run("say", ["-v", config.macVoice, "-r", String(rate), "-o", aiff, text]);
  await ffmpeg(["-i", aiff, "-ar", "44100", "-b:a", "128k", dest]);
  await fs.rm(aiff);
  return null;
}

function evenTimings(text, duration) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const weights = tokens.map((t) => t.length + 2);
  const total = weights.reduce((a, b) => a + b, 0);
  const lead = 0.1;
  const usable = Math.max(duration - lead - 0.15, 0.1);
  let t = lead;
  return tokens.map((word, i) => {
    const len = (weights[i] / total) * usable;
    const w = { text: word, start: t, end: t + len * 0.9 };
    t += len;
    return w;
  });
}

export const speakMode = () => (ttsEngine() === "elevenlabs" ? "mixed" : "devanagari");

export function ttsEngine() {
  if (config.ttsProvider) return config.ttsProvider;
  if (config.sarvam.key) return "sarvam";
  if (config.elevenLabsKey && config.elevenLabsVoiceId) return "elevenlabs";
  return "mac";
}

const EN_STYLE = { stability: 0, tag: "[excited]", pace: 3.2, pause: 0.32 };
export function finalVoiceInfo(lines, { english = false } = {}) {
  const text = lines.join(" ");
  const voice = english && config.elevenLabsVoiceIdEn ? config.elevenLabsVoiceIdEn : config.elevenLabsVoiceId;
  return { key: hash({ lines, voice, speed: config.voiceSpeed, model: config.elevenLabsModel, ...(english && { style: { stability: EN_STYLE.stability, tag: EN_STYLE.tag } }) }), chars: text.length };
}

export async function generateNarration(packDir, rawLines, log, voice = {}, { final = false, language = "hi", beats = [] } = {}) {
  let lines = rawLines;
  const audioDir = path.join(packDir, "audio");
  await fs.mkdir(audioDir, { recursive: true });
  const engine = ttsEngine();
  const english = language === "en";
  if (english) voice = { pace: config.sarvam.paceEn, ...voice, language: "en-IN", ...(beats.length && { beats }) };
  if (engine === "sarvam") return sarvamNarration(audioDir, lines, log, voice);
  const lexicon = await loadPronunciations();
  lines = lines.map((l) => applyPronunciations(l, lexicon));
  const file = path.join(audioDir, engine === "elevenlabs" ? "final-voice.mp3" : "narration.mp3");
  const metaFile = path.join(audioDir, engine === "elevenlabs" ? "final-voice.json" : "narration.json");
  const { key, chars } = engine === "elevenlabs" ? finalVoiceInfo(lines, { english }) : { key: hash({ lines, engine }), chars: 0 };

  const finishing = english && engine === "elevenlabs";
  const postKey = finishing ? hash({ pace: EN_STYLE.pace, pause: EN_STYLE.pause, beats, v: 1 }) : null;
  const rawFile = path.join(audioDir, "final-voice.raw.mp3");
  const cached = await readJson(metaFile);
  if (cached?.key === key) {
    if (engine === "elevenlabs") log("Voice: final ElevenLabs recording (reused, no credits)");
    if (finishing && cached.raw && cached.postKey !== postKey && (await exists(rawFile))) {
      const done = await finishTake(rawFile, file, cached.raw.words, lines, beats, log);
      const meta = { ...cached, postKey, duration: done.duration, lines: done.lines };
      await writeJson(metaFile, meta);
      return { file, ...meta };
    }
    return { file, ...cached };
  }
  if (engine === "elevenlabs" && !final) {
    log(`Voice: free draft voice (Sarvam${english ? ", English" : ""}). ElevenLabs runs only when you click Record final voice (~${chars} credits).`);
    return english && config.sarvam.key ? sarvamNarration(audioDir, rawLines, log, voice) : draftNarration(audioDir, rawLines, log, voice);
  }

  let words;
  let usedMac = engine !== "elevenlabs";
  const elOpts = { log };
  if (engine === "elevenlabs") {
    log("Voice: full narration (ElevenLabs)");
    try {
      words = await elevenLabs(lines.join(" "), file, { ...elOpts, ...(english && { english: true, ...(config.elevenLabsVoiceIdEn && { voiceId: config.elevenLabsVoiceIdEn }) }) });
    } catch (err) {
      if (err.useSarvam) {
        log(`  ${err.message}`);
        return draftNarration(audioDir, rawLines, log, voice);
      }
      log(`  ElevenLabs failed (${err.message.slice(0, 160)}). Using the placeholder voice for now.`);
      usedMac = true;
    }
  }
  if (usedMac && engine === "elevenlabs") {
    words = await macNarration(audioDir, lines, file);
  } else if (engine !== "elevenlabs") {
    log(`Voice: narration with the free macOS "${config.macVoice}" voice (placeholder)`);
    words = await macNarration(audioDir, lines, file);
  }
  let duration = await mediaDuration(file);
  if (!words) words = evenTimings(lines.join(" "), duration);
  let grouped = groupWords(lines, words);
  let extra = {};
  if (finishing && !usedMac) {
    await fs.copyFile(file, rawFile);
    const done = await finishTake(rawFile, file, words, lines, beats, log);
    ({ duration } = done);
    grouped = done.lines;
    extra = { raw: { words, duration: await mediaDuration(rawFile) }, postKey };
  }
  const standIn = engine === "elevenlabs" && (usedMac || elOpts.usedFallback);
  const meta = { key: standIn ? `${key}-fallback` : key, duration, lines: grouped, ...extra };
  await writeJson(metaFile, meta);
  return { file, ...meta };
}

function groupWords(lines, words) {
  let cursor = 0;
  return lines.map((line) => {
    const count = line.split(/\s+/).filter(Boolean).length;
    const ws = words.slice(cursor, cursor + count);
    cursor += count;
    return ws;
  });
}

async function finishTake(rawFile, file, rawWords, lines, beats, log) {
  await fs.copyFile(rawFile, file);
  let { words, duration } = await squeezePauses(file, rawWords, EN_STYLE.pause, log);
  const rate = Math.min(1.15, (EN_STYLE.pace * duration) / Math.max(1, words.length));
  if (rate > 1.02) ({ words, duration } = await tighten(file, words, rate, log));
  if (beats.length) ({ words, duration } = await addBeats(file, words, lines, beats, log));
  return { duration, lines: groupWords(lines, words) };
}

const BEAT = 0.6;
export async function addBeats(file, words, lines, beats, log = () => {}) {
  const ends = [];
  let n = 0;
  lines.forEach((line, i) => {
    n += line.split(/\s+/).filter(Boolean).length;
    if (beats.includes(i) && n < words.length) ends.push(n - 1);
  });
  const inserts = ends
    .map((k) => ({ at: words[k].end + 0.04, add: BEAT - Math.max(0, words[k + 1].start - words[k].end) }))
    .filter((x) => x.add > 0.05);
  if (!inserts.length) return { words, duration: await mediaDuration(file) };
  const segs = [];
  let t = 0;
  inserts.forEach((x, i) => {
    segs.push(`[0:a]atrim=start=${t.toFixed(3)}:end=${x.at.toFixed(3)},asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=mono[s${i}]`);
    segs.push(`anullsrc=r=44100:cl=mono,atrim=duration=${x.add.toFixed(3)}[z${i}]`);
    t = x.at;
  });
  segs.push(`[0:a]atrim=start=${t.toFixed(3)},asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=mono[s${inserts.length}]`);
  const order = inserts.flatMap((_, i) => [`[s${i}]`, `[z${i}]`]).join("") + `[s${inserts.length}]`;
  const tmp = `${file}.tmp.mp3`;
  await new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-filter_complex", `${segs.join(";")};${order}concat=n=${inserts.length * 2 + 1}:v=0:a=1[out]`, "-map", "[out]", "-b:a", "192k", tmp]);
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error("beat insert failed"))));
  });
  await fs.rename(tmp, file);
  const shift = (time) => time + inserts.filter((x) => x.at <= time).reduce((a, x) => a + x.add, 0);
  log(`  A short pause after each point (${inserts.length})`);
  return { words: words.map((w) => ({ ...w, start: +shift(w.start).toFixed(3), end: +shift(w.end).toFixed(3) })), duration: await mediaDuration(file) };
}

export async function squeezePauses(file, words, cap = 0.32, log = () => {}) {
  const probe = await new Promise((resolve) => {
    const ff = spawn("ffmpeg", ["-hide_banner", "-i", file, "-af", "silencedetect=noise=-35dB:d=0.2", "-f", "null", "-"]);
    let err = "";
    ff.stderr.on("data", (d) => (err += d));
    ff.on("close", () => resolve(err));
    ff.on("error", () => resolve(""));
  });
  const starts = [...probe.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...probe.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const cuts = starts
    .map((s, i) => ({ s, e: ends[i] }))
    .filter((x) => x.e != null && x.s > 0.05 && x.e - x.s > cap)
    .map((x) => ({ a: x.s + cap / 2, b: x.e - cap / 2 }));
  if (!cuts.length) return { words, duration: await mediaDuration(file) };
  const keep = [];
  let at = 0;
  for (const c of cuts) {
    keep.push([at, c.a]);
    at = c.b;
  }
  keep.push([at, null]);
  const parts = keep.map(([a, b], i) => `[0:a]atrim=start=${a.toFixed(3)}${b != null ? `:end=${b.toFixed(3)}` : ""},asetpts=PTS-STARTPTS[p${i}]`);
  const graph = `${parts.join(";")};${keep.map((_, i) => `[p${i}]`).join("")}concat=n=${keep.length}:v=0:a=1[out]`;
  const tmp = `${file}.tmp.mp3`;
  await new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-filter_complex", graph, "-map", "[out]", "-b:a", "192k", tmp]);
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error("pause trim failed"))));
  });
  await fs.rename(tmp, file);
  const shift = (t) => {
    let d = 0;
    for (const c of cuts) {
      if (t >= c.b) d += c.b - c.a;
      else if (t > c.a) return +(c.a - d).toFixed(3);
    }
    return +(t - d).toFixed(3);
  };
  const saved = cuts.reduce((n, c) => n + c.b - c.a, 0);
  log(`  Pauses tightened (${saved.toFixed(1)} s of dead air removed)`);
  return { words: words.map((w) => ({ ...w, start: shift(w.start), end: shift(w.end) })), duration: await mediaDuration(file) };
}

export async function tighten(file, words, rate, log = () => {}) {
  const tmp = `${file}.tmp.mp3`;
  await new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-filter:a", `atempo=${rate.toFixed(3)}`, "-b:a", "192k", tmp]);
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error("atempo failed"))));
  });
  await fs.rename(tmp, file);
  log(`  Voice tightened ${rate.toFixed(2)}x to the reel's pace (pitch kept)`);
  return { words: words.map((w) => ({ ...w, start: +(w.start / rate).toFixed(3), end: +(w.end / rate).toFixed(3) })), duration: await mediaDuration(file) };
}

async function draftNarration(audioDir, lines, log, voice) {
  if (!config.sarvam.key) {
    log(`  (no Sarvam key: using the free macOS "${config.macVoice}" voice as the draft)`);
    const dest = path.join(audioDir, "narration.mp3");
    const words = await macNarration(audioDir, lines, dest);
    const duration = await mediaDuration(dest);
    return { file: dest, duration, lines: splitWords(words, lines) };
  }
  const cacheFile = path.join(audioDir, "draft-speak.json");
  const k = hash(lines);
  const cache = await readJson(cacheFile, {});
  let deva = cache.key === k ? cache.lines : null;
  if (!deva) {
    deva = await makeSpeakable(lines, "devanagari").catch(() => lines);
    await writeJson(cacheFile, { key: k, lines: deva });
  }
  return sarvamNarration(audioDir, deva, log, voice);
}

function splitWords(words, lines) {
  let cursor = 0;
  return lines.map((line) => {
    const count = line.split(/\s+/).filter(Boolean).length;
    const ws = words.slice(cursor, cursor + count);
    cursor += count;
    return ws;
  });
}

async function macNarration(audioDir, lines, dest) {
  const parts = [];
  const words = [];
  let offset = 0;
  for (const [i, line] of lines.entries()) {
    const part = path.join(audioDir, `line-${pad(i + 1)}.mp3`);
    await macSay(line, part);
    const d = await mediaDuration(part);
    for (const w of evenTimings(line, d)) words.push({ ...w, start: w.start + offset, end: w.end + offset });
    offset += d;
    parts.push(part);
  }
  const inputs = parts.flatMap((p) => ["-i", p]);
  await ffmpeg([...inputs, "-filter_complex", `concat=n=${parts.length}:v=0:a=1`, "-b:a", "160k", dest]);
  await Promise.all(parts.map((p) => fs.rm(p)));
  return words;
}

export async function addHolds(narration, holds, out) {
  const cuts = [];
  holds.forEach((hold, i) => {
    const cur = narration.lines[i];
    const next = narration.lines[i + 1];
    if (!(hold > 0) || !cur?.length || !next?.length) return;
    cuts.push({ at: (cur.at(-1).end + next[0].start) / 2, hold, after: i });
  });
  if (!cuts.length) return narration;

  const parts = [];
  let from = 0;
  cuts.forEach((c, k) => {
    parts.push(`[0:a]atrim=${from.toFixed(3)}:${c.at.toFixed(3)},asetpts=PTS-STARTPTS,apad=pad_dur=${c.hold.toFixed(2)}[p${k}]`);
    from = c.at;
  });
  parts.push(`[0:a]atrim=start=${from.toFixed(3)},asetpts=PTS-STARTPTS[p${cuts.length}]`);
  const labels = cuts.map((_, k) => `[p${k}]`).join("") + `[p${cuts.length}]`;
  await ffmpeg([
    "-i", narration.file, "-filter_complex", `${parts.join(";")};${labels}concat=n=${cuts.length + 1}:v=0:a=1[out]`,
    "-map", "[out]", "-b:a", "192k", out,
  ]);

  let shift = 0;
  const lines = narration.lines.map((ws, i) => {
    const moved = ws.map((w) => ({ ...w, start: w.start + shift, end: w.end + shift }));
    const c = cuts.find((x) => x.after === i);
    if (c) shift += c.hold;
    return moved;
  });
  return { ...narration, file: out, duration: narration.duration + shift, lines };
}

export async function sarvamSpeak(text, dest, { speaker = config.sarvam.speaker, pace = config.sarvam.pace, language = "hi-IN", temperature } = {}) {
  const res = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: { "api-subscription-key": config.sarvam.key, "content-type": "application/json" },
    body: JSON.stringify({
      text,
      model: "bulbul:v3",
      speaker,
      pace,
      language_code: language,
      target_language_code: language,
      speech_sample_rate: 44100,
      ...(temperature != null ? { temperature } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Sarvam ${res.status}: ${JSON.stringify(data.error ?? data).slice(0, 240)}`);
  const b64 = data.audios?.[0];
  if (!b64) throw new Error("Sarvam returned no audio");
  const wav = `${dest}.wav`;
  await fs.writeFile(wav, Buffer.from(b64, "base64"));
  await ffmpeg(["-i", wav, "-ar", "44100", "-b:a", "192k", dest]);
  await fs.rm(wav);
  return dest;
}

async function sarvamNarration(audioDir, rawLines, log, voice = {}) {
  const file = path.join(audioDir, "narration.mp3");
  const metaFile = path.join(audioDir, "narration.json");
  const speaker = voice.speaker || config.sarvam.speaker;
  const pace = Number(voice.pace) || config.sarvam.pace;
  const lexicon = await loadPronunciations();
  const lines = rawLines.map((l) => applyPronunciations(l, lexicon));
  const language = voice.language || "hi-IN";
  const beats = voice.beats ?? [];
  const key = hash({ lines, engine: "sarvam", speaker, pace, v: 7, ...(language !== "hi-IN" && { language }), ...(beats.length && { beats }) });
  const cached = await readJson(metaFile);
  if (cached?.key === key) return { file, ...cached };

  log(`Voice: Sarvam "${speaker}"`);
  const lineDir = path.join(audioDir, "lines");
  await fs.mkdir(lineDir, { recursive: true });

  const groups = [];
  let cur = [];
  lines.forEach((line, i) => {
    cur.push(i);
    const words = cur.reduce((n, j) => n + lines[j].split(/\s+/).length, 0);
    const sentenceEnd = /[.?!।]["')]*\s*$/.test(line);
    if (i === lines.length - 1 || (language !== "hi-IN" && sentenceEnd) || (words >= 55 && sentenceEnd) || words > 80) {
      groups.push(cur);
      cur = [];
    }
  });

  const parts = [];
  const gaps = [];
  const lineWords = [];
  let offset = 0;
  for (const [g, idx] of groups.entries()) {
    const text = idx.map((j) => lines[j]).join(" ");
    const part = path.join(lineDir, `${hash({ text, speaker, pace, ...(language !== "hi-IN" && { language }) })}.mp3`);
    if (!(await exists(part))) await sarvamSpeak(text, part, { speaker, pace, language });
    const trimmed = `${part}.trim.mp3`;
    if (!(await exists(trimmed))) {
      await ffmpeg([
        "-i", part, "-af",
        "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse",
        trimmed,
      ]);
    }
    const d = await mediaDuration(trimmed);
    const pauses = await findPauses(trimmed);
    const events = alignBreaks(idx.map((j) => lines[j]), d, pauses);
    idx.forEach((j, k) => {
      const startEv = events.filter((e) => e.lineEnd && e.line === k - 1).at(-1);
      const endEv = events.find((e) => e.lineEnd && e.line === k);
      const lineStart = k === 0 ? 0 : startEv?.pause.end ?? 0;
      const lineEnd = endEv ? endEv.pause.start : d;
      const spoken = lines[j].split(/\s+/).filter(Boolean);
      const shown = rawLines[j].split(/\s+/).filter(Boolean);
      const cuts = spoken.length === shown.length ? events.filter((e) => e.line === k && !e.lineEnd && e.pause.dur > 0) : [];
      const chunks = [];
      let t0 = lineStart;
      let w0 = 0;
      for (const e of cuts) {
        chunks.push({ words: shown.slice(w0, e.token + 1), start: t0, end: e.pause.start });
        t0 = e.pause.end;
        w0 = e.token + 1;
      }
      chunks.push({ words: shown.slice(w0), start: t0, end: Math.max(lineEnd, t0 + 0.2) });
      lineWords[j] = chunks.flatMap((c) => (c.words.length ? evenTimings(c.words.join(" "), c.end - c.start + 0.15).map((w) => ({ ...w, start: w.start + c.start + offset - 0.05, end: w.end + c.start + offset - 0.05 })) : []));
    });
    const last = g === groups.length - 1;
    const endLine = lines[idx.at(-1)];
    const gap = last ? 0.06 : beats.includes(idx.at(-1)) ? BEAT : /\?\s*$/.test(endLine) ? 0.32 : /[.!।]\s*$/.test(endLine) ? 0.24 : 0.1;
    gaps.push(gap);
    offset += d + gap;
    parts.push(trimmed);
  }
  const inputs = parts.flatMap((p) => ["-i", p]);
  const pads = parts.map((_, i) => `[${i}:a]apad=pad_dur=${gaps[i]}[a${i}]`).join(";");
  await ffmpeg([...inputs, "-filter_complex", `${pads};${parts.map((_, i) => `[a${i}]`).join("")}concat=n=${parts.length}:v=0:a=1`, "-b:a", "192k", file]);

  const duration = await mediaDuration(file);
  const meta = { key, duration, lines: lineWords.map((ws) => ws ?? []) };
  await writeJson(metaFile, meta);
  return { file, ...meta };
}

async function findPauses(file) {
  const stderr = await new Promise((resolve) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-i", file, "-af", "silencedetect=noise=-36dB:d=0.06", "-f", "null", "-"]);
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("close", () => resolve(err));
    child.on("error", () => resolve(""));
  });
  const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((s, i) => {
    const e = ends[i] ?? s + 0.06;
    return { start: s, end: e, mid: (s + e) / 2, dur: e - s };
  });
}

function alignBreaks(texts, d, pauses) {
  const weight = (t) => t.replace(/\s+/g, "").length + 3;
  const total = texts.reduce((n, t) => n + weight(t), 0);
  const events = [];
  let acc = 0;
  texts.forEach((t, k) => {
    const tokens = t.split(/\s+/).filter(Boolean);
    tokens.forEach((tok, i) => {
      acc += tok.length + (i === tokens.length - 1 ? 3 : 0);
      const last = i === tokens.length - 1;
      const strong = /[.?!।]["')]*$/.test(tok);
      const weak = /[,;:—–-]["')]*$/.test(tok);
      if (last && k === texts.length - 1) return;
      if (last || strong || weak) events.push({ f: acc / total, kind: strong ? "strong" : weak ? "weak" : "none", line: k, token: i, lineEnd: last });
    });
  });
  const n = events.length;
  const m = pauses.length;
  const INF = 1e9;
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(INF));
  const from = Array.from({ length: n + 1 }, () => new Int8Array(m + 1));
  dp[0][0] = 0;
  const skipPause = (p) => 0.1 + Math.max(0, p.dur - 0.25) * 2.5;
  const noPause = (e) => (e.kind === "strong" ? 1.6 : e.kind === "weak" ? 0.45 : 0.08);
  const match = (e, p) => {
    let c = Math.abs(p.mid - e.f * d) * 0.9;
    if (e.kind === "strong") c += (p.dur < 0.18 ? 0.7 : 0) - Math.min(p.dur, 0.6) * 0.8;
    if (e.kind === "weak" && p.dur > 0.5) c += 0.35;
    if (e.kind === "none") c += 0.35;
    return c;
  };
  for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
    const c = dp[i][j];
    if (c >= INF) continue;
    if (j < m && c + skipPause(pauses[j]) < dp[i][j + 1]) { dp[i][j + 1] = c + skipPause(pauses[j]); from[i][j + 1] = 1; }
    if (i < n && c + noPause(events[i]) < dp[i + 1][j]) { dp[i + 1][j] = c + noPause(events[i]); from[i + 1][j] = 2; }
    if (i < n && j < m) {
      const v = c + match(events[i], pauses[j]);
      if (v < dp[i + 1][j + 1]) { dp[i + 1][j + 1] = v; from[i + 1][j + 1] = 3; }
    }
  }
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const how = from[i][j];
    if (how === 3) { events[i - 1].pause = pauses[j - 1]; i--; j--; }
    else if (how === 2) i--;
    else j--;
  }
  const anchors = [{ f: 0, t: 0 }, ...events.filter((e) => e.pause).map((e) => ({ f: e.f, t: e.pause.mid })), { f: 1, t: d }];
  const at = (f) => {
    const b = anchors.findIndex((a) => a.f >= f);
    const a0 = anchors[Math.max(0, b - 1)];
    const a1 = anchors[Math.max(0, b)];
    return a1.f === a0.f ? a1.t : a0.t + ((f - a0.f) / (a1.f - a0.f)) * (a1.t - a0.t);
  };
  for (const e of events) if (!e.pause) {
    const t = at(e.f);
    e.pause = { start: t, end: t, mid: t, dur: 0 };
  }
  return events;
}

export const pronunciationFile = path.join(config.root, "assets", "pronunciation.json");
export const loadPronunciations = () => readJson(pronunciationFile, {});
export function applyPronunciations(line, lexicon) {
  let out = String(line);
  for (const [word, say] of Object.entries(lexicon ?? {})) {
    if (!word.trim() || !say?.trim()) continue;
    const esc = word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(^|[^\\p{L}\\p{M}])${esc}(?=$|[^\\p{L}\\p{M}])`, "giu"), `$1${say.trim()}`);
  }
  return out;
}
