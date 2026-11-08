#!/usr/bin/env node
// storycut — script-driven video editing on HyperFrames.  Run `storycut help` for commands.
import path from "node:path";
import { existsSync, copyFileSync } from "node:fs";
import { parseArgs, readJSON, writeJSON, writeText, readText, run, fmtTime, parseTime, ENGINE_DIR, ensureDir, fail, probe } from "../lib/util.mjs";
import { loadConfig, listStyles, loadStyle, CONFIG_NAME, resolvePath } from "../lib/config.mjs";
import { newProject, setRecording, runTranscribe, runReconcile, resolveQuestion, status, correctTranscriptWord, syncCaptionsFromTranscript } from "../lib/project.mjs";
import * as C from "../lib/captions.mjs";
import { build, projectPaths, HF_VERSION } from "../lib/build.mjs";
import { analyzeNarration, planBlocks, searchTracks, acquireTrack, autoAssign, addLocalTrack, readLedger, markUsed, detectBeats } from "../lib/music.mjs";
import { parseScript } from "../lib/script.mjs";
import { checkSponsor, insertSponsor } from "../lib/sponsor.mjs";
import { runQc } from "../lib/qc.mjs";
import { serveEditor } from "../lib/editor.mjs";
import { SEGMENT_TYPES } from "../lib/segments.mjs";
import { renderBrand } from "../lib/brandkit.mjs";
import { runClean, setDecision, previewEdit } from "../lib/clean.mjs";

const HELP = `storycut — turn a script + your recording into a styled, captioned, scored video (HyperFrames)

Setup
  init [dir] [--channel "Name"] [--style id]     write storycut.config.json + asset folders
  styles                                         list editing styles
  doctor                                         check ffmpeg, node, HyperFrames, whisper

Episode
  new <project> --script s.md [--recording r.wav] [--style id] [--episode-label "#003"]
  recording <project> <file>                     add/replace the recording
  transcribe <project> [--model small.en] [--from transcript.json|.srt]
  reconcile <project> [--regen-captions]         compare recording vs script → as-recorded script, segments, questions
  questions <project>                            show unclear passages (with timestamps + audio clips)
  resolve <project> <U#> "what I said"          answer a question; captions + script re-sync
                       | --keep                  the transcript (or second listen) heard it right
                       | --skip                  (missing/unheard) I didn't say it / it wasn't speech
  prepare <project>                              transcribe + reconcile + music analyze/auto in one go

Voiceover cleanup (original never modified; working copy in recording/cleaned/)
  clean <project>                               remove long silences, false starts, repeated takes; denoise/EQ/compress
                                                 only as measured; flags uncertain edits → edit-log.md
  clean <project> list | preview <E#> | approve <E#> | reject <E#> | restore <E#>

Captions (captions.json is independent of the script)
  captions <project> list [--from t] [--to t]
  captions <project> add <start> <end> "text"
  captions <project> edit <id> [--text "…"] [--start t] [--end t]
  captions <project> delete <id>
  captions <project> shift <seconds> [--from t] [--to t]
  captions <project> split <id> <wordIndex>  |  merge <idA> <idB>
  captions <project> replace "wrong" "right" [--no-transcript]   fix a transcription mistake everywhere
  captions <project> style [key=value …] [--reset]                font, size, case, color, activeColor, activeBg,
                                                                 box, boxBorder, shadow, position, offset, animation
  captions <project> validate | export srt|vtt [--out f] | regenerate
  captions <project> serve [--port 4747] [--host 0.0.0.0]        browser editor with video preview
  captions <project> preview <time> [--out f.png]                 rendered frame of the final look (needs build)

Music
  music <project> analyze                       narration level/clarity/pace + mood per segment → blocks
  music <project> auto                          find CC0/PD tracks, verify licence on source page, assign
  music <project> search "<query>"              list licence-filtered candidates
  music <project> pick <block> <openverse-id>   use a specific track for a block
  music <project> mood <block> <mood>           override a block's mood (then auto)
  music <project> list                          show plan + licence evidence
  music add-local <file> --license cc0 --evidence <url> [--title] [--creator]
  music beats <audio>                           beat grid used to sync intro/outro

Sponsor
  sponsor check                                 verify sponsor facts/script against the sponsor's website
  sponsor insert <script.md> [--out f]          add the sponsor section at the configured placement

Brand
  brand render [--only intro|outro]             render the reusable intro/outro (with music) to assets/brand/*.mp4

Output
  build <project> [--allow-uncertain]           write the HyperFrames project (build/)
  preview <project>                             open HyperFrames Studio on the build
  render <project> [--quality draft|standard|high] [--fps n]
  qc <project>                                  final checks → qc/report.md (exit 1 on failures)
  status <project>
`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = parseArgs(rest);
  const dir = a._[0] ? path.resolve(a._[0]) : process.cwd();
  switch (cmd) {
    case undefined:
    case "help":
    case "--help":
      console.log(HELP);
      return;
    case "init":
      return init(dir, a);
    case "styles":
      for (const s of listStyles()) console.log(`${s.id.padEnd(24)} ${s.name} — ${s.summary}`);
      return;
    case "segments":
      for (const [id, s] of Object.entries(SEGMENT_TYPES)) console.log(`${id.padEnd(16)} ${s.label} (mood: ${s.mood})`);
      return;
    case "doctor":
      return doctor();
    case "new": {
      const proj = newProject(dir, { script: a.script && path.resolve(a.script), recording: a.recording && path.resolve(a.recording), style: a.style, name: a.name, episodeLabel: a["episode-label"], nextLabel: a["next-label"] });
      console.log(`created ${dir} (${proj.name})`);
      return;
    }
    case "recording":
      setRecording(dir, path.resolve(a._[1]));
      console.log("recording set");
      return;
    case "transcribe": {
      const t = runTranscribe(dir, { model: a.model, engine: a.engine, from: a.from && path.resolve(a.from) });
      console.log(`transcribed ${t.words.length} words with ${t.engine} (${t.model})${t.hasConfidence ? ", with confidence scores" : ", no confidence scores"}`);
      return;
    }
    case "reconcile":
      return printReconcile(runReconcile(dir, { regenCaptions: !!a["regen-captions"] }), dir);
    case "questions":
      return printQuestions(dir);
    case "resolve": {
      const r = resolveQuestion(dir, a._[1], { text: a._[2], keep: !!a.keep, skip: !!a.skip });
      console.log(`${a._[1]} resolved.`);
      return printReconcile(r, dir);
    }
    case "prepare":
      return prepare(dir, a);
    case "captions":
      return captions(dir, a);
    case "music":
      return music(a);
    case "sponsor":
      return sponsor(a);
    case "build": {
      const plan = await build(dir, { allowUncertain: !!a["allow-uncertain"] });
      console.log(`built ${path.join(dir, "build")} — ${fmtTime(plan.duration)} · style ${plan.style} · ${plan.segments.length} segments · ${plan.cards.length} cards · ${plan.beds.length} music beds · ${plan.captions.count} captions`);
      for (const w of plan.warnings) console.log(`  ⚠ ${w}`);
      if (plan.unrendered.length) console.log(`  ⚠ ${plan.unrendered.length} cue(s) need real media (listed in build/storycut-plan.json)`);
      return;
    }
    case "preview":
      run("npx", ["-y", `hyperframes@${HF_VERSION}`, "preview"], { cwd: path.join(dir, "build"), inherit: true });
      return;
    case "render":
      return render(dir, a);
    case "qc": {
      const r = runQc(dir, { render: a.render && path.resolve(a.render) });
      console.log(r.md);
      if (r.fails) process.exitCode = 1;
      return;
    }
    case "brand": {
      if (a._[0] !== "render") fail("storycut brand render [--only intro|outro] [--quality draft]");
      for (const r of renderBrand(process.cwd(), { only: a.only, quality: a.quality })) console.log(`${r.id}: ${r.out} (${r.duration.toFixed(2)}s, ${r.bpm ?? "?"} BPM)`);
      console.log("set intro.video / outro.video in storycut.config.json to use these in every episode");
      return;
    }
    case "clean": {
      const sub = a._[1] || "run";
      const show = (r) => {
        const s = r.summary;
        console.log(`cleaned VO: ${s.cleaned.file} · ${fmtTime(s.original.duration)} → ${fmtTime(s.cleaned.duration)} (-${s.removedSeconds}s) · ${s.pausesShortened} pauses shortened · ${s.retakesRemoved} retakes + ${s.falseStartsRemoved} false starts removed · ${s.flagged} flagged · ${s.keptRepeats} intentional repeats kept`);
        for (const n of s.chain) console.log(`  · ${n}`);
        for (const e of r.edits.filter((x) => x.status === "flagged")) console.log(`  ⚑ ${e.id} ${fmtTime(e.start)} (≈${fmtTime(e.cleanAt)} in cleaned VO) ${e.type}: "${e.text.slice(0, 70)}" — ${e.reason}`);
        console.log(`edit log: ${path.join(dir, "edit-log.md")}`);
      };
      if (sub === "run") return show(runClean(dir));
      if (["approve", "reject", "restore"].includes(sub)) return show(setDecision(dir, a._[2], sub));
      if (sub === "preview") {
        const r = previewEdit(dir, a._[2]);
        console.log(`before: ${r.before}\nafter:  ${r.after}`);
        return;
      }
      if (sub === "list") {
        const d = readJSON(path.join(dir, "work", "clean", "edits.json"));
        for (const e of d.edits) console.log(`${e.id} ${e.status.padEnd(8)} ${e.type.padEnd(12)} ${fmtTime(e.start)}–${fmtTime(e.end)}  ${e.text.slice(0, 70)}`);
        return;
      }
      fail("clean <ep> [run|list|preview <id>|approve <id>|reject <id>|restore <id>]");
      return;
    }
    case "status":
      console.log(JSON.stringify(status(dir), null, 2));
      return;
    default:
      fail(`unknown command "${cmd}" — storycut help`);
  }
}

function init(dir, a) {
  const f = path.join(dir, CONFIG_NAME);
  if (existsSync(f) && !a.force) fail(`${f} exists (use --force to overwrite)`);
  const tpl = readJSON(path.join(ENGINE_DIR, "examples", "storycut.config.example.json"));
  if (a.channel) tpl.channel.name = a.channel;
  if (a.style) {
    loadStyle(a.style);
    tpl.style = a.style;
  }
  writeJSON(f, tpl);
  for (const d of ["assets/music/intro", "assets/music/outro", "assets/music/library", "assets/sfx", "assets/memes", "assets/brand"]) ensureDir(path.join(dir, d));
  console.log(`wrote ${f}\nnext: put your intro/outro songs in assets/music/intro and assets/music/outro, then set intro.music / outro.music`);
}

function doctor() {
  const ok = (b) => (b ? "✓" : "✗");
  const has = (c, args) => {
    try {
      return run(c, args, { allowFail: true }).status === 0;
    } catch {
      return false;
    }
  };
  console.log(`${ok(Number(process.versions.node.split(".")[0]) >= 22)} node ${process.versions.node} (need ≥ 22)`);
  console.log(`${ok(has("ffmpeg", ["-version"]))} ffmpeg`);
  console.log(`${ok(has("npx", ["-y", `hyperframes@${HF_VERSION}`, "--version"]))} hyperframes@${HF_VERSION}`);
  const cfg = loadConfig(process.cwd());
  console.log(`${ok(!!cfg._file)} config ${cfg._file || `(none — storycut init)`}`);
  if (cfg._file) {
    for (const k of ["intro", "outro"]) {
      const p = resolvePath(cfg, cfg[k].music);
      console.log(`${ok(p && existsSync(p))} ${k} music ${cfg[k].music || "(not set)"}`);
    }
    console.log(`${ok(!cfg.sponsor.enabled || !!cfg.sponsor.url)} sponsor ${cfg.sponsor.enabled ? cfg.sponsor.name : "(disabled)"}`);
  }
}

function printReconcile({ rec, questions, captionsNote }, dir) {
  const s = rec.stats;
  console.log(`script coverage ${(s.scriptCoverage * 100).toFixed(1)}% · ${s.adlibWords} ad-lib words · ${rec.diffs.filter((d) => !d.minor).length} notable differences · ${captionsNote}`);
  console.log(`→ ${path.join(dir, "work", "reconcile.md")}  ·  script.as-recorded.md  ·  segments.json`);
  if (rec.spellings?.length) console.log(`spelling differences: ${rec.spellings.map((x) => `"${x.said}"→"${x.scripted}"`).join(", ")} (fix: captions <project> replace "<heard>" "<script>")`);
  const open = questions.filter((q) => q.status === "open");
  if (open.length) {
    console.log(`\n${open.length} unclear passage(s) — do not guess; ask the creator:`);
    for (const q of open) console.log(`  ${q.id} [${q.kind}] @ ${q.at}  heard "${q.heard || "(nothing)"}" (p=${q.confidence})  …${q.before} [▮] ${q.after}…${q.scriptExpected ? `  script: "${q.scriptExpected}"` : ""}\n     clip: ${q.clip}`);
  }
}

function printQuestions(dir) {
  const qs = readJSON(projectPaths(dir).questions, []);
  if (!qs.length) return console.log("no questions");
  for (const q of qs) console.log(`${q.id} [${q.status}] @ ${q.at}  heard "${q.heard}"${q.answer ? ` → "${q.answer}"` : ""}  …${q.before} [▮] ${q.after}…  ${q.clip || ""}`);
}

async function prepare(dir, a) {
  const t = runTranscribe(dir, { model: a.model });
  console.log(`transcribed ${t.words.length} words (${t.engine})`);
  const r = runReconcile(dir);
  printReconcile(r, dir);
  await musicAnalyze(dir);
  if (!a["no-music"]) await musicAuto(dir);
}

// ------------------------------------------------------------------ captions
async function captions(dir, a) {
  const P = projectPaths(dir);
  const sub = a._[1];
  const doc = existsSync(P.captions) ? readJSON(P.captions) : null;
  if (!doc && sub !== "regenerate") fail("no captions.json yet — run reconcile first");
  const save = () => writeJSON(P.captions, doc);
  const t = (v) => (v === undefined ? undefined : parseTime(v));
  switch (sub) {
    case "list":
    case undefined: {
      const from = t(a.from) ?? 0;
      const to = t(a.to) ?? Infinity;
      for (const c of doc.captions.filter((c) => c.start >= from && c.start <= to)) console.log(`${c.id}  ${fmtTime(c.start)} → ${fmtTime(c.end)}  ${c.source.padEnd(6)}  ${c.text}`);
      console.log(`${doc.captions.length} captions`);
      return;
    }
    case "add":
      console.log(C.addCaption(doc, { start: t(a._[2]), end: t(a._[3]), text: a._.slice(4).join(" ") }));
      return save();
    case "edit":
      console.log(C.editCaption(doc, a._[2], { text: a.text, start: t(a.start), end: t(a.end) }));
      return save();
    case "delete":
      console.log(`deleted ${C.deleteCaption(doc, a._[2]).id}`);
      return save();
    case "shift":
      console.log(`shifted ${C.shiftCaptions(doc, Number(a._[2]), { from: t(a.from), to: t(a.to) })} captions`);
      return save();
    case "split":
      console.log(C.splitCaption(doc, a._[2], a._[3]));
      return save();
    case "merge":
      console.log(C.mergeCaptions(doc, a._[2], a._[3]));
      return save();
    case "replace": {
      const ids = C.replaceText(doc, a._[2], a._[3], { wholeWord: !a.partial });
      save();
      console.log(`replaced in ${ids.length} caption(s): ${ids.join(", ")}`);
      if (!a["no-transcript"]) {
        const n = correctTranscriptWord(dir, a._[2], a._[3]);
        if (n) {
          runReconcile(dir); // keep the as-recorded script in sync with the correction
          console.log(`also corrected ${n} occurrence(s) in the transcript and script.as-recorded.md`);
        }
      }
      return;
    }
    case "style": {
      if (a.reset) doc.style = {};
      for (const kv of a._.slice(2)) {
        const [k, ...v] = kv.split("=");
        if (!C.CAPTION_STYLE_KEYS.includes(k)) fail(`unknown caption style key "${k}" (${C.CAPTION_STYLE_KEYS.join(", ")})`);
        let val = v.join("=");
        if (/^-?\d+(\.\d+)?$/.test(val)) val = Number(val);
        else if (val === "true" || val === "false") val = val === "true";
        doc.style = { ...(doc.style || {}), [k]: val };
      }
      save();
      console.log(JSON.stringify(doc.style, null, 2));
      return;
    }
    case "validate": {
      const issues = C.validateCaptions(doc, { rangeEnd: probe(path.join(dir, readJSON(P.project).recording)).duration });
      for (const i of issues) console.log(`${i.level.padEnd(5)} ${i.id} ${i.msg}`);
      console.log(`${issues.length} issue(s)`);
      if (issues.some((i) => i.level === "error")) process.exitCode = 1;
      return;
    }
    case "export": {
      const kind = a._[2] || "srt";
      const proj = readJSON(P.project);
      const plan = existsSync(path.join(P.build, "storycut-plan.json")) ? readJSON(path.join(P.build, "storycut-plan.json")) : null;
      const offset = a.recording ? 0 : plan?.narration.start ?? 0; // default: timed to the final video
      const out = a.out ? path.resolve(a.out) : path.join(P.renders, `${proj.name}.${kind}`);
      writeText(out, kind === "vtt" ? C.toVtt(doc, offset) : C.toSrt(doc, offset));
      console.log(`wrote ${out} (offset ${offset}s — ${a.recording ? "recording time" : "final video time"})`);
      return;
    }
    case "regenerate": {
      if (doc && doc.captions.some((c) => c.source !== "auto") && !a.force) fail("captions have manual edits — add --force to discard them");
      runReconcile(dir, { regenCaptions: true });
      console.log("captions regenerated from the transcript");
      return;
    }
    case "sync":
      console.log(`re-synced ${syncCaptionsFromTranscript(dir, t(a.from) ?? 0, t(a.to) ?? Infinity)} captions from the transcript`);
      return;
    case "serve": {
      const { url } = serveEditor(dir, { port: Number(a.port || 4747), host: a.host || "127.0.0.1" });
      console.log(`caption editor: ${url}  (Ctrl+C to stop; edits save to captions.json — rebuild to see them in the video)`);
      return;
    }
    case "preview": {
      const at = parseTime(a._[2] || 0);
      const plan = readJSON(path.join(P.build, "storycut-plan.json"));
      const vt = at + plan.narration.start;
      const out = a.out ? path.resolve(a.out) : path.join(dir, "work", `caption-preview-${at}.png`);
      const r = run("npx", ["-y", `hyperframes@${HF_VERSION}`, "snapshot", "--at", String(vt), "--json"], { cwd: P.build, allowFail: true, timeout: 600000 });
      console.log(r.stdout.trim().split("\n").pop());
      void out;
      return;
    }
    default:
      fail(`unknown captions command "${sub}"`);
  }
}

// ------------------------------------------------------------------ music
async function musicAnalyze(dir) {
  const P = projectPaths(dir);
  const cfg = loadConfig(dir, { required: true });
  const proj = readJSON(P.project);
  const doc = parseScript(readText(path.join(dir, proj.script)));
  const analysis = analyzeNarration(path.join(dir, proj.recording), readJSON(P.transcript), readJSON(P.segments), cfg, doc);
  const old = readJSON(P.music, null);
  const blocks = planBlocks(analysis, cfg);
  // keep tracks the creator already chose when the block covers the same segments
  if (old) for (const b of blocks) {
    const prev = old.blocks.find((o) => o.segments.join() === b.segments.join() && o.mood === b.mood);
    if (prev?.track) b.track = prev.track;
  }
  writeJSON(P.music, { analyzedAt: new Date().toISOString(), analysis, blocks });
  const n = analysis.narration;
  console.log(`narration ${n.lufs} LUFS · LRA ${n.lra} · SNR ~${n.snrDb} dB · speech ${Math.round(n.speechRatio * 100)}% of the time`);
  for (const b of blocks) console.log(`  ${b.id} ${fmtTime(b.start)}–${fmtTime(b.end)} mood=${b.mood ?? "none"} bed ${b.underSpeechDb} dB under voice · ${b.segments.join(",")}`);
}

async function musicAuto(dir) {
  const P = projectPaths(dir);
  const cfg = loadConfig(dir, { required: true });
  const plan = readJSON(P.music);
  const proj = readJSON(P.project);
  await autoAssign(plan, cfg, { projectName: proj.name });
  writeJSON(P.music, plan);
  markUsed(cfg, plan, proj.name);
}

async function music(a) {
  const sub = a._[1];
  if (a._[0] === "add-local") {
    const cfg = loadConfig(process.cwd(), { required: true });
    console.log(addLocalTrack(cfg, path.resolve(a._[1]), { license: a.license, evidence: a.evidence, title: a.title, creator: a.creator, notes: a.notes }));
    return;
  }
  if (a._[0] === "beats") {
    console.log(JSON.stringify(detectBeats(path.resolve(a._[1])), null, 1).slice(0, 2000));
    return;
  }
  const dir = path.resolve(a._[0]);
  const P = projectPaths(dir);
  const cfg = loadConfig(dir, { required: true });
  switch (sub) {
    case "analyze":
      return musicAnalyze(dir);
    case "auto":
      return musicAuto(dir);
    case "search": {
      const res = await searchTracks(a._.slice(2).join(" "), cfg, { min: Number(a.min || 40) });
      for (const t of res) console.log(`${t.id}  ${t.license}  ${String(t.duration).padStart(6)}s  ${t.loopTagged ? "loop" : "    "}  ${t.title} — ${t.creator} (${t.provider}) ${t.landingPage}`);
      return;
    }
    case "pick": {
      const plan = readJSON(P.music);
      const b = plan.blocks.find((x) => x.id === a._[2]);
      if (!b) fail(`no block ${a._[2]}`);
      const r = await fetch(`https://api.openverse.org/v1/audio/${a._[3]}/`, { headers: { "User-Agent": "storycut/1.0" } });
      if (!r.ok) fail(`Openverse ${r.status}`);
      const t = await r.json();
      const [cand] = (await searchTracks(t.title, cfg, { min: 1, max: 10000 })).filter((x) => x.id === t.id);
      if (!cand) fail("track not found with an allowed licence");
      const entry = await acquireTrack(cand, cfg);
      b.track = { key: entry.key, file: entry.file, title: entry.title, creator: entry.creator, license: entry.license, landingPage: entry.landingPage };
      writeJSON(P.music, plan);
      console.log(`${b.id} → "${entry.title}" (${entry.licenseLabel}) evidence: ${entry.evidenceFile}`);
      return;
    }
    case "mood": {
      const plan = readJSON(P.music);
      const b = plan.blocks.find((x) => x.id === a._[2]);
      if (!b) fail(`no block ${a._[2]}`);
      b.mood = a._[3] === "none" ? null : a._[3];
      b.track = null;
      writeJSON(P.music, plan);
      console.log(`${b.id} mood → ${b.mood} (run: music ${a._[0]} auto)`);
      return;
    }
    case "list": {
      const plan = readJSON(P.music);
      const ledger = readLedger(cfg);
      for (const b of plan.blocks) {
        const e = b.track && ledger.tracks[b.track.key];
        console.log(`${b.id} ${fmtTime(b.start)}–${fmtTime(b.end)} ${b.mood ?? "none"} → ${e ? `"${e.title}" by ${e.creator} · ${e.licenseLabel} · ${e.landingPage} · licence on page: ${e.licenceCheck?.landingConfirms ? "confirmed" : "manual"}` : "(none)"}`);
      }
      return;
    }
    default:
      fail(`unknown music command "${sub}"`);
  }
}

// ------------------------------------------------------------------ sponsor
async function sponsor(a) {
  const cfg = loadConfig(process.cwd(), { required: true });
  const sub = a._[0];
  if (sub === "check") {
    const r = await checkSponsor(cfg);
    console.log(`sponsor page ${r.url} → ${r.status ?? r.error}`);
    for (const f of r.facts) console.log(`  ${f.found ? "✓" : "✗"} ${f.claim}  (evidence: "${f.evidence}")`);
    for (const f of r.scriptFlags) console.log(`  ⚠ script says "${f.phrase}" — ${f.why}`);
    if (r.tooLong) console.log(`  ⚠ ${r.tooLong}`);
    console.log(r.ok ? `OK — ${r.words} words, ~${r.estSeconds}s` : "NOT OK — fix the items above before recording");
    if (!r.ok) process.exitCode = 1;
    return;
  }
  if (sub === "insert") {
    const file = path.resolve(a._[1]);
    const md = insertSponsor(readText(file), cfg);
    const out = a.out ? path.resolve(a.out) : file;
    if (out === file) copyFileSync(file, `${file}.bak`);
    writeText(out, md);
    console.log(`sponsor section inserted → ${out}`);
    return;
  }
  fail("sponsor check | sponsor insert <script.md>");
}

// ------------------------------------------------------------------ render
function render(dir, a) {
  const P = projectPaths(dir);
  const proj = readJSON(P.project);
  ensureDir(P.renders);
  const out = path.join(P.renders, `${proj.name}.mp4`);
  const chk = run("npx", ["-y", `hyperframes@${HF_VERSION}`, "check", "--json"], { cwd: P.build, allowFail: true, timeout: 900000 });
  const last = chk.stdout.trim().split("\n").pop() || "{}";
  let parsed = {};
  try {
    parsed = JSON.parse(last);
  } catch {
    /* non-json */
  }
  if (chk.status !== 0 && !a.force) {
    console.log(chk.stdout.slice(-4000));
    fail("hyperframes check failed — fix the build (or --force)");
  }
  void parsed;
  const args = ["-y", `hyperframes@${HF_VERSION}`, "render", "--output", out];
  if (a.quality) args.push("--quality", a.quality);
  if (a.fps) args.push("--fps", String(a.fps));
  run("npx", args, { cwd: P.build, inherit: true, timeout: 6 * 60 * 60 * 1000 });
  console.log(`rendered ${out}\nnext: storycut qc ${a._[0] || "."}`);
}

main().catch((e) => fail(e.message || String(e)));
