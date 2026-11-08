# Editing styles

`SC styles` lists them. Set the channel default with `"style"` in `storycut.config.json`, or set it per episode with `SC new … --style <id>` (or `"style"` in `storycut.project.json`). Rebuilding applies the change; nothing else needs to be redone.

| id | Look |
|---|---|
| `neo-brutalism` | paper ground with a dot grid, 6 px ink borders, hard 12 px offset shadows, flat yellow/pink/cyan/lime blocks, Archivo Black + Space Mono, slam-in type, block-band wipes, tilted stacked title cards, boxed uppercase captions with a highlighted word |
| `tech-documentary` | dark slate with a fine grid, Inter + JetBrains Mono, mask-up reveals, line-sweep transitions, rule-and-kicker cards, data-label lower thirds, clean captions with an accent word |
| `minimal-editorial` | warm off-white, Playfair Display headlines, hairline rules, slow fade-rise, crossfades, magazine dek lower thirds, small sentence-case captions |
| `memphis-pop` | retro neo-brutalism: grid paper, Memphis shapes (squiggles, zigzags, triangles, rings, confetti speckle, checkers, sparkles) re-arranged per segment, keycap tiles with extruded shadows, browser-window title cards, outlined + extruded white headlines, pink/teal/yellow/purple/blue, Outfit 900 + Space Mono |
| `social-fast` | black with neon green/pink/yellow, Montserrat 900, pop + back-ease, zoom-punch flashes, 2-word stroked captions in the centre-low band, emoji bursts |
| `cinematic-documentary` | letterboxed, animated film grain, League Gothic + Lato, slow fades, dip-to-black, centred titles, understated captions |

## What a style controls (`styles/<id>.json`)

| Block | Tokens |
|---|---|
| `fonts` | `display`, `body`, `mono` (HyperFrames' bundled families resolve offline) |
| `colors` | `bg`, `ink`, `paper`, `muted`, `accent`…`accent4`, `caveat` |
| `shape` | radius, border width, shadow offset/blur/colour |
| `decor` | optional shape layer: `{ "kind": "memphis", "density": 5, "size": 130, "stroke": 5 }`; shapes sit in the margins, a new arrangement per segment, popping in then drifting |
| `type` | `extrude` (px of stacked ink shadow), `outline` (px stroke), `fill` (colour token) for headlines and card titles |
| `background` / `texture` / `letterbox` | dots, grid, plain or vignette ground; grain or paper texture; letterbox bar height |
| `motion` | entrance preset (`slam`, `mask-up`, `fade-rise`, `pop`, `slow-fade`), ease, duration, stagger |
| `transition` | `block-wipe`, `line-sweep`, `crossfade`, `zoom-punch`, `dip-to-black` |
| `titleCard` | layout (`stacked-blocks`, `rule-kicker`, `editorial`, `punch`, `cinematic`, `window`), numbering, case, tilt |
| `lowerThird` | layout (`tag`, `data-label`, `dek`, `pill`, `caption-line`) |
| `captions` | every caption style key (see `captions.md`) |
| `emoji` | size, animation (`stamp`, `float`, `burst`, `fade`, `pop`) |
| `sponsorFrame` | `tape`, `outline`, `rule`, `glow-free-badge`, and its colour |
| `segmentColors` | the accent token for each segment type, so each section has its own colour |

Brand overrides that don't need a new style: `branding.colors` and `branding.fonts` in config.

## Making a new style

Copy the closest `styles/*.json`, change the tokens, add it to `styles/index.json`, then build an episode and check snapshots (`npx hyperframes snapshot --at …` in `build/`). Good styles come from one strong idea: a material, a print tradition, a broadcast era. Avoid the generic AI look: no neon gradients on black for no reason, no glowing circuit boards, no stock "futuristic city" backdrops, no random blur blobs.
