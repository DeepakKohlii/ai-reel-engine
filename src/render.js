import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { ffmpeg, pad } from "./util.js";

const { width: W, height: H, fps: FPS } = config.video;
const ENCODE = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS)];

export async function renderSegments(buildDir, scenes, log) {
  const files = [];
  for (const [i, s] of scenes.entries()) {
    const out = path.join(buildDir, `seg-${pad(i + 1)}.mp4`);
    log(`Render: scene ${pad(i + 1)} (${s.duration.toFixed(1)}s)`);
    if (s.visual.kind === "video") {
      await ffmpeg([
        "-stream_loop", "-1", "-i", s.visual.file, "-t", s.duration.toFixed(3), "-an",
        "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS},eq=contrast=1.05:saturation=1.12`,
        ...ENCODE, out,
      ]);
    } else {
      const frames = Math.ceil(s.duration * FPS);
      const zoom = i % 2 === 0 ? `1+0.14*on/${frames}` : `1.14-0.14*on/${frames}`;
      const trim = s.visual.cropBottom ? `crop=iw:ih*${1 - s.visual.cropBottom}:0:0,` : "";
      await ffmpeg([
        "-i", s.visual.file, "-frames:v", String(frames),
        "-vf",
        `${trim}scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},` +
          `zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},` +
          `setsar=1,eq=contrast=1.05:saturation=1.12`,
        ...ENCODE, out,
      ]);
    }
    files.push(out);
  }
  return files;
}

export async function concatVideo(buildDir, segments) {
  const list = path.join(buildDir, "segments.txt");
  await fs.writeFile(list, segments.map((f) => `file '${f}'`).join("\n"));
  const out = path.join(buildDir, "video.mp4");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", out]);
  return out;
}

export async function concatVoice(dest, scenes) {
  const inputs = scenes.flatMap((s) => ["-i", s.audio]);
  const parts = scenes.map((s, i) => `[${i}:a]aresample=44100,apad=whole_dur=${s.duration.toFixed(3)},atrim=0:${s.duration.toFixed(3)}[a${i}]`);
  const filter = `${parts.join(";")};${scenes.map((_, i) => `[a${i}]`).join("")}concat=n=${scenes.length}:v=0:a=1,loudnorm=I=-14:TP=-1.5[out]`;
  await ffmpeg([...inputs, "-filter_complex", filter, "-map", "[out]", "-c:a", "aac", "-b:a", "192k", dest]);
  return dest;
}

export async function pickMusic() {
  const files = (await fs.readdir(config.musicDir).catch(() => [])).filter((f) => /\.(mp3|m4a|wav)$/i.test(f));
  if (!files.length) return null;
  return path.join(config.musicDir, files[Math.floor(Math.random() * files.length)]);
}

export async function finalMix({ video, textTrack, voice, music, total, out }) {
  const args = ["-i", video, "-f", "concat", "-safe", "0", "-i", textTrack, "-i", voice];
  let audio = "[2:a]anull[a]";
  if (music) {
    args.push("-stream_loop", "-1", "-i", music);
    audio =
      `[3:a]volume=${config.musicVolume},afade=t=out:st=${Math.max(total - 1.2, 0).toFixed(2)}:d=1.2[m];` +
      `[m][2:a]sidechaincompress=threshold=0.05:ratio=6:attack=20:release=300[md];` +
      `[2:a][md]amix=inputs=2:duration=first:normalize=0[a]`;
  }
  const filter = `[1:v]format=rgba[t];[0:v][t]overlay=0:0:eof_action=repeat,format=yuv420p[v];${audio}`;
  await ffmpeg([
    ...args, "-filter_complex", filter, "-map", "[v]", "-map", "[a]", "-t", total.toFixed(3),
    "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out,
  ]);
  return out;
}

export async function addMusicPreview(video, music, start, total, out) {
  const fadeAt = Math.max(total - 1.5, 0).toFixed(2);
  await ffmpeg([
    "-i", video, "-ss", String(start), "-stream_loop", "-1", "-i", music,
    "-filter_complex",
    `[1:a]loudnorm=I=${config.musicLufs}:TP=-2,afade=t=in:d=0.6,afade=t=out:st=${fadeAt}:d=1.5[m];` +
      `[0:a]asplit=2[v1][v2];[m][v2]sidechaincompress=threshold=0.05:ratio=4:attack=20:release=450[md];` +
      `[v1][md]amix=inputs=2:duration=first:normalize=0,loudnorm=I=${config.finalLufs}:TP=-1:LRA=9[a]`,
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", total.toFixed(3),
    "-movflags", "+faststart", out,
  ]);
  return out;
}
