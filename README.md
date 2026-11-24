# Reel Engine

An AI pipeline that turns a topic into a finished Instagram reel: script, review, voice, visuals, motion design, sound and render. It runs locally on your own keys.

## How it works

```
topic ─► ideas ─► script ─► writers' room ─► voice ─► visuals ─► design + motion ─► self-check ─► render
          Claude    Claude    review/rewrite   Sarvam /    Gemini /   canvas frames      Claude     ffmpeg
                              loop (Claude)    ElevenLabs  Cloudflare  per beat           vision
```

- **Script** (`src/script.js`, `src/formats/*/writer.js`): Claude writes structured JSON against a schema, one beat per on-screen idea.
- **Writers' room** (`src/writers-room.js`): a separate review pass scores the script, then rewrites or patches it until it passes.
- **Voice** (`src/voice.js`): TTS with word-level timings, so the typography lands on the spoken word.
- **Visuals** (`src/visuals.js`, `src/library.js`): a tagged image library with background removal. Missing images are generated and colour-checked.
- **Design and motion** (`src/formats/`, `src/motions/`): each beat is laid out and animated on `@napi-rs/canvas`, then the frames are encoded with ffmpeg.
- **Self-check** (`src/formats/*/selfcheck.js`): Claude looks at contact sheets of the rendered reel and flags problems before the reel goes out.
- **Learn a style** (`src/learn.js`): upload a reference reel. The engine measures its cuts, colours and sound hits, and Claude writes a reusable style card. Reels borrow ingredients from these cards instead of copying one template.

## Formats

| Format | Output |
|---|---|
| Editorial | Kinetic typography, colour boards and cutout models (Hinglish) |
| Aesthetic | A calm studio look where one model's outfit changes in place (English) |
| AI fit | A mirror-selfie outfit with hook text and a comment-to-DM sticker |
| Quick tips | Tips over stock or AI clips with word-by-word captions |

## Run it

Needs Node 20+ and ffmpeg.

```bash
npm install
cp .env.example .env
npm start            # http://localhost:4747
```

Claude runs through a logged-in [Claude Code](https://claude.com/claude-code) CLI or an `ANTHROPIC_API_KEY`. Every other key is optional: without them, the engine uses the macOS voice and free image generation.

## Output

Each reel is a folder in `packs/<name>/` holding `rough-cut.mp4`, the cover, caption, captions (`.srt`), the voice track, and per-scene assets. **Export for DaVinci** writes layered tracks and an `.fcpxml` timeline.
