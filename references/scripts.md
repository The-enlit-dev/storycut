# Script format, segments and humour

## Format

```markdown
# Show Name #003 — Episode title         ← the part after "—" is shown on the stage during the hook/intro/outro

> notes in blockquotes and anything before the first "##" are never treated as narration

## Cold open {hook}
Narration paragraphs…
[EMOJI] 🤖 on "agents", 💸 on "350 million"
[SFX] record scratch on "GIFs"

## AI agents need a permission slip {ai}
### Apple's 10-K                           ← sub-story → stage headline (voice-over) / lower third (camera)
Narration…
[CAVEAT] COMPANY CLAIM                     ← small label after the title card
[VISUAL] `81 FIREFOX BUGS`                 ← only `backticked` text is rendered; other descriptions are listed as needing media
[LOWER] Apple Form 10-K, filed Nov 3       ← lower third
[MEME] this-is-fine on "everything's fine" — AI agents   ← image from assets/memes (fuzzy file-name match) + caption
[TONE] serious                             ← music mood override for this segment
[MUSIC] none | keep | <mood>

## Sponsor: Acme App {sponsor}
## Outro {outro}
```

A cue anchored with `on "phrase"` fires when that phrase is **actually spoken**, found in the transcript. Without an anchor it fires at its position in the script.

## Segment types

Pick the sections that fit the week. Never force all of them.

| type | use for | title card |
|---|---|---|
| `hook` | cold open, the 3 best lines | no |
| `intro` | "welcome to…" | no |
| `main-tech` | main technology news | yes |
| `ai` | AI developments | yes |
| `business` | business, startups, deals | yes |
| `events` | tech events around the world (happened) | yes |
| `upcoming-events` | events coming up | yes |
| `fun-facts` | fun facts | yes |
| `discoveries` | interesting discoveries, research, science, space | yes |
| `quick-updates` | rapid-fire short items | yes |
| `sponsor` | sponsor read (distinct frame, own music bed) | sponsor card |
| `outro` | closing | no |

The type is inferred from the heading when `{type}` is missing (`SC segments` lists them). Each carded segment gets a transition, a numbered title card, its own accent colour, and its own stage headline.

## Humour craft (a writing guide Claude applies; nothing in the engine enforces it)

The target is an entertaining science and technology documentary, not a newsreader.

- **Density:** a laugh roughly every 2–3 spoken lines, placed where it falls naturally. Not on a fixed beat, not every sentence, and never in the middle of an explanation the viewer needs. Let the fact land first, then the joke.
- **Variety:** rotate devices and never use the same one twice in a row:
  - sarcastic aside
  - relatable observation
  - absurd but accurate comparison
  - fake dialogue (the company, the AI, the intern)
  - rule of three with a twist
  - escalation that is clearly framed as a joke
  - deadpan understatement after a big number
  - self-aware jab at the show or the host
- **Specific beats generic.** If a joke could be pasted into another story unchanged, rewrite it.
- **Punchline last:** the funny word goes at the end of the sentence. Keep it under 2 sentences.
- **Callbacks:** plant one in the cold open, pay it off mid-episode and again in the outro. Keep one running gag across episodes, and record it in the channel's notes.
- **Transitions are jokes too:** bridge segments with a line that links the last story to the next ("Speaking of things nobody asked for…").
- **Facts stay exact.** Exaggerate the reaction, never the news. Serious stories (people harmed, layoffs) stay serious; aim the joke at the company or the situation.
- **Banned filler:**
  - "let's dive in"
  - "buckle up"
  - "game-changer"
  - "in today's fast-paced world"
  - "without further ado"
  - "it's worth noting"

Punch-up pass, for each segment:

1. Count the laugh lines. Too few → add one at a natural pause.
2. Kill any joke that interrupts a needed explanation.
3. Replace repeated structures.
4. Check every joke against the facts.
