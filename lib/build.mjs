// Assemble a HyperFrames project from: config + style + recording + segments + captions + music plan.
import path from "node:path";
import os from "node:os";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { loadConfig, loadStyle, resolvePath } from "./config.mjs";
import { SEGMENT_TYPES } from "./segments.mjs";
import { baseCss, captionCss, onColor } from "./css.mjs";
import { MOTION_JS } from "./motion.mjs";
import { decorLayer } from "./decor.mjs";
import { introComposition, outroComposition } from "./brand.mjs";
import { renderBed, duckingPoints, speechIntervals, detectBeats, trackPath, readLedger } from "./music.mjs";
import { readJSON, writeJSON, writeText, ensureDir, copyInto, probe, loudness, normalizeLoudness, dbToGain, clamp, round, escapeHtml, escapeAttr, slug, readText } from "./util.mjs";
import { parseScript } from "./script.mjs";

export const HF_VERSION = "0.9.23";

function projectPaths(dir) {
  return {
    project: path.join(dir, "storycut.project.json"),
    transcript: path.join(dir, "work", "transcript.json"),
    segments: path.join(dir, "segments.json"),
    captions: path.join(dir, "captions.json"),
    music: path.join(dir, "music.json"),
    questions: path.join(dir, "work", "questions.json"),
    build: path.join(dir, "build"),
    renders: path.join(dir, "renders"),
  };
}
export { projectPaths };

async function twemoji(ch) {
  const code = [...ch].map((c) => c.codePointAt(0).toString(16)).filter((c) => c !== "fe0f").join("-");
  const cache = ensureDir(path.join(os.homedir(), ".cache", "storycut", "twemoji"));
  const f = path.join(cache, `${code}.svg`);
  if (!existsSync(f)) {
    const r = await fetch(`https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/${code}.svg`);
    if (!r.ok) return null;
    writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  return f;
}

function fuzzyAsset(dir, text, exts) {
  if (!dir || !existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => exts.includes(path.extname(f).toLowerCase()));
  const direct = files.find((f) => text.includes(f));
  if (direct) return path.join(dir, direct);
  const want = slug(text).split("-").filter((w) => w.length > 2);
  let best = null;
  for (const f of files) {
    const parts = slug(path.basename(f, path.extname(f))).split("-").filter((w) => w.length > 1);
    const hit = parts.filter((p) => want.includes(p)).length;
    if (parts.length && hit === parts.length && (!best || hit > best.hit)) best = { f, hit };
  }
  return best ? path.join(dir, best.f) : null;
}

const backticks = (s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const firstEmoji = (s) => (s.match(/\p{Extended_Pictographic}(‍\p{Extended_Pictographic})*️?/u) || [null])[0];

export async function build(projectDir, opts = {}) {
  const P = projectPaths(projectDir);
  const cfg = loadConfig(projectDir, { required: true });
  const proj = readJSON(P.project);
  const style = loadStyle(proj.style || cfg.style, cfg);
  const transcript = readJSON(P.transcript);
  const segs = readJSON(P.segments);
  const capsDoc = readJSON(P.captions);
  const plan = readJSON(P.music, { blocks: [] });
  const questions = readJSON(P.questions, []);
  const open = questions.filter((q) => q.status === "open");
  if (open.length && !opts.allowUncertain) {
    throw new Error(`${open.length} unclear passage(s) still open (${open.map((q) => `${q.id}@${q.at}`).join(", ")}). Ask the creator, then run: storycut resolve <project> <id> "<what they said>"  (or build --allow-uncertain)`);
  }
  const W = cfg.format.width;
  const H = cfg.format.height;
  const B = P.build;
  if (existsSync(B)) rmSync(B, { recursive: true, force: true });
  ensureDir(path.join(B, "assets"));
  ensureDir(path.join(B, "compositions"));
  const warnings = [];
  const recFile = path.join(projectDir, proj.recording);
  const rec = probe(recFile);
  const recDur = rec.duration;
  const isVideo = rec.hasVideo;

  // ---- intro / outro timing (driven by the songs)
  const introMusic = cfg.intro.enabled ? resolvePath(cfg, cfg.intro.music) : null;
  const outroMusic = cfg.outro.enabled ? resolvePath(cfg, cfg.outro.music) : null;
  if (cfg.intro.enabled && cfg.intro.music && !existsSync(introMusic)) warnings.push(`intro music not found: ${cfg.intro.music} — using a silent ${cfg.intro.seconds}s intro`);
  if (cfg.outro.enabled && cfg.outro.music && !existsSync(outroMusic)) warnings.push(`outro music not found: ${cfg.outro.music} — using a silent ${cfg.outro.seconds}s outro`);
  const introHas = introMusic && existsSync(introMusic);
  const outroHas = outroMusic && existsSync(outroMusic);
  // excerpt of each song: start = seconds into the song, or "end" (the song's last maxSeconds, so it ends naturally)
  const excerpt = (file, conf) => {
    const len = probe(file).duration;
    const dur = Math.min(len, conf.maxSeconds);
    const start = conf.start === "end" ? Math.max(0, len - dur) : Math.min(Math.max(0, Number(conf.start) || 0), Math.max(0, len - 1));
    return { start: round(start, 3), dur: round(Math.min(dur, len - start), 3) };
  };
  const introEx = introHas ? excerpt(introMusic, cfg.intro) : { start: 0, dur: cfg.intro.seconds };
  const outroEx = outroHas ? excerpt(outroMusic, cfg.outro) : { start: 0, dur: cfg.outro.seconds };
  // pre-rendered reusable brand videos (storycut brand render) take priority over live compositions
  const introVideo = cfg.intro.enabled && cfg.intro.video ? resolvePath(cfg, cfg.intro.video) : null;
  const outroVideo = cfg.outro.enabled && cfg.outro.video ? resolvePath(cfg, cfg.outro.video) : null;
  const introVid = introVideo && existsSync(introVideo) ? introVideo : null;
  const outroVid = outroVideo && existsSync(outroVideo) ? outroVideo : null;
  if (introVideo && !introVid) warnings.push(`intro.video not found: ${cfg.intro.video} — run "storycut brand render"; using the live intro`);
  if (outroVideo && !outroVid) warnings.push(`outro.video not found: ${cfg.outro.video} — run "storycut brand render"; using the live outro`);
  const introDur = !cfg.intro.enabled ? 0 : introVid ? round(probe(introVid).duration, 3) : introEx.dur;
  const outroDur = !cfg.outro.enabled ? 0 : outroVid ? round(probe(outroVid).duration, 3) : outroEx.dur;
  const N = round(Math.max(0, introDur - (introDur ? cfg.intro.narrationOverlap : 0)), 3); // narration start
  const narrEnd = round(N + recDur, 3);
  const O = round(narrEnd + (outroDur ? 0.25 : 0), 3);
  const T = round(O + outroDur, 3);
  const introBeats = introHas && !introVid ? detectBeats(introMusic, { maxSeconds: introDur, start: introEx.start }) : { beats: [], bpm: null };
  const outroBeats = outroHas && !outroVid ? detectBeats(outroMusic, { maxSeconds: outroDur, start: outroEx.start }) : { beats: [], bpm: null };

  // ---- assets
  const A = (f, name) => `assets/${path.basename(copyInto(f, path.join(B, "assets"), name))}`;
  // narration audio: loudness-normalised copy (two-pass, true-peak limited); the original is never modified
  const narrAudioFile = path.join(B, "assets", "narration-norm.wav");
  const norm = normalizeLoudness(recFile, narrAudioFile, { lufs: cfg.narration.targetLufs, tp: -1.5 });
  const narrAudio = "assets/narration-norm.wav";
  const narrVideo = isVideo ? A(recFile, `narration${path.extname(recFile)}`) : null;
  const narrLoud = { lufs: norm.inputLufs, truePeak: norm.inputTp };
  const narrGain = 1;

  // ---- segments in video time
  const vsegs = segs.segments.filter((s) => s.recorded).map((s, i, arr) => ({
    ...s,
    vstart: round(N + s.start, 3),
    vend: round(N + (arr[i + 1] ? arr[i + 1].start : recDur), 3),
    chip: style.colors[style.segmentColors?.[s.type] || "accent"] || style.colors.accent,
    chipInk: onColor(style.colors[style.segmentColors?.[s.type] || "accent"] || style.colors.accent),
    meta: SEGMENT_TYPES[s.type] || SEGMENT_TYPES["main-tech"],
  }));
  const sponsorSegs = vsegs.filter((s) => s.type === "sponsor");
  if (cfg.sponsor.enabled && !sponsorSegs.length) warnings.push(`sponsor is enabled but the recording has no sponsor segment — add one with: storycut sponsor insert`);

  const els = []; // timed visual elements (HTML strings)
  const tw = []; // main timeline code
  const audio = []; // audio element HTML
  const report = { cards: [], transitions: [], lowerThirds: 0, emoji: 0, memes: 0, textCards: 0, sfx: 0, caveats: 0, unrendered: [] };
  let z = 10;
  const enter = style.motion.enter;
  const k = style.motion.duration / 0.3;

  // ground, texture, narration
  els.push(`<div id="ground" class="full ground" style="z-index:1"></div>`);
  if (isVideo) els.push(`<video id="narration-video" class="clip full narr-video" src="${narrVideo}" data-start="${N}" data-duration="${round(recDur, 3)}" data-track-index="1" muted playsinline style="z-index:2"></video>`);
  audio.push(`<audio id="narration" class="clip" src="${narrAudio}" data-start="${N}" data-duration="${round(recDur, 3)}" data-track-index="2" data-volume="${narrGain}"></audio>`);

  // stage panels (only for voice-over: the picture behind the voice)
  const scriptTitle = parseScript(readText(path.join(projectDir, proj.script))).title;
  const episodeTitle = (scriptTitle.split(/\s+[—–-]\s+/).slice(1).join(" — ") || scriptTitle).trim();
  const cardEnd = (s) => (cfg.segments.titleCards && s.meta.card ? s.vstart + style.transition.duration * 0.45 + cfg.segments.cardSeconds : s.vstart);
  const xt = style.type?.extrude || style.type?.outline ? " xt" : "";
  let panelN = 0;
  if (!isVideo) {
    for (const s of vsegs) {
      if (s.type === "sponsor") continue;
      // hook / intro / outro get the episode title instead of a bland "Cold open"
      const headTitle = ["hook", "intro", "outro"].includes(s.type) ? episodeTitle : s.title;
      const cuts = [{ t: cardEnd(s) - (cardEnd(s) > s.vstart ? 0.15 : 0), title: headTitle }, ...s.subheads.map((h) => ({ t: N + h.time, title: h.title }))].filter((c, i, a) => i === 0 || c.t - a[i - 1].t > 2);
      cuts.forEach((c, i) => {
        const end = cuts[i + 1] ? cuts[i + 1].t : s.vend;
        if (end - c.t < 0.8) return;
        const id = `panel${++panelN}`;
        const upper = style.titleCard.titleCase === "upper" ? " upper" : "";
        const block = style.stage?.block ?? style.titleCard.layout === "stacked-blocks";
        els.push(`<div id="${id}" class="clip full" data-start="${round(c.t, 3)}" data-duration="${round(end - c.t, 3)}" data-track-index="3" style="z-index:3;--chip:${s.chip};--chip-ink:${s.chipInk}">
  <div class="stage-kicker" id="${id}-k"><b>${escapeHtml(s.meta.kicker)}</b><span>${escapeHtml(i ? s.title : (cfg.channel.series || cfg.channel.name))}</span></div>
  ${style.titleCard.layout === "rule-kicker" ? `<div class="stage-rule" id="${id}-r"></div>` : ""}
  <div class="stage-headline${upper}" id="${id}-h" style="right:${W - 1500}px;font-size:${c.title.length > 40 ? 76 : c.title.length > 24 ? 92 : 120}px"><span class="hl-in${block ? " stage-block" : ""}${xt}">${escapeHtml(c.title)}</span></div>
</div>`);
        __inCode(tw, `#${id}-k`, c.t + 0.05, "fade-rise", k);
        __inCode(tw, `#${id}-h`, c.t + 0.12, enter, k);
      });
    }
  }

  // decorative shape layer per segment (styles with "decor"): each section gets its own arrangement
  if (!isVideo && style.decor && style.decor.kind !== "none") {
    vsegs.forEach((s, i) => {
      const start = round(cardEnd(s), 3);
      const dur = round(s.vend - start, 3);
      if (dur < 1.5) return;
      const d = decorLayer({ style, W, H, id: `decor${i + 1}`, seed: i + 1, start, duration: dur, z: 2 });
      els.push(d.html);
      tw.push(...d.tweens);
    });
  }

  // section transitions + title cards
  const cardSec = cfg.segments.cardSeconds;
  let cardNum = 0;
  for (const s of vsegs) {
    if (!cfg.segments.titleCards || !s.meta.card) continue;
    cardNum++;
    const trDur = style.transition.duration;
    const t0 = s.vstart;
    const trId = `tr${cardNum}`;
    const cardId = `card${cardNum}`;
    // transition
    const kind = style.transition.kind;
    let trHtml = "";
    if (kind === "block-wipe") {
      const n = style.transition.bands || 3;
      trHtml = Array.from({ length: n }, (_, b) => `<div class="tr-band" id="${trId}-b${b}" style="top:${(H / n) * b}px;height:${Math.ceil(H / n)}px"></div>`).join("");
      for (let b = 0; b < n; b++) {
        tw.push(`tl.fromTo("#${trId}-b${b}", { x: ${-W} }, { x: 0, duration: ${round(trDur * 0.45, 3)}, ease: "power3.in" }, ${round(t0 + b * 0.04, 3)});`);
        tw.push(`tl.to("#${trId}-b${b}", { x: ${W}, duration: ${round(trDur * 0.45, 3)}, ease: "power3.out" }, ${round(t0 + trDur * 0.5 + b * 0.04, 3)});`);
      }
    } else if (kind === "line-sweep") {
      trHtml = `<div class="tr-line" id="${trId}-l"></div>`;
      tw.push(`tl.fromTo("#${trId}-l", { x: -10 }, { x: ${W + 10}, duration: ${trDur}, ease: "expo.inOut" }, ${t0});`);
    } else if (kind === "dip-to-black") {
      trHtml = `<div class="full tr-black" id="${trId}-k" style="opacity:0"></div>`;
      tw.push(`tl.fromTo("#${trId}-k", { opacity: 0 }, { opacity: 1, duration: ${round(trDur * 0.5, 3)}, ease: "sine.in" }, ${t0});`);
      tw.push(`tl.to("#${trId}-k", { opacity: 0, duration: ${round(trDur * 0.5, 3)}, ease: "sine.out" }, ${round(t0 + trDur * 0.5, 3)});`);
    } else if (kind === "zoom-punch") {
      trHtml = `<div class="full tr-flash" id="${trId}-f" style="opacity:0"></div>`;
      tw.push(`tl.fromTo("#${trId}-f", { opacity: 0.9 }, { opacity: 0, duration: ${trDur}, ease: "power2.out" }, ${t0});`);
    } else {
      trHtml = `<div class="full card-ground" id="${trId}-x" style="opacity:0"></div>`;
      tw.push(`tl.fromTo("#${trId}-x", { opacity: 0 }, { opacity: 1, duration: ${round(trDur * 0.5, 3)} }, ${t0});`);
      tw.push(`tl.to("#${trId}-x", { opacity: 0, duration: ${round(trDur * 0.5, 3)} }, ${round(t0 + trDur * 0.5, 3)});`);
    }
    els.push(`<div id="${trId}" class="clip full" data-start="${t0}" data-duration="${round(trDur + 0.2, 3)}" data-track-index="20" data-layout-ignore style="z-index:60;--chip:${s.chip};--chip-ink:${s.chipInk}">${trHtml}</div>`);
    const cStart = round(t0 + trDur * 0.45, 3);
    const upper = style.titleCard.titleCase === "upper" ? " upper" : "";
    const inner = `${style.titleCard.numbered ? `<div class="card-num" id="${cardId}-n">${String(cardNum).padStart(2, "0")}</div>` : ""}
    <div class="card-kicker" id="${cardId}-k">${escapeHtml(s.meta.kicker)}</div>
    <div class="card-title${upper}${xt}" id="${cardId}-t">${escapeHtml(s.title)}</div>`;
    const windowed = style.titleCard.layout === "window";
    els.push(`<div id="${cardId}" class="clip full card layout-${style.titleCard.layout}" data-start="${cStart}" data-duration="${cardSec}" data-track-index="19" style="z-index:55;--chip:${s.chip};--chip-ink:${s.chipInk}">
  <div class="card-ground"></div>
  <div class="card-inner" id="${cardId}-in" style="transform: rotate(${style.titleCard.tilt || 0}deg)">
    ${windowed ? `<div class="win-bar"><i></i><i></i><i></i></div><div class="win-body">${inner}</div>` : inner}
  </div>
</div>`);
    __inCode(tw, `#${cardId}-k`, cStart + 0.05, enter, k);
    __inCode(tw, `#${cardId}-t`, cStart + 0.12, enter, k);
    tw.push(`__out(tl, "#${cardId}-in", ${round(cStart + cardSec - 0.25, 3)}, 0.2);`);
    report.cards.push({ segment: s.id, title: s.title, at: cStart });
    report.transitions.push({ kind, at: t0 });
  }

  // lower thirds (sub-stories + [LOWER]), caveats, text cards, emoji, memes, sfx
  const memeDir = resolvePath(cfg, "assets/memes");
  const sfxDir = resolvePath(cfg, "assets/sfx");
  const emojiSpots = [
    { x: W - 430, y: 330 }, { x: W - 300, y: 560 }, { x: W - 560, y: 470 }, { x: 1380, y: 250 },
  ];
  let emojiN = 0;
  let ltN = 0;
  const addLower = (t, kicker, title, chip, dur = 4.2, until = Infinity) => {
    dur = round(Math.min(dur, until - t - 0.1), 3);
    if (dur < 1.2) return;
    const id = `lt${++ltN}`;
    els.push(`<div id="${id}" class="clip full" data-start="${round(t, 3)}" data-duration="${dur}" data-track-index="7" style="z-index:${30};--chip:${chip};--chip-ink:${onColor(chip)}">
  <div class="lt lt-${style.lowerThird.layout}" id="${id}-in"><div class="lt-kicker">${escapeHtml(kicker)}</div><div class="lt-title">${escapeHtml(title)}</div></div>
</div>`);
    __inCode(tw, `#${id}-in`, t + 0.02, enter, k);
    tw.push(`__out(tl, "#${id}-in", ${round(t + dur - 0.25, 3)}, 0.2);`);
    report.lowerThirds++;
  };
  for (const s of vsegs) {
    const cardOffset = cfg.segments.titleCards && s.meta.card ? cardSec + style.transition.duration : 0;
    if (isVideo) for (const h of s.subheads) addLower(N + h.time, s.meta.kicker, h.title, s.chip, 4.2, s.vend);
    let caveatShown = false;
    for (const c of s.cues) {
      const t = N + c.time;
      if (c.kind === "LOWER") addLower(Math.max(t, s.vstart + cardOffset), s.meta.kicker, c.value, s.chip, 4.2, s.vend);
      else if (c.kind === "CAVEAT") {
        const id = `cv${++report.caveats}`;
        const at = round(Math.max(t, s.vstart + cardOffset + 0.2), 3);
        const dur = round(Math.min(6, Math.max(2, s.vend - at - 0.2)), 3);
        if (dur < 1) continue;
        els.push(`<div id="${id}" class="clip full" data-start="${at}" data-duration="${dur}" data-track-index="8" style="z-index:${32}"><div class="caveat" id="${id}-in">${escapeHtml(c.value.replace(/`/g, ""))}</div></div>`);
        __inCode(tw, `#${id}-in`, at, "fade-rise", 0.6);
        caveatShown = true;
      } else if (c.kind === "VISUAL") {
        const texts = backticks(c.value);
        if (!texts.length) {
          report.unrendered.push({ segment: s.id, kind: "VISUAL", value: c.value, why: "description only — needs a real image/clip (put on-screen text in `backticks` to render it)" });
          continue;
        }
        const at = round(Math.min(Math.max(t, s.vstart + cardOffset), s.vend - 2.9), 3);
        if (at < s.vstart) continue;
        const id = `tc${++report.textCards}`;
        els.push(`<div id="${id}" class="clip full" data-start="${at}" data-duration="2.8" data-track-index="6" style="z-index:${26};--chip:${s.chip};--chip-ink:${s.chipInk}"><div class="textcard"><div class="textcard-in" id="${id}-in">${texts.map(escapeHtml).join("<br>")}</div></div></div>`);
        __inCode(tw, `#${id}-in`, at, enter, k);
        tw.push(`__out(tl, "#${id}-in", ${round(at + 2.55, 3)}, 0.2);`);
      } else if (c.kind === "EMOJI") {
        const e = firstEmoji(c.value);
        const f = e && (await twemoji(e));
        if (!f) {
          report.unrendered.push({ segment: s.id, kind: "EMOJI", value: c.value, why: "no emoji character found" });
          continue;
        }
        const src = A(f, `emoji-${path.basename(f)}`);
        const spot = emojiSpots[emojiN % emojiSpots.length];
        const at = round(Math.min(Math.max(t, s.vstart + cardOffset), s.vend - 1.6), 3);
        if (at < s.vstart) continue;
        const id = `em${++emojiN}`;
        els.push(`<div id="${id}" class="clip full" data-start="${at}" data-duration="1.5" data-track-index="9" style="z-index:${28}"><div class="emoji" id="${id}-in" style="left:${spot.x}px;top:${spot.y}px"><img src="${src}" alt=""></div></div>`);
        __inCode(tw, `#${id}-in`, at, style.emoji.animation, 1);
        tw.push(`__out(tl, "#${id}-in", ${round(at + 1.25, 3)}, 0.2);`);
        report.emoji++;
      } else if (c.kind === "MEME") {
        const img = fuzzyAsset(memeDir, c.value, [".jpg", ".jpeg", ".png", ".gif", ".webp"]);
        if (!img) {
          report.unrendered.push({ segment: s.id, kind: "MEME", value: c.value, why: "no matching image in assets/memes (fetch one: node scripts/fetch-assets.mjs meme \"…\")" });
          continue;
        }
        const src = A(img, `meme-${path.basename(img)}`);
        const cap = (c.value.split(/—|--/)[1] || "").trim();
        const at = round(Math.min(Math.max(t, s.vstart + cardOffset), s.vend - 3.3), 3);
        if (at < s.vstart) continue;
        const id = `mm${++report.memes}`;
        els.push(`<div id="${id}" class="clip full" data-start="${at}" data-duration="3.2" data-track-index="6" style="z-index:${27}"><div class="meme" id="${id}-in"><img src="${src}" alt="">${cap ? `<div class="meme-cap">${escapeHtml(cap)}</div>` : ""}</div></div>`);
        __inCode(tw, `#${id}-in`, at, enter, k);
        tw.push(`__out(tl, "#${id}-in", ${round(at + 2.95, 3)}, 0.2);`);
      } else if (c.kind === "SFX") {
        const f = fuzzyAsset(sfxDir, c.value, [".mp3", ".wav", ".ogg", ".m4a"]);
        if (!f) {
          report.unrendered.push({ segment: s.id, kind: "SFX", value: c.value, why: "no matching file in assets/sfx" });
          continue;
        }
        const src = A(f, `sfx-${path.basename(f)}`);
        audio.push(`<audio id="sfx${++report.sfx}" class="clip" src="${src}" data-start="${round(t, 3)}" data-track-index="5" data-volume="0.45"></audio>`);
      }
      void caveatShown;
    }
  }

  // sponsor segment: distinct frame, badge and card
  sponsorSegs.forEach((s, i) => {
    const sp = cfg.sponsor;
    const dur = round(s.vend - s.vstart, 3);
    const chip = style.colors[style.sponsorFrame?.color] || style.colors.accent2;
    els.push(`<div id="spf${i}" class="clip full" data-start="${s.vstart}" data-duration="${dur}" data-track-index="10" data-layout-ignore style="z-index:40;--sp:${chip}"><div class="sp-frame ${style.sponsorFrame?.kind || "tape"}" id="spf${i}-in"></div></div>`);
    els.push(`<div id="spb${i}" class="clip full" data-start="${s.vstart}" data-duration="${dur}" data-track-index="11" style="z-index:41;--sp:${chip}"><div class="sp-badge" id="spb${i}-in"><span class="sp-label">${escapeHtml(sp.label || "SPONSOR")}</span></div></div>`);
    els.push(`<div id="spc${i}" class="clip full" data-start="${round(s.vstart + 0.3, 3)}" data-duration="${round(Math.max(1, dur - 0.6), 3)}" data-track-index="12" style="z-index:42;--sp:${chip}"><div class="sp-card" id="spc${i}-in">
  <div class="sp-name">${escapeHtml(sp.name || "Sponsor")}</div>
  ${sp.url ? `<div class="sp-url">${escapeHtml(sp.url.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</div>` : ""}
  ${sp.disclosure ? `<div class="sp-note">${escapeHtml(sp.disclosure)}</div>` : ""}
</div></div>`);
    tw.push(`tl.fromTo("#spf${i}-in", { opacity: 0 }, { opacity: 1, duration: 0.25 }, ${s.vstart});`);
    __inCode(tw, `#spb${i}-in`, s.vstart + 0.1, enter, k);
    __inCode(tw, `#spc${i}-in`, s.vstart + 0.35, enter, k);
    if (sp.maxSeconds && dur > sp.maxSeconds + 2) warnings.push(`sponsor segment is ${dur.toFixed(1)}s (configured max ${sp.maxSeconds}s)`);
  });

  // channel bug during narration
  if (cfg.branding.watermark) els.push(`<div id="bug" class="clip full" data-start="${N}" data-duration="${round(recDur, 3)}" data-track-index="13" data-layout-ignore style="z-index:35"><div class="bug">${escapeHtml(cfg.channel.name)}</div></div>`);

  // captions sub-composition
  const capStyle = { ...style.captions, ...(cfg.captions.style || {}), ...(capsDoc.style || {}) };
  if (cfg.captions.enabled && capsDoc.captions.length) {
    writeText(path.join(B, "compositions", "captions.html"), captionsComposition(capsDoc, style, capStyle, cfg));
    els.push(`<div id="captions" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="${N}" data-duration="${round(recDur, 3)}" data-track-index="14" data-track-kind="captions" data-width="${W}" data-height="${H}" style="z-index:50"></div>`);
  }

  // intro / outro
  const episodeLabel = proj.episodeLabel || "";
  if (introDur > 0 && introVid) {
    els.push(`<video id="intro-video" class="clip full" src="${A(introVid, `brand-intro${path.extname(introVid)}`)}" data-start="0" data-duration="${introDur}" data-track-index="30" data-has-audio="true" data-volume="1" playsinline style="z-index:80"></video>`);
  } else if (introDur > 0) {
    writeText(path.join(B, "compositions", "intro.html"), introComposition({ style, cfg, duration: introDur, beatInfo: introBeats, episodeLabel }));
    els.push(`<div id="intro" data-composition-id="intro" data-composition-src="compositions/intro.html" data-start="0" data-duration="${introDur}" data-track-index="30" data-track-kind="graphics" data-width="${W}" data-height="${H}" style="z-index:80"></div>`);
    if (introHas) audio.push(`<audio id="music-intro" class="clip" src="${A(introMusic, `intro${path.extname(introMusic)}`)}" data-start="0" data-duration="${introDur}" data-media-start="${introEx.start}" data-track-index="3" data-volume="${cfg.intro.volume}" data-fade-in="${cfg.intro.fadeIn}" data-fade-out="${cfg.intro.fadeOut}"></audio>`);
  }
  if (outroDur > 0 && outroVid) {
    els.push(`<video id="outro-video" class="clip full" src="${A(outroVid, `brand-outro${path.extname(outroVid)}`)}" data-start="${O}" data-duration="${outroDur}" data-track-index="31" data-has-audio="true" data-volume="1" playsinline style="z-index:80"></video>`);
  } else if (outroDur > 0) {
    writeText(path.join(B, "compositions", "outro.html"), outroComposition({ style, cfg, duration: outroDur, beatInfo: outroBeats, nextLabel: proj.nextLabel }));
    els.push(`<div id="outro" data-composition-id="outro" data-composition-src="compositions/outro.html" data-start="${O}" data-duration="${outroDur}" data-track-index="31" data-track-kind="graphics" data-width="${W}" data-height="${H}" style="z-index:80"></div>`);
    if (outroHas) audio.push(`<audio id="music-outro" class="clip" src="${A(outroMusic, `outro${path.extname(outroMusic)}`)}" data-start="${O}" data-duration="${outroDur}" data-media-start="${outroEx.start}" data-track-index="4" data-volume="${cfg.outro.volume}" data-fade-in="${cfg.outro.fadeIn}" data-fade-out="${cfg.outro.fadeOut}"></audio>`);
  }

  // music beds with ducking
  const beds = [];
  if (cfg.music.beds) {
    const speech = speechIntervals(transcript.words).map((s) => ({ start: s.start + N, end: s.end + N }));
    const xf = cfg.music.crossfade;
    const ledger = readLedger(cfg);
    plan.blocks.forEach((b, i) => {
      if (!b.track) return;
      const entry = ledger.tracks[b.track.key];
      const src = entry ? trackPath(cfg, entry) : null;
      if (!src || !existsSync(src)) {
        warnings.push(`music block ${b.id}: track file missing (${b.track.file})`);
        return;
      }
      const first = i === 0;
      const last = i === plan.blocks.length - 1;
      const start = round(Math.max(N, N + b.start - (first ? 0 : xf / 2)), 3);
      const end = round(Math.min(narrEnd + 0.4, N + (last ? recDur : b.end) + (last ? 0.4 : xf / 2)), 3);
      const dur = round(end - start, 3);
      if (dur < 2) return;
      const bedFile = path.join(B, "assets", `bed-${b.id}.wav`);
      renderBed(src, bedFile, dur, { fadeIn: first ? 1.2 : xf, fadeOut: last ? 1.5 : xf });
      const trackLufs = loudness(src).lufs ?? -18;
      const targetUnder = (norm.outputLufs ?? cfg.narration.targetLufs) + (b.underSpeechDb ?? cfg.music.underSpeechDb);
      const base = round(clamp(dbToGain(targetUnder - trackLufs), 0.01, 2), 4);
      const pts = duckingPoints(speech, start, end, { liftDb: cfg.music.gapLiftDb, liftAfter: cfg.music.gapLiftAfter });
      const automation = JSON.stringify({ version: 1, lanes: [{ target: "volume", points: pts }] });
      audio.push(`<audio id="bed-${b.id}" class="clip" src="assets/bed-${b.id}.wav" data-start="${start}" data-duration="${dur}" data-track-index="${6 + i}" data-volume="${base}" data-automation='${escapeAttr(automation)}'></audio>`);
      beds.push({ id: b.id, start, end, base, trackLufs, targetUnderLufs: targetUnder, track: b.track, points: pts.length });
    });
    if (!plan.blocks.some((b) => b.track)) warnings.push("no background music assigned (run: storycut music auto <project>) — building without beds");
  }

  // letterbox + grain on top
  if (style.letterbox) {
    const lb = Math.round(H * style.letterbox);
    els.push(`<div id="letterbox" class="full" data-layout-ignore style="z-index:90;pointer-events:none"><div class="letterbox-bar" style="top:0"></div><div class="letterbox-bar" style="top:${H - lb}px"></div></div>`);
  }
  if (style.texture?.kind && style.texture.kind !== "none") {
    els.push(`<div id="grain" class="clip full grain" data-start="0" data-duration="${T}" data-track-index="40" data-layout-ignore style="z-index:91;pointer-events:none"></div>`);
    tw.push(`for (let i = 0; i < ${Math.floor(T * 12)}; i++) tl.set("#grain", { backgroundPosition: ((i * 73) % 240) + "px " + ((i * 151) % 240) + "px" }, i / 12);`);
  }

  const html = `<!doctype html>
<html lang="${cfg.channel.language || "en"}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=${W}, height=${H}" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
<style>${baseCss(style, cfg)}</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${T}" data-width="${W}" data-height="${H}">
${els.join("\n")}
${audio.join("\n")}
</div>
<script>
${MOTION_JS}
const tl = gsap.timeline({ paused: true });
${tw.join("\n")}
window.__timelines["main"] = tl;
tl.seek(0);
</script>
</body>
</html>
`;
  writeText(path.join(B, "index.html"), html);
  writeJSON(path.join(B, "hyperframes.json"), {
    $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
    paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
    media: { autoProxy: true },
  });
  writeJSON(path.join(B, "meta.json"), { id: slug(proj.name || "storycut"), name: proj.name || "storycut", createdAt: new Date().toISOString() });
  writeJSON(path.join(B, "package.json"), { name: slug(proj.name || "storycut-build"), private: true, type: "module", scripts: { dev: `npx --yes hyperframes@${HF_VERSION} preview`, check: `npx --yes hyperframes@${HF_VERSION} check`, render: `npx --yes hyperframes@${HF_VERSION} render` } });
  const buildPlan = {
    builtAt: new Date().toISOString(),
    style: style.id,
    duration: T,
    intro: { duration: introDur, video: introVid ? path.basename(introVid) : null, songStart: introEx.start, music: introHas ? path.basename(introMusic) : null, bpm: introBeats.bpm, beatsUsed: introBeats.beats.filter((b) => b < introDur).length },
    outro: { start: O, duration: outroDur, video: outroVid ? path.basename(outroVid) : null, songStart: outroEx.start, music: outroHas ? path.basename(outroMusic) : null, bpm: outroBeats.bpm },
    narration: { start: N, end: narrEnd, gain: narrGain, sourceLufs: narrLoud.lufs, sourceTruePeak: narrLoud.truePeak, normalizedLufs: norm.outputLufs, normalizedTruePeak: norm.outputTp, normalization: norm.mode, file: narrAudio, targetLufs: cfg.narration.targetLufs, isVideo },
    segments: vsegs.map((s) => ({ id: s.id, type: s.type, title: s.title, vstart: s.vstart, vend: s.vend })),
    sponsor: sponsorSegs.map((s) => ({ id: s.id, vstart: s.vstart, vend: s.vend })),
    beds,
    captions: { count: capsDoc.captions.length, offset: N, style: capStyle },
    ...report,
    warnings,
  };
  writeJSON(path.join(B, "storycut-plan.json"), buildPlan);
  return buildPlan;
}

function __inCode(tw, sel, t, preset, k) {
  tw.push(`__in(tl, "${sel}", ${round(t, 3)}, "${preset}", ${round(k, 3)});`);
}

export function captionsComposition(doc, style, cap, cfg) {
  const W = cfg.format.width;
  const H = cfg.format.height;
  const groups = [];
  const code = [];
  const anim = cap.animation || "pop";
  const colorOf = (v) => (v && style.colors[v]) || v;
  const baseColor = colorOf(cap.color);
  const onColor = colorOf(cap.activeColor);
  const onBg = cap.activeBg && cap.activeBg !== "none" ? colorOf(cap.activeBg) : "rgba(0,0,0,0)";
  const hasActive = onColor !== baseColor || onBg !== "rgba(0,0,0,0)";
  doc.captions.forEach((c, i) => {
    const id = `cg${i}`;
    const dur = round(Math.max(0.05, c.end - c.start), 3);
    const words = (c.words && c.words.length ? c.words : [{ text: c.text, start: c.start, end: c.end }]);
    groups.push(`<div id="${id}" class="clip cap-group" data-start="${round(c.start, 3)}" data-duration="${dur}"><span class="cap-line" id="${id}-l">${words.map((w, j) => `<span class="cap-w" id="${id}-w${j}">${escapeHtml(w.text)}</span>`).join(" ")}</span></div>`);
    if (anim === "pop") code.push(`tl.fromTo("#${id}-l", { scale: 0.86, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.14, ease: "back.out(2)" }, ${round(c.start, 3)});`);
    else if (anim === "fade") code.push(`tl.fromTo("#${id}-l", { opacity: 0 }, { opacity: 1, duration: 0.18 }, ${round(c.start, 3)});`);
    else if (anim === "highlight" || anim === "karaoke") code.push(`tl.fromTo("#${id}-l", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.12 }, ${round(c.start, 3)});`);
    if (hasActive && anim !== "none") {
      words.forEach((w, j) => {
        code.push(`tl.set("#${id}-w${j}", { color: "${onColor}", backgroundColor: "${onBg}" }, ${round(Math.max(c.start, w.start), 3)});`);
        code.push(`tl.set("#${id}-w${j}", { color: "${baseColor}", backgroundColor: "rgba(0,0,0,0)" }, ${round(Math.min(c.end - 0.01, Math.max(w.end, w.start + 0.05)), 3)});`);
      });
    }
    code.push(`tl.to("#${id}-l", { opacity: 0, duration: 0.06 }, ${round(Math.max(c.start + 0.16, c.end - 0.07), 3)});`);
  });
  return `<template>
  <style>
    #captions-root { position: absolute; inset: 0; }
    ${captionCss(style, cap)}
  </style>
  <div id="captions-root" data-composition-id="captions" data-width="${W}" data-height="${H}">
    ${groups.join("\n    ")}
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    ${code.join("\n    ")}
    window.__timelines["captions"] = tl;
  </script>
</template>
`;
}
