// Decorative shape layer for styles that want one (style.decor). Memphis-style geometry placed in the
// frame margins, re-arranged per segment so each section has its own composition. Deterministic (seeded).
const COLORS = ["accent", "accent2", "accent3", "accent4", "accent5"];

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function shapeSvg(kind, size, fill, ink, stroke) {
  const sw = stroke;
  const h = size;
  switch (kind) {
    case "triangle":
      return `<svg width="${h}" height="${h}" viewBox="0 0 100 100"><polygon points="50,6 96,92 4,92" fill="${fill}" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round"/></svg>`;
    case "ring":
      return `<svg width="${h}" height="${h}" viewBox="0 0 100 100"><circle cx="50" cy="50" r="34" fill="none" stroke="${ink}" stroke-width="${22 + sw}"/><circle cx="50" cy="50" r="34" fill="none" stroke="${fill}" stroke-width="22"/></svg>`;
    case "dot":
      return `<svg width="${h}" height="${h}" viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="${fill}" stroke="${ink}" stroke-width="${sw}"/></svg>`;
    case "squiggle":
      return `<svg width="${h * 1.6}" height="${h * 0.7}" viewBox="0 0 160 70"><path d="M8 35 C 28 0, 48 0, 58 35 S 88 70, 108 35 S 138 0, 152 35" fill="none" stroke="${ink}" stroke-width="${16 + sw}" stroke-linecap="round"/><path d="M8 35 C 28 0, 48 0, 58 35 S 88 70, 108 35 S 138 0, 152 35" fill="none" stroke="${fill}" stroke-width="16" stroke-linecap="round"/></svg>`;
    case "zigzag":
      return `<svg width="${h * 1.6}" height="${h * 0.6}" viewBox="0 0 160 60"><polyline points="6,48 34,12 62,48 90,12 118,48 152,12" fill="none" stroke="${ink}" stroke-width="${14 + sw}" stroke-linejoin="round" stroke-linecap="round"/><polyline points="6,48 34,12 62,48 90,12 118,48 152,12" fill="none" stroke="${fill}" stroke-width="14" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
    case "sparkle":
      return `<svg width="${h}" height="${h}" viewBox="0 0 100 100"><path d="M50 4 C 54 38, 62 46, 96 50 C 62 54, 54 62, 50 96 C 46 62, 38 54, 4 50 C 38 46, 46 38, 50 4 Z" fill="${fill}" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round"/></svg>`;
    case "half":
      return `<svg width="${h}" height="${h * 0.55}" viewBox="0 0 100 55"><path d="M4 51 A 46 46 0 0 1 96 51 Z" fill="${fill}" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round"/></svg>`;
    case "confetti": {
      // terrazzo speckle patch
      const r = rng(Math.round(h * 7));
      let marks = "";
      for (let i = 0; i < 26; i++) {
        const x = 8 + r() * 84;
        const y = 8 + r() * 84;
        const a = Math.round(r() * 180);
        marks += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="9" height="3.2" rx="1.6" fill="${ink}" transform="rotate(${a} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
      }
      return `<svg width="${h}" height="${h}" viewBox="0 0 100 100"><rect x="3" y="3" width="94" height="94" rx="6" fill="${fill}" stroke="${ink}" stroke-width="${sw}"/>${marks}</svg>`;
    }
    case "checker": {
      let cells = "";
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2 === 0) cells += `<rect x="${4 + x * 23}" y="${4 + y * 23}" width="23" height="23" fill="${ink}"/>`;
      return `<svg width="${h}" height="${h}" viewBox="0 0 100 100"><rect x="4" y="4" width="92" height="92" fill="#fff" stroke="${ink}" stroke-width="${sw}"/>${cells}</svg>`;
    }
    default:
      return "";
  }
}

const KINDS = ["triangle", "ring", "squiggle", "zigzag", "sparkle", "dot", "half", "confetti", "checker", "sparkle"];

/**
 * Margin slots (as fractions of the frame). The middle band (where headlines, cards and captions live)
 * stays clear; shapes sit in corners and edges and may bleed off-frame like the references.
 */
const SLOTS = [
  [0.86, 0.06], [0.93, 0.3], [0.8, 0.82], [0.95, 0.62], [0.02, 0.86], [0.66, 0.9], [0.72, 0.04], [0.97, 0.9],
];

/** Build decor HTML for one window of time. Returns {html, tweens} (tweens as timeline code strings). */
export function decorLayer({ style, W, H, id, seed, start, duration, count, z = 2 }) {
  const d = style.decor;
  if (!d || d.kind === "none") return { html: "", tweens: [] };
  const r = rng(seed * 97 + 13);
  const n = Math.min(count ?? d.density ?? 5, SLOTS.length);
  const slots = [...SLOTS].sort(() => r() - 0.5).slice(0, n);
  const ink = style.colors.ink;
  const sw = d.stroke ?? 5;
  const palette = COLORS.filter((c) => style.colors[c]);
  const els = [];
  const tweens = [];
  slots.forEach(([fx, fy], i) => {
    const kind = KINDS[Math.floor(r() * KINDS.length)];
    const size = Math.round((d.size ?? 130) * (0.7 + r() * 0.6));
    const fill = style.colors[palette[Math.floor(r() * palette.length)]];
    const rot = Math.round(r() * 50 - 25);
    const x = Math.round(fx * W - size / 2);
    const y = Math.round(fy * H - size / 2);
    const eid = `${id}-d${i}`;
    els.push(`<div class="decor" id="${eid}" style="left:${x}px;top:${y}px">${shapeSvg(kind, size, fill, ink, sw)}</div>`);
    const t0 = start + 0.08 + i * 0.07;
    tweens.push(`tl.fromTo("#${eid}", { opacity: 0, scale: 0.3, rotation: ${rot - 40} }, { opacity: 1, scale: 1, rotation: ${rot}, duration: 0.42, ease: "back.out(2.4)" }, ${t0.toFixed(3)});`);
    // slow drift for the rest of the window (finite, seekable)
    const drift = Math.max(0.5, duration - 0.6);
    tweens.push(`tl.to("#${eid}", { y: ${Math.round(r() * 30 - 15)}, rotation: ${rot + Math.round(r() * 24 - 12)}, duration: ${drift.toFixed(3)}, ease: "sine.inOut" }, ${(t0 + 0.45).toFixed(3)});`);
  });
  const html = `<div id="${id}" class="clip full" data-start="${start}" data-duration="${duration}" data-track-index="2" data-layout-ignore style="z-index:${z};pointer-events:none">${els.join("")}</div>`;
  return { html, tweens };
}

export function decorCss() {
  return `.decor { position: absolute; } .decor svg { display: block; overflow: visible; }`;
}
