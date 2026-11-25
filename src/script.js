import { askJson, textPrompt } from "./claude.js";
import * as classic from "./formats/classic.js";
import * as aesthetic from "./formats/aesthetic/index.js";
import * as editorial from "./formats/editorial/index.js";
import * as fit from "./formats/fit.js";
import { checkScript, publicSchema } from "./schema-check.js";
import { withTemplate } from "./templates.js";
import { performanceContext } from "./results.js";

export { parseJsonReply, scriptProvider } from "./claude.js";

export const FORMATS = { editorial, aesthetic, fit, classic };

export function getFormat(id) {
  const f = FORMATS[id ?? "classic"];
  if (!f) throw new Error(`Unknown format "${id}"`);
  return f;
}

export const formatList = () => Object.values(FORMATS).map((f) => ({ id: f.id, label: f.label }));

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
        required: ["topic", "hook", "why"],
        properties: { topic: { type: "string" }, hook: { type: "string" }, why: { type: "string" } },
      },
    },
  },
};

const ideasTask = (recent) =>
  [
    "Give 10 reel ideas for this format and channel. Each needs a scroll-stopping hook line and a one-line reason it will get saves, shares or comments. Mix the angles.",
    recent.length && `Topics already made (don't repeat these):\n- ${recent.join("\n- ")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

export function validateScript(script, formatId) {
  const f = getFormat(formatId ?? script?.format);
  const checked = checkScript(f.schema, script);
  checked.format = f.id;
  return checked;
}

export async function generateScript({ format, topic, notes = "" }) {
  const f = getFormat(format);
  const results = f.id === "editorial" ? await performanceContext() : "";
  const task = [f.task({ topic, notes }), results].filter(Boolean).join("\n\n");
  const raw = await askJson({ system: f.brief, task, schema: publicSchema(f.schema), effort: "high" });
  const script = validateScript(raw, f.id);
  script.topic = topic;
  return script;
}

export async function generateIdeas({ format, recent = [] }) {
  const f = getFormat(format);
  const { ideas } = await askJson({ system: f.brief, task: ideasTask(recent), schema: IDEAS_SCHEMA, effort: "medium" });
  return ideas;
}

export const manualScriptPrompt = ({ format, topic, notes, template }) => {
  const f = getFormat(format);
  return textPrompt(f.id === "editorial" ? withTemplate(f.brief, template) : f.brief, f.task({ topic, notes }), publicSchema(f.schema));
};

export const manualIdeasPrompt = ({ format, recent = [] }) =>
  textPrompt(getFormat(format).brief, ideasTask(recent), IDEAS_SCHEMA);
