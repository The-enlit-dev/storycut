// Background music: content/audio analysis → mood blocks → licence-verified CC0/PD tracks → ducked beds.
import path from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { MOODS, SEGMENT_TYPES } from "./segments.mjs";
import { readJSON, writeJSON, ensureDir, run, loudness, decodeMono, envelopeDb, sha256, round, dbToGain, clamp, slug, probe } from "./util.mjs";

const UA = "storycut/1.0 (+https://github.com/The-enlit-dev/storycut)";
const VOCAL_RE = /\b(vocals?|vocal(s|ist|ists)?|singing|singers?|sung|songs? with|lyrics?|choirs?|choral|chant(s|ing)?|rap|rapping|acapella|a cappella|feat\.?|featuring|voices?|spoken|speech|narration|vox|humming|whisper(s|ing)?|ghosts?)\b/i;
const LICENSE_LABEL = {
  cc0: "CC0 1.0 Universal (public domain dedication)",
  pdm: "Public Domain Mark 1.0",
};

// ---------------------------------------------------------------- analysis
/** Speech intervals from transcript words (merging short gaps). */
export function speechIntervals(words, mergeGap = 0.35) {
  const out = [];
  for (const w of words) {
    const last = out.at(-1);
    if (last && w.start - last.end <= mergeGap) last.end = Math.max(last.end, w.end);
    else out.push({ start: w.start, end: w.end });
  }
  return out;
}

/** Narration level, clarity and pace, overall and per segment, plus a suggested mood per segment. */
export function analyzeNarration(audioFile, transcript, segmentsDoc, cfg, scriptDoc) {
  const words = transcript.words;
  const overall = loudness(audioFile);
  const rate = 8000;
  const samples = decodeMono(audioFile, rate);
  const env = envelopeDb(samples, rate, 0.05);
  const speech = speechIntervals(words);
  const inSpeech = new Uint8Array(env.length);
  for (const s of speech) for (let i = Math.floor(s.start / 0.05); i < Math.min(env.length, Math.ceil(s.end / 0.05)); i++) inSpeech[i] = 1;
  const sp = env.filter((_, i) => inSpeech[i]).sort((a, b) => a - b);
  const gaps = env.filter((_, i) => !inSpeech[i]).sort((a, b) => a - b);
  const pct = (arr, p) => (arr.length ? arr[Math.floor((arr.length - 1) * p)] : null);
  const speechLevel = pct(sp, 0.5);
  const noiseFloor = pct(gaps, 0.2);
  const snr = speechLevel !== null && noiseFloor !== null ? round(speechLevel - noiseFloor, 1) : null;
  const totalSpeech = speech.reduce((a, s) => a + s.end - s.start, 0);

  const segs = segmentsDoc.segments.filter((s) => s.recorded).map((s) => {
    const ws = words.filter((w) => w.start >= s.start - 0.01 && w.start < s.end);
    const dur = Math.max(0.1, s.end - s.start);
    const wps = round(ws.length / dur, 2);
    const scriptSeg = scriptDoc?.segments.find((x) => x.id === s.id);
    const tone = scriptSeg?.cues.find((c) => c.kind === "TONE")?.value?.toLowerCase();
    const musicCue = scriptSeg?.cues.find((c) => c.kind === "MUSIC")?.value?.toLowerCase();
    const reasons = [];
    let mood = SEGMENT_TYPES[s.type]?.mood || "curious";
    reasons.push(`segment type "${s.type}" → ${mood}`);
    const toneMap = { serious: "serious", funny: "playful", comedic: "playful", exciting: "punchy", educational: "curious", dramatic: "dramatic", calm: "wonder", warm: "warm" };
    if (tone && toneMap[tone]) {
      mood = toneMap[tone];
      reasons.push(`[TONE] ${tone} → ${mood}`);
    }
    if (musicCue && MOODS[musicCue]) {
      mood = musicCue;
      reasons.push(`[MUSIC] ${musicCue}`);
    }
    let under = cfg.music.underSpeechDb;
    if (wps > 2.9) {
      under -= 2;
      reasons.push(`fast delivery (${wps} words/s) → bed 2 dB lower`);
    }
    if (snr !== null && snr < 25) {
      under -= 3;
      reasons.push(`noisy/quiet recording (SNR ${snr} dB) → bed 3 dB lower`);
    }
    const segLoud = loudness(audioFile, { start: s.start, duration: dur });
    if (overall.lufs !== null && segLoud.lufs !== null && segLoud.lufs < overall.lufs - 3) {
      under -= 2;
      reasons.push(`narration here is ${round(overall.lufs - segLoud.lufs, 1)} LU quieter than average → bed 2 dB lower`);
    }
    const none = musicCue === "none";
    return { id: s.id, type: s.type, title: s.title, start: s.start, end: s.end, wps, lufs: segLoud.lufs, mood: none ? null : mood, underSpeechDb: under, keep: musicCue === "keep", reasons };
  });
  return {
    narration: { file: path.basename(audioFile), lufs: overall.lufs, lra: overall.lra, truePeak: overall.truePeak, speechLevelDb: speechLevel, noiseFloorDb: noiseFloor, snrDb: snr, speechRatio: round(totalSpeech / Math.max(0.1, words.at(-1)?.end || 1), 2) },
    segments: segs,
  };
}

/** Group segments into music blocks: one track per block, no switches shorter than minBlockSeconds. */
export function planBlocks(analysis, cfg) {
  const minLen = cfg.music.minBlockSeconds;
  const blocks = [];
  for (const s of analysis.segments) {
    const last = blocks.at(-1);
    const own = s.type === "sponsor" || s.mood === null; // sponsor gets a distinct bed; "none" = silence
    const dur = s.end - s.start;
    if (last && !own && !last.own && (last.mood === s.mood || s.keep)) {
      last.segments.push(s.id);
      last.end = s.end;
      last.underSpeechDb = Math.min(last.underSpeechDb, s.underSpeechDb);
      last.moodTime[s.mood] = (last.moodTime[s.mood] || 0) + dur;
      continue;
    }
    blocks.push({ segments: [s.id], mood: s.mood, start: s.start, end: s.end, underSpeechDb: s.underSpeechDb, own, moodTime: { [s.mood]: dur } });
  }
  // merge short blocks into a neighbour (never merge sponsor/none blocks)
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.own || b.end - b.start >= minLen) continue;
      const prev = blocks[i - 1] && !blocks[i - 1].own ? blocks[i - 1] : null;
      const next = blocks[i + 1] && !blocks[i + 1].own ? blocks[i + 1] : null;
      const into = prev || next;
      if (!into) continue;
      into.segments = into === prev ? [...into.segments, ...b.segments] : [...b.segments, ...into.segments];
      into.start = Math.min(into.start, b.start);
      into.end = Math.max(into.end, b.end);
      into.underSpeechDb = Math.min(into.underSpeechDb, b.underSpeechDb);
      for (const [m, t] of Object.entries(b.moodTime)) into.moodTime[m] = (into.moodTime[m] || 0) + t;
      // the block's mood is the one that covers most of its time (energy breaks ties)
      const energy = { high: 2, medium: 1, low: 0 };
      into.mood = Object.entries(into.moodTime).sort((x, y) => y[1] - x[1] || (energy[MOODS[y[0]]?.energy] ?? 0) - (energy[MOODS[x[0]]?.energy] ?? 0))[0][0];
      blocks.splice(i, 1);
      changed = true;
      break;
    }
  }
  return blocks.map(({ moodTime, ...b }, i) => ({ id: `b${i + 1}`, ...b, moodMix: Object.fromEntries(Object.entries(moodTime).map(([m, t]) => [m, round(t, 1)])), track: null }));
}

// ---------------------------------------------------------------- search + licence evidence
export async function searchTracks(query, cfg, { min = 45, max = 600, pageSize = 20 } = {}) {
  const lic = cfg.music.licenses.join(",");
  const results = [];
  for (const page of [1, 2]) {
    const url = `https://api.openverse.org/v1/audio/?q=${encodeURIComponent(query)}&license=${lic}&page_size=${pageSize}&page=${page}`;
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) {
      if (page === 1) throw new Error(`Openverse ${r.status}`);
      break;
    }
    const j = await r.json();
    results.push(...j.results);
    if (!j.page_count || j.page_count <= page) break;
  }
  return results
    .map((t) => {
      const text = `${t.title} ${(t.tags || []).map((x) => x.name).join(" ")} ${(t.genres || []).join(" ")}`;
      const vocals = VOCAL_RE.test(text);
      const dur = (t.duration || 0) / 1000;
      return {
        id: t.id,
        title: t.title,
        creator: t.creator,
        license: t.license,
        licenseVersion: t.license_version,
        licenseUrl: t.license_url,
        landingPage: t.foreign_landing_url,
        fileUrl: t.url,
        provider: t.provider,
        source: t.source,
        duration: round(dur, 1),
        loopTagged: /\bloop(s|able|ed)?\b/i.test(text),
        vocalsRisk: vocals,
        tags: (t.tags || []).map((x) => x.name).slice(0, 12),
        raw: t,
      };
    })
    .filter((t) => cfg.music.licenses.includes(t.license))
    .filter((t) => cfg.music.allowVocals || !t.vocalsRisk)
    .filter((t) => t.duration >= min && t.duration <= max);
}

/** Check the provider's own page states the same licence (Openverse metadata alone is not proof). */
export async function verifyLicence(track) {
  const evidence = { checkedAt: new Date().toISOString(), landingPage: track.landingPage, landingStatus: null, landingConfirms: false, matched: null };
  try {
    const r = await fetch(track.landingPage, { headers: { "User-Agent": UA }, redirect: "follow" });
    evidence.landingStatus = r.status;
    const html = (await r.text()).toLowerCase();
    const patterns = track.license === "cc0"
      ? ["creativecommons.org/publicdomain/zero", "cc0", "creative commons 0", "public domain dedication"]
      : ["creativecommons.org/publicdomain/mark", "public domain mark", "no known copyright"];
    const hit = patterns.find((p) => html.includes(p));
    evidence.landingConfirms = !!hit;
    evidence.matched = hit || null;
  } catch (e) {
    evidence.error = String(e.message || e);
  }
  return evidence;
}

function libraryPaths(cfg) {
  const dir = path.isAbsolute(cfg.music.library) ? cfg.music.library : path.join(cfg._root, cfg.music.library);
  return { dir, ledger: path.join(dir, "ledger.json"), evidence: path.join(dir, "evidence") };
}

export function readLedger(cfg) {
  return readJSON(libraryPaths(cfg).ledger, { version: 1, tracks: {} });
}

/** Download a track into the reusable library with a licence ledger entry. Refuses unverified licences. */
export async function acquireTrack(track, cfg, { allowUnconfirmed = false } = {}) {
  const lib = libraryPaths(cfg);
  ensureDir(lib.evidence);
  const ledger = readLedger(cfg);
  const key = `openverse:${track.id}`;
  if (ledger.tracks[key] && existsSync(path.join(lib.dir, ledger.tracks[key].file))) return ledger.tracks[key];
  const ev = await verifyLicence(track);
  if (!ev.landingConfirms && !allowUnconfirmed) {
    throw new Error(`licence not confirmed on ${track.landingPage} (status ${ev.landingStatus}${ev.error ? ", " + ev.error : ""}) — skipped`);
  }
  const ext = (path.extname(new URL(track.fileUrl).pathname) || ".mp3").toLowerCase();
  const file = `${slug(track.title)}-${track.id.slice(0, 8)}${ext}`;
  const r = await fetch(track.fileUrl, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`download ${r.status}`);
  writeFileSync(path.join(lib.dir, file), Buffer.from(await r.arrayBuffer()));
  const { raw, ...meta } = track;
  writeJSON(path.join(lib.evidence, `${track.id}.json`), { openverse: raw, licenceCheck: ev });
  const info = probe(path.join(lib.dir, file));
  const entry = {
    key,
    file,
    title: track.title,
    creator: track.creator,
    license: track.license,
    licenseLabel: LICENSE_LABEL[track.license] || track.license,
    licenseUrl: track.licenseUrl,
    landingPage: track.landingPage,
    provider: track.provider,
    duration: round(info.duration, 2),
    loopTagged: meta.loopTagged,
    vocalsRisk: meta.vocalsRisk,
    sha256: sha256(path.join(lib.dir, file)),
    licenceCheck: ev,
    evidenceFile: `evidence/${track.id}.json`,
    contentId: "unknown — public-domain audio can still be claimed by third parties; check YouTube Studio → Copyright after upload",
    addedAt: new Date().toISOString(),
    usedIn: [],
  };
  ledger.tracks[key] = entry;
  writeJSON(lib.ledger, ledger);
  return entry;
}

/** Register your own track (e.g. bought/commissioned/self-made) with its licence evidence. */
export function addLocalTrack(cfg, file, { license, evidence, title, creator, notes }) {
  if (!license) throw new Error("--license is required (e.g. cc0, own-work, licensed)");
  const lib = libraryPaths(cfg);
  ensureDir(lib.dir);
  const ledger = readLedger(cfg);
  const dest = path.basename(file);
  run("cp", [file, path.join(lib.dir, dest)]);
  const info = probe(path.join(lib.dir, dest));
  const key = `local:${dest}`;
  ledger.tracks[key] = {
    key, file: dest, title: title || dest, creator: creator || "unknown", license, licenseLabel: license, licenseUrl: evidence || null,
    landingPage: evidence || null, provider: "local", duration: round(info.duration, 2), sha256: sha256(path.join(lib.dir, dest)),
    licenceCheck: { manual: true, notes: notes || null }, contentId: "unknown", addedAt: new Date().toISOString(), usedIn: [],
  };
  writeJSON(lib.ledger, ledger);
  return ledger.tracks[key];
}

export function trackPath(cfg, entry) {
  return path.join(libraryPaths(cfg).dir, entry.file);
}

/** Pick and acquire a track for every block that has none, avoiding repeats within and across recent videos. */
export async function autoAssign(plan, cfg, { projectName, log = console.log } = {}) {
  const ledger = readLedger(cfg);
  const recentlyUsed = new Set(
    Object.values(ledger.tracks).filter((t) => (t.usedIn || []).some((u) => u !== projectName)).map((t) => t.key),
  );
  const used = new Set(plan.blocks.map((b) => b.track?.key).filter(Boolean));
  for (const b of plan.blocks) {
    if (b.track || !b.mood) continue;
    const chain = [b.mood, ...(MOODS[b.mood]?.fallback || [])];
    const queries = chain.flatMap((m) => MOODS[m]?.query || [m]);
    let chosen = null;
    for (const q of queries) {
      let cands;
      try {
        cands = await searchTracks(q, cfg, { min: 40 });
      } catch (e) {
        log(`  search "${q}" failed: ${e.message}`);
        continue;
      }
      cands.sort((x, y) => score(y, b) - score(x, b));
      for (const c of cands) {
        const key = `openverse:${c.id}`;
        if (used.has(key) || recentlyUsed.has(key)) continue;
        try {
          chosen = await acquireTrack(c, cfg);
          break;
        } catch (e) {
          log(`  ${c.title}: ${e.message}`);
        }
      }
      if (chosen) break;
    }
    if (!chosen) {
      log(`  ${b.id}: no verified track found for mood "${b.mood}" — block will be silent`);
      continue;
    }
    used.add(chosen.key);
    b.track = { key: chosen.key, file: chosen.file, title: chosen.title, creator: chosen.creator, license: chosen.license, landingPage: chosen.landingPage, query: chosen.query };
    log(`  ${b.id} (${b.mood}, ${b.segments.join(",")}): "${chosen.title}" by ${chosen.creator} — ${chosen.licenseLabel}`);
  }
  return plan;
}

function score(t, block) {
  const need = block.end - block.start;
  let s = 0;
  if (t.loopTagged) s += 3;
  if (t.duration >= need) s += 2;
  if (t.duration >= 90) s += 1;
  if (t.provider === "freesound" || t.provider === "ccmixter" || t.provider === "jamendo") s += 0.5;
  return s;
}

export function markUsed(cfg, plan, projectName) {
  const lib = libraryPaths(cfg);
  const ledger = readLedger(cfg);
  for (const b of plan.blocks) {
    const t = b.track && ledger.tracks[b.track.key];
    if (t && !t.usedIn.includes(projectName)) t.usedIn.push(projectName);
  }
  writeJSON(lib.ledger, ledger);
}

// ---------------------------------------------------------------- bed rendering + ducking
/** Render a block's bed: loop with crossfades to length, bake fade in/out. */
export function renderBed(src, out, duration, { fadeIn = 1.5, fadeOut = 1.5, offset = 0 } = {}) {
  const info = probe(src);
  const len = info.duration - offset;
  const xf = 1.2;
  ensureDir(path.dirname(out));
  if (len >= duration) {
    run("ffmpeg", ["-v", "error", "-y", "-ss", String(offset), "-t", String(duration), "-i", src, "-af",
      `afade=t=in:d=${fadeIn},afade=t=out:st=${Math.max(0, duration - fadeOut)}:d=${fadeOut}`, "-ar", "48000", "-ac", "2", out]);
    return out;
  }
  const copies = Math.ceil((duration + xf) / (len - xf)) + 1;
  const inputs = [];
  for (let i = 0; i < copies; i++) inputs.push("-i", src);
  let chain = "";
  let last = "[0:a]";
  for (let i = 1; i < copies; i++) {
    const o = `[x${i}]`;
    chain += `${last}[${i}:a]acrossfade=d=${xf}:c1=tri:c2=tri${o};`;
    last = o;
  }
  chain += `${last}atrim=0:${duration},afade=t=in:d=${fadeIn},afade=t=out:st=${Math.max(0, duration - fadeOut)}:d=${fadeOut}[out]`;
  run("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", chain, "-map", "[out]", "-ar", "48000", "-ac", "2", out]);
  return out;
}

/** Volume automation points (relative to clip start) that duck under speech and lift in long pauses. */
export function duckingPoints(speech, clipStart, clipEnd, { liftDb = 5, liftAfter = 1.4, attack = 0.12, release = 0.45 } = {}) {
  const lift = round(dbToGain(liftDb), 3);
  const pts = [];
  const add = (t, v) => {
    const tt = round(clamp(t - clipStart, 0, clipEnd - clipStart), 3);
    if (pts.length && tt <= pts.at(-1).t) {
      pts.at(-1).v = v;
      return;
    }
    pts.push({ t: tt, v });
  };
  const inClip = speech.filter((s) => s.end > clipStart && s.start < clipEnd);
  if (!inClip.length) return [{ t: 0, v: lift }];
  add(clipStart, inClip[0].start - clipStart > liftAfter ? lift : 1);
  for (let i = 0; i < inClip.length; i++) {
    const s = inClip[i];
    const next = inClip[i + 1];
    add(s.start - attack, pts.at(-1)?.v ?? 1);
    add(s.start, 1);
    const gapEnd = next ? next.start : clipEnd;
    if (gapEnd - s.end > liftAfter) {
      add(s.end + 0.15, 1);
      add(s.end + 0.15 + release, lift);
      add(gapEnd - 0.35, lift);
      add(gapEnd - 0.1, 1);
    }
  }
  return pts;
}

// ---------------------------------------------------------------- beats (for intro/outro sync)
/** Onsets and a steady beat grid from an audio file (energy-flux onset detector + autocorrelation tempo). */
export function detectBeats(file, { maxSeconds } = {}) {
  const rate = 11025;
  const x = decodeMono(file, rate, maxSeconds ? { duration: maxSeconds } : {});
  const hop = 256;
  const win = 1024;
  const frames = Math.floor((x.length - win) / hop);
  const energy = new Float64Array(Math.max(0, frames));
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = 0; i < win; i++) {
      const v = x[f * hop + i];
      s += v * v;
    }
    energy[f] = Math.log(1e-9 + s);
  }
  const flux = new Float64Array(frames);
  for (let f = 1; f < frames; f++) flux[f] = Math.max(0, energy[f] - energy[f - 1]);
  const fps = rate / hop;
  const onsets = [];
  const W = Math.round(fps * 0.5);
  for (let f = 1; f < frames - 1; f++) {
    let mean = 0;
    let n = 0;
    for (let k = Math.max(0, f - W); k < Math.min(frames, f + W); k++) {
      mean += flux[k];
      n++;
    }
    mean /= n || 1;
    if (flux[f] > flux[f - 1] && flux[f] >= flux[f + 1] && flux[f] > mean * 1.6 + 0.08) {
      const t = f / fps;
      if (!onsets.length || t - onsets.at(-1).t > 0.12) onsets.push({ t: round(t, 3), s: round(flux[f], 3) });
    }
  }
  // tempo by autocorrelation of flux in 60–180 BPM
  let best = { lag: 0, v: -1 };
  for (let lag = Math.round((fps * 60) / 180); lag <= Math.round((fps * 60) / 60); lag++) {
    let v = 0;
    for (let f = 0; f + lag < frames; f++) v += flux[f] * flux[f + lag];
    v /= Math.max(1, frames - lag);
    const bpmL = (60 * fps) / lag;
    v *= Math.exp(-0.5 * (Math.log2(bpmL / 120) / 0.9) ** 2); // tempo prior: avoid half/double-time picks
    if (v > best.v) best = { lag, v };
  }
  // refine the period (frame quantisation alone drifts ~2%): maximise flux sampled on the grid
  let period = best.lag / fps;
  if (period) {
    const fluxAt = (t) => {
      const f = Math.round(t * fps);
      let m = 0;
      for (let k = f - 2; k <= f + 2; k++) if (k >= 0 && k < frames) m = Math.max(m, flux[k]);
      return m;
    };
    let bestP = { p: period, phase: 0, v: -1 };
    for (let p = period * 0.96; p <= period * 1.04; p += 0.0005) {
      for (let ph = 0; ph < p; ph += 0.01) {
        let v = 0;
        for (let t = ph; t < frames / fps; t += p) v += fluxAt(t);
        if (v > bestP.v) bestP = { p, phase: ph, v };
      }
    }
    period = bestP.p;
    best.phase = bestP.phase;
  }
  const bpm = period ? round(60 / period, 1) : null;
  const strong = [...onsets].sort((a, b) => b.s - a.s).slice(0, Math.max(4, Math.round(onsets.length * 0.25))).sort((a, b) => a.t - b.t);
  const first = strong[0]?.t ?? 0;
  const dur = x.length / rate;
  const beats = [];
  if (period) for (let t = best.phase ?? first - Math.floor(first / period) * period; t < dur; t += period) beats.push(round(t, 3));
  return { duration: round(dur, 3), bpm, period: round(period, 3), firstStrong: first, beats, onsets: strong.map((o) => o.t) };
}
