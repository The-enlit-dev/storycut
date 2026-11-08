// Sponsor segment: facts are checked against the sponsor's own website before they are spoken.
import { parseScript } from "./script.mjs";

const RISKY = /\b(\d[\d,.]*\s*(%|percent|users|customers|downloads|x|×)|launched|available now|out now|free forever|guarantee[ds]?|best|#1|number one|million|thousands|award|certified|secure|privacy)\b/gi;

export function pageText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|’/g, "'")
    .replace(/&quot;|“|”/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const norm = (s) => s.toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();

export async function checkSponsor(cfg) {
  const sp = cfg.sponsor;
  const out = { url: sp.url, fetchedAt: new Date().toISOString(), status: null, facts: [], scriptFlags: [], ok: true };
  if (!sp.url) {
    out.ok = false;
    out.error = "sponsor.url is not set";
    return out;
  }
  let text = "";
  try {
    const r = await fetch(sp.url, { headers: { "User-Agent": "storycut/1.0" }, redirect: "follow" });
    out.status = r.status;
    text = pageText(await r.text());
  } catch (e) {
    out.ok = false;
    out.error = String(e.message || e);
    return out;
  }
  const page = norm(text);
  for (const f of sp.facts || []) {
    const found = f.evidence ? page.includes(norm(f.evidence)) : false;
    out.facts.push({ claim: f.claim, evidence: f.evidence, found });
    if (!found) out.ok = false;
  }
  // anything in the script that sounds like a hard claim must appear on the page or in a fact
  const script = sp.script || "";
  const supported = norm([text, ...(sp.facts || []).map((f) => f.claim)].join(" "));
  for (const m of script.matchAll(RISKY)) {
    const phrase = m[0];
    if (!supported.includes(norm(phrase))) out.scriptFlags.push({ phrase, why: "not found on the sponsor page or in sponsor.facts — remove or add evidence" });
  }
  if (out.scriptFlags.length) out.ok = false;
  out.words = script.split(/\s+/).filter(Boolean).length;
  out.estSeconds = Math.round((out.words / 150) * 60);
  if (sp.maxSeconds && out.estSeconds > sp.maxSeconds) {
    out.ok = false;
    out.tooLong = `script is ~${out.estSeconds}s at 150 wpm (max ${sp.maxSeconds}s)`;
  }
  return out;
}

/** Insert the sponsor section into a script at the configured placement. Returns new markdown. */
export function insertSponsor(md, cfg) {
  const sp = cfg.sponsor;
  if (!sp.script?.trim()) throw new Error("sponsor.script is empty — write it in storycut.config.json first");
  if (/\{sponsor\}|^##\s.*sponsor/im.test(md)) throw new Error("script already has a sponsor section");
  const doc = parseScript(md);
  const lines = md.replace(/\r/g, "").split("\n");
  const headIdx = lines.map((l, i) => (/^##\s/.test(l) ? i : -1)).filter((i) => i >= 0);
  if (headIdx.length < 2) throw new Error("script needs at least two ## sections to place a sponsor between them");
  const placement = sp.placement || "middle";
  let insertBefore; // index into doc.segments
  const firstMovable = doc.segments.findIndex((s) => !["hook", "intro"].includes(s.type));
  const outroIdx = doc.segments.findIndex((s) => s.type === "outro");
  const lastContent = outroIdx > 0 ? outroIdx : doc.segments.length;
  if (placement === "after-hook") insertBefore = Math.max(1, firstMovable);
  else if (placement === "before-last") insertBefore = Math.max(firstMovable + 1, lastContent - 1);
  else {
    const total = doc.words.length;
    let best = firstMovable + 1;
    let bestD = Infinity;
    for (let i = Math.max(1, firstMovable + 1); i < lastContent; i++) {
      const d = Math.abs(doc.segments[i].wordStart / total - 0.5);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    insertBefore = best;
  }
  const block = [
    `## Sponsor: ${sp.name} {sponsor}`,
    "",
    ...sp.script.trim().split(/\n+/).flatMap((p) => [p, ""]),
    sp.url ? `[VISUAL] \`${sp.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}\`` : "",
    "",
    "---",
    "",
  ].filter((l, i, a) => !(l === "" && a[i - 1] === ""));
  const at = headIdx[insertBefore] ?? lines.length;
  lines.splice(at, 0, ...block);
  return lines.join("\n");
}
