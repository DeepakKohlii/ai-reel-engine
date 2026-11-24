import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.js";
import { addMusicPreview } from "../../render.js";
import { exists, pad, readJson, writeJson } from "../../util.js";
import { makeSpeakable, remapWords } from "../../speakable.js";
import { addHolds, generateNarration, speakMode } from "../../voice.js";
import { AUDIENCE, writeCaption } from "../shared.js";
import { buildSfxTrack } from "../../sfx.js";
import { detectBeats } from "../../beats.js";
import { resolveVisuals } from "./assets.js";
import { renderCover } from "./cover.js";
import { TEXTURES, TYPESET_NAMES } from "./design.js";
import { MOTIONS, buildTimeline, renderVideo } from "./motion.js";
import { PLUGINS, pluginLayouts } from "../../motions/index.js";
import { CAPTION_RULES } from "./caption.js";

export const id = "editorial";
export const label = "Style rules (editorial typography)";

export const brief = `You write and art-direct reels for a faceless Instagram channel about men's style in India. The look is editorial kinetic typography mixed with cutout imagery: every spoken phrase appears on screen as a designed "lockup" of words on a solid, premium colour background, like a fashion magazine spread in motion, and most beats also show a cutout (a model wearing the look, a garment, a prop), colour swatches or a shade grid woven into the type.

${AUDIENCE}

Voice: a sharp, confident personal stylist who's also your friend. Hinglish, warm, a little witty, never preachy, always respectful. Address the viewer as "tum" (karo, dekho, likho, pehno, rakho); never "tu", "tere", "tera" or bare commands like "kar", "kar lo", "ruk", "bhej", which sound rude to this audience. Short spoken phrases. The value is real styling knowledge: colour theory (monochrome, complementary, the colour wheel, skin-tone matching), proportions and fit, the capsule wardrobe, "one item, many outfits", occasion dressing, old-money and minimal aesthetics, common mistakes. Each reel teaches ONE rule clearly with examples.

## Story (25-40 seconds spoken, 14-24 beats)
Use the curiosity loop that makes people watch to the end:
1. Stakes (beats 1-3): make them care in the first 2 seconds. Call out a mistake they're making or a result they want. "Agli baar baggy jeans pehno, usse pehle ye dekh lo."
2. Big question (beats 3-5): open a loop they need closed. "Par kaunsa colour? Wahi batata hoon."
3. Headfake (1-2 beats mid-reel): flip what they expect ("Sabko lagta hai mehenge kapde chahiye. Galat.") so attention resets.
4. Contrast and proof (the middle): show wrong vs right, before vs after, one item vs many looks, with concrete colours, items and price ranges.
5. Payoff + CTA (last 2 beats): close the loop, then ONE ask: the comment keyword with a specific promise ("Agar tumhe saare shoes ki list chahiye, toh comments mein SHOES likho, main list tumhare DM mein bhej dunga."). No tag/share/follow/save lines on top of it; one clear ask converts better than four. On screen, the comment keyword is the CTA beat's hero as a comic sticker word ("comments mein / !SHOES! / likho"): it pops with its own sound so it's the one word people remember. The CTA follows the beat rules like everything else: split it across 2-3 short beats (e.g. "Agar tumhe saare shoes ki list chahiye," / "toh comments mein SHOES likho," / "main list tumhare DM mein bhej dunga.") so the ending keeps moving; one long static CTA beat feels slow.
Change what's on screen every 1.5-2 seconds (new image, layout, motion or background) so there's always a reason to keep watching.

## Quality bar (this channel posts less, so every reel must be top-notch)
- Hook: a helpful heads-up that makes him stop before his next outfit, in the shape "Agli baar X pehno / kharido, usse pehle ye dekh lo" (the preferred opening), or a specific guy doing a specific thing, a result he wants, or a claim that sounds wrong. Keep it one short spoken sentence. Never a greeting, "aaj hum baat karenge", "kya aap jaante ho" or a slow setup.
- One rule, stated once as a short, repeatable line (under 7 words) he could say to a friend, then repeated at the payoff.
- Specific beats generic every time: named colours, items, fits, occasions and price ranges. Cut filler like "confidence is key", "style is personal", "dress to impress".
- Show, don't tell: every claim gets a visual (wrong vs right, the same item two ways, one item into three looks).
- No dead beats: every line adds new information or a turn. Don't restate the same point twice.
- Give him something to save (a formula, a cheat, a combo list); the value itself makes people share, no need to ask.
- Talk like a sharp 22-year-old Indian stylist to his friend: natural spoken Hinglish, confident, a bit witty, never textbook Hindi, never cringe, never preachy. Urban Indian guys use a lot of everyday English, so use it ("shoes dikh hi nahi rahe", "fit ekdum off lagta hai", "look instantly balanced ho jaata hai"). Avoid bookish or hard Hindi ("tikti hai", "nigal leti hai") and forced literal metaphors ("jeans shoe kha jaati hai").
- Flow: read ALL the voiceover lines together as one paragraph. It must sound like one person casually explaining to a friend, each line leading into the next, with no line that only makes sense if you see the picture. Write that paragraph first, then cut it into beats.
- The advice must be correct enough that a professional stylist would nod.
- On screen, avoid Hindi words that read as a different English word (pair = feet reads as "a pair", main, par, bat): reword them ("pair" -> "shoes"/"feet" or "joote") or make the meaning obvious from the image.

## Beats
A beat is 2-7 spoken words (about 1-2 seconds). All beats' voiceover read in order must flow as natural continuous speech. Write voiceover exactly as it should be spoken: Roman-script Hinglish, no emoji, no symbols, numbers as words where it reads better.

"speak" is the same voiceover line prepared for the Indian voice: Hindi words in Devanagari, English words in English letters, sentences ending with । (e.g. voiceover "Tumhare pair chhote lag rahe hain" -> speak "तुम्हारे पैर छोटे लग रहे हैं।"; "Agar tumhe saare shoes ki list chahiye, toh comments mein SHOES likho" -> "अगर तुम्हें सारे shoes की list चाहिए, तो comments में SHOES लिखो"). Same words, same order, same punctuation.

"text" is the on-screen lockup for that beat, built ONLY from words of that beat's voiceover, in the same order (you may drop filler words). Split into pieces with " / ". Mark exactly one hero word or short phrase, the emotional or key word:
- ~word~ script hero (flowing italic script; for feeling words: galti, stylist, style, best, perfect, expensive)
- *word* serif hero (bold editorial serif; for concepts: kapdon, fit, colours, shades)
- #WORD# condensed hero (tall bold caps; for rules and punchy nouns: RULE, SHADES, MONOCHROME, 3 COLOURS)
- !WORD! comic sticker hero (yellow, tilted, hard shadow; for punchy slang and emphasis: KAL, BAS, SABSE JYADA, BOOM, WOW). Use it 1-3 times per reel, not more.
Other pieces are small words. Write them in CAPS for bold small text or lowercase for lighter small text. Prefix ^ to colour a small piece with the accent. [WORD] makes a red label pill (BONUS, NEW, AVOID, RULE 2), and %words% a handwritten note that pins next to the beat's image ("%next colour%", "%save this%"). Good lockups: "TO YE / ~galti~ / MAT KARNA", "mein hota hai / *kapdon* / ke fit", "ek hi colour ke / #SHADES#", "aaj se / ~style~ / ^samjhenge". Keep hero words short (under 12 letters) so they can be big. Vary hero styles across beats; never use the same style three beats in a row.

"align" rotates between left, right and center for rhythm.

"motion" is how the words arrive: "rise" (soft blur-in, the default), "mask" (crisp slide-up from behind a line, editorial), "typewriter" (letters one by one; for reveals and lists), "slam" (the hero hits huge, skewed, with a shake; for punchlines and headfakes, 1-3 per reel), "stack" (3-5 consecutive beats on the same background with no image build one tilted 3D column of words, lyric-video style; great for a fast list or a rant). Vary motions through the reel.

## Imagery rules (the creator's standing rules)
- Show the subject. A reel about shoes shows shoes: product cutouts, zoom on the feet, models cropped waist-down (focus "lower"). Same for any item: the item itself first, the full outfit only when the whole look is the point.
- Models on at most about 30% of beats, never on consecutive beats unless it's one held shot; the rest are products, props, cards, swatches and typography. A reel full of standing models looks fake and isn't engaging.
- No words behind or over a model: with a model on screen the words sit beside him (layout side, align away from him) or above him (layout hero). Never sandwich a model.
- Pure typography beats (kind none) at most 2-3 per reel (a hook punch, the CTA). A type-led beat (a rule, a tip) otherwise gets a supporting product cutout in the bottom-right corner (kind asset, asset_kind item or prop, layout "corner").
- Reels are 30-40 seconds. Never longer.

## What to use when (the playbook)
Match each moment to a technique that fits it, and change it up across the reel and across reels:
- Hook: a clean model shot with the question, a slam or a giant hero word, or a letter fly-through out of the hook into the next beat.
- The problem / the mistake: zoom on the detail (shoes, hem, collar), or a verdict (wrong vs right) with stamps.
- Proof (same item, one change): before/after slider or compare; held model shots that punch in line by line.
- The rule: typography first (ghost words filling in, snap, stack column, or a giant word), few images.
- Examples / looks: flow (one item, many looks), side/hero outfit shots, scale for an order (slim -> straight -> baggy).
- A list, options or picks (and the CTA list): the items as photo cards.
- "You don't need all of this, you need this ONE piece": mosaic (layout "mosaic" on an outfit/asset beat whose first item is the hero piece; the engine fills the frame with product cutouts from the library, then slides them aside as the hero lands on a card). Once per reel at most, with few on-screen words.
- Quiet, premium moments where the garment should be the hero (a full outfit shot, a close product shot): text_style "caption" (a subtitle that builds word by word, the hero word in italic serif, a ^accent word in the accent colour) instead of a big lockup. 1-3 beats per reel.
- Colour points: swatch board or shades.
- CTA: the keyword as a sticker word; cards of the items if it promises a list.
Use 2-4 set pieces per reel (a set piece = flow, cards, slider, verdict, zoom, scale, duo, letter fly-through, giant word, punch crop, stack); the rest is clean typography and cutouts. Never the same set piece on two beats in a row.

## Look and camera (off by default; switch on when a learned style or the reel's mood calls for it)
"look" is the whole reel: frame "letterbox" (content in a 4:5 window between black bars, poster/lyric feel), cutouts "mono" (every cutout black-and-white so only the accent colour pops; set a beat's visual.exempt "yes" to keep one hero garment in colour), ghost "yes" (the rest of a line waits pale grey and flips to ink as it's spoken; best with motion "snap"), chroma "yes" (RGB fringe on fast camera moves), beat_sync "yes" (image entrances and camera hits land on the music's beats). Default: full, color, no, no, no.
Per beat: motion "snap" (word pops on in a frame, lyric-video style); camera "punch" (instant extreme crop onto the face or the detail the line names, for a punchline, 2-4 per reel max) or "rotate" (tilts and pushes in out of the beat, 1-2 per reel); transition "letter" (the camera flies through a letter of the hero word into the next beat; once per reel, near the start, on a hero word with O, D, B, P, R or A); hero_size "giant" (the hero word wider than the frame, pinned to the top, behind the model; for the biggest words); ghost "yes" (this beat's words wait pale and fill in as spoken, good for a list or a rule line). Visual "plinth" "yes" puts the model on an accent-coloured cube with smoke (hero outfit reveals); layout "duo" (compare/outfit with 2 images of the same model) puts a tiny full-body figure on a giant close-up's shoulder.
Type set "poster" is two-ink condensed caps (small words in the palette's ink, the stressed word in its accent at 2-3x the size); its two colours come from this reel's palette, so it works in any colourway, not only black and red.

## Type set
Pick "typeset" for the reel's mood: "editorial" (serif + flowing script, classic fashion magazine), "magazine" (italic serif + heavy grotesk, modern editorial), "poster" (two-ink condensed caps, rap-poster/lyric energy), "street" (marker lettering + tall caps, energetic, streetwear and roasts), "luxe" (Garamond + spaced caps, old money, weddings, premium), "modern" (wide Syne + Fraunces, trends and tech-y topics). Don't reuse the same set every reel.

## Engagement sticker
"sticker" is a short save/like prompt that sweeps across the screen mid-reel and then stays in the corner: { "text": "Save karo", "beat": N } where N is the first beat of the proof section (about 40% in). Keep the text 2-4 words.

## Colour palette (unique to every reel)
Design a palette for THIS reel: 3-4 colours in "palette", each { name, bg, accent, texture }. texture is "none", "paper" (crumpled paper), "grid" (grid paper, scrapbook feel) or "dots" (dot grid on dark, techy); use textures on some sections, not all. bg is a background colour, accent is the colour of hero words on it (it must stand out clearly). Pick colours that fit the topic and feel premium, and make every reel look different from the last; don't default to cream, tan and brown. Mix one or two dark backgrounds with one or two light ones for rhythm. Examples: Diwali = deep maroon #4A0E1B / gold #E6B84A, ivory #F4EDE0 / maroon #7A1F2B, bottle green #0E3B2E / champagne #E8D3A2. Denim = indigo #1B2A4A / sky #9CC3E6, off white #F2F0EA / indigo #26407A. Monsoon = slate #2F3A40 / sage #B7C9A8, fog #E6E9E4 / teal #1F6F6B. Summer = butter #F6E7A8 / tomato #D2452C, sky #CFE4F2 / navy #1F2A44. Old money = forest #1E3328 / cream #EFE3C8, stone #E9E4DA / forest #2C4A3A.
"theme" on each beat is "p1".."p4" (this reel's palette) or a "#RRGGBB" for a hero outfit shot on the outfit's own colour. Keep one theme per section (hook, rule, proof, CTA) and change it at section boundaries; a change triggers a colour-wipe transition. The cover theme is also "p1".."p4".

## Visuals: images in 55-70% of beats
Pure typography beats are the breathers; most beats carry an image. Think like an editor of a fashion page:

kind:
- none: typography only (use for the hook's first beat, punchlines and transitions).
- asset: one cutout (a %note% in its text draws a hand-drawn arrow from the note to the image, like an annotation). asset_kind "model" = a young Indian man wearing the look being discussed (outfit examples, a mistake being shown, the "after" of a fix); use models for the proof moments (the mistake, the fix, the looks), not on every beat: at most about 40% of beats show a model, and one standing model repeated beat after beat looks fake and staged. "item" = a single garment, shoe or accessory. "prop" = an object that illustrates a word (clock, shopping bag, phone, gift box, calendar, sunglasses, perfume, watch). No presenter or host: the imagery is always the clothes and the men wearing them.
- swatches: 2-6 colours with names and accurate hex codes (Olive #556B2F, Navy #1F2A44, Charcoal #36454F, Off white #F2EFE6, Beige #D8C3A5, Maroon #6D1A2B, Rust #B7472A, Mustard #D4A017, Bottle green #0B4F3C, Sky blue #8FB8DE, Black #151515, White #FAFAFA). style: "strokes" (paint brush strokes), "pills" (stacked capsules with hex codes) or "tiles" (labelled squares). Prefer strokes and pills.
- shades: one base colour as a light-to-dark grid (monochrome and tonal points).
- outfit: 2-4 garments or accessories combined, each with a short label that starts with its colour ("TAN BELT", "OLIVE TEE"), a hex, asset_tags that include the colour (["belt", "tan", "leather"]) and an asset_prompt describing only that item in its real colour and material, like a product listing: "tan full-grain leather belt with a brushed brass buckle", "black leather derby shoes with a slight shine". Never a person.
- compare: exactly 2 items or models side by side (this vs that), labelled.
- flow: one item branching into 2-3 looks, joined by glowing animated lines ("1 watch, 3 looks", "1 white shirt, 3 occasions"). Whenever a line introduces "one item, several looks/occasions" ("teen looks", "3 tarike", "ek shirt, teen occasions"), use flow on that line: it's the channel's signature visual and creators love it. items[0] is the source item; the rest are the looks (usually models: include "model" in their asset_tags and describe the full outfit).

layout (how the image sits with the words; "auto" picks a sensible one):
- sandwich: the image sits inside the lockup. A person stands in the middle of the words with the hero word behind him and the small words in front; a garment has the words written over it. The signature look; best with align center and a short script or serif hero.
- side: a big person bleeding off the bottom and side of the frame, words on the other half (align left puts words left, image right). Best for outfit examples.
- hero: the outfit fills the frame, words across the top. Pair it with a theme set to the outfit's main colour as a hex (e.g. navy shirt on "#1F2A44"), exactly like a lookbook page.
- float: image below or beside the words, fully visible.
- edge: a prop slides in from the side of the frame, partly off-screen.
- cards: (outfit or compare) the items as framed photo cards, tilted and scattered like a scrapbook, with handwritten labels. Great on paper or grid textures. Whenever a line mentions a list, options, picks or several items (including the CTA "Agar tumhe saare shoes ki list chahiye"), show those items themselves as 2-4 cards (kind outfit, layout cards, one product per item, labels one short lowercase word like "canvas", "leather", "chunky"): it's one of the creator's favourite frames.
- closeup: (asset, model) the model fills the frame from the chest up with a giant word over him; set style "mono" for a black-and-white editorial moment. Use it for one or two emotional or punchline beats.
Animated set pieces (the moments people rewatch; use 1-3 per reel where they genuinely fit, never all of them, and vary them across reels):
- slider: (compare, exactly 2 items, usually models) before/after: a divider sweeps across and reveals the second image over the first. For "same outfit, one change" proofs. Label the items (e.g. "FLAT CANVAS", "CHUNKY SOLE").
- verdict: (compare, 2 items) wrong vs right: two cards, a red cross stamps the first, a green tick the second. For "don't / do" and common mistakes. The first item is the wrong one.
- zoom: (asset, model) the model plus a magnifier that zooms into the detail the line talks about (shoes, hem, belt, watch, collar); name that detail in the line or on-screen text.
- scale: (outfit, 2-4 items in order) items on a line with a marker sliding stop to stop: "slim -> straight -> baggy", "budget -> mid -> premium", "casual -> formal". Short labels.
- flow (above) for one item into several looks.
"focus" frames a model: "full" (head to toe, shoes visible; the default, use it whenever the outfit as a whole or anything below the waist matters), "lower" (waist down, big: when the point is shoes, trousers, jeans or fit), "upper" (chest up: only when the point is a shirt, jacket or collar). If the reel is about shoes or bottoms, never use "upper". Model prompts must describe the full outfit including the shoes, and say "full body, head to toe, shoes clearly visible".
Mix the imagery like an editor: product cutouts ("item": the exact shoe, the jeans folded, the belt) and props ("prop": a return box, a price tag, a shopping bag, a calendar) render as die-cut stickers with a white border (the engine adds the border; never describe a border or sticker style in asset_prompt, just the object on a plain background). Every prop or item is ONE simple, recognisable object (one boot, one return bag, one price tag): never a collage, lineup, numbered set or flat lay of many things, those turn into a messy cutout. For a before/after pair, write the second model prompt as "the exact same man and jeans as before, only ..." so it is generated from the first image and are the best fillers between model shots; swatches and typography-only beats are breathers. Never show the same model image in more than two separate places in a reel.
A %note% draws an arrow to the part of the model it's about (shoes, hem, jeans, belt, watch, shirt, face), read from the note, the hero word, then the line; so name the item in the note or the line ("%chunky sole%", "%same jeans%").
Keep the same model on screen across 2-3 consecutive beats while the words change (repeat the same asset_tags and asset_prompt exactly); it holds still instead of re-entering, which reads as intentional.

asset_tags are 2-5 lowercase tags to find the image in the library (model: ["model", "navy", "shirt", "white cargo"]; item: ["tshirt", "tee", "white"]; prop: ["prop", "clock"]). asset_prompt describes it for the image generator if the library lacks it (for people always "young Indian man", full body, describe the whole outfit precisely, no celebrities, no logos).
Fill every field of visual; use [] and "" for fields a kind doesn't use, "auto" for layout and "tiles" for style when they don't apply.

## Cover
The cover is a magazine-style poster for the profile grid: kicker (1-2 words, e.g. "BEST"), headline (the big accent word, e.g. "COLOURS"), connector (a small script word like "for" or "", optional), subline (2-5 words, e.g. "WHEATISH SKIN TONE"), tagline (3-5 words, e.g. "Look premium. Always."), badge (series label like "Style Rule 03", or ""), theme, a model image (tags + prompt) and 0-4 swatches.

Also write the Instagram caption and 3-5 hashtags (rules below), the comment keyword (e.g. STYLE), and a music vibe.

${CAPTION_RULES}`;

const color = {
  type: "object",
  additionalProperties: false,
  required: ["name", "hex"],
  properties: { name: { type: "string" }, hex: { type: "string", description: "#RRGGBB" } },
};

export const schema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "angle", "series", "typeset", "look", "palette", "sticker", "cover", "beats", "caption", "hashtags", "comment_keyword", "music_vibe"],
  properties: {
    look: {
      type: "object",
      additionalProperties: false,
      required: ["frame", "cutouts", "ghost", "chroma", "beat_sync"],
      properties: {
        frame: { type: "string", enum: ["full", "letterbox"] },
        cutouts: { type: "string", enum: ["color", "mono"] },
        ghost: { type: "string", enum: ["no", "yes"] },
        chroma: { type: "string", enum: ["no", "yes"] },
        beat_sync: { type: "string", enum: ["no", "yes"] },
      },
    },
    typeset: { type: "string", enum: TYPESET_NAMES },
    sticker: {
      type: "object",
      optional: true,
      additionalProperties: false,
      required: ["text", "beat"],
      properties: { text: { type: "string" }, beat: { type: "integer" } },
    },
    palette: {
      type: "array",
      description: "3-4 colours",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "bg", "accent", "texture"],
        properties: {
          texture: { type: "string", enum: TEXTURES },
          name: { type: "string" },
          bg: { type: "string", description: "#RRGGBB background" },
          accent: { type: "string", description: "#RRGGBB hero-word colour on that background" },
        },
      },
    },
    title: { type: "string" },
    angle: { type: "string", description: "Why this reel gets saved and shared" },
    series: { type: "string", description: "Series name and part, or empty", optionalText: true },
    cover: {
      type: "object",
      additionalProperties: false,
      required: ["kicker", "headline", "connector", "subline", "tagline", "badge", "theme", "model_tags", "model_prompt", "swatches"],
      properties: {
        kicker: { type: "string", optionalText: true },
        headline: { type: "string" },
        connector: { type: "string", optionalText: true },
        subline: { type: "string", optionalText: true },
        tagline: { type: "string", optionalText: true },
        badge: { type: "string", optionalText: true },
        theme: { type: "string", description: "p1..p4 from this reel's palette" },
        model_tags: { type: "array", items: { type: "string" } },
        model_prompt: { type: "string", optionalText: true },
        swatches: { type: "array", items: color },
      },
    },
    beats: {
      type: "array",
      minItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["voiceover", "speak", "text", "align", "motion", "theme", "visual", "camera", "transition", "hero_size", "ghost", "text_style"],
        properties: {
          voiceover: { type: "string" },
          speak: {
            type: "string",
            optionalText: true,
            description: "Same line for the voice: Hindi words in Devanagari, English words in English",
          },
          text: { type: "string" },
          align: { type: "string", enum: ["left", "right", "center"] },
          motion: { type: "string", enum: MOTIONS },
          camera: { type: "string", enum: ["none", "punch", "rotate"], description: "punch = instant extreme crop onto a detail; rotate = tilt-and-push out of the beat" },
          transition: { type: "string", enum: ["cut", "letter"], description: "letter = fly through a letter of the hero word into the next beat" },
          hero_size: { type: "string", enum: ["normal", "giant"], description: "giant = hero word wider than the frame, pinned to the top, behind the cutout" },
          ghost: { type: "string", enum: ["no", "yes"], description: "yes = this beat's upcoming words wait pale and fill in as spoken" },
          text_style: { type: "string", enum: ["lockup", "caption"], description: "caption = a quiet subtitle line that builds word by word instead of a big lockup" },
          theme: { type: "string", description: "p1..p4 from this reel's palette, or #RRGGBB" },
          visual: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "layout", "style", "asset_kind", "focus", "asset_tags", "asset_prompt", "colors", "items", "exempt", "plinth", "callouts"],
            properties: {
              kind: { type: "string", enum: ["none", "swatches", "shades", "asset", "outfit", "compare", "flow"] },
              layout: { type: "string", enum: ["auto", "sandwich", "side", "hero", "float", "edge", "cards", "closeup", "slider", "verdict", "zoom", "scale", "duo", "mosaic", "corner", "dm", ...pluginLayouts()] },
              callouts: { type: "array", items: { type: "string" }, description: "layout callouts only: 2-3 labels (1-2 words) naming parts of the product, e.g. \"chunky sole\", \"plain upper\"; [] otherwise" },
              exempt: { type: "string", enum: ["no", "yes"], description: "yes = this image stays in colour when the reel's cutouts are black-and-white" },
              plinth: { type: "string", enum: ["no", "yes"], description: "yes = the cutout stands on an accent-coloured plinth with smoke" },
              style: { type: "string", enum: ["tiles", "strokes", "pills", "mono"] },
              asset_kind: { type: "string", enum: ["model", "item", "prop"] },
              focus: { type: "string", enum: ["full", "lower", "upper"] },
              asset_tags: { type: "array", items: { type: "string" } },
              asset_prompt: { type: "string", optionalText: true },
              colors: { type: "array", items: color },
              items: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["label", "hex", "asset_tags", "asset_prompt"],
                  properties: {
                    label: { type: "string" },
                    hex: { type: "string", optionalText: true },
                    asset_tags: { type: "array", items: { type: "string" } },
                    asset_prompt: { type: "string", optionalText: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    comment_keyword: { type: "string" },
    music_vibe: { type: "string", optionalText: true },
  },
};

export const task = ({ topic, notes }) =>
  [`Create an editorial style-rule reel about: ${topic}`, notes && `Notes from the creator: ${notes}`]
    .filter(Boolean)
    .join("\n\n");

export async function prepare(dir, script, log, { cover = true, final = false } = {}) {
  const aspect = script.aspect === "16:9" ? "16:9" : "9:16";
  const beats = script.beats;

  const mode = speakMode();
  if (script.speakMode !== mode) beats.forEach((b) => (b.speak = ""));
  if (beats.some((b) => !b.speak)) {
    log("Voice: preparing natural Hindi pronunciation");
    try {
      const speak = await makeSpeakable(beats.map((b) => b.voiceover), mode);
      beats.forEach((b, i) => (b.speak ||= speak[i]));
      script.speakMode = mode;
      await writeJson(path.join(dir, "script.json"), script);
    } catch (err) {
      log(`  couldn't prepare it (${err.message}); using the Roman text`);
    }
  }
  const spokenRaw = await generateNarration(dir, beats.map((b) => b.speak || b.voiceover), log, script.voice ?? {}, { final });
  const spoken = remapWords(spokenRaw, beats.map((b) => b.voiceover));
  const holds = beats.map((b) => b.hold ?? (/[.?!।]\s*$/.test(b.speak || b.voiceover) ? Math.min(autoHold(b.visual), 0.25) : 0));
  const narration = await addHolds(spoken, holds, path.join(dir, "audio", "narration-held.mp3"));

  const picksFile = path.join(dir, "asset-picks.json");
  const picks = await readJson(picksFile, {});
  const { visuals, resolve } = await resolveVisuals({ beats, picks, log });
  await writeJson(picksFile, picks);

  if (cover) {
    log("Cover");
    const coverModel = script.cover.model_tags?.length
      ? (await resolve({ tags: script.cover.model_tags, prompt: script.cover.model_prompt, kind: "model", reuse: true }))?.img
      : null;
    await writeJson(picksFile, picks);
    await fs.writeFile(path.join(dir, "cover.png"), await renderCover(script.cover, { modelImg: coverModel, palette: script.palette ?? [] }));
  }

  const m = script.music ?? {};
  const musicPath = m.file ? path.join(config.musicDir, path.basename(m.file)) : null;
  const music = musicPath && (await exists(musicPath)) && m.mode !== "off" ? musicPath : null;
  if (m.file && !music && m.mode !== "off") log(`Music file "${m.file}" not found in assets/music`);
  const look = script.look ?? {};
  let musicBeats = [];
  if (look.beat_sync === "yes" && music) {
    musicBeats = await detectBeats(music, m.start ?? 0, narration.duration + 2).catch(() => []);
    log(`Beat sync: ${musicBeats.length} beats in the music`);
  }

  const tl = buildTimeline({
    beats,
    narration,
    visuals,
    aspect,
    palette: script.palette ?? [],
    typeset: script.typeset ?? "editorial",
    sticker: script.sticker?.text ? script.sticker : null,
    look,
    musicBeats,
    keyword: script.comment_keyword ?? "",
  });
  let sfxFile = null;
  if (script.sfx !== false && script.sfx !== "off") {
    const density = script.sfx === "punchy" ? "punchy" : "subtle";
    const sfx = await buildSfxTrack(tl, path.join(dir, "audio", "sfx.wav"), density, { rules: script.sfxRules ?? [], keyword: script.comment_keyword });
    sfxFile = sfx.file;
    log(`Sound effects: ${sfx.count}`);
  }
  return { tl, narration, visuals, music, musicStart: m.start ?? 0, musicMode: m.mode ?? "preview", sfxFile };
}

export async function build(dir, script, log, { final = false } = {}) {
  const { tl, narration, visuals, music, musicStart, musicMode, sfxFile } = await prepare(dir, script, log, { final });
  const bake = music && musicMode === "final";
  await renderVideo(tl, {
    narrationFile: narration.file,
    musicFile: bake ? music : null,
    musicStart,
    sfxFile,
    out: path.join(dir, "rough-cut.mp4"),
    log,
    cacheDir: path.join(dir, "render-cache"),
  });
  const previewFile = path.join(dir, "preview-with-music.mp4");
  if (music && !bake) {
    log(`Preview with music: ${path.basename(music)} from ${musicStart}s`);
    await addMusicPreview(path.join(dir, "rough-cut.mp4"), music, musicStart, tl.total, previewFile);
  } else {
    await fs.rm(previewFile, { force: true });
  }
  await fs.copyFile(narration.file, path.join(dir, "voiceover.mp3"));

  await writeJson(path.join(dir, "timeline.json"), {
    total: tl.total,
    scenes: tl.timeline.map((b) => ({ scene: b.index + 1, start: +b.t0.toFixed(2), duration: +(b.t1 - b.t0).toFixed(2), source: visuals[b.index].kind })),
  });
}

function autoHold(v = {}) {
  if (PLUGINS[v.layout]) return PLUGINS[v.layout].hold ?? 0.4;
  if (v.layout === "mosaic") return 0.8;
  if (v.kind === "flow" || v.layout === "scale") return 0.6;
  if (["slider", "verdict"].includes(v.layout)) return 0.5;
  if (v.layout === "zoom") return 0.4;
  if (v.layout === "cards") return 0.55;
  if (["outfit", "compare"].includes(v.kind)) return 0.4;
  if (["swatches", "shades"].includes(v.kind)) return 0.3;
  if (["hero", "closeup"].includes(v.layout)) return 0.3;
  return 0;
}

export async function writeDocs(dir, script) {
  await writeCaption(dir, script);
  const md = [
    `# ${script.title}`,
    "",
    `**Angle:** ${script.angle}  `,
    script.series ? `**Series:** ${script.series}  ` : "",
    `**Comment keyword:** ${script.comment_keyword}  `,
    `**Music:** ${script.music_vibe}`,
    "",
    "## Voiceover",
    "",
    script.beats.map((b) => b.voiceover).join(" "),
    "",
    "## Beats",
    "",
    ...script.beats.map((b, i) => `${pad(i + 1)}. \`${b.text}\` · ${b.theme}${b.visual.kind !== "none" ? ` · ${b.visual.kind}` : ""}`),
    "",
  ].join("\n");
  await fs.writeFile(path.join(dir, "script.md"), md);
}
