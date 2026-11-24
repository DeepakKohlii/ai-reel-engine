import fs from "node:fs/promises";
import measure from "./measure.js";

export const learnedDir = new URL("./learned/", import.meta.url);
export const DEVICES = {};

export function validDevice(d) {
  return d && typeof d.id === "string" && /^[a-z][a-z0-9_]{1,30}$/.test(d.id) && typeof d.name === "string" && typeof d.draw === "function";
}

export async function loadDevices() {
  for (const k of Object.keys(DEVICES)) delete DEVICES[k];
  DEVICES[measure.id] = { ...measure, builtIn: true };
  for (const f of await fs.readdir(learnedDir).catch(() => [])) {
    if (!f.endsWith(".js")) continue;
    try {
      const mod = await import(`${new URL(f, learnedDir).href}?v=${Date.now()}`);
      if (validDevice(mod.default)) DEVICES[mod.default.id] = { ...mod.default, learned: true };
    } catch {}
  }
  return DEVICES;
}
await loadDevices();

export const deviceList = () => Object.values(DEVICES).map((d) => `- ${d.id}: ${d.name}. ${d.when ?? ""}${d.uses ? ` (${d.uses})` : ""}`).join("\n");
