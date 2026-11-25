import path from "node:path";
import { askJson } from "../../claude.js";
import { writeCaption } from "../shared.js";

export const CAPTION_RULES = `Instagram caption rules:
- Same language as the voiceover, simple everyday words.
- Line 1 (under 110 characters) is a curiosity hook that doesn't repeat the reel's first line.
- Then 3-5 short lines with the actual value, in words people search for.
- Then one save line and the comment keyword.
- At most 2 emojis. No fake claims. 3-5 specific hashtags.`;

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
