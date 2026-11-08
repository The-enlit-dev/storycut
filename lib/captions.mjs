// Captions are their own document (captions.json), independent of the script.
// They are generated once from the transcript, then edited freely; the build always renders captions.json.
import { round, fmtTime } from "./util.mjs";

export const CAPTION_STYLE_KEYS = [
  "font", "size", "case", "color", "activeColor", "activeBg", "box", "boxBorder", "shadow",
  "position", "offset", "animation", "wordsPerGroup", "weight", "letterSpacing", "maxWidth",
];

/** Group transcript words into caption cues. */
export function generateCaptions(words, opts = {}) {
  const per = Number(opts.wordsPerGroup || 3);
  const maxChars = Number(opts.maxCharsPerLine || 32);
  const minDur = Number(opts.minDuration || 0.6);
  const groups = [];
  let g = [];
  const push = () => {
    if (g.length) groups.push(g);
    g = [];
  };
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (g.length && prev && w.start - prev.end >= 0.35) push();
    const chars = g.map((x) => x.text).join(" ").length + w.text.length + 1;
    if (g.length && (g.length >= per || chars > maxChars)) push();
    g.push(w);
    if (/[.!?…]["”')\]]*$/.test(w.text)) push();
  });
  push();
  const caps = groups.map((ws, i) => ({
    id: `c${String(i + 1).padStart(4, "0")}`,
    start: round(ws[0].start),
    end: round(ws.at(-1).end),
    text: ws.map((w) => w.text).join(" "),
    words: ws.map((w) => ({ text: w.text, start: round(w.start), end: round(w.end) })),
    source: "auto",
  }));
  // hold each cue a little longer, never into the next one, and respect a minimum duration
  for (let i = 0; i < caps.length; i++) {
    const next = caps[i + 1];
    const limit = next ? next.start - 0.02 : caps[i].end + 0.6;
    caps[i].end = round(Math.min(limit, Math.max(caps[i].end + 0.15, caps[i].start + minDur)));
  }
  return caps;
}

export function newCaptionsDoc(captions, meta = {}) {
  return { version: 1, ...meta, style: {}, captions };
}

function renumber(doc) {
  doc.captions.sort((a, b) => a.start - b.start);
}

function nextId(doc) {
  const n = doc.captions.reduce((m, c) => Math.max(m, Number(String(c.id).replace(/\D/g, "")) || 0), 0);
  return `c${String(n + 1).padStart(4, "0")}`;
}

/** Spread words across a cue (used when text changes and word timings no longer apply). */
export function spreadWords(text, start, end) {
  const toks = text.trim().split(/\s+/).filter(Boolean);
  const total = toks.reduce((a, t) => a + Math.max(2, t.length), 0) || 1;
  let t = start;
  return toks.map((tok) => {
    const d = ((end - start) * Math.max(2, tok.length)) / total;
    const w = { text: tok, start: round(t), end: round(t + d) };
    t += d;
    return w;
  });
}

export function find(doc, id) {
  const c = doc.captions.find((x) => x.id === id);
  if (!c) throw new Error(`no caption ${id}`);
  return c;
}

export function addCaption(doc, { start, end, text }) {
  if (!(end > start)) throw new Error("end must be after start");
  const c = { id: nextId(doc), start: round(start), end: round(end), text, words: spreadWords(text, start, end), source: "manual" };
  doc.captions.push(c);
  renumber(doc);
  return c;
}

export function editCaption(doc, id, { text, start, end }) {
  const c = find(doc, id);
  const oldStart = c.start;
  const oldEnd = c.end;
  if (start !== undefined) c.start = round(start);
  if (end !== undefined) c.end = round(end);
  if (!(c.end > c.start)) throw new Error("end must be after start");
  if (text !== undefined && text !== c.text) {
    const oldTok = c.words.map((w) => w.text);
    const newTok = text.trim().split(/\s+/);
    if (oldTok.length === newTok.length) c.words = c.words.map((w, i) => ({ ...w, text: newTok[i] })); // word fix: keep timing
    else c.words = spreadWords(text, c.start, c.end);
    c.text = text.trim();
  }
  if ((start !== undefined || end !== undefined) && (c.start !== oldStart || c.end !== oldEnd)) {
    // rescale word timings into the new window
    const k = (c.end - c.start) / (oldEnd - oldStart || 1);
    c.words = c.words.map((w) => ({ ...w, start: round(c.start + (w.start - oldStart) * k), end: round(c.start + (w.end - oldStart) * k) }));
  }
  if (c.source === "auto") c.source = "edited";
  renumber(doc);
  return c;
}

export function deleteCaption(doc, id) {
  const i = doc.captions.findIndex((x) => x.id === id);
  if (i < 0) throw new Error(`no caption ${id}`);
  return doc.captions.splice(i, 1)[0];
}

/** Shift captions by `by` seconds: all, or those from a caption id / time onward. */
export function shiftCaptions(doc, by, { from, to } = {}) {
  let n = 0;
  for (const c of doc.captions) {
    if (from !== undefined && c.start < from) continue;
    if (to !== undefined && c.start > to) continue;
    c.start = round(c.start + by);
    c.end = round(c.end + by);
    c.words = c.words.map((w) => ({ ...w, start: round(w.start + by), end: round(w.end + by) }));
    if (c.source === "auto") c.source = "edited";
    n++;
  }
  renumber(doc);
  return n;
}

export function splitCaption(doc, id, atWord) {
  const c = find(doc, id);
  const k = Number(atWord);
  if (!(k > 0 && k < c.words.length)) throw new Error(`split point must be 1..${c.words.length - 1}`);
  const a = c.words.slice(0, k);
  const b = c.words.slice(k);
  c.words = a;
  c.text = a.map((w) => w.text).join(" ");
  const oldEnd = c.end;
  c.end = round(b[0].start - 0.02);
  const nc = { id: nextId(doc), start: b[0].start, end: oldEnd, text: b.map((w) => w.text).join(" "), words: b, source: "edited" };
  doc.captions.push(nc);
  renumber(doc);
  return [c, nc];
}

export function mergeCaptions(doc, idA, idB) {
  const a = find(doc, idA);
  const b = find(doc, idB);
  const [first, second] = a.start <= b.start ? [a, b] : [b, a];
  first.words = [...first.words, ...second.words];
  first.text = `${first.text} ${second.text}`;
  first.end = Math.max(first.end, second.end);
  first.source = "edited";
  deleteCaption(doc, second.id);
  return first;
}

/** Find/replace across captions (fix a mis-heard name everywhere). Returns changed caption ids. */
export function replaceText(doc, find, replacement, { wholeWord = true, caseSensitive = false } = {}) {
  const esc = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(wholeWord ? `(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])` : esc, `g${caseSensitive ? "" : "i"}u`);
  const changed = [];
  for (const c of doc.captions) {
    if (!re.test(c.text)) continue;
    re.lastIndex = 0;
    editCaption(doc, c.id, { text: c.text.replace(re, replacement) });
    changed.push(c.id);
  }
  return changed;
}

/** Problems a viewer would notice. */
export function validateCaptions(doc, { maxCps = 20, minDuration = 0.5, rangeEnd } = {}) {
  const issues = [];
  const caps = [...doc.captions].sort((a, b) => a.start - b.start);
  caps.forEach((c, i) => {
    const dur = c.end - c.start;
    const cps = c.text.replace(/\s/g, "").length / Math.max(0.01, dur);
    if (dur < minDuration) issues.push({ id: c.id, level: "warn", msg: `only ${dur.toFixed(2)}s on screen` });
    if (cps > maxCps) issues.push({ id: c.id, level: "warn", msg: `${cps.toFixed(0)} chars/s (max ${maxCps})` });
    if (!c.text.trim()) issues.push({ id: c.id, level: "error", msg: "empty caption" });
    const next = caps[i + 1];
    if (next && next.start < c.end - 0.001) issues.push({ id: c.id, level: "error", msg: `overlaps ${next.id} by ${(c.end - next.start).toFixed(2)}s` });
    if (c.start < 0) issues.push({ id: c.id, level: "error", msg: "starts before 0" });
    if (rangeEnd && c.end > rangeEnd + 0.5) issues.push({ id: c.id, level: "error", msg: `ends after the recording (${fmtTime(rangeEnd)})` });
    for (const w of c.words || []) {
      if (w.start < c.start - 0.05 || w.end > c.end + 0.05) {
        issues.push({ id: c.id, level: "warn", msg: `word "${w.text}" timed outside its caption` });
        break;
      }
    }
  });
  return issues;
}

const pad = (n, l = 2) => String(n).padStart(l, "0");
function stamp(sec, sep) {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

export function toSrt(doc, offset = 0) {
  return doc.captions.map((c, i) => `${i + 1}\n${stamp(c.start + offset, ",")} --> ${stamp(c.end + offset, ",")}\n${c.text}\n`).join("\n");
}

export function toVtt(doc, offset = 0) {
  return "WEBVTT\n\n" + doc.captions.map((c) => `${c.id}\n${stamp(c.start + offset, ".")} --> ${stamp(c.end + offset, ".")}\n${c.text}\n`).join("\n");
}

export function captionsText(doc) {
  return doc.captions.map((c) => c.text).join(" ");
}
