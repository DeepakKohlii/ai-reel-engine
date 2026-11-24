import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";

export function scriptProvider() {
  const forced = process.env.SCRIPT_PROVIDER;
  if (forced) return forced;
  if (process.env.ANTHROPIC_API_KEY) return "api";
  if (findClaudeCli()) return "cli";
  return "manual";
}

export function findClaudeCli() {
  const candidates = [
    process.env.CLAUDE_CLI_PATH,
    ...(process.env.PATH ?? "").split(path.delimiter).map((dir) => path.join(dir, "claude")),
    path.join(os.homedir(), ".local", "bin", "claude"),
    path.join(os.homedir(), ".claude", "local", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ].filter(Boolean);
  return candidates.find((file) => {
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export function textPrompt(system, task, schema) {
  return [
    system,
    "---",
    task,
    "Reply with only a JSON object (no markdown fences, no commentary) that matches this JSON Schema:",
    JSON.stringify(schema, null, 2),
  ].join("\n\n");
}

export async function askJson({ system, task, schema, effort = "high", webSearch = false, images = [] }) {
  const provider = scriptProvider();
  if (provider === "api") return askApi(system, task, schema, effort, webSearch, images);
  if (provider === "cli") return askCli(system, task, schema, webSearch, images);
  const err = new Error("No Claude connection. Use the claude.ai copy/paste option, or install Claude Code (see README).");
  err.code = "NO_PROVIDER";
  throw err;
}

async function askApi(system, task, schema, effort, webSearch, images = []) {
  const client = new Anthropic();
  const content = images.length
    ? [
        ...images.map((file) => ({
          type: "image",
          source: { type: "base64", media_type: /\.jpe?g$/i.test(file) ? "image/jpeg" : "image/png", data: fs.readFileSync(file).toString("base64") },
        })),
        { type: "text", text: task },
      ]
    : task;
  const messages = [{ role: "user", content }];
  let response;
  for (let turn = 0; turn < 4; turn++) {
    response = await client.beta.messages.create({
      model: config.claudeModel,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort, format: { type: "json_schema", schema } },
      tools: webSearch ? [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }] : undefined,
      system,
      messages,
    });
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined this request. Try rephrasing the topic.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Claude's response was cut off. Try again.");
  }
  const text = response.content.filter((b) => b.type === "text").at(-1)?.text;
  if (!text) throw new Error("Claude returned no text.");
  return parseJsonReply(text);
}

async function askCli(system, task, schema, webSearch, images = []) {
  const look = images.length ? `First look at each of these images with the Read tool:\n${images.map((f) => `- ${f}`).join("\n")}\n\n` : "";
  const prompt = textPrompt(system, look + task, schema);
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await runClaudeCli(prompt, webSearch, images);
    try {
      return parseJsonReply(raw);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function runClaudeCli(prompt, webSearch = false, images = []) {
  const bin = findClaudeCli();
  const args = ["-p", "--output-format", "json", "--max-turns", String(webSearch ? 12 : images.length ? images.length + 4 : 1)];
  if (webSearch) args.push("--allowedTools", "WebSearch,WebFetch");
  if (images.length) {
    args.push("--allowedTools", "Read");
    for (const dir of new Set(images.map((f) => path.dirname(f)))) args.push("--add-dir", dir);
  }
  if (process.env.CLAUDE_CLI_MODEL) args.push("--model", process.env.CLAUDE_CLI_MODEL);

  const env = { ...process.env };
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_API_KEY;

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: os.tmpdir(), env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), (webSearch || images.length ? 10 : 5) * 60_000);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      let out;
      try {
        out = JSON.parse(stdout);
      } catch {
        return reject(new Error(`Claude Code failed (exit ${code}): ${(stderr || stdout).slice(-400)}`));
      }
      if (out.is_error) {
        const hint = /log ?in|auth|credential/i.test(out.result ?? "") ? " Run `claude` once in Terminal and log in." : "";
        return reject(new Error(`Claude Code: ${String(out.result).slice(0, 300)}${hint}`));
      }
      resolve(out.result ?? "");
    });
    child.stdin.end(prompt);
  });
}

export function parseJsonReply(text) {
  const trimmed = String(text).trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Couldn't find JSON in Claude's reply");
  return JSON.parse(body.slice(start, end + 1));
}

