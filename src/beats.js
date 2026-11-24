import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ffmpeg } from "./util.js";

const RATE = 11025;
const HOP = 256;

export async function detectBeats(file, start = 0, duration = 60) {
  const raw = path.join(os.tmpdir(), `beats-${process.pid}-${Date.now()}.f32`);
  await ffmpeg(["-ss", String(start), "-t", String(duration), "-i", file, "-vn", "-ac", "1", "-ar", String(RATE), "-f", "f32le", raw]);
  const buf = await fs.readFile(raw);
  await fs.rm(raw, { force: true });
  const pcm = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);

  const n = Math.floor(pcm.length / HOP);
  const env = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let j = 0; j < HOP; j++) e += pcm[i * HOP + j] ** 2;
    const db = Math.log1p(e * 1000);
    env[i] = Math.max(0, db - prev);
    prev = db;
  }
  const dt = HOP / RATE;

  let best = { lag: 0, score: -1 };
  for (let lag = Math.round(60 / 180 / dt); lag <= Math.round(60 / 70 / dt); lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += env[i] * env[i - lag];
    if (s > best.score) best = { lag, score: s };
  }
  if (!best.lag) return [];
  let phase = { off: 0, score: -1 };
  for (let off = 0; off < best.lag; off++) {
    let s = 0;
    for (let i = off; i < n; i += best.lag) s += env[i];
    if (s > phase.score) phase = { off, score: s };
  }
  const beats = [];
  for (let i = phase.off; i < n; i += best.lag) beats.push(+(i * dt).toFixed(3));
  return beats;
}
