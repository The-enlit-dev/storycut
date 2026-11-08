#!/usr/bin/env node
// End-to-end test on the bundled sample. Generates a narration with local TTS that deliberately differs
// from the script (ad-libs, a reworded line, a line buried in noise), synthesises placeholder intro/outro
// songs, then runs the whole pipeline: transcribe → reconcile → resolve → music → build (every style) →
// hyperframes check → render → qc.  Usage: node test/e2e.mjs <workdir> [--skip-render] [--styles]
import path from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SC = (args, opts = {}) => execFileSync("node", [path.join(ENGINE, "bin", "storycut.mjs"), ...args], { cwd: WS, encoding: "utf8", stdio: opts.quiet ? "pipe" : ["ignore", "pipe", "inherit"], maxBuffer: 1 << 28 });
const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: "pipe", maxBuffer: 1 << 28 });
const argv = process.argv.slice(2);
const WS = path.resolve(argv.find((a) => !a.startsWith("--")) || "storycut-e2e");
const skipRender = argv.includes("--skip-render");
const allStyles = argv.includes("--styles");
const ok = (c, m) => {
  if (!c) {
    console.error(`✗ ${m}`);
    process.exit(1);
  }
  console.log(`✓ ${m}`);
};

mkdirSync(WS, { recursive: true });
const media = path.join(WS, "_media");
mkdirSync(media, { recursive: true });

// 1. narration via local TTS; line 6 buried in noise to simulate an unclear passage
const lines = readFileSync(path.join(ENGINE, "examples", "sample", "recording-lines.txt"), "utf8").trim().split("\n");
if (!existsSync(path.join(media, "narration.wav"))) {
  lines.forEach((l, i) => sh("npx", ["-y", "hyperframes", "tts", l, "-o", `l${i + 1}.wav`, "-v", "am_michael"], media));
  sh("ffmpeg", ["-v", "error", "-y", "-i", "l6.wav", "-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.6:d=10", "-filter_complex", "[0:a]volume=0.35[v];[v][1:a]amix=inputs=2:duration=first:normalize=0", "l6n.wav"], media);
  copyFileSync(path.join(media, "l6n.wav"), path.join(media, "l6.wav"));
  sh("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "0.45", "short.wav"], media);
  sh("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "1.1", "long.wav"], media);
  const list = lines.map((_, i) => `file 'l${i + 1}.wav'\nfile '${[1, 2, 4, 7, 8, 10].includes(i + 1) ? "long" : "short"}.wav'`).join("\n");
  writeFileSync(path.join(media, "list.txt"), list + "\n");
  sh("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", "list.txt", "-ar", "48000", "-ac", "1", "narration.wav"], media);
  // placeholder 120 BPM songs (the creator supplies real ones)
  const song = (dur, f1, f2, out) => sh("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `aevalsrc='0.6*sin(2*PI*(50+60*exp(-mod(t,0.5)*30))*mod(t,0.5))*exp(-mod(t,0.5)*9) + 0.12*sin(2*PI*${f1}*t)*(0.6+0.4*sin(2*PI*0.5*t)) + 0.08*sin(2*PI*${f2}*t)':s=44100:d=${dur}`, "-af", `afade=t=out:st=${dur - 1}:d=1`, "-ac", "2", out], media);
  song(8, 220, 330, "intro.wav");
  song(11, 196, 294, "outro.wav");
}
ok(existsSync(path.join(media, "narration.wav")), "sample narration generated");

// 2. channel config
if (!existsSync(path.join(WS, "storycut.config.json"))) {
  SC(["init", ".", "--channel", "Demo Weekly", "--style", "neo-brutalism"]);
  const c = JSON.parse(readFileSync(path.join(WS, "storycut.config.json"), "utf8"));
  Object.assign(c.channel, { series: "Demo Weekly", tagline: "Technology, explained. Then judged." });
  copyFileSync(path.join(media, "intro.wav"), path.join(WS, "assets/music/intro/intro.wav"));
  copyFileSync(path.join(media, "outro.wav"), path.join(WS, "assets/music/outro/outro.wav"));
  c.intro.music = "assets/music/intro/intro.wav";
  c.outro.music = "assets/music/outro/outro.wav";
  Object.assign(c.sponsor, {
    enabled: true, name: "Example Product", url: "https://example.com", disclosure: "Demo sponsor for testing", maxSeconds: 30,
    script: "Quick break. This video is sponsored by Example Product, a demo sponsor used to test this template. Visit example dot com to learn more.",
    facts: [{ claim: "example.com is for documentation examples", evidence: "This domain is for use in documentation examples" }],
  });
  writeFileSync(path.join(WS, "storycut.config.json"), JSON.stringify(c, null, 2));
}
const spon = SC(["sponsor", "check"], { quiet: true });
ok(/OK —/.test(spon), "sponsor facts verified on the sponsor website");

// 3. episode
if (!existsSync(path.join(WS, "ep001"))) SC(["new", "ep001", "--script", path.join(ENGINE, "examples/sample/script.md"), "--recording", path.join(media, "narration.wav"), "--episode-label", "Episode 001"]);
SC(["transcribe", "ep001"]);
const rec = SC(["reconcile", "ep001", "--regen-captions"]);
const qs = JSON.parse(readFileSync(path.join(WS, "ep001/work/questions.json"), "utf8")).filter((q) => q.status === "open");
ok(qs.some((q) => q.kind === "unclear" && /wordy/i.test(q.heard)), "low-confidence word that contradicts the script is asked about (not guessed)");
ok(qs.some((q) => (q.kind === "unheard" || q.kind === "missing") && q.start > 43 && q.start < 47), "noise-buried line is detected as unheard speech at the right time");
ok(/Honestly, I still type with two fingers/.test(readFileSync(path.join(WS, "ep001/work/reconcile.md"), "utf8")), "ad-lib detected");
// the test plays the creator: answer each question
for (const q of qs) {
  const answer = q.kind === "unclear" ? "QWERTY" : "and taped it into the logbook.";
  SC(["resolve", "ep001", q.id, answer], { quiet: true });
}
const asRec = readFileSync(path.join(WS, "ep001/script.as-recorded.md"), "utf8");
ok(/taped it into the logbook/.test(asRec) && /QWERTY layout/.test(asRec) && /Honestly, I still type/.test(asRec), "as-recorded script reflects what was actually said");
SC(["captions", "ep001", "replace", "Latham-Scholes", "Latham Sholes"], { quiet: true });
ok(/Latham Sholes/.test(SC(["captions", "ep001", "list", "--from", "22", "--to", "26"], { quiet: true })), "caption correction applied");
void rec;

// 4. music
SC(["music", "ep001", "analyze"]);
SC(["music", "ep001", "auto"]);
const plan = JSON.parse(readFileSync(path.join(WS, "ep001/music.json"), "utf8"));
const ledger = JSON.parse(readFileSync(path.join(WS, "assets/music/library/ledger.json"), "utf8"));
ok(plan.blocks.filter((b) => b.track).every((b) => ["cc0", "pdm"].includes(ledger.tracks[b.track.key].license) && ledger.tracks[b.track.key].licenceCheck.landingConfirms), "every bed is CC0/PDM with the licence confirmed on its source page");

// 5. build + check every style (or just the configured one)
const styles = allStyles ? JSON.parse(readFileSync(path.join(ENGINE, "styles/index.json"), "utf8")).styles.map((s) => s.id) : ["neo-brutalism"];
for (const st of styles) {
  const pj = path.join(WS, "ep001/storycut.project.json");
  const p = JSON.parse(readFileSync(pj, "utf8"));
  p.style = st;
  writeFileSync(pj, JSON.stringify(p, null, 2));
  SC(["build", "ep001"], { quiet: true });
  let out;
  try {
    out = sh("npx", ["-y", "hyperframes@0.9.23", "check", "--json"], path.join(WS, "ep001/build"));
  } catch (e) {
    out = e.stdout;
  }
  const j = JSON.parse(out);
  const errs = Object.values(j).filter((v) => v && v.findings).flatMap((v) => v.findings).filter((f) => f.severity === "error");
  ok(j.ok && !errs.length, `style ${st}: hyperframes check passes${errs.length ? " — " + errs.map((e) => e.code).join(",") : ""}`);
}

// 6. render + qc with the configured style
const pj = path.join(WS, "ep001/storycut.project.json");
const p = JSON.parse(readFileSync(pj, "utf8"));
p.style = null;
writeFileSync(pj, JSON.stringify(p, null, 2));
SC(["build", "ep001"], { quiet: true });
if (!skipRender) {
  SC(["render", "ep001", "--quality", "draft"]);
  let qc;
  try {
    qc = SC(["qc", "ep001"], { quiet: true });
  } catch (e) {
    qc = e.stdout;
  }
  console.log(qc);
  ok(!/❌/.test(qc), "QC has no failures");
}
console.log("e2e passed");
