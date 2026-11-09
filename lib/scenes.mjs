// Full-length brand pieces: a sequence of scenes that fills the whole song. Scene changes land on
// phrase boundaries (every 4 bars of the detected beat grid) with colour-band wipes; elements pop on beats.
import { escapeHtml } from "./util.mjs";
import { shapeSvg } from "./decor.mjs";
import { markSize } from "./brand.mjs";

const ACC = ["accent", "accent2", "accent3", "accent4", "accent5"];
const r3 = (v) => Math.round(v * 1000) / 1000;

export function phraseGrid(beatInfo, D) {
  const p = beatInfo.period && beatInfo.period > 0.25 && beatInfo.period < 1.2 ? beatInfo.period : 0.6;
  const first = (beatInfo.beats && beatInfo.beats.length ? beatInfo.beats[0] : 0) % (4 * p);
  let L = 16 * p; // 4 bars
  while (L < 7) L *= 2;
  while (L > 16) L /= 2;
  const bounds = [];
  for (let t = first; t < D; t += L) if (t > 0.5) bounds.push(r3(t));
  return { p, L, bounds };
}

const beatsIn = (beats, a, b) => beats.filter((t) => t >= a && t < b);

function clip(id, a, b, inner, z = 5) {
  return `<div id="${id}" class="clip full" data-start="${r3(a)}" data-duration="${r3(b - a)}" style="z-index:${z}">${inner}</div>`;
}

/** Each scene builder returns {html, tw}. All times are absolute within the brand composition. */
const SCENES = {
  prompt(ctx, id, a, b) {
    const { cfg, W, H } = ctx;
    const prompt = cfg.intro.prompt || cfg.channel.tagline || cfg.channel.name;
    const w = Math.min(1560, 300 + prompt.length * 33);
    const chars = [...prompt];
    const step = Math.max(0.03, Math.min(0.08, (b - a - 2) / Math.max(1, chars.length)));
    const html = clip(id, a, b, `<div class="win" id="${id}-w" style="left:${(W - w) / 2}px;top:${H * 0.36}px;width:${w}px"><div class="win-bar"><i></i><i></i><i></i><span class="addr"></span></div><div class="win-body">${chars.map((c, i) => `<span class="c" id="${id}-c${i}">${escapeHtml(c)}</span>`).join("")}<span class="caret" id="${id}-k"></span></div></div>`);
    const tw = [`__in(tl, "#${id}-w", ${r3(a + 0.1)}, "pop", 1);`];
    chars.forEach((_, i) => tw.push(`tl.fromTo("#${id}-c${i}", { opacity: 0 }, { opacity: 1, duration: 0.01 }, ${r3(a + 0.5 + i * step)});`));
    for (let t = a, k = 0; t < b; t += 0.5, k++) tw.push(`tl.set("#${id}-k", { opacity: ${k % 2 ? 0 : 1} }, ${r3(t)});`);
    return { html, tw };
  },
  keys(ctx, id, a, b, words) {
    const { style, W, H, beats } = ctx;
    const items = words.slice(0, 6);
    const tileW = 470, tileH = 170, gap = 44, cols = 3;
    const rows = Math.ceil(items.length / cols);
    const gx = (W - (cols * tileW + (cols - 1) * gap)) / 2;
    const gy = H * 0.5 - (rows * tileH + (rows - 1) * gap) / 2 + 30;
    const times = beatsIn(beats, a + 0.2, b - 1).filter((_, i) => i % 2 === 0).slice(0, items.length);
    while (times.length < items.length) times.push(a + 0.3 + times.length * 0.4);
    const html = clip(id, a, b, items.map((t, i) => {
      const acc = style.colors[ACC[i % ACC.length]] || style.colors.accent;
      const fs = Math.min(60, Math.floor((tileW - 60) / (t.length * 0.74)));
      return `<div class="tile" id="${id}-t${i}" style="left:${gx + (i % cols) * (tileW + gap)}px;top:${gy + Math.floor(i / cols) * (tileH + gap)}px;width:${tileW}px;height:${tileH}px;background:${i % 2 ? style.colors.paper : acc}"><span class="ix">${String(i + 1).padStart(2, "0")}</span><span class="wd" style="font-size:${fs}px">${escapeHtml(t)}</span></div>`;
    }).join(""));
    const tw = items.map((_, i) => `__in(tl, "#${id}-t${i}", ${r3(times[i])}, "pop", 1);`);
    // later beats: tiles bounce in turn
    beatsIn(beats, times.at(-1) + 0.6, b - 0.5).forEach((t, k) => tw.push(`tl.fromTo("#${id}-t${k % items.length}", { y: 0 }, { y: -22, duration: 0.12, yoyo: true, repeat: 1, ease: "power2.out", immediateRender: false }, ${r3(t)});`));
    return { html, tw };
  },
  spell(ctx, id, a, b, word, n) {
    const { style, W, H, beats } = ctx;
    const letters = [...word.toUpperCase()].filter((c) => c !== " ");
    const size = Math.min(210, Math.floor((W * 0.86) / Math.max(1, [...word].length) / 0.95));
    const accs = letters.map((_, i) => style.colors[ACC[(i + n) % ACC.length]] || style.colors.accent);
    const html = clip(id, a, b, `<div class="kicker" id="${id}-k" style="top:${H * 0.24}px">${String(n + 1).padStart(2, "0")} / ${escapeHtml(ctx.kicker)}</div><div class="mark" style="top:${H * 0.36}px;--mark-size:${size}px">${[...word.toUpperCase()].map((c, i) => (c === " " ? `<span class="sp"></span>` : `<span class="ch" id="${id}-l${i}" style="background:${i % 2 ? style.colors.paper : accs[i % accs.length]}">${escapeHtml(c)}</span>`)).join("")}</div>`);
    const ids = [...word].map((c, i) => (c === " " ? null : `#${id}-l${i}`)).filter(Boolean);
    let times = beatsIn(beats, a + 0.2, a + (b - a) * 0.55);
    if (times.length >= ids.length * 2) times = times.filter((_, i) => i % 2 === 0);
    while (times.length < ids.length) times.push(a + 0.25 + times.length * 0.3);
    const tw = [`__in(tl, "#${id}-k", ${r3(a + 0.1)}, "fade-rise", 1);`, ...ids.map((s, i) => `__in(tl, "${s}", ${r3(times[i])}, "slam", 0.7);`)];
    beatsIn(beats, times[ids.length - 1] + 0.4, b - 0.4).forEach((t, k) => tw.push(`tl.fromTo("${ids[k % ids.length]}", { y: 0 }, { y: -30, duration: 0.11, yoyo: true, repeat: 1, ease: "power2.out", immediateRender: false }, ${r3(t)});`));
    return { html, tw };
  },
  ticker(ctx, id, a, b, words) {
    const { style, W, H } = ctx;
    const line = (k) => Array.from({ length: 8 }, (_, i) => escapeHtml(words[(i + k) % words.length])).join('  <span class="dot">●</span>  ');
    const bands = [0, 1, 2].map((k) => `<div class="tick" id="${id}-b${k}" style="top:${H * 0.2 + k * 230}px;background:${style.colors[ACC[(k + 1) % ACC.length]]}"><div class="tick-in" id="${id}-r${k}">${line(k)}</div></div>`).join("");
    const html = clip(id, a, b, bands);
    const tw = [];
    [0, 1, 2].forEach((k) => {
      tw.push(`tl.fromTo("#${id}-b${k}", { x: ${k % 2 ? W : -W} }, { x: 0, duration: 0.45, ease: "power3.out" }, ${r3(a + 0.1 + k * 0.08)});`);
      tw.push(`tl.fromTo("#${id}-r${k}", { x: ${k % 2 ? -1400 : 0} }, { x: ${k % 2 ? 0 : -1400}, duration: ${r3(b - a)}, ease: "none" }, ${r3(a)});`);
    });
    return { html, tw };
  },
  windows(ctx, id, a, b, words) {
    const { style, W, H, beats } = ctx;
    const items = words.slice(0, 3);
    const pos = [[180, 200], [720, 380], [1180, 560]];
    const html = clip(id, a, b, items.map((t, i) => `<div class="win" id="${id}-w${i}" style="left:${pos[i][0]}px;top:${pos[i][1]}px;width:620px"><div class="win-bar"><i></i><i></i><i></i><span class="addr"></span></div><div class="win-body" style="font-family:var(--display);font-size:64px;background:${style.colors[ACC[(i + 2) % ACC.length]]}">${escapeHtml(t)}</div></div>`).join(""));
    let times = beatsIn(beats, a + 0.2, b - 1.5).filter((_, i) => i % 3 === 0).slice(0, items.length);
    while (times.length < items.length) times.push(a + 0.3 + times.length * 0.6);
    const tw = items.map((_, i) => `__in(tl, "#${id}-w${i}", ${r3(times[i])}, "pop", 1);`);
    items.forEach((_, i) => tw.push(`tl.to("#${id}-w${i}", { y: ${i % 2 ? 24 : -24}, duration: ${r3(Math.max(1, b - times[i] - 0.6))}, ease: "sine.inOut" }, ${r3(times[i] + 0.4)});`));
    return { html, tw };
  },
  burst(ctx, id, a, b, word, n) {
    const { style, W, H, beats } = ctx;
    const size = Math.min(300, Math.floor((W * 0.8) / Math.max(1, word.length) / 0.62));
    const kinds = ["sparkle", "ring", "triangle", "squiggle", "zigzag", "dot", "half", "sparkle"];
    const shapes = kinds.map((k, i) => {
      const ang = (i / kinds.length) * Math.PI * 2;
      const x = W / 2 + Math.cos(ang) * 620 - 60;
      const y = H / 2 + Math.sin(ang) * 330 - 60;
      return `<div class="decor" id="${id}-s${i}" style="left:${x}px;top:${y}px">${shapeSvg(k, 120, style.colors[ACC[(i + n) % ACC.length]], style.colors.ink, 5)}</div>`;
    }).join("");
    const html = clip(id, a, b, `${shapes}<div class="big" id="${id}-w" style="font-size:${size}px;top:${H / 2 - size * 0.6}px">${escapeHtml(word.toUpperCase())}</div>`);
    const tw = [`__in(tl, "#${id}-w", ${r3(a + 0.15)}, "slam", 1);`];
    kinds.forEach((_, i) => tw.push(`tl.fromTo("#${id}-s${i}", { scale: 0, rotation: -60, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: 0.4, ease: "back.out(2.5)" }, ${r3(a + 0.3 + i * 0.06)});`));
    beatsIn(beats, a + 1, b - 0.4).forEach((t, k) => tw.push(`tl.fromTo("#${id}-w", { scale: 1 }, { scale: 1.06, duration: 0.1, yoyo: true, repeat: 1, ease: "power2.out", immediateRender: false }, ${r3(t)});`));
    return { html, tw };
  },
  notes(ctx, id, a, b, lines) {
    const { style, W, H, beats } = ctx;
    const html = clip(id, a, b, lines.slice(0, 4).map((l, i) => `<div class="tile" id="${id}-n${i}" style="left:${W * 0.5 - 560 + (i % 2 ? 80 : 0)}px;top:${H * 0.26 + i * 160}px;width:1120px;height:124px;flex-direction:row;align-items:center;gap:26px;justify-content:flex-start;background:${i % 2 ? style.colors.paper : style.colors[ACC[(i + 1) % ACC.length]]}"><span class="ix">${String(i + 1).padStart(2, "0")}</span><span class="wd" style="font-size:52px">${escapeHtml(l)}</span></div>`).join(""));
    let times = beatsIn(beats, a + 0.3, b - 1).filter((_, i) => i % 2 === 0).slice(0, lines.length);
    while (times.length < Math.min(4, lines.length)) times.push(a + 0.4 + times.length * 0.5);
    return { html, tw: lines.slice(0, 4).map((_, i) => `__in(tl, "#${id}-n${i}", ${r3(times[i])}, "pop", 1);`) };
  },
  lockup(ctx, id, a, b) {
    const { style, cfg, W, H, beats } = ctx;
    const name = cfg.channel.name || "Channel";
    const ids = [...name].map((c, i) => (c === " " ? null : `#${id}-c${i}`)).filter(Boolean);
    const handle = ctx.kind === "outro" ? cfg.channel.handle : "";
    const html = clip(id, a, b, `<div class="mark" style="top:${H * 0.3}px;--mark-size:${markSize(name, W)}px">${[...name].map((c, i) => (c === " " ? `<span class="sp"></span>` : `<span class="ch" id="${id}-c${i}">${escapeHtml(c)}</span>`)).join("")}</div>${cfg.channel.tagline ? `<div class="pill" id="${id}-t" style="top:${H * 0.6}px"><span>${escapeHtml(cfg.channel.tagline)}</span></div>` : ""}${handle ? `<div class="pill" id="${id}-h" style="top:${H * 0.73}px"><span style="background:${style.colors.paper};font-size:32px">${escapeHtml(handle)}</span></div>` : ""}`, 6);
    const tw = ids.map((s, i) => `__in(tl, "${s}", ${r3(a + 0.15 + i * 0.07)}, "slam", 0.65);`);
    if (cfg.channel.tagline) tw.push(`__in(tl, "#${id}-t", ${r3(a + 0.25 + ids.length * 0.07)}, "pop", 1);`);
    if (handle) tw.push(`__in(tl, "#${id}-h", ${r3(a + 0.5 + ids.length * 0.07)}, "pop", 1);`);
    // a gentle beat bounce while it holds (stops 2 s before the end so the final frame is still)
    beatsIn(beats, a + 1.6, b - 2).filter((_, k) => k % 4 === 0).forEach((t, k) => tw.push(`tl.fromTo("${ids[k % ids.length]}", { y: 0 }, { y: -16, duration: 0.12, yoyo: true, repeat: 1, ease: "power2.out", immediateRender: false }, ${r3(t)});`));
    return { html, tw };
  },
};

export function scenesCss(style) {
  const c = style.colors;
  const s = style.shape;
  const border = s.border ? `${s.border}px solid ${c.ink}` : "none";
  const shadow = s.shadow === "none" ? "none" : `${s.shadowX}px ${s.shadowY}px ${s.shadowBlur}px ${c[s.shadow] || s.shadow}`;
  return `
    .kicker { position: absolute; left: 0; right: 0; text-align: center; font-family: '${style.fonts.mono}'; font-size: 34px; letter-spacing: 0.3em; text-transform: uppercase; }
    .tick { position: absolute; left: -40px; width: 2100px; height: 170px; overflow: hidden; border-top: ${border}; border-bottom: ${border}; display: flex; align-items: center; transform: rotate(-2deg); }
    .tick-in { white-space: nowrap; font-family: '${style.fonts.display}'; font-weight: ${style.fonts.displayWeight || 400}; font-size: 96px; text-transform: uppercase; color: ${c.ink}; padding-left: 40px; }
    .tick-in .dot { font-size: 50px; vertical-align: middle; }
    .big { position: absolute; left: 0; right: 0; text-align: center; font-family: '${style.fonts.display}'; font-weight: ${style.fonts.displayWeight || 400}; line-height: 1; color: ${c.ink}; text-shadow: ${s.shadowX || 8}px ${s.shadowY || 8}px 0 ${c.accent}; }
  `;
}

/**
 * Build the scene sequence for a long brand piece.
 * Returns {html, tw}; the caller wraps it in the composition template (ground, decor, CSS).
 */
export function longBrand({ style, cfg, W, H, D, beatInfo, kind }) {
  const { L, bounds } = phraseGrid(beatInfo, D);
  const beats = beatInfo.beats || [];
  const topics = (cfg.intro.topics || []).length ? cfg.intro.topics : ["Technology", "Innovation", "Curiosity"];
  const lines = (cfg.outro.lines || []).filter((l) => l !== cfg.channel.tagline);
  const ctx = { style, cfg, W, H, beats, kind, kicker: cfg.channel.series || cfg.channel.name };
  // final lock-up: the last ~2 phrases (at least 12 s) so the piece ends on a held brand frame
  const endHold = Math.max(12, Math.min(2 * L, 24));
  const cuts = [0, ...bounds.filter((t) => t > 2 && t < D - endHold - 2)];
  cuts.push(Math.max(cuts.at(-1) + 4, D - endHold));
  const plan = kind === "intro"
    ? ["prompt", "keys", "lockup", "spell", "ticker", "windows", "spell", "burst", "keys", "spell", "ticker", "windows", "burst", "spell"]
    : ["notes", "lockup", "ticker", "spell", "windows", "burst", "notes", "spell", "ticker", "keys", "burst", "windows", "spell"];
  const html = [];
  const tw = [];
  let spellN = 0;
  let burstN = 0;
  for (let i = 0; i < cuts.length; i++) {
    const a = cuts[i];
    const b = i + 1 < cuts.length ? cuts[i + 1] : D;
    const isLast = i === cuts.length - 1;
    const name = isLast ? "lockup" : plan[i % plan.length];
    const id = `${kind}-s${i}`;
    let r;
    if (name === "spell") r = SCENES.spell(ctx, id, a, b, topics[spellN % topics.length], spellN++);
    else if (name === "burst") r = SCENES.burst(ctx, id, a, b, topics[(burstN++ + 2) % topics.length], burstN);
    else if (name === "keys") r = SCENES.keys(ctx, id, a, b, topics);
    else if (name === "ticker") r = SCENES.ticker(ctx, id, a, b, [...topics, ...(kind === "outro" ? lines : [])]);
    else if (name === "windows") r = SCENES.windows(ctx, id, a, b, kind === "outro" && lines.length ? [...lines, ...topics] : topics.slice((i * 2) % topics.length).concat(topics));
    else if (name === "notes") r = SCENES.notes(ctx, id, a, b, lines.length ? lines : topics);
    else r = SCENES[name](ctx, id, a, b);
    html.push(r.html);
    tw.push(...r.tw);
    // colour-band wipe on every scene change (not before the first)
    if (i > 0) {
      const wid = `${kind}-x${i}`;
      html.push(`<div id="${wid}" class="clip full" data-start="${r3(a - 0.3)}" data-duration="0.7" data-layout-ignore style="z-index:50">${[0, 1, 2, 3].map((k) => `<div class="wipe" id="${wid}-${k}" style="top:${(H / 4) * k}px;height:${Math.ceil(H / 4)}px;background:${style.colors[ACC[(k + i) % ACC.length]]}"></div>`).join("")}</div>`);
      for (let k = 0; k < 4; k++) {
        tw.push(`tl.fromTo("#${wid}-${k}", { x: ${-W} }, { x: 0, duration: 0.24, ease: "power3.in" }, ${r3(a - 0.3 + k * 0.03)});`);
        tw.push(`tl.to("#${wid}-${k}", { x: ${W}, duration: 0.26, ease: "power3.out" }, ${r3(a + 0.02 + k * 0.03)});`);
      }
    }
  }
  return { html: html.join("\n"), tw, scenes: cuts.length, phrase: L };
}
