// Reusable intro and outro. Generated from the channel config + style; every act is placed on the
// detected beats of the creator's own songs, and the logo lock-up lands on the strongest late hit.
// `storycut brand render` renders them once to video files that every episode then reuses.
import { MOTION_JS } from "./motion.mjs";
import { escapeHtml } from "./util.mjs";
import { hexA } from "./css.mjs";
import { decorLayer, decorCss } from "./decor.mjs";
import { longBrand, scenesCss } from "./scenes.mjs";

/** Pick `n` event times inside [a, b] using the beat grid, falling back to even spacing. */
export function beatSlots(beats, a, b, n) {
  if (n <= 0) return [];
  const inside = beats.filter((t) => t >= a && t <= b);
  if (inside.length >= n) {
    const step = inside.length / n;
    return Array.from({ length: n }, (_, i) => inside[Math.floor(i * step)]);
  }
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / Math.max(1, n - 1));
}

/** The musical "hit" for the lock-up: the last strong onset inside [lo, hi] (fallback: last beat there). */
export function findHit(beatInfo, lo, hi) {
  const strong = (beatInfo.onsets || []).filter((t) => t >= lo && t <= hi);
  if (strong.length) return strong.at(-1);
  const beats = (beatInfo.beats || []).filter((t) => t >= lo && t <= hi);
  return beats.length ? beats.at(-1) : (lo + hi) / 2;
}

/** Size the wordmark so every letter key fits inside 86% of the frame width. */
export function markSize(name, W) {
  const chars = [...name].filter((c) => c !== " ").length;
  const spaces = [...name].length - chars;
  const avail = W * 0.86 - spaces * 50;
  return Math.max(48, Math.min(Math.round(W / 9.5), Math.floor((avail / Math.max(1, chars) - 46) / 0.78)));
}

const ACCENTS = ["accent", "accent2", "accent3", "accent4", "accent5"];

function common(style, W, H, id) {
  const s = style.shape;
  const c = style.colors;
  const border = s.border ? `${s.border}px solid ${c.ink}` : "none";
  const shadow = s.shadow === "none" ? "none" : `${s.shadowX}px ${s.shadowY}px ${s.shadowBlur}px ${c[s.shadow] || s.shadow}`;
  const bgPattern =
    style.background.kind === "dots" ? `background-image: radial-gradient(${hexA(c.ink, style.background.opacity)} 2.2px, transparent 2.6px); background-size: ${style.background.size}px ${style.background.size}px;` :
    style.background.kind === "grid" ? `background-image: linear-gradient(${hexA(c.ink, style.background.opacity)} 1px, transparent 1px), linear-gradient(90deg, ${hexA(c.ink, style.background.opacity)} 1px, transparent 1px); background-size: ${style.background.size}px ${style.background.size}px;` :
    style.background.kind === "vignette" ? `background-image: radial-gradient(ellipse at 50% 45%, ${c.paper} 0%, ${c.bg} 72%);` : "";
  const dw = style.fonts.displayWeight || 400;
  return `
    #${id}-root { position: absolute; inset: 0; overflow: hidden; background: ${c.bg}; color: ${c.ink}; font-family: '${style.fonts.body}'; }
    #${id}-root .g { position: absolute; inset: 0; ${bgPattern} }
    #${id}-root .full { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; }
    #${id}-root .tile { position: absolute; display: flex; flex-direction: column; justify-content: space-between; padding: 20px 28px; border: ${border}; box-shadow: ${shadow}; border-radius: ${s.radius}px; }
    #${id}-root .tile .ix { font-family: '${style.fonts.mono}'; font-size: 28px; letter-spacing: 0.2em; color: ${c.ink}; opacity: 0.72; }
    #${id}-root .tile .wd { font-family: '${style.fonts.display}'; font-weight: ${dw}; line-height: 1; text-transform: uppercase; white-space: nowrap; }
    #${id}-root .mark { position: absolute; left: 0; right: 0; display: flex; justify-content: center; gap: 12px; }
    #${id}-root .mark .ch { display: inline-block; font-family: '${style.fonts.display}'; font-weight: ${dw}; font-size: var(--mark-size); line-height: 1; padding: 10px 20px 18px; background: ${c.paper}; border: ${border}; box-shadow: ${shadow}; border-radius: ${s.radius}px; text-transform: uppercase; }
    #${id}-root .mark .sp { width: 44px; }
    #${id}-root .pill { position: absolute; left: 0; right: 0; display: flex; justify-content: center; }
    #${id}-root .pill span { font-family: '${style.fonts.mono}'; font-size: 40px; letter-spacing: 0.06em; padding: 12px 28px; background: ${c.accent}; color: ${c.ink}; border: ${border}; box-shadow: ${shadow}; border-radius: 999px; }
    #${id}-root .win { position: absolute; background: ${c.paper}; border: ${border}; box-shadow: ${shadow}; border-radius: ${s.radius}px; overflow: hidden; }
    #${id}-root .win-bar { display: flex; gap: 14px; align-items: center; height: 70px; padding: 0 26px; border-bottom: ${border}; }
    #${id}-root .win-bar i { display: block; width: 24px; height: 24px; border-radius: 50%; border: 3px solid ${c.ink}; }
    #${id}-root .win-bar i:nth-child(1) { background: ${c.accent2}; } #${id}-root .win-bar i:nth-child(2) { background: ${c.accent}; } #${id}-root .win-bar i:nth-child(3) { background: ${c.accent3}; }
    #${id}-root .addr { flex: 1; margin-left: 18px; height: 40px; border: 3px solid ${c.ink}; border-radius: 999px; }
    #${id}-root .win-body { padding: 44px 56px 52px; font-family: '${style.fonts.mono}'; font-size: 54px; line-height: 1.25; }
    #${id}-root .win-body .c { display: inline-block; white-space: pre; }
    #${id}-root .caret { display: inline-block; width: 26px; height: 58px; margin-left: 6px; vertical-align: -10px; background: ${c.ink}; }
    #${id}-root .wipe { position: absolute; left: 0; width: ${W}px; ${s.border ? `border-top: ${s.border}px solid ${c.ink}; border-bottom: ${s.border}px solid ${c.ink};` : ""} }
    #${id}-root .bar { position: absolute; left: 0; width: ${W}px; height: ${Math.round(H * (style.letterbox || 0))}px; background: #000; }
    ${decorCss()}
  `;
}

function markHtml(name, id) {
  return [...name].map((ch, i) => (ch === " " ? `<span class="sp"></span>` : `<span class="ch" id="${id}-ch${i}">${escapeHtml(ch)}</span>`)).join("");
}

function wipeBands(style, W, H, id, n = 4) {
  return Array.from({ length: n }, (_, b) => `<div class="wipe" id="${id}-w${b}" style="top:${(H / n) * b}px;height:${Math.ceil(H / n)}px;background:${style.colors[ACCENTS[b % ACCENTS.length]] || style.colors.accent}"></div>`).join("\n    ");
}

/**
 * Intro, four acts on the music:
 *  1. curiosity — a browser window types the channel's question (intro.prompt)
 *  2. scope — topic keys (intro.topics) pop on successive beats
 *  3. identity — the keys clear and the wordmark keys cascade in, the last one landing on the hit
 *  4. promise — the tagline pill, a short hold, then colour bands wipe into the episode
 */
export function introComposition({ style, cfg, duration, beatInfo, episodeLabel, hitAt }) {
  if (duration > 25) return longComposition({ style, cfg, duration, beatInfo, kind: "intro" });
  const W = cfg.format.width;
  const H = cfg.format.height;
  const id = "intro";
  const D = duration;
  const beats = beatInfo.beats || [];
  const name = cfg.channel.name || "Channel";
  const tagline = cfg.channel.tagline || "";
  const prompt = cfg.intro.prompt || "";
  const topics = (cfg.intro.topics || []).slice(0, 6);
  const hit = hitAt != null && hitAt > 2 && hitAt < D ? hitAt : findHit(beatInfo, D * 0.6, Math.max(D * 0.6, D - 0.6));
  const actBEnd = Math.max(1.5, hit - 1.35);
  const promptEnd = prompt ? Math.min(actBEnd * 0.42, 2.6) : 0;
  const tileTimes = beatSlots(beats, promptEnd + 0.15, actBEnd - 0.2, topics.length);
  const letters = [...name].filter((c) => c !== " ").length;
  const markStart = actBEnd - 0.05;
  const markTimes = Array.from({ length: letters }, (_, i) => markStart + ((hit - markStart) * (i + 1)) / letters);
  const tileW = 470;
  const tileH = 170;
  const gap = 44;
  const cols = 3;
  const rows = Math.ceil(topics.length / cols) || 1;
  const gx = (W - (cols * tileW + (cols - 1) * gap)) / 2;
  const gy = H * 0.5 - (rows * tileH + (rows - 1) * gap) / 2 + 40;
  const tiles = topics.map((t, i) => {
    const x = gx + (i % cols) * (tileW + gap);
    const y = gy + Math.floor(i / cols) * (tileH + gap);
    const acc = style.colors[ACCENTS[i % ACCENTS.length]] || style.colors.accent;
    const fs = Math.min(60, Math.floor((tileW - 60) / (t.length * 0.74)));
    return `<div class="tile" id="${id}-t${i}" style="left:${x}px;top:${y}px;width:${tileW}px;height:${tileH}px;background:${i % 2 ? style.colors.paper : acc}"><span class="ix">${String(i + 1).padStart(2, "0")}</span><span class="wd" style="font-size:${fs}px">${escapeHtml(t)}</span></div>`;
  });
  const winW = Math.min(1560, 300 + prompt.length * 33);
  const deco = decorLayer({ style, W, H, id: `${id}-decor`, seed: 101, start: 0, duration: D, count: 6, z: 1 });
  const markIds = [...name].map((c, i) => (c === " " ? null : `#${id}-ch${i}`)).filter(Boolean);
  const exitAt = Math.max(hit + 0.6, D - 0.55);
  const pLen = [...prompt].length;
  return `<template>
  <style>${common(style, W, H, id)}</style>
  <div id="${id}-root" data-composition-id="${id}" data-width="${W}" data-height="${H}">
    <div class="g"></div>
    ${deco.html}
    ${prompt ? `<div class="win" id="${id}-win" style="left:${(W - winW) / 2}px;top:${H * 0.33}px;width:${winW}px"><div class="win-bar"><i></i><i></i><i></i><span class="addr"></span></div><div class="win-body">${[...prompt].map((ch, i) => `<span class="c" id="${id}-p${i}">${escapeHtml(ch)}</span>`).join("")}<span class="caret" id="${id}-caret"></span></div></div>` : ""}
    ${tiles.join("\n    ")}
    <div class="mark" id="${id}-mark" style="top:${H * 0.3}px;--mark-size:${markSize(name, W)}px">${markHtml(name, id)}</div>
    ${tagline ? `<div class="pill" id="${id}-tag" style="top:${H * 0.62}px"><span>${escapeHtml(tagline)}</span></div>` : ""}
    ${episodeLabel ? `<div class="pill" id="${id}-ep" style="top:${H * 0.75}px"><span style="background:${style.colors.paper};font-size:30px">${escapeHtml(episodeLabel)}</span></div>` : ""}
    ${wipeBands(style, W, H, id)}
  </div>
  <script>
    ${MOTION_JS}
    const tl = gsap.timeline({ paused: true });
    ${deco.tweens.join("\n    ")}
    for (let b = 0; b < 4; b++) tl.set("#${id}-w" + b, { x: ${W} }, 0);
    ${prompt ? `__in(tl, "#${id}-win", 0.05, "pop", 1);
    for (let i = 0; i < ${pLen}; i++) tl.fromTo("#${id}-p" + i, { opacity: 0 }, { opacity: 1, duration: 0.01 }, 0.35 + i * ${Math.max(0.02, (promptEnd - 0.5) / Math.max(1, pLen)).toFixed(4)});
    for (let k = 0; k < ${Math.ceil((promptEnd + 0.6) / 0.5)}; k++) tl.set("#${id}-caret", { opacity: k % 2 ? 0 : 1 }, k * 0.5);
    tl.to("#${id}-win", { y: -60, scale: 0.9, opacity: 0, duration: 0.35, ease: "power3.in" }, ${(promptEnd + 0.15).toFixed(3)});` : ""}
    ${JSON.stringify(tileTimes)}.forEach((t, i) => __in(tl, "#${id}-t" + i, t, "pop", 1));
    tl.to(${JSON.stringify(topics.map((_, i) => `#${id}-t${i}`))}, { y: ${-H * 0.7}, rotation: -10, opacity: 0, duration: 0.42, stagger: 0.03, ease: "power3.in" }, ${(actBEnd - 0.35).toFixed(3)});
    ${JSON.stringify(markIds)}.forEach((m, i) => __in(tl, m, ${JSON.stringify(markTimes)}[i] - 0.18, "slam", 0.65));
    ${tagline ? `__in(tl, "#${id}-tag", ${(hit + 0.15).toFixed(3)}, "pop", 1);` : ""}
    ${episodeLabel ? `__in(tl, "#${id}-ep", ${(hit + 0.35).toFixed(3)}, "stamp", 1);` : ""}
    for (let b = 0; b < 4; b++) tl.fromTo("#${id}-w" + b, { x: -${W} }, { x: 0, duration: 0.28, ease: "power3.in" }, ${exitAt.toFixed(3)} + b * 0.04);
    window.__timelines["${id}"] = tl;
  </script>
</template>
`;
}

/**
 * Outro, three acts: colour bands open onto the outro; the series kicker and note keys (outro.lines)
 * land on beats; on the hit the notes clear and the final lock-up (wordmark keys, tagline, handle)
 * builds and HOLDS as the last frame — no fade to blank.
 */
export function outroComposition({ style, cfg, duration, beatInfo, nextLabel, hitAt }) {
  if (duration > 25) return longComposition({ style, cfg, duration, beatInfo, kind: "outro" });
  const W = cfg.format.width;
  const H = cfg.format.height;
  const id = "outro";
  const D = duration;
  const beats = beatInfo.beats || [];
  const name = cfg.channel.name || "Channel";
  const tagline = cfg.channel.tagline || "";
  const lines = (cfg.outro.lines || []).filter((l) => l !== tagline).slice(0, 3);
  if (nextLabel) lines.push(nextLabel);
  const hit = hitAt != null && hitAt > 1.5 && hitAt < D - 1 ? hitAt : findHit(beatInfo, D * 0.35, D * 0.75);
  const lineTimes = beatSlots(beats, 0.75, Math.max(1, hit - 1.0), lines.length);
  const cards = lines.map((l, i) => {
    const acc = style.colors[ACCENTS[(i + 1) % ACCENTS.length]] || style.colors.accent;
    const y = H * 0.3 + i * 150;
    return `<div class="tile" id="${id}-l${i}" style="left:${W * 0.5 - 540 + (i % 2 ? 80 : 0)}px;top:${y}px;width:1080px;height:120px;flex-direction:row;align-items:center;gap:26px;justify-content:flex-start;background:${i % 2 ? style.colors.paper : acc}"><span class="ix">${String(i + 1).padStart(2, "0")}</span><span class="wd" style="font-size:52px">${escapeHtml(l)}</span></div>`;
  });
  const deco = decorLayer({ style, W, H, id: `${id}-decor`, seed: 202, start: 0, duration: D, count: 6, z: 1 });
  const markIds = [...name].map((c, i) => (c === " " ? null : `#${id}-ch${i}`)).filter(Boolean);
  const handle = cfg.channel.handle || "";
  return `<template>
  <style>${common(style, W, H, id)}
    #${id}-root .kick { position: absolute; left: 0; right: 0; top: ${H * 0.14}px; text-align: center; font-family: '${style.fonts.mono}'; font-size: 34px; letter-spacing: 0.3em; text-transform: uppercase; }
  </style>
  <div id="${id}-root" data-composition-id="${id}" data-width="${W}" data-height="${H}">
    <div class="g"></div>
    ${deco.html}
    <div class="kick" id="${id}-kick">${escapeHtml(cfg.channel.series || name)}</div>
    ${cards.join("\n    ")}
    <div class="mark" id="${id}-mark" style="top:${H * 0.3}px;--mark-size:${markSize(name, W)}px">${markHtml(name, id)}</div>
    ${tagline ? `<div class="pill" id="${id}-tag" style="top:${H * 0.6}px"><span>${escapeHtml(tagline)}</span></div>` : ""}
    ${handle ? `<div class="pill" id="${id}-handle" style="top:${H * 0.73}px"><span style="background:${style.colors.paper};font-size:32px">${escapeHtml(handle)}</span></div>` : ""}
    ${wipeBands(style, W, H, id)}
  </div>
  <script>
    ${MOTION_JS}
    const tl = gsap.timeline({ paused: true });
    for (let b = 0; b < 4; b++) tl.fromTo("#${id}-w" + b, { x: 0 }, { x: ${W}, duration: 0.32, ease: "power3.out" }, 0.05 + b * 0.04);
    ${deco.tweens.join("\n    ")}
    __in(tl, "#${id}-kick", 0.35, "fade-rise", 1);
    ${JSON.stringify(lineTimes)}.forEach((t, i) => __in(tl, "#${id}-l" + i, t, "pop", 1));
    tl.to(${JSON.stringify(lines.map((_, i) => `#${id}-l${i}`))}, { y: ${H * 0.8}, rotation: 6, opacity: 0, duration: 0.45, stagger: 0.04, ease: "power3.in" }, ${(hit - 0.55).toFixed(3)});
    ${JSON.stringify(markIds)}.forEach((m, i) => __in(tl, m, ${hit.toFixed(3)} - 0.12 + i * 0.045, "slam", 0.65));
    ${tagline ? `__in(tl, "#${id}-tag", ${(hit + 0.6).toFixed(3)}, "pop", 1);` : ""}
    ${handle ? `__in(tl, "#${id}-handle", ${(hit + 0.9).toFixed(3)}, "pop", 1);` : ""}
    window.__timelines["${id}"] = tl;
  </script>
</template>
`;
}

/** A tiny standalone HyperFrames project that renders one brand piece (with its music) to a video file. */
export function brandProjectHtml({ id, duration, W, H, music, musicStart, volume, fadeIn, fadeOut }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=${W}, height=${H}" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
<style>* { margin: 0; padding: 0; box-sizing: border-box; } html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #000; }</style></head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${W}" data-height="${H}">
<div id="${id}" data-composition-id="${id}" data-composition-src="compositions/${id}.html" data-start="0" data-duration="${duration}" data-track-index="1" data-track-kind="graphics" data-width="${W}" data-height="${H}"></div>
${music ? `<audio id="music-${id}" class="clip" src="${music}" data-start="0" data-duration="${duration}" data-media-start="${musicStart}" data-track-index="2" data-volume="${volume}" data-fade-in="${fadeIn}" data-fade-out="${fadeOut}"></audio>` : ""}
</div>
<script>window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>
`;
}

/** Full-song intro/outro: a scene per musical phrase (see scenes.mjs). */
export function longComposition({ style, cfg, duration, beatInfo, kind }) {
  const W = cfg.format.width;
  const H = cfg.format.height;
  const id = kind;
  const D = duration;
  const deco = decorLayer({ style, W, H, id: `${id}-decor`, seed: kind === "intro" ? 101 : 202, start: 0, duration: D, count: 6, z: 1 });
  const L = longBrand({ style, cfg, W, H, D, beatInfo, kind });
  const exit = kind === "intro"
    ? `for (let b = 0; b < 4; b++) tl.fromTo("#${id}-w" + b, { x: -${W} }, { x: 0, duration: 0.28, ease: "power3.in" }, ${(D - 0.55).toFixed(3)} + b * 0.04);`
    : `for (let b = 0; b < 4; b++) tl.fromTo("#${id}-w" + b, { x: 0 }, { x: ${W}, duration: 0.32, ease: "power3.out" }, 0.05 + b * 0.04);`;
  return `<template>
  <style>${common(style, W, H, id)}${scenesCss(style)}</style>
  <div id="${id}-root" data-composition-id="${id}" data-width="${W}" data-height="${H}">
    <div class="g"></div>
    ${deco.html}
    ${L.html}
    ${wipeBands(style, W, H, id)}
  </div>
  <script>
    ${MOTION_JS}
    const tl = gsap.timeline({ paused: true });
    ${kind === "intro" ? `for (let b = 0; b < 4; b++) tl.set("#${id}-w" + b, { x: ${W} }, 0);` : ""}
    ${deco.tweens.join("\n    ")}
    ${L.tw.join("\n    ")}
    ${exit}
    window.__timelines["${id}"] = tl;
  </script>
</template>
`;
}
