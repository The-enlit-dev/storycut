// Render the reusable intro/outro once to video files (with their music) that every episode reuses.
import path from "node:path";
import { existsSync, rmSync } from "node:fs";
import { loadConfig, loadStyle, resolvePath } from "./config.mjs";
import { introComposition, outroComposition, brandProjectHtml } from "./brand.mjs";
import { detectBeats } from "./music.mjs";
import { ensureDir, writeText, writeJSON, readJSON, copyInto, probe, run, round, sha256 } from "./util.mjs";

const HF = "hyperframes@0.9.23";

function excerpt(file, conf) {
  const len = probe(file).duration;
  const dur = Math.min(len, conf.maxSeconds);
  const start = conf.start === "end" ? Math.max(0, len - dur) : Math.min(Math.max(0, Number(conf.start) || 0), Math.max(0, len - 1));
  return { start: round(start, 3), dur: round(Math.min(dur, len - start), 3) };
}

export function renderBrand(startDir, { only, quality } = {}) {
  const cfg = loadConfig(startDir, { required: true });
  const style = loadStyle(cfg.style, cfg);
  const W = cfg.format.width;
  const H = cfg.format.height;
  const manifestFile = path.join(cfg._root, "assets", "brand", "brand.json");
  const manifest = readJSON(manifestFile, { version: 1 });
  const results = [];
  for (const id of ["intro", "outro"]) {
    if (only && only !== id) continue;
    const conf = cfg[id];
    const music = resolvePath(cfg, conf.music);
    const hasMusic = music && existsSync(music);
    const ex = hasMusic ? excerpt(music, conf) : { start: 0, dur: conf.seconds };
    const beatInfo = hasMusic ? detectBeats(music, { start: ex.start, maxSeconds: ex.dur }) : { beats: [], onsets: [] };
    const dir = path.join(cfg._root, ".storycut", "brand-build", id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    ensureDir(path.join(dir, "compositions"));
    ensureDir(path.join(dir, "assets"));
    const comp = id === "intro"
      ? introComposition({ style, cfg, duration: ex.dur, beatInfo, episodeLabel: "", hitAt: conf.hit != null ? conf.hit - ex.start : null })
      : outroComposition({ style, cfg, duration: ex.dur, beatInfo, nextLabel: "", hitAt: conf.hit != null ? conf.hit - ex.start : null });
    writeText(path.join(dir, "compositions", `${id}.html`), comp);
    const src = hasMusic ? `assets/${path.basename(copyInto(music, path.join(dir, "assets"), `${id}${path.extname(music)}`))}` : null;
    writeText(path.join(dir, "index.html"), brandProjectHtml({ id, duration: ex.dur, W, H, music: src, musicStart: ex.start, volume: conf.volume, fadeIn: conf.fadeIn, fadeOut: conf.fadeOut }));
    writeJSON(path.join(dir, "hyperframes.json"), { paths: { blocks: "compositions", components: "compositions/components", assets: "assets" }, media: { autoProxy: true } });
    writeJSON(path.join(dir, "package.json"), { name: `brand-${id}`, private: true, type: "module" });
    const chk = run("npx", ["-y", HF, "check", "--json"], { cwd: dir, allowFail: true, timeout: 900000 });
    let ok = chk.status === 0;
    try {
      ok = JSON.parse(chk.stdout).ok;
    } catch {
      /* keep status */
    }
    if (!ok) throw new Error(`${id}: hyperframes check failed — see ${dir}`);
    const out = resolvePath(cfg, conf.video || `assets/brand/${id}.mp4`);
    ensureDir(path.dirname(out));
    const args = ["-y", HF, "render", "--output", out];
    if (quality) args.push("--quality", quality);
    run("npx", args, { cwd: dir, timeout: 3600000 });
    const info = probe(out);
    manifest[id] = {
      file: path.relative(cfg._root, out),
      duration: round(info.duration, 3),
      style: style.id,
      music: hasMusic ? path.relative(cfg._root, music) : null,
      musicSha256: hasMusic ? sha256(music) : null,
      excerpt: ex,
      bpm: beatInfo.bpm ?? null,
      hit: conf.hit != null ? round(conf.hit - ex.start, 3) : "auto",
      renderedAt: new Date().toISOString(),
    };
    results.push({ id, out, duration: info.duration, bpm: beatInfo.bpm });
  }
  writeJSON(manifestFile, manifest);
  return results;
}
