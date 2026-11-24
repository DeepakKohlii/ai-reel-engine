import path from "node:path";
import { askJson } from "../../claude.js";
import { writeCaption } from "../shared.js";

export const CAPTION_RULES = `Instagram caption rules:
- Roman Hinglish, respectful "tum" (never "tu"/"tera"), simple everyday words, the way the voiceover talks.
- Line 1 is the only line people see before "more" (under ~110 characters): a curiosity hook that makes them tap or rewatch. Don't just repeat the reel's first line.
- Then 3-5 short lines with the actual value (the rule, what to check), so the caption is useful on its own and searchable: name the item, the fit and the occasion in plain words people search for ("white sneakers for men", "baggy jeans ke saath shoes").
- Then one save/share line ("Save kar lo next shopping ke liye", "Us dost ko bhejo jo..."), varied, not always the same.
- Then the CTA with the exact keyword: "Comments mein KEYWORD likho, main list tumhare DM mein bhej dunga."
- At most 2 emojis in the whole caption. No fake claims, no engagement bait beyond the keyword.
- Hashtags: 3-5 specific ones (Instagram now caps a post at 5), niche over generic (#whitesneakers #mensstyleindia over #fashion).`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["caption", "hashtags"],
  properties: {
    caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
  },
};

export async function rewriteCaption(dir, script, notes = "") {
  const lines = (script.beats ?? script.lines ?? []).map((b) => b.voiceover).join("\n");
  const task = [
    `Write the Instagram caption for this reel. Title: "${script.title}". Comment keyword: ${script.comment_keyword}.`,
    `The reel's voiceover:\n${lines}`,
    script.caption ? `The current caption (improve on it, don't copy it):\n${script.caption}` : "",
    notes ? `The creator's notes: ${notes}` : "",
  ].filter(Boolean).join("\n\n");
  const out = await askJson({ system: CAPTION_RULES, task, schema: SCHEMA, effort: "medium" });
  script.caption = out.caption.trim();
  script.hashtags = out.hashtags.map((t) => `#${String(t).replace(/^#+/, "").replace(/\s+/g, "")}`).slice(0, 5);
  await writeCaption(dir, script);
  return script;
}

export const captionFile = (dir) => path.join(dir, "caption.txt");
