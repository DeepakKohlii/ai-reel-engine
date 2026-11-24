import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { exists, ffmpeg, run } from "./util.js";
import { PLUGINS } from "./motions/index.js";

const dir = path.join(config.root, "assets", "sfx");
const builtDir = path.join(dir, ".built");
const RATE = 44100;

const RECIPES = {
  pop: ["-f", "lavfi", "-i", "aevalsrc='0.9*sin(2*PI*(520*t-2600*t*t))*exp(-t*38)':d=0.14:s=44100"],
  tick: ["-f", "lavfi", "-i", "aevalsrc='0.6*sin(2*PI*1800*t)*exp(-t*140)+0.3*sin(2*PI*3600*t)*exp(-t*220)':d=0.06:s=44100"],
  whoosh: [
    "-f", "lavfi", "-i", "anoisesrc=d=0.55:c=pink:a=0.9:r=44100",
    "-af", "highpass=f=300,lowpass=f=5000,volume='pow(sin(PI*t/0.55),2)':eval=frame,afade=t=out:st=0.45:d=0.1",
  ],
  swoosh: [
    "-f", "lavfi", "-i", "anoisesrc=d=0.3:c=white:a=0.6:r=44100",
    "-af", "bandpass=f=2200:width_type=h:w=1800,volume='pow(sin(PI*t/0.3),3)':eval=frame",
  ],
  boom: ["-f", "lavfi", "-i", "aevalsrc='0.95*sin(2*PI*(70-40*t)*t)*exp(-t*5)':d=0.8:s=44100"],
  click: ["-f", "lavfi", "-i", "aevalsrc='0.5*sin(2*PI*2300*t)*exp(-t*170)+0.35*(2*random(0)-1)*exp(-t*320)':d=0.06:s=44100"],
  blip: ["-f", "lavfi", "-i", "aevalsrc='0.5*sin(2*PI*(820*t+2400*t*t))*exp(-t*32)':d=0.13:s=44100"],
  pen: [
    "-f", "lavfi", "-i", "anoisesrc=d=0.5:c=pink:a=0.8:r=44100",
    "-af", "bandpass=f=3400:width_type=h:w=2600,volume='(0.55+0.45*sin(2*PI*17*t))*min(1,t/0.04)*exp(-t*3.2)':eval=frame",
  ],
  sweep: [
    "-f", "lavfi", "-i", "anoisesrc=d=0.4:c=white:a=0.5:r=44100",
    "-af", "highpass=f=4500,volume='sin(PI*t/0.4)':eval=frame",
  ],
  air: [
    "-f", "lavfi", "-i", "anoisesrc=d=0.45:c=pink:a=0.6:r=44100",
    "-af", "bandpass=f=1500:width_type=h:w=1200,volume='pow(sin(PI*t/0.45),2)':eval=frame",
  ],
  zoomin: [
    "-f", "lavfi", "-i", "anoisesrc=d=0.62:c=pink:a=0.9:r=44100",
    "-af", "highpass=f=350,lowpass=f=7000,volume='pow(t/0.62,2.4)':eval=frame,afade=t=out:st=0.56:d=0.06",
  ],
  zoomout: [
    "-f", "lavfi", "-i", "anoisesrc=d=0.6:c=pink:a=0.9:r=44100",
    "-af", "bandpass=f=900:width_type=h:w=1500,volume='min(1,t/0.03)*exp(-t*5.5)':eval=frame",
  ],
  riser: [
    "-f", "lavfi", "-i", "aevalsrc='0.22*sin(2*PI*(160*t+190*t*t))*pow(t/0.7,2)':d=0.7:s=44100",
    "-f", "lavfi", "-i", "anoisesrc=d=0.7:c=pink:a=0.5:r=44100",
    "-filter_complex", "[1]highpass=f=600,volume='pow(t/0.7,3)':eval=frame[n];[0][n]amix=inputs=2:normalize=0",
  ],
  thump: ["-f", "lavfi", "-i", "aevalsrc='0.9*sin(2*PI*(95-55*t)*t)*exp(-t*13)':d=0.35:s=44100"],
};

const cache = new Map();

async function samples(name) {
  if (cache.has(name)) return cache.get(name);
  await fs.mkdir(builtDir, { recursive: true });
  let src = null;
  for (const ext of ["wav", "mp3", "m4a"]) {
    const f = path.join(dir, `${name}.${ext}`);
    if (await exists(f)) src = f;
  }
  if (!src) {
    src = path.join(builtDir, `${name}.wav`);
    if (!(await exists(src))) await ffmpeg([...RECIPES[name], "-ac", "1", src]);
  }
  const raw = path.join(builtDir, `${name}.f32`);
  await ffmpeg(["-i", src, "-ac", "1", "-ar", String(RATE), "-f", "f32le", raw]);
  const buf = await fs.readFile(raw);
  const data = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  cache.set(name, data);
  return data;
}

export function sfxEvents(tl, density = "subtle", rules = [], keyword = "") {
  const punchy = density === "punchy";
  const want = new Map((rules ?? []).map((r) => [r.event, r.sound]));
  const events = [];
  const add = (kind, name, at, gain, priority) => events.push({ kind, name, at, gain, priority });
  if (punchy || want.has("hook")) add("hook", "boom", 0.02, 0.45, 2);
  let lastImageSfx = -10;
  const kw = String(keyword ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  for (const b of tl.timeline) {
    if (b.wipeFrom) add("color_change", "whoosh", b.t0 - 0.05, 0.75, 3);
    else if (want.has("cut") && b.index > 0) add("cut", "swoosh", b.t0, 0.5, 1);
    for (const [k, p] of b.pieces.entries()) {
      const ctaBeat = /comment/i.test(b.beat?.voiceover ?? "");
      const isKeyword = kw && ctaBeat && String(p.text).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").includes(kw);
      if (isKeyword) add("cta_keyword", "pop", p.at + 0.02, 0.95, 4);
      else if (p.hero === "sticker") add("sticker", "pop", p.at + 0.03, 0.9, 3);
      else if (p.label) add("text_word", "tick", p.at + 0.02, 0.7, 2);
      else if ((punchy || want.has("hero_word")) && p.hero) add("hero_word", "tick", p.at + 0.02, punchy ? 0.25 : 0.45, 1);
      else if (want.has("text_word") && k === 0) add("text_word", "tick", p.at + 0.02, 0.35, 1);
    }
    const bigMove = ["side", "hero", "edge"].includes(b.layout) || punchy;
    if (!b.continues && b.images.length && bigMove && b.visualAt - lastImageSfx >= 2.5) {
      const slide = b.images.some((im) => ["slideLeft", "slideRight", "fromLeft", "fromRight"].includes(im.enter));
      add("image_in", slide ? "swoosh" : "pop", b.visualAt, slide ? 0.7 : 0.55, 2);
      lastImageSfx = b.visualAt;
    }
    if (b.layout === "board" && b.visual) add("list_item", "tick", b.visualAt, 0.5, 1);
    if (b.cards && !b.continues && b.layout !== "verdict") add("image_in", "pop", b.visualAt + 0.05, 0.6, 2);
    if (b.flow) add("list_item", "swoosh", b.visualAt + 0.25, 0.6, 2);
    if (b.slider) add("image_in", "swoosh", b.visualAt + 0.75, 0.65, 2);
    if (b.layout === "verdict") for (const c of b.cards ?? []) add("punchline", "pop", b.visualAt + c.delay + 0.4, 0.7, 3);
    if (b.zoom) add("image_in", "pop", b.visualAt + 0.55, 0.55, 2);
    if (b.scale) for (const st of b.scale.stops) add("list_item", "tick", b.visualAt + st.delay, 0.55, 2);
    if (b.dm) {
      const n = b.dm.keyword.length;
      if (b.dm.phase === "comment") {
        add("cta_keyword", "tick", b.visualAt + 0.35, 0.5, 2);
        add("cta_keyword", "pop", b.visualAt + 0.35 + n * 0.09 + 0.35, 0.9, 4);
      } else add("cta_keyword", "pop", b.visualAt + 0.45, 0.85, 3);
    }
    if (b.mosaic) {
      add("list_item", "swoosh", b.visualAt + b.mosaic.slideAt, 0.6, 2);
      add("punchline", "pop", b.visualAt + b.mosaic.slideAt + 0.12, 0.85, 3);
    }
    const plugin = b.plugin && PLUGINS[b.plugin.id];
    if (plugin?.sfx) for (const e of plugin.sfx(b)) add(e.kind, e.name, e.at, e.gain, e.priority);
    if (b.transition === "letter") add("cut", "whoosh", b.t1 - 0.4, 0.8, 3);
    if (b.camera === "rotate") add("cut", "swoosh", b.t1 - 0.5, 0.6, 2);
    if (b.camera === "punch") add("punchline", "boom", b.cameraAt ?? b.t0, 0.55, 3);
    if (b.motion === "slam") {
      const hero = b.pieces.find((p) => p.hero);
      if (hero) add("punchline", "boom", hero.at, 0.8, 3);
    }
  }
  if (tl.sticker) {
    add("sticker", "swoosh", tl.sticker.at, 0.55, 3);
    add("sticker", "pop", tl.sticker.at + 0.4, 0.8, 3);
  }
  const styled = events
    .map((e) => (want.has(e.kind) ? { ...e, name: want.get(e.kind) } : e))
    .filter((e) => e.name && e.name !== "none" && RECIPES[e.name]);
  const minGap = punchy ? 0.2 : 0.4;
  const kept = [];
  for (const e of styled.filter((x) => x.at >= 0 && x.at < tl.total).sort((x, y) => x.at - y.at)) {
    const prev = kept.at(-1);
    if (prev && e.at - prev.at < minGap) {
      if (e.priority > prev.priority) kept[kept.length - 1] = e;
      continue;
    }
    kept.push(e);
  }
  return kept;
}

function vary(data, seed) {
  let s = seed * 2654435761 >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const rate = 0.93 + rnd() * 0.14;
  const out = new Float32Array(Math.floor(data.length / rate));
  for (let i = 0; i < out.length; i++) {
    const x = i * rate;
    const j = Math.floor(x);
    out[i] = (data[j] ?? 0) + ((data[j + 1] ?? 0) - (data[j] ?? 0)) * (x - j);
  }
  return { data: out, gain: 0.85 + rnd() * 0.3 };
}

export async function buildSfxTrack(tl, out, density = "subtle", { rules = [], keyword = "" } = {}) {
  return mixSfx(sfxEvents(tl, density, rules, keyword), tl.total, out);
}

export async function mixSfx(events, total, out) {
  const mix = new Float32Array(Math.ceil((total + 1) * RATE));
  for (const [n, e] of events.entries()) {
    const { data, gain } = vary(await samples(e.name), n + 1);
    const start = Math.round(e.at * RATE);
    for (let i = 0; i < data.length && start + i < mix.length; i++) mix[start + i] += data[i] * e.gain * gain;
  }
  for (let i = 0; i < mix.length; i++) mix[i] = Math.max(-1, Math.min(1, mix[i]));
  const raw = `${out}.f32`;
  await fs.writeFile(raw, Buffer.from(mix.buffer));
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "f32le", "-ar", String(RATE), "-ac", "1", "-i", raw, out]);
  await fs.rm(raw);
  return { file: out, count: events.length };
}
