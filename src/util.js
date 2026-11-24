import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";

export function run(cmd, args, { input, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-1500)}`));
    });
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

export const ffmpeg = (args) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);

export async function mediaDuration(file) {
  const out = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file,
  ]);
  return Number(out.trim());
}

export const hash = (value) =>
  crypto.createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 12);

export const pad = (n) => String(n).padStart(2, "0");

export function slugify(text) {
  const base = text
    .toLowerCase()
    .replace(/₹/g, "rs")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "reel"}-${Date.now().toString(36)}`;
}

export async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

export const writeJson = (file, data) => fs.writeFile(file, JSON.stringify(data, null, 2));

export async function download(url, dest, { headers = {}, timeoutMs = 120_000 } = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Download failed ${res.status} for ${url.slice(0, 120)}`);
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

export const stripEmoji = (text = "") =>
  text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();
