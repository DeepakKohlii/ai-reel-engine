import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const config = {
  root,
  packsDir: path.join(root, "packs"),
  musicDir: path.join(root, "assets", "music"),
  port: Number(process.env.PORT || 4747),

  claudeModel: process.env.CLAUDE_MODEL || "claude-opus-5",

  elevenLabsKey: process.env.ELEVENLABS_API_KEY || "",
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID || "",
  elevenLabsVoiceIdEn: process.env.ELEVENLABS_VOICE_ID_EN || "",
  elevenLabsModel: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
  elevenLabsFallbackVoiceId: process.env.ELEVENLABS_FALLBACK_VOICE_ID ?? "TX3LPaxmHKxFdv7VOQHJ",
  elevenLabsFallbackName: process.env.ELEVENLABS_FALLBACK_VOICE_NAME ?? "Liam",
  voiceSpeed: Number(process.env.VOICE_SPEED || 1.0),
  ttsProvider: process.env.TTS_PROVIDER || "",
  sarvam: {
    key: process.env.SARVAM_API_KEY || "",
    speaker: process.env.SARVAM_SPEAKER || "shubh",
    pace: Number(process.env.SARVAM_PACE || 1.05),
    paceEn: Number(process.env.SARVAM_PACE_EN || 0.97),
  },
  macVoice: process.env.MAC_VOICE || "Rishi",

  pexelsKey: process.env.PEXELS_API_KEY || "",

  gemini: {
    key: process.env.GEMINI_API_KEY || "",
    model: process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image",
  },

  cloudflare: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || "",
    token: process.env.CLOUDFLARE_API_TOKEN || "",
    model: process.env.CLOUDFLARE_IMAGE_MODEL || "@cf/black-forest-labs/flux-2-klein-4b",
  },

  fonts: {
    title: process.env.FONT_TITLE || "/System/Library/Fonts/Supplemental/Impact.ttf",
    caption: process.env.FONT_CAPTION || "/System/Library/Fonts/Supplemental/Arial Black.ttf",
  },

  video: { width: 1080, height: 1920, fps: 30 },
  musicVolume: Number(process.env.MUSIC_VOLUME || 0.12),
  sfxVolume: Number(process.env.SFX_VOLUME || 1.3),
  finalLufs: Number(process.env.FINAL_LUFS || -13),
  musicLufs: Number(process.env.MUSIC_LUFS || -19),
};
