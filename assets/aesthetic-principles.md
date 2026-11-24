# Why the reference reels work (principles, not templates)

Learned from 7 references the creator shared (pant guide, colour temperature, colour
wheel, tee quality check; plus Ryan Gosling recreate, Will Poulter glow-up, Henley 4 ways).
Use these as reasons. Never copy a reference's layout, words or topic; design something new that
follows the same reasons. More references will be added here over time.

## Structure
- The structure comes from the topic, not a template. A comparison opens on two outfits and asks
  a question; a recreate opens on the real look; a glow-up opens on then vs now; a checklist names
  how many checks; a styling idea names how many looks. Only some reels need sections.
- The hook is shown, not just said: the first frame already holds the visual the words are about.
- One idea per frame. The frame changes when the sentence changes (about every 1.5-3 s).
- Every reel has ONE signature device that it repeats and the viewer learns (a warm/cool scale,
  a swatch the cursor clicks, the outfit built piece by piece, a magnifier on details, then vs
  now). Repetition of one device feels designed; many different devices feel noisy.
- Sections, when there are any, are announced by a device that matches the reel's world
  (a blurred footage card, a header that stays on screen, a dark check card, a stack of photos,
  a huge word). Pick the one that fits; invent a new one when none fits.
- A contents page (when there is one) is a promise: it shows all the looks or checks at once,
  then the reel delivers them in order, and the ending shows it again as "save this".

## Look
- One page, one model, one accent. The background stays the same all reel; colour comes from the
  clothes. A single accent colour (from the topic) marks numbers, markers and lines.
- Type does the branding: one headline face (serif for calm editorial, condensed caps for
  bold labels, wide caps for product/tech talk) and one small label face. Two faces, never more.
- Real-world proof beats claims: a real celebrity photo, a street-style shot, a real clip of the
  event. Mix them with the clean model shots; the contrast is what makes it feel credible.
- The model is shown head to toe when the whole outfit matters, closer when one garment matters.
  Products get their own clean frame when they are the subject (quality checks, a single piece).
- Restraint: lots of empty space, thin lines, small labels. Big type only for section words.

## Motion
- Motion explains, never decorates: a line draws to show a length, a marker slides to show warm
  vs cool, a piece lands to build the outfit, a ring opens on the detail, a cursor clicks to
  change one thing. If a movement doesn't explain something, drop it.
- Calm timing: things arrive on the word they illustrate and stay long enough to read (1.2 s+).
- Continuity: the same model in the same spot across cuts, so changes read as the outfit
  changing, not the shot. Zoom in for a detail, then come back out.
- Each kind of moment has its own small sound; quiet, never on top of each other.

## Words
- Plain spoken English, short sentences, everyday words. Say it directly; point at the visual
  ("like this", "look how he's wearing...").
- Specific and useful: names of pieces, colours, numbers, one test he can do.
- One clear ending: save, follow, or comment a keyword for links.

## Learned from the colour-wheel reel's ending (0:49-end), which the creator pointed at
- Show a ratio by quantity: when the idea is "one leads, one supports, one is a guest", map each
  role to how much of the outfit it covers (lead = the biggest piece, support = the second,
  guest = a small accessory) and build it piece by piece. The viewer sees the rule, not a list.
- Cause and effect in one beat: the cursor clicks the new swatch and, at that instant, exactly
  ONE piece of the outfit changes; everything else stays still, so the change reads instantly.
- A legend that grows with the idea: each new card lands on top of the stack and the earlier ones
  never move (swatches scene with swaps does this). One role label rides above the stack and
  changes in place (LEAD -> SUPPORT -> ADD-ON) instead of new labels piling up.
- End on real-world proof, not a recap page: the closing line plays over real editorial photos that
  show the idea worn in real life (when the creator can add them; else the best model look).

## What the creator liked or rejected in our own reels (strongest signal; follow these first)
- LIKED (garba reel, 2026-10-05): the look-by-look build. Each look opens on its big word in the
  reel's headline face (CLASSIC / BOLD / MODERN) with a tiny file tag; the pieces land one by one
  in a column beside the model as each is named, and the model wears the full fit. "The whole fit
  is very nice." Use this whenever a reel shows complete outfits; vary its page, type and column
  side so it never looks copied.
- REJECTED: forcing real photos or clips where the studio model can show the point (a long kurta
  vs a short one, a fit, a colour, shoes). Real media only for real people, real events/crowds, or
  proof the model can't fake.
- REJECTED: frames that don't show what the words say. "Longer ones" must show a longer one;
  "white sneakers" must show white sneakers; "like this" must point at something on screen.
- REJECTED: every reel looking the same (same structure, chapter pills, cover): each reel gets
  its own design.
- REJECTED (garba reel): 14 seconds of the same full-body model with only labels changing ("very
  bland and boring"). Change the frame's scale every 3-4 s: full body -> close-up of the detail
  the line names -> product / swatch / graphic -> full body. (Enforced in code: engine.js rhythm.)
- REJECTED: a piece column where items had wildly different sizes (a big kurta, tiny sandals) and
  labels floating far from their item. Pieces get equal visual weight, each name right under it.
- REJECTED (garba reel, again): the camera not showing what's being said ("the shoes stay simple"
  while it's zoomed on the chest), rushed endings where a label arrives in the last second,
  dashed circles on zooms that don't need them, a showy transition on every cut, and a slow
  voice. Now: the camera follows the words (engine.js follow: each named part gets the camera;
  small things like shoes, collars, cuffs always get a close-up), close-ups carry across a cut
  when the next line is about the same part, circles only on request (zoom text "ring"), plain
  dissolves/cuts inside a section, draft voice at about 3 words a second.
- REJECTED: two flat swatches beside the model for "one bright piece, everything else plain".
  LIKED direction: show the idea on the outfit itself (isolate: the rest fades to a ghost, only
  the bright piece stays, then the whole outfit returns).
- REJECTED: cuts landing on the previous line's last words. (Root cause was voice timing; the
  English draft voice is now made per sentence, so cuts are exact.) A dissolve between two shots
  where the model stands in different places makes a double image: cut there instead.

## Covers (from reference grid screenshots, 2026-10-05)
- The image is the hero and fills the frame: a tight, beautifully lit crop of the subject (a collar
  and placket, jeans cuffed over loafers, folded stacks, a fabric collage, a flat lay, a portrait),
  dark and moody or clean studio. Never a small full-body model on a plain page.
- The type is the channel's constant: a tiny tracked kicker (series or type: THIS WITH THAT, DRIP
  TIPS, JEANS 101, FITCHECK), a big heavy serif title set tight on two lines, an optional tiny sub
  line. No borders, mastheads or callouts. The grid reads as one brand; only the pictures change.
- REJECTED cover ("looking very very bad"): a bright yellow kurta filling the frame, dark text on
  it, the title over the buttons, a crop showing his mouth. LIKED fix: a low-key folded stack of
  the reel's pieces (the picture is the topic), white title in the calm dark space, graded moody.
- Where we lagged (creator, Ryan Gosling recreate 0:17): the reference's effects work INSIDE the
  garment (a soft iridescent glow sweeps up through the jacket only, as "the jacket" is said),
  not as stickers on top. The engine now has garment masks (top / bottoms / shoes per photo) and
  the "sweep"; prefer effects on the clothes themselves over overlays on top.
- REJECTED: the same effect on every repeated section (sweep on CLASSIC, BOLD and MODERN). Each
  effect once (twice at most) per reel; repeated sections get different devices (code rotates
  sweep -> lift -> trace -> texture across builds). Sweep on the first build was LIKED.
- Garment effects use real clothing segmentation masks (segment.js), never row bands.
- REJECTED: "lift" (piece comes forward, rest recedes) looked weird. Removed. Liked: sweep, trace, recolour, texture.

## In-place outfit changes: APPROVED by the creator (2026-10-06). Use exactly this.
- Layout: the model stage left, bigger, at exactly the same size and spot in EVERY scene (no
  drift, no zoom, no shoe close-ups); option cards on the right, each level with its garment.
- Grammar: card slides in -> cursor clicks it -> only that garment changes -> ✓/✗ on the card.
- One look family: a base photo and edits that change ONE garment each (same man, same pose).
  Real photos from Gemini always; never paint/recolour a garment when a photo can be made.
- Reveal by garment (engine picks automatically): shirt/top = glow-flip (fine 0/1 digits rain,
  the colour flips in ~3 frames while covered); trousers = straight line from waistband to hem;
  shoes = digit columns. Never a crossfade showing both colours side by side.
- End on the finished look with a "Better ✓" pill.
