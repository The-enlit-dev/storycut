// Final quality checks on a rendered video. Every check reports pass / warn / fail with evidence.
import path from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "./config.mjs";
import { projectPaths } from "./build.mjs";
import { parseScript, tokenize } from "./script.mjs";
import { align } from "./reconcile.mjs";
import { validateCaptions } from "./captions.mjs";
import { speechIntervals } from "./music.mjs";
import { readJSON, readText, writeJSON, writeText, loudness, probe, run, fmtTime, round } from "./util.mjs";

const normTokens = (text) => tokenize(text).map((t) => t.norm);

function matchRate(a, b) {
  const pairs = align(a, b);
  const m = pairs.filter((p) => p.a !== null && p.b !== null).length;
  return { rate: m / Math.max(1, Math.max(a.length, b.length)), pairs };
}

export function runQc(projectDir, { render } = {}) {
  const P = projectPaths(projectDir);
  const cfg = loadConfig(projectDir, { required: true });
  const proj = readJSON(P.project);
  const plan = readJSON(path.join(P.build, "storycut-plan.json"));
  const transcript = readJSON(P.transcript);
  const caps = readJSON(P.captions);
  const renderFile = render || path.join(P.renders, `${proj.name}.mp4`);
  const checks = [];
  const add = (area, name, status, detail) => checks.push({ area, name, status, detail });

  // 0. render exists and has the planned length
  if (!existsSync(renderFile)) {
    add("render", "Rendered file", "fail", `missing: ${renderFile}`);
    return finish(projectDir, checks, renderFile);
  }
  const info = probe(renderFile);
  const dDiff = Math.abs(info.duration - plan.duration);
  add("render", "Duration matches the edit", dDiff <= 0.6 ? "pass" : "fail", `render ${info.duration.toFixed(2)}s vs plan ${plan.duration.toFixed(2)}s`);
  add("render", "Has video and audio", info.hasVideo && info.hasAudio ? "pass" : "fail", `video ${info.hasVideo}, audio ${info.hasAudio}, ${info.width}×${info.height}`);

  // 1. loudness and narration clarity
  const L = loudness(renderFile);
  add("audio", "Integrated loudness", L.lufs !== null && L.lufs >= -18 && L.lufs <= -12 ? "pass" : "warn", `${L.lufs} LUFS (YouTube normalises to about -14; aim for -16…-13)`);
  add("audio", "True peak", L.truePeak !== null && L.truePeak <= -0.5 ? "pass" : "fail", `${L.truePeak} dBTP (keep ≤ -1 dBTP)`);
  if (plan.narration.normalizedLufs != null) add("audio", "Narration level", Math.abs(plan.narration.normalizedLufs - plan.narration.targetLufs) <= 1 ? "pass" : "warn", `recording ${plan.narration.sourceLufs} LUFS / ${plan.narration.sourceTruePeak} dBTP → normalised to ${plan.narration.normalizedLufs} LUFS / ${plan.narration.normalizedTruePeak} dBTP (${plan.narration.normalization})`);

  // 2. music under speech: compare the final mix with the gained narration in the same windows
  const N = plan.narration.start;
  const gainDb = 20 * Math.log10(plan.narration.gain);
  const recFile = path.join(projectDir, proj.recording);
  const voiceFile = plan.narration.file ? path.join(P.build, plan.narration.file) : recFile; // what actually went into the mix
  const speech = speechIntervals(transcript.words, 0.25).filter((s) => s.end - s.start >= 2.5);
  const sample = speech.filter((_, i) => i % Math.max(1, Math.floor(speech.length / 8)) === 0).slice(0, 8);
  const deltas = [];
  for (const s of sample) {
    const d = Math.min(3, s.end - s.start);
    const voice = loudness(voiceFile, { start: s.start, duration: d, mono: true }).lufs;
    const mix = loudness(renderFile, { start: N + s.start, duration: d, mono: true }).lufs;
    if (voice !== null && mix !== null) deltas.push({ t: N + s.start, delta: mix - (voice + gainDb) });
  }
  if (plan.beds?.length && deltas.length) {
    const avg = deltas.reduce((a, b) => a + b.delta, 0) / deltas.length;
    const worst = deltas.reduce((a, b) => (b.delta > a.delta ? b : a));
    // music level relative to voice from the energy sum: 10^(Δ/10) = 1 + 10^(m/10)
    const rel = (d) => (d <= 0.01 ? -30 : 10 * Math.log10(Math.max(1e-6, 10 ** (d / 10) - 1)));
    const status = worst.delta > 3 ? "fail" : worst.delta > 1.5 ? "warn" : "pass";
    add("audio", "Speech stays clear over music", status, `music adds ${avg.toFixed(2)} dB on average under speech (≈ ${rel(avg).toFixed(1)} dB below the voice); worst ${worst.delta.toFixed(2)} dB at ${fmtTime(worst.t)}`);
  } else if (!plan.beds?.length) add("audio", "Background music", "warn", "no music beds in this edit");
  // music audible in pauses
  if (plan.beds?.length) {
    const words = transcript.words;
    const gaps = [];
    for (let i = 1; i < words.length; i++) if (words[i].start - words[i - 1].end > 1.8) gaps.push({ start: words[i - 1].end + 0.5, dur: words[i].start - words[i - 1].end - 0.8 });
    const g = gaps.slice(0, 5).map((x) => loudness(renderFile, { start: N + x.start, duration: Math.max(0.4, x.dur) }).lufs).filter((v) => v !== null && Number.isFinite(v));
    if (g.length) {
      const avg = g.reduce((a, b) => a + b, 0) / g.length;
      add("audio", "Music level in pauses", avg > -40 && avg < -20 ? "pass" : "warn", `${avg.toFixed(1)} LUFS in ${g.length} pauses (bed should be audible but not loud)`);
    }
    add("audio", "Music changes", plan.beds.length <= Math.max(2, Math.ceil(plan.duration / cfg.music.minBlockSeconds)) ? "pass" : "warn", `${plan.beds.length} bed(s): ${plan.beds.map((b) => `${b.id} "${b.track.title}" (${b.track.license})`).join("; ")}`);
  }

  // 3. intro / outro
  if (plan.intro.duration) {
    const il = loudness(renderFile, { start: 0, duration: plan.intro.duration }).lufs;
    const music = !!plan.intro.music;
    add("intro/outro", "Intro plays at the start", plan.narration.start >= plan.intro.duration - cfg.intro.narrationOverlap - 0.01 ? "pass" : "fail", `intro 0–${plan.intro.duration}s, narration starts ${plan.narration.start}s`);
    if (plan.intro.video) add("intro/outro", "Intro music audible and synced", il !== null && il > -35 ? "pass" : "warn", `pre-rendered brand intro ${plan.intro.video}: ${il} LUFS (beat sync baked in by brand render)`);
    else add("intro/outro", "Intro music audible and synced", !music ? "warn" : il !== null && il > -35 && plan.intro.beatsUsed > 0 ? "pass" : "warn", music ? `${plan.intro.music}: ${il} LUFS, ${plan.intro.beatsUsed} beats detected (${plan.intro.bpm} BPM) drive the visuals` : "no intro song set (intro.music in storycut.config.json)");
  }
  if (plan.outro.duration) {
    const ol = loudness(renderFile, { start: plan.outro.start, duration: plan.outro.duration }).lufs;
    add("intro/outro", "Outro follows the narration", plan.outro.start >= plan.narration.end ? "pass" : "fail", `narration ends ${plan.narration.end}s, outro ${plan.outro.start}–${round(plan.outro.start + plan.outro.duration, 2)}s`);
    add("intro/outro", "Outro music audible", !(plan.outro.music || plan.outro.video) ? "warn" : ol !== null && ol > -35 ? "pass" : "warn", (plan.outro.video || plan.outro.music) ? `${plan.outro.video || plan.outro.music}: ${ol} LUFS` : "no outro song set (outro.music)");
  }

  // 4. captions vs the actual recorded speech
  const capWords = caps.captions.flatMap((c) => normTokens(c.text));
  const spoken = transcript.words.flatMap((w) => normTokens(w.text));
  const cm = matchRate(capWords, spoken);
  add("captions", "Captions match the recorded speech", cm.rate >= 0.98 ? "pass" : cm.rate >= 0.93 ? "warn" : "fail", `${(cm.rate * 100).toFixed(1)}% word match (${capWords.length} caption words / ${spoken.length} spoken)`);
  const issues = validateCaptions(caps, { maxCps: cfg.captions.maxCharsPerSecond, minDuration: Math.min(0.5, cfg.captions.minDuration), rangeEnd: probe(recFile).duration });
  const errs = issues.filter((i) => i.level === "error");
  add("captions", "Caption timing", errs.length ? "fail" : issues.length > caps.captions.length * 0.05 ? "warn" : "pass", errs.length ? errs.slice(0, 6).map((i) => `${i.id}: ${i.msg}`).join("; ") : `${issues.length} minor issue(s) in ${caps.captions.length} captions${issues.length ? ": " + issues.slice(0, 4).map((i) => `${i.id} ${i.msg}`).join("; ") : ""}`);
  // every spoken word is on screen during a caption
  let uncovered = 0;
  const firstMiss = [];
  for (const w of transcript.words) {
    const mid = (w.start + w.end) / 2;
    if (!caps.captions.some((c) => mid >= c.start - 0.05 && mid <= c.end + 0.05)) {
      uncovered++;
      if (firstMiss.length < 4) firstMiss.push(`"${w.text}" @ ${fmtTime(w.start)}`);
    }
  }
  add("captions", "Every spoken word is captioned", uncovered === 0 ? "pass" : uncovered < 4 ? "warn" : "fail", uncovered ? `${uncovered} word(s) not covered, e.g. ${firstMiss.join(", ")}` : `all ${transcript.words.length} words covered`);

  // 5. structure: segments, transitions, cuts
  const segs = plan.segments;
  const carded = segs.filter((s) => plan.cards.some((c) => c.segment === s.id));
  const needCard = segs.filter((s) => !["hook", "intro", "sponsor", "outro"].includes(s.type));
  add("structure", "Segments are clearly separated", needCard.every((s) => carded.includes(s)) && segs.length >= 2 ? "pass" : "fail", `${segs.length} segments; ${carded.length} with title cards (${[...new Set(segs.map((s) => s.type))].join(", ")})`);
  const perMin = plan.transitions.length / Math.max(1, plan.duration / 60);
  const tooClose = plan.transitions.filter((t, i, a) => i && t.at - a[i - 1].at < 8);
  add("structure", "Transitions are not excessive", perMin <= 4 && !tooClose.length ? "pass" : "warn", `${plan.transitions.length} transitions (${perMin.toFixed(1)}/min)${tooClose.length ? `; ${tooClose.length} within 8s of the previous one` : ""}`);
  const short = segs.filter((s) => s.vend - s.vstart < 6 && !["hook", "intro"].includes(s.type));
  add("structure", "No awkwardly short segments", short.length ? "warn" : "pass", short.length ? short.map((s) => `${s.id} ${(s.vend - s.vstart).toFixed(1)}s`).join(", ") : "all segments ≥ 6s");
  const words = transcript.words;
  const dead = [];
  for (let i = 1; i < words.length; i++) if (words[i].start - words[i - 1].end > 2.5) dead.push(`${fmtTime(N + words[i - 1].end)} (${(words[i].start - words[i - 1].end).toFixed(1)}s)`);
  add("structure", "No dead air in the narration", dead.length ? "warn" : "pass", dead.length ? `pauses > 2.5s at ${dead.slice(0, 6).join(", ")}` : "no pauses over 2.5s");
  const bd = run("ffmpeg", ["-hide_banner", "-nostats", "-i", renderFile, "-vf", "blackdetect=d=0.6:pix_th=0.06", "-an", "-f", "null", "-"], { allowFail: true }).stderr;
  const blacks = [...bd.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const unexpected = blacks.filter(([a]) => a > 0.5 && a < plan.duration - 2.5);
  add("structure", "No missing/black picture", unexpected.length ? "fail" : "pass", unexpected.length ? unexpected.map(([a, b]) => `${fmtTime(a)}–${fmtTime(b)}`).join(", ") : "no black frames inside the edit");
  add("structure", "Script cues rendered", plan.unrendered.length ? "warn" : "pass", plan.unrendered.length ? `${plan.unrendered.length} cue(s) need real media: ${plan.unrendered.slice(0, 5).map((u) => `${u.segment} ${u.kind}`).join(", ")} (see build/storycut-plan.json)` : `${plan.emoji} emoji, ${plan.memes} memes, ${plan.textCards} text cards, ${plan.lowerThirds} lower thirds, ${plan.sfx} sfx`);

  // 6. sponsor
  if (cfg.sponsor.enabled) {
    const sp = plan.sponsor[0];
    if (!sp) add("sponsor", "Sponsor message included", "fail", "no sponsor segment in the edit");
    else {
      const dur = sp.vend - sp.vstart;
      const spokenIn = transcript.words.filter((w) => w.start + N >= sp.vstart && w.start + N < sp.vend).map((w) => w.text).join(" ").toLowerCase();
      const named = cfg.sponsor.name && spokenIn.replace(/[^a-z0-9]/g, "").includes(cfg.sponsor.name.toLowerCase().replace(/[^a-z0-9]/g, ""));
      add("sponsor", "Sponsor message included", named ? "pass" : "warn", `${fmtTime(sp.vstart)}–${fmtTime(sp.vend)} (${dur.toFixed(1)}s)${named ? "" : ` — "${cfg.sponsor.name}" not heard in that segment`}`);
      add("sponsor", "Sponsor length", dur <= cfg.sponsor.maxSeconds + 2 ? "pass" : "warn", `${dur.toFixed(1)}s (max ${cfg.sponsor.maxSeconds}s)`);
    }
  }

  // 7. final script = what was said
  const asRec = path.join(projectDir, "script.as-recorded.md");
  if (existsSync(asRec)) {
    const sw = parseScript(readText(asRec)).words.map((w) => w.norm);
    const r = matchRate(sw, spoken);
    add("script", "Final script matches the recording", r.rate >= 0.99 ? "pass" : r.rate >= 0.95 ? "warn" : "fail", `${(r.rate * 100).toFixed(1)}% word match between script.as-recorded.md and the transcript`);
  } else add("script", "Final script matches the recording", "fail", "script.as-recorded.md missing — run storycut reconcile");
  const q = readJSON(P.questions, []);
  const open = q.filter((x) => x.status === "open");
  add("script", "No unresolved unclear audio", open.length ? "fail" : "pass", open.length ? open.map((x) => `${x.id} @ ${x.at} "${x.heard}"`).join("; ") : `${q.length} question(s), all resolved`);
  if (plan.warnings?.length) add("build", "Build warnings", "warn", plan.warnings.join(" | "));
  return finish(projectDir, checks, renderFile);
}

function finish(projectDir, checks, renderFile) {
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  const icon = { pass: "✅", warn: "⚠️", fail: "❌" };
  const md = [
    `# QC report`,
    "",
    `Render: \`${path.basename(renderFile)}\` · ${new Date().toISOString()}`,
    "",
    `**${fails ? "NOT READY" : "READY"}** — ${checks.length - fails - warns} passed, ${warns} warnings, ${fails} failed`,
    "",
    "| | Area | Check | Detail |",
    "|---|---|---|---|",
    ...checks.map((c) => `| ${icon[c.status]} | ${c.area} | ${c.name} | ${String(c.detail).replace(/\|/g, "/")} |`),
    "",
  ].join("\n");
  writeText(path.join(projectDir, "qc", "report.md"), md);
  writeJSON(path.join(projectDir, "qc", "report.json"), { renderFile, checks, fails, warns });
  return { checks, fails, warns, md };
}
