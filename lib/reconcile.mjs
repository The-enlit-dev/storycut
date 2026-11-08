// Reconcile the recorded narration with the written script.
// Produces: what was actually said (as-recorded script), the differences (ad-libs, changed and
// omitted lines), uncertain spans to ask the creator about, and segment/cue timings in recording time.
import path from "node:path";
import { tokenize, normWord } from "./script.mjs";
import { run, ensureDir, fmtTime, round } from "./util.mjs";

const NUMBER_WORDS = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18",
  nineteen: "19", twenty: "20", thirty: "30", forty: "40", fifty: "50", hundred: "100", first: "1st", second: "2nd", third: "3rd",
};
const canon = (n) => NUMBER_WORDS[n] || n.replace(/(\d)(st|nd|rd|th)$/, "$1");

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

function same(a, b) {
  const x = canon(a);
  const y = canon(b);
  if (x === y) return 2;
  if (x.length >= 5 && y.length >= 5 && lev(x, y) / Math.max(x.length, y.length) <= 0.2) return 1; // spelling variant
  return 0;
}

/** LCS-style alignment. Returns pairs [{a: idx|null, b: idx|null, fuzzy}]. */
export function align(aNorm, bNorm) {
  const m = aNorm.length;
  const n = bNorm.length;
  const W = n + 1;
  const dp = new Int32Array((m + 1) * (n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      const s = same(aNorm[i], bNorm[j]);
      const diag = s ? dp[(i + 1) * W + j + 1] + (s === 2 ? 2 : 1) : -1;
      dp[i * W + j] = Math.max(diag, dp[(i + 1) * W + j], dp[i * W + j + 1]);
    }
  }
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    const s = same(aNorm[i], bNorm[j]);
    if (s && dp[i * W + j] === dp[(i + 1) * W + j + 1] + (s === 2 ? 2 : 1)) {
      pairs.push({ a: i, b: j, fuzzy: s === 1 });
      i++;
      j++;
    } else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) pairs.push({ a: i++, b: null });
    else pairs.push({ a: null, b: j++ });
  }
  while (i < m) pairs.push({ a: i++, b: null });
  while (j < n) pairs.push({ a: null, b: j++ });
  return pairs;
}

/** Expand transcript words into normalised tokens that point back at their word. */
function spokenTokens(words) {
  const toks = [];
  words.forEach((w, wi) => {
    const parts = tokenize(w.text);
    if (!parts.length) return;
    parts.forEach((p) => toks.push({ norm: p.norm, word: wi }));
  });
  return toks;
}

function findPhrase(words, from, to, phrase) {
  const target = tokenize(phrase).map((t) => canon(t.norm));
  if (!target.length) return null;
  const norms = words.map((w) => tokenize(w.text).map((t) => canon(t.norm)).join(" "));
  for (let i = Math.max(0, from); i < Math.min(words.length, to); i++) {
    const seq = norms.slice(i, i + target.length + 2).join(" ");
    if (seq.startsWith(target.join(" "))) return i;
  }
  return null;
}

/**
 * @param doc parsed script (parseScript)
 * @param transcript {words:[{text,start,end,p}], hasConfidence}
 */
export function reconcile(doc, transcript, opts = {}) {
  const words = transcript.words;
  const threshold = opts.uncertainBelow ?? 0.5;
  const sTok = doc.words.map((w) => w.norm);
  const spTok = spokenTokens(words);
  const pairs = align(sTok, spTok.map((t) => t.norm));

  // script-word → spoken-word index, and spoken-word → script-word
  const s2w = new Array(doc.words.length).fill(null);
  const w2s = new Array(words.length).fill(null);
  for (const p of pairs) {
    if (p.a !== null && p.b !== null) {
      const wi = spTok[p.b].word;
      s2w[p.a] = wi;
      if (w2s[wi] === null) w2s[wi] = p.a;
    }
  }

  // ---- differences
  const diffs = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const sw = cur.s.length ? doc.words.slice(cur.s[0], cur.s.at(-1) + 1).map((w) => w.text).join(" ") : "";
    const wset = [...new Set(cur.w)];
    const spoken = wset.map((k) => words[k].text).join(" ");
    const kind = !cur.s.length ? "added" : !wset.length ? "omitted" : "changed";
    const size = Math.max(cur.s.length, wset.length);
    const anchorWord = wset.length ? words[wset[0]] : null;
    // time for omitted lines: the gap between surrounding spoken words
    let start = anchorWord?.start ?? null;
    let end = wset.length ? words[wset.at(-1)].end : null;
    if (start === null) {
      const before = cur.prevW ?? null;
      start = before !== null ? words[before].end : 0;
      end = start;
    }
    diffs.push({
      id: `D${diffs.length + 1}`,
      kind,
      minor: size <= 2 && kind !== "omitted" ? true : size <= 1,
      script: sw,
      spoken,
      segment: cur.s.length ? doc.words[cur.s[0]].seg : cur.segGuess,
      start: round(start),
      end: round(end),
      scriptRange: cur.s.length ? [cur.s[0], cur.s.at(-1)] : null,
      spokenRange: wset.length ? [wset[0], wset.at(-1)] : null,
    });
    cur = null;
  };
  let lastW = null;
  let lastSeg = 0;
  for (const p of pairs) {
    const matched = p.a !== null && p.b !== null;
    if (matched) {
      flush();
      lastW = spTok[p.b].word;
      lastSeg = doc.words[p.a].seg;
      continue;
    }
    if (!cur) cur = { s: [], w: [], prevW: lastW, segGuess: lastSeg };
    if (p.a !== null) cur.s.push(p.a);
    if (p.b !== null) {
      const wi = spTok[p.b].word;
      if (w2s[wi] === null) cur.w.push(wi);
    }
  }
  flush();
  const realDiffs = diffs.filter((d) => d.script || d.spoken);

  // ---- segment assignment of each spoken word (ad-libs belong to the segment they were said in)
  const wSeg = new Array(words.length).fill(null);
  let segCursor = 0;
  for (let k = 0; k < words.length; k++) {
    if (w2s[k] !== null) segCursor = doc.words[w2s[k]].seg;
    wSeg[k] = segCursor;
  }
  // if the recording starts with ad-libs before the first matched word, they belong to segment of first match
  const firstMatch = w2s.findIndex((x) => x !== null);
  if (firstMatch > 0) for (let k = 0; k < firstMatch; k++) wSeg[k] = doc.words[w2s[firstMatch]].seg;

  // ---- segment timings
  const segments = doc.segments.map((s, si) => {
    const ws = [];
    for (let k = 0; k < words.length; k++) if (wSeg[k] === si) ws.push(k);
    const matchedScript = s2w.slice(s.wordStart, s.wordEnd).filter((x) => x !== null).length;
    return {
      id: s.id,
      type: s.type,
      title: s.title,
      start: ws.length ? round(words[ws[0]].start) : null,
      end: ws.length ? round(words[ws.at(-1)].end) : null,
      wordRange: ws.length ? [ws[0], ws.at(-1)] : null,
      coverage: s.wordEnd > s.wordStart ? round(matchedScript / (s.wordEnd - s.wordStart), 3) : 1,
      recorded: ws.length > 0,
      cues: [],
      subheads: [],
    };
  });
  // fill boundaries: each segment runs until the next recorded one starts
  const recorded = segments.filter((s) => s.recorded);
  recorded.forEach((s, i) => {
    const next = recorded[i + 1];
    s.end = next ? next.start : round(words.at(-1).end + 0.4);
  });

  // ---- cue + subhead times
  const nearestSpoken = (scriptIdx) => {
    for (let i = scriptIdx; i < doc.words.length; i++) if (s2w[i] !== null) return s2w[i];
    for (let i = scriptIdx - 1; i >= 0; i--) if (s2w[i] !== null) return s2w[i];
    return null;
  };
  doc.segments.forEach((s, si) => {
    const seg = segments[si];
    if (!seg.recorded) return;
    const [from, to] = seg.wordRange;
    for (const c of s.cues) {
      let wi = null;
      let how = "script-position";
      if (c.anchor) {
        wi = findPhrase(words, from, to + 1, c.anchor);
        how = wi !== null ? "anchor" : "anchor-missing";
      }
      if (wi === null) {
        const before = nearestSpoken(Math.max(s.wordStart, c.afterWord - 1));
        wi = before;
      }
      if (wi === null || wi < from || wi > to) wi = from;
      seg.cues.push({ ...c, time: round(words[wi].start), word: wi, placed: how });
    }
    for (const h of s.subheads) {
      const wi = nearestSpoken(h.wordIndex);
      if (wi !== null && wi >= from && wi <= to) seg.subheads.push({ title: h.title, time: round(words[wi].start), word: wi });
    }
  });

  // ---- uncertain spans: low confidence AND not confirmed by the script
  const uncertain = [];
  // words inside a "changed" chunk contradict the script: ask about them at a higher confidence bar
  const conflict = new Uint8Array(words.length);
  for (const d of realDiffs) if (d.kind === "changed" && d.spokenRange) for (let k = d.spokenRange[0]; k <= d.spokenRange[1]; k++) conflict[k] = 1;
  const conflictBelow = opts.conflictBelow ?? 0.85;
  if (transcript.hasConfidence) {
    let span = null;
    for (let k = 0; k < words.length; k++) {
      const w = words[k];
      const low = typeof w.p === "number" && !w.resolved && (w.p < threshold || (conflict[k] && w.p < conflictBelow));
      const confirmedByScript = w2s[k] !== null && same(normWord(w.text), doc.words[w2s[k]].norm) === 2;
      if (low && !confirmedByScript) {
        if (span && k - span.to <= 2) span.to = k;
        else {
          if (span) uncertain.push(span);
          span = { from: k, to: k };
        }
      }
    }
    if (span) uncertain.push(span);
  }
  const questions = uncertain.map((u, i) => {
    const ctxB = words.slice(Math.max(0, u.from - 6), u.from).map((w) => w.text).join(" ");
    const ctxA = words.slice(u.to + 1, u.to + 7).map((w) => w.text).join(" ");
    const heard = words.slice(u.from, u.to + 1).map((w) => w.text).join(" ");
    const minP = Math.min(...words.slice(u.from, u.to + 1).map((w) => w.p));
    // what the script expected around here, if this was inside a changed chunk
    const d = realDiffs.find((x) => x.spokenRange && x.spokenRange[0] <= u.to && x.spokenRange[1] >= u.from);
    return {
      id: `U${i + 1}`,
      kind: "unclear",
      status: "open",
      start: round(words[u.from].start),
      end: round(words[u.to].end),
      at: fmtTime(words[u.from].start),
      heard,
      confidence: round(minP, 2),
      before: ctxB,
      after: ctxA,
      scriptExpected: d?.script || null,
      wordRange: [u.from, u.to],
    };
  });

  // spelling variants (fuzzy matches): the script usually has the right spelling of names
  const spellings = [];
  for (const p of pairs) {
    if (!p.fuzzy) continue;
    const wi = spTok[p.b].word;
    const said = words[wi].text.replace(/[^\p{L}\p{N}'-]/gu, "");
    const scripted = doc.words[p.a].text.replace(/[^\p{L}\p{N}'-]/gu, "");
    if (said && scripted && !spellings.some((x) => x.said === said)) spellings.push({ said, scripted, time: round(words[wi].start) });
  }
  const matchedWords = w2s.filter((x) => x !== null).length;
  return {
    stats: {
      scriptWords: doc.words.length,
      spokenWords: words.length,
      matchedSpoken: matchedWords,
      scriptCoverage: round(s2w.filter((x) => x !== null).length / Math.max(1, doc.words.length), 3),
      adlibWords: words.length - matchedWords,
    },
    diffs: realDiffs,
    spellings,
    segments,
    questions,
    wSeg,
    w2s,
  };
}

/** Rebuild the script with what was actually said, keeping headings and cue tags. */
export function asRecordedScript(doc, rawMd, transcript, rec) {
  const words = transcript.words;
  const header = rawMd.split(/\n(?=##\s)/)[0].trimEnd();
  const headingLines = rawMd.split("\n").filter((l) => /^##\s/.test(l));
  // paragraph index for each script word
  const pIndex = new Array(doc.words.length).fill(null);
  const paras = [];
  doc.segments.forEach((s, si) =>
    s.paragraphs.forEach((p) => {
      const id = paras.length;
      paras.push({ seg: si, ...p, spoken: [] });
      for (let k = p.wordStart; k < p.wordEnd; k++) pIndex[k] = id;
    }),
  );
  let curPara = null;
  for (let k = 0; k < words.length; k++) {
    const sIdx = rec.w2s[k];
    if (sIdx !== null && pIndex[sIdx] !== null) curPara = pIndex[sIdx];
    if (curPara === null) curPara = paras.findIndex((p) => p.seg === rec.wSeg[k]);
    if (curPara >= 0 && paras[curPara]) paras[curPara].spoken.push(k);
  }
  const out = [header, "", `<!-- as-recorded: generated by storycut from ${transcript.source} — edit captions or run "storycut resolve" rather than editing this by hand -->`, ""];
  doc.segments.forEach((s, si) => {
    out.push(headingLines[si] || `## ${s.title}`, "");
    const segParas = paras.filter((p) => p.seg === si);
    const items = [
      ...segParas.map((p) => ({ at: p.wordStart, kind: "p", p })),
      ...s.cues.map((c) => ({ at: c.afterWord, kind: "cue", c })),
      ...s.subheads.map((h) => ({ at: h.wordIndex, kind: "h", h })),
    ].sort((a, b) => a.at - b.at || (a.kind === "p" ? 1 : -1));
    for (const it of items) {
      if (it.kind === "h") out.push(`### ${it.h.title}`, "");
      else if (it.kind === "cue") out.push(`[${it.c.kind}] ${it.c.anchor ? `${it.c.value} on "${it.c.anchor}"` : it.c.value}`);
      else if (it.p.spoken.length) out.push("", it.p.spoken.map((k) => words[k].text).join(" "), "");
      else out.push("", `<!-- not recorded: ${it.p.text.slice(0, 120)}${it.p.text.length > 120 ? "…" : ""} -->`, "");
    }
    out.push("");
  });
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function reconcileReport(rec, transcript) {
  const L = [];
  L.push(`# Recording vs script`, "");
  const s = rec.stats;
  L.push(`- Script words: ${s.scriptWords} · spoken words: ${s.spokenWords}`);
  L.push(`- Script coverage: ${(s.scriptCoverage * 100).toFixed(1)}% · ad-lib words: ${s.adlibWords}`);
  L.push(`- Transcription engine: ${transcript.engine} (${transcript.model})${transcript.hasConfidence ? "" : " — no confidence scores, uncertain words cannot be detected"}`);
  const open = rec.questions.filter((q) => q.status === "open");
  L.push(`- Open questions: ${open.length}`, "");
  if (open.length) {
    L.push(`## Unclear audio — please tell me what you said`, "");
    for (const q of open) {
      L.push(`- **${q.id} @ ${q.at}** (confidence ${q.confidence}): …${q.before} **[${q.heard}]** ${q.after}…${q.scriptExpected ? ` — script had: "${q.scriptExpected}"` : ""}`);
    }
    L.push("");
  }
  const groups = { added: "Ad-libs / added lines", changed: "Changed wording", omitted: "Omitted lines" };
  for (const k of Object.keys(groups)) {
    const ds = rec.diffs.filter((d) => d.kind === k && !d.minor);
    if (!ds.length) continue;
    L.push(`## ${groups[k]} (${ds.length})`, "");
    for (const d of ds) {
      if (k === "added") L.push(`- ${fmtTime(d.start)} — said: "${d.spoken}"`);
      else if (k === "omitted") L.push(`- ~${fmtTime(d.start)} — skipped: "${d.script}"`);
      else L.push(`- ${fmtTime(d.start)} — script: "${d.script}" → said: "${d.spoken}"`);
    }
    L.push("");
  }
  const minor = rec.diffs.filter((d) => d.minor);
  if (minor.length) L.push(`## Minor wording differences: ${minor.length}`, "", ...minor.slice(0, 60).map((d) => `- ${fmtTime(d.start)} "${d.script}" → "${d.spoken}"`), "");
  if (rec.spellings?.length) {
    L.push(`## Spelling differences (transcript vs script)`, "", "The script usually spells names right. Fix captions + transcript with the command shown:", "");
    for (const x of rec.spellings) L.push(`- ${fmtTime(x.time)} heard "${x.said}" — script: "${x.scripted}" → \`storycut captions <project> replace "${x.said}" "${x.scripted}"\``);
    L.push("");
  }
  L.push(`## Segments`, "");
  for (const g of rec.segments) L.push(`- ${g.id} ${g.type} "${g.title}": ${g.recorded ? `${fmtTime(g.start)}–${fmtTime(g.end)} (script coverage ${(g.coverage * 100).toFixed(0)}%)` : "NOT RECORDED"}`);
  return L.join("\n") + "\n";
}

/** Cut a short audio clip around each open question so the creator can listen to it. */
export function exportQuestionClips(audioFile, questions, dir) {
  ensureDir(dir);
  for (const q of questions.filter((x) => x.status === "open")) {
    const from = Math.max(0, q.start - 1.5);
    const dur = q.end - q.start + 3;
    const out = path.join(dir, `${q.id}.wav`);
    run("ffmpeg", ["-v", "error", "-y", "-ss", String(from), "-t", String(dur), "-i", audioFile, "-vn", "-ac", "1", out]);
    q.clip = out;
  }
}

/** Apply the creator's answer: replace the uncertain words with what they actually said. */
export function applyAnswer(transcript, q, text) {
  const [from, to] = q.wordRange;
  const start = transcript.words[from].start;
  const end = transcript.words[to].end;
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const total = tokens.reduce((a, t) => a + Math.max(1, t.length), 0);
  let t = start;
  const repl = tokens.map((tok) => {
    const d = ((end - start) * Math.max(1, tok.length)) / total;
    const w = { text: tok, start: round(t), end: round(t + d), p: 1, resolved: q.id };
    t += d;
    return w;
  });
  transcript.words.splice(from, to - from + 1, ...repl);
  transcript.words.forEach((w, i) => (w.id = `w${i}`));
  return { start, end, count: repl.length };
}
