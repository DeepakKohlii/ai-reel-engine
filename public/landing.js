const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const beats = [
  { bg: "#efe2cc", ink: "#16130f", accent: "#8a5a2b", lines: [["s", "STOP WEARING"], ["i", "brown"], ["c", "WITH BLACK"]] },
  { bg: "#2b3a67", ink: "#f4efe6", accent: "#d8c7a6", lines: [["s", "wear it with"], ["i", "these"]], swatches: ["#efe2cc", "#7d8b6a", "#16130f"] },
  { bg: "#c4532d", ink: "#f4efe6", accent: "#16130f", lines: [["s", "the 3-colour"], ["c", "RULE"], ["k", "SAVE THIS"]] },
  { bg: "#16130f", ink: "#f4efe6", accent: "#c4532d", lines: [["s", "comment"], ["c", "LIST"], ["i", "for all"], ["s", "7 FITS"]] },
];
let beatN = 0;
function playBeat() {
  const b = beats[beatN % beats.length];
  const i = beatN % beats.length;
  const screen = $("#screen");
  screen.style.background = b.bg;
  screen.style.color = b.ink;
  screen.style.setProperty("--accent", b.accent);
  $("#beat").innerHTML = b.lines.map(([k, t], j) => `<div class="w w-${k}" style="animation-delay:${0.15 + j * 0.32}s">${t}</div>`).join("");
  $("#swatches").innerHTML = (b.swatches || []).map((c, j) => `<i style="background:${c};animation-delay:${0.7 + j * 0.14}s"></i>`).join("");
  $$("#bars i").forEach((el, j) => (el.className = j < i ? "done" : j === i ? "on" : ""));
  beatN++;
}
playBeat();
setInterval(playBeat, 2800);

const words = ["finished", "post-ready", "polished", "on-brand"];
let wordN = 0;
setInterval(() => {
  const span = $("#rotator span");
  span.classList.add("out");
  setTimeout(() => {
    wordN = (wordN + 1) % words.length;
    span.textContent = words[wordN];
    span.classList.remove("out");
    span.classList.remove("in");
    void span.offsetWidth;
    span.classList.add("in");
  }, 450);
}, 2600);

const tilt = $("#tilt");
if (!reduce && matchMedia("(pointer: fine)").matches) {
  addEventListener("mousemove", (e) => {
    const x = e.clientX / innerWidth - 0.5;
    const y = e.clientY / innerHeight - 0.5;
    tilt.style.transform = `rotateY(${x * 14}deg) rotateX(${-y * 10}deg)`;
  });
  $$(".magnetic").forEach((el) => {
    el.addEventListener("mousemove", (e) => {
      const r = el.getBoundingClientRect();
      el.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.2}px, ${(e.clientY - r.top - r.height / 2) * 0.3}px)`;
    });
    el.addEventListener("mouseleave", () => (el.style.transform = ""));
  });
}

const groups = new Map();
$$(".reveal").forEach((el) => {
  const p = el.parentElement;
  const n = groups.get(p) ?? 0;
  groups.set(p, n + 1);
  el.style.setProperty("--rd", `${Math.min(n, 6) * 0.08}s`);
});
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("in");
      io.unobserve(e.target);
      const count = $("[data-count]", e.target);
      if (count) countUp(count);
      if (e.target.id === "terminal") typeTerminal();
    }
  },
  { threshold: 0.18, rootMargin: "0px 0px -6% 0px" },
);
$$(".reveal").forEach((el) => io.observe(el));

function countUp(el) {
  const end = Number(el.dataset.count);
  const t0 = performance.now();
  const dur = 1400;
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const script = [
  ["dim", "# clone and install"],
  ["cmd", "git clone https://github.com/DeepakKohlii/ai-reel-engine.git"],
  ["cmd", "cd ai-reel-engine"],
  ["cmd", "npm install"],
  ["", ""],
  ["dim", "# start, then open http://localhost:4747"],
  ["cmd", "npm start"],
];
let typed = false;
async function typeTerminal() {
  if (typed) return;
  typed = true;
  const pre = $("#termText");
  const caret = '<span class="caret"></span>';
  let html = "";
  for (const [kind, text] of script) {
    const prefix = kind === "cmd" ? '<span class="pr">$</span> ' : "";
    const open = kind === "dim" ? '<span class="dim">' : "";
    const close = kind === "dim" ? "</span>" : "";
    if (reduce) {
      html += prefix + open + text + close + "\n";
      continue;
    }
    for (let i = 0; i <= text.length; i++) {
      pre.innerHTML = html + prefix + open + text.slice(0, i) + close + caret;
      await new Promise((r) => setTimeout(r, kind === "cmd" ? 22 : 10));
    }
    html += prefix + open + text + close + "\n";
    await new Promise((r) => setTimeout(r, 180));
  }
  pre.innerHTML = html + '<span class="pr">$</span> ' + caret;
}
$("#copy").onclick = async () => {
  await navigator.clipboard.writeText(script.filter(([k]) => k === "cmd").map(([, t]) => t).join("\n"));
  $("#copy").textContent = "Copied";
  setTimeout(() => ($("#copy").textContent = "Copy"), 1600);
};

$$(".qa button").forEach((b) => (b.onclick = () => b.parentElement.classList.toggle("open")));

const nav = $("#nav");
const bar = $("#progress");
const steps = $$(".step");
const rail = $("#railFill");
const hs = $("#hscroll");
const strip = $("#hstrip");
function onScroll() {
  const y = scrollY;
  const max = document.documentElement.scrollHeight - innerHeight;
  bar.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
  nav.classList.toggle("solid", y > 30);

  const mid = innerHeight * 0.55;
  let active = 0;
  steps.forEach((s, i) => {
    if (s.getBoundingClientRect().top < mid) active = i;
  });
  steps.forEach((s, i) => s.classList.toggle("active", i === active));
  const first = steps[0].getBoundingClientRect().top;
  const last = steps[steps.length - 1].getBoundingClientRect().top;
  rail.style.transform = `scaleX(${Math.max(0, Math.min(1, (mid - first) / (last - first || 1)))})`;

  if (!reduce) {
    const r = hs.getBoundingClientRect();
    const span = hs.offsetHeight - innerHeight;
    const p = Math.max(0, Math.min(1, -r.top / (span || 1)));
    const dist = strip.scrollWidth - innerWidth;
    strip.style.transform = `translateX(${-p * Math.max(0, dist)}px)`;
  }
}
addEventListener("scroll", () => requestAnimationFrame(onScroll), { passive: true });
function sizeStrip() {
  if (reduce) return;
  const dist = Math.max(0, strip.scrollWidth - innerWidth);
  hs.style.height = dist ? `${innerHeight + dist * 1.3}px` : "auto";
  onScroll();
}
addEventListener("resize", sizeStrip);
sizeStrip();
