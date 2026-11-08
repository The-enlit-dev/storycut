# Final QC (`SC qc <ep>` → `qc/report.md`, `qc/report.json`)

| Area | Check | How it's measured | If it fails |
|---|---|---|---|
| render | Duration matches the edit | ffprobe vs build plan (±0.6 s) | rebuild + re-render |
| render | Has video and audio | ffprobe streams | check `hyperframes check` output |
| audio | Integrated loudness | EBU R128 of the render (pass at -18…-12 LUFS) | adjust `narration.targetLufs` |
| audio | True peak | ≤ -0.5 dBTP | lower intro/outro `volume` |
| audio | Narration level | normalised narration vs target | very noisy source: re-record or use `medium.en` |
| audio | Speech stays clear over music | mix vs the narration that went into it, in sampled speech windows, both mono-downmixed; music must add ≤ 1.5 dB (warn) / 3 dB (fail) | lower `underSpeechDb` (e.g. -24), or pick a sparser mood |
| audio | Music level in pauses | loudness in pauses > 1.8 s | raise/lower `gapLiftDb` |
| audio | Music changes | number of beds vs duration / `minBlockSeconds` | raise `minBlockSeconds` |
| intro/outro | Intro at start, synced | timing from the plan; intro loudness; beats used | set `intro.music`; check `music beats` |
| intro/outro | Outro after narration, audible | timing + loudness | set `outro.music` |
| captions | Match the recorded speech | word alignment of captions vs transcript (≥ 98% pass) | `captions replace`, or resolve questions |
| captions | Timing | overlaps, < min duration, reading speed, out of range | `captions edit/split/merge`, or the editor |
| captions | Every spoken word captioned | each word's midpoint inside a caption | `captions add` |
| structure | Segments clearly separated | every content segment has a title card | check segment types in the script |
| structure | Transitions not excessive | ≤ 4/min and none within 8 s of each other | merge tiny segments |
| structure | No awkwardly short segments | content segments ≥ 6 s | merge with a neighbour |
| structure | No dead air | narration pauses > 2.5 s | trim the recording, or accept |
| structure | No missing/black picture | ffmpeg blackdetect inside the edit | inspect the build at that time |
| structure | Script cues rendered | cues that need media nobody provided | add the meme/sfx file, or put on-screen text in backticks |
| sponsor | Included, named, within budget | sponsor segment + its name in the transcript + length | `sponsor insert`; re-record |
| script | Final script matches the recording | `script.as-recorded.md` vs transcript | `reconcile` |
| script | No unresolved unclear audio | open questions | ask the creator → `resolve` |

QC also lists build warnings (missing songs, missing sponsor segment, missing music files). A video is ready when there are **no ❌**. Warnings should be read out to the creator, not hidden.
