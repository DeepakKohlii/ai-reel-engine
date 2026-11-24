import fs from "node:fs/promises";
import path from "node:path";
import { concatVideo, concatVoice, finalMix, pickMusic, renderSegments } from "../render.js";
import { buildTextTrack } from "../typography.js";
import { pad, writeJson } from "../util.js";
import { gatherVisuals } from "../visuals.js";
import { generateVoice } from "../voice.js";
import { writeCaption } from "./shared.js";

export const id = "classic";
export const label = "Quick tips (captions)";

export const brief = `You write scripts for a faceless Instagram Reels channel about men's fashion in India.

Audience: Indian guys, 17-28, college students and first-job types. Budget-conscious, shop on Myntra, Ajio, Amazon, Meesho, Snitch, Bewakoof. Scroll fast and have seen every generic "5 outfit tips" reel already.

Voice of the channel: a bakchod elder-brother friend who actually knows style. Hinglish (Roman script), casual, roasting, funny, confident. Think "bhai ye kya pehen ke aaya hai" energy, but the advice is genuinely useful. Short punchy sentences. Desi references (shaadi season, college fest, first date at Starbucks, office Monday, mummy ki pasand ki shirt, Instagram DP). Never cringe-corporate, never preachy. Light roasting of bad fashion choices is great; never insult body types, skin colour, caste, religion or income.

The voiceover is read aloud by an AI voice, so write it the way it should be spoken: Roman-script Hinglish, no emoji, no hashtags, no symbols like "&" or "/", write prices as "999 rupees" or "under 1500" (not "₹"). Each scene's voiceover is one or two short sentences, about 1.5 to 4 seconds when spoken.

Structure that works on this niche:
1. Scene 1 is the hook. It must stop the scroll in under 1 second: a callout, a bold claim, a roast, or a "stop doing this". The on-screen hook text is the most important text in the whole reel.
2. Deliver the value fast: one item, formula or mistake per scene, each with a concrete detail (colour, fit, fabric, price range, what to pair it with). Add a pattern interrupt or joke every 2-3 scenes so people keep listening.
3. The last scene is the call to action: comment the keyword to get the links (the account auto-DMs them), plus a reason to follow. Keep it funny.

Total spoken length: 20-35 seconds, 6-9 scenes.

For each scene choose the visual:
- "stock_video": real footage from a free stock library. Give an English search query of 2-4 plain words that stock sites actually have (e.g. "man buttoning shirt", "sneakers closeup", "man walking city"). Good for lifestyle and motion.
- "ai_image": an AI-generated still (it gets a slow zoom). Use for specific outfits, flat-lays and product shots. Write a detailed prompt: vertical 9:16, subject, clothing items with colours, background, lighting, "photorealistic fashion photography". When a person appears, say "young Indian man" (the audience should see themselves); faces are fine, but no celebrities, brand logos or text in the image.
- "ai_video": only for 1-2 hero moments where motion really matters (e.g. the hook). The creator generates these by hand in free AI video tools, so write a 5-second video prompt with camera movement. Use it sparingly.
Always fill both stock_query and ai_prompt, whichever type you pick, so there's a fallback.

on_screen_text is the big title for that scene: 2-6 words, punchy, no emoji. Scene 1's on_screen_text is the hook. highlight_words are 1-3 words from that scene's voiceover to colour in the captions (the funny or key words).

Never copy other creators' scripts. Don't make up specific product claims or exact prices for named brands; use price ranges and generic item names.`;

export const schema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "angle", "scenes", "caption", "hashtags", "comment_keyword", "music_vibe"],
  properties: {
    title: { type: "string", description: "Internal title for the reel" },
    angle: { type: "string", description: "One line: why this reel will get shares and comments" },
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["voiceover", "on_screen_text", "visual_type", "stock_query", "ai_prompt", "highlight_words"],
        properties: {
          voiceover: { type: "string" },
          on_screen_text: { type: "string" },
          visual_type: { type: "string", enum: ["stock_video", "ai_image", "ai_video"] },
          stock_query: { type: "string" },
          ai_prompt: { type: "string" },
          highlight_words: { type: "array", items: { type: "string" } },
        },
      },
    },
    caption: { type: "string", description: "Instagram caption, Hinglish, ends with the comment-keyword CTA" },
    hashtags: { type: "array", items: { type: "string" } },
    comment_keyword: { type: "string", description: "Single word to comment, e.g. LINK" },
    music_vibe: { type: "string", description: "Background music mood to search for" },
  },
};

export const task = ({ topic, notes }) =>
  [`Write a reel script for this topic: ${topic}`, notes && `Extra notes from the creator: ${notes}`]
    .filter(Boolean)
    .join("\n\n");

export async function build(dir, script, log, { final = false } = {}) {

  const voices = await generateVoice(dir, script, log, { final });
  const visuals = await gatherVisuals(dir, script, log);

  let t = 0;
  const scenes = script.scenes.map((scene, i) => {
    const duration = Math.max(voices[i].duration + 0.12, 1.2);
    const s = {
      start: t,
      duration,
      audio: voices[i].file,
      words: voices[i].words,
      visual: visuals[i],
      title: scene.on_screen_text,
      highlight: scene.highlight_words,
    };
    t += duration;
    return s;
  });

  const textTrack = await buildTextTrack(dir, scenes, log);

  const buildDir = path.join(dir, "build");
  await fs.rm(buildDir, { recursive: true, force: true });
  await fs.mkdir(buildDir, { recursive: true });
  const segments = await renderSegments(buildDir, scenes, log);
  const video = await concatVideo(buildDir, segments);

  log("Mixing voiceover");
  const voice = await concatVoice(path.join(dir, "voiceover.m4a"), scenes);
  const music = await pickMusic();
  if (music) log(`Music: ${path.basename(music)}`);
  else log("No music in assets/music, so the rough cut has voice only. Add trending audio in Instagram when posting.");

  log("Final render");
  await finalMix({ video, textTrack, voice, music, total: t, out: path.join(dir, "rough-cut.mp4") });

  await writeJson(path.join(dir, "timeline.json"), {
    total: t,
    scenes: scenes.map((s, i) => ({
      scene: i + 1,
      start: +s.start.toFixed(2),
      duration: +s.duration.toFixed(2),
      visual: path.relative(dir, s.visual.file),
      source: s.visual.source,
    })),
  });
}

export async function writeDocs(dir, script) {
  await writeCaption(dir, script);
  const md = [
    `# ${script.title}`,
    "",
    `**Topic:** ${script.topic ?? ""}  `,
    `**Angle:** ${script.angle}  `,
    `**Music vibe:** ${script.music_vibe}  `,
    `**Comment keyword:** ${script.comment_keyword}`,
    "",
    ...script.scenes.flatMap((s, i) => [
      `## Scene ${pad(i + 1)}: ${s.on_screen_text}`,
      "",
      `**Voiceover:** ${s.voiceover}  `,
      `**Visual (${s.visual_type}):** ${s.visual_type === "stock_video" ? s.stock_query : s.ai_prompt}`,
      "",
    ]),
  ].join("\n");
  await fs.writeFile(path.join(dir, "script.md"), md);

  const videoScenes = script.scenes.map((s, i) => ({ ...s, n: pad(i + 1) })).filter((s) => s.visual_type === "ai_video");
  const prompts = [
    "# AI video prompts",
    "",
    "Generate these in a free AI video tool (Kling, Hailuo, Vidu, Pika, Veo) at 9:16, about 5 seconds.",
    "Save the result as `overrides/scene-NN.mp4` (or upload it in the app), then click Build again.",
    "",
    ...(videoScenes.length
      ? videoScenes.flatMap((s) => [`## scene-${s.n}.mp4: ${s.on_screen_text}`, "", "```", s.ai_prompt, "```", ""])
      : ["No scenes need AI video in this script. The stock clips and AI images cover everything.", ""]),
  ].join("\n");
  await fs.writeFile(path.join(dir, "ai-video-prompts.md"), prompts);
}

