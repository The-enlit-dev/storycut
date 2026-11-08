// Channel configuration: storycut.config.json, found by walking up from the project dir.
import path from "node:path";
import { existsSync } from "node:fs";
import { readJSON, ENGINE_DIR } from "./util.mjs";

export const CONFIG_NAME = "storycut.config.json";

export const DEFAULTS = {
  channel: { name: "My Channel", series: "", tagline: "", handle: "", language: "en" },
  branding: {
    logo: null, // path to svg/png; optional
    colors: {}, // overrides any style colour token, e.g. {"accent": "#ff0"}
    fonts: {}, // overrides {"display": "Archivo Black", "body": "Space Mono"}
    watermark: true,
  },
  style: "tech-documentary",
  format: { width: 1920, height: 1080, fps: 30 },
  narration: { targetLufs: -16, maxGainDb: 12 },
  intro: {
    enabled: true,
    music: null, // path to your intro song
    volume: 0.9,
    fadeIn: 0,
    fadeOut: 1.0,
    start: 0, // seconds into the song where the intro excerpt begins, or "end"
    maxSeconds: 12, // intro visual is trimmed to this if the song is longer
    seconds: 5, // used only when no music file is set
    topics: ["Technology", "Innovation", "Curiosity", "Business", "Science", "The Future"],
    narrationOverlap: 0.3, // narration starts this many seconds before the intro music ends
  },
  outro: {
    enabled: true,
    music: null,
    volume: 0.9,
    fadeIn: 0.6,
    fadeOut: 2.0,
    start: "end", // "end" = the song's last maxSeconds, so the video ends on the song's real ending
    maxSeconds: 20,
    seconds: 8,
    lines: ["Thanks for watching", "Subscribe for next week"],
  },
  music: {
    beds: true,
    licenses: ["cc0", "pdm"], // only public-domain dedications by default
    allowVocals: false,
    underSpeechDb: -20, // bed loudness relative to narration while someone speaks
    gapLiftDb: 5, // how far the bed rises in pauses longer than gapLiftAfter
    gapLiftAfter: 1.4,
    crossfade: 1.5,
    minBlockSeconds: 40, // never switch beds more often than this
    library: "assets/music/library",
  },
  captions: {
    enabled: true,
    wordsPerGroup: 3,
    maxCharsPerLine: 32,
    maxCharsPerSecond: 20,
    minDuration: 0.6,
    style: {}, // overrides the editing style's caption tokens
  },
  segments: { titleCards: true, cardSeconds: 2.2 },
  sponsor: {
    enabled: false,
    name: "",
    url: "",
    disclosure: "",
    script: "",
    facts: [], // [{ "claim": "…", "evidence": "exact text on the sponsor's page" }]
    cta: "",
    maxSeconds: 45,
    placement: "middle", // middle | before-last | after-hook | manual
    label: "SPONSOR",
  },
  transcription: { engine: "auto", model: "small.en", language: "en", uncertainBelow: 0.5 },
};

function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over) || typeof over !== "object" || over === null) {
    return over === undefined ? base : over;
  }
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = k in base ? deepMerge(base[k], over[k]) : over[k];
  return out;
}

export function findConfig(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    const f = path.join(dir, CONFIG_NAME);
    if (existsSync(f)) return f;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** Load config merged over defaults. Relative paths are resolved against the config's folder. */
export function loadConfig(startDir, { required = false } = {}) {
  const file = findConfig(startDir);
  if (!file) {
    if (required) throw new Error(`no ${CONFIG_NAME} found from ${startDir} upward — run: storycut init`);
    return { ...structuredClone(DEFAULTS), _file: null, _root: path.resolve(startDir) };
  }
  const user = readJSON(file);
  const cfg = deepMerge(structuredClone(DEFAULTS), user);
  cfg._file = file;
  cfg._root = path.dirname(file);
  return cfg;
}

export function resolvePath(cfg, p) {
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.join(cfg._root, p);
}

export function listStyles() {
  return readJSON(path.join(ENGINE_DIR, "styles", "index.json")).styles;
}

export function loadStyle(id, cfg) {
  const file = path.join(ENGINE_DIR, "styles", `${id}.json`);
  if (!existsSync(file)) {
    const ids = listStyles().map((s) => s.id).join(", ");
    throw new Error(`unknown style "${id}". Available: ${ids}`);
  }
  const style = readJSON(file);
  if (cfg) {
    style.colors = { ...style.colors, ...(cfg.branding?.colors || {}) };
    style.fonts = { ...style.fonts, ...(cfg.branding?.fonts || {}) };
    style.captions = { ...style.captions, ...(cfg.captions?.style || {}) };
  }
  return style;
}
