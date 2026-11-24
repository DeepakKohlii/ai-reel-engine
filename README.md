# AI Reel Engine

Type a topic, get a finished Instagram reel. The engine writes the script, has it reviewed and rewritten, records the voice, finds or generates the images, designs and animates every beat, checks its own render, and exports the video with a cover and caption.

Everything runs on your machine with your own keys. There is no server and no account.

## Try it

```bash
git clone https://github.com/DeepakKohlii/ai-reel-engine.git
cd ai-reel-engine
npm install
npm start            # open http://localhost:4747
```

Needs Node 20+ and ffmpeg (`brew install ffmpeg`). Works best on macOS.

**You don't need any keys to try it.** Without them:

| Piece | Falls back to |
|---|---|
| Claude (scripts) | A logged-in Claude Code CLI if you have one. Otherwise the app shows the prompt, you paste it into claude.ai, and paste the reply back. |
| Voice | The free macOS voice |
| Images | A free image generator (lower quality) |

`http://localhost:4747` opens the product page. Click **Open the studio** (or go to `/studio`), type a topic (e.g. "monochrome outfits"), and hit **Create reel**.

---

## What it makes

| Format | Looks like | Language |
|---|---|---|
| **Style rules** (editorial) | Kinetic typography, colour boards, cutout models, colour wipes | Hinglish |
| **Aesthetic** | A calm studio look: one model whose outfit changes in place, with small graphics on the words | English |
| **AI fit** | A mirror-selfie outfit on an AI model with hook text and a "Comment LINK" sticker | Hinglish |
| **Quick tips** | Tips over stock or AI clips with word-by-word captions | Hinglish |

## How it works

```
 topic
   │
   ▼
 ideas ──────── Claude, using trending topics + past reel results
   │
   ▼
 script ─────── Claude writes JSON against a schema: one beat per on-screen idea
   │
   ▼
 writers' room ─ a second Claude pass scores the script and rewrites it until it passes
   │
   ▼
 voice ──────── TTS with word timings (Sarvam / ElevenLabs / macOS)
   │
   ▼
 visuals ────── tagged image library → generate what's missing (Gemini / Cloudflare / free)
   │             → background removal → colour check
   ▼
 design ─────── layout, type set, palette and motion per beat, drawn on canvas
   │
   ▼
 render ─────── frames + voice + sound effects + music → ffmpeg → rough-cut.mp4
   │
   ▼
 self-check ─── Claude looks at contact sheets of the render, fixes problems, rebuilds
```

### 1. Ideas (`src/ideas.js`)
Claude suggests topics using what's trending, the season, a topic bank (`assets/topic-bank.json`), and how past reels performed (`src/results.js`). You can also type your own topic.

### 2. Script (`src/script.js`, `src/formats/*/writer.js`, `scriptwriter.js`)
Every format has its own writer prompt and JSON schema. A script is a list of beats. Each beat has the spoken line, the on-screen words, the layout, the images it needs and the motion. `src/schema-check.js` validates the reply before anything else runs.

Claude is called through `src/claude.js`, which picks a provider in this order:
1. `ANTHROPIC_API_KEY` → the Anthropic API
2. A logged-in `claude` CLI → runs on your Claude subscription
3. Neither → manual copy/paste through claude.ai

### 3. Writers' room (`src/writers-room.js`)
A separate reviewer prompt scores the script 1–10 on eleven criteria (hook, specificity, proof, retention, save/share value, flow, language, accuracy, visuals, CTA and more) and lists the problems. If it doesn't pass, Claude rewrites or patches the script and it goes back to review. Your own notes on a script are treated as top-priority problems.

### 4. Voice (`src/voice.js`, `src/speakable.js`, `assets/pronunciation.json`)
- Lines are made speakable first: numbers, symbols and tricky words are rewritten using a pronunciation list.
- The voice comes back with word-level timings, so each word on screen appears exactly when it's spoken.
- Audio is cached by text and voice settings, so rebuilds don't pay again.

### 5. Visuals (`src/library.js`, `src/visuals.js`, `src/needs.js`)
- Images (models, garments, props) live in a tagged library and are reused across reels.
- Missing images are generated: Gemini if you have a key, otherwise Cloudflare Workers AI (FLUX.2), otherwise a free generator. A "host" reference photo keeps the same person across poses.
- Backgrounds are removed locally, and garments can be recoloured to an exact hex.
- The **Asset library** page lists every image a reel still needs, or only has a low-quality stand-in for, with a ready-to-paste prompt. Drop a better image on the card and it's swapped in on the next build.

### 6. Design and motion (`src/formats/`, `src/motions/`, `src/typography.js`)
- Each reel gets a type set, a palette and a set of motion "ingredients". `variety.js` makes sure reels don't all look alike.
- Text lockups use a small markup: `~script~`, `*serif*`, `#CONDENSED#`, `!sticker!`, `[label]`, `%handwritten%`.
- Image layouts include sandwich (words around a person), side, hero, cards, closeup, flow and boards.
- Motions are plugins in `src/motions/` (callouts, deck, pick, reveal…). The **Motion library** page previews them.
- Frames are drawn with `@napi-rs/canvas` and encoded with ffmpeg.

### 7. Sound (`src/sfx.js`, `src/beats.js`, `src/render.js`)
Sound effects land on visual hits, image moves can snap to the music's beats, music is ducked under the voice (sidechain compression), and the final mix is normalised to Instagram loudness.

### 8. Self-check (`src/formats/*/selfcheck.js`)
After rendering, the engine builds contact sheets of the video and asks Claude to look for problems: text over faces, unreadable or cut-off words, overlaps, empty frames, wrong colours. Problems are fixed and the reel is rebuilt.

### 9. Learn from a reel (`src/learn.js`)
Upload a reel you like. The engine:
- measures it locally: cuts, on-screen colours, sound hits, and the transcript;
- shows Claude timestamped frame sheets plus those measurements;
- saves a **style card** (`assets/styles/<id>/style.json`) covering typography, palettes, devices, transitions, pacing and sound rules.

New reels borrow a few ingredients from these cards instead of copying any one style. The uploaded video isn't kept.

### 10. Results (`src/instagram.js`, `src/results.js`)
Connect an Instagram professional account to pull per-reel stats (views, reach, likes, comments, saves, shares, follows, watch time). These feed back into the ideas step.

## Using the app

| Page | What it does |
|---|---|
| **+ New reel** | Get trending ideas or type a topic, then create the reel |
| **Aesthetic reels** | The English studio format |
| **Asset library** | Your images, missing images, and prompts to make them |
| **Learn from a reel** | Upload a reference and get a style card |
| **Motion library** | Preview every motion and rate it (like / dislike) |
| **Instagram** | Connect your account and sync results |

Every field of a script is editable on the reel page, and there's a raw JSON editor too. **Build reel** renders it. Voice, images and cutouts are cached, so a rebuild after an edit takes about a minute.

## Output

Each reel is a folder in `packs/<name>/`:

| File | What it is |
|---|---|
| `rough-cut.mp4` | The finished reel |
| `cover.png` | Grid cover |
| `caption.txt` | Caption and hashtags |
| `captions.srt` | Subtitles |
| `voiceover.mp3` | The voice track alone |
| `script.md` | The script |
| `visuals/`, `text/` | Per-scene images and transparent title stickers |

**Export for DaVinci** writes layered tracks (background, images, text, voice, sound effects, music) and an `.fcpxml` timeline you can import into DaVinci Resolve.

## Keys (all optional)

Copy `.env.example` to `.env` and fill in what you have.

| Key | Used for |
|---|---|
| `ANTHROPIC_API_KEY` | Claude through the API instead of the CLI |
| `SARVAM_API_KEY` | Indian Hinglish voices (new accounts get free credit) |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | ElevenLabs voices |
| `GEMINI_API_KEY` | Best image quality, with reference photos (paid per image) |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Free daily image quota with reference photos |
| `PEXELS_API_KEY` | Stock footage for Quick tips (free) |

## Project layout

```
src/
  server.js           HTTP API + static UI
  pipeline.js         build / polish / approve / self-check jobs
  claude.js           API, CLI or manual Claude calls with JSON schemas
  ideas.js            topic ideas
  script.js           script entry point
  writers-room.js     review and rewrite loop
  voice.js            TTS with word timings
  library.js          image library, generation, background removal
  visuals.js          per-scene images and clips
  needs.js            what a reel still needs from you
  learn.js            learn a style from a reference reel
  sfx.js, beats.js    sound effects and beat sync
  render.js           ffmpeg mix and encode
  instagram.js        Instagram stats
  formats/
    editorial/        Style rules format
    aesthetic/        Aesthetic format
    fit.js            AI fit format
    classic.js        Quick tips format
  motions/            motion plugins and previews
public/               the web UI
assets/               style cards, topic bank, pronunciation, preferences
packs/                your reels (git-ignored)
```

## Design decisions

- **Local-first.** It runs on your machine with your keys, so there are no hosting costs and your images never leave your computer.
- **Structured output everywhere.** Every Claude call returns JSON against a schema, so each step can be checked and edited before the next one runs.
- **A review loop, not one shot.** A separate reviewer pass catches weak hooks and filler before any money is spent on voice or images.
- **Images over AI video.** Still images with designed motion are cheaper, more consistent and easier to fix than generated video. Video is used only when something really has to move.
- **Learn principles, not templates.** Reference reels become style cards with ingredients, so reels don't all look the same.
- **Cache everything.** Voice, images and cutouts are keyed by their inputs, so an edit only rebuilds what changed.
