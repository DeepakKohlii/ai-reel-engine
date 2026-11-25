import { withTemplate } from "./templates.js";
import path from "node:path";
import { askJson, textPrompt } from "./claude.js";
import { config } from "./config.js";
import { readJson, writeJson } from "./util.js";
import { performanceContext } from "./results.js";

const ideasFile = path.join(config.packsDir, ".ideas.json");

const STRATEGIST = `You are the content strategist for a short-video channel. Reels are 25-40 seconds of kinetic typography with a voiceover, on any subject. Each one teaches or tells ONE clear thing people will save or send.`;

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
          hook: { type: "string", description: "The first line of the voiceover, scroll-stopping" },
          why_now: { type: "string", description: "The trend, season, festival or search interest that makes this timely" },
          angle: { type: "string", description: "What makes our take fresh (not what the reference pages already did)" },
        },
      },
    },
  },
};

function task(recent, results = "") {
  const today = new Date().toLocaleDateString("en", { day: "numeric", month: "long", year: "numeric" });
  return [
    `Today is ${today}. Check what is timely (use web search if you can), then give 10 reel ideas that suit the template, across varied subjects. Each needs a specific hook and a fresh angle.`,
    results,
    recent.length && `Topics already made (don't repeat them):\n- ${recent.join("\n- ")}`,
  ].filter(Boolean).join("\n\n");
}

export async function trendingIdeas({ recent = [], template }) {
  const { ideas } = await askJson({ system: withTemplate(STRATEGIST, template), task: task(recent, await performanceContext()), schema: IDEAS_SCHEMA, effort: "high", webSearch: true });
  await saveIdeas(ideas);
  return ideas;
}

export const ideasPrompt = async (recent = [], template) => textPrompt(withTemplate(STRATEGIST, template), task(recent), IDEAS_SCHEMA);

export async function saveIdeas(ideas) {
  await writeJson(ideasFile, { at: Date.now(), ideas });
}

export const lastIdeas = () => readJson(ideasFile, { at: 0, ideas: [] });
