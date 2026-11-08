// Reusable intro and outro templates. They are generated from the channel config + style on every
// build (no per-episode design work) and their key moments land on the detected beats of your songs.
import { MOTION_JS } from "./motion.mjs";
import { escapeHtml } from "./util.mjs";
import { hexA } from "./css.mjs";

/** Pick `n` event times inside [a, b] using the beat grid, falling back to even spacing. */
export function beatSlots(beats, a, b, n) {
  if (n <= 0) return [];
  const inside = beats.filter((t) => t >= a && t <= b);
  if (inside.length >= n) {
    const step = inside.length / n;
    return Array.from({ length: n }, (_, i) => inside[Math.floor(i * step)]);
  }
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / Math.max(1, n - 1 || 1));
}

const ACCENTS = ["accent", "accent2", "accent3", "accent4"];

function common(style, W, H, id) {
  const s = style.shape;
  const c = style.colors;
  const border = s.border ? `${s.border}px solid ${c.ink}` : "none";
  const shadow = s.shadow === "none" ? "none" : `${s.shadowX}px ${s.shadowY}px ${s.shadowBlur}px ${c[s.shadow] || s.shadow}`;
  const bgPattern =
    style.background.kind === "dots" ? `background-image: radial-gradient(${hexA(c.ink, style.background.opacity)} 2.2px, transparent 2.6px); background-size: ${style.background.size}px ${style.background.size}px;` :
    style.background.kind === "grid" ? `background-image: linear-gradient(${hexA(c.ink, style.background.opacity)} 1px, transparent 1px), linear-gradient(90deg, ${hexA(c.ink, style.background.opacity)} 1px, transparent 1px); background-size: ${style.background.size}px ${style.background.size}px;` :
    style.background.kind === "vignette" ? `background-image: radial-gradient(ellipse at 50% 45%, ${c.paper} 0%, ${c.bg} 72%);` : "";
  return `
    #${id}-root { position: absolute; inset: 0; overflow: hidden; background: ${c.bg}; color: ${c.ink}; font-family: '${style.fonts.body}'; }
    #${id}-root .g { position: absolute; inset: 0; ${bgPattern} }
    #${id}-root .tile { position: absolute; display: flex; flex-direction: column; justify-content: space-between; padding: 22px 28px; background: ${c.paper}; border: ${border}; box-shadow: ${shadow}; border-radius: ${s.radius}px; }
    #${id}-root .tile .ix { font-family: '${style.fonts.mono}'; font-size: 28px; letter-spacing: 0.2em; color: ${c.ink}; opacity: 0.72; }
    #${id}-root .tile .wd { font-family: '${style.fonts.display}'; font-size: 58px; line-height: 1; letter-spacing: -0.01em; text-transform: uppercase; }
    #${id}-root .mark { position: absolute; left: 0; right: 0; display: flex; justify-content: center; gap: 10px; }
    #${id}-root .mark .ch { display: inline-block; font-family: '${style.fonts.display}'; font-size: var(--mark-size, ${Math.round(W / 9.5)}px); line-height: 1; padding: 8px 18px 16px; background: ${c.paper}; border: ${border}; box-shadow: ${shadow}; border-radius: ${s.radius}px; text-transform: uppercase; }
    #${id}-root .mark .sp { width: 40px; }
    #${id}-root .tag { position: absolute; left: 0; right: 0; display: flex; justify-content: center; font-family: '${style.fonts.mono}'; font-size: 36px; letter-spacing: 0.08em; }
    #${id}-root .tag .c { display: inline-block; white-space: pre; }
    #${id}-root .ep { position: absolute; left: 0; right: 0; display: flex; justify-content: center; }
    #${id}-root .ep span { font-family: '${style.fonts.mono}'; font-size: 30px; letter-spacing: 0.2em; text-transform: uppercase; padding: 10px 20px; background: ${c.accent}; color: ${c.ink}; border: ${border}; border-radius: ${s.radius}px; }
    #${id}-root .wipe { position: absolute; left: 0; width: ${W}px; background: ${c.accent}; ${s.border ? `border-top: ${s.border}px solid ${c.ink}; border-bottom: ${s.border}px solid ${c.ink};` : ""} }
    #${id}-root .bar { position: absolute; left: 0; width: ${W}px; height: ${Math.round(H * (style.letterbox || 0))}px; background: #000; }
  `;
}

/** Size the wordmark so every letter tile fits inside 88% of the frame width. */
export function markSize(name, W) {
  const chars = [...name].filter((c) => c !== " ").length;
  const spaces = [...name].length - chars;
  // each tile ≈ 0.78em glyph + 36px padding/border + 10px gap; spaces 40px
  const avail = W * 0.88 - spaces * 50;
  return Math.max(48, Math.min(Math.round(W / 9.5), Math.floor((avail / Math.max(1, chars) - 46) / 0.78)));
}

function markHtml(name, id) {
  return [...name].map((ch, i) => (ch === " " ? `<span class="sp"></span>` : `<span class="ch" id="${id}-ch${i}">${escapeHtml(ch)}</span>`)).join("");
}

export function introComposition({ style, cfg, duration, beats, episodeLabel }) {
  const W = cfg.format.width;
  const H = cfg.format.height;
  const id = "intro";
  const topics = (cfg.intro.topics || []).slice(0, 6);
  const name = cfg.channel.name || "Channel";
  const tagline = cfg.channel.tagline || "";
  const D = duration;
  const tileW = 470;
  const tileH = 190;
  const gap = 46;
  const cols = 3;
  const rows = Math.ceil(topics.length / cols) || 1;
  const gx = (W - (cols * tileW + (cols - 1) * gap)) / 2;
  const gy = (H - (rows * tileH + (rows - 1) * gap)) / 2;
  const tiles = topics.map((t, i) => {
    const x = gx + (i % cols) * (tileW + gap);
    const y = gy + Math.floor(i / cols) * (tileH + gap);
    const acc = style.colors[ACCENTS[i % 4]];
    return `<div class="tile" id="${id}-t${i}" style="left:${x}px;top:${y}px;width:${tileW}px;height:${tileH}px;background:${i % 2 ? style.colors.paper : acc}"><span class="ix">${String(i + 1).padStart(2, "0")}</span><span class="wd" style="font-size:${Math.min(58, Math.floor((tileW - 60) / (t.length * 0.74)))}px;white-space:nowrap">${escapeHtml(t)}</span></div>`;
  });
  // phases on the beat grid
  const tileTimes = beatSlots(beats, 0.15, D * 0.42, topics.length);
  const letters = [...name].filter((c) => c !== " ").length;
  const markTimes = beatSlots(beats, D * 0.46, D * 0.68, Math.min(letters, 14));
  const tagStart = D * 0.7;
  const epTime = beatSlots(beats, D * 0.84, D * 0.9, 1)[0] ?? D * 0.86;
  const markIds = [...name].map((c, i) => (c === " " ? null : `#${id}-ch${i}`)).filter(Boolean);
  const lb = Math.round(H * (style.letterbox || 0));
  const enter = style.motion.enter;
  return `<template>
  <style>${common(style, W, H, id)}</style>
  <div id="${id}-root" data-composition-id="${id}" data-width="${W}" data-height="${H}">
    <div class="g"></div>
    ${tiles.join("\n    ")}
    <div class="mark" id="${id}-mark" style="top:${H * 0.32}px;--mark-size:${markSize(name, W)}px">${markHtml(name, id)}</div>
    <div class="tag" id="${id}-tag" style="top:${H * 0.58}px">${[...tagline].map((ch, i) => `<span class="c" id="${id}-c${i}">${escapeHtml(ch)}</span>`).join("")}</div>
    ${episodeLabel ? `<div class="ep" id="${id}-ep" style="top:${H * 0.7}px"><span>${escapeHtml(episodeLabel)}</span></div>` : ""}
    <div class="wipe" id="${id}-w1" style="top:0;height:${H / 2}px"></div>
    <div class="wipe" id="${id}-w2" style="top:${H / 2}px;height:${H / 2}px"></div>
    ${lb ? `<div class="bar" style="top:0"></div><div class="bar" style="top:${H - lb}px"></div>` : ""}
  </div>
  <script>
    ${MOTION_JS}
    const tl = gsap.timeline({ paused: true });
    const D = ${D};
    const tileTimes = ${JSON.stringify(tileTimes)};
    const markTimes = ${JSON.stringify(markTimes)};
    const marks = ${JSON.stringify(markIds)};
    tl.set("#${id}-w1, #${id}-w2", { x: ${W} }, 0);
    // tile 0 is on screen from frame 0 (frame 0 is the thumbnail on social players)
    tileTimes.forEach((t, i) => { if (i) __in(tl, "#${id}-t" + i, t, "${enter}", 0.9); });
    // tiles leave as the wordmark builds: the topics "become" the channel
    tl.to(${JSON.stringify(topics.map((_, i) => `#${id}-t${i}`))}, { y: ${-H}, rotation: -8, opacity: 0, duration: 0.45, stagger: 0.035, ease: "power3.in" }, Math.max(0, (markTimes[0] ?? D * 0.46) - 0.4));
    marks.forEach((m, i) => {
      const t = markTimes[Math.min(i, markTimes.length - 1)] + (i >= markTimes.length ? (i - markTimes.length + 1) * 0.05 : 0);
      __in(tl, m, t, "${enter === "slow-fade" ? "slow-fade" : "slam"}", 0.8);
    });
    const tagChars = ${[...tagline].length};
    for (let i = 0; i < tagChars; i++) tl.fromTo("#${id}-c" + i, { opacity: 0 }, { opacity: 1, duration: 0.01 }, ${tagStart} + i * Math.min(0.045, ${Math.max(0.5, D * 0.12)} / Math.max(1, tagChars)));
    ${episodeLabel ? `__in(tl, "#${id}-ep", ${epTime}, "stamp", 1);` : ""}
    // exit: two bands close over the frame on the last beat, handing over to the episode
    tl.fromTo("#${id}-w1", { x: ${-W} }, { x: 0, duration: 0.3, ease: "power3.in" }, D - 0.55);
    tl.fromTo("#${id}-w2", { x: ${W} }, { x: 0, duration: 0.3, ease: "power3.in" }, D - 0.5);
    tl.to("#${id}-w1, #${id}-w2", { opacity: 0, duration: 0.18 }, D - 0.2);
    window.__timelines["${id}"] = tl;
  </script>
</template>
`;
}

export function outroComposition({ style, cfg, duration, beats, nextLabel }) {
  const W = cfg.format.width;
  const H = cfg.format.height;
  const id = "outro";
  const D = duration;
  const name = cfg.channel.name || "Channel";
  const lines = (cfg.outro.lines || []).slice(0, 4);
  if (nextLabel) lines.push(nextLabel);
  const cards = lines.map((l, i) => {
    const acc = style.colors[ACCENTS[(i + 1) % 4]];
    const y = H * 0.24 + i * 150;
    return `<div class="tile" id="${id}-l${i}" style="left:${W * 0.5 - 520 + (i % 2 ? 70 : 0)}px;top:${y}px;width:1040px;height:118px;flex-direction:row;align-items:center;gap:26px;background:${i % 2 ? style.colors.paper : acc}"><span class="ix">${String(i + 1).padStart(2, "0")}</span><span class="wd" style="font-size:52px">${escapeHtml(l)}</span></div>`;
  });
  const lineTimes = beatSlots(beats, 0.4, D * 0.5, lines.length);
  const signT = beatSlots(beats, D * 0.58, D * 0.72, 1)[0] ?? D * 0.62;
  const lb = Math.round(H * (style.letterbox || 0));
  const tagline = cfg.channel.tagline || "";
  return `<template>
  <style>${common(style, W, H, id)}
    #${id}-root .kick { position: absolute; left: 0; right: 0; top: ${H * 0.1 + lb}px; text-align: center; font-family: '${style.fonts.mono}'; font-size: 30px; letter-spacing: 0.3em; text-transform: uppercase; color: ${style.colors.muted}; }
    #${id}-root .fade { position: absolute; inset: 0; background: ${style.colors.bg}; }
  </style>
  <div id="${id}-root" data-composition-id="${id}" data-width="${W}" data-height="${H}">
    <div class="g"></div>
    <div class="kick" id="${id}-kick">${escapeHtml(cfg.channel.series || name)}</div>
    ${cards.join("\n    ")}
    <div class="mark" id="${id}-mark" style="top:${H * 0.36}px;--mark-size:${markSize(name, W)}px">${markHtml(name, id)}</div>
    <div class="tag" id="${id}-tag" style="top:${H * 0.62}px"><span class="c">${escapeHtml(tagline)}</span></div>
    <div class="fade" id="${id}-fade"></div>
    ${lb ? `<div class="bar" style="top:0"></div><div class="bar" style="top:${H - lb}px"></div>` : ""}
  </div>
  <script>
    ${MOTION_JS}
    const tl = gsap.timeline({ paused: true });
    const D = ${D};
    const lineTimes = ${JSON.stringify(lineTimes)};
    const marks = ${JSON.stringify([...name].map((c, i) => (c === " " ? null : `#${id}-ch${i}`)).filter(Boolean))};
    tl.fromTo("#${id}-fade", { opacity: 1 }, { opacity: 0, duration: 0.6, ease: "power1.out" }, 0);
    __in(tl, "#${id}-kick", 0.2, "fade-rise", 1);
    lineTimes.forEach((t, i) => __in(tl, "#${id}-l" + i, t, "${style.motion.enter}", 0.9));
    // the notes fall away and the wordmark signs off on a strong beat
    tl.to(${JSON.stringify(lines.map((_, i) => `#${id}-l${i}`))}, { y: ${H}, rotation: 6, opacity: 0, duration: 0.5, stagger: 0.05, ease: "power3.in" }, ${signT} - 0.55);
    marks.forEach((m, i) => __in(tl, m, ${signT} + i * 0.035, "${style.motion.enter === "slow-fade" ? "slow-fade" : "slam"}", 0.8));
    __in(tl, "#${id}-tag", ${signT} + 0.6, "fade-rise", 1);
    tl.to("#${id}-fade", { opacity: 1, duration: Math.min(1.6, D * 0.18), ease: "power1.in" }, D - Math.min(1.6, D * 0.18) - 0.05);
    window.__timelines["${id}"] = tl;
  </script>
</template>
`;
}
