// Word-level transcription with per-word confidence.
// Engines: whisper.cpp directly (gives probabilities) → falls back to `npx hyperframes transcribe` (no probabilities).
import path from "node:path";
import os from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { run, hasCommand, writeJSON, ensureDir, readJSON } from "./util.mjs";

const HF_CACHE = path.join(os.homedir(), ".cache", "hyperframes", "whisper");

function whisperCli() {
  if (process.env.STORYCUT_WHISPER_CLI && existsSync(process.env.STORYCUT_WHISPER_CLI)) return process.env.STORYCUT_WHISPER_CLI;
  if (hasCommand("whisper-cli")) return "whisper-cli";
  const p = path.join(HF_CACHE, "whisper.cpp", "build", "bin", "whisper-cli");
  return existsSync(p) ? p : null;
}

function whisperModel(model) {
  if (process.env.STORYCUT_WHISPER_MODEL && existsSync(process.env.STORYCUT_WHISPER_MODEL)) return process.env.STORYCUT_WHISPER_MODEL;
  const p = path.join(HF_CACHE, "models", `ggml-${model}.bin`);
  return existsSync(p) ? p : null;
}

/** Make sure whisper.cpp + model exist, bootstrapping through the HyperFrames CLI (free, local). */
function bootstrap(model, workDir) {
  if (whisperCli() && whisperModel(model)) return true;
  const probe = path.join(workDir, "bootstrap.wav");
  run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-ar", "16000", "-ac", "1", probe]);
  run("npx", ["-y", "hyperframes", "transcribe", probe, "--model", model, "--dir", workDir, "--json"], { allowFail: true, timeout: 30 * 60 * 1000 });
  return !!(whisperCli() && whisperModel(model));
}

const DTW_PRESETS = ["tiny", "tiny.en", "base", "base.en", "small", "small.en", "medium", "medium.en", "large.v1", "large.v2", "large.v3", "large.v3.turbo"];
function dtwArgs(model) {
  const preset = model.replace(/-/g, ".");
  return DTW_PRESETS.includes(preset) ? ["-nfa", "-dtw", preset] : [];
}

function parseWhisperJson(file) {
  const j = readJSON(file);
  const words = [];
  for (const seg of j.transcription || []) {
    const raw = seg.text || "";
    const text = raw.trim();
    if (!text) continue;
    const toks = (seg.tokens || []).filter((t) => !/^\[_?[A-Z_0-9]+_?\]$/.test(t.text.trim()) && !/^\[_/.test(t.text.trim()));
    const lexical = toks.filter((t) => /[\p{L}\p{N}]/u.test(t.text));
    const p = lexical.length ? Math.min(...lexical.map((t) => t.p)) : toks.length ? Math.min(...toks.map((t) => t.p)) : 1;
    // DTW token alignment (t_dtw, centiseconds) is far more accurate than segment offsets near noise
    const dtwTok = lexical.find((t) => typeof t.t_dtw === "number" && t.t_dtw >= 0);
    const start = dtwTok ? dtwTok.t_dtw / 100 : seg.offsets.from / 1000;
    const end = seg.offsets.to / 1000;
    const offFrom = seg.offsets.from / 1000;
    const glue = words.length && (!/^\s/.test(raw) || !/[\p{L}\p{N}]/u.test(text));
    if (glue) {
      // punctuation or a sub-word piece: attach to the previous word
      const prev = words[words.length - 1];
      prev.text += text;
      prev.end = Math.max(prev.end, end);
      prev.p = Math.min(prev.p, p);
      continue;
    }
    words.push({ text, start, end, p: Math.round(p * 1000) / 1000, _dtw: !!dtwTok, _off: [offFrom, end] });
  }
  // ends: keep whisper's word length when its offsets agree with the DTW onset, else estimate; never overlap
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    let end = w.end;
    if (w._dtw && Math.abs(w._off[0] - w.start) > 0.3) end = w.start + Math.max(0.15, 0.075 * w.text.length + 0.1);
    else if (w._dtw) end = w.start + Math.max(0.1, w._off[1] - w._off[0]);
    if (next) end = Math.min(end, next.start - 0.01);
    w.end = Math.round(Math.max(w.start + 0.05, end) * 1000) / 1000;
    w.start = Math.round(w.start * 1000) / 1000;
    delete w._dtw;
    delete w._off;
  }
  return words.map((w, i) => ({ id: `w${i}`, ...w }));
}

function importTranscript(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".json") {
    const j = JSON.parse(readFileSync(file, "utf8"));
    const arr = Array.isArray(j) ? j : j.words || [];
    return arr.map((w, i) => ({ id: `w${i}`, text: String(w.text).trim(), start: Number(w.start), end: Number(w.end), p: w.p ?? w.probability ?? w.confidence ?? null }));
  }
  if (ext === ".srt" || ext === ".vtt") {
    // cue-level import: spread words evenly across each cue (timings are approximate)
    const txt = readFileSync(file, "utf8").replace(/\r/g, "");
    const words = [];
    const re = /(\d+:\d{2}:\d{2}[.,]\d{3}|\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d+:\d{2}:\d{2}[.,]\d{3}|\d{2}:\d{2}[.,]\d{3})[^\n]*\n([\s\S]*?)(?=\n\n|$)/g;
    const toSec = (s) => s.replace(",", ".").split(":").map(Number).reduce((a, b) => a * 60 + b, 0);
    let m;
    while ((m = re.exec(txt))) {
      const a = toSec(m[1]);
      const b = toSec(m[2]);
      const ws = m[3].replace(/<[^>]+>/g, "").split(/\s+/).filter(Boolean);
      ws.forEach((w, k) => words.push({ text: w, start: a + ((b - a) * k) / ws.length, end: a + ((b - a) * (k + 1)) / ws.length, p: null }));
    }
    return words.map((w, i) => ({ id: `w${i}`, ...w }));
  }
  throw new Error(`can't import transcript of type ${ext}`);
}

/**
 * Transcribe `audioFile` into `outFile` ({engine, model, hasConfidence, words}).
 * opts: { model, language, engine: auto|whisper|hyperframes|import, from }
 */
export function transcribe(audioFile, outFile, opts = {}) {
  const model = opts.model || "small.en";
  const workDir = ensureDir(path.dirname(outFile));
  let words;
  let engine;
  if (opts.from) {
    words = importTranscript(opts.from);
    engine = "import";
  } else {
    const wantDirect = opts.engine === "auto" || opts.engine === "whisper" || !opts.engine;
    if (wantDirect && bootstrap(model, workDir)) {
      const wav = path.join(workDir, "narration-16k.wav");
      run("ffmpeg", ["-v", "error", "-y", "-i", audioFile, "-vn", "-ac", "1", "-ar", "16000", wav]);
      const base = path.join(workDir, "whisper");
      const args = ["-m", whisperModel(model), "-f", wav, "-ojf", "-of", base, "-ml", "1", "-sow", "-np", ...dtwArgs(model)];
      if (opts.language && !model.endsWith(".en")) args.push("-l", opts.language);
      run(whisperCli(), args, { timeout: 6 * 60 * 60 * 1000 });
      words = parseWhisperJson(`${base}.json`);
      engine = "whisper.cpp";
    } else {
      const r = run("npx", ["-y", "hyperframes", "transcribe", audioFile, "--model", model, "--dir", workDir, "--json"], { timeout: 6 * 60 * 60 * 1000 });
      const last = r.stdout.trim().split("\n").pop();
      const res = JSON.parse(last);
      words = importTranscript(res.transcriptPath).map((w) => ({ ...w, p: null }));
      engine = "hyperframes";
    }
  }
  // drop hallucinated tokens and non-speech markers, but keep them visible as uncertain if they carry text
  words = words.filter((w) => w.text && !/^\[(BLANK_AUDIO|MUSIC|NOISE)\]$/i.test(w.text));
  const hasConfidence = words.some((w) => typeof w.p === "number");
  const data = { engine, model, source: path.basename(audioFile), createdAt: new Date().toISOString(), hasConfidence, words };
  writeJSON(outFile, data);
  return data;
}

/**
 * Re-listen to a short window with a text prompt (used to check whether a "missing" script line was
 * actually spoken but not transcribed). Returns words with absolute times, or null if whisper.cpp is unavailable.
 */
export function transcribeWindow(audioFile, start, end, prompt, { model = "small.en", workDir }) {
  if (!whisperCli() || !whisperModel(model)) return null;
  const dir = ensureDir(workDir);
  const wav = path.join(dir, `win-${Math.round(start * 1000)}.wav`);
  run("ffmpeg", ["-v", "error", "-y", "-ss", String(Math.max(0, start)), "-t", String(end - start), "-i", audioFile, "-vn", "-ac", "1", "-ar", "16000", wav]);
  const base = wav.replace(/\.wav$/, "");
  const args = ["-m", whisperModel(model), "-f", wav, "-ojf", "-of", base, "-ml", "1", "-sow", "-np", ...dtwArgs(model)];
  if (prompt) args.push("--prompt", prompt.slice(0, 400));
  run(whisperCli(), args, { timeout: 10 * 60 * 1000 });
  return parseWhisperJson(`${base}.json`).map((w) => ({ ...w, start: w.start + Math.max(0, start), end: w.end + Math.max(0, start) }));
}
