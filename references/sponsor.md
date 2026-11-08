# Sponsor segment

## Template

Configure it once in `storycut.config.json` → `sponsor`:

- `name`, `url`, `label` (badge text, e.g. "SPONSOR" or "MY PROJECT")
- `disclosure` (small line on the card, e.g. "Made by me · waitlist open")
- `script`: the read, editable any time
- `maxSeconds`: the length budget, checked at 150 wpm and again in QC
- `placement`: `middle` (nearest the halfway point by word count), `before-last` (before the final content segment), `after-hook`
- `facts`: each `{ "claim": …, "evidence": "exact text on the sponsor's page" }`

## Fact check

`SC sponsor check` fetches the sponsor's site and:

- confirms every `facts[].evidence` string appears on the page
- flags hard-claim phrases in the script that aren't on the page or in `facts`: numbers, user counts, "launched", "available now", "free forever", "best", "secure", "#1" and similar
- warns when the script runs longer than `maxSeconds`

It exits non-zero on any failure. Fix the script or the facts. Never add a fact that isn't on the site.

## Putting it in the video

- **Script:** `SC sponsor insert script.md` adds `## Sponsor: <name> {sponsor}` with the script at the configured placement. A `.bak` copy is kept. Writers can also place the section by hand.
- **Visual:** the sponsor segment gets the style's `sponsorFrame` border, a corner badge, and a card with the name, URL and disclosure. Stage headlines are hidden for its duration. It has its own music bed (warm mood by default).
- **QC:** checks that the segment exists, that the sponsor's name is actually heard in it, and that it fits the length budget.

## Writing it (guidance for Claude)

- 20–40 seconds. Bridge into it from the previous segment's topic, and back out with a line that leads into the next one.
- Factual only. Use what the site says, the product's stage (beta, waitlist…), and what it is planned to do. No invented features, users, results or prices.
- If it's the creator's own product, say so. The honesty can be the joke.
- Write a fresh read each episode, and keep past reads in the channel notes so you don't repeat them.
