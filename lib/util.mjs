// Shared helpers: files, processes, media probing, loudness, time formatting.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function readJSON(file, fallback) {
  if (!existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing file: ${file}`);
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

export function writeJSON(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

export function writeText(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

export function readText(file) {
  return readFileSync(file, "utf8");
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function copyInto(src, destDir, name) {
  ensureDir(destDir);
  const dest = path.join(destDir, name || path.basename(src));
  copyFileSync(src, dest);
  return dest;
}

export function exists(p) {
  return !!p && existsSync(p);
}

export function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Run a command; throws with stderr on failure unless opts.allowFail. */
export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env || {}) },
    stdio: opts.inherit ? "inherit" : "pipe",
    timeout: opts.timeout,
  });
  if (r.error) throw r.error;
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`${cmd} ${args.join(" ")} failed (${r.status}):\n${(r.stderr || "").slice(-2000)}`);
  }
  return r;
}

export function hasCommand(cmd) {
  return spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf8" }).status === 0;
}

export function probe(file) {
  const r = run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  const a = j.streams.find((s) => s.codec_type === "audio");
  return {
    duration: Number(j.format.duration),
    hasVideo: !!v,
    hasAudio: !!a,
    width: v?.width,
    height: v?.height,
    fps: v ? evalRate(v.r_frame_rate) : undefined,
  };
}

function evalRate(r) {
  const [n, d] = String(r).split("/").map(Number);
  return d ? n / d : n;
}

/** EBU R128 loudness of a file or of a time window. Returns {lufs, lra, truePeak}. */
export function loudness(file, { start, duration, mono = false } = {}) {
  const args = ["-hide_banner", "-nostats"];
  if (start !== undefined) args.push("-ss", String(start));
  if (duration !== undefined) args.push("-t", String(duration));
  // mono: downmix first so a mono voice and a stereo mix of it measure the same (else stereo reads +3 dB)
  args.push("-i", file, "-vn", ...(mono ? ["-ac", "1"] : []), "-af", "ebur128=peak=true", "-f", "null", "-");
  const r = run("ffmpeg", args, { allowFail: true });
  const txt = r.stderr || "";
  const summary = txt.slice(txt.lastIndexOf("Summary:"));
  const num = (re) => {
    const m = summary.match(re);
    return m ? Number(m[1]) : null;
  };
  return {
    lufs: num(/I:\s+(-?[\d.]+|-inf) LUFS/),
    lra: num(/LRA:\s+(-?[\d.]+) LU/),
    truePeak: num(/Peak:\s+(-?[\d.]+|-inf) dBFS/),
  };
}

/** Decode audio to mono float samples at `rate` Hz (for analysis only). */
export function decodeMono(file, rate = 8000, { start, duration } = {}) {
  const args = ["-v", "error"];
  if (start !== undefined) args.push("-ss", String(start));
  if (duration !== undefined) args.push("-t", String(duration));
  args.push("-i", file, "-vn", "-ac", "1", "-ar", String(rate), "-f", "f32le", "-");
  const r = spawnSync("ffmpeg", args, { maxBuffer: 1024 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`decode failed: ${r.stderr}`);
  const buf = r.stdout;
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

/** RMS envelope in dBFS at `hop` seconds per frame. */
export function envelopeDb(samples, rate, hop = 0.05) {
  const n = Math.max(1, Math.round(rate * hop));
  const out = [];
  for (let i = 0; i < samples.length; i += n) {
    let s = 0;
    const end = Math.min(samples.length, i + n);
    for (let j = i; j < end; j++) s += samples[j] * samples[j];
    const rms = Math.sqrt(s / Math.max(1, end - i));
    out.push(rms > 0 ? 20 * Math.log10(rms) : -120);
  }
  return out;
}

export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => (g > 0 ? 20 * Math.log10(g) : -120);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

export function fmtTime(sec) {
  if (sec == null || Number.isNaN(sec)) return "--:--";
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, "0")}:${r.toFixed(2).padStart(5, "0")}`;
}

/** Accepts 83.5, "83.5", "1:23.5", "01:02:03.4". */
export function parseTime(v) {
  if (typeof v === "number") return v;
  const parts = String(v).trim().split(":").map(Number);
  if (parts.some((p) => Number.isNaN(p))) throw new Error(`bad time: ${v}`);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "item";
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

export function fileSize(p) {
  return statSync(p).size;
}

export function log(...a) {
  console.log(...a);
}

export function fail(msg, code = 1) {
  console.error(`✗ ${msg}`);
  process.exit(code);
}

/** Minimal argv parser: positional + --flag value / --flag=value / --bool. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > -1) out[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) out[a.slice(2)] = argv[++i];
      else out[a.slice(2)] = true;
    } else out._.push(a);
  }
  return out;
}

/** Two-pass EBU R128 normalisation (linear when possible) with a true-peak ceiling. Writes 48 kHz WAV. */
export function normalizeLoudness(src, out, { lufs = -16, tp = -1.5, lra = 11 } = {}) {
  const p1 = run("ffmpeg", ["-hide_banner", "-nostats", "-i", src, "-vn", "-af", `loudnorm=I=${lufs}:TP=${tp}:LRA=${lra}:print_format=json`, "-f", "null", "-"], { allowFail: true }).stderr;
  const j = JSON.parse(p1.slice(p1.lastIndexOf("{"), p1.lastIndexOf("}") + 1));
  const f = `loudnorm=I=${lufs}:TP=${tp}:LRA=${lra}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true:print_format=json`;
  const p2 = run("ffmpeg", ["-hide_banner", "-nostats", "-y", "-i", src, "-vn", "-af", f, "-ar", "48000", out], { allowFail: false }).stderr;
  const k = JSON.parse(p2.slice(p2.lastIndexOf("{"), p2.lastIndexOf("}") + 1));
  return { inputLufs: Number(j.input_i), inputTp: Number(j.input_tp), outputLufs: Number(k.output_i), outputTp: Number(k.output_tp), mode: k.normalization_type };
}
