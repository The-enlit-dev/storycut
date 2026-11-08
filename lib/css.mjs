// Turns a style's tokens into CSS for every generated component.
import { decorCss } from "./decor.mjs";
const col = (style, v) => (v && style.colors[v]) || v;

export function shadowCss(style) {
  const s = style.shape;
  if (!s || s.shadow === "none") return "none";
  return `${s.shadowX}px ${s.shadowY}px ${s.shadowBlur}px ${col(style, s.shadow)}`;
}

function backgroundCss(style) {
  const b = style.background;
  const ink = style.colors.ink;
  const op = b.opacity;
  const rgba = hexA(ink, op);
  switch (b.kind) {
    case "dots":
      return `background-color: var(--bg); background-image: radial-gradient(${rgba} 2.2px, transparent 2.6px); background-size: ${b.size}px ${b.size}px;`;
    case "grid":
      return `background-color: var(--bg); background-image: linear-gradient(${rgba} 1px, transparent 1px), linear-gradient(90deg, ${rgba} 1px, transparent 1px); background-size: ${b.size}px ${b.size}px;`;
    case "vignette":
      return `background: radial-gradient(ellipse at 50% 45%, ${hexA(style.colors.paper, 1)} 0%, var(--bg) 70%);`;
    default:
      return `background: var(--bg);`;
  }
}

/** Black or white text, whichever reads better on `hex`. */
export function onColor(hex) {
  const h = String(hex).replace("#", "");
  if (h.length !== 6) return "#111111";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.36 ? "#111111" : "#FFFFFF";
}

export function hexA(hex, a) {
  const h = String(hex).replace("#", "");
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const NOISE_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`,
  );

export function captionCss(style, cap) {
  const c = { ...style.captions, ...cap };
  const font = style.fonts[c.font] || c.font || style.fonts.body;
  const shadow =
    c.shadow === "hard" ? `${Math.max(4, style.shape.shadowX / 2)}px ${Math.max(4, style.shape.shadowY / 2)}px 0 ${style.colors.ink}` :
    c.shadow === "soft" ? `0 4px 24px ${hexA("#000000", 0.55)}` : "none";
  const textShadow = c.shadow === "stroke" ? `-4px -4px 0 #000, 4px -4px 0 #000, -4px 4px 0 #000, 4px 4px 0 #000, 0 6px 0 #000` : c.shadow === "soft" && c.box === "none" ? `0 3px 18px ${hexA("#000000", 0.7)}` : "none";
  const pos = c.position === "top" ? `top: ${c.offset}px;` : c.position === "center" ? `top: 50%; margin-top: -60px;` : c.position === "center-low" ? `bottom: ${c.offset}px;` : `bottom: ${c.offset}px;`;
  const boxBg = c.box && c.box !== "none" ? col(style, c.box) : "transparent";
  const activeBg = c.activeBg && c.activeBg !== "none" ? col(style, c.activeBg) : "transparent";
  return `
  .cap-group { position: absolute; left: 0; right: 0; ${pos} display: flex; justify-content: center; text-align: center; pointer-events: none; }
  .cap-line { display: inline-block; max-width: ${c.maxWidth || 1500}px; padding: ${boxBg === "transparent" ? "0" : "10px 22px 14px"};
    background: ${boxBg}; ${c.boxBorder ? `border: ${style.shape.border}px solid var(--ink);` : ""} box-shadow: ${boxBg === "transparent" ? "none" : shadow};
    border-radius: ${style.shape.radius}px; font-family: '${font}'; font-size: ${c.size}px; line-height: 1.12; font-weight: ${c.weight || 900};
    letter-spacing: ${c.letterSpacing ?? (c.case === "upper" ? "0.01em" : "-0.01em")}; color: ${col(style, c.color)};
    text-transform: ${c.case === "upper" ? "uppercase" : "none"}; text-shadow: ${textShadow}; }
  .cap-w { display: inline-block; padding: 0 0.08em; margin: 0 0.02em; border-radius: ${Math.min(6, style.shape.radius)}px; }
  .cap-w.on { color: ${col(style, c.activeColor)}; background: ${activeBg}; }
  `;
}

/** Outlined + extruded display text (style.type.extrude / outline / fill). */
export function extrudeCss(style) {
  const t = style.type || {};
  if (!t.extrude && !t.outline) return "";
  const ink = style.colors.ink;
  const steps = Array.from({ length: t.extrude || 0 }, (_, i) => `${i + 1}px ${i + 1}px 0 ${ink}`).join(", ");
  return `.xt { color: ${col(style, t.fill || "paper")}; -webkit-text-stroke: ${t.outline || 0}px ${ink}; paint-order: stroke fill; text-shadow: ${steps || "none"}; }`;
}

export function baseCss(style, cfg) {
  const s = style.shape;
  const c = style.colors;
  const W = cfg.format.width;
  const H = cfg.format.height;
  const disp = style.fonts.display;
  const body = style.fonts.body;
  const mono = style.fonts.mono;
  const border = s.border ? `${s.border}px solid var(--ink)` : "none";
  const shadow = shadowCss(style);
  const lb = Math.round(H * (style.letterbox || 0));
  return `
  :root { ${Object.entries(c).map(([k, v]) => `--${k}: ${v};`).join(" ")}
    --display: '${disp}'; --body: '${body}'; --mono: '${mono}'; --display-weight: ${style.fonts.displayWeight || 400}; --chip-ink: ${onColor(c.accent)}; --radius: ${s.radius}px; --border: ${border}; --shadow: ${shadow}; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: var(--bg); }
  #root { position: relative; width: 100%; height: 100%; font-family: var(--body); color: var(--ink); }
  .full { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; }
  .ground { ${backgroundCss(style)} }
  .grain { background-image: url("${NOISE_SVG}"); background-size: 240px 240px; opacity: ${style.texture?.kind === "grain" ? style.texture.opacity ?? 0.07 : style.texture?.kind === "paper" ? 0.05 : 0}; mix-blend-mode: overlay; }
  .letterbox-bar { position: absolute; left: 0; width: ${W}px; height: ${lb}px; background: #000; }
  .narr-video { object-fit: cover; }

  /* stage: what the viewer sees behind the voice when there is no camera footage */
  .stage-kicker { position: absolute; left: 120px; top: ${110 + lb}px; font-family: var(--mono); font-size: 28px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
  .stage-kicker b { color: var(--chip-ink); background: var(--chip, var(--accent)); padding: 4px 12px; margin-right: 14px; ${s.border ? `border: ${Math.max(2, s.border / 2)}px solid var(--ink);` : ""} border-radius: var(--radius); }
  .stage-headline { font-weight: var(--display-weight); position: absolute; left: 120px; right: 120px; top: ${270 + lb}px; font-family: var(--display); font-size: 128px; line-height: 0.98; letter-spacing: -0.02em; color: var(--ink); }
  .stage-headline .hl-in { display: inline-block; }
  .stage-headline.upper { text-transform: uppercase; }
  .stage-block { display: inline-block; padding: 18px 30px 22px; background: var(--paper); border: var(--border); box-shadow: var(--shadow); border-radius: var(--radius); }
  .stage-rule { position: absolute; left: 120px; top: ${220 + lb}px; width: 160px; height: 6px; background: var(--chip, var(--accent)); }

  /* section title card */
  .card { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .card-ground { position: absolute; inset: 0; ${backgroundCss(style)} }
  .card-inner { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 22px; max-width: 1500px; }
  .card-num { font-family: var(--mono); font-size: 30px; letter-spacing: 0.2em; color: var(--muted); }
  .card-kicker { font-family: var(--mono); font-size: 34px; letter-spacing: 0.18em; text-transform: uppercase; padding: 8px 18px; background: var(--chip, var(--accent)); color: var(--chip-ink); border: var(--border); border-radius: var(--radius); }
  .card-title { font-weight: var(--display-weight); font-family: var(--display); font-size: 132px; line-height: 0.95; letter-spacing: -0.02em; color: var(--ink); }
  .card-title.upper { text-transform: uppercase; }
  .layout-stacked-blocks .card-title { background: var(--paper); padding: 26px 40px 34px; border: var(--border); box-shadow: var(--shadow); }
  .layout-rule-kicker .card-kicker { background: transparent; color: var(--chip, var(--accent)); padding: 0; border: 0; }
  .layout-rule-kicker .card-title::before { content: ""; display: block; width: 120px; height: 4px; background: var(--chip, var(--accent)); margin-bottom: 34px; }
  .layout-editorial .card-inner { align-items: center; text-align: center; }
  .layout-editorial .card-kicker { background: transparent; border: 0; color: var(--chip, var(--accent)); font-size: 30px; }
  .layout-editorial .card-title { font-style: italic; font-weight: 700; font-size: 120px; }
  .layout-punch .card-title { font-weight: 900; font-size: 168px; color: var(--chip, var(--accent)); text-shadow: 0 10px 0 #000; }
  .layout-punch .card-kicker { border-radius: 999px; }
  .layout-cinematic .card-inner { align-items: center; text-align: center; gap: 16px; }
  .layout-cinematic .card-kicker { background: transparent; border: 0; color: var(--chip, var(--accent)); font-size: 30px; letter-spacing: 0.5em; }
  .layout-cinematic .card-title { font-size: 170px; letter-spacing: 0.04em; }

  /* window-chrome card (browser window with traffic dots) */
  .layout-window .card-inner { gap: 0; background: var(--paper); border: var(--border); box-shadow: var(--shadow); border-radius: var(--radius); overflow: hidden; min-width: 980px; }
  .win-bar { display: flex; gap: 14px; align-items: center; width: 100%; height: 64px; padding: 0 24px; background: var(--paper); border-bottom: var(--border); }
  .win-bar i { display: block; width: 22px; height: 22px; border-radius: 50%; border: 3px solid var(--ink); }
  .win-bar i:nth-child(1) { background: var(--accent2); } .win-bar i:nth-child(2) { background: var(--accent); } .win-bar i:nth-child(3) { background: var(--accent3); }
  .win-body { display: flex; flex-direction: column; gap: 18px; align-items: flex-start; width: 100%; padding: 40px 56px 54px; background: var(--chip, var(--accent)); }
  .layout-window .card-title { font-size: 132px; }
  .layout-window .card-kicker { background: var(--paper); color: var(--ink); }
  ${decorCss()}
  ${extrudeCss(style)}

  /* transitions */
  .tr-band { position: absolute; left: 0; width: ${W}px; background: var(--chip, var(--accent)); ${s.border ? `border-top: ${s.border}px solid var(--ink); border-bottom: ${s.border}px solid var(--ink);` : ""} }
  .tr-line { position: absolute; top: 0; width: 6px; height: ${H}px; background: var(--chip, var(--accent)); }
  .tr-black { background: #000; }
  .tr-flash { background: var(--chip, var(--accent)); }

  /* lower third */
  .lt { position: absolute; left: 110px; bottom: ${250 + lb}px; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
  .lt-kicker { font-family: var(--mono); font-size: 28px; letter-spacing: 0.16em; text-transform: uppercase; padding: 6px 14px; background: var(--chip, var(--accent)); color: var(--chip-ink); border: var(--border); border-radius: var(--radius); }
  .lt-title { font-weight: var(--display-weight); font-family: var(--display); font-size: 54px; line-height: 1.05; padding: 12px 24px 16px; background: var(--paper); color: var(--ink); border: var(--border); box-shadow: var(--shadow); border-radius: var(--radius); max-width: 1300px; }
  .lt-data-label .lt-kicker { background: transparent; border: 0; padding: 0; color: var(--chip, var(--accent)); }
  .lt-data-label .lt-title { background: ${hexA(c.paper, 0.86)}; border: 0; border-left: 4px solid var(--chip, var(--accent)); }
  .lt-dek .lt-kicker { background: transparent; border: 0; padding: 0; color: var(--chip, var(--accent)); }
  .lt-dek .lt-title { background: transparent; box-shadow: none; border: 0; border-top: 1px solid var(--ink); padding: 14px 0 0; font-style: italic; }
  .lt-pill .lt-title, .lt-pill .lt-kicker { border-radius: 999px; }
  .lt-caption-line .lt-kicker { background: transparent; border: 0; color: var(--chip, var(--accent)); letter-spacing: 0.4em; }
  .lt-caption-line .lt-title { background: transparent; box-shadow: none; border: 0; padding: 0; text-transform: uppercase; letter-spacing: 0.06em; }

  /* caveat label, text card, emoji, meme */
  .caveat { position: absolute; right: 110px; top: ${110 + lb}px; font-family: var(--mono); font-size: 28px; letter-spacing: 0.12em; text-transform: uppercase; padding: 8px 14px; background: var(--caveat); color: #111; border: ${s.border ? `${Math.max(2, s.border / 2)}px solid #111` : "0"}; border-radius: var(--radius); }
  .textcard { position: absolute; left: 0; right: 0; top: ${600 + lb}px; display: flex; justify-content: center; }
  .textcard-in { font-weight: var(--display-weight); font-family: var(--display); font-size: 92px; line-height: 1; padding: 22px 40px 30px; background: var(--chip, var(--accent)); color: var(--chip-ink); border: var(--border); box-shadow: var(--shadow); border-radius: var(--radius); text-align: center; max-width: 1500px; }
  .emoji { position: absolute; width: ${style.emoji.size}px; height: ${style.emoji.size}px; }
  .emoji img { width: 100%; height: 100%; display: block; }
  .meme { position: absolute; right: 120px; top: ${210 + lb}px; width: 640px; background: var(--paper); border: var(--border); box-shadow: var(--shadow); border-radius: var(--radius); padding: 14px; }
  .meme img { width: 100%; display: block; }
  .meme-cap { font-family: var(--display); font-size: 34px; padding: 12px 6px 4px; color: var(--ink); }

  /* sponsor */
  .sp-frame { position: absolute; inset: 0; pointer-events: none; }
  .sp-frame.tape { border: 18px solid var(--sp); }
  .sp-frame.outline { border: 3px solid var(--sp); margin: 24px; border-radius: 10px; width: ${W - 48}px; height: ${H - 48}px; }
  .sp-frame.rule::before, .sp-frame.rule::after { content: ""; position: absolute; left: 120px; right: 120px; height: 2px; background: var(--sp); }
  .sp-frame.rule::before { top: ${60 + lb}px; } .sp-frame.rule::after { bottom: ${60 + lb}px; }
  .sp-frame.glow-free-badge { border: 10px solid var(--sp); border-radius: 28px; margin: 18px; width: ${W - 36}px; height: ${H - 36}px; }
  .sp-badge { position: absolute; left: 110px; top: ${100 + lb}px; display: flex; align-items: center; gap: 18px; }
  .sp-label { font-family: var(--mono); font-size: 30px; letter-spacing: 0.2em; padding: 8px 16px; background: var(--sp); color: #111; border: var(--border); border-radius: var(--radius); }
  .sp-card { position: absolute; left: 0; right: 0; top: ${300 + lb}px; display: flex; flex-direction: column; align-items: center; gap: 26px; }
  .sp-name { font-weight: var(--display-weight); font-family: var(--display); font-size: 150px; line-height: 1; padding: 20px 44px 30px; background: var(--paper); color: var(--ink); border: var(--border); box-shadow: var(--shadow); border-radius: var(--radius); }
  .sp-url { font-family: var(--mono); font-size: 46px; padding: 12px 26px; background: var(--sp); color: #111; border: var(--border); border-radius: var(--radius); }
  .sp-note { font-family: var(--mono); font-size: 28px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
  .bug { position: absolute; right: 70px; bottom: ${48 + lb}px; font-family: var(--mono); font-size: 28px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); opacity: 0.85; }
  `;
}
