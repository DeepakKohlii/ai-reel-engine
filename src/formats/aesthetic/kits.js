export const KITS = {
  studio_guide: {
    name: "Studio guide",
    from: "pant guide",
    background: "studio",
    chapter: "pill",
    index: "rows",
    headline: "serif",
    cover: "callouts",
    brief: "Grey studio, the model centred. Contents page with rows of small looks; each section opens on a blurred moving close-up with a white pill (number + word). Pills, notes, dots and dashed guides on the model.",
  },
  wheel_guide: {
    name: "Section-header guide",
    from: "colour wheel guide",
    background: "studio",
    chapter: "header",
    index: "grid",
    headline: "serif",
    cover: "grid",
    brief: "Grey studio. A 2x2 contents grid (one small look per section with its name). NO chapter cards: a chapter scene is a short title frame where '01/ NAME' draws across the top with a hairline, and it stays as the section header on every scene of that section. Lean on swatches, the scale bar and real street-style photos (photo overlays / reference scenes) as proof; fewer dots and dashed lines.",
  },
  versus: {
    name: "Which looks better",
    from: "colour temperature",
    background: "studio",
    chapter: "none",
    index: "none",
    headline: "serif",
    cover: "versus",
    brief: "Opens on a compare: two outfits side by side with OUTFIT 1 / OUTFIT 2 pills, the verdict pills land on the words. Then the ONE idea, explained with the scale bar (a two-ended gradient: warm|cool, plain|loud...) and colour swatches, then 2-4 quick examples: the model on the left, swatch cards on the right, the cursor clicks one and his outfit changes (swatches scene with swap). A real celebrity or street photo as proof in between. NO chapter cards, NO contents page.",
  },
  check: {
    name: "Quality check",
    from: "tee quality check",
    background: "studio",
    chapter: "check",
    index: "cards",
    headline: "wide",
    cover: "checklist",
    brief: "Product-led: the item itself is the hero (product photos and close-ups, items scenes), the model appears little or not at all. The contents page is a stack of dark cards (01 NECK TAPE ✓...). Each check opens on a dark card: real footage or a dark close-up with 'CHECK: 01' and a wide word. Close-ups with zoom rings and dashed stitch lines; green/red pills for good vs red flag.",
  },
  file: {
    name: "One item, many ways",
    from: "henley 4 ways",
    background: "paper",
    chapter: "label",
    index: "grid",
    headline: "condensed",
    cover: "grid",
    brief: "Warm paper with a dot grid and camera corners. Contents page: a 2x2 grid of the looks with big condensed labels. Each look is a build scene: the big condensed word (FORMAL) top left with a tiny file tag, the outfit's pieces landing one by one in a column, the model beside them changing as pieces are added. No pills or dashed lines; the pieces do the talking.",
  },
  recreate: {
    name: "Recreate the look",
    from: "Ryan Gosling recreate",
    background: "white",
    chapter: "none",
    index: "none",
    headline: "serif",
    cover: "photo",
    brief: "Opens on the REAL look: a reference photo or clip of the person (media, full screen, corners). Then a clean white page: our model builds the outfit piece by piece (build scene, the product column on the right with each piece's name), his outfit changing as each piece is added; a product card with a leader line for the shoes or one key piece. Ends on the finished look next to the original.",
  },
  glow: {
    name: "Glow-up / before and now",
    from: "Will Poulter glow-up",
    background: "cream",
    chapter: "stack",
    index: "none",
    headline: "serif",
    cover: "beforenow",
    brief: "Opens on before and now (two real photos or two outfits, labelled). Each change opens on a stack of tilted photo cards with a big number and the change's name. Real photos as proof with colour palettes on them (reference scenes with swatches), the scale bar for undertones or proportions, the model to show the fix.",
  },
};

export const SHAPE_KITS = {
  guide: ["studio_guide", "wheel_guide"],
  "fix-one-problem": ["wheel_guide", "studio_guide"],
  "which-looks-better": ["versus"],
  "quality-check": ["check"],
  "one-item-n-ways": ["file"],
  recreate: ["recreate"],
  "glow-up": ["glow"],
};

export function pickKit(shape, recentKits = []) {
  const options = SHAPE_KITS[shape] ?? ["studio_guide"];
  return options.find((k) => k !== recentKits[0]) ?? options[0];
}

export const kitOf = (plan) => KITS[plan?.kit] ?? (plan?.look === "paper" ? KITS.file : KITS.studio_guide);
