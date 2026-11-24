import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { getResults, saveResults } from "./results.js";
import { readJson, writeJson } from "./util.js";

const API = "https://graph.instagram.com";
const store = path.join(config.root, "assets", ".instagram.json");
const history = path.join(config.packsDir, ".instagram-history.json");

async function state() {
  return (await readJson(store, null)) ?? (process.env.INSTAGRAM_TOKEN ? { token: process.env.INSTAGRAM_TOKEN, refreshed: 0 } : null);
}

async function get(pathname, params, token) {
  const url = new URL(`${API}/${pathname}`);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const err = new Error(body.error?.message ?? `Instagram ${res.status}`);
    err.code = body.error?.code;
    throw err;
  }
  return body;
}

export async function connect(token) {
  token = String(token ?? "").trim();
  if (!token) throw new Error("Paste the access token first");
  const me = await get("me", { fields: "user_id,username,followers_count,media_count" }, token);
  await writeJson(store, { token, refreshed: Date.now(), username: me.username });
  return me;
}

export async function disconnect() {
  await fs.rm(store, { force: true });
}

async function freshToken() {
  const s = await state();
  if (!s?.token) return null;
  if (Date.now() - (s.refreshed ?? 0) > 7 * 864e5) {
    try {
      const r = await get("refresh_access_token", { grant_type: "ig_refresh_token" }, s.token);
      await writeJson(store, { ...s, token: r.access_token, refreshed: Date.now() });
      return r.access_token;
    } catch {
    }
  }
  return s.token;
}

const METRICS = ["views", "reach", "likes", "comments", "shares", "saved", "total_interactions", "ig_reels_avg_watch_time"];
async function insights(id, token) {
  const read = (list) => get(`${id}/insights`, { metric: list.join(",") }, token).then((r) => Object.fromEntries(r.data.map((m) => [m.name, m.values?.[0]?.value ?? m.total_value?.value ?? 0])));
  try {
    return await read(METRICS);
  } catch {
    const out = {};
    for (const m of METRICS) Object.assign(out, await read([m]).catch(() => ({})));
    return out;
  }
}

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const shortcode = (url) => /\/(?:reel|p)\/([^/?#]+)/.exec(url ?? "")?.[1] ?? null;

async function packIndex() {
  const slugs = (await fs.readdir(config.packsDir).catch(() => [])).filter((s) => !s.startsWith("."));
  const out = [];
  for (const slug of slugs) {
    const dir = path.join(config.packsDir, slug);
    const script = await readJson(path.join(dir, "script.json"));
    if (!script) continue;
    const caption = await fs.readFile(path.join(dir, "caption.txt"), "utf8").catch(() => "");
    const results = await getResults(slug);
    out.push({ slug, title: script.title, first: norm(caption.split("\n")[0]).slice(0, 60), code: shortcode(results?.link), mediaId: results?.media_id });
  }
  return out;
}

let last = { at: 0, error: "", account: null, reels: [] };
export const lastSync = () => last;

export async function sync() {
  const token = await freshToken();
  if (!token) {
    last = { at: Date.now(), error: "", account: null, reels: [] };
    return last;
  }
  try {
    const account = await get("me", { fields: "user_id,username,followers_count,follows_count,media_count" }, token);
    const media = await get("me/media", { fields: "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count", limit: "50" }, token);
    const packs = await packIndex();
    const reels = [];
    for (const m of media.data ?? []) {
      const metrics = await insights(m.id, token).catch(() => ({}));
      const pack =
        packs.find((p) => p.mediaId === m.id) ??
        packs.find((p) => p.code && p.code === shortcode(m.permalink)) ??
        packs.find((p) => p.first && norm(m.caption).startsWith(p.first.slice(0, 40)));
      const row = {
        id: m.id,
        permalink: m.permalink,
        timestamp: m.timestamp,
        caption: String(m.caption ?? "").split("\n")[0].slice(0, 120),
        type: m.media_product_type ?? m.media_type,
        slug: pack?.slug ?? null,
        title: pack?.title ?? null,
        views: metrics.views ?? 0,
        reach: metrics.reach ?? 0,
        likes: metrics.likes ?? m.like_count ?? 0,
        comments: metrics.comments ?? m.comments_count ?? 0,
        shares: metrics.shares ?? 0,
        saves: metrics.saved ?? 0,
        watch: metrics.ig_reels_avg_watch_time ? +(metrics.ig_reels_avg_watch_time / 1000).toFixed(1) : null,
      };
      reels.push(row);
      if (pack) {
        const old = (await getResults(pack.slug)) ?? {};
        await saveResults(pack.slug, {
          ...old,
          posted: old.posted || m.timestamp?.slice(0, 10),
          link: m.permalink,
          media_id: m.id,
          views: row.views,
          reach: row.reach,
          likes: row.likes,
          comments: row.comments,
          shares: row.shares,
          saves: row.saves,
          watch: row.watch ?? old.watch,
        });
      }
    }
    const h = await readJson(history, {});
    h[new Date().toISOString().slice(0, 10)] = account.followers_count;
    await writeJson(history, h);
    last = { at: Date.now(), error: "", account, reels, followers: h };
  } catch (err) {
    last = { ...last, at: Date.now(), error: err.message };
  }
  return last;
}

export async function status() {
  const s = await state();
  return { connected: !!s?.token, username: s?.username ?? null, ...last, followers: await readJson(history, {}) };
}

export function startAutoSync() {
  setTimeout(() => sync().catch(() => {}), 15000);
  setInterval(() => sync().catch(() => {}), 3 * 3600e3);
}
