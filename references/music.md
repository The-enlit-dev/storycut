# Music

## Intro and outro songs (the creator's own)

Set them in `storycut.config.json`:

```json
"intro": { "music": "assets/music/intro/intro.mp3", "start": 0, "maxSeconds": 12, "volume": 0.9, "fadeIn": 0, "fadeOut": 1.0, "narrationOverlap": 0.3 },
"outro": { "music": "assets/music/outro/outro.mp3", "start": "end", "maxSeconds": 20, "volume": 0.9, "fadeIn": 0.6, "fadeOut": 2.0 }
```

- To replace a song, drop in a new file and point `music` at it. Every build picks it up, and the visuals re-sync to the new song's beats automatically.
- The intro plays from 0. Narration starts `narrationOverlap` seconds before it ends. The outro starts after the last spoken word. Both are separate audio tracks from the narration.
- Full-length songs are fine: `start` picks the excerpt (seconds into the song), and `maxSeconds` sets its length. `"start": "end"` uses the song's last `maxSeconds`, so the video ends on the song's real ending (the default for the outro). Beats are detected on the excerpt itself. Excerpts are trimmed with the configured fades. With no file set, a silent intro/outro of `seconds` length is used and QC warns about it.
- Beat sync: `SC music beats <file>` shows the tempo and beat grid used for the tile hits and wordmark slam.

## Background beds: how a track is chosen

1. **Analyse the audio** (`SC music <ep> analyze`). For the whole narration it measures loudness (EBU R128), loudness range, noise floor and SNR, and how much of the time someone is speaking. Per segment it measures words per second and loudness.
2. **Map content to a mood.** Each segment type has a default mood. `[TONE]`/`[MUSIC]` script tags override it, then Claude reviews each segment's actual content and overrides moods that don't fit (`SC music <ep> mood b2 serious`).
3. **Pick the level.** The bed sits `underSpeechDb` (default -20 dB) below the voice. It goes 2 dB lower for fast delivery, 3 dB lower for noisy or quiet recordings, and 2 dB lower where the narration dips.
4. **Plan blocks.** Consecutive segments with the same mood share one track. Blocks shorter than `minBlockSeconds` merge into a neighbour, taking the mood that covers the most time. The sponsor gets its own bed, and `[MUSIC] none` gives silence. So music never switches every few seconds.
5. **Search and verify** (`SC music <ep> auto`):
   - It searches Openverse with `license=cc0,pdm` only and drops anything with vocal or voice terms.
   - It requires at least 40 s, prefers loop-tagged tracks long enough for the block, and avoids tracks used in other episodes.
   - It then **opens the provider's own page and requires the same licence to appear there**. If it doesn't, the track is rejected.
   - If a mood has no verified track, it falls back to related moods, and otherwise leaves the block silent and says so.
6. **Render the bed.** The track is looped with crossfades to the block length, with fades baked in, and placed with a volume automation lane. That lane holds the bed at the under-speech level while anyone talks and lifts it `gapLiftDb` in pauses longer than `gapLiftAfter`. Blocks crossfade over `crossfade` seconds.

Moods: `punchy`, `bright`, `curious`, `confident`, `travel`, `playful`, `wonder`, `warm`, `serious`, `dramatic`.

## Licence evidence (`assets/music/library/`)

`ledger.json` records, for every track: title, creator, the exact licence label, licence URL, source page, provider, SHA-256 of the file, the landing-page check (HTTP status and the licence text it found), and where it has been used. `evidence/<id>.json` keeps the raw Openverse record and the check. `SC music <ep> list` prints the credits.

What we say, and what we never say:

- "CC0 1.0 Universal (public domain dedication), confirmed on freesound.org/… on 2026-11-08" ✅
- "copyright-free", "royalty-free so it's fine", "no Content ID risk" ❌

Content ID can't be checked offline. Public-domain audio can still be claimed by third parties, so after upload check YouTube Studio → Copyright, and keep the ledger as evidence for a dispute.

Your own tracks: `SC music add-local track.mp3 --license own-work --evidence <url or note> --title … --creator …`.

## Narration level

The build writes a loudness-normalised copy of the narration (two-pass EBU R128, target `narration.targetLufs`, true peak ≤ -1.5 dBTP) and mixes that. Your recording is never modified. With camera footage, the video is muted and the normalised audio plays alongside it.

## Brand videos (reusable intro and outro)

`SC brand render` renders the intro and outro once, with their song excerpts, to `assets/brand/intro.mp4` and `assets/brand/outro.mp4`, and records them in `assets/brand/brand.json`. Point `intro.video` and `outro.video` at those files and every build uses them instead of regenerating. Re-run `brand render` after changing the songs, `start`, `maxSeconds`, `hit`, `prompt`, `topics`, `lines` or the style.

- `intro.hit` / `outro.hit`: the song time (in seconds) of the beat the logo lock-up should land on. Leave it unset to use the last strong onset.
- `intro.prompt`: the question typed into the opening browser window.
