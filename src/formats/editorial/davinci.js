import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.js";
import { exists, ffmpeg } from "../../util.js";
import { prepare } from "./index.js";
import { renderElement, renderLayer } from "./motion.js";

const FPS = 30;

export async function exportDavinci(dir, script, log) {
  const title = script.title || "Reel";
  const out = path.join(dir, "davinci");
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });

  const { tl, narration, music, musicStart, sfxFile } = await prepare(dir, script, log, { cover: false });
  const frames = Math.ceil(tl.total * FPS);
  const dur = `${frames}/${FPS}s`;

  log("DaVinci: rendering the background");
  await renderLayer(tl, { pass: "bg", out: path.join(out, "Background.mp4"), log: () => {} });
  const bg = { file: "Background.mp4", name: "Background" };

  const clipsDir = path.join(out, "clips");
  await fs.mkdir(clipsDir, { recursive: true });
  const elements = [];
  const want = [];
  tl.timeline.forEach((b, i) => {
    const f0 = i === 0 ? 0 : Math.round(b.t0 * FPS);
    const f1 = i === tl.timeline.length - 1 ? frames : Math.round(tl.timeline[i + 1].t0 * FPS);
    if (f1 <= f0) return;
    const tag = `B${String(i + 1).padStart(2, "0")}`;
    const add = (pass, name, lane) => want.push({ pass, name: `${tag} ${name}`, lane, f0, f1, beat: i });
    const setPiece = b.cards ? (b.layout === "verdict" ? "verdict" : "cards") : b.flow ? "flow" : b.slider ? "slider" : b.scale ? "scale" : b.mosaic ? "mosaic" : b.dm ? "DM ending" : b.plugin ? b.plugin.id : b.layout === "board" ? "swatches" : null;
    if (setPiece) add("el:set", `Set piece (${setPiece})`, LANES.set);
    b.images.forEach((_, k) => add(`el:img:${k}`, `Image ${k + 1}`, LANES.image + Math.min(k, 2)));
    const behind = (p) => b.heroBehind && p.hero && p.hero !== "sticker" && (!p.abs || p.giant);
    const pieces = b.caption || (b.motion === "stack" && b.layout === "type") ? b.pieces.slice(0, 1) : b.pieces;
    pieces.forEach((p, k) => {
      const words = b.caption ? "caption" : String(p.text).replace(/\s+/g, " ").slice(0, 24);
      add(`el:piece:${k}`, `Text ${k + 1} - ${words}`, !b.caption && behind(p) ? LANES.behind : LANES.text + Math.min(k, 3));
    });
    if (tl.sticker && tl.sticker.at < b.t1) add("el:sticker", "Save sticker", LANES.sticker);
    if (b.transition === "letter") add("el:fly", "Letter fly-through", LANES.fly);
  });
  for (const [k, e] of want.entries()) {
    const file = `${safe(e.name)}.mov`;
    log(`DaVinci: ${e.name} (${k + 1}/${want.length})`);
    const res = await renderElement(tl, { pass: e.pass, f0: e.f0, f1: e.f1, out: path.join(clipsDir, file) });
    if (!res.empty) elements.push({ ...e, file: `clips/${file}` });
  }

  log("DaVinci: audio stems");
  const T = tl.total.toFixed(3);
  const audio = [];
  await ffmpeg([
    "-i", narration.file, "-af", `apad,atrim=0:${T},loudnorm=I=-14:TP=-1.5`, "-ar", "48000", "-ac", "2",
    path.join(out, "A1 Voice.wav"),
  ]);
  audio.push({ file: "A1 Voice.wav", name: "Voice", lane: -1 });
  if (sfxFile) {
    await ffmpeg([
      "-i", sfxFile, "-af", `volume=${config.sfxVolume},apad,atrim=0:${T}`, "-ar", "48000", "-ac", "2",
      path.join(out, "A2 Sound effects.wav"),
    ]);
    audio.push({ file: "A2 Sound effects.wav", name: "Sound effects", lane: -2 });
  }
  if (music) {
    const fadeAt = Math.max(tl.total - 1.5, 0).toFixed(2);
    await ffmpeg([
      "-ss", String(musicStart), "-stream_loop", "-1", "-i", music, "-i", path.join(out, "A1 Voice.wav"),
      "-filter_complex",
      `[0:a]atrim=0:${T},asetpts=PTS-STARTPTS,loudnorm=I=${config.musicLufs}:TP=-2,afade=t=in:d=0.6,afade=t=out:st=${fadeAt}:d=1.5[m];` +
        `[m][1:a]sidechaincompress=threshold=0.05:ratio=4:attack=20:release=450[out]`,
      "-map", "[out]", "-ar", "48000", "-ac", "2", "-t", T, path.join(out, "A3 Music.wav"),
    ]);
    audio.push({ file: "A3 Music.wav", name: `Music (${path.basename(music)})`, lane: -3 });
  }

  const beats = tl.timeline.map((b, i) => {
    const words = narration.lines[i] ?? [];
    const start = words[0]?.start ?? b.t0;
    const end = words.at(-1)?.end ?? b.t1;
    return { i, start, end, text: script.beats[i].voiceover, t0: b.t0 };
  });
  await fs.writeFile(path.join(out, "Subtitles.srt"), toSrt(beats));
  if (await exists(path.join(dir, "cover.png"))) await fs.copyFile(path.join(dir, "cover.png"), path.join(out, "Cover.png"));

  await fs.writeFile(path.join(out, `${safe(title)}.fcpxml`), fcpxml({ title, out, bg, elements, audio, dur, frames, beats, tl, W: tl.outW ?? tl.W, H: tl.outH ?? tl.H }));
  await fs.writeFile(path.join(out, "HOW TO OPEN IN DAVINCI.txt"), howTo(elements, audio));

  log(`DaVinci export ready: ${out}`);
  return out;
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const safe = (s) => String(s).replace(/[\/\\:*?"<>|]+/g, "-").slice(0, 60).trim() || "Reel";
const frac = (sec) => `${Math.round(sec * FPS)}/${FPS}s`;

const LANES = { bg: 1, behind: 2, set: 3, image: 4, text: 7, sticker: 11, fly: 12 };
const TRACKS = [
  [1, "Background"], [2, "Text behind images"], [3, "Set pieces (cards, verdict, swatches...)"], [4, "Image 1"], [5, "Image 2"], [6, "Image 3"],
  [7, "Text line 1"], [8, "Text line 2"], [9, "Text line 3"], [10, "Text line 4+"], [11, "Save sticker"], [12, "Letter fly-through"],
];

function fcpxml({ title, out, bg, elements, audio, dur, frames, beats, tl, W, H }) {
  const url = (file) => encodeURI(`file://${path.join(out, file)}`);
  const fr = (f) => `${f}/${FPS}s`;
  let id = 2;
  const bgId = `r${id++}`;
  const els = elements.map((e) => ({ ...e, id: `r${id++}` }));
  const aAssets = audio.map((a) => ({ ...a, id: `r${id++}` }));
  const assetXml = [
    `    <asset id="${bgId}" name="Background" src="${url(bg.file)}" start="0s" duration="${dur}" hasVideo="1" format="r1" videoSources="1" hasAudio="0"/>`,
    ...els.map((e) => `    <asset id="${e.id}" name="${esc(e.name)}" src="${url(e.file)}" start="0s" duration="${fr(e.f1 - e.f0)}" hasVideo="1" format="r1" videoSources="1" hasAudio="0"/>`),
    ...aAssets.map((a) => `    <asset id="${a.id}" name="${esc(a.name)}" src="${url(a.file)}" start="0s" duration="${dur}" hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000"/>`),
  ].join("\n");
  const bgClips = tl.timeline.map((b, i) => {
    const f0 = i === 0 ? 0 : Math.round(b.t0 * FPS);
    const f1 = i === tl.timeline.length - 1 ? frames : Math.round(tl.timeline[i + 1].t0 * FPS);
    return f1 > f0 ? `        <asset-clip ref="${bgId}" lane="${LANES.bg}" offset="${fr(f0)}" name="B${String(i + 1).padStart(2, "0")} Background" start="${fr(f0)}" duration="${fr(f1 - f0)}"/>` : "";
  });
  const connected = [
    ...bgClips.filter(Boolean),
    ...els.map((e) => `        <asset-clip ref="${e.id}" lane="${e.lane}" offset="${fr(e.f0)}" name="${esc(e.name)}" start="0s" duration="${fr(e.f1 - e.f0)}"/>`),
    ...aAssets.map((a) => `        <asset-clip ref="${a.id}" lane="${a.lane}" offset="0s" name="${esc(a.name)}" start="0s" duration="${dur}"/>`),
    ...beats.map((b) => `        <marker start="${frac(b.t0)}" duration="1/${FPS}s" value="${esc(`${b.i + 1}. ${b.text}`)}"/>`),
  ].join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.8">
  <resources>
    <format id="r1" name="FFVideoFormat${W}x${H}p${FPS}" frameDuration="1/${FPS}s" width="${W}" height="${H}"/>
${assetXml}
  </resources>
  <library>
    <event name="${esc(title)}">
      <project name="${esc(title)}">
        <sequence format="r1" duration="${dur}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
            <gap name="Reel" offset="0s" start="0s" duration="${dur}">
${connected}
            </gap>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}

function toSrt(beats) {
  const ts = (t) => {
    const ms = Math.max(0, Math.round(t * 1000));
    const p2 = (n) => String(n).padStart(2, "0");
    return `${p2(Math.floor(ms / 3600000))}:${p2(Math.floor((ms % 3600000) / 60000))}:${p2(Math.floor((ms % 60000) / 1000))},${String(ms % 1000).padStart(3, "0")}`;
  };
  return beats.map((b, k) => `${k + 1}\n${ts(b.start)} --> ${ts(b.end)}\n${b.text}\n`).join("\n");
}

function howTo(elements, audio) {
  const used = new Set(elements.map((e) => e.lane));
  return `DaVinci Resolve project for your reel (every element is its own clip)
=====================================================================

1. Keep this folder where it is (the timeline points to these files). If you move it, relink.
2. Open DaVinci Resolve and create a new project.
3. File > Import > Timeline... and choose the .fcpxml file in this folder.
   Keep "Automatically import source clips into media pool" ticked.
4. The timeline opens at 1080x1920, 30 fps. Each beat's pieces are separate clips, named by beat
   (B05 = beat 5), on these tracks (bottom to top; empty tracks can be ignored):

${TRACKS.filter(([l]) => l === 1 || used.has(l)).map(([, n]) => `   ${n}`).join("\n")}
${audio.map((a) => `   A${-a.lane}  ${a.name}`).join("\n")}

   Markers on the timeline show where each beat starts, labelled with its line.

Editing
- Click any clip (an image, one line of text, the sticker) and use Inspector > Transform to move
  (Position X/Y), resize (Zoom), rotate or fade (Opacity) it. Delete a clip to remove it.
- Every clip keeps its own animation. The words themselves are rendered, not live text: to change
  the wording, change it in the reel engine and export again (only changed beats re-render).
- Optional: File > Import > Subtitle... and choose Subtitles.srt for burned-in captions.

Tips
- If Resolve asks for a different project resolution, choose "Use timeline settings"
  or set the project to 1080x1920 at 30 fps first.
- rough-cut.mp4 in the reel's folder (one level up) is the engine's own render, for comparison.
- Posting with music baked in can get the reel muted; you can mute the music and add the song in Instagram.
`;
}
