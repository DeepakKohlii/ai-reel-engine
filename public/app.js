const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: opts.body && !(opts.body instanceof FormData) ? { "content-type": "application/json" } : {},
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
const post = (url, body) => api(url, { method: "POST", body: JSON.stringify(body ?? {}) });

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
}
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const errorHtml = (err) => `<span class="error">${escapeHtml(err.message ?? err)}</span>`;

const THEMES = ["cream", "espresso", "white", "butter", "blush", "navy", "olive"];
const FORMAT_INFO = {
  aesthetic: { title: "Aesthetic", desc: "Calm magazine-style English reels." },
  editorial: {
    title: "Style rules",
    desc: "Editorial kinetic typography. Fully automatic.",
    topic: "e.g. best colours for wheatish skin, monochrome outfits, 1 polo 5 outfits",
    notes: "Series name/part, points to include, the vibe...",
  },
  fit: {
    title: "AI fit (Comment LINK)",
    desc: "Mirror-selfie outfit on an AI model with price tags.",
    topic: "e.g. clean corporate fit under 2000, korean summer fit",
    notes: "Paste your products, one per line: name | price | link",
  },
  classic: {
    title: "Quick tips",
    desc: "Bakchod Hinglish tips over stock/AI clips with captions.",
    topic: "e.g. date outfits under 1500, mistakes that make you look short",
    notes: "Products to feature, a joke you want in, the vibe...",
  },
};

let provider = "manual";
let format = "editorial";
let current = null;
let poll = null;

function show(view) {
  for (const id of ["homeView", "newView", "packView", "libraryView", "stylesView", "motionsView", "aestheticView", "instagramView"]) $(`#${id}`).hidden = id !== view;
  $("#health").hidden = view === "homeView";
}

let health = null;

function renderHomeStatus() {
  if (!health) return;
  const rows = [
    ["Claude", { api: ["API key", true], cli: ["Claude Code (your subscription)", true], manual: ["Copy/paste via claude.ai", false] }[health.claude]],
    ["Voice", { sarvam: ["Sarvam", true], elevenlabs: ["ElevenLabs", true], mac: ["Free macOS voice", false] }[health.voice] ?? [health.voice, true]],
    ["Images", { gemini: ["Gemini", true], cloudflare: ["Cloudflare FLUX.2", true], pollinations: ["Free generator", false] }[health.images] ?? [health.images, true]],
  ];
  $("#homeStatus").replaceChildren(
    ...rows.map(([name, [value, good]]) =>
      h("div", { class: "status-row" }, h("span", { class: `dot ${good ? "ok" : "basic"}` }), h("b", {}, name), h("span", { class: "muted" }, value)),
    ),
  );
}

function renderHomeFormats() {
  const cards = [
    ["editorial", "Style rules", "Kinetic typography, colour boards and cutout models. Hinglish.", () => pickFormat("editorial")],
    ["aesthetic", "Aesthetic", "A calm studio look where one model's outfit changes in place. English.", () => showAesthetic()],
    ["fit", "AI fit", "A mirror-selfie outfit on an AI model with a Comment LINK sticker.", () => pickFormat("fit")],
    ["classic", "Quick tips", "Tips over stock or AI clips with word-by-word captions.", () => pickFormat("classic")],
  ];
  $("#homeFormats").replaceChildren(
    ...cards.map(([id, title, desc, go]) => h("button", { class: `fmt fmt-${id}`, onclick: go }, h("b", {}, title), h("span", {}, desc), h("i", {}, "Start →"))),
  );
}

async function pickFormat(id) {
  format = id;
  await showNew();
  $(".other-formats").open = id !== "editorial";
  $("#topic").focus();
}

async function showHome() {
  current = null;
  clearInterval(poll);
  show("homeView");
  renderHomeStatus();
  renderHomeFormats();
  loadPacks();
  const packs = await api("/api/packs").catch(() => []);
  $("#homeRecent").replaceChildren(
    ...(packs.length
      ? packs.slice(0, 5).map((p) =>
          h("div", { class: "recent", onclick: () => openPack(p.slug) }, h("b", {}, p.title), h("span", { class: "muted" }, FORMAT_INFO[p.format]?.title ?? p.format)),
        )
      : [h("p", { class: "muted" }, "No reels yet. Type a topic above to make your first one.")]),
  );
}

async function homeCreate() {
  const topic = $("#homeTopic").value.trim();
  if (!topic) return $("#homeTopic").focus();
  format = "editorial";
  await showNew();
  $("#topic").value = topic;
  createReel({ topic }, $("#createOwn"));
}

async function loadHealth() {
  const hl = await api("/api/health");
  health = hl;
  renderHomeStatus();
  provider = hl.claude;
  const note = {
    api: "Scripts: Claude API key.",
    cli: "Scripts: Claude Code on your Claude subscription.",
    manual: "Claude Code isn't installed yet, so scripts go through claude.ai copy/paste. Install it (one command, see README) to make Create reel fully one-click.",
  }[provider];
  const missing = [];
  if (!hl.elevenlabs) missing.push("ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID (the free Mac voice is a placeholder)");
  if (!hl.pexels) missing.push("PEXELS_API_KEY (stock footage for Quick tips)");
  if (hl.voice === "mac") missing.push("SARVAM_API_KEY (Indian Hinglish voices, ₹100 free) or ElevenLabs");
  if (hl.images === "pollinations")
    missing.push("CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (free, better AI images) or GEMINI_API_KEY (paid ~₹3.5/image, Gemini-app quality)");
  $("#health").innerHTML =
    `<div class="info">${note}</div>` +
    (missing.length ? `<div class="warn">Optional, add to <code>.env</code> and restart: ${missing.join(" · ")}</div>` : "");

}

async function loadPacks() {
  const packs = await api("/api/packs");
  $("#packList").replaceChildren(
    ...packs.map((p) =>
      h(
        "li",
        { class: current?.slug === p.slug ? "active" : "", onclick: () => openPack(p.slug) },
        p.title,
        h("small", {}, `${FORMAT_INFO[p.format]?.title ?? p.format} · ${p.topic ?? ""}`),
      ),
    ),
  );
}

function renderFormatCards() {
  $("#formatCards").replaceChildren(
    ...Object.entries(FORMAT_INFO).map(([id, f]) =>
      h(
        "div",
        { class: `fcard ${id === format ? "active" : ""}`, onclick: () => ((format = id), renderFormatCards()) },
        h("strong", {}, f.title),
        h("span", {}, f.desc),
      ),
    ),
  );
  $("#topic").placeholder = FORMAT_INFO[format].topic;
  $("#notes").placeholder = FORMAT_INFO[format].notes;
  $("#notes").hidden = format === "editorial";
}

async function showNew() {
  current = null;
  clearInterval(poll);
  show("newView");
  renderFormatCards();
  loadPacks();
  if (!$("#ideas").children.length) {
    const { ideas } = await api("/api/ideas/last");
    if (ideas.length) renderIdeas(ideas);
  }
}

let pendingTopic = null;

async function getIdeas() {
  if (provider === "manual") {
    $("#manualIdeas").hidden = false;
    $("#manualIdeas").scrollIntoView({ behavior: "smooth" });
    return;
  }
  setBusy($("#ideasBtn"), true, "Researching trends...");
  $("#newMsg").textContent = "Claude is checking what's trending right now and planning ideas (1-3 minutes)...";
  try {
    renderIdeas((await post("/api/ideas", { format: "editorial" })).ideas);
    $("#newMsg").textContent = "";
  } catch (err) {
    $("#newMsg").innerHTML = errorHtml(err);
  } finally {
    setBusy($("#ideasBtn"), false, "✨ Get trending ideas");
  }
}

function renderIdeas(ideas) {
  $("#ideas").replaceChildren(
    ...ideas.map((idea) =>
      h(
        "div",
        { class: "idea-card" },
        h("h3", {}, idea.topic),
        idea.hook && h("div", { class: "hook" }, `"${idea.hook}"`),
        (idea.why_now || idea.why) && h("div", { class: "now" }, `Why now: ${idea.why_now ?? idea.why}`),
        idea.angle && h("div", { class: "angle" }, idea.angle),
        h("button", { class: "primary", onclick: (e) => createReel({ topic: idea.topic, hook: idea.hook }, e.target) }, "Create reel"),
      ),
    ),
  );
}

async function createReel({ topic, hook }, btn) {
  if (!topic) return;
  const notes = hook ? `Open with this hook (adapt it if needed): ${hook}` : "";
  if (provider === "manual") {
    try {
      const { prompt } = await post("/api/prompt", { kind: "script", format, topic, notes });
      await navigator.clipboard.writeText(prompt);
      pendingTopic = topic;
      $("#manualTopic").textContent = topic;
      $("#manualCreate").hidden = false;
      $("#manualCreate").scrollIntoView({ behavior: "smooth" });
      $("#reply").focus();
    } catch (err) {
      $("#newMsg").innerHTML = errorHtml(err);
    }
    return;
  }
  if (btn) setBusy(btn, true, "Writing script...");
  try {
    if (format !== "editorial") {
      $("#newMsg").textContent = `Writing "${topic}" (about a minute), then the reel starts building...`;
      const { slug } = await post("/api/script", { format, topic, notes: $("#notes").value, build: true });
      $("#newMsg").textContent = "";
      return await openPack(slug);
    }
    const { id } = await post("/api/create", { topic, hook });
    const started = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const job = await api(`/api/create/${id}`);
      if (job.state === "error") throw new Error(job.error);
      if (job.state === "done") {
        $("#newMsg").textContent = "";
        return await openPack(job.slug);
      }
      const mins = Math.floor((Date.now() - started) / 60000);
      $("#newMsg").textContent = `Writing "${topic}" (${mins} min, usually 5-15). Nothing is generated until you approve the script. ${job.step}`;
    }
  } catch (err) {
    $("#newMsg").innerHTML = errorHtml(err);
    if (btn) setBusy(btn, false, "Create reel");
  }
}

function renderScriptReview(s, f) {
  const card = $("#scriptCard");
  card.hidden = !["editorial", "aesthetic"].includes(f);
  if (card.hidden) return;
  const aes = f === "aesthetic";
  const wordsOnly = s.stage === "text";
  const pending = s.approved === false;
  const plain = (t) => String(t ?? "").replace(/%[^%]*%/g, "").replace(/[~#*!^[\]]/g, "").replace(/\s*\/\s*/g, " / ").replace(/^\s*\/\s*|\s*\/\s*$/g, "").trim();
  const lines = wordsOnly || aes ? s.lines : s.beats.map((b) => ({ voiceover: b.voiceover, on_screen: plain(b.text) }));
  const notes = h("textarea", { rows: 3, placeholder: "What feels off? e.g. line 3 sounds weird, on-screen words don't make sense alone, make the middle flow better..." });
  const msg = h("span", { class: "hint" });
  const heard = h("p", { class: "heard" }, lines.map((l) => l.voiceover).join(" "));
  const rows = lines.map((l, i) => {
    const vo = h("input", { value: l.voiceover, disabled: !wordsOnly });
    const os = h("input", { value: l.on_screen, disabled: !wordsOnly });
    vo.addEventListener("input", () => (heard.textContent = rows.map((r) => r.vo.value).join(" ")));
    return { vo, os, tr: h("tr", {}, h("td", {}, String(i + 1)), h("td", {}, vo), h("td", {}, os)) };
  });
  const collect = () => rows.map((r, i) => ({ voiceover: r.vo.value, on_screen: r.os.value, ...(lines[i]?.beat && { beat: true }) }));
  const run = (fn) => async (e) => {
    e.target.disabled = true;
    try {
      await fn();
    } catch (err) {
      msg.innerHTML = errorHtml(err);
      e.target.disabled = false;
    }
  };
  const saveLines = async () => {
    if (wordsOnly) await api(`/api/packs/${current.slug}/lines`, { method: "PUT", body: JSON.stringify({ lines: collect() }) });
    else await save();
  };
  const rewrite = run(async () => {
    await saveLines();
    await post(`/api/packs/${current.slug}/polish`, { notes: notes.value.trim() });
    msg.textContent = "Rewriting the lines (about a minute)...";
    startPolling();
  });
  const approve = run(async () => {
    await saveLines();
    await post(`/api/packs/${current.slug}/approve`);
    msg.textContent = aes ? "Planning the reel, making the images (same man in every outfit), then building it with the free draft voice..." : "Designing the reel, then building it with the free draft voice...";
    startPolling();
  });
  const saveBtn = run(async () => {
    await saveLines();
    msg.textContent = "Saved.";
    openPack(current.slug);
  });
  const stylePick = h("select", {
    onchange: (e) => api(`/api/packs/${current.slug}/style`, { method: "PUT", body: JSON.stringify({ choice: e.target.value }) }),
  }, h("option", { value: "auto" }, "Borrow a few ingredients from learned styles (recommended)"), h("option", { value: "none" }, "Nothing learned: the engine's own look"));
  api("/api/styles").then((styles) => {
    for (const st of styles.filter((x) => x.active)) stylePick.append(h("option", { value: st.id }, `Borrow only from "${st.name}"`));
    for (const st of styles.filter((x) => x.active)) stylePick.append(h("option", { value: `full:${st.id}` }, `Trial: copy the whole "${st.name}" format`));
    stylePick.value = s.styleChoice ?? "auto";
  });
  const body = [
    aes ? null : wordsOnly || pending ? h("label", {}, "Learned styles", stylePick) : s.styleName ? h("div", { class: "hint" }, `Trial copy of the learned style "${s.styleName}".`) : null,
    h("div", { class: "hint" }, "Heard as (the whole voiceover, read in one go):"),
    heard,
    aes && s.facts?.length ? h("div", { class: "hint" }, `Teaches: ${s.facts.join(" · ")}`) : null,
    h("table", { class: "lines" }, h("tr", {}, h("th", {}, "#"), h("th", {}, "Voice says"), h("th", {}, aes ? "What we see" : "On screen")), ...rows.map((r) => r.tr)),
    wordsOnly ? h("div", { class: "hint" }, "Edit any line directly and click Save lines (free), or write notes and let Claude rewrite.") : h("div", { class: "hint" }, "This script is designed. Rewriting sends it back to this words stage; it's designed again when you approve."),
    h("label", {}, "Your notes for a rewrite", notes),
    h(
      "div",
      { class: "row" },
      wordsOnly ? h("button", { onclick: saveBtn }, "Save lines") : null,
      h("button", { onclick: rewrite }, "✍️ Rewrite with my notes"),
      pending ? h("button", { class: "primary", onclick: approve }, "✅ Approve script & build") : null,
      msg,
    ),
    h("div", { class: "hint" }, "Nothing is designed or generated before you approve. The paid ElevenLabs voice is only used when you click Record final voice."),
  ];
  card.replaceChildren(
    pending
      ? h("div", {}, h("h2", {}, "Script review: waiting for your approval"), ...body)
      : h("details", {}, h("summary", {}, h("b", {}, "Script review: approved ✓"), " (open to read or rewrite)"), ...body),
  );
}

async function renderResults(slug, f) {
  const card = $("#resultsCard");
  card.hidden = !["editorial", "aesthetic"].includes(f);
  if (card.hidden) return;
  const r = await api(`/api/packs/${slug}/results`);
  const fields = ["views", "reach", "likes", "comments", "saves", "shares", "follows", "watch"];
  const link = h("input", { value: r.link ?? "", placeholder: "https://www.instagram.com/reel/..." });
  const inputs = Object.fromEntries(fields.map((k) => [k, h("input", { type: "text", inputmode: "numeric", value: r[k] ?? "", placeholder: "0" })]));
  const posted = h("input", { type: "date", value: r.posted ?? "" });
  const notes = h("input", { value: r.notes ?? "", placeholder: "Anything you noticed (e.g. lots of comments asking for links)" });
  const msg = h("span", { class: "muted" });
  const rate = (k) => (r.views && r[k] != null ? ` (${((r[k] / r.views) * 100).toFixed(1)}%)` : "");
  card.replaceChildren(
    h("h2", {}, "After posting: results"),
    h("p", { class: "hint" }, r.media_id ? "Filled automatically from Instagram every few hours (follows and notes are yours to add). The editor and the idea finder learn from your best and weakest reels." : "Paste the reel's link once it's posted: with Instagram connected (📈 Instagram), the numbers fill in by themselves. Or copy them from Insights after 3-7 days. The editor and the idea finder learn from your best and weakest reels."),
    h("div", { class: "row" }, h("label", { class: "grow" }, "Reel link", link)),
    h("div", { class: "row" }, field("Posted on", posted), ...fields.map((k) => field(`${k === "watch" ? "Avg watch (s)" : `${k[0].toUpperCase()}${k.slice(1)}`}${k === "saves" || k === "shares" ? rate(k) : ""}`, inputs[k]))),
    h("div", { class: "row" }, h("label", { class: "grow" }, "Notes", notes)),
    h(
      "div",
      { class: "row" },
      h(
        "button",
        {
          onclick: async () => {
            const body = { posted: posted.value, notes: notes.value, link: link.value.trim(), media_id: r.media_id, ...Object.fromEntries(fields.map((k) => [k, inputs[k].value])) };
            await api(`/api/packs/${slug}/results`, { method: "PUT", body: JSON.stringify(body) });
            msg.textContent = "Saved. New scripts will learn from it.";
            renderResults(slug, f);
          },
        },
        "Save results",
      ),
      msg,
    ),
  );
}

function renderQa(qa) {
  const card = $("#qaCard");
  card.hidden = !qa;
  if (!qa) return;
  const open = qa.issues.filter((i) => !i.applied && i.severity !== "low");
  const fixed = qa.issues.filter((i) => i.applied);
  card.replaceChildren(
    h("h2", {}, "Self-check"),
    h("div", { class: "muted" }, qa.verdict),
    open.length
      ? h("div", {}, h("p", {}, h("b", {}, `Needs you (${open.length}):`)), h("ul", {}, ...open.map((i) => h("li", {}, h("b", {}, `Beat ${i.beat}: `), `${i.problem} `, h("span", { class: "muted" }, `→ ${i.value}`)))))
      : h("p", {}, "Nothing needs you."),
    fixed.length
      ? h("details", {}, h("summary", {}, `Fixed automatically (${fixed.length})`), h("ul", {}, ...fixed.map((i) => h("li", {}, `Beat ${i.beat}: ${i.problem} → ${i.field} = ${i.value}`))))
      : null,
  );
}

function renderReview(review) {
  const card = $("#reviewCard");
  card.hidden = !review;
  if (!review) return;
  const grade = review.overall >= 8.5 ? "good" : review.overall >= 7 ? "ok" : "low";
  const rounds = (review.rounds ?? []).join(" → ");
  card.replaceChildren(
    h(
      "div",
      { class: "review-head" },
      h("span", { class: `score ${grade}` }, `${review.overall}/10`),
      h("div", {}, h("h2", {}, "Editor's review"), h("div", { class: "muted" }, review.verdict), rounds && h("div", { class: "hint" }, `Scores by round: ${rounds}`)),
    ),
    h(
      "div",
      { class: "chips" },
      ...Object.entries(review.scores ?? {}).map(([k, v]) => h("span", { class: `chip ${v >= 8.5 ? "good" : v >= 7 ? "ok" : "low"}` }, `${k.replace("_", " & ")} ${v}`)),
    ),
    review.problems?.length
      ? h(
          "details",
          {},
          h("summary", {}, `Still to improve (${review.problems.length})`),
          h("ul", {}, ...review.problems.map((p) => h("li", {}, h("b", {}, p.beat ? `Beat ${p.beat}: ` : "Reel: "), `${p.problem} `, h("span", { class: "muted" }, `→ ${p.fix}`)))),
        )
      : null,
    review.hooks?.length
      ? h("details", {}, h("summary", {}, "Other hooks the editor suggested"), h("ul", {}, ...review.hooks.map((x) => h("li", {}, x))))
      : null,
  );
}

async function importReply(textarea, msgEl) {
  const reply = textarea.value.trim();
  if (!reply) return textarea.focus();
  try {
    const data = await post("/api/import", { topic: pendingTopic ?? $("#topic").value, reply, format, build: true });
    textarea.value = "";
    if (data.ideas) {
      $("#manualIdeas").hidden = true;
      return renderIdeas(data.ideas);
    }
    $("#manualCreate").hidden = true;
    pendingTopic = null;
    await openPack(data.slug);
  } catch (err) {
    msgEl.innerHTML = errorHtml(err);
  }
}

async function openPack(slug) {
  const pack = await api(`/api/packs/${slug}`);
  current = { slug, script: pack.script, overrides: pack.overrides, timeline: pack.timeline, hasDavinci: pack.hasDavinci };
  const s = pack.script;
  const f = s.format ?? "classic";
  show("packView");
  $("#packFormat").textContent = FORMAT_INFO[f]?.title ?? f;
  $("#packTitle").textContent = s.title;
  $("#packAngle").textContent = s.angle ?? s.look_name ?? "";
  $("#caption").value = s.caption ?? "";
  $("#hashtags").value = (s.hashtags ?? []).join(" ");
  $("#keyword").value = s.comment_keyword ?? "";
  $("#rawJson").value = JSON.stringify(s, null, 2);
  $("#jsonMsg").textContent = "";
  const wordsOnly = s.stage === "text";
  $("#packView .grid").hidden = false;
  $$("#packView .grid > div > .card, #editor").forEach((el) => (el.hidden = wordsOnly && el.id !== "statusCard"));
  $("#saveBtn").hidden = wordsOnly;
  if (wordsOnly) {
    $("#editor").replaceChildren();
    ["#davinciBtn", "#finalVoiceBtn", "#voiceState", "#reviewCard", "#resultsCard", "#packNeedsCard", "#imagesCard"].forEach((q) => ($(q).hidden = true));
    $("#buildBtn").disabled = true;
    $("#buildBtn").title = "Approve the script first";
    renderScriptReview(s, f);
    renderStatus(pack.status, false);
    loadPacks();
    if (pack.status.state === "running") startPolling();
    return;
  }
  ({ editorial: renderEditorial, aesthetic: renderAesthetic, fit: renderFit, classic: renderClassic })[f](s);
  $("#davinciBtn").hidden = f !== "editorial" || !pack.hasCut;
  $("#polishBtn").hidden = true;
  renderScriptReview(s, f);
  const locked = f === "editorial" && s.approved === false;
  $("#buildBtn").disabled = locked;
  if (locked) $("#davinciBtn").hidden = true;
  $("#buildBtn").title = locked ? "Approve the script first" : "Free draft voice";
  const fv = pack.finalVoice;
  current.finalVoice = fv;
  $("#finalVoiceBtn").hidden = !fv || fv.recorded || locked;
  $("#voiceState").hidden = !fv;
  if (fv) {
    $("#voiceState").textContent = fv.recorded
      ? "🎙 Final ElevenLabs voice recorded for this script. Rebuilding reuses it for free."
      : `Voice: free draft (Sarvam). When the script is final, click Record final voice (about ${fv.chars} ElevenLabs credits).${fv.outdated ? " The script changed since the last recording." : ""}`;
  }
  renderReview(s.review);
  renderQa(s.qa);
  $("#selfCheckBtn").hidden = !["editorial", "aesthetic"].includes(f) || !pack.hasCut || locked;
  renderResults(slug, f);
  renderStatus(pack.status, pack.hasCut);
  renderPackNeeds();
  renderReelImages();
  renderReelMedia();
  loadPacks();
  if (pack.status.state === "running") startPolling();
}

const colorsToText = (cs = []) => cs.map((c) => `${c.name} ${c.hex}`).join(", ");
const textToColors = (t) =>
  t
    .split(",")
    .map((x) => x.trim().match(/^(.*?)\s*(#[0-9a-fA-F]{6})$/))
    .filter(Boolean)
    .map((m) => ({ name: m[1].trim() || m[2], hex: m[2].toUpperCase() }));
const itemsToText = (items = []) =>
  items.map((i) => [i.label, i.hex, (i.asset_tags ?? []).join(", "), i.asset_prompt].join(" | ")).join("\n");
const textToItems = (t) =>
  t
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [label = "", hex = "", tags = "", prompt = ""] = l.split("|").map((x) => x.trim());
      return { label, hex, asset_tags: tags.split(",").map((x) => x.trim()).filter(Boolean), asset_prompt: prompt };
    });
const tagsText = (a = []) => a.join(", ");
const textTags = (t) => t.split(",").map((x) => x.trim()).filter(Boolean);

const field = (label, input, hint) => h("label", {}, label, input, hint && h("div", { class: "hint" }, hint));
const select = (options, value, attrs = {}) =>
  h("select", attrs, ...options.map((o) => h("option", { value: o, selected: o === value }, o)));

function renderEditorial(s) {
  const c = s.cover;
  const cover = h(
    "div",
    { class: "card" },
    h("h2", {}, "Settings & cover"),
    h(
      "div",
      { class: "row" },
      field("Aspect", select(["9:16", "16:9"], s.aspect ?? "9:16", { "data-k": "aspect" }), "16:9 for landscape"),
      field("Type set", select(["editorial", "magazine", "poster", "street", "luxe", "modern"], s.typeset ?? "editorial", { "data-k": "typeset" })),
      field(
        "Sound effects",
        select(["subtle", "punchy", "off"], s.sfx === false || s.sfx === "off" ? "off" : s.sfx === "punchy" ? "punchy" : "subtle", { "data-k": "sfx" }),
      ),
      field("Cover background", select(themeOptions(), c.theme || "p1", { "data-c": "theme" })),
      field("Badge", h("input", { "data-c": "badge", value: c.badge })),
    ),
    h(
      "div",
      { class: "row" },
      field("Kicker", h("input", { "data-c": "kicker", value: c.kicker })),
      field("Headline", h("input", { "data-c": "headline", value: c.headline })),
      field("Connector", h("input", { "data-c": "connector", value: c.connector })),
    ),
    h(
      "div",
      { class: "row" },
      h("label", { class: "grow" }, "Subline", h("input", { "data-c": "subline", value: c.subline })),
      h("label", { class: "grow" }, "Tagline", h("input", { "data-c": "tagline", value: c.tagline })),
    ),
    h(
      "div",
      { class: "row" },
      field("Frame", select(["full", "letterbox"], s.look?.frame ?? "full", { "data-look": "frame" }), "letterbox = 4:5 window with black bars"),
      field("Cutouts", select(["color", "mono"], s.look?.cutouts ?? "color", { "data-look": "cutouts" }), "mono = black-and-white, accent stays"),
      field("Ghost words", select(["no", "yes"], s.look?.ghost ?? "no", { "data-look": "ghost" }), "next words wait pale"),
      field("RGB fringe", select(["no", "yes"], s.look?.chroma ?? "no", { "data-look": "chroma" }), "on fast camera moves"),
      field("Beat sync", select(["no", "yes"], s.look?.beat_sync ?? "no", { "data-look": "beat_sync" }), "moves land on the music's beats"),
    ),
    voiceControls(s.voice ?? {}),
    musicControls(s.music ?? {}),
    paletteEditor(s.palette ?? []),
    h(
      "div",
      { class: "row" },
      h("label", { class: "grow" }, "Engagement sticker (sweeps in, stays in the corner)", h("input", { "data-k": "stickerText", value: s.sticker?.text ?? "", placeholder: "Save karo" })),
      field("From beat", h("input", { "data-k": "stickerBeat", type: "number", min: 1, value: s.sticker?.beat ?? "" })),
    ),
    field("Cover swatches", h("input", { "data-c": "swatches", value: colorsToText(c.swatches) }), "Olive #556B2F, Navy #1F2A44"),
    field("Model tags", h("input", { "data-c": "model_tags", value: tagsText(c.model_tags) })),
    field("Model prompt (if the library has no match)", h("textarea", { "data-c": "model_prompt", rows: 2 }, c.model_prompt)),
  );

  const beatsBox = h("div", { id: "beats" });
  s.beats.forEach((b, i) => beatsBox.append(beatCard(b, i)));
  $("#editor").replaceChildren(
    cover,
    h(
      "div",
      { class: "card" },
      h("h2", {}, "Beats"),
      h(
        "p",
        { class: "hint" },
        "Lockup syntax: small words / ~script hero~ / *serif hero* / #CONDENSED HERO# / ^accent word. Use words from the voiceover, in order. Previews update as you type.",
      ),
      beatsBox,
    ),
  );
  $$("#beats .beat-card").forEach((el) => refreshPreview(el));
  let t;
  $(".palette").addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => $$("#beats .beat-card").forEach((el) => refreshPreview(el)), 500);
  });
  $('[data-k="typeset"]').addEventListener("change", () => $$("#beats .beat-card").forEach((el) => refreshPreview(el)));
}

function beatCard(b, i) {
  const v = b.visual ?? { kind: "none" };
  const card = h(
    "div",
    { class: "card beat-card" },
    h(
      "div",
      { class: "beat" },
      h(
        "div",
        {},
        h(
          "div",
          { class: "beat-head" },
          h("strong", { class: "num" }, `#${i + 1}`),
          themePicker(b.theme),
          select(["left", "right", "center"], b.align, { "data-b": "align", title: "Alignment" }),
          select(["rise", "mask", "typewriter", "slam", "stack", "snap"], b.motion ?? "rise", { "data-b": "motion", title: "Text animation" }),
          select(["none", "swatches", "shades", "asset", "outfit", "compare", "flow"], v.kind, { "data-v": "kind", title: "Visual" }),
          select([...new Set([...LAYOUTS, v.layout ?? "auto"])], v.layout ?? "auto", { "data-v": "layout", title: "Image layout" }),
          select(["tiles", "strokes", "pills", "mono"], v.style ?? "tiles", { "data-v": "style", title: "Swatch style / mono photo" }),
          h("button", { class: "icon", title: "Add a beat after this", onclick: () => addBeat(card) }, "+"),
          h("button", { class: "icon", title: "Delete beat", onclick: () => (card.remove(), renumber()) }, "×"),
        ),
        h(
          "div",
          { class: "row" },
          field("Camera", select(["none", "punch", "rotate"], b.camera ?? "none", { "data-b": "camera" }), "punch = extreme crop, rotate = tilt-push out"),
          field("Into next beat", select(["cut", "letter"], b.transition ?? "cut", { "data-b": "transition" }), "letter = fly through a letter of the hero word"),
          field("Hero word", select(["normal", "giant"], b.hero_size ?? "normal", { "data-b": "hero_size" }), "giant = wider than the frame, behind the model"),
          field("Ghost words", select(["no", "yes"], b.ghost ?? "no", { "data-b": "ghost" }), "words wait pale, fill in as spoken"),
          field("Text", select(["lockup", "caption"], b.text_style ?? "lockup", { "data-b": "text_style" }), "caption = quiet subtitle, word by word"),
          field("Plinth", select(["no", "yes"], v.plinth ?? "no", { "data-v": "plinth" })),
          field("Keep colour", select(["no", "yes"], v.exempt ?? "no", { "data-v": "exempt" }), "stays in colour in a black-and-white reel"),
        ),
        field("Voiceover", h("textarea", { "data-b": "voiceover", rows: 2, "data-orig": b.voiceover ?? "" }, b.voiceover)),
        field(
          "Voice says (pronunciation)",
          h("input", { "data-b": "speak", value: b.speak ?? "", "data-orig": b.speak ?? "", placeholder: "auto: Hindi words in Devanagari" }),
          "Fix a word that sounds wrong by writing it in Devanagari",
        ),
        field("On-screen lockup", h("input", { "data-b": "text", value: b.text })),
        field("Image tags", h("input", { "data-v": "asset_tags", value: tagsText(v.asset_tags) })),
        field("Image kind", select(["model", "item", "prop"], v.asset_kind ?? "model", { "data-v": "asset_kind" })),
        field("Image prompt (if the library has no match)", h("textarea", { "data-v": "asset_prompt", rows: 2 }, v.asset_prompt ?? "")),
        field("Colours", h("input", { "data-v": "colors", value: colorsToText(v.colors) }), "Olive #556B2F, Navy #1F2A44"),
        field("Items (one per line)", h("textarea", { "data-v": "items", rows: 3, class: "mono" }, itemsToText(v.items)), "label | #hex | tags | prompt"),
      ),
      h("img", { class: "thumb", alt: "Beat preview", title: "Preview (click to refresh)", onclick: () => refreshPreview(card) }),
    ),
  );
  card.orig = b;
  const syncVisibility = () => {
    const kind = $('[data-v="kind"]', card).value;
    for (const [k, kinds] of Object.entries({ layout: ["asset", "outfit", "compare"], style: ["swatches", "asset"] })) $(`[data-v="${k}"]`, card).hidden = !kinds.includes(kind);
    const shown = {
      asset_tags: ["asset"],
      asset_kind: ["asset"],
      asset_prompt: ["asset"],
      colors: ["swatches", "shades"],
      items: ["outfit", "compare", "flow"],
    };
    for (const [k, kinds] of Object.entries(shown)) $(`[data-v="${k}"]`, card).closest("label").hidden = !kinds.includes(kind);
  };
  $('[data-v="kind"]', card).addEventListener("change", syncVisibility);
  syncVisibility();
  let timer;
  card.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => refreshPreview(card), 600);
  });
  card.addEventListener("change", () => refreshPreview(card));
  return card;
}

const SARVAM_MALE = ["shubh", "aditya", "rahul", "rohan", "amit", "dev", "varun", "kabir", "aayan", "advait", "tarun", "rehan", "mohit", "soham", "sunny", "manan", "sumit", "ratan", "ashutosh", "anand", "vijay", "mani", "gokul"];
const SARVAM_FEMALE = ["priya", "neha", "ritu", "pooja", "simran", "kavya", "ishita", "shreya", "roopa", "tanya", "shruti", "suhani", "kavitha", "rupali", "amelia", "sophia"];

function voiceControls(v) {
  const sel = h(
    "select",
    { "data-voice": "speaker" },
    h("option", { value: "" }, "default (.env)"),
    h("optgroup", { label: "Male" }, ...SARVAM_MALE.map((n) => h("option", { value: n, selected: n === v.speaker }, n))),
    h("optgroup", { label: "Female" }, ...SARVAM_FEMALE.map((n) => h("option", { value: n, selected: n === v.speaker }, n))),
  );
  const audio = h("audio", { controls: true, hidden: true, class: "voice-audio" });
  const msg = h("span", { class: "hint" });
  const test = async (e) => {
    const btn = e.target;
    btn.disabled = true;
    msg.textContent = "Generating...";
    try {
      const firstLine = $("#beats .beat-card [data-b='voiceover']")?.value;
      const pace = $('[data-voice="pace"]')?.value;
      const { url } = await post("/api/voice-test", { provider: "sarvam", speaker: sel.value || undefined, text: firstLine, pace });
      audio.src = url;
      audio.hidden = false;
      audio.play().catch(() => {});
      msg.textContent = "";
    } catch (err) {
      msg.innerHTML = errorHtml(err);
    } finally {
      btn.disabled = false;
    }
  };
  return h(
    "div",
    {},
    h(
      "div",
      { class: "row" },
      h("label", { class: "grow" }, "Voice (Sarvam)", sel),
    field("Pace", h("input", { "data-voice": "pace", type: "number", min: 0.7, max: 1.6, step: 0.05, value: v.pace ?? "" })),
      h("button", { class: "small", onclick: test }, "▶ Test voice"),
      audio,
      msg,
    ),
    pronunciationBox(),
  );
}

function pronunciationBox() {
  const box = h("textarea", { rows: 3, placeholder: "baggy = बैगी\nchunky = चंकी" });
  const tryIt = h("input", { placeholder: "Type a word or line to hear it", class: "grow" });
  const audio = h("audio", { controls: true, hidden: true, class: "voice-audio" });
  const msg = h("span", { class: "hint" });
  api("/api/pronunciation").then((lex) => (box.value = Object.entries(lex).map(([k, v]) => `${k} = ${v}`).join("\n")));
  const save = async () => {
    const lex = {};
    for (const line of box.value.split("\n")) {
      const [k, ...rest] = line.split("=");
      if (k?.trim() && rest.join("=").trim()) lex[k.trim()] = rest.join("=").trim();
    }
    await api("/api/pronunciation", { method: "PUT", body: JSON.stringify(lex) });
    msg.textContent = "Saved. Applies to every reel on the next build.";
  };
  const hear = async (e) => {
    e.target.disabled = true;
    msg.textContent = "Generating...";
    try {
      await save();
      const { url } = await post("/api/voice-test", { provider: "sarvam", speaker: $('[data-voice="speaker"]')?.value || undefined, text: tryIt.value || undefined, pace: $('[data-voice="pace"]')?.value });
      audio.src = url;
      audio.hidden = false;
      audio.play().catch(() => {});
      msg.textContent = "";
    } catch (err) {
      msg.innerHTML = errorHtml(err);
    } finally {
      e.target.disabled = false;
    }
  };
  return h(
    "details",
    { class: "pron" },
    h("summary", {}, "Pronunciation fixes (for every reel)"),
    h("div", { class: "hint" }, "One per line: the word as written = how the voice should say it, in Hindi letters. Example: baggy = बैगी"),
    box,
    h("div", { class: "row" }, tryIt, h("button", { class: "small", onclick: hear }, "▶ Hear it"), h("button", { class: "small", onclick: save }, "Save"), audio, msg),
  );
}

function musicControls(m) {
  const sel = h("select", { "data-m": "file" }, h("option", { value: "" }, "no music"));
  api("/api/music").then((files) => {
    for (const f of files) sel.append(h("option", { value: f, selected: f === m.file }, f));
  });
  const up = h("input", {
    type: "file",
    accept: "audio/*",
    hidden: true,
    onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const form = new FormData();
      form.append("file", file);
      const { file: name } = await api("/api/music", { method: "POST", body: form });
      sel.append(h("option", { value: name, selected: true }, name));
      sel.value = name;
    },
  });
  return h(
    "div",
    { class: "row" },
    h("label", { class: "grow" }, "Background music", sel),
    h("label", { class: "upload small" }, "Upload track", up),
    field("Start at (s)", h("input", { "data-m": "start", type: "number", min: 0, step: 0.5, value: m.start ?? 0 })),
    field(
      "Use it in",
      select(["preview", "final", "off"], m.mode ?? "preview", { "data-m": "mode" }),
      "preview = separate file; post the clean one",
    ),
  );
}

function paletteEditor(palette) {
  const rows = [0, 1, 2, 3].map((i) => {
    const p = palette[i] ?? { name: "", bg: "", accent: "" };
    const used = !!p.bg;
    return h(
      "div",
      { class: "pal", "data-pal": i },
      h("strong", {}, `p${i + 1}`),
      h("input", { type: "checkbox", "data-p": "on", checked: used, title: "Use this slot" }),
      h("input", { "data-p": "name", value: p.name, placeholder: "name" }),
      h("label", { class: "hint" }, "bg", h("input", { type: "color", "data-p": "bg", value: p.bg || "#1F2A44", class: "swatch-input" })),
      h("label", { class: "hint" }, "accent", h("input", { type: "color", "data-p": "accent", value: p.accent || "#E9C46A", class: "swatch-input" })),
      select(["none", "paper", "grid", "dots"], p.texture ?? "none", { "data-p": "texture", title: "Texture" }),
    );
  });
  return h("div", { class: "palette" }, h("div", { class: "hint" }, "Reel palette (beats use p1–p4)"), ...rows);
}

function readPalette() {
  return $$(".palette .pal")
    .filter((el) => $('[data-p="on"]', el).checked)
    .map((el) => ({
      name: $('[data-p="name"]', el).value.trim() || "colour",
      bg: $('[data-p="bg"]', el).value.toUpperCase(),
      accent: $('[data-p="accent"]', el).value.toUpperCase(),
      texture: $('[data-p="texture"]', el).value,
    }));
}

const themeOptions = () => ["p1", "p2", "p3", "p4", ...THEMES];

function themePicker(value) {
  const isHex = /^#[0-9a-f]{6}$/i.test(value ?? "");
  const sel = select([...themeOptions(), "custom"], isHex ? "custom" : value, { "data-b": "theme", title: "Background" });
  const hex = h("input", { type: "color", "data-b": "themeHex", value: isHex ? value : "#1F2A44", title: "Custom background", class: "swatch-input" });
  hex.hidden = !isHex;
  sel.addEventListener("change", () => (hex.hidden = sel.value !== "custom"));
  return h("span", { class: "theme-pick" }, sel, hex);
}

function readTheme(card) {
  const sel = $('[data-b="theme"]', card).value;
  return sel === "custom" ? $('[data-b="themeHex"]', card).value.toUpperCase() : sel;
}

function readBeat(card) {
  const v = (k) => $(`[data-v="${k}"]`, card).value;
  const vo = $('[data-b="voiceover"]', card);
  const sp = $('[data-b="speak"]', card);
  const staleSpeak = vo.value !== vo.dataset.orig && sp.value === sp.dataset.orig;
  const orig = card.orig ?? {};
  return {
    ...orig,
    voiceover: vo.value.trim(),
    speak: staleSpeak ? "" : sp.value.trim(),
    text: $('[data-b="text"]', card).value.trim(),
    align: $('[data-b="align"]', card).value,
    motion: $('[data-b="motion"]', card).value,
    camera: $('[data-b="camera"]', card).value,
    transition: $('[data-b="transition"]', card).value,
    hero_size: $('[data-b="hero_size"]', card).value,
    ghost: $('[data-b="ghost"]', card).value,
    text_style: $('[data-b="text_style"]', card).value,
    theme: readTheme(card),
    visual: {
      ...(orig.visual ?? {}),
      plinth: v("plinth"),
      exempt: v("exempt"),
      kind: v("kind"),
      layout: v("layout"),
      style: v("style"),
      asset_kind: v("asset_kind"),
      asset_tags: textTags(v("asset_tags")),
      asset_prompt: v("asset_prompt"),
      colors: textToColors(v("colors")),
      items: textToItems(v("items")),
    },
  };
}

async function refreshPreview(card) {
  const cards = $$("#beats .beat-card");
  const i = cards.indexOf(card);
  if (i < 0) return;
  const prevTheme = i > 0 ? readTheme(cards[i - 1]) : null;
  const aspect = $('[data-k="aspect"]')?.value ?? "9:16";
  try {
    const res = await fetch("/api/preview-beat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        beat: readBeat(card),
        aspect,
        prevTheme,
        palette: $(".palette") ? readPalette() : [],
        typeset: $('[data-k="typeset"]')?.value ?? "editorial",
        look: Object.fromEntries($$("[data-look]").map((el) => [el.dataset.look, el.value])),
      }),
    });
    if (!res.ok) return;
    const img = $(".thumb", card);
    if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
    img.dataset.url = URL.createObjectURL(await res.blob());
    img.src = img.dataset.url;
  } catch {
  }
}

function addBeat(after) {
  const b = readBeat(after);
  const card = beatCard({ ...b, voiceover: "", text: "", visual: { kind: "none" } }, 0);
  after.after(card);
  renumber();
}

function renumber() {
  $$("#beats .beat-card").forEach((el, i) => ($(".num", el).textContent = `#${i + 1}`));
}

function collectEditorial(s) {
  const c = (k) => $(`[data-c="${k}"]`).value;
  s.aspect = $('[data-k="aspect"]').value;
  s.sfx = $('[data-k="sfx"]').value;
  s.palette = readPalette();
  s.typeset = $('[data-k="typeset"]').value;
  s.look = Object.fromEntries($$("[data-look]").map((el) => [el.dataset.look, el.value]));
  s.voice = {
    speaker: $('[data-voice="speaker"]').value || undefined,
    pace: Number($('[data-voice="pace"]').value) || undefined,
  };
  s.music = {
    file: $('[data-m="file"]').value,
    start: Number($('[data-m="start"]').value) || 0,
    mode: $('[data-m="mode"]').value,
  };
  const stickerText = $('[data-k="stickerText"]').value.trim();
  s.sticker = stickerText ? { text: stickerText, beat: Number($('[data-k="stickerBeat"]').value) || Math.ceil(s.beats.length * 0.4) } : undefined;
  s.cover = {
    ...s.cover,
    theme: c("theme"),
    badge: c("badge"),
    kicker: c("kicker"),
    headline: c("headline"),
    connector: c("connector"),
    subline: c("subline"),
    tagline: c("tagline"),
    swatches: textToColors(c("swatches")),
    model_tags: textTags(c("model_tags")),
    model_prompt: c("model_prompt"),
  };
  s.beats = $$("#beats .beat-card").map(readBeat);
}

function renderFit(s) {
  const override = current.overrides.find((f) => f.startsWith("scene-01."));
  const rows = h("tbody", {});
  const addRow = (p = {}) =>
    rows.append(
      h(
        "tr",
        {},
        h("td", {}, h("input", { "data-p": "name", value: p.name ?? "", placeholder: "Navy knit polo" })),
        h("td", {}, h("input", { "data-p": "color", value: p.color ?? "", placeholder: "navy" })),
        h("td", {}, h("input", { "data-p": "price", value: p.price ?? "", placeholder: "₹699" })),
        h("td", {}, h("input", { "data-p": "link", value: p.link ?? "", placeholder: "https://..." })),
        h("td", {}, h("button", { class: "icon", onclick: (e) => e.target.closest("tr").remove() }, "×")),
      ),
    );
  (s.products ?? []).forEach(addRow);

  const copyBtn = (sel) =>
    h("button", { class: "small", onclick: (e) => (navigator.clipboard.writeText($(sel).value), flash(e.target, "Copied!")) }, "Copy");

  $("#editor").replaceChildren(
    h(
      "div",
      { class: "card" },
      h("h2", {}, "1. Your try-on clip"),
      h(
        "p",
        { class: "hint" },
        "Make it with a free virtual try-on tool plus image-to-video (steps in the try-on guide), then upload it here. Until then the build uses a rough AI preview.",
      ),
      h(
        "div",
        { class: "row" },
        h(
          "label",
          { class: "upload small" },
          override ? "Replace clip" : "Upload try-on clip",
          h("input", { type: "file", accept: "video/*,image/*", hidden: true, onchange: (e) => uploadOverride(1, e.target.files[0]) }),
        ),
        override && h("span", { class: "muted" }, `Using ${override}`),
        override && h("button", { class: "small", onclick: () => clearOverride(1) }, "Remove"),
        h("a", { href: `/packs/${current.slug}/tryon-guide.md`, target: "_blank", class: "small" }, "Open try-on guide"),
      ),
    ),
    h(
      "div",
      { class: "card" },
      h("h2", {}, "2. Look"),
      h(
        "div",
        { class: "row" },
        h("label", { class: "grow" }, "Hook text (top of video)", h("input", { "data-f": "hook_text", value: s.hook_text })),
        field("Look name", h("input", { "data-f": "look_name", value: s.look_name })),
        field("Vibe", h("input", { "data-f": "vibe", value: s.vibe })),
      ),
      h("h2", {}, "Products (price tags + DM message)"),
      h(
        "table",
        { class: "products" },
        h("thead", {}, h("tr", {}, ...["Name", "Colour", "Price", "Affiliate link", ""].map((t) => h("th", { class: "hint" }, t)))),
        rows,
      ),
      h("button", { class: "small", onclick: () => addRow() }, "+ Add product"),
    ),
    h(
      "div",
      { class: "card" },
      h("h2", {}, "3. AI prompts"),
      field("Model / try-on image prompt", h("textarea", { "data-f": "model_prompt", id: "fitModelPrompt", rows: 4 }, s.model_prompt)),
      copyBtn("#fitModelPrompt"),
      field("Image-to-video prompt", h("textarea", { "data-f": "video_prompt", id: "fitVideoPrompt", rows: 3 }, s.video_prompt)),
      copyBtn("#fitVideoPrompt"),
    ),
  );
}

function collectFit(s) {
  for (const el of $$("#editor [data-f]")) s[el.dataset.f] = el.value;
  s.products = $$("#editor tbody tr")
    .map((tr) => Object.fromEntries($$("[data-p]", tr).map((i) => [i.dataset.p, i.value.trim()])))
    .filter((p) => p.name);
}

function renderClassic(s) {
  $("#editor").replaceChildren(
    ...s.scenes.map((scene, i) => {
      const n = String(i + 1).padStart(2, "0");
      const override = current.overrides.find((f) => f.startsWith(`scene-${n}.`));
      const source = current.timeline?.scenes?.[i]?.source;
      return h(
        "div",
        { class: "card scene" },
        h("div", { class: "row between" }, h("strong", {}, `Scene ${n}${i === 0 ? " · HOOK" : ""}`), h("span", { class: "muted" }, source ?? "")),
        field("On-screen text", h("input", { "data-s": "on_screen_text", value: scene.on_screen_text })),
        field("Voiceover", h("textarea", { "data-s": "voiceover", rows: 2 }, scene.voiceover)),
        h(
          "div",
          { class: "row" },
          h("label", { class: "grow" }, "Visual", select(["stock_video", "ai_image", "ai_video"], scene.visual_type, { "data-s": "visual_type" })),
          h("label", { class: "grow" }, "Highlight words", h("input", { "data-s": "highlight_words", value: tagsText(scene.highlight_words) })),
        ),
        field("Stock search", h("input", { "data-s": "stock_query", value: scene.stock_query })),
        field("AI prompt", h("textarea", { "data-s": "ai_prompt", rows: 3 }, scene.ai_prompt)),
        h(
          "div",
          { class: "row" },
          h(
            "label",
            { class: "upload small" },
            "Use my own clip/image",
            h("input", { type: "file", accept: "video/*,image/*", hidden: true, onchange: (e) => uploadOverride(i + 1, e.target.files[0]) }),
          ),
          override && h("button", { class: "small", onclick: () => clearOverride(i + 1) }, "Remove my file"),
          override && h("span", { class: "muted" }, `Using your file: ${override}`),
        ),
      );
    }),
  );
}

function collectClassic(s) {
  $$("#editor .scene").forEach((el, i) => {
    for (const input of $$("[data-s]", el)) {
      const k = input.dataset.s;
      s.scenes[i][k] = k === "highlight_words" ? textTags(input.value) : input.value;
    }
  });
}

function collectScript() {
  const s = structuredClone(current.script);
  const f = s.format ?? "classic";
  ({ editorial: collectEditorial, aesthetic: () => {}, fit: collectFit, classic: collectClassic })[f](s);
  s.caption = $("#caption").value;
  s.hashtags = $("#hashtags").value.split(/\s+/).filter(Boolean);
  s.comment_keyword = $("#keyword").value.trim() || (f === "aesthetic" ? "" : "LINK");
  return s;
}

async function save() {
  const s = collectScript();
  await api(`/api/packs/${current.slug}/script`, { method: "PUT", body: JSON.stringify(s) });
  current.script = s;
  $("#rawJson").value = JSON.stringify(s, null, 2);
}

async function applyJson() {
  try {
    const s = JSON.parse($("#rawJson").value);
    await api(`/api/packs/${current.slug}/script`, { method: "PUT", body: JSON.stringify(s) });
    await openPack(current.slug);
    $("#jsonMsg").textContent = "Applied.";
  } catch (err) {
    $("#jsonMsg").innerHTML = errorHtml(err);
  }
}

async function uploadOverride(n, file) {
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  $("#stepLine").textContent = "Uploading...";
  try {
    await save();
    await api(`/api/packs/${current.slug}/scenes/${n}/override`, { method: "POST", body: form });
    await openPack(current.slug);
    $("#stepLine").textContent = "Uploaded. Click Build reel.";
  } catch (err) {
    $("#stepLine").innerHTML = errorHtml(err);
  }
}

async function clearOverride(n) {
  await save();
  await api(`/api/packs/${current.slug}/scenes/${n}/override`, { method: "DELETE" });
  await openPack(current.slug);
}

async function build() {
  setBusy($("#buildBtn"), true, "Working...");
  try {
    await save();
    await post(`/api/packs/${current.slug}/build`);
    startPolling();
  } catch (err) {
    $("#stepLine").innerHTML = errorHtml(err);
    setBusy($("#buildBtn"), false, "Build reel");
  }
}

function startPolling() {
  clearInterval(poll);
  setBusy($("#buildBtn"), true, "Working...");
  const slug = current.slug;
  poll = setInterval(async () => {
    if (current?.slug !== slug) return clearInterval(poll);
    const status = await api(`/api/packs/${slug}/status`);
    renderStatus(status, false);
    if (status.state !== "running") {
      clearInterval(poll);
      setBusy($("#buildBtn"), false, "Build reel");
      openPack(slug);
    }
  }, 1500);
}

function renderStatus(status, hasCut) {
  $("#stepLine").innerHTML =
    status.state === "error"
      ? errorHtml(status.step)
      : escapeHtml({ idle: "Not built yet.", running: status.step, done: "Built." }[status.state] ?? "");
  $("#log").textContent = (status.log ?? []).join("\n");
  $("#log").scrollTop = 1e9;
  $("#outputCard").hidden = !hasCut;
  if (!hasCut) return;
  const base = `/packs/${current.slug}`;
  const bust = `?t=${Date.now()}`;
  $("#player").src = `${base}/rough-cut.mp4${bust}`;
  const f = current.script.format ?? "classic";
  const files = [
    ["rough-cut.mp4", "Reel (post this)"],
    [f === "editorial" && current.script.music?.file && current.script.music?.mode === "preview" ? "preview-with-music.mp4" : null, "Preview with music"],
    ["cover.png", "Cover"],
    [f === "editorial" ? "voiceover.mp3" : f === "classic" ? "voiceover.m4a" : null, "Voiceover"],
    [f === "classic" ? "captions.srt" : null, "Captions (.srt)"],
    ["caption.txt", "Post caption"],
    [f === "fit" ? "dm-links.txt" : null, "DM links"],
    [f === "fit" ? "tryon-guide.md" : null, "Try-on guide"],
    ["script.md", "Script"],
    [f === "aesthetic" ? "image-prompts.md" : null, "Image prompts (Gemini)"],
  ].filter(([file]) => file);
  $("#links").innerHTML = files.map(([file, label]) => `<a href="${base}/${file}${bust}" target="_blank">${label}</a>`).join("");
  if (current.hasDavinci) {
    $("#links").append(
      h("button", { class: "small", onclick: () => post(`/api/packs/${current.slug}/reveal`, { folder: "davinci" }) }, "📂 Open DaVinci folder"),
    );
  }
  $("#coverBox").hidden = f === "classic";
  const hasPreview = files.some(([file]) => file === "preview-with-music.mp4");
  $("#playerSwitch").hidden = !hasPreview;
  if (hasPreview) {
    $("#player").src = `${base}/preview-with-music.mp4${bust}`;
    for (const btn of $$("#playerSwitch button")) btn.onclick = () => ($("#player").src = `${base}/${btn.dataset.src}${bust}`);
  }
  $("#coverImg").src = `${base}/cover.png${bust}`;
}

async function showLibrary() {
  current = null;
  clearInterval(poll);
  show("libraryView");
  loadPacks();
  await Promise.all([renderAssets(), renderNeeds()]);
}

async function renderNeeds() {
  const needs = await api("/api/library/needs");
  $("#needsCount").textContent = needs.length ? `(${needs.length})` : "";
  if (!needs.length) {
    $("#needs").replaceChildren(h("p", { class: "muted" }, "Nothing needed. Every image your reels use is in the library."));
    return;
  }
  $("#needs").replaceChildren(...needs.map((n) => needCard(n, showLibrary)));
}

async function renderReelImages() {
  const isEditorial = current && ["editorial", "aesthetic"].includes(current.script.format ?? "classic");
  $("#imagesCard").hidden = !isEditorial;
  if (!isEditorial) return;
  const slug = current.slug;
  const images = await api(`/api/packs/${slug}/images`);
  if (current?.slug !== slug) return;
  $("#imagesCard").hidden = !images.length;
  $("#reelImages").replaceChildren(...images.map((im) => reelImageCard(slug, im)));
  const cover = images.find((im) => im.key === "c:cover");
  $("#coverPrompt").replaceChildren(
    ...(cover
      ? [h("button", { class: "small", onclick: (e) => (navigator.clipboard.writeText(cover.appPrompt), flash(e.target, "Copied!")) }, "Copy cover image prompt"), h("p", { class: "hint" }, "Make it in Gemini or ChatGPT, then upload it on the \"cover image\" card in Images and click Build reel.")]
      : []),
  );
}

function reelImageCard(slug, im) {
  const msg = h("div", { class: "hint" });
  const promptBox = h("textarea", { rows: 3, hidden: true }, im.prompt);
  const card = h("div", { class: "rimg" });
  const done = async (text) => {
    card.classList.remove("busy");
    await renderReelImages();
    $("#stepLine").textContent = text ?? "Image updated. Click Build reel to use it.";
  };
  const fail = (err) => {
    card.classList.remove("busy");
    msg.innerHTML = errorHtml(err);
  };
  const regenerate = async (prompt) => {
    card.classList.add("busy");
    msg.textContent = "Generating...";
    try {
      await post(`/api/packs/${slug}/images/${im.key}/regenerate`, { prompt });
      await done();
    } catch (err) {
      fail(err);
    }
  };
  const upload = async (file) => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    card.classList.add("busy");
    msg.textContent = "Cutting out...";
    try {
      await api(`/api/packs/${slug}/images/${im.key}/upload`, { method: "POST", body: form });
      await done();
    } catch (err) {
      fail(err);
    }
  };
  const genBtn = h("button", { class: "small primary", hidden: true, onclick: () => regenerate(promptBox.value) }, "Generate with this prompt");
  card.append(
    h("div", { class: "pic" }, im.current ? h("img", { src: `${im.current.url}?t=${Date.now()}`, alt: im.tags.join(", ") }) : h("span", { class: "muted" }, "No image yet")),
    h(
      "div",
      { class: "meta" },
      h("b", {}, im.label || im.tags.join(", ")),
      h("br"),
      `${im.kind} · beats ${im.beats.join(", ")}${im.current ? ` · ${im.current.source}` : ""}`,
    ),
    h(
      "div",
      { class: "btns" },
      h("button", { class: "small", onclick: () => regenerate() }, "Regenerate"),
      h("button", { class: "small", onclick: () => ((promptBox.hidden = !promptBox.hidden), (genBtn.hidden = promptBox.hidden)) }, "Edit prompt"),
      h(
        "label",
        { class: "upload small" },
        "Upload",
        h("input", { type: "file", accept: "image/*", hidden: true, onchange: (e) => upload(e.target.files[0]) }),
      ),
      h("button", { class: "small", onclick: (e) => (navigator.clipboard.writeText(im.appPrompt), flash(e.target, "Copied!")) }, "Gemini prompt"),
    ),
    promptBox,
    genBtn,
    msg,
  );
  card.addEventListener("dragover", (e) => (e.preventDefault(), card.classList.add("drag")));
  card.addEventListener("dragleave", () => card.classList.remove("drag"));
  card.addEventListener("drop", (e) => {
    e.preventDefault();
    card.classList.remove("drag");
    upload(e.dataTransfer.files[0]);
  });
  return card;
}

async function renderReelMedia() {
  const isAes = current?.script.format === "aesthetic";
  $("#mediaCard").hidden = true;
  if (!isAes) return;
  const slug = current.slug;
  const slots = await api(`/api/packs/${slug}/media`);
  if (current?.slug !== slug) return;
  $("#mediaCard").hidden = !slots.length;
  const todo = slots.filter((m) => !m.file).length;
  $("#mediaCount").textContent = slots.length ? `(${slots.length - todo}/${slots.length} added)` : "";
  $("#reelMedia").replaceChildren(...slots.map((m) => reelMediaCard(slug, m)));
}

function reelMediaCard(slug, m) {
  const msg = h("div", { class: "hint" });
  const card = h("div", { class: "rimg" });
  const upload = async (file) => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    card.classList.add("busy");
    msg.textContent = "Uploading...";
    try {
      await api(`/api/packs/${slug}/media/${m.key}`, { method: "POST", body: form });
      await renderReelMedia();
      $("#stepLine").textContent = "Added. Click Build reel to use it.";
    } catch (err) {
      card.classList.remove("busy");
      msg.innerHTML = errorHtml(err);
    }
  };
  const remove = async () => {
    await api(`/api/packs/${slug}/media/${m.key}`, { method: "DELETE" });
    await renderReelMedia();
  };
  const ai = m.source === "ai";
  const kindLabel = `${ai ? "AI clip (make in Gemini)" : m.kind === "photo" ? "Real photo" : "Real clip"}${m.optional ? " (optional: the model stands in)" : ""}`;
  const preview = m.file
    ? m.file.video
      ? h("video", { src: m.file.url, muted: true, loop: true, controls: true, playsinline: true })
      : h("img", { src: m.file.url, alt: m.what })
    : ai
      ? h("img", { src: m.startFrame, alt: "Start photo" })
      : h("span", { class: "muted" }, "Not added yet");
  card.append(
    h("div", { class: "pic" }, preview),
    h(
      "div",
      { class: "meta" },
      h("b", {}, `${kindLabel}: ${m.key.replace(/_/g, " ")}`),
      h("br"),
      m.what,
      h("br"),
      `scene ${m.scenes.join(", ") || "-"}`,
      ai && !m.file
        ? h("div", { class: "hint" }, "In Gemini: choose Video, attach the start photo, paste the prompt, ask for vertical 9:16. Upload the clip here; until then the still scene stands in.")
        : null,
    ),
    h(
      "div",
      { class: "btns" },
      ...m.links.map((l) => h("a", { class: "button small", href: l.url, target: "_blank", rel: "noopener" }, l.label)),
      ai ? h("a", { class: "button small", href: m.startFrame, download: `${m.key}-start.png` }, "Download start photo") : null,
      ai ? h("button", { class: "small", onclick: (e) => (navigator.clipboard.writeText(m.aiText), flash(e.target, "Copied!")) }, "Copy prompt") : null,
      ai ? h("a", { class: "button small", href: "https://gemini.google.com/app", target: "_blank", rel: "noopener" }, "Open Gemini") : null,
      h("label", { class: "upload small" }, m.file ? "Replace" : "Upload", h("input", { type: "file", accept: m.kind === "photo" ? "image/*" : "video/*,image/*", hidden: true, onchange: (e) => upload(e.target.files[0]) })),
      m.file ? h("button", { class: "small", onclick: remove }, "Remove") : null,
    ),
    msg,
  );
  card.addEventListener("dragover", (e) => (e.preventDefault(), card.classList.add("drag")));
  card.addEventListener("dragleave", () => card.classList.remove("drag"));
  card.addEventListener("drop", (e) => {
    e.preventDefault();
    card.classList.remove("drag");
    upload(e.dataTransfer.files[0]);
  });
  return card;
}

async function renderPackNeeds() {
  if (!current || (current.script.format ?? "classic") !== "editorial") return ($("#packNeedsCard").hidden = true);
  const slug = current.slug;
  const needs = (await api(`/api/packs/${slug}/needs`)).filter((n) => n.needsYou);
  if (current?.slug !== slug) return;
  $("#packNeedsCard").hidden = !needs.length;
  $("#packNeedsCount").textContent = needs.length ? `(${needs.length})` : "";
  $("#packNeeds").replaceChildren(...needs.map((n) => needCard(n, () => openPack(slug))));
}

function needCard(n, onDone) {
  {
      const msg = h("span", { class: "muted small" });
      const upload = async (file) => {
        if (!file) return;
        const form = new FormData();
        form.append("file", file);
        form.append("kind", n.kind);
        form.append("tags", n.tags.join(", "));
        msg.textContent = "Cutting out...";
        try {
          await api("/api/library", { method: "POST", body: form });
          await onDone();
        } catch (err) {
          msg.innerHTML = errorHtml(err);
        }
      };
      const card = h(
        "div",
        { class: `need ${n.needsYou ? "you" : ""}` },
        h(
          "div",
          { class: "tag" },
          h("b", {}, n.key === "host-ref" ? "Host reference photo (one time)" : n.status === "missing" ? "Missing" : "Upgrade"),
          ` · ${n.kind} · ${n.tags.join(", ")}`,
        ),
        h("div", { class: "hint" }, `Used in: ${n.packs.join(", ")}`),
        h("textarea", { rows: 4, readonly: true }, n.prompt),
        h(
          "div",
          { class: "row" },
          h("button", { class: "small", onclick: (e) => (navigator.clipboard.writeText(n.prompt), flash(e.target, "Copied!")) }, "Copy prompt"),
          n.hostRef && h("a", { href: n.hostRef, download: "host-reference.png", class: "small" }, "Download host reference"),
          h(
            "label",
            { class: "upload small" },
            "Add image",
            h("input", { type: "file", accept: "image/*", hidden: true, onchange: (e) => upload(e.target.files[0]) }),
          ),
          msg,
        ),
        n.current && h("div", { class: "thumbs" }, h("span", { class: "hint" }, "Current:"), h("img", { src: n.current, alt: "current stand-in" })),
      );
      card.addEventListener("dragover", (e) => (e.preventDefault(), card.classList.add("drag")));
      card.addEventListener("dragleave", () => card.classList.remove("drag"));
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("drag");
        upload(e.dataTransfer.files[0]);
      });
      return card;
  }
}

async function renderAssets() {
  const assets = (await api("/api/library")).sort((a, b) => b.created - a.created);
  for (const sel of $$("#generateForm select.ref")) {
    const keep = sel.value;
    sel.replaceChildren(
      h("option", { value: "" }, "none"),
      ...assets.map((a) => h("option", { value: a.id, selected: a.id === keep }, `${a.kind}: ${a.tags.join(", ")}`)),
    );
  }
  $("#assetGrid").replaceChildren(
    ...(assets.length
      ? assets.map((a) => {
          const tags = h("input", { value: tagsText(a.tags), title: "Tags (saved when you leave the field)" });
          tags.addEventListener("change", () => api(`/api/library/${a.id}`, { method: "PATCH", body: JSON.stringify({ tags: tags.value }) }));
          return h(
            "div",
            { class: "asset" },
            h("div", { class: "pic" }, h("img", { src: `/library/${a.file}`, alt: a.tags.join(", "), loading: "lazy" })),
            h("div", { class: "meta" }, `${a.kind} · ${a.source} · used ${a.uses ?? 0}x`),
            tags,
            a.kind === "host" &&
              h(
                "button",
                {
                  class: "small",
                  title: "New host poses are generated to look like this image",
                  onclick: async () => {
                    for (const other of assets.filter((x) => x.kind === "host" && x.tags.includes("host-ref") && x.id !== a.id)) {
                      await api(`/api/library/${other.id}`, { method: "PATCH", body: JSON.stringify({ tags: other.tags.filter((t) => t !== "host-ref") }) });
                    }
                    await api(`/api/library/${a.id}`, { method: "PATCH", body: JSON.stringify({ tags: [...new Set([...a.tags, "host-ref"])] }) });
                    renderAssets();
                  },
                },
                a.tags.includes("host-ref") ? "★ Host reference" : "Set as host reference",
              ),
            ["model", "host"].includes(a.kind) &&
              h(
                "label",
                { class: "check" },
                h("input", {
                  type: "checkbox",
                  checked: a.blurFace === true,
                  onchange: (e) => api(`/api/library/${a.id}`, { method: "PATCH", body: JSON.stringify({ blurFace: e.target.checked }) }),
                }),
                "Blur face",
              ),
            h(
              "button",
              {
                class: "small",
                onclick: async () => {
                  if (!confirm("Delete this asset?")) return;
                  await api(`/api/library/${a.id}`, { method: "DELETE" });
                  renderAssets();
                },
              },
              "Delete",
            ),
          );
        })
      : [h("p", { class: "muted" }, "No assets yet. Reels add images here automatically as they're generated.")]),
  );
}

$("#uploadForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const msg = $(".msg", form);
  msg.textContent = "Removing background...";
  try {
    await api("/api/library", { method: "POST", body: new FormData(form) });
    form.reset();
    msg.textContent = "Added.";
    renderAssets();
  } catch (err) {
    msg.innerHTML = errorHtml(err);
  }
});

$("#generateForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const msg = $(".msg", form);
  msg.textContent = "Generating (up to a minute)...";
  try {
    const data = Object.fromEntries(new FormData(form));
    data.referenceIds = $$("select.ref", form).map((s) => s.value).filter(Boolean);
    await post("/api/library/generate", data);
    msg.textContent = "Added.";
    renderAssets();
  } catch (err) {
    msg.innerHTML = errorHtml(err);
  }
});

function setBusy(btn, busy, text) {
  btn.disabled = busy;
  btn.textContent = text;
}

function flash(btn, text) {
  const label = btn.textContent;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = label), 1300);
}

$("#newBtn").onclick = showNew;
$("#homeBtn").onclick = showHome;
$("#brandBtn").onclick = showHome;
$("#homeCreate").onclick = homeCreate;
$("#homeTopic").addEventListener("keydown", (e) => e.key === "Enter" && homeCreate());
$("#homeIdeas").onclick = async () => {
  format = "editorial";
  await showNew();
  getIdeas();
};
for (const b of $$("[data-go]")) b.onclick = () => $(`#${b.dataset.go}`).click();
$("#libraryBtn").onclick = showLibrary;
$("#stylesBtn").onclick = showStyles;
$("#motionsBtn").onclick = showMotions;
$("#instagramBtn").onclick = showInstagram;

async function showInstagram() {
  show("instagramView");
  const box = $("#igBody");
  const st = await api("/api/instagram");
  if (!st.connected) {
    const token = h("input", { class: "grow", type: "password", placeholder: "Paste the access token here", autocomplete: "off" });
    const msg = h("div", { class: "hint" });
    box.replaceChildren(
      h("div", { class: "card" },
        h("h2", {}, "Connect @ivoryandindigo.in (one time, about 10 minutes)"),
        h("p", { class: "muted" }, "Instagram's official API reads your followers and each reel's views, reach, saves, shares and watch time. It's read-only: it can't post, like or comment. You create the token yourself in Meta's developer site; it stays on this computer."),
        h("ol", {},
          h("li", {}, "Go to ", h("a", { href: "https://developers.facebook.com/apps", target: "_blank", rel: "noopener" }, "developers.facebook.com/apps"), ", log in with Facebook, and click Create app."),
          h("li", {}, "Pick the use case \"Manage messaging & content on Instagram\", name it (e.g. Reel Engine), create it."),
          h("li", {}, "In the app, open Instagram → API setup with Instagram login → under \"Generate access tokens\" click Add account and log in as ivoryandindigo.in."),
          h("li", {}, "If Instagram asks, accept the tester invite: Instagram app → Settings → Website permissions → Apps and websites → Tester invites."),
          h("li", {}, "Back in the app page, click Generate token next to the account, copy it, and paste it below.")),
        h("div", { class: "row" }, token, h("button", { class: "primary", onclick: async () => {
          msg.textContent = "Checking…";
          try {
            const r = await api("/api/instagram/connect", { method: "POST", body: JSON.stringify({ token: token.value }) });
            msg.textContent = `Connected as @${r.username}.`;
            showInstagram();
          } catch (err) {
            msg.innerHTML = errorHtml(err);
          }
        } }, "Connect")),
        msg),
    );
    return;
  }
  const a = st.account ?? {};
  const days = Object.entries(st.followers ?? {}).sort();
  const first = days[0]?.[1];
  const growth = first != null && a.followers_count != null ? a.followers_count - first : null;
  const num = (n) => (n == null ? "–" : Number(n).toLocaleString("en-IN"));
  const pct = (x, v) => (v ? `${((x / v) * 100).toFixed(1)}%` : "–");
  const msg = h("span", { class: "muted" }, st.at ? `Last synced ${new Date(st.at).toLocaleString()}` : "Not synced yet");
  const rows = (st.reels ?? []).map((r) =>
    h("tr", {},
      h("td", {}, h("a", { href: r.permalink, target: "_blank", rel: "noopener" }, r.title ?? r.caption ?? "Post"), r.slug ? null : h("div", { class: "hint" }, "Not matched to a reel here")),
      h("td", {}, r.timestamp ? new Date(r.timestamp).toLocaleDateString() : ""),
      h("td", {}, num(r.views)), h("td", {}, num(r.reach)), h("td", {}, num(r.likes)), h("td", {}, num(r.comments)),
      h("td", {}, `${num(r.saves)} · ${pct(r.saves, r.views)}`), h("td", {}, `${num(r.shares)} · ${pct(r.shares, r.views)}`),
      h("td", {}, r.watch != null ? `${r.watch}s` : "–")));
  box.replaceChildren(
    h("div", { class: "card" },
      h("div", { class: "row between" },
        h("h2", {}, `@${a.username ?? st.username ?? ""}`),
        h("div", { class: "row" }, msg,
          h("button", { onclick: async (e) => { e.target.disabled = true; await api("/api/instagram/sync", { method: "POST" }); showInstagram(); } }, "Sync now"),
          h("button", { class: "small", onclick: async () => { if (confirm("Disconnect Instagram? The token is removed from this computer.")) { await api("/api/instagram/disconnect", { method: "POST" }); showInstagram(); } } }, "Disconnect"))),
      st.error ? h("p", { class: "hint" }, `Last sync failed: ${st.error}`) : null,
      h("div", { class: "igStats" },
        h("div", {}, h("b", {}, num(a.followers_count)), h("span", {}, "followers")),
        h("div", {}, h("b", {}, growth == null ? "–" : `${growth >= 0 ? "+" : ""}${num(growth)}`), h("span", {}, days.length > 1 ? `since ${days[0][0]}` : "growth (from today)")),
        h("div", {}, h("b", {}, num(a.media_count)), h("span", {}, "posts")))),
    h("div", { class: "card" },
      h("h2", {}, "Reels"),
      h("p", { class: "hint" }, "Saves and shares as a share of views are what Instagram rewards most; watch time tells you if the hook and pace hold. Each reel's numbers also go into its results, which new scripts learn from."),
      rows.length
        ? h("table", { class: "igTable" }, h("thead", {}, h("tr", {}, ...["Reel", "Posted", "Views", "Reach", "Likes", "Comments", "Saves", "Shares", "Avg watch"].map((t) => h("th", {}, t)))), h("tbody", {}, ...rows))
        : h("p", { class: "muted" }, "No posts yet. Once you post, Sync now (or wait: it syncs every 3 hours).")),
  );
}

const GROUPS = { layout: "Layouts and set pieces", text: "Typography", camera: "Camera", transition: "Transitions", ending: "Endings" };
const RATINGS = [["like", "👍 Like"], ["trial", "🧪 Trial"], ["ok", "Okay"], ["dislike", "👎 Never"]];
let motionPoll = null;

async function showMotions() {
  show("motionsView");
  const { motions, job } = await api("/api/motions");
  const running = job.state === "running";
  $("#motionPreviewsBtn").disabled = running;
  $("#motionMsg").textContent = running ? job.log.at(-1) ?? "Rendering previews…" : job.state === "error" ? `Previews failed: ${job.error}` : "";
  clearTimeout(motionPoll);
  if (running) motionPoll = setTimeout(() => !$("#motionsView").hidden && showMotions(), 4000);
  const learned = motions.filter((m) => m.learned);
  const fresh = motions.filter((m) => !m.builtIn && !m.learned);
  const sections = [
    ["Learned from your reels (not used until you rate them)", learned],
    ["Hand-made (on trial until you rate them)", fresh],
    ...Object.entries(GROUPS).map(([g, title]) => [title, motions.filter((m) => m.builtIn && m.group === g)])];
  $("#motionList").replaceChildren(
    ...sections.filter(([, list]) => list.length).flatMap(([title, list]) => [h("h2", {}, title), h("div", { class: "motionGrid" }, ...list.map(motionCard))]),
  );
}

function motionCard(m) {
  const video = m.preview
    ? h("video", { src: `${m.preview}#t=1.5`, controls: "", playsinline: "", preload: "metadata" })
    : h("div", { class: "motionEmpty muted" }, "No preview yet");
  const buttons = RATINGS.filter(([r]) => !(r === "ok" && !m.builtIn) && !(r === "trial" && m.builtIn)).map(([r, label]) => {
    const b = h("button", { class: m.rating === r ? "primary" : "" }, label);
    b.onclick = async () => {
      await api(`/api/motions/${m.id}`, { method: "PUT", body: JSON.stringify({ rating: r }) });
      showMotions();
    };
    return b;
  });
  video.addEventListener?.("play", () => $$("#motionList video").forEach((v) => v !== video && v.pause()));
  return h("div", { class: `card motionCard ${m.rating}` }, video,
    h("h3", {}, m.name, m.rating === "new" ? h("span", { class: "chip ok" }, " new") : null),
    m.source ? h("p", { class: "hint" }, `From "${m.source.styleName}"`) : null,
    h("p", { class: "muted" }, m.when),
    h("p", { class: "hint" }, `Switch on: ${m.use}`),
    h("div", { class: "row" }, ...buttons));
}

$("#motionPreviewsBtn").onclick = async () => {
  await api("/api/motions/previews", { method: "POST" });
  showMotions();
};

async function showStyles() {
  show("stylesView");
  const styles = await api("/api/styles");
  $("#stylesList").replaceChildren(
    styles.length ? h("h2", {}, `Learned styles (${styles.length})`) : h("p", { class: "muted" }, "No styles learned yet."),
    ...styles.map(styleCard),
  );
}

function styleCard(s) {
  const c = s.card;
  const chip = (text, cls = "") => h("span", { class: `chip ${cls}` }, text);
  const build = c.worth_building ?? [];
  const task = () =>
    `Add these to the reel engine (learned from the style "${s.name}"):\n` + build.map((m) => `- ${m.title}: ${m.description} (why: ${m.why_it_fits})`).join("\n");
  return h(
    "div",
    { class: "card style-card" },
    h(
      "div",
      { class: "row between" },
      h("div", {}, h("h2", {}, s.name), h("div", { class: "muted" }, c.summary)),
      h(
        "div",
        { class: "row" },
        h(
          "label",
          { class: "inline" },
          h("input", { type: "checkbox", checked: s.active, onchange: (e) => api(`/api/styles/${s.id}`, { method: "PATCH", body: JSON.stringify({ active: e.target.checked }) }) }),
          " Use in new reels",
        ),
        h("button", { class: "small", onclick: async () => confirm(`Delete the style "${s.name}"?`) && (await api(`/api/styles/${s.id}`, { method: "DELETE" }), showStyles()) }, "Delete"),
      ),
    ),
    h("div", { class: "hint" }, `Used in ${s.uses ?? 0} reel(s)${s.source?.link ? ` · ${s.source.link}` : ""}`),
    h("div", { class: "swatches" }, ...c.colors.palettes.map((p) => {
      const hx = (v) => String(v ?? "").match(/#[0-9a-f]{6}/i)?.[0] ?? "#888";
      return h("span", { class: "sw", style: `background:${hx(p.bg)};color:${hx(p.accent)}`, title: p.name }, "Aa");
    })),
    h("div", { class: "chips" }, ...c.typography.fonts.map((f) => chip(`${f.role}: ${f.closest_ours}${f.google_font && !f.google_font.startsWith(f.closest_ours) ? ` (source ≈ ${f.google_font})` : ""}`))),
    h(
      "details",
      {},
      h("summary", {}, "What it learned"),
      h("p", {}, h("b", {}, "Typography: "), `${c.typography.layout} ${c.typography.effects} ${c.typography.animation}`),
      h("p", {}, h("b", {}, "Colours: "), c.colors.usage),
      h("p", {}, h("b", {}, "Devices: ")),
      h("ul", {}, ...c.visual_devices.map((d) => h("li", {}, chip(d.engine, d.engine === "have" ? "good" : d.engine === "partial" ? "ok" : "low"), ` ${d.name}: ${d.how} (${d.when})`))),
      h("p", {}, h("b", {}, "Transitions: "), c.transitions.map((t) => `${t.name} (${t.timing})`).join("; ")),
      h("p", {}, h("b", {}, "Pacing: "), `~${c.pacing.avg_shot_seconds}s per shot, ${c.pacing.words_per_second} words/s. ${c.pacing.notes}`),
      h("p", {}, h("b", {}, "Sound: "), `${c.sound.music} ${c.sound.voice} ${c.sound.notes}`),
      h("ul", {}, ...c.sound.sfx_rules.map((r) => h("li", {}, `${r.event.replace("_", " ")} → ${r.sound}: ${r.how}`))),
      h("p", {}, h("b", {}, "Script: "), `Hook: ${c.script.hook}. Structure: ${c.script.structure}. CTA: ${c.script.cta}. Tone: ${c.script.tone}`),
      ...(s.sheets ?? []).slice(0, 1).map((f) => h("img", { src: `/styles/${s.id}/${f}`, class: "sheet", alt: "Frames" })),
    ),
    build.length
      ? h(
          "details",
          {},
          h("summary", {}, `Worth building for your reels (${build.length})`),
          h("ul", {}, ...build.map((m) => h("li", {}, h("b", {}, `${m.title}: `), m.description, h("div", { class: "hint" }, m.why_it_fits)))),
          h("button", { class: "small", onclick: (e) => buildStyleMotions(s, e.target) }, "🎬 Build these into the Motion library"),
          h("button", { class: "small", onclick: async (e) => (await navigator.clipboard.writeText(task()), (e.target.textContent = "Copied, paste it to Claude Code")) }, "Copy as a task for Claude Code"),
        )
      : null,
  );
}

async function buildStyleMotions(s, btn) {
  setBusy(btn, true, "Building…");
  try {
    const { id } = await api(`/api/styles/${s.id}/motions`, { method: "POST" });
    for (;;) {
      await new Promise((r) => setTimeout(r, 3000));
      const job = await api(`/api/styles/learn/${id}`);
      if (job.state === "error") throw new Error(job.error);
      if (job.state === "done") {
        const n = job.motions?.length ?? 0;
        btn.textContent = n ? `Added ${n} to the Motion library` : "None came out well enough (see the log)";
        break;
      }
      btn.textContent = job.step;
    }
  } catch (err) {
    btn.textContent = `Failed: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

$("#learnForm").onsubmit = async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector("button");
  setBusy(btn, true, "Learning...");
  $("#learnMsg").textContent = "Uploading...";
  try {
    const { id } = await api("/api/styles/learn", { method: "POST", body: new FormData(form) });
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const job = await api(`/api/styles/learn/${id}`);
      if (job.state === "error") throw new Error(job.error);
      if (job.state === "done") {
        form.reset();
        const n = job.motions?.length ?? 0;
        $("#learnMsg").textContent = `Learned. It's in the list below and will be used in new reels.${n ? ` ${n} new motion${n > 1 ? "s" : ""} added to the Motion library: watch and rate them there.` : ""}`;
        break;
      }
      $("#learnMsg").textContent = `${job.step} (studying takes 2-5 min; building its motions another 5-15)`;
    }
    showStyles();
  } catch (err) {
    $("#learnMsg").innerHTML = errorHtml(err);
  } finally {
    setBusy(btn, false, "🎓 Learn this style");
  }
};
$("#ideasBtn").onclick = getIdeas;
$("#copyIdeasPrompt").onclick = async (e) => {
  const { prompt } = await post("/api/prompt", { kind: "ideas", format: "editorial" });
  await navigator.clipboard.writeText(prompt);
  flash(e.target, "Copied!");
};
$("#importIdeas").onclick = () => importReply($("#ideasReply"), $("#newMsg"));
$("#importBtn").onclick = () => importReply($("#reply"), $("#manualMsg"));
$("#createOwn").onclick = (e) => createReel({ topic: $("#topic").value.trim() }, e.target);
$("#topic").addEventListener("keydown", (e) => e.key === "Enter" && createReel({ topic: $("#topic").value.trim() }));
$("#saveBtn").onclick = async () => {
  try {
    await save();
    $("#stepLine").textContent = "Saved.";
  } catch (err) {
    $("#stepLine").innerHTML = errorHtml(err);
  }
};
$("#buildBtn").onclick = build;
$("#davinciBtn").onclick = async () => {
  setBusy($("#davinciBtn"), true, "Exporting...");
  try {
    await save();
    await post(`/api/packs/${current.slug}/davinci`);
    startPolling();
  } catch (err) {
    $("#stepLine").innerHTML = errorHtml(err);
  } finally {
    setBusy($("#davinciBtn"), false, "Export for DaVinci");
  }
};
$("#selfCheckBtn").onclick = async () => {
  try {
    await save();
    await post(`/api/packs/${current.slug}/selfcheck`);
    startPolling();
  } catch (err) {
    $("#stepLine").innerHTML = errorHtml(err);
  }
};
$("#finalVoiceBtn").onclick = async () => {
  const chars = current.finalVoice?.chars ?? 0;
  if (!confirm(`Record the final voice with ElevenLabs?\n\nThis uses about ${chars} credits. Only do it when the script is final: any later change to the lines needs a new recording.`)) return;
  try {
    await save();
    await post(`/api/packs/${current.slug}/build`, { final: true });
    startPolling();
  } catch (err) {
    $("#stepLine").innerHTML = errorHtml(err);
  }
};
$("#polishBtn").onclick = async () => {
  setBusy($("#polishBtn"), true, "Polishing...");
  try {
    await save();
    await post(`/api/packs/${current.slug}/polish`);
    startPolling();
  } catch (err) {
    $("#stepLine").innerHTML = errorHtml(err);
  } finally {
    setBusy($("#polishBtn"), false, "✍️ Polish script");
  }
};
$("#applyJson").onclick = applyJson;

loadHealth();
let LAYOUTS = ["auto", "sandwich", "side", "hero", "float", "edge", "cards", "closeup", "slider", "verdict", "zoom", "scale", "duo", "mosaic", "corner", "dm"];
api("/api/layouts").then((l) => (LAYOUTS = l)).catch(() => {});
showHome();

$("#copyCaptionBtn").onclick = async () => {
  const text = `${$("#caption").value.trim()}\n\n${$("#hashtags").value.trim()}`;
  await navigator.clipboard.writeText(text);
  $("#captionMsg").textContent = "Copied. Paste it into Instagram.";
};
$("#rewriteCaptionBtn").onclick = async () => {
  if (!current) return;
  $("#captionMsg").textContent = "Writing…";
  $("#rewriteCaptionBtn").disabled = true;
  try {
    const out = await api(`/api/packs/${current.slug}/caption`, { method: "POST", body: JSON.stringify({ notes: $("#captionNotes").value }) });
    $("#caption").value = out.caption;
    $("#hashtags").value = out.hashtags.join(" ");
    current.script.caption = out.caption;
    current.script.hashtags = out.hashtags;
    $("#captionMsg").textContent = "New caption saved.";
  } catch (err) {
    $("#captionMsg").innerHTML = errorHtml(err);
  } finally {
    $("#rewriteCaptionBtn").disabled = false;
  }
};

$("#aestheticBtn").onclick = showAesthetic;

async function showAesthetic() {
  show("aestheticView");
  const [packs, settings] = await Promise.all([api("/api/packs"), api("/api/aesthetic/settings")]);
  $("#aesSeries").value = settings.series ?? "";
  $("#aesSignoff").value = settings.signoff ?? "";
  const mine = packs.filter((p) => p.format === "aesthetic");
  $("#aestheticList").replaceChildren(
    h("h2", {}, mine.length ? `Your aesthetic reels (${mine.length})` : "No aesthetic reels yet"),
    ...mine.map((p) => h("div", { class: "card row between" }, h("div", {}, h("b", {}, p.title), h("div", { class: "hint" }, p.topic ?? "")), h("button", { onclick: () => openPack(p.slug) }, "Open"))),
  );
}

$("#aestheticForm").onsubmit = async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector("button");
  const topic = form.topic.value.trim();
  if (!topic) return;
  setBusy(btn, true, "Writing...");
  try {
    const { id } = await post("/api/create", { topic, notes: form.notes.value.trim(), format: "aesthetic" });
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const job = await api(`/api/create/${id}`);
      if (job.state === "error") throw new Error(job.error);
      if (job.state === "done") {
        $("#aestheticMsg").textContent = "";
        form.reset();
        return await openPack(job.slug);
      }
      $("#aestheticMsg").textContent = `Writing the script (usually 1-3 min). Nothing is generated until you approve it.`;
    }
  } catch (err) {
    $("#aestheticMsg").innerHTML = errorHtml(err);
  } finally {
    setBusy(btn, false, "Write the script");
  }
};

$("#aesSave").onclick = async () => {
  await api("/api/aesthetic/settings", { method: "PUT", body: JSON.stringify({ series: $("#aesSeries").value, signoff: $("#aesSignoff").value }) });
  $("#aesSettingsMsg").textContent = "Saved. New scripts use these.";
};

function renderAesthetic(s) {
  const outfits = (s.outfits ?? []).map((o) => h("li", {}, h("b", {}, o.key.replace(/_/g, " ")), `: ${o.description}`));
  const items = (s.items ?? []).map((o) => h("li", {}, h("b", {}, o.label), `: ${o.description}`));
  const rows = (s.scenes ?? []).map((sc, i) =>
    h("tr", {},
      h("td", {}, String(i + 1)),
      h("td", {}, sc.type),
      h("td", {}, sc.lines.map((l) => s.lines[l]?.voiceover).join(" ")),
      h("td", { class: "hint" }, [sc.title, sc.outfit && `outfit: ${sc.outfit}${sc.outfit2 ? ` vs ${sc.outfit2}` : ""}`, ...(sc.overlays ?? []).map((o) => `${o.kind}${o.text ? ` "${o.text.replace(/\n/g, " ")}"` : ""} on "${o.at_word}"`)].filter(Boolean).join(" · ")),
    ),
  );
  $("#editor").replaceChildren(
    h("div", { class: "card" },
      h("h2", {}, "The plan"),
      h("p", {}, h("b", {}, "The model: "), s.model?.description ?? ""),
      h("details", {}, h("summary", {}, `Outfits (${outfits.length}) and products (${items.length})`), h("ul", {}, ...outfits), h("ul", {}, ...items)),
      h("p", { class: "hint" }, "Images: upload your Gemini/ChatGPT images in the Images panel (prompts there, or the Image prompts file). Make the first outfit first; attach it as the reference for every other outfit so it's the same man. Real photos and clips: the Photos & clips panel. Shared chapter footage: drop named clips in assets/broll."),
      h("table", { class: "lines" }, h("tr", {}, h("th", {}, "#"), h("th", {}, "Scene"), h("th", {}, "Voice"), h("th", {}, "On screen")), ...rows),
    ),
  );
}
