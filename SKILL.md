---
name: storycut
description: Script-driven video editing for creators. Turns a written script plus the creator's own recording into a finished, styled video using HyperFrames. It transcribes what was actually said (ad-libs included), asks about unclear audio instead of guessing, builds editable captions, structures the video into titled segments, adds reusable branded intro/outro synced to the creator's own songs, picks licence-verified CC0/public-domain background music by mood and ducks it under speech, inserts a fact-checked sponsor segment, renders, and runs final QC. Seven switchable editing styles (neo-memphis, neo-brutalism, Memphis pop, tech documentary, minimal editorial, fast social, cinematic). Use for "edit my video", "edit this recording", "add captions", "fix the captions", "add background music", "make the intro/outro", "change the editing style", "render the episode", "QC the video".
---

# storycut

An editing engine you drive from the command line. Everything it does is a file you can inspect and change; the HyperFrames project it generates can also be edited in HyperFrames Studio.

`SC` below means `node <this skill's folder>/bin/storycut.mjs`. Run `SC help` for every command.

## Before anything

1. `SC doctor`. You need Node ≥ 22 and FFmpeg. HyperFrames is fetched with `npx` and pinned to the tested version. Transcription runs locally with whisper.cpp, which HyperFrames installs on first use (free, no account).
2. Find the creator's `storycut.config.json` by walking up from the working folder. If there is none, run `SC init --channel "<name>" --style <id>` and fill it in with them (see `references/config.md`). Never invent sponsor facts, channel names or music files.
3. Read `references/workflow.md` before the first edit in a session. It is the runbook, and it says when to stop and ask.

## The loop (details in `references/workflow.md`)

```
SC new <ep> --script script.md --recording take.wav --episode-label "Episode 003"
SC transcribe <ep>            # word timings + confidence (whisper.cpp with DTW alignment)
SC reconcile <ep>             # first pass: segments on the raw take
SC clean <ep>                 # voiceover cleanup on a working copy → edit-log.md (see references/cleanup.md)
SC clean <ep> noises          # optional, slow: find + cut coughs/sneezes; `clean <ep> cut <from> <to>` for your own cuts
SC transcribe <ep> --model medium.en   # re-transcribe the cleaned voiceover for accurate captions
SC reconcile <ep>             # recording vs script → work/reconcile.md, script.as-recorded.md, segments.json, captions.json
  ↳ open questions?  ASK THE CREATOR. Show the timestamp and send the clip in work/questions/U#.wav.
    SC resolve <ep> U1 "what they said"   |  --keep (it was right)  |  --skip (a missing line really wasn't said)
SC music <ep> analyze         # narration level/clarity/pace + mood per segment → music blocks
  ↳ read the script and override moods that don't fit the content: SC music <ep> mood b2 serious
SC music <ep> auto            # CC0/PD only, licence confirmed on the source page, evidence saved
SC build <ep>                 # refuses while questions are open
SC render <ep>                # runs `hyperframes check` first
SC qc <ep>                    # qc/report.md — fix every ❌ before calling it done
```

## Rules

- **Never guess what the creator said.** Uncertain words, lines the transcript missed, and speech-level audio with no words all become questions. Ask them with the timestamp and clip, then `resolve`. The final video, captions and `script.as-recorded.md` must match the recording, not the script.
- **Captions are their own document** (`captions.json`). Edit them with `SC captions …` or the browser editor (`SC captions <ep> serve`). Don't regenerate over manual edits (it refuses without `--force`). A text fix applied with `captions replace` also corrects the transcript and the as-recorded script.
- **Music licensing:** only tracks whose licence is CC0 or the Public Domain Mark *and* is confirmed on the provider's own page get used. Never describe a track as "copyright-free" because it is royalty-free. Report the licence exactly as the ledger records it, with its evidence. Content ID cannot be checked offline: tell the creator to check YouTube Studio → Copyright after upload.
- **Sponsor:** only facts that `SC sponsor check` confirms on the sponsor's website. Disclose it if the sponsor is the creator's own product.
- Don't call something done until `SC qc` shows no ❌, and report its warnings honestly.

## References

| Need | Read |
|---|---|
| Step-by-step runbook, when to ask | `references/workflow.md` |
| Config fields, intro/outro songs, branding | `references/config.md` |
| Script format, segment types, humour craft | `references/scripts.md` |
| Caption editing (CLI + browser) and styling | `references/captions.md` |
| Editing styles and making a new one | `references/styles.md` |
| Music selection, licence evidence, ducking | `references/music.md` |
| Sponsor template and fact check | `references/sponsor.md` |
| QC checks and what to do about each | `references/qc.md` |
| Voiceover cleanup, edit log, approvals | `references/cleanup.md` |
| Vertical shorts from the episode (`SC shorts`) | `references/shorts.md` |
| Reusable intro/outro videos | `references/music.md` → Brand videos |
| What is implemented vs planned | `README.md` → Status |
