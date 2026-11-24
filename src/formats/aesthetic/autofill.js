import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.js";
import { assetPath, generateAsset } from "../../library.js";
import { refDir, slotFile } from "./media.js";

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

async function pexelsClip(query, used) {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=15`;
  const res = await fetch(url, { headers: { Authorization: config.pexelsKey } });
  if (!res.ok) throw new Error(`Pexels ${res.status}`);
  const { videos = [] } = await res.json();
  const video = videos.find((v) => !used.has(v.id) && v.duration >= 3 && v.height > v.width) ?? videos.find((v) => !used.has(v.id));
  if (!video) return null;
  used.add(video.id);
  const files = video.video_files.filter((f) => f.file_type === "video/mp4").sort((a, b) => a.width - b.width);
  const file = files.find((f) => f.width >= 1080 && f.height > f.width) ?? files.find((f) => f.width >= 720) ?? files.at(-1);
  return file ? { link: file.link, credit: `Pexels video by ${video.user?.name ?? "unknown"}`, id: video.id } : null;
}

export async function autofill(dir, script, log = () => {}) {
  const slots = (script.media ?? []).filter((m) => m.source !== "ai");
  if (!slots.length) return [];
  await fs.mkdir(refDir(dir), { recursive: true });
  const creditsFile = path.join(refDir(dir), "credits.json");
  const credits = JSON.parse(await fs.readFile(creditsFile, "utf8").catch(() => "{}"));
  const used = new Set(Object.values(credits).map((c) => c.id).filter(Boolean));
  const done = [];
  for (const m of slots) {
    if (await slotFile(dir, m.key)) continue;
    try {
      if (m.kind === "clip") {
        if (!config.pexelsKey) {
          log(`  Clip "${m.key.replace(/_/g, " ")}": add a free Pexels key (PEXELS_API_KEY in .env, from pexels.com/api) and the engine fetches clips itself`);
          continue;
        }
        let hit = null;
        for (const q of [m.search, m.what?.split(/[,.:]/)[0]].filter(Boolean)) if ((hit = await pexelsClip(q, used))) break;
        if (!hit) {
          log(`  No Pexels clip found for "${m.key.replace(/_/g, " ")}"; it's left for you`);
          continue;
        }
        await download(hit.link, path.join(refDir(dir), `${m.key}.mp4`));
        credits[m.key] = { credit: hit.credit, id: hit.id };
        log(`  Clip "${m.key.replace(/_/g, " ")}": ${hit.credit}`);
      } else {
        const prompt = `${m.what}. A newly imagined scene with an invented person (not any real or famous person, no recognisable face of anyone), authentic candid photograph, natural light, vertical 9:16`;
        const a = await generateAsset({ prompt, tags: ["media", ...m.key.split("_")], kind: "cover", referenceIds: [] });
        await fs.copyFile(assetPath(a), path.join(refDir(dir), `${m.key}.png`));
        credits[m.key] = { credit: "AI image (made for this reel)" };
        log(`  Photo "${m.key.replace(/_/g, " ")}": made with AI from its description`);
      }
      done.push(m.key);
    } catch (err) {
      log(`  "${m.key.replace(/_/g, " ")}" skipped (${err.message.slice(0, 100)})`);
    }
  }
  await fs.writeFile(creditsFile, JSON.stringify(credits, null, 2));
  return done;
}
