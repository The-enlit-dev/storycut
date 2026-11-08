# Captions

`captions.json` is generated **once** from the transcript at `reconcile`. From then on it is independent of both the script and the transcript, and `build` always renders exactly what is in it.

```json
{ "version": 1, "style": { "position": "top" },
  "captions": [ { "id": "c0001", "start": 0.2, "end": 1.44, "text": "Your keyboard layout",
                  "words": [{ "text": "Your", "start": 0.2, "end": 0.42 }, …], "source": "auto|edited|manual" } ] }
```

Times are **recording time**, so the intro length doesn't matter; build adds the offset. `source` records how each caption came to be. `manual` captions are never touched by automatic re-syncs.

## CLI

| Task | Command |
|---|---|
| View all | `SC captions <ep> list [--from 1:20 --to 2:00]` |
| Create | `SC captions <ep> add 12.4 14.0 "text"` |
| Edit text | `SC captions <ep> edit c0042 --text "fixed text"` (same word count keeps word timings) |
| Change timing/duration | `SC captions <ep> edit c0042 --start 12.40 --end 14.10` |
| Delete | `SC captions <ep> delete c0042` |
| Nudge a range | `SC captions <ep> shift -0.15 --from 1:00 --to 2:30` |
| Split / merge | `SC captions <ep> split c0042 2` · `SC captions <ep> merge c0042 c0043` |
| Fix a transcription mistake everywhere | `SC captions <ep> replace "Q-wordy" "QWERTY"` (also fixes the transcript and the as-recorded script; `--no-transcript` to skip) |
| Style | `SC captions <ep> style size=72 position=top animation=fade activeBg=accent2` · `--reset` |
| Check | `SC captions <ep> validate` (overlaps, too-short cues, reading speed, out-of-range) |
| Export | `SC captions <ep> export srt\|vtt` (timed to the final video; `--recording` for recording time) |
| See it rendered | `SC build <ep>`, then `SC captions <ep> preview 1:23.4` (a real frame from HyperFrames) |
| Start over | `SC captions <ep> regenerate --force` |

## Browser editor

`SC captions <ep> serve [--port 4747] [--host 0.0.0.0]` gives you:

- the recording with a live caption overlay in the episode's style
- a timeline strip of every caption
- the transcript around the playhead, with low-confidence words underlined
- an editable list: start, end and text for each caption, plus play, split, merge-with-next and delete buttons
- add at playhead, find/replace, undo, and a style panel

Keyboard: Space play, `[`/`]` set the selected caption's start/end to the playhead, Del delete, ↑/↓ select, Ctrl/Cmd+S save. Each save keeps the previous file in `work/captions-history/`.

The browser preview is an approximation (browser fonts). The exact look comes from `build` + `captions preview`.

## Style keys

| Key | Values |
|---|---|
| `font` | `display` / `body` / `mono` (the style's fonts) or a bundled family name |
| `size`, `weight` | numbers |
| `case` | `none` / `upper` |
| `color`, `activeColor`, `activeBg`, `box` | a style colour token (`ink`, `accent`, `accent2`…), `none`, or `#hex` |
| `boxBorder` | `true` / `false` |
| `shadow` | `none` / `soft` / `hard` / `stroke` |
| `position` | `bottom` / `center-low` / `center` / `top` |
| `offset` | pixels from the edge |
| `animation` | `pop` / `fade` / `highlight` / `karaoke` / `none` |
| `maxWidth`, `letterSpacing` | width in pixels; spacing as CSS |

Style precedence: editing style → `captions.style` in config (channel default) → `captions.json` `style` (this video only).
