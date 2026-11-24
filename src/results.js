import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { readJson, writeJson } from "./util.js";

export const FIELDS = ["views", "reach", "likes", "comments", "saves", "shares", "follows", "watch"];
const file = (slug) => path.join(config.packsDir, path.basename(slug), "results.json");

export const getResults = (slug) => readJson(file(slug), null);

export async function saveResults(slug, data) {
  const clean = { posted: String(data.posted ?? "").slice(0, 20), notes: String(data.notes ?? "").slice(0, 500) };
  if (/^https:\/\/(www\.)?instagram\.com\//.test(data.link ?? "")) clean.link = String(data.link).slice(0, 200);
  if (/^\d+$/.test(String(data.media_id ?? ""))) clean.media_id = String(data.media_id);
  for (const k of FIELDS) {
    const n = Number(String(data[k] ?? "").replace(/[, ]/g, ""));
    if (Number.isFinite(n) && n >= 0) clean[k] = n;
  }
  await writeJson(file(slug), { ...clean, updated: Date.now() });
  return clean;
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

export async function performanceContext() {
  const slugs = await fs.readdir(config.packsDir).catch(() => []);
  const rows = [];
  for (const slug of slugs) {
    const r = await getResults(slug);
    if (!r?.views) continue;
    const s = await readJson(path.join(config.packsDir, slug, "script.json"));
    if (!s) continue;
    const saveRate = (r.saves ?? 0) / r.views;
    const shareRate = (r.shares ?? 0) / r.views;
    rows.push({
      title: s.title,
      hook: s.beats?.[0]?.voiceover ?? "",
      beats: s.beats?.length ?? 0,
      typeset: s.typeset,
      score: saveRate + shareRate * 1.5,
      line: `${r.views} views, saves ${pct(saveRate)}, shares ${pct(shareRate)}, comments ${r.comments ?? 0}, follows ${r.follows ?? 0}${r.watch ? `, avg watch ${r.watch}s` : ""}${r.notes ? `. Creator's note: ${r.notes}` : ""}`,
    });
  }
  if (rows.length < 2) return "";
  rows.sort((a, b) => b.score - a.score);
  const fmt = (x) => `- "${x.title}" (hook: "${x.hook}", ${x.beats} beats, ${x.typeset}): ${x.line}`;
  const n = Math.min(3, Math.floor(rows.length / 2));
  return [
    `Real results from this channel's posted reels (${rows.length} so far), best and worst by save + share rate. Learn what the best ones did differently (hook type, topic, length, rule style) and push new scripts that way:`,
    "Best:",
    ...rows.slice(0, n).map(fmt),
    "Weakest:",
    ...rows.slice(-n).map(fmt),
  ].join("\n");
}
