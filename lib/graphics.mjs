// Motion-graphic layers driven by what is actually said (transcript), not invented:
//   - stat cards: spoken numbers ("$350 million", "81 … vulnerabilities", "97%") pop up with a count-up
//   - logo badges: a company/product logo appears the first time it is mentioned in a segment
//   - episode progress bar with chapter ticks
import os from "node:os";
import path from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { ensureDir, escapeHtml, round } from "./util.mjs";

const SIMPLE_ICONS = "https://cdn.jsdelivr.net/npm/simple-icons@13.21.0/icons";

// spoken name → Simple Icons slug (extend per channel with config.graphics.entities)
export const DEFAULT_ENTITIES = {
  openai: "openai", chatgpt: "openai", codex: "openai", apple: "apple", meta: "meta", facebook: "facebook",
  google: "google", gemini: "googlegemini", microsoft: "microsoft", nvidia: "nvidia", amd: "amd", intel: "intel",
  qualcomm: "qualcomm", spacex: "spacex", starlink: "starlink", tesla: "tesla", dropbox: "dropbox",
  perplexity: "perplexity", anthropic: "anthropic", claude: "claude", firefox: "firefoxbrowser", mozilla: "mozilla",
  github: "github", slack: "slack", mazda: "mazda", ethereum: "ethereum", ethglobal: "ethereum", tencent: "tencentqq",
  huggingface: "huggingface", youtube: "youtube", whatsapp: "whatsapp", instagram: "instagram", reddit: "reddit",
  x: null, twitter: "x", netflix: "netflix", amazon: "amazon", aws: "amazonwebservices", samsung: "samsung",
};

async function icon(slug) {
  const dir = ensureDir(path.join(os.homedir(), ".cache", "storycut", "simple-icons"));
  const f = path.join(dir, `${slug}.svg`);
  if (!existsSync(f)) {
    try {
      const r = await fetch(`${SIMPLE_ICONS}/${slug}.svg`);
      if (!r.ok) return null;
      writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    } catch {
      return null;
    }
  }
  return f;
}

const clean = (t) => t.replace(/[“”"()]/g, "").trim();

/** Find spoken numbers with a few words of context. Returns [{t, value, prefix, suffix, label}] in recording time. */
export function findStats(words, { minGap = 14, avoid = [] } = {}) {
  const out = [];
  const UNIT = /^(percent|%|billion|million|thousand|trillion|crore|lakh|times|x|×)[.,!?]?$/i;
  for (let i = 0; i < words.length; i++) {
    const raw = clean(words[i].text);
    const m = raw.match(/^(\$|₹|€|£)?(\d[\d,]*(?:\.\d+)?)(%|x|×|[kKmMbB]|B)?[.,!?]?$/);
    if (!m) continue;
    const num = Number(m[2].replace(/,/g, ""));
    if (!Number.isFinite(num)) continue;
    let suffix = m[3] || "";
    let j = i + 1;
    if (j < words.length && UNIT.test(clean(words[j].text))) {
      suffix = (suffix ? suffix + " " : " ") + clean(words[j].text).replace(/[.,!?]$/, "");
      j++;
    }
    // segment numbers and clock/runtime talk are not statistics
    const prevW = i > 0 ? clean(words[i - 1].text).toLowerCase().replace(/[^a-z]/g, "") : "";
    const nextW = i + 1 < words.length ? clean(words[i + 1].text).toLowerCase().replace(/[^a-z']/g, "") : "";
    if (prevW === "segment" || /^(minutes?|seconds?|o'clock|am|pm)$/.test(nextW)) continue;
    // "10k" / "6B" without a currency sign are usually names (Form 10-K, GPT-6) — not statistics
    if (m[3] && /^[kKmMbB]$/.test(m[3]) && !m[1]) continue;
    const isYear = num >= 1900 && num <= 2100 && !m[1] && !suffix;
    const small = num < 10 && !m[1] && !suffix;
    if (isYear || small) continue;
    const endsSentence = /[.!?]$/.test(raw) || (j > i + 1 && /[.!?]$/.test(clean(words[j - 1].text)));
    const label = endsSentence ? "" : words.slice(j, j + 4).map((w) => clean(w.text)).join(" ").replace(/[.,!?;:]+.*$/, "");
    const t = words[i].start;
    if (out.length && t - out.at(-1).t < minGap) continue;
    if (avoid.some(([a, b]) => t > a - 0.5 && t < b + 0.5)) continue;
    out.push({ t: round(t, 3), value: num, decimals: (m[2].split(".")[1] || "").length, prefix: m[1] || "", suffix: suffix.trim(), label: label.slice(0, 48) });
  }
  return out;
}

/** First mention of each known entity per segment. Returns [{t, slug, name}] in recording time. */
export function findEntities(words, segments, entities, { minGap = 6 } = {}) {
  const out = [];
  for (const s of segments) {
    const seen = new Set();
    for (const w of words) {
      if (w.start < s.start || w.start >= s.end) continue;
      const key = clean(w.text).toLowerCase().replace(/'s$/, "").replace(/[^a-z0-9]/g, "");
      const slug = entities[key];
      if (!slug || seen.has(slug)) continue;
      if (out.length && w.start - out.at(-1).t < minGap) continue;
      seen.add(slug);
      out.push({ t: round(w.start, 3), slug, name: clean(w.text).replace(/[.,!?;:]+$/, "").replace(/'s$/, "") });
    }
  }
  return out;
}

export function graphicsCss(style, W, H) {
  const c = style.colors;
  const s = style.shape;
  const border = s.border ? `${s.border}px solid ${c.ink}` : "none";
  const shadow = s.shadow === "none" ? "none" : `${s.shadowX}px ${s.shadowY}px ${s.shadowBlur}px ${c[s.shadow] || s.shadow}`;
  return `
  .stat { position: absolute; right: 120px; top: 610px; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
  .stat-num { font-family: var(--display); font-weight: var(--display-weight); font-size: 132px; line-height: 1; padding: 14px 34px 22px; background: var(--chip, ${c.accent}); color: var(--chip-ink, ${c.ink}); border: ${border}; box-shadow: ${shadow}; border-radius: ${s.radius}px; }
  .stat-label { font-family: var(--mono); font-size: 30px; letter-spacing: 0.04em; padding: 8px 16px; background: ${c.paper}; color: ${c.ink}; border: ${border}; border-radius: ${s.radius}px; max-width: 760px; text-align: right; }
  .logo { position: absolute; right: 120px; top: 300px; display: flex; align-items: center; gap: 18px; padding: 16px 24px 16px 18px; background: ${c.paper}; border: ${border}; box-shadow: ${shadow}; border-radius: ${s.radius}px; }
  .logo img { width: 84px; height: 84px; display: block; }
  .logo span { font-family: var(--display); font-weight: var(--display-weight); font-size: 44px; color: ${c.ink}; }
  .prog { position: absolute; left: 0; top: 0; width: ${W}px; height: 12px; background: ${c.paper}; border-bottom: ${s.border ? Math.max(2, s.border - 2) : 2}px solid ${c.ink}; }
  .prog-fill { position: absolute; left: 0; top: 0; height: 100%; width: ${W}px; background: ${c.accent}; transform-origin: 0 50%; }
  .prog-tick { position: absolute; top: 0; width: 4px; height: 12px; background: ${c.ink}; }
  `;
}

/** Build the graphics layers (HTML + timeline code), all in VIDEO time. */
export async function graphicsLayers({ style, cfg, W, H, words, vsegs, N, narrEnd, cardWindows, assetCopy }) {
  const els = [];
  const tw = [];
  const report = { stats: 0, logos: 0, progress: false };
  const g = { stats: true, logos: true, progress: true, ...(cfg.graphics || {}) };
  const segsRec = vsegs.map((s) => ({ start: s.vstart - N, end: s.vend - N, chip: s.chip, chipInk: s.chipInk, type: s.type }));
  const avoidRec = cardWindows.map(([a, b]) => [a - N, b - N]);
  const segAt = (t) => segsRec.find((s) => t >= s.start && t < s.end);

  if (g.stats) {
    for (const [k, st] of findStats(words, { avoid: avoidRec }).entries()) {
      const sg = segAt(st.t);
      if (!sg || sg.type === "sponsor") continue;
      const at = round(N + st.t - 0.15, 3);
      const dur = 4.2;
      if (at + dur > (sg.end + N) - 0.1) continue;
      const id = `st${k}`;
      els.push(`<div id="${id}" class="clip full" data-start="${at}" data-duration="${dur}" data-track-index="16" style="z-index:33;--chip:${sg.chip};--chip-ink:${sg.chipInk}"><div class="stat" id="${id}-in"><div class="stat-num"><span>${escapeHtml(st.prefix)}</span><span id="${id}-v">0</span><span>${escapeHtml(st.suffix.startsWith("%") ? st.suffix : st.suffix ? " " + st.suffix : "")}</span></div>${st.label ? `<div class="stat-label">${escapeHtml(st.label)}</div>` : ""}</div></div>`);
      tw.push(`__in(tl, "#${id}-in", ${at}, "pop", 1);`);
      tw.push(`tl.fromTo("#${id}-v", { innerText: 0 }, { innerText: ${st.value}, duration: 0.9, ease: "power2.out", snap: { innerText: ${st.decimals ? 1 / 10 ** st.decimals : 1} } }, ${round(at + 0.1, 3)});`);
      tw.push(`__out(tl, "#${id}-in", ${round(at + dur - 0.25, 3)}, 0.2);`);
      report.stats++;
    }
  }
  if (g.logos) {
    const map = { ...DEFAULT_ENTITIES, ...(g.entities || {}) };
    for (const [k, e] of findEntities(words, segsRec, map).entries()) {
      if (avoidRec.some(([a, b]) => e.t > a - 0.3 && e.t < b + 0.3)) continue;
      const f = await icon(e.slug);
      if (!f) continue;
      const src = assetCopy(f, `logo-${e.slug}.svg`);
      const at = round(N + e.t - 0.1, 3);
      const id = `lg${k}`;
      els.push(`<div id="${id}" class="clip full" data-start="${at}" data-duration="3.2" data-track-index="17" style="z-index:31"><div class="logo" id="${id}-in"><img src="${src}" alt=""><span>${escapeHtml(e.name)}</span></div></div>`);
      tw.push(`__in(tl, "#${id}-in", ${at}, "pop", 1);`);
      tw.push(`__out(tl, "#${id}-in", ${round(at + 2.95, 3)}, 0.2);`);
      report.logos++;
    }
  }
  if (g.progress) {
    const total = narrEnd - N;
    const ticks = vsegs.slice(1).map((s) => `<div class="prog-tick" style="left:${round(((s.vstart - N) / total) * W, 1)}px"></div>`).join("");
    els.push(`<div id="prog" class="clip full" data-start="${N}" data-duration="${round(total, 3)}" data-track-index="18" data-layout-ignore style="z-index:45;pointer-events:none"><div class="prog"><div class="prog-fill" id="prog-fill"></div>${ticks}</div></div>`);
    tw.push(`tl.fromTo("#prog-fill", { scaleX: 0 }, { scaleX: 1, duration: ${round(total, 3)}, ease: "none" }, ${N});`);
    report.progress = true;
  }
  return { els, tw, report };
}
