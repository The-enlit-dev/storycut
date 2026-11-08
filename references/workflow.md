# Workflow runbook

## 0. Inputs you need from the creator

- The script (markdown, see `scripts.md`). If they only have plain text, add `## Section {type}` headings for them and show them the result.
- The recording: a voice-over (`.wav`/`.mp3`/`.m4a`) or a camera take (`.mp4`/`.mov`). One continuous file.
- For a new channel: channel name, editing style, intro and outro songs (their own files), and sponsor details. Write all of these into `storycut.config.json`.

## 1. Create the episode

```
SC new episodes/003 --script drafts/003.md --recording ~/takes/003.wav --episode-label "Episode 003" [--style neo-brutalism]
```

The original script is copied to `script.original.md` and never modified.

## 2. Transcribe and reconcile

```
SC transcribe episodes/003
SC reconcile episodes/003
```

Read `work/reconcile.md` and summarise it for the creator: ad-libs, changed lines, skipped lines, and spelling differences (the script usually spells names right; offer the `captions replace` fix it prints).

**Questions:** there are three kinds, all listed by `SC questions <ep>`:

| kind | meaning | how to ask |
|---|---|---|
| `unclear` | low-confidence words, or ones that contradict the script | "At 00:20 I heard 'Q-wordy'. The script says 'QWERTY'. Which one did you say?" |
| `missing` | a script line absent from the transcript that a second listen half-heard | "At 00:44 the script has 'and taped it into the logbook'. A second pass heard '…'. Did you say it?" |
| `unheard` | speech-level audio with no words at all | "At 00:44.9 there are 1.7 s of speech I couldn't transcribe. The script expected '…'. What did you say, or was it not speech?" |

Always include the `at` timestamp, and send `work/questions/U#.wav` with SendUserFile when you can. **Wait for the answer.** Don't build in the meantime and don't fill in the script's version. Then run:

```
SC resolve <ep> U1 "QWERTY"          # what they said
SC resolve <ep> U2 --keep            # the transcript/second listen was right
SC resolve <ep> U3 --skip            # missing/unheard: not said / not speech
```

Each answer re-syncs the transcript, captions (manual captions are never touched) and `script.as-recorded.md`.

## 3. Captions

Captions are generated once at reconcile. After that they belong to the creator. See `captions.md`. To let the creator edit them in a browser, run `SC captions <ep> serve --host 0.0.0.0` and give them the URL. In a cloud session, also call `report_preview_port` with the port.

## 4. Music

```
SC music <ep> analyze
```

This prints narration loudness, SNR, speech pace and a mood per block. Then **use your judgement on the content**: read each segment of the script. Is it serious, funny, exciting, educational or dramatic? Override moods that don't fit with `SC music <ep> mood <block> <mood>`. Valid moods are listed in `music.md`. `[TONE]` and `[MUSIC]` tags in the script do this automatically.

```
SC music <ep> auto
SC music <ep> list      # titles, licences, source pages
```

Tell the creator what was chosen, with its licence and source link.

## 5. Build, preview, render

```
SC build <ep>
SC preview <ep>         # optional: HyperFrames Studio (report_preview_port in cloud sessions)
SC render <ep>          # --quality draft for a quick look
```

`build` prints warnings and lists script cues it couldn't render: a `[VISUAL]` with no on-screen text, a `[MEME]` with no image in `assets/memes`, or an `[SFX]` with no file. Report them, don't hide them.

## 6. QC, then deliver

```
SC qc <ep>
```

Fix each ❌ (see `qc.md`), rebuild, re-render and re-run QC. Then deliver:

- `renders/<name>.mp4`
- the captions (`SC captions <ep> export srt`)
- `script.as-recorded.md`
- the music credits from `SC music <ep> list`
- the QC summary
