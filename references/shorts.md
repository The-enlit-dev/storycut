# Vertical shorts (`SC shorts <ep>`)

Rebuilds 1080×1920 shorts from the edited project. It's not a crop of the long video: each short is laid out again for a phone, using only the creator's own words.

## 1. Pick the clips: `<ep>/shorts.json`

```json
{ "fullEpisode": "My Show #002",
  "shorts": [{
    "id": "short-01",
    "hook": "OpenAI's AI found 81 bugs in Firefox 💀",
    "headline": "GPT-6 Cyber vs Firefox",
    "title": "OpenAI's New AI Found 81 Firefox Bugs",
    "parts": [[300.0, 312.1], [338.2, 354.4]],
    "emoji": [{ "on": "Firefox", "e": "🦊" }],
    "fixes": { "10k.": "10-K." },
    "description": "…", "source": "https://…", "hashtags": ["#shorts", "#technews"]
  }] }
```

- `parts` are **original-recording** seconds, so they survive later voiceover cleanups. Several parts become jump cuts. Convert times from the cleaned voiceover or transcript with `SC shorts <ep> times 346.4 360.4 …`. Each part snaps to word boundaries.
- Aim for 20–55 s of speech (the build refuses anything over 60 s). Each short needs a self-contained story, a hook in the first second and a payoff before the end. Every pronoun must have its antecedent inside the clip.
- Avoid passages with open `questions` (unclear words). A short shouldn't show a misheard word. `fixes` is only for spelling differences of the same spoken word (`10k` → `10-K`), never for changing what was said.
- `emoji`: shown when the first word starting with `on` is spoken. Plan 5–8 per short.

## 2. Build and render

```
SC shorts <ep> build [short-01 …]     # → <ep>/shorts-build/<id>/ (HyperFrames project)
SC shorts <ep> render [short-01 …]    # build + check + render → <ep>/renders/<id>.mp4
```

## Layout (inside the vertical safe band: y 168–1330, clear of the right-hand action rail)

| Time | What |
|---|---|
| Frame 0 | The **hook** chip, already visible (never opens on black or a logo) |
| After the hook (≤3 s) | Kicker (the full episode's name) plus the **headline** card at the top |
| Throughout | A "pop stage" above the captions, showing one visual at a time: emoji beats, spoken numbers with a count-up, company logos (the same detection as the long video) |
| Throughout | **3-word captions**, large, upper-case, word-by-word highlight |
| Last 2.2 s | End card: channel plus "FULL EPISODE" plus the episode name |

Audio: the voice is jump-cut with 12 ms fades and normalised to -14 LUFS. The long video's music bed for that moment plays about 4 dB louder than in the long video and is still ducked under speech. Style decor comes from the project's style.
