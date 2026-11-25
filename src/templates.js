export const TEMPLATES = [
  { id: "explainer", name: "Explainer", desc: "One idea, made simple.", topic: "why planes don't fly in a straight line", guide: "Explain one idea. Open with the surprising question, build it in 3-4 plain steps, use one everyday comparison, close with the answer. Visuals: simple objects, flows and comparisons." },
  { id: "typography", name: "Typography", desc: "Words only, big and kinetic.", topic: "five lines on starting before you're ready", guide: "Typography carries everything. Use visual kind none on almost every beat. Short rhythmic lines, strong contrast between small and huge words, varied motion." },
  { id: "docs", name: "Docs walkthrough", desc: "Show how something works, step by step.", topic: "how to write a good README", guide: "Walk through a tool, feature or process in numbered steps. One action per beat. Use [STEP 1] labels. Visuals: screenshots the user uploads to the library, tagged screenshot, plus simple objects. Never invent features, commands or menu names." },
  { id: "listicle", name: "Listicle", desc: "A countdown of things worth saving.", topic: "5 habits that fix your focus", guide: "A countdown of 3-5 items, best one last, promised early. Each item gets a label, its name as the hero word and one concrete reason. Visuals: one object per item." },
  { id: "story", name: "Story", desc: "A true story with a turn.", topic: "the engineer who saved Apollo 13", guide: "Tell one story: a moment of tension first, then the background, the turn and the ending. Dates and names only when you are sure of them. Dark palettes, slower motion, objects and places." },
  { id: "data", name: "Data story", desc: "One number and what it means.", topic: "how much time we spend on our phones", guide: "Build around one number. State it, put it in human terms, show what changed, say what it means. Only use figures given in the notes or widely established ones; otherwise describe the trend in words. Use scale, compare and flow visuals." },
];

export const getTemplate = (id) => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];

export const withTemplate = (system, id) => {
  const t = getTemplate(id);
  return `${system}

## Template: ${t.name} (wins over everything above)
This channel covers any subject. Follow the topic. Wherever the text above assumes clothes, outfits, styling, models or a male Indian audience, ignore that and apply the same craft to this topic. Do not bring up fashion unless the topic is fashion.
${t.guide}
Write in clear, conversational English unless the notes or topic are in another language. Leave "speak" empty for English. Where a Hinglish line is required above, write its natural English equivalent. Images: "item" is any object, "prop" a supporting object, "model" a person (only when the topic needs one), "outfit" any group of 2-4 objects. Do not invent facts, quotes or statistics.`;
};
