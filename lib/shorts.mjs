// Vertical shorts (1080×1920) rebuilt from the edited long video: the creator's own words only, jump-cut
// from chosen parts of the recording, with a hook on frame 0, a headline card, sentence panels, 3-word
// captions, emoji beats, stat/logo pops, a slightly louder ducked bed and an end card for the full episode.
//
// Spec: <project>/shorts.json
// { "fullEpisode": "My Show #002",
//   "shorts": [{ "id": "short-01", "hook": "…", "headline": "…", "title": "…",
//                "parts": [[from, to], …],          // ORIGINAL-recording seconds (stable across re-cleans)
//                "emoji": [{ "on": "paid", "e": "💸" }],
//                "fixes": { "10k.": "10-K." },      // spelling-only caption fixes (never change what was said)
//                "description": "…", "source": "https://…", "hashtags": ["#shorts"] }] }
import path from "node:path";
import { existsSync, rmSync } from "node:fs";
import { loadConfig, loadStyle } from "./config.mjs";
import { baseCss, captionCss, onColor } from "./css.mjs";
import { MOTION_JS } from "./motion.mjs";
import { decorLayer } from "./decor.mjs";
import { findStats, findEntities, DEFAULT_ENTITIES, icon } from "./graphics.mjs";
import { projectPaths, twemoji, HF_VERSION } from "./build.mjs";
import { generateCaptions } from "./captions.mjs";
import { renderBed, duckingPoints, speechIntervals, trackPath, readLedger } from "./music.mjs";
import { mapTime } from "./clean.mjs";
import { readJSON, writeJSON, writeText, ensureDir, copyInto, probe, loudness, normalizeLoudness, dbToGain, clamp, round, escapeHtml, escapeAttr, run, slug } from "./util.mjs";

const W = 1080;
const H = 1920;
// vertical safe band: keep text between y 168 and 1330 and clear of the right-hand action rail (x > 960)
const SAFE = { top: 200, bottom: 1330, left: 60, right: 960 };

function cleanRanges(dir) {
  const f = path.join(dir, "work", "clean", "edits.json");
  return existsSync(f) ? readJSON(f).ranges || null : null;
}

/** Original-recording time → current working-copy time (snaps forward out of a cut). */
function toWorking(ranges, t) {
  if (!ranges) return t;
  const m = mapTime(ranges, t);
  if (m !== null) return m;
  let acc = 0;
  for (const r of ranges) {
    if (r.start >= t) return acc;
    acc += r.end - r.start;
  }
  return acc;
}

/** Working-copy time → original-recording time (to write parts into shorts.json). */
export function toOriginalTime(dir, t) {
  const ranges = cleanRanges(dir);
  if (!ranges) return t;
  let acc = 0;
  for (const r of ranges) {
    const len = r.end - r.start;
    if (t <= acc + len + 1e-6) return round(r.start + Math.max(0, t - acc), 3);
    acc += len;
  }
  return ranges.at(-1).end;
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9$%']/g, "");

function sentences(words) {
  const out = [];
  let cur = [];
  for (const w of words) {
    cur.push(w);
    const end = /[.!?…]["”')\]]*$/.test(w.text);
    const soft = /[,;:]$/.test(w.text) && cur.length >= 7;
    if (end || soft || cur.length >= 13) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  // fold tiny fragments into the previous panel
  return out.reduce((a, s) => {
    if (a.length && s.length < 3) a.at(-1).push(...s);
    else a.push(s);
    return a;
  }, []);
}

function shortsCss(style) {
  const c = style.colors;
  const s = style.shape;
  const border = s.border ? `${s.border}px solid ${c.ink}` : "none";
  const shadow = s.shadow === "none" ? "none" : `${s.shadowX}px ${s.shadowY}px 0 ${c[s.shadow] || s.shadow}`;
  return `
  .hook { position: absolute; left: ${SAFE.left}px; top: 250px; width: ${SAFE.right - SAFE.left}px; }
  .hook-in { display: inline-block; font-family: var(--display); font-weight: var(--display-weight); font-size: 84px; line-height: 1.02; padding: 22px 30px 28px; background: ${c.accent2 || c.accent}; color: ${onColor(c.accent2 || c.accent)}; border: ${border}; box-shadow: ${shadow}; border-radius: ${s.radius}px; transform: rotate(-2deg); }
  .head { position: absolute; left: ${SAFE.left}px; top: 230px; width: ${SAFE.right - SAFE.left}px; display: flex; flex-direction: column; align-items: flex-start; gap: 14px; }
  .head-k { font-family: var(--mono); font-size: 30px; letter-spacing: 0.06em; padding: 8px 14px; background: ${c.ink}; color: ${c.accent}; border-radius: 8px; }
  .head-t { font-family: var(--display); font-weight: var(--display-weight); font-size: 66px; line-height: 1.04; padding: 14px 24px 20px; background: ${c.accent}; color: ${onColor(c.accent)}; border: ${border}; box-shadow: ${shadow}; border-radius: ${s.radius}px; }
  .panel { position: absolute; left: ${SAFE.left}px; top: 620px; width: ${SAFE.right - SAFE.left}px; }
  .panel-in { display: inline-block; font-family: var(--display); font-weight: var(--display-weight); line-height: 1.08; padding: 22px 28px 28px; background: ${c.paper}; color: ${c.ink}; border: ${border}; box-shadow: ${shadow}; border-radius: ${s.radius}px; }
  .sem { position: absolute; width: 300px; height: 300px; filter: drop-shadow(8px 8px 0 ${c.ink}); }
  .sem img { width: 100%; height: 100%; display: block; }
  .sstat { position: absolute; left: ${SAFE.left}px; width: ${SAFE.right - SAFE.left}px; top: 640px; display: flex; justify-content: center; }
  .sstat-n { font-family: var(--display); font-weight: var(--display-weight); font-size: 150px; line-height: 1; padding: 12px 28px 20px; background: var(--chip); color: var(--chip-ink); border: ${border}; box-shadow: ${shadow}; border-radius: ${s.radius}px; }
  .slogo { position: absolute; left: 50%; top: 660px; transform: translateX(-56%); display: flex; align-items: center; gap: 20px; padding: 18px 30px 18px 22px; background: ${c.paper}; border: ${border}; box-shadow: ${shadow}; border-radius: ${s.radius}px; }
  .slogo img { width: 110px; height: 110px; } .slogo span { font-family: var(--display); font-size: 64px; color: ${c.ink}; }
  .endc { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px; background: var(--bg); }
  .endc-k { font-family: var(--display); font-size: 92px; padding: 10px 26px 18px; background: ${c.paper}; border: ${border}; box-shadow: ${shadow}; border-radius: ${s.radius}px; }
  .endc-t { font-family: var(--mono); font-size: 40px; letter-spacing: 0.03em; }
  .endc-e { font-family: var(--display); font-size: 70px; padding: 14px 28px 20px; background: ${c.accent}; color: ${onColor(c.accent)}; border: ${border}; box-shadow: ${shadow}; border-radius: ${s.radius}px; text-align: center; max-width: 900px; }
  `;
}

/** Build one short into <project>/shorts-build/<id>/ (a HyperFrames project). */
export async function buildShort(dir, short, spec = {}) {
  const P = projectPaths(dir);
  const cfg = loadConfig(dir, { required: true });
  const proj = readJSON(P.project);
  const style = loadStyle(proj.style || cfg.style, cfg);
  const transcript = readJSON(P.transcript);
  const recFile = path.join(dir, proj.recording);
  const ranges = cleanRanges(dir);
  const B = path.join(dir, "shorts-build", short.id);
  if (existsSync(B)) rmSync(B, { recursive: true, force: true });
  ensureDir(path.join(B, "assets"));
  const A = (f, name) => `assets/${path.basename(copyInto(f, path.join(B, "assets"), name))}`;
  const fixes = short.fixes || {};

  // ---- parts → word-accurate cut points on the working copy
  const parts = [];
  let acc = 0;
  const words = [];
  for (const [from, to] of short.parts) {
    const a = toWorking(ranges, from);
    const b = toWorking(ranges, to);
    const ws = transcript.words.filter((w) => w.start >= a - 0.08 && w.end <= b + 0.12);
    if (!ws.length) throw new Error(`${short.id}: no words between ${from}s and ${to}s`);
    const next = transcript.words.find((w) => w.start > ws.at(-1).end);
    const prev = [...transcript.words].reverse().find((w) => w.end < ws[0].start);
    const cs = round(Math.max(prev ? prev.end + 0.02 : 0, ws[0].start - 0.1), 3);
    const ce = round(Math.min(next ? next.start - 0.03 : ws.at(-1).end + 0.25, ws.at(-1).end + 0.22), 3);
    parts.push({ cs, ce, at: round(acc, 3) });
    for (const w of ws) words.push({ text: fixes[w.text] ?? w.text, start: round(acc + w.start - cs, 3), end: round(acc + w.end - cs, 3), p: w.p });
    acc += ce - cs;
  }
  const Dv = round(acc, 3);
  if (Dv > 60) throw new Error(`${short.id}: ${Dv}s of speech — YouTube Shorts must stay under 60 s`);
  const ENDCARD = 2.2;
  const T = round(Dv + 0.25 + ENDCARD, 3);

  // ---- voice: jump-cut parts with 12 ms fades, normalised a little louder for phones (-14 LUFS)
  const raw = path.join(B, "assets", "voice-raw.wav");
  const graph = parts.map((p, i) => `[0:a]atrim=start=${p.cs}:end=${p.ce},asetpts=PTS-STARTPTS,afade=t=in:d=0.012,afade=t=out:st=${round(p.ce - p.cs - 0.012, 3)}:d=0.012[p${i}]`).join(";") + ";" + parts.map((_, i) => `[p${i}]`).join("") + `concat=n=${parts.length}:v=0:a=1[o]`;
  run("ffmpeg", ["-v", "error", "-y", "-i", recFile, "-filter_complex", graph, "-map", "[o]", "-ar", "48000", "-ac", "1", raw]);
  const voice = path.join(B, "assets", "voice.wav");
  const vn = normalizeLoudness(raw, voice, { lufs: -14, tp: -1.5 });
  rmSync(raw, { force: true });

  const els = [];
  const tw = [];
  const audio = [`<audio id="voice" class="clip" src="assets/voice.wav" data-start="0" data-duration="${Dv}" data-track-index="2" data-volume="1"></audio>`];
  els.push(`<div id="ground" class="full ground" style="z-index:1"></div>`);

  // decor for the whole short
  if (style.decor && style.decor.kind !== "none") {
    const d = decorLayer({ style, W, H, id: "decor", seed: short.id.length * 7 + 3, start: 0, duration: T, z: 2 });
    els.push(d.html);
    tw.push(...d.tweens);
  }

  // hook on frame 0 (already visible — never open on an empty frame), then the headline card
  const hookEnd = round(Math.min(3, Dv * 0.3), 3);
  els.push(`<div id="hook" class="clip full" data-start="0" data-duration="${hookEnd}" data-track-index="3" style="z-index:30"><div class="hook"><div class="hook-in" id="hook-in">${escapeHtml(short.hook)}</div></div></div>`);
  tw.push(`tl.fromTo("#hook-in", { scale: 1 }, { scale: 1.04, duration: 0.35, ease: "sine.inOut", yoyo: true, repeat: 3 }, 0.1);`);
  tw.push(`__out(tl, "#hook-in", ${round(hookEnd - 0.2, 3)}, 0.18);`);
  els.push(`<div id="head" class="clip full" data-start="${hookEnd}" data-duration="${round(Dv - hookEnd, 3)}" data-track-index="4" style="z-index:20"><div class="head" id="head-in"><div class="head-k">${escapeHtml(spec.fullEpisode || cfg.channel.series || cfg.channel.name)}</div><div class="head-t">${escapeHtml(short.headline || short.title)}</div></div></div>`);
  tw.push(`__in(tl, "#head-in", ${round(hookEnd + 0.02, 3)}, "${style.motion.enter}", 1);`);

  // sentence panels: a new beat with every sentence (what was actually said)
  const sens = short.panels ? sentences(words) : [];
  sens.forEach((sen, i) => {
    const t0 = round(Math.max(i === 0 ? hookEnd : 0, sen[0].start - 0.05), 3);
    const t1 = round(sens[i + 1] ? Math.max(t0 + 0.4, sens[i + 1][0].start - 0.05) : Dv, 3);
    if (t1 - t0 < 0.4) return;
    const text = sen.map((w) => w.text).join(" ").replace(/^["“]|["”]$/g, "");
    const size = text.length > 80 ? 54 : text.length > 50 ? 62 : text.length > 28 ? 74 : 90;
    els.push(`<div id="pn${i}" class="clip full" data-start="${t0}" data-duration="${round(t1 - t0, 3)}" data-track-index="5" style="z-index:10"><div class="panel"><div class="panel-in" id="pn${i}-in" style="font-size:${size}px">${escapeHtml(text)}</div></div></div>`);
    tw.push(`__in(tl, "#pn${i}-in", ${t0}, "${i % 2 ? "pop" : style.motion.enter}", 0.8);`);
  });

  // the "pop" stage above the captions: one visual at a time (emoji beats, spoken numbers, company logos)
  const busy = [];
  const slot = (t, d) => {
    for (let at = t; at <= t + 0.8; at += 0.1) if (!busy.some(([a, b]) => at < b && at + d > a)) return busy.push([at, at + d]), round(at, 3);
    return null;
  };
  let en = 0;
  for (const e of short.emoji || []) {
    const w = words.find((x) => x.start >= hookEnd - 0.5 && norm(x.text).startsWith(norm(e.on))) || words.find((x) => norm(x.text).startsWith(norm(e.on)));
    const f = w && (await twemoji(e.e));
    if (!f) continue;
    const at = slot(Math.max(hookEnd, w.start - 0.05), 1.9);
    if (at === null) continue;
    const id = `se${en++}`;
    els.push(`<div id="${id}" class="clip full" data-start="${at}" data-duration="1.9" data-track-index="6" style="z-index:28"><div class="sem" id="${id}-in" style="left:${en % 2 ? 330 : 420}px;top:600px"><img src="${A(f, `emoji-${path.basename(f)}`)}" alt=""></div></div>`);
    tw.push(`__in(tl, "#${id}-in", ${at}, "burst", 1);`);
    tw.push(`tl.fromTo("#${id}-in", { rotation: -6 }, { rotation: 6, duration: 0.4, ease: "sine.inOut", yoyo: true, repeat: 2 }, ${round(at + 0.3, 3)});`);
    tw.push(`__out(tl, "#${id}-in", ${round(at + 1.65, 3)}, 0.2);`);
  }

  // spoken numbers and companies (transcript-driven, same rules as the long video)
  const chip = style.colors.accent3 || style.colors.accent;
  for (const [k, st] of findStats(words, { minGap: 6 }).entries()) {
    const at = slot(Math.max(hookEnd, st.t - 0.1), 2.8);
    if (at === null || at + 2.8 > Dv) continue;
    const id = `ss${k}`;
    const suf = st.suffix.startsWith("%") ? st.suffix : st.suffix ? " " + st.suffix : "";
    els.push(`<div id="${id}" class="clip full" data-start="${at}" data-duration="2.8" data-track-index="7" style="z-index:26;--chip:${chip};--chip-ink:${onColor(chip)}"><div class="sstat" id="${id}-in"><div class="sstat-n">${escapeHtml(st.prefix)}<span id="${id}-v">0</span>${escapeHtml(suf)}</div></div></div>`);
    tw.push(`__in(tl, "#${id}-in", ${at}, "pop", 1);`);
    tw.push(`tl.fromTo("#${id}-v", { innerText: 0 }, { innerText: ${st.value}, duration: 0.8, ease: "power2.out", snap: { innerText: ${st.decimals ? 1 / 10 ** st.decimals : 1} } }, ${round(at + 0.08, 3)});`);
    tw.push(`__out(tl, "#${id}-in", ${round(at + 2.55, 3)}, 0.2);`);
  }
  const ents = findEntities(words, [{ start: 0, end: Dv }], { ...DEFAULT_ENTITIES, ...(cfg.graphics?.entities || {}) }, { minGap: 4 });
  for (const [k, e] of ents.entries()) {
    if (e.t < hookEnd) continue;
    const f = await icon(e.slug);
    if (!f) continue;
    const at = slot(e.t - 0.05, 2.6);
    if (at === null) continue;
    const id = `sl${k}`;
    els.push(`<div id="${id}" class="clip full" data-start="${at}" data-duration="2.6" data-track-index="8" style="z-index:24"><div class="slogo" id="${id}-in"><img src="${A(f, `logo-${e.slug}.svg`)}" alt=""><span>${escapeHtml(e.name)}</span></div></div>`);
    tw.push(`__in(tl, "#${id}-in", ${at}, "pop", 1);`);
    tw.push(`__out(tl, "#${id}-in", ${round(at + 2.35, 3)}, 0.2);`);
  }

  // 3-word captions, inline (inside the safe band, clear of the action rail)
  const caps = generateCaptions(words, { wordsPerGroup: 3, maxCharsPerLine: 22, minDuration: 0.35 });
  const cap = { ...style.captions, ...(cfg.captions.style || {}), size: 96, position: "bottom", offset: H - 1200, maxWidth: SAFE.right - SAFE.left, case: "upper" };
  const colorOf = (v) => (v && style.colors[v]) || v;
  caps.forEach((c, i) => {
    const id = `cg${i}`;
    els.push(`<div id="${id}" class="clip cap-group" data-start="${c.start}" data-duration="${round(Math.max(0.05, c.end - c.start), 3)}" data-track-index="9" style="z-index:40;right:${W - SAFE.right}px;left:${SAFE.left}px"><span class="cap-line" id="${id}-l">${c.words.map((w, j) => `<span class="cap-w" id="${id}-w${j}">${escapeHtml(w.text)}</span>`).join(" ")}</span></div>`);
    tw.push(`tl.fromTo("#${id}-l", { scale: 0.86, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.12, ease: "back.out(2)" }, ${c.start});`);
    c.words.forEach((w, j) => {
      tw.push(`tl.set("#${id}-w${j}", { color: "${colorOf(cap.activeColor)}", backgroundColor: "${cap.activeBg && cap.activeBg !== "none" ? colorOf(cap.activeBg) : "rgba(0,0,0,0)"}" }, ${round(Math.max(c.start, w.start), 3)});`);
      tw.push(`tl.set("#${id}-w${j}", { color: "${colorOf(cap.color)}", backgroundColor: "rgba(0,0,0,0)" }, ${round(Math.min(c.end - 0.01, Math.max(w.end, w.start + 0.05)), 3)});`);
    });
  });

  // end card: where to watch the full episode
  const E0 = round(Dv + 0.25, 3);
  els.push(`<div id="endc" class="clip full" data-start="${E0}" data-duration="${ENDCARD}" data-track-index="10" style="z-index:60"><div class="endc" id="endc-in"><div class="endc-k">${escapeHtml(cfg.channel.name)}</div><div class="endc-t">FULL EPISODE</div><div class="endc-e">${escapeHtml(spec.fullEpisode || cfg.channel.series || "")}</div></div></div>`);
  tw.push(`__in(tl, "#endc-in", ${E0}, "pop", 1);`);

  // music: the long video's bed for this moment, ducked, a little louder than in the long video
  let bed = null;
  const plan = existsSync(P.music) ? readJSON(P.music) : null;
  const firstCs = parts[0].cs;
  const block = plan?.blocks?.find((b) => b.track && firstCs >= b.start - 0.5 && firstCs < b.end) || plan?.blocks?.find((b) => b.track);
  if (block && cfg.music.beds !== false) {
    const entry = readLedger(cfg).tracks[block.track.key];
    const src = entry ? trackPath(cfg, entry) : null;
    if (src && existsSync(src)) {
      const len = probe(src).duration;
      const offset = round(Math.max(0, Math.min(firstCs - block.start, len - T - 1)), 3);
      renderBed(src, path.join(B, "assets", "bed.wav"), T, { fadeIn: 0.3, fadeOut: 1.2, offset: offset > 0 ? offset : 0 });
      const trackLufs = loudness(src).lufs ?? -18;
      const under = (vn.outputLufs ?? -14) + (block.underSpeechDb ?? cfg.music.underSpeechDb) + 4;
      const base = round(clamp(dbToGain(under - trackLufs), 0.01, 2), 4);
      const pts = duckingPoints(speechIntervals(words), 0, T, { liftDb: cfg.music.gapLiftDb, liftAfter: 0.8 });
      audio.push(`<audio id="bed" class="clip" src="assets/bed.wav" data-start="0" data-duration="${T}" data-track-index="3" data-volume="${base}" data-automation='${escapeAttr(JSON.stringify({ version: 1, lanes: [{ target: "volume", points: pts }] }))}'></audio>`);
      bed = { title: block.track.title, licence: block.track.licenseLabel || block.track.license, gain: base };
    }
  }

  const css = baseCss(style, { ...cfg, format: { ...cfg.format, width: W, height: H } }) + captionCss(style, cap) + shortsCss(style);
  const html = `<!doctype html>
<html lang="${cfg.channel.language || "en"}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=${W}, height=${H}" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
<style>${css}</style>
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
  writeJSON(path.join(B, "hyperframes.json"), { $schema: "https://hyperframes.heygen.com/schema/hyperframes.json", paths: { blocks: "compositions", components: "compositions/components", assets: "assets" }, media: { autoProxy: true } });
  writeJSON(path.join(B, "meta.json"), { id: slug(short.id), name: short.id, createdAt: new Date().toISOString() });
  writeJSON(path.join(B, "package.json"), { name: slug(`${proj.name}-${short.id}`), private: true, type: "module" });
  const info = { id: short.id, duration: T, speech: Dv, parts: parts.map((p) => [p.cs, p.ce]), captions: caps.length, panels: sens.length, voiceLufs: vn.outputLufs, bed, dir: B };
  writeJSON(path.join(B, "short-plan.json"), info);
  return info;
}

export function loadShorts(dir) {
  const f = path.join(dir, "shorts.json");
  if (!existsSync(f)) throw new Error(`no ${f} — write the clip picks there first (see references/shorts.md)`);
  return readJSON(f);
}

/** Render a built short to <project>/renders/<id>.mp4. */
export function renderShort(dir, id, { quality } = {}) {
  const P = projectPaths(dir);
  const B = path.join(dir, "shorts-build", id);
  ensureDir(P.renders);
  const out = path.join(P.renders, `${id}.mp4`);
  const chk = run("npx", ["-y", `hyperframes@${HF_VERSION}`, "check"], { cwd: B, allowFail: true, timeout: 900000 });
  if (chk.status !== 0) throw new Error(`hyperframes check failed for ${id}:\n${(chk.stdout + chk.stderr).slice(-3000)}`);
  const args = ["-y", `hyperframes@${HF_VERSION}`, "render", "--output", out];
  if (quality) args.push("--quality", quality);
  run("npx", args, { cwd: B, timeout: 2 * 60 * 60 * 1000 });
  return out;
}
