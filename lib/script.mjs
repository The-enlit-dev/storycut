// Script parser. Format (markdown):
//   ## [optional "mm:ss — "] Title {optional-type}
//   narration paragraphs…
//   ### Sub-story heading          → lower third at its first spoken word
//   [VISUAL] / [LOWER] text         → lower third (or visual note) near the previous narration
//   [EMOJI] 🍎 on "Apple", 💸 on "350 million"
//   [MEME] text or assets/memes/file.jpg on "phrase" — caption
//   [CAVEAT] COMPANY CLAIM          → small label for the start of the segment
//   [SFX] name on "phrase"          → sound effect from assets/sfx/<name>.*
//   [TONE] serious | funny | dramatic | educational | exciting  → music mood override
//   [MUSIC] keep | none | <mood>
// Anything before the first "## " heading and lines starting with ">" are notes, not narration.
import { inferType } from "./segments.mjs";

const TAG_RE = /^\[(VISUAL|LOWER|EMOJI|MEME|CAVEAT|SFX|TONE|MUSIC|NOTE)\]\s*(.*)$/i;

export function normWord(w) {
  return w
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}']+/gu, "")
    .replace(/^'+|'+$/g, "");
}

/** Split narration text into display tokens (keeps punctuation) with normalised forms. */
export function tokenize(text) {
  const out = [];
  for (const raw of text.split(/\s+/)) {
    if (!raw) continue;
    // split hyphen/slash compounds so "65-billion" ≈ "65 billion"
    const parts = raw.split(/(?<=[\p{L}\p{N}])[-–—/](?=[\p{L}\p{N}])/u);
    for (const p of parts) {
      const n = normWord(p);
      if (n) out.push({ text: p, norm: n });
    }
  }
  return out;
}

function stripMarkdown(line) {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/(^|\s)[*_](\S)/g, "$1$2")
    .replace(/(\S)[*_](\s|$)/g, "$1$2")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+\.\s+/, "")
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    .trim();
}

function parseAnchors(body) {
  // "🍎 on "Apple", 💸 on "350 million""  → [{value, anchor}]
  const out = [];
  const re = /([^,]+?)\s+on\s+["“]([^"”]+)["”]/g;
  let m;
  while ((m = re.exec(body))) out.push({ value: m[1].trim().replace(/^,\s*/, ""), anchor: m[2].trim() });
  if (!out.length && body.trim()) out.push({ value: body.trim(), anchor: null });
  return out;
}

export function parseScript(md) {
  const lines = md.replace(/\r/g, "").split("\n");
  const titleLine = lines.find((l) => /^#\s+/.test(l));
  const doc = { title: titleLine ? stripMarkdown(titleLine.replace(/^#\s+/, "")) : "Untitled", segments: [], words: [] };
  let seg = null;
  let para = null;
  const closePara = () => {
    if (para && para.wordEnd > para.wordStart) seg.paragraphs.push(para);
    para = null;
  };
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const h2 = line.match(/^##\s+(.*)$/);
    if (h2) {
      closePara();
      let title = h2[1].trim();
      let type = null;
      const tm = title.match(/\{([a-z-]+)\}\s*$/);
      if (tm) {
        type = tm[1];
        title = title.slice(0, tm.index).trim();
      }
      title = title
        .replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*[—–-]\s*/, "")
        .replace(/^segment\s+\d+\s*[:.—–-]\s*/i, "");
      seg = { id: `s${String(doc.segments.length + 1).padStart(2, "0")}`, title: stripMarkdown(title), type, cues: [], subheads: [], paragraphs: [], wordStart: doc.words.length, wordEnd: doc.words.length };
      doc.segments.push(seg);
      continue;
    }
    if (!seg) continue; // header notes
    if (/^#{3,}\s+/.test(line)) {
      closePara();
      seg.subheads.push({ title: stripMarkdown(line.replace(/^#+\s+/, "")), wordIndex: doc.words.length });
      continue;
    }
    const tag = line.trim().match(TAG_RE);
    if (tag) {
      closePara();
      const kind = tag[1].toUpperCase();
      const body = tag[2].trim();
      const afterWord = doc.words.length; // cue position in the script
      if (kind === "EMOJI" || kind === "SFX") {
        for (const a of parseAnchors(body)) seg.cues.push({ kind, value: a.value, anchor: a.anchor, afterWord });
      } else if (kind === "MEME") {
        const a = parseAnchors(body)[0];
        seg.cues.push({ kind, value: a.value, anchor: a.anchor, afterWord });
      } else seg.cues.push({ kind, value: body, afterWord });
      continue;
    }
    if (!line.trim() || /^>/.test(line.trim()) || /^-{3,}$/.test(line.trim()) || /^\|/.test(line.trim())) {
      closePara();
      continue;
    }
    const text = stripMarkdown(line);
    if (!text) continue;
    if (!para) para = { text: "", wordStart: doc.words.length, wordEnd: doc.words.length };
    for (const t of tokenize(text)) {
      doc.words.push({ ...t, seg: doc.segments.length - 1 });
    }
    para.text += (para.text ? " " : "") + text;
    para.wordEnd = doc.words.length;
    seg.wordEnd = doc.words.length;
  }
  closePara();
  doc.segments.forEach((s, i) => {
    if (!s.type) s.type = inferType(s.title, i, doc.segments.length);
  });
  return doc;
}
