// Voiceover cleanup on a working copy. The original recording is never modified.
// Decisions come from the transcript (word timings + confidence) and the script, not from guessing:
//   - false starts (a fragment immediately restarted) and repeated takes → remove the weaker take
//   - long silences → shortened to a natural pause for their context (word / sentence / section)
//   - anything ambiguous is FLAGGED (kept) with timestamps and preview clips for the creator to decide
// Audio processing is chosen from measurements (denoise / hum removal only when actually present).
import path from "node:path";
import { existsSync, copyFileSync } from "node:fs";
import { loadConfig } from "./config.mjs";
import { parseScript, tokenize } from "./script.mjs";
import { align } from "./reconcile.mjs";
import { listenForNoises } from "./transcribe.mjs";
import { projectPaths } from "./build.mjs";
import { readJSON, writeJSON, writeText, readText, ensureDir, run, probe, loudness, normalizeLoudness, decodeMono, envelopeDb, fmtTime, round, sha256 } from "./util.mjs";

export const CLEAN_DEFAULTS = {
  maxNaturalPause: 0.9, // gaps up to this stay untouched
  pauseWithinSentence: 0.35,
  pauseBetweenSentences: 0.6,
  pauseBetweenSections: 0.95,
  lookbackSeconds: 90,
  crossfadeMs: 12,
  padBefore: 0.06,
  padAfter: 0.1,
  cutNoises: ["cough", "sneeze", "throat"], // noise kinds cut automatically by `clean noises` (others are flagged)
};

const FILLER = new Set(["um", "uh", "erm", "er", "ah", "hmm", "mm"]);
const norm = (t) => tokenize(t).map((x) => x.norm);

function lcsLen(a, b) {
  return align(a, b).filter((p) => p.a !== null && p.b !== null).length;
}

/** Split words into utterances at sentence ends and pauses. */
function utterances(words) {
  const out = [];
  let cur = null;
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (cur && prev && w.start - prev.end >= 0.6) {
      out.push(cur);
      cur = null;
    }
    if (!cur) cur = { a: i, b: i };
    cur.b = i;
    if (/[.!?…]["”')\]]*$/.test(w.text)) {
      out.push(cur);
      cur = null;
    }
  });
  if (cur) out.push(cur);
  return out.map((u, k) => {
    const ws = words.slice(u.a, u.b + 1);
    const toks = ws.flatMap((w) => norm(w.text));
    return {
      k,
      a: u.a,
      b: u.b,
      start: ws[0].start,
      end: ws.at(-1).end,
      text: ws.map((w) => w.text).join(" "),
      toks,
      complete: /[.!?…]["”')\]]*$/.test(ws.at(-1).text),
      p: ws.reduce((s, w) => s + (w.p ?? 1), 0) / ws.length,
      fillers: toks.filter((t) => FILLER.has(t)).length,
    };
  });
}

/** How well an utterance matches some window of the script (0..1), and how often that line occurs there. */
function scriptMatch(u, scriptToks, scriptStr) {
  if (!u.toks.length) return { score: 0, occurrences: 0 };
  // best window by LCS around candidate anchors (first token occurrences)
  let best = 0;
  const L = u.toks.length;
  const anchors = [];
  for (let i = 0; i < scriptToks.length; i++) if (scriptToks[i] === u.toks[0] || scriptToks[i] === u.toks[Math.min(1, L - 1)]) anchors.push(i);
  for (const i of anchors.slice(0, 200)) {
    const win = scriptToks.slice(Math.max(0, i - 2), i + L + 4);
    best = Math.max(best, lcsLen(u.toks, win) / L);
    if (best > 0.98) break;
  }
  const phrase = u.toks.slice(0, Math.min(L, 8)).join(" ");
  const occurrences = phrase.split(" ").length >= 4 ? scriptStr.split(phrase).length - 1 : 0;
  return { score: best, occurrences };
}

export function analyzeVoiceover(words, scriptDoc, opts = {}) {
  const o = { ...CLEAN_DEFAULTS, ...opts };
  const utts = utterances(words);
  const scriptToks = scriptDoc.words.map((w) => w.norm);
  const scriptStr = ` ${scriptToks.join(" ")} `;
  for (const u of utts) Object.assign(u, { script: scriptMatch(u, scriptToks, scriptStr) });
  const edits = [];
  const removed = new Set();
  const addEdit = (e) => edits.push({ id: `E${String(edits.length + 1).padStart(3, "0")}`, ...e });

  // production directions spoken to the editor ("cut again", "let's start from segment one")
  const DIRECTION = /\b(cut( it| that)?( again)?|let'?s (start|continue|go|try|do) (it )?(again|from|that)|from the top|take (two|2|three|3)|scratch that|that'?s for editing)\b/i;
  const CHATTER = /\b(segment (\d+|one|two|three|four|five|six|seven|eight|nine|ten)|next segment|second last segment|cl(au|ou|o)de? (says|said|told)|supposed to be at|\d+ minutes and \d+ seconds|outro music|yawning|sneeze|hello hello|long script|script is so boring|on script|off script)\b/i;
  const RISK = /\b(idiot|stupid|moron|killing|kill(ed|s)?|murder(ed|s)?|scam(mer)?s?|fraud|liar)\b/i;
  const PURE_DIRECTION = /^\W*(cut|cut (it|that)|cut again|again|scratch that|from the top|take (two|2|three|3))\W*$/i;
  const isDirection = new Set();
  for (const u of utts) {
    const offScript = u.script.score < 0.5;
    if ((offScript && DIRECTION.test(u.text) && u.toks.length <= 14) || (u.toks.length <= 4 && PURE_DIRECTION.test(u.text))) {
      isDirection.add(u.k);
      removed.add(u.k);
      addEdit({ type: "direction", status: "applied", confidence: 0.95, start: u.start, end: u.end, wordRange: [u.a, u.b], text: u.text, reason: "spoken instruction to the editor, not narration" });
    }
  }
  // the abandoned take right before a direction: incomplete / off-script fragments within 3 s of it
  for (const u of utts) {
    if (!isDirection.has(u.k)) continue;
    let prevStart = u.start;
    for (let i = u.k - 1; i >= 0 && i >= u.k - 4; i--) {
      const f = utts[i];
      if (removed.has(f.k)) {
        prevStart = f.start;
        continue;
      }
      if (prevStart - f.end > 3) break;
      if (f.complete && f.script.score >= 0.5) break;
      if (f.complete && f.toks.length > 3 && !/\b(segment|cut)\b/i.test(f.text)) break;
      removed.add(f.k);
      addEdit({ type: "abandoned-take", status: "applied", confidence: 0.85, start: f.start, end: f.end, wordRange: [f.a, f.b], text: f.text, reason: `unfinished line right before the instruction "${u.text}"` });
      prevStart = f.start;
    }
  }

  for (let j = 0; j < utts.length; j++) {
    const uj = utts[j];
    if (uj.toks.length < 2 || removed.has(uj.k)) continue;
    for (let i = j - 1; i >= 0 && uj.start - utts[i].end <= o.lookbackSeconds; i--) {
      const ui = utts[i];
      if (removed.has(ui.k) || ui.toks.length < 2) continue;
      // (a) false start: ui is a short fragment that the next utterance restarts
      if (i === j - 1 && ui.toks.length <= Math.max(2, uj.toks.length * 0.7)) {
        const head = uj.toks.slice(0, ui.toks.length + 2);
        const r = lcsLen(ui.toks, head) / ui.toks.length;
        if (r >= 0.8 && ui.toks[0] === uj.toks[0]) {
          const certain = !ui.complete || ui.toks.length <= 4;
          addEdit({ type: "false-start", status: certain ? "applied" : "flagged", confidence: round(r, 2), start: ui.start, end: ui.end, wordRange: [ui.a, ui.b], text: ui.text, kept: { start: uj.start, text: uj.text },
            reason: `restarted immediately: "${ui.text}" → "${uj.text.slice(0, 80)}"` });
          removed.add(ui.k);
          break;
        }
      }
      // (b) repeated take
      const minL = Math.min(ui.toks.length, uj.toks.length);
      const maxL = Math.max(ui.toks.length, uj.toks.length);
      if (minL < 4 || minL / maxL < 0.55) continue;
      const sim = lcsLen(ui.toks, uj.toks) / minL;
      if (sim < 0.7) continue;
      const intentional = Math.max(ui.script.occurrences, uj.script.occurrences) >= 2;
      if (intentional) {
        addEdit({ type: "repeat-kept", status: "kept", confidence: round(sim, 2), start: uj.start, end: uj.end, wordRange: [uj.a, uj.b], text: uj.text,
          reason: `repeated line also repeated in the script — treated as intentional` });
        break;
      }
      // choose the better take: script completeness, then confidence, fewer fillers; ties → the later take
      const score = (u) => u.script.score * 2 + (u.complete ? 0.3 : 0) + u.p * 0.5 - u.fillers * 0.15 + u.toks.length / maxL * 0.4;
      const si = score(ui);
      const sj = score(uj);
      const loser = si > sj + 0.05 ? uj : ui;
      const winner = loser === ui ? uj : ui;
      const gap = Math.abs(si - sj);
      const restarted = utts.slice(i + 1, j).some((u) => isDirection.has(u.k));
      const sure = (sim >= 0.85 && (gap >= 0.08 || loser === ui) && winner.script.score >= 0.75) || (restarted && loser === ui && sim >= 0.8);
      addEdit({
        type: "retake",
        status: sure ? "applied" : "flagged",
        confidence: round(sim, 2),
        start: loser.start,
        end: loser.end,
        wordRange: [loser.a, loser.b],
        text: loser.text,
        kept: { start: winner.start, text: winner.text },
        reason: `${sure ? "" : "UNSURE: "}take at ${fmtTime(loser.start)} repeats ${fmtTime(winner.start)} (similarity ${round(sim, 2)}); kept the ${loser === ui ? "later" : "earlier"} take (script match ${round(winner.script.score, 2)} vs ${round(loser.script.score, 2)})`,
      });
      removed.add(loser.k);
      if (loser === uj) break;
    }
  }
  // off-script passages: production chatter / risky claims are flagged; other commentary is kept and listed
  for (const u of utts) {
    if (removed.has(u.k) || u.script.score >= 0.5 || u.toks.length < 3) continue;
    if (edits.some((e) => e.wordRange && e.wordRange[0] <= u.a && e.wordRange[1] >= u.b)) continue;
    if (CHATTER.test(u.text)) addEdit({ type: "chatter", status: "flagged", confidence: 0.6, start: u.start, end: u.end, wordRange: [u.a, u.b], text: u.text, reason: "sounds like talk to yourself / the edit (segment numbers, runtime, notes) — kept until you decide" });
    else if (RISK.test(u.text)) addEdit({ type: "risk", status: "flagged", confidence: 0.6, start: u.start, end: u.end, wordRange: [u.a, u.b], text: u.text, reason: "off-script remark about a real person or claim — check it is fair and accurate before publishing (kept)" });
    else if (u.toks.length >= 6) addEdit({ type: "commentary", status: "kept", confidence: 0.5, start: u.start, end: u.end, wordRange: [u.a, u.b], text: u.text, reason: "off-script commentary — kept (your jokes/ad-libs)" });
  }
  edits.sort((x, y) => x.start - y.start);
  edits.forEach((e, n) => (e.id = `E${String(n + 1).padStart(3, "0")}`));
  return { utts, edits };
}

/** Build keep-ranges from applied removals, then shorten long gaps between kept words. */
export function planCuts(words, edits, scriptDoc, segBoundaries, opts = {}, silence = null) {
  const o = { ...CLEAN_DEFAULTS, ...opts };
  const unheard = [];
  // longest genuinely silent run inside [t0, t1] (null if the gap contains sound)
  const silentRun = (t0, t1) => {
    if (!silence) return { s: t0, e: t1 };
    let best = null;
    for (const r of silence.runs) {
      const s = Math.max(r.s, t0);
      const e = Math.min(r.e, t1);
      if (e - s > 0 && (!best || e - s > best.e - best.s)) best = { s, e };
    }
    return best;
  };
  const drop = new Uint8Array(words.length);
  for (const e of edits) if (e.status === "applied" && e.wordRange) for (let k = e.wordRange[0]; k <= e.wordRange[1]; k++) drop[k] = 1;
  const kept = words.map((w, i) => ({ ...w, i })).filter((w) => !drop[w.i]);
  // applied noise / manual cuts that sit in a gap between two kept words (a sneeze, a cough): cut that gap
  const gapCuts = edits.filter((e) => e.status === "applied" && (e.type === "noise" || e.type === "manual"));
  const forcedGap = (a, b) => gapCuts.some((e) => e.start < b.start - 0.02 && e.end > a.end + 0.02);
  const ranges = [];
  const pauses = [];
  let cur = { start: Math.max(0, kept[0].start - o.padBefore), end: kept[0].end + o.padAfter };
  for (let k = 1; k < kept.length; k++) {
    const a = kept[k - 1];
    const b = kept[k];
    const contiguous = b.i === a.i + 1 && !forcedGap(a, b);
    const gap = b.start - a.end;
    const sentenceEnd = /[.!?…]["”')\]]*$/.test(a.text);
    const section = segBoundaries.some((t) => t > a.end - 0.05 && t <= b.start + 0.05);
    const target = section ? o.pauseBetweenSections : sentenceEnd ? o.pauseBetweenSentences : o.pauseWithinSentence;
    if (contiguous && gap <= o.maxNaturalPause) {
      cur.end = b.end + o.padAfter;
      continue;
    }
    if (contiguous && gap > o.maxNaturalPause) {
      // shorten only inside a truly silent stretch, leaving ≈ target of pause
      const run_ = silentRun(a.end + 0.03, b.start - 0.03);
      const removable = run_ ? run_.e - run_.s - target : 0;
      if (!run_ || removable < 0.25) {
        // the gap has sound in it (speech the transcript missed, a laugh, a noise): never cut it blindly
        if (gap - (run_ ? run_.e - run_.s : 0) > 0.6) unheard.push({ start: round(a.end, 2), end: round(b.start, 2) });
        cur.end = b.end + o.padAfter;
        continue;
      }
      const mid = (run_.s + run_.e) / 2;
      cur.end = round(mid - target / 2, 4);
      ranges.push(cur);
      pauses.push({ at: round(a.end, 2), original: round(gap, 2), now: round(gap - removable, 2), kind: section ? "section" : sentenceEnd ? "sentence" : "word" });
      cur = { start: round(mid + target / 2, 4), end: b.end + o.padAfter };
      continue;
    }
    // a removed take (or a cut noise) sits between a and b: cut it out, leaving a natural pause
    const keepGap = Math.max(0, Math.min(gap, target) - o.padAfter - o.padBefore);
    cur.end = a.end + o.padAfter + keepGap / 2;
    ranges.push(cur);
    cur = { start: Math.max(cur.end, b.start - o.padBefore - keepGap / 2), end: b.end + o.padAfter };
  }
  ranges.push(cur);
  // merge overlaps
  const merged = [];
  for (const r of ranges) {
    if (merged.length && r.start <= merged.at(-1).end + 0.005) merged.at(-1).end = Math.max(merged.at(-1).end, r.end);
    else merged.push({ start: round(r.start, 4), end: round(r.end, 4) });
  }
  return { ranges: merged, pauses, unheard };
}

/** Map an original time to the cleaned timeline (null if it was cut). */
export function mapTime(ranges, t) {
  let acc = 0;
  for (const r of ranges) {
    if (t < r.start) return null;
    if (t <= r.end) return acc + (t - r.start);
    acc += r.end - r.start;
  }
  return null;
}

function extractPauses(file, pauses, out) {
  const sel = pauses.slice(0, 60);
  if (!sel.length) return null;
  const graph = sel.map((p, i) => `[0:a]atrim=start=${p.s.toFixed(3)}:end=${p.e.toFixed(3)},asetpts=PTS-STARTPTS[q${i}]`).join(";") + ";" + sel.map((_, i) => `[q${i}]`).join("") + `concat=n=${sel.length}:v=0:a=1[o]`;
  run("ffmpeg", ["-v", "error", "-y", "-i", file, "-filter_complex", graph, "-map", "[o]", "-ac", "1", out]);
  return out;
}

function bandLevel(file, band) {
  const r = run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", `${band},astats=measure_overall=RMS_level:measure_perchannel=0`, "-f", "null", "-"], { allowFail: true });
  const m = (r.stderr || "").match(/RMS level dB:\s*(-?[\d.]+|-inf)/g);
  if (!m) return null;
  const v = Number(m.at(-1).split(":")[1]);
  return Number.isFinite(v) ? Math.round(v * 10) / 10 : -120;
}

/** Measure the recording and decide the processing chain (and say why). */
export function decideChain(file, silentRuns, workDir) {
  // measured only in genuinely silent stretches (from the waveform), where hum/hiss/noise would be heard
  const pauses = silentRuns.filter((r) => r.e - r.s >= 0.3).map((r) => ({ s: r.s + 0.05, e: r.e - 0.05 }));
  ensureDir(workDir);
  const pf = extractPauses(file, pauses, path.join(workDir, "pauses.wav"));
  const broadband = pf ? bandLevel(pf, "anull") : null;
  const hum50 = pf ? bandLevel(pf, "bandpass=f=50:width_type=h:w=6") : null;
  const hum60 = pf ? bandLevel(pf, "bandpass=f=60:width_type=h:w=6") : null;
  const hiss = pf ? bandLevel(pf, "highpass=f=5000") : null;
  const filters = ["highpass=f=75:poles=2"];
  const notes = [`noise floor measured in ${pauses.length} silent stretches: ${broadband} dBFS RMS`];
  const humHz = hum50 !== null && hum60 !== null && Math.max(hum50, hum60) > -62 ? (hum50 > hum60 ? 50 : 60) : null;
  if (humHz) {
    for (const h of [1, 2, 3, 4]) filters.push(`equalizer=f=${humHz * h}:width_type=h:w=${4 + h}:g=-${h === 1 ? 24 : 14}`);
    notes.push(`mains hum detected at ${humHz} Hz (${Math.max(hum50, hum60)} dBFS in pauses) → notched ${humHz}/${humHz * 2}/${humHz * 3}/${humHz * 4} Hz`);
  } else notes.push(`no mains hum (50 Hz ${hum50}, 60 Hz ${hum60} dBFS) → no notch filters`);
  if (broadband !== null && broadband > -62) {
    const nf = Math.round(Math.max(-60, Math.min(-35, broadband + 3)));
    filters.push(`afftdn=nr=10:nf=${nf}:tn=1`);
    notes.push(`audible background noise → gentle spectral denoise (10 dB, floor ${nf} dB)`);
  } else notes.push(`background noise already very low → no denoise (avoids watery artefacts)`);
  if (hiss !== null && hiss > -66) {
    filters.push("highshelf=f=9000:g=-2.5");
    notes.push(`hiss above 5 kHz at ${hiss} dBFS → -2.5 dB shelf at 9 kHz`);
  } else notes.push(`no audible hiss (${hiss} dBFS above 5 kHz)`);
  filters.push("equalizer=f=250:width_type=o:w=1.2:g=-1.5", "equalizer=f=3200:width_type=o:w=1.4:g=1.5");
  notes.push("gentle EQ: -1.5 dB at 250 Hz (mud), +1.5 dB at 3.2 kHz (presence)");
  filters.push("deesser=i=0.25:m=0.5:f=0.5:s=o");
  notes.push("light de-essing");
  filters.push("acompressor=threshold=-20dB:ratio=2.2:attack=15:release=180:knee=6:makeup=1.5");
  notes.push("gentle compression: 2.2:1 above -20 dB, soft knee, 15/180 ms");
  return { filters, notes, measures: { broadband, hum50, hum60, hiss } };
}

/** Render the cleaned working copy: cut keep-ranges with short crossfades, process, loudness-normalise. */
export function renderClean(src, out, ranges, chain, { lufs = -16, crossfadeMs = 12, workDir }) {
  ensureDir(workDir);
  const f = crossfadeMs / 1000;
  const parts = ranges.map((r, i) => `[0:a]atrim=start=${r.start.toFixed(4)}:end=${r.end.toFixed(4)},asetpts=PTS-STARTPTS,afade=t=in:d=${f},afade=t=out:st=${Math.max(0, r.end - r.start - f).toFixed(4)}:d=${f}[p${i}]`);
  const graph = `${parts.join(";")};${ranges.map((_, i) => `[p${i}]`).join("")}concat=n=${ranges.length}:v=0:a=1,aformat=sample_rates=48000:channel_layouts=mono,${chain.filters.join(",")}[out]`;
  const graphFile = path.join(workDir, "cut-graph.txt");
  writeText(graphFile, graph);
  const cut = path.join(workDir, "cut-processed.wav");
  run("ffmpeg", ["-v", "error", "-y", "-i", src, "-filter_complex_script", graphFile, "-map", "[out]", "-c:a", "pcm_s24le", cut], { timeout: 3600000 });
  const n = normalizeLoudness(cut, out, { lufs, tp: -1.5 });
  return n;
}

// ------------------------------------------------------------------ project-level commands
function cleanPaths(dir) {
  const w = path.join(dir, "work", "clean");
  return {
    dir: w,
    edits: path.join(w, "edits.json"),
    manual: path.join(w, "manual-cuts.json"),
    noises: path.join(w, "noises.json"),
    log: path.join(dir, "edit-log.md"),
    previews: path.join(w, "previews"),
  };
}

/** Cleaned time under `ranges` → original recording time. */
function toOriginal(ranges, t) {
  let acc = 0;
  for (const r of ranges) {
    const len = r.end - r.start;
    if (t <= acc + len + 1e-6) return r.start + Math.max(0, t - acc);
    acc += len;
  }
  return ranges.at(-1).end;
}

/**
 * Move everything that lives on the cleaned timeline (transcript, captions, segments, music blocks) from an
 * old set of cut ranges to a new one. Words/captions inside new cuts are dropped; boundaries snap forward.
 */
export function remapCleaned(dir, oldRanges, newRanges) {
  const P = projectPaths(dir);
  const f = (t) => {
    const o = toOriginal(oldRanges, t);
    const m = mapTime(newRanges, o);
    return m === null ? null : round(m, 3);
  };
  const snap = (t) => {
    const o = toOriginal(oldRanges, t);
    const m = mapTime(newRanges, o);
    if (m !== null) return round(m, 3);
    let acc = 0;
    for (const r of newRanges) {
      if (r.start >= o) return round(acc, 3);
      acc += r.end - r.start;
    }
    return round(acc, 3);
  };
  const report = { words: 0, wordsDropped: 0, captions: 0, captionsDropped: 0 };
  const t = readJSON(P.transcript);
  const words = [];
  for (const w of t.words) {
    const s = f(w.start);
    const e = f(w.end);
    if (s === null || e === null || e < s) {
      report.wordsDropped++;
      continue;
    }
    words.push({ ...w, start: s, end: e });
  }
  words.forEach((w, i) => (w.id = `w${i}`));
  report.words = words.length;
  writeJSON(P.transcript, { ...t, words, remappedAt: new Date().toISOString() });
  if (existsSync(P.captions)) {
    const doc = readJSON(P.captions);
    const caps = [];
    for (const c of doc.captions) {
      if (c.words?.length) {
        const ws = c.words.map((w) => ({ ...w, start: f(w.start), end: f(w.end) })).filter((w) => w.start !== null && w.end !== null);
        if (!ws.length) {
          report.captionsDropped++;
          continue;
        }
        const kept = ws.length === c.words.length;
        caps.push({ ...c, words: ws, start: ws[0].start, end: ws.at(-1).end, text: kept ? c.text : ws.map((w) => w.text).join(" ") });
      } else {
        const s = f(c.start);
        const e = f(c.end);
        if (s === null || e === null) {
          report.captionsDropped++;
          continue;
        }
        caps.push({ ...c, start: s, end: e });
      }
    }
    report.captions = caps.length;
    writeJSON(P.captions, { ...doc, captions: caps });
  }
  for (const [file, key] of [[P.segments, "segments"], [P.music, "blocks"]]) {
    if (!existsSync(file)) continue;
    const d = readJSON(file);
    for (const x of d[key] || []) {
      x.start = snap(x.start);
      x.end = snap(x.end);
      for (const c of x.cues || []) if (typeof c.time === "number") c.time = snap(c.time);
    }
    writeJSON(file, d);
  }
  return report;
}

/** Creator-requested cuts (ORIGINAL recording time). Words whose middle falls inside are removed with the audio. */
function manualEdits(words, cuts) {
  return cuts.map((c) => {
    const idx = words.map((w, i) => ((w.start + w.end) / 2 >= c.start && (w.start + w.end) / 2 <= c.end ? i : -1)).filter((i) => i >= 0);
    return {
      id: "",
      type: "manual",
      status: "applied",
      confidence: 1,
      start: c.start,
      end: c.end,
      wordRange: idx.length ? [idx[0], idx.at(-1)] : null,
      text: idx.length ? idx.map((i) => words[i].text).join(" ") : "(no words — sound only)",
      reason: c.reason || "cut on request",
    };
  });
}

/**
 * Coughs / sneezes / throat clears heard by listenForNoises → the word gap that holds each one.
 * Kinds in `cut` are applied (restorable); other kinds are flagged. Laughs are never cut.
 */
function noiseEdits(words, noises, cut = ["cough", "sneeze", "throat"]) {
  const out = [];
  for (const n of noises) {
    if (n.kind === "laugh") continue;
    let best = null;
    for (let i = 0; i + 1 < words.length; i++) {
      const a = words[i].end;
      const b = words[i + 1].start;
      if (b - a < 0.25) continue;
      const d = n.t < a ? a - n.t : n.t > b ? n.t - b : 0;
      if (d <= 1.5 && (!best || d < best.d)) best = { a, b, d };
      if (a > n.t + 2) break;
    }
    if (!best || out.some((e) => e.start === round(best.a, 3))) continue;
    out.push({
      id: "",
      type: "noise",
      status: cut.includes(n.kind) ? "applied" : "flagged",
      confidence: best.d === 0 ? 0.9 : 0.7,
      start: round(best.a, 3),
      end: round(best.b, 3),
      wordRange: null,
      kind: n.kind,
      text: n.label,
      reason: `${n.kind} heard between words${cut.includes(n.kind) ? " — cut (restore to keep it)" : " — kept until you decide"}`,
    });
  }
  return out;
}

/** Add / remove / list creator-requested cuts, then re-render the working copy. */
export function addManualCut(dir, start, end, reason) {
  const C = cleanPaths(dir);
  if (!(end > start)) throw new Error("cut end must be after start");
  const d = readJSON(C.manual, { cuts: [] });
  d.cuts.push({ start: round(start, 3), end: round(end, 3), reason: reason || "cut on request", addedAt: new Date().toISOString() });
  d.cuts.sort((x, y) => x.start - y.start);
  writeJSON(C.manual, d);
  return runClean(dir);
}

export function removeManualCut(dir, n) {
  const C = cleanPaths(dir);
  const d = readJSON(C.manual, { cuts: [] });
  if (!d.cuts[n - 1]) throw new Error(`no manual cut #${n} (see: storycut clean <ep> cuts)`);
  d.cuts.splice(n - 1, 1);
  writeJSON(C.manual, d);
  return runClean(dir);
}

export function listManualCuts(dir) {
  return readJSON(cleanPaths(dir).manual, { cuts: [] }).cuts;
}

/** Listen for coughs/sneezes in the ORIGINAL recording (slow: re-hears it in windows), cache, re-run clean. */
export function detectNoises(dir, { model = "medium.en", onProgress } = {}) {
  const P = projectPaths(dir);
  const C = cleanPaths(dir);
  const proj = readJSON(P.project);
  const original = path.join(dir, proj.original?.file || proj.recording);
  const noises = listenForNoises(original, { model, workDir: path.join(C.dir, "noise-windows"), onProgress });
  if (!noises) throw new Error("whisper.cpp is not available — run storycut doctor");
  writeJSON(C.noises, { model, createdAt: new Date().toISOString(), noises });
  return { noises, ...runClean(dir) };
}

export function runClean(dir, opts = {}) {
  const P = projectPaths(dir);
  const C = cleanPaths(dir);
  const cfg = loadConfig(dir, { required: true });
  const proj = readJSON(P.project);
  const o = { ...CLEAN_DEFAULTS, ...(cfg.clean || {}), ...opts };
  const original = path.join(dir, proj.original?.file || proj.recording);
  if (proj.original?.sha256 && sha256(original) !== proj.original.sha256) throw new Error("original recording changed on disk — refusing to continue");
  // the analysis always runs on the ORIGINAL transcript
  const origT = path.join(dir, "work", "transcript.original.json");
  if (!existsSync(origT)) copyFileSync(P.transcript, origT);
  const transcript = readJSON(origT);
  const doc = parseScript(readText(path.join(dir, proj.script)));
  // previous decisions (restore / approve) survive re-runs
  const prev = readJSON(C.edits, { edits: [] });
  const { edits } = analyzeVoiceover(transcript.words, doc, o);
  edits.push(...manualEdits(transcript.words, readJSON(C.manual, { cuts: [] }).cuts));
  edits.push(...noiseEdits(transcript.words, readJSON(C.noises, { noises: [] }).noises, o.cutNoises));
  for (const e of edits) {
    const p = prev.edits.find((x) => x.type === e.type && Math.abs(x.start - e.start) < 0.05);
    if (p && p.decision) Object.assign(e, { status: p.status, decision: p.decision });
  }
  // section boundaries (script headings) → longer pauses there
  const segs = existsSync(P.segments) ? readJSON(P.segments).segments.filter((s) => s.recorded).map((s) => s.start) : [];
  // silence map from the waveform (20 ms frames): what is genuinely quiet vs. sound the transcript missed
  const hop = 0.02;
  const env = envelopeDb(decodeMono(original, 8000), 8000, hop);
  const sorted = [...env].sort((x, y) => x - y);
  const floor = sorted[Math.floor(sorted.length * 0.05)];
  const loud = sorted[Math.floor(sorted.length * 0.6)];
  // cuttable = well below speech (silence, room tone, soft breaths); "unheard" needs near-speech level
  const thr = Math.min(Math.max(floor + 12, -50), loud - 24);
  const speechThr = loud - 10;
  const runs = [];
  let rs = null;
  env.forEach((v, i) => {
    if (v < thr) {
      if (rs === null) rs = i;
    } else if (rs !== null) {
      if ((i - rs) * hop >= 0.15) runs.push({ s: round(rs * hop, 3), e: round(i * hop, 3) });
      rs = null;
    }
  });
  if (rs !== null) runs.push({ s: round(rs * hop, 3), e: round(env.length * hop, 3) });
  const { ranges, pauses, unheard: gapsWithSound } = planCuts(transcript.words, edits, doc, segs, o, { runs, thr });
  // only gaps holding ≥0.4 s of speech-level sound are worth asking about
  const unheard = gapsWithSound.filter((g) => {
    let v = 0;
    for (let i = Math.floor(g.start / hop); i < Math.min(env.length, Math.ceil(g.end / hop)); i++) if (env[i] > speechThr) v += hop;
    return v >= 0.4;
  });
  for (const u of unheard) edits.push({ id: "", type: "unheard-gap", status: "uncut", confidence: 0.5, start: u.start, end: u.end, text: "(sound with no transcribed words)", reason: "pause contains speech-level sound the transcript has no words for (a laugh, hum, breath or missed words) — left uncut" });
  edits.sort((x, y) => x.start - y.start);
  edits.forEach((e, n) => (e.id = `E${String(n + 1).padStart(3, "0")}`));
  const chain = decideChain(original, runs, C.dir);
  chain.notes.unshift(`silence threshold ${round(thr, 1)} dBFS (floor ${round(floor, 1)}, speech ~${round(loud, 1)})`);
  const outFile = path.join(dir, "recording", "cleaned", `${path.basename(original).replace(/\.[^.]+$/, "")}_clean.wav`);
  ensureDir(path.dirname(outFile));
  const norm = renderClean(original, outFile, ranges, chain, { lufs: cfg.narration.targetLufs, crossfadeMs: o.crossfadeMs, workDir: C.dir });
  // cleaned transcript (word times mapped through the cuts)
  const mapped = [];
  for (const w of transcript.words) {
    const s = mapTime(ranges, w.start);
    const e = mapTime(ranges, w.end);
    if (s === null || e === null) continue;
    mapped.push({ ...w, start: round(s, 3), end: round(e, 3), orig: [w.start, w.end] });
  }
  mapped.forEach((w, i) => (w.id = `w${i}`));
  // If the cleaned voiceover was re-transcribed (better model, corrected names) and caption edits were made,
  // carry them through the new cuts instead of replacing them with the original-recording transcript.
  const cur = readJSON(P.transcript, null);
  let carried = null;
  if (prev.ranges?.length && cur && !cur.cleanedFrom && cur.source === path.basename(outFile)) {
    carried = remapCleaned(dir, prev.ranges, ranges);
  } else {
    writeJSON(P.transcript, { ...transcript, source: path.basename(outFile), cleanedFrom: path.basename(original), words: mapped });
  }
  // edits get their position on the cleaned timeline too (where the cut / flag now sits)
  for (const e of edits) e.cleanAt = round(mapTime(ranges, e.status === "applied" ? (e.kept?.start ?? e.start) : e.start) ?? 0, 2);
  const origDur = probe(original).duration;
  const newDur = probe(outFile).duration;
  const summary = {
    original: { file: path.relative(dir, original), duration: round(origDur, 2), sha256: proj.original?.sha256 || sha256(original) },
    cleaned: { file: path.relative(dir, outFile), duration: round(newDur, 2), lufs: norm.outputLufs, truePeak: norm.outputTp },
    removedSeconds: round(origDur - newDur, 1),
    pausesShortened: pauses.length,
    pauseSecondsRemoved: round(pauses.reduce((a, p) => a + (p.original - p.now), 0), 1),
    retakesRemoved: edits.filter((e) => e.type === "retake" && e.status === "applied").length,
    falseStartsRemoved: edits.filter((e) => e.type === "false-start" && e.status === "applied").length,
    flagged: edits.filter((e) => e.status === "flagged").length,
    keptRepeats: edits.filter((e) => e.type === "repeat-kept").length,
    commentaryKept: edits.filter((e) => e.type === "commentary").length,
    chain: chain.notes,
    filters: chain.filters,
  };
  writeJSON(C.edits, { createdAt: new Date().toISOString(), options: o, summary, edits, ranges, pauses });
  writeText(C.log, editLog(summary, edits, pauses));
  proj.recording = path.relative(dir, outFile);
  writeJSON(P.project, proj);
  return { summary, edits, carried };
}

function editLog(s, edits, pauses) {
  const L = [
    "# Voiceover edit log",
    "",
    `Original (untouched): \`${s.original.file}\` · ${fmtTime(s.original.duration)} · sha256 ${s.original.sha256.slice(0, 12)}…`,
    `Working copy: \`${s.cleaned.file}\` · ${fmtTime(s.cleaned.duration)} · ${s.cleaned.lufs} LUFS · ${s.cleaned.truePeak} dBTP`,
    "",
    `Removed ${s.removedSeconds}s: ${s.pausesShortened} long pauses shortened (${s.pauseSecondsRemoved}s), ${s.retakesRemoved} repeated takes, ${s.falseStartsRemoved} false starts. **${s.flagged} edit(s) need your decision.** ${s.keptRepeats} repetition(s) kept as intentional; ${s.commentaryKept} off-script commentary passages kept (listed below).`,
    "",
    "## Processing chain (decided from measurements)",
    "",
    ...s.chain.map((n) => `- ${n}`),
    "- two-pass EBU R128 loudness normalisation with a -1.5 dBTP ceiling",
    "",
  ];
  const flagged = edits.filter((e) => e.status === "flagged");
  if (flagged.length) {
    L.push("## Needs your decision (kept in the video until you approve)", "", "| id | original time | in cleaned VO | what | suggestion |", "|---|---|---|---|---|");
    for (const e of flagged) L.push(`| ${e.id} | ${fmtTime(e.start)}–${fmtTime(e.end)} | ~${fmtTime(e.cleanAt)} | ${e.type}: "${e.text.slice(0, 90)}" | ${e.reason.replace(/\|/g, "/")} |`);
    L.push("", "Listen: `storycut clean <ep> preview E012` · cut it: `storycut clean <ep> approve E012` · keep it: `storycut clean <ep> reject E012`", "");
  }
  const uncut = edits.filter((e) => e.status === "uncut");
  if (uncut.length) L.push(`## Pauses left uncut because they contain sound (${uncut.length})`, "", "Not cut automatically. Listen with `storycut clean <ep> preview <id>`; `approve` to tighten one.", "", ...uncut.map((e) => `- ${e.id} ${fmtTime(e.start)}–${fmtTime(e.end)} (≈${fmtTime(e.cleanAt)} in cleaned VO)`), "");
  L.push("## Applied edits", "", "| id | type | original time | removed text | kept instead | status |", "|---|---|---|---|---|---|");
  for (const e of edits.filter((x) => x.status === "applied" || x.status === "restored" || x.status === "kept")) {
    L.push(`| ${e.id} | ${e.type} | ${fmtTime(e.start)}–${fmtTime(e.end)} | ${e.text.slice(0, 80).replace(/\|/g, "/")} | ${e.kept ? `${fmtTime(e.kept.start)} "${e.kept.text.slice(0, 50).replace(/\|/g, "/")}"` : "—"} | ${e.status} |`);
  }
  L.push("", "Undo any of them: `storycut clean <ep> restore E007` (then the video is rebuilt from the re-rendered working copy).", "");
  L.push(`## Pauses shortened (${pauses.length})`, "", ...pauses.map((p) => `- ${fmtTime(p.at)}: ${p.original}s → ${p.now}s (${p.kind})`), "");
  return L.join("\n");
}

export function setDecision(dir, id, decision) {
  const C = cleanPaths(dir);
  const data = readJSON(C.edits);
  const e = data.edits.find((x) => x.id === id);
  if (!e) throw new Error(`no edit ${id}`);
  e.status = decision === "approve" ? "applied" : decision === "restore" || decision === "reject" ? "restored" : e.status;
  e.decision = decision;
  writeJSON(C.edits, data);
  return runClean(dir);
}

/** Before/after clips for one edit (or any original time range). */
export function previewEdit(dir, id) {
  const P = projectPaths(dir);
  const C = cleanPaths(dir);
  const proj = readJSON(P.project);
  const data = readJSON(C.edits);
  const e = data.edits.find((x) => x.id === id);
  if (!e) throw new Error(`no edit ${id}`);
  ensureDir(C.previews);
  const original = path.join(dir, proj.original?.file);
  const before = path.join(C.previews, `${id}-before.mp3`);
  const after = path.join(C.previews, `${id}-after.mp3`);
  const from = Math.max(0, e.start - 3);
  const to = (e.kept && e.kept.start > e.start ? Math.max(e.end, e.kept.start + 4) : e.end + 3);
  run("ffmpeg", ["-v", "error", "-y", "-ss", String(from), "-t", String(to - from), "-i", original, "-ac", "1", "-b:a", "128k", before]);
  const cs = Math.max(0, (mapTime(data.ranges, from) ?? e.cleanAt - 3));
  run("ffmpeg", ["-v", "error", "-y", "-ss", String(cs), "-t", String(Math.max(4, to - from - (e.status === "applied" ? e.end - e.start : 0))), "-i", path.join(dir, proj.recording), "-ac", "1", "-b:a", "128k", after]);
  return { before, after, edit: e };
}

export { mapTime as mapCleanTime };
void envelopeDb;
void decodeMono;
void loudness;
