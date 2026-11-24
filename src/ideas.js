import path from "node:path";
import { askJson, textPrompt } from "./claude.js";
import { config } from "./config.js";
import { readJson, writeJson } from "./util.js";
import { performanceContext } from "./results.js";

const ideasFile = path.join(config.packsDir, ".ideas.json");

const STRATEGIST = `You are the content strategist for a faceless Instagram Reels channel about men's style in India. The channel's format is "Style rules": short editorial reels (25-40s) with magazine-style kinetic typography, cutout images of models and garments (no host or presenter), colour swatches, and a Hinglish voiceover. Each reel teaches ONE clear, saveable styling rule.

Audience: Indian guys 17-28 (college, first job), budget-conscious, shop on Myntra, Ajio, Amazon, Snitch, Bewakoof.

Reference page types (inspiration for what works, never to copy their topics, titles or scripts):
- Colour-theory pages: colour theory rules, skin-tone colour guides, "1 item, 7 outfits", monochrome, the colour wheel, "Day X of 90 days to change your style" series. Saveable, educational, clean.
- Palette pages: outfit colour palettes and "Comment link for all outfits". Aesthetic, minimal, old money, clean fits.
- Budget-fit pages: budget outfits, corporate and Korean fits, "Comment LINK" for affiliate links.

What performs in this niche: rules people save ("never wear X with Y"), skin-tone and colour guides, budget-under-₹X, occasion styling (office, first date, college, wedding guest, festival), "stop doing this" mistakes, capsule wardrobes, trending aesthetics explained simply, and series that make people follow for the next part. Hooks are short, specific and a little provocative, in Hinglish.`;

const IDEAS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ideas"],
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "hook", "why_now", "angle"],
        properties: {
          topic: { type: "string", description: "What the reel teaches, short" },
          hook: { type: "string", description: "The first line of the voiceover, Hinglish, scroll-stopping" },
          why_now: { type: "string", description: "The trend, season, festival or search interest that makes this timely" },
          angle: { type: "string", description: "What makes our take fresh (not what the reference pages already did)" },
        },
      },
    },
  },
};

const bankFile = path.join(config.root, "assets", "topic-bank.json");
async function bankBrief() {
  const bank = await readJson(bankFile, null);
  if (!bank) return "";
  const now = new Date();
  const soon = new Date(now.getTime() + 45 * 864e5);
  const upcoming = (bank.calendar ?? []).filter((c) => new Date(c.to) >= now && new Date(c.from) <= soon);
  return [
    "Proven topics (each reached millions of views on several different Hindi men's style channels; our job is a fresher, better-designed take, never a copy):",
    ...(bank.evergreen ?? []).map((t) => `- ${t.topic} (${t.evidence}). Angles: ${t.angles.join("; ")}`),
    bank.share_pillar ? `Share pillar (about 1 in 5 reels): ${bank.share_pillar.note} Evidence: ${bank.share_pillar.evidence} Angles: ${bank.share_pillar.angles.join("; ")}` : "",
    upcoming.length ? `Coming up in the next 6 weeks (post 5-10 days BEFORE each moment, when people search for it):\n${upcoming.map((c) => `- ${c.from} to ${c.to}: ${c.moment}. Angles: ${c.angles.join("; ")}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

async function postedCount() {
  const fs = await import("node:fs/promises");
  const slugs = await fs.readdir(config.packsDir).catch(() => []);
  let n = 0;
  for (const s of slugs) if ((await readJson(path.join(config.packsDir, s, "results.json"), null))?.posted) n++;
  return n;
}

function task(recent, results = "", bank = "", posted = 0) {
  const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const mix = posted < 20
    ? "The channel is new (fewer than 20 reels posted), so lean on proven demand: 6 ideas from the proven topics below (a specific, fresh angle each), 3 tied to the upcoming festival/season moments, and 1 wildcard. Each idea should be useful or relatable enough that people send it on their own (never a line asking them to think of or tag a friend)."
    : "Mix: 3-4 tied to something happening now (festival, season, trend), 3 evergreen rules that always get saved, 2 mistakes/roasts, and 1-2 that could start a series.";
  return [
    `Today is ${today}.`,
    "First research what's timely right now (use web search if you can): men's fashion trends in India this month, occasions and festivals in the next 4-6 weeks (and what men wear to them), the weather and season, trending aesthetics, and what young Indian men are searching for about style.",
    `Then give 10 reel ideas for this channel. Quality over quantity: the channel only posts its best ideas, so every idea must be something a guy would genuinely save or send to a friend, with a hook that is specific (a real mistake, a real result, a claim that sounds wrong), not generic. ${mix} Every idea must be a genuinely different rule. Don't copy topics the reference pages have already posted; find our own angle.`,
    bank,
    results,
    recent.length && `Topics this channel already made (don't repeat them):\n- ${recent.join("\n- ")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function trendingIdeas({ recent = [] }) {
  const { ideas } = await askJson({ system: STRATEGIST, task: task(recent, await performanceContext(), await bankBrief(), await postedCount()), schema: IDEAS_SCHEMA, effort: "high", webSearch: true });
  await saveIdeas(ideas);
  return ideas;
}

export const ideasPrompt = async (recent = []) => textPrompt(STRATEGIST, task(recent, "", await bankBrief(), await postedCount()), IDEAS_SCHEMA);

export async function saveIdeas(ideas) {
  await writeJson(ideasFile, { at: Date.now(), ideas });
}

export const lastIdeas = () => readJson(ideasFile, { at: 0, ideas: [] });
