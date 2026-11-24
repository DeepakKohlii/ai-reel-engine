import fs from "node:fs/promises";
import path from "node:path";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { config } from "./config.js";
import { hash, pad, stripEmoji } from "./util.js";

GlobalFonts.registerFromPath(config.fonts.title, "ReelTitle");
GlobalFonts.registerFromPath(config.fonts.caption, "ReelCaption");

const { width: W, height: H } = config.video;
const COLORS = { active: "#FFE14D", highlight: "#62FF8F", text: "#FFFFFF", stroke: "#000000", box: "#FFD400" };
const POP_SECONDS = 0.08;

const clean = (word) => stripEmoji(word).replace(/^[^\p{L}\p{N}₹]+|[^\p{L}\p{N}%]+$/gu, "");
const norm = (word) => clean(word).toLowerCase();

function chunkWords(words) {
  const chunks = [];
  let cur = [];
  const flush = () => cur.length && chunks.push(cur) && (cur = []);
  words.forEach((w, i) => {
    if (!clean(w.text)) return;
    cur.push(w);
    const next = words[i + 1];
    const chars = cur.reduce((n, x) => n + clean(x.text).length, 0);
    if (cur.length >= 3 || chars >= 16 || /[.,!?;:]$/.test(w.text) || (next && next.start - w.end > 0.35)) flush();
  });
  flush();
  return chunks;
}

export async function buildTextTrack(packDir, scenes, log) {
  const textDir = path.join(packDir, "text");
  const framesDir = path.join(textDir, "frames");
  await fs.rm(textDir, { recursive: true, force: true });
  await fs.mkdir(framesDir, { recursive: true });
  await fs.mkdir(path.join(textDir, "titles"), { recursive: true });

  const intervals = [];
  const srt = [];

  for (const [si, scene] of scenes.entries()) {
    const title = stripEmoji(scene.title).toUpperCase();
    const isHook = si === 0;
    const highlight = new Set((scene.highlight ?? []).flatMap((h) => h.split(/\s+/)).map(norm));
    const sceneEnd = scene.start + scene.duration;

    await fs.writeFile(
      path.join(textDir, "titles", `scene-${pad(si + 1)}.png`),
      await renderFrame({ title, isHook, chunk: null }),
    );

    const chunks = chunkWords(scene.words).map((ws, ci, all) => {
      const start = scene.start + ws[0].start;
      const nextStart = all[ci + 1] ? scene.start + all[ci + 1][0].start : sceneEnd;
      const end = Math.min(scene.start + ws.at(-1).end + 0.25, nextStart, sceneEnd);
      return { start, end, words: ws.map((w) => ({ ...w, start: scene.start + w.start })) };
    });

    chunks.forEach((c) => srt.push({ start: c.start, end: c.end, text: c.words.map((w) => clean(w.text)).join(" ") }));

    const cuts = new Set([scene.start, sceneEnd]);
    for (const c of chunks) {
      cuts.add(c.start).add(c.end).add(Math.min(c.start + POP_SECONDS, c.end));
      c.words.forEach((w) => w.start > c.start && w.start < c.end && cuts.add(w.start));
    }
    const times = [...cuts].filter((t) => t >= scene.start && t <= sceneEnd).sort((a, b) => a - b);

    for (let i = 0; i < times.length - 1; i++) {
      const [a, b] = [times[i], times[i + 1]];
      if (b - a < 0.001) continue;
      const mid = (a + b) / 2;
      const c = chunks.find((x) => mid >= x.start && mid < x.end);
      const state = {
        title,
        isHook,
        chunk: c && {
          words: c.words.map((w) => ({ text: clean(w.text).toUpperCase(), hl: highlight.has(norm(w.text)) })),
          active: c.words.findLastIndex((w) => w.start <= mid),
          pop: mid < c.start + POP_SECONDS,
        },
      };
      intervals.push({ start: a, end: b, state, key: hash(state) });
    }
  }

  const merged = [];
  for (const iv of intervals) {
    const last = merged.at(-1);
    if (last && last.key === iv.key) last.end = iv.end;
    else merged.push({ ...iv });
  }
  const rendered = new Map();
  for (const iv of merged) {
    if (!rendered.has(iv.key)) {
      const file = path.join(framesDir, `${iv.key}.png`);
      await fs.writeFile(file, await renderFrame(iv.state));
      rendered.set(iv.key, file);
    }
  }
  log(`Typography: ${rendered.size} text frames`);

  const lines = ["ffconcat version 1.0"];
  for (const iv of merged) lines.push(`file '${rendered.get(iv.key)}'`, `duration ${(iv.end - iv.start).toFixed(3)}`);
  lines.push(`file '${rendered.get(merged.at(-1).key)}'`);
  const concatFile = path.join(textDir, "track.ffconcat");
  await fs.writeFile(concatFile, lines.join("\n"));
  await fs.writeFile(path.join(packDir, "captions.srt"), toSrt(srt));
  return concatFile;
}

async function renderFrame({ title, isHook, chunk }) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  if (title) (isHook ? drawHook : drawTitle)(ctx, title);
  if (chunk) drawCaption(ctx, chunk);
  return canvas.encode("png");
}

function wrap(ctx, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function drawHook(ctx, text) {
  let size = 150;
  let lines;
  do {
    ctx.font = `${size}px ReelTitle`;
    lines = wrap(ctx, text, 940);
    size -= 6;
  } while ((lines.length > 3 || lines.some((l) => ctx.measureText(l).width > 940)) && size > 70);
  const lh = size * 1.12;
  const top = 560 - ((lines.length - 1) * lh) / 2;
  lines.forEach((line, i) => {
    const y = top + i * lh;
    ctx.lineWidth = 18;
    ctx.strokeStyle = COLORS.stroke;
    ctx.strokeText(line, W / 2, y);
    ctx.fillStyle = i === lines.length - 1 ? COLORS.active : COLORS.text;
    ctx.fillText(line, W / 2, y);
  });
}

function drawTitle(ctx, text) {
  let size = 84;
  let lines;
  do {
    ctx.font = `${size}px ReelTitle`;
    lines = wrap(ctx, text, 860);
    size -= 4;
  } while (lines.length > 2 && size > 52);
  const lh = size * 1.15;
  const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 70;
  const boxH = lines.length * lh + 40;
  ctx.save();
  ctx.translate(W / 2, 340);
  ctx.rotate((-2.5 * Math.PI) / 180);
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = COLORS.box;
  ctx.beginPath();
  ctx.roundRect(-boxW / 2, -boxH / 2, boxW, boxH, 22);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.fillStyle = "#111111";
  lines.forEach((line, i) => ctx.fillText(line, 0, -((lines.length - 1) * lh) / 2 + i * lh + 4));
  ctx.restore();
}

function drawCaption(ctx, { words, active, pop }) {
  let size = 84;
  const gap = () => size * 0.28;
  const measure = () => {
    ctx.font = `${size}px ReelCaption`;
    return words.map((w) => ctx.measureText(w.text).width);
  };
  let widths = measure();
  while (widths.reduce((a, b) => a + b, 0) + gap() * (words.length - 1) > 920 && size > 48) {
    size -= 4;
    widths = measure();
  }
  const total = widths.reduce((a, b) => a + b, 0) + gap() * (words.length - 1);
  ctx.save();
  ctx.translate(W / 2, 1200);
  if (pop) ctx.scale(1.12, 1.12);
  ctx.textAlign = "left";
  let x = -total / 2;
  words.forEach((w, i) => {
    ctx.lineWidth = 14;
    ctx.strokeStyle = COLORS.stroke;
    ctx.strokeText(w.text, x, 0);
    ctx.fillStyle = i === active ? COLORS.active : w.hl ? COLORS.highlight : COLORS.text;
    ctx.fillText(w.text, x, 0);
    x += widths[i] + gap();
  });
  ctx.restore();
}

function toSrt(items) {
  const ts = (t) => {
    const ms = Math.round(t * 1000);
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${pad(h)}:${pad(m)}:${pad(s)},${String(ms % 1000).padStart(3, "0")}`;
  };
  return items.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join("\n");
}
