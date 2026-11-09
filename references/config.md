# Configuration (`storycut.config.json`)

`SC init [dir] --channel "Name" --style <id>` writes a starter file (from `examples/storycut.config.example.json`) and the asset folders. Every project below that folder uses it, because the CLI walks up from the project to find it. Paths in it are relative to the config file.

| Section | What to set |
|---|---|
| `channel` | `name` (wordmark, watermark), `series` (stage kicker, outro), `tagline` (typed in the intro, signed off in the outro), `handle`, `language` |
| `branding` | `colors` / `fonts` overrides on top of the style, `watermark` (channel name in a corner during narration), `logo` (reserved) |
| `style` | default editing style id |
| `format` | `width`, `height`, `fps` (1920×1080 @ 30 is tested) |
| `narration` | `targetLufs` (-16 default) |
| `intro` / `outro` | `enabled` (`false` = no intro / outro at all: the video starts on the first spoken word and ends on the last), `music` path, `video` (a pre-rendered brand video), `volume`, `fadeIn`, `fadeOut`, `maxSeconds`, fallback `seconds`; intro `topics` (the tiles) and `narrationOverlap`; outro `lines` |
| `music` | `licenses` (keep `["cc0","pdm"]` for monetised reuse), `allowVocals`, `underSpeechDb`, `gapLiftDb`, `gapLiftAfter`, `crossfade`, `minBlockSeconds`, `library` folder |
| `captions` | `wordsPerGroup`, `maxCharsPerLine`, `maxCharsPerSecond`, `minDuration`, channel-wide `style` overrides |
| `segments` | `titleCards`, `cardSeconds` |
| `sponsor` | `enabled`, `name`, `url`, `label`, `disclosure`, `placement` (`middle` / `before-last` / `after-hook`), `maxSeconds`, `script`, `facts` [{claim, evidence}], `cta` |
| `clean` | voiceover-cleanup overrides: `maxNaturalPause`, `pauseWithinSentence`, `pauseBetweenSentences`, `pauseBetweenSections`, `cutNoises` (noise kinds `clean noises` cuts: `cough`, `sneeze`, `throat`, `sniff`) |
| `transcription` | `model` (`small.en` default; `medium.en` for noisy rooms), `language`, `uncertainBelow` |

Per-episode settings live in `<episode>/storycut.project.json`: `style`, `episodeLabel` (stamped in the intro), `nextLabel` (an extra outro card).

Secrets: storycut needs none. If you add tooling that does, keep keys in environment variables, never in this file. A public repo of yours should commit `storycut.config.example.json` and keep the real config private.
