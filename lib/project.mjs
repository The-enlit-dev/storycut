// Project lifecycle: new → transcribe → reconcile (questions) → captions → music → build → render → qc.
import path from "node:path";
import { existsSync, copyFileSync, renameSync } from "node:fs";
import { loadConfig } from "./config.mjs";
import { parseScript } from "./script.mjs";
import { transcribe, transcribeWindow } from "./transcribe.mjs";
import { reconcile, asRecordedScript, reconcileReport, exportQuestionClips, applyAnswer, align } from "./reconcile.mjs";
import { tokenize } from "./script.mjs";
import { generateCaptions, newCaptionsDoc } from "./captions.mjs";
import { fmtTime } from "./util.mjs";
import { projectPaths } from "./build.mjs";
import { readJSON, writeJSON, writeText, readText, ensureDir, sha256, round, slug, probe, decodeMono, envelopeDb } from "./util.mjs";

export function newProject(dir, { script, recording, style, name, episodeLabel, nextLabel }) {
  if (!script || !existsSync(script)) throw new Error("--script <file.md> is required");
  ensureDir(path.join(dir, "recording"));
  ensureDir(path.join(dir, "work"));
  copyFileSync(script, path.join(dir, "script.original.md"));
  let rec = null;
  if (recording) {
    if (!existsSync(recording)) throw new Error(`recording not found: ${recording}`);
    rec = path.join("recording", `narration${path.extname(recording)}`);
    copyFileSync(recording, path.join(dir, rec));
  }
  const proj = { name: name || slug(path.basename(path.resolve(dir))), createdAt: new Date().toISOString(), script: "script.original.md", recording: rec, style: style || null, episodeLabel: episodeLabel || "", nextLabel: nextLabel || "" };
  writeJSON(path.join(dir, "storycut.project.json"), proj);
  return proj;
}

export function setRecording(dir, recording) {
  const P = projectPaths(dir);
  const proj = readJSON(P.project);
  const rec = path.join("recording", `narration${path.extname(recording)}`);
  ensureDir(path.join(dir, "recording"));
  copyFileSync(recording, path.join(dir, rec));
  proj.recording = rec;
  writeJSON(P.project, proj);
  return proj;
}

export function runTranscribe(dir, opts = {}) {
  const P = projectPaths(dir);
  const cfg = loadConfig(dir, { required: true });
  const proj = readJSON(P.project);
  if (!proj.recording) throw new Error("no recording yet — storycut recording <project> <file>");
  // answers were applied to the previous transcript; a new transcript needs them asked again
  if (existsSync(P.questions)) renameSync(P.questions, P.questions.replace(/\.json$/, `-${Date.now()}.json`));
  const t = transcribe(path.join(dir, proj.recording), P.transcript, {
    model: opts.model || cfg.transcription.model,
    language: cfg.transcription.language,
    engine: opts.engine || cfg.transcription.engine,
    from: opts.from,
  });
  return t;
}

/** Align recording and script; write as-recorded script, segments, questions; create captions if missing. */
export function runReconcile(dir, { regenCaptions = false } = {}) {
  const P = projectPaths(dir);
  const cfg = loadConfig(dir, { required: true });
  const proj = readJSON(P.project);
  const md = readText(path.join(dir, proj.script));
  const doc = parseScript(md);
  const transcript = readJSON(P.transcript);
  const rec = reconcile(doc, transcript, { uncertainBelow: cfg.transcription.uncertainBelow });

  // keep earlier answers; add new open questions
  const prev = readJSON(P.questions, []);
  const resolved = prev.filter((q) => q.status !== "open");
  const missing = probeOmissions(dir, cfg, proj, doc, transcript, rec, resolved);
  const unheard = findUnheard(dir, proj, transcript, rec, resolved).filter((u) => !missing.some((m) => m.start < u.end + 0.5 && m.end > u.start - 0.5));
  const fresh = [...rec.questions, ...missing, ...unheard].sort((x, y) => x.start - y.start);
  const questions = [...resolved, ...fresh.map((q, i) => ({ ...q, id: `U${resolved.length + i + 1}` }))];
  exportQuestionClips(path.join(dir, proj.recording), questions, path.join(dir, "work", "questions"));
  writeJSON(P.questions, questions);
  writeJSON(path.join(dir, "work", "reconcile.json"), { stats: rec.stats, diffs: rec.diffs });
  writeText(path.join(dir, "work", "reconcile.md"), reconcileReport({ ...rec, questions }, transcript));
  writeJSON(P.segments, { generatedAt: new Date().toISOString(), segments: rec.segments });
  writeText(path.join(dir, "script.as-recorded.md"), asRecordedScript(doc, md, transcript, rec));

  let captionsNote = "kept existing captions.json (your edits are preserved)";
  if (!existsSync(P.captions) || regenCaptions) {
    const caps = generateCaptions(transcript.words, { ...cfg.captions, wordsPerGroup: cfg.captions.style?.wordsPerGroup || cfg.captions.wordsPerGroup });
    writeJSON(P.captions, newCaptionsDoc(caps, { generatedFrom: { transcript: "work/transcript.json", sha256: sha256(P.transcript) } }));
    captionsNote = `generated ${caps.length} captions`;
  }
  return { rec, questions, captionsNote };
}

/**
 * A script line that is missing from the transcript may have been skipped — or spoken but not heard
 * (noise, mumbling, whisper dropping it). Re-listen around it with the script as a hint; if the second
 * pass hears it, ask the creator instead of assuming either way.
 */
function probeOmissions(dir, cfg, proj, doc, transcript, rec, resolved) {
  const out = [];
  const audio = path.join(dir, proj.recording);
  const words = transcript.words;
  for (const d of rec.diffs) {
    if (d.kind !== "omitted" || !d.scriptRange) continue;
    const n = d.scriptRange[1] - d.scriptRange[0] + 1;
    if (n < 3) continue;
    if (resolved.some((q) => q.kind === "missing" && q.scriptExpected === d.script)) continue;
    const from = Math.max(0, d.scriptRange[0] - 12);
    const to = Math.min(doc.words.length - 1, d.scriptRange[1] + 12);
    const prompt = doc.words.slice(from, to + 1).map((w) => w.text).join(" ");
    const ws = transcribeWindow(audio, d.start - 4, d.start + 4, prompt, { model: cfg.transcription.model, workDir: path.join(dir, "work", "relisten") });
    if (!ws) continue;
    const target = doc.words.slice(d.scriptRange[0], d.scriptRange[1] + 1).map((w) => w.norm);
    const toks = [];
    ws.forEach((w, i) => tokenize(w.text).forEach((t) => toks.push({ norm: t.norm, w: i })));
    const pairs = align(target, toks.map((t) => t.norm)).filter((p) => p.a !== null && p.b !== null);
    if (pairs.length / target.length < 0.6) continue; // genuinely not there: it was skipped
    const wi = [...new Set(pairs.map((p) => toks[p.b].w))];
    const heardWords = ws.slice(wi[0], wi.at(-1) + 1);
    const start = heardWords[0].start;
    const end = heardWords.at(-1).end;
    let insertAfter = -1;
    for (let k = 0; k < words.length; k++) if (words[k].start < start) insertAfter = k;
    out.push({
      kind: "missing",
      status: "open",
      start: round(start),
      end: round(end),
      at: fmtTime(start),
      heard: heardWords.map((w) => w.text).join(" "),
      confidence: round(Math.min(...heardWords.map((w) => w.p ?? 0)), 2),
      before: words.slice(Math.max(0, insertAfter - 5), insertAfter + 1).map((w) => w.text).join(" "),
      after: words.slice(insertAfter + 1, insertAfter + 7).map((w) => w.text).join(" "),
      scriptExpected: d.script,
      insertAfter,
      candidate: heardWords.map((w) => ({ text: w.text, start: round(w.start), end: round(w.end), p: w.p })),
      note: "this script line was not in the first transcript, but a second listen heard something like it",
    });
  }
  return out;
}

/**
 * Speech-level audio with no transcribed words (a mumbled or noisy line, a laugh, a cough). Never assume:
 * if a script line is missing nearby, say so — the creator tells us what it was, or that it wasn't speech.
 */
function findUnheard(dir, proj, transcript, rec, resolved) {
  const words = transcript.words;
  if (words.length < 2) return [];
  const rate = 8000;
  const hop = 0.05;
  const env = envelopeDb(decodeMono(path.join(dir, proj.recording), rate), rate, hop);
  const inWord = new Uint8Array(env.length);
  for (const w of words) for (let i = Math.floor(w.start / hop); i <= Math.min(env.length - 1, Math.ceil(w.end / hop)); i++) inWord[i] = 1;
  const speech = env.filter((_, i) => inWord[i]).sort((a, b) => a - b);
  const gapsDb = env.filter((_, i) => !inWord[i]).sort((a, b) => a - b);
  if (!speech.length || !gapsDb.length) return [];
  const speechMed = speech[Math.floor(speech.length / 2)];
  const floor = gapsDb[Math.floor(gapsDb.length * 0.2)];
  const thr = Math.max(floor + 15, speechMed - 18);
  const out = [];
  for (let k = 0; k < words.length - 1; k++) {
    const a = words[k].end + 0.12;
    const b = words[k + 1].start - 0.12;
    if (b - a < 0.6) continue;
    let first = null;
    let last = null;
    let voiced = 0;
    for (let i = Math.floor(a / hop); i < Math.floor(b / hop); i++) {
      if (env[i] > thr) {
        voiced += hop;
        if (first === null) first = i * hop;
        last = (i + 1) * hop;
      }
    }
    if (voiced < 0.5) continue;
    if (resolved.some((q) => q.kind === "unheard" && Math.abs(q.start - first) < 0.3)) continue;
    const near = rec.diffs.find((d) => d.kind === "omitted" && d.start >= words[k].end - 0.6 && d.start <= words[k + 1].start + 0.6);
    out.push({
      kind: "unheard",
      status: "open",
      start: round(first),
      end: round(last),
      at: fmtTime(first),
      heard: "",
      confidence: 0,
      before: words.slice(Math.max(0, k - 5), k + 1).map((w) => w.text).join(" "),
      after: words.slice(k + 1, k + 7).map((w) => w.text).join(" "),
      scriptExpected: near ? rec.diffs.filter((d) => d.kind === "omitted" && d.start >= words[k].end - 0.6 && d.start <= words[k + 1].start + 0.6).map((d) => d.script).join(" ") : null,
      insertAfter: k,
      candidate: [],
      note: `${voiced.toFixed(1)}s of speech-level audio with no transcribed words`,
    });
  }
  return out;
}

/** Insert words the first transcript missed, keeping neighbours from overlapping them. */
function insertWords(transcript, afterIdx, newWords) {
  const w = transcript.words;
  w.splice(afterIdx + 1, 0, ...newWords);
  w.sort((a, b) => a.start - b.start);
  for (let i = 1; i < w.length; i++) if (w[i - 1].end > w[i].start) w[i - 1].end = round(Math.max(w[i - 1].start + 0.05, w[i].start));
  w.forEach((x, i) => (x.id = `w${i}`));
}

/** Apply the creator's answer to an unclear passage (or keep what was heard), then re-sync everything. */
export function resolveQuestion(dir, id, { text, keep, skip }) {
  const P = projectPaths(dir);
  const questions = readJSON(P.questions, []);
  const q = questions.find((x) => x.id === id);
  if (!q) throw new Error(`no question ${id}`);
  if (q.status !== "open") throw new Error(`${id} is already ${q.status}`);
  const transcript = readJSON(P.transcript);
  if (q.kind === "missing" || q.kind === "unheard") {
    if (keep && !q.candidate?.length) throw new Error(`${id}: nothing was transcribed here — give the words, or --skip if it wasn't speech`);
    if (skip) q.answer = null; // creator confirms the line was not said
    else {
      const ws = keep ? q.candidate.map((w) => ({ ...w, p: 1, resolved: id })) : spreadText(text, q.start, q.end, id);
      if (!ws.length) throw new Error('give the words that were said, or --keep / --skip');
      insertWords(transcript, q.insertAfter, ws);
      q.answer = ws.map((w) => w.text).join(" ");
    }
  } else if (skip) {
    throw new Error("--skip is only for missing lines; for unclear words give the text or --keep");
  } else if (keep) {
    for (let k = q.wordRange[0]; k <= q.wordRange[1]; k++) Object.assign(transcript.words[k], { p: 1, resolved: id });
    q.answer = q.heard;
  } else {
    if (!text) throw new Error('give the words that were said, e.g. resolve U1 "Hacktron"');
    applyAnswer(transcript, q, text);
    q.answer = text;
  }
  q.status = "resolved";
  q.resolvedAt = new Date().toISOString();
  writeJSON(P.transcript, transcript);
  writeJSON(P.questions, questions);
  syncCaptionsFromTranscript(dir, q.start - 0.05, q.end + 0.05);
  fillUncoveredCaptions(dir);
  return runReconcile(dir);
}

function spreadText(text, start, end, id) {
  const toks = String(text || "").trim().split(/\s+/).filter(Boolean);
  const total = toks.reduce((a, t) => a + Math.max(1, t.length), 0) || 1;
  let t = start;
  return toks.map((tok) => {
    const d = ((end - start) * Math.max(1, tok.length)) / total;
    const w = { text: tok, start: round(t), end: round(t + d), p: 1, resolved: id };
    t += d;
    return w;
  });
}

/** Create captions for transcript words that no caption covers (e.g. after inserting a missed line). */
export function fillUncoveredCaptions(dir) {
  const P = projectPaths(dir);
  if (!existsSync(P.captions)) return 0;
  const cfg = loadConfig(dir, { required: true });
  const caps = readJSON(P.captions);
  const words = readJSON(P.transcript).words;
  const covered = (w) => caps.captions.some((c) => (w.start + w.end) / 2 >= c.start - 0.02 && (w.start + w.end) / 2 <= c.end + 0.02);
  const loose = words.filter((w) => !covered(w));
  if (!loose.length) return 0;
  const made = generateCaptions(loose, cfg.captions);
  let n = caps.captions.reduce((m, c) => Math.max(m, Number(String(c.id).replace(/\D/g, "")) || 0), 0);
  for (const c of made) {
    c.id = `c${String(++n).padStart(4, "0")}`;
    caps.captions.push(c);
  }
  caps.captions.sort((a, b) => a.start - b.start);
  for (let i = 1; i < caps.captions.length; i++) {
    const a = caps.captions[i - 1];
    const b = caps.captions[i];
    if (a.end > b.start) a.end = round(Math.max(a.start + 0.2, b.start - 0.02));
  }
  writeJSON(P.captions, caps);
  return made.length;
}

/** Rebuild caption text inside a time window from the transcript (keeps manual captions untouched). */
export function syncCaptionsFromTranscript(dir, from, to) {
  const P = projectPaths(dir);
  if (!existsSync(P.captions)) return 0;
  const caps = readJSON(P.captions);
  const words = readJSON(P.transcript).words;
  let n = 0;
  for (const c of caps.captions) {
    if (c.end < from || c.start > to || c.source === "manual") continue;
    const ws = words.filter((w) => {
      const mid = (w.start + w.end) / 2;
      return mid >= c.start - 0.02 && mid <= c.end + 0.02;
    });
    if (!ws.length) continue;
    c.words = ws.map((w) => ({ text: w.text, start: round(w.start), end: round(w.end) }));
    c.text = ws.map((w) => w.text).join(" ");
    n++;
  }
  writeJSON(P.captions, caps);
  return n;
}

/** Apply a caption text correction to the transcript too, so the as-recorded script stays in sync. */
export function correctTranscriptWord(dir, find, replacement) {
  const P = projectPaths(dir);
  const t = readJSON(P.transcript);
  const findToks = find.trim().split(/\s+/);
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
  const repl = replacement.trim().split(/\s+/);
  let count = 0;
  for (let i = 0; i + findToks.length <= t.words.length; i++) {
    const seg = t.words.slice(i, i + findToks.length);
    if (seg.every((w, k) => norm(w.text) === norm(findToks[k]))) {
      const trail = (seg.at(-1).text.match(/[^\p{L}\p{N}']+$/u) || [""])[0];
      const start = seg[0].start;
      const end = seg.at(-1).end;
      const step = (end - start) / repl.length;
      const nw = repl.map((r, k) => ({ text: k === repl.length - 1 ? r + trail : r, start: round(start + k * step), end: round(start + (k + 1) * step), p: 1, corrected: true }));
      t.words.splice(i, findToks.length, ...nw);
      i += nw.length - 1;
      count++;
    }
  }
  t.words.forEach((w, i) => (w.id = `w${i}`));
  writeJSON(P.transcript, t);
  return count;
}

export function status(dir) {
  const P = projectPaths(dir);
  const proj = readJSON(P.project);
  const has = (f) => existsSync(f);
  const q = readJSON(P.questions, []);
  const out = {
    project: proj.name,
    recording: proj.recording ? `${proj.recording} (${round(probe(path.join(dir, proj.recording)).duration, 1)}s)` : "missing",
    transcript: has(P.transcript),
    reconciled: has(P.segments),
    openQuestions: q.filter((x) => x.status === "open").map((x) => `${x.id}@${x.at}`),
    captions: has(P.captions) ? readJSON(P.captions).captions.length : 0,
    musicBlocks: has(P.music) ? readJSON(P.music).blocks.map((b) => `${b.id}:${b.mood}:${b.track ? b.track.title : "—"}`) : [],
    built: has(path.join(P.build, "index.html")),
    rendered: has(path.join(P.renders, `${proj.name}.mp4`)),
    qc: has(path.join(dir, "qc", "report.json")) ? (({ fails, warns }) => ({ fails, warns }))(readJSON(path.join(dir, "qc", "report.json"))) : null,
  };
  return out;
}
