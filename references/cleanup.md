# Voiceover cleanup (`SC clean <ep>`)

The original recording is never modified. The project keeps `original.file` and its SHA-256, and cleanup refuses to run if the original has changed. The working copy goes to `recording/cleaned/<name>_clean.wav`, and the project's `recording` points at it.

## What it does

| Step | How | Default |
|---|---|---|
| Long pauses | Gaps longer than `maxNaturalPause` (0.9 s) are shortened to 0.35 s (mid-sentence), 0.6 s (between sentences) or 0.95 s (between sections). Cuts are made only inside stretches the waveform shows are quiet. Gaps with speech-level sound are left uncut and listed | applied |
| Editor directions | "cut", "cut again", "let's start from…", "that's for editing"… | applied |
| Abandoned takes | Unfinished or off-script fragments within 3 s before a direction | applied |
| False starts | A short fragment the next sentence restarts | applied when obvious, otherwise flagged |
| Repeated takes | Sentences repeated within 90 s. The better take is kept, by script completeness, then confidence, then fewer fillers | applied when certain, otherwise **flagged and kept** |
| Intentional repeats | Lines the script itself repeats are never cut | kept |
| Chatter | Segment numbers, runtime talk, notes to self | **flagged and kept** |
| Risky remarks | Insults or allegations about real people | **flagged and kept**: check before publishing |
| Commentary | Other off-script ad-libs | kept and listed |
| Coughs, sneezes, throat clears | `SC clean <ep> noises` re-hears the original in 20 s windows with whisper (medium.en), prompted to label non-speech sounds, then cuts the word gap holding each one. Kinds in `clean.cutNoises` are cut; sniffs are flagged; laughs are never cut. Slow (about 1× real time on 4 CPUs), so it is a separate command, and its results are cached in `work/clean/noises.json` | applied (restorable) |
| Your own cuts | `SC clean <ep> cut <from> <to> --reason "…"` removes a stretch of the ORIGINAL recording: words and sound | applied |

Processing is decided from measurements made in the silent stretches:

- **Hum notch:** only if 50/60 Hz is above -62 dBFS.
- **Spectral denoise:** only if the noise floor is above -62 dBFS, and gentle (10 dB).
- **Hiss shelf:** only if hiss is above -66 dBFS.
- **Always, and gentle:** high-pass at 75 Hz, -1.5 dB at 250 Hz, +1.5 dB at 3.2 kHz, light de-essing, 2.2:1 compression, then two-pass EBU R128 loudness normalisation at -1.5 dBTP.

Cuts use 12 ms fades, so there are no clicks.

## Reviewing

- `edit-log.md` covers every change, the processing chain with its reasons, the decisions waiting for you, and the pauses left uncut. Each entry has its original and cleaned-voiceover timestamps.
- `SC clean <ep> preview E012` writes `work/clean/previews/E012-before.mp3` and `-after.mp3`.
- `SC clean <ep> approve E012` cuts a flagged item. `reject` keeps it. `restore` undoes an applied edit. Each of these re-renders the working copy.
- `SC clean <ep> cut 35:07.7 35:29.8 --reason "sneeze joke"` adds a cut. Times are in the original recording (the edit log's "original time"). `SC clean <ep> cuts` lists them, and `SC clean <ep> uncut 2` removes #2. Cuts are stored in `work/clean/manual-cuts.json` and survive re-runs.
- A pause that holds sound is never cut blindly, so a sneeze or cough stays until `noises` hears it or you `cut` it.
- After any change, re-run `transcribe` (or rely on the remapped transcript), then `reconcile`, `build` and `render`.
