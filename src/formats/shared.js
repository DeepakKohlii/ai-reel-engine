import fs from "node:fs/promises";
import path from "node:path";

export async function writeCaption(dir, script) {
  const hashtags = (script.hashtags ?? []).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  await fs.writeFile(path.join(dir, "caption.txt"), `${script.caption}\n\n${hashtags}\n`);
}

export const AUDIENCE = `Audience: Indian guys, 17-28, college students and first-job types. Budget-conscious, shop on Myntra, Ajio, Amazon, Meesho, Snitch, Bewakoof. They scroll fast and have seen every generic "5 outfit tips" reel already.

Language: Hinglish in Roman script. Never insult body types, skin colour, caste, religion or income. Never copy other creators' scripts. Don't make up specific product claims or exact prices for named brands; use price ranges and generic item names.`;
