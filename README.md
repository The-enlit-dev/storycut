# storycut

**Script-driven video editing for creators, built on [HyperFrames](https://github.com/heygen-com/hyperframes).**
You bring a script and your recording. storycut transcribes what you *actually* said, asks about anything it couldn't hear, and produces a finished, styled video:

- segmented structure with title cards
- editable captions
- your intro/outro songs with matching branded visuals
- mood-matched public-domain background music, ducked under your voice
- a fact-checked sponsor segment
- a QC report

It's a Claude Code skill (`SKILL.md`) and a plain Node CLI, so you can use it with Claude or by hand. Everything is local and free: whisper.cpp for transcription, FFmpeg, HyperFrames for rendering, Openverse for CC0 music. There are no accounts and no API keys.

`skill`, `claude-code`, `video-editing`, `hyperframes`, `captions`, `subtitles`, `youtube`, `content-creation`, `podcast`, `voiceover`, `ffmpeg`, `whisper`, `cc0-music`

## Install

Requirements: **Node.js ≥ 22**, **FFmpeg**, and Chrome/Chromium (HyperFrames uses it to render). On first use, HyperFrames downloads whisper.cpp and a speech model (~500 MB).

As a Claude Code skill, for all your projects:

```bash
git clone https://github.com/The-enlit-dev/storycut ~/.claude/skills/storycut
```

…or for one project only:

```bash
git clone https://github.com/The-enlit-dev/storycut .claude/skills/storycut
```

…or as a git submodule of your own production repo (recommended: pin a version, update deliberately):

```bash
git submodule add https://github.com/The-enlit-dev/storycut .claude/skills/storycut
```

Then check everything is in place:

```bash
node ~/.claude/skills/storycut/bin/storycut.mjs doctor
```

Optional alias:

```bash
alias storycut="node ~/.claude/skills/storycut/bin/storycut.mjs"
```

## Configure (once per channel)

```bash
storycut init --channel "My Channel" --style neo-brutalism
```

This writes `storycut.config.json` plus `assets/music/{intro,outro,library}`, `assets/sfx`, `assets/memes` and `assets/brand`. Then:

1. Put your intro and outro songs in `assets/music/intro/` and `assets/music/outro/`, and set `intro.music` and `outro.music`.
2. Set `channel.series` and `channel.tagline`, and `intro.topics` (the words on the intro tiles).
3. Optional sponsor: fill in `sponsor` (name, url, script, facts with evidence), then run `storycut sponsor check`.

All the fields are in [`references/config.md`](references/config.md).

## Make an episode

```bash
storycut new episodes/001 --script script.md --recording take.wav --episode-label "Episode 001"
storycut transcribe episodes/001
storycut reconcile episodes/001          # → work/reconcile.md, script.as-recorded.md, questions
storycut resolve episodes/001 U1 "what I said"     # for each unclear passage
storycut music episodes/001 analyze && storycut music episodes/001 auto
storycut build episodes/001
storycut render episodes/001
storycut qc episodes/001                 # → qc/report.md
```

With Claude: "edit episode 001". The skill runs this loop and stops to ask you about unclear audio.

Try it on the bundled sample script: `examples/sample/script.md`.

## Status

### Implemented and tested end-to-end (sample in `test/`)

| Feature | Notes |
|---|---|
| Config + 6 editing styles | `neo-brutalism`, `memphis-pop`, `tech-documentary`, `minimal-editorial`, `social-fast`, `cinematic-documentary`; all build and pass `hyperframes check` on the sample |
| Transcription with confidence | whisper.cpp with DTW token timing; imports `.json`/`.srt`/`.vtt` |
| Recording ↔ script reconciliation | ad-libs, changed and omitted lines, spelling differences; `script.as-recorded.md` (original kept) |
| Ask, don't guess | 3 detectors: low-confidence/conflicting words, a second listen for "missing" lines, speech-level audio with no words. Each gives a timestamp + audio clip; `resolve` re-syncs everything |
| Caption management | CLI add/edit/delete/retime/shift/split/merge/replace/style/validate/export; browser editor with live styled preview; edits survive rebuilds; corrections flow into transcript + script |
| Segmentation | 12 segment types, transitions + numbered title cards + per-segment colour, stage headlines from sub-stories |
| Intro/outro templates | generated from config + style on each build, synced to the detected beats of your songs, separate audio tracks with fades; full-length songs supported via `start`/`maxSeconds` excerpts (`"end"` = the song's real ending) |
| Background music | content/audio analysis → mood blocks; CC0/PDM-only search with the licence confirmed on the provider page; ledger + evidence; loop/crossfade beds; speech ducking via volume automation |
| Narration loudness | two-pass EBU R128 normalisation with a true-peak limit (original untouched) |
| Sponsor | config template, website fact check, script insertion at a placement, distinct frame/badge/card, QC presence/length |
| Final QC | the checks listed in [`references/qc.md`](references/qc.md) |

### Implemented, not yet tested with real material

- **Camera footage (talking head) as the recording.** The code path exists (muted video + normalised audio, lower thirds instead of stage headlines), but only voice-over has been rendered so far.
- **Non-English narration.** Set `transcription.model` to a multilingual model and `transcription.language`.

### Not implemented / planned

- B-roll and stock footage: `[VISUAL]` descriptions are listed as "needs media". Only backticked on-screen text is rendered.
- Thumbnails, and short-form (9:16) cut-downs from the long edit.
- Automatic Content ID checks (not possible offline; see `references/music.md`).
- Humour is a writing guide Claude applies (`references/scripts.md`). The engine doesn't score jokes.
- Logo image in the intro/outro (`branding.logo` is reserved; the wordmark is typographic).

## How it works

```
script.md ─┐                        ┌─ script.as-recorded.md
recording ─┼─ transcribe → reconcile┼─ segments.json ──┐
           │      (questions ↔ you) └─ captions.json ──┤ (editable)
config ────┤                                            ├─ build → build/ (HyperFrames project) → render → renders/*.mp4 → qc
styles ────┤  music analyze → music.json (+ ledger) ────┘
songs ─────┘
```

`build/` is a normal HyperFrames project: `npx hyperframes preview` opens it in Studio. Rebuilding regenerates it from the inputs above, so make lasting changes in the inputs (captions.json, config, script), not in `build/`.

## Using it from a private production repo

Keep your channel's config, songs, scripts and recordings in a **private** repo, and pull storycut in as a submodule at `.claude/skills/storycut`. Generic improvements go back upstream through a pull request to this repo. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Licence

MIT. HyperFrames, whisper.cpp, FFmpeg and the music you download each have their own licences. The music ledger records each track's.
