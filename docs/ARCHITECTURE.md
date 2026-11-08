# Architecture: public engine, private production

```
github.com/<you>/storycut (PUBLIC)          github.com/<you>/<channel>-studio (PRIVATE)
├── SKILL.md, references/   ← the skill     ├── .claude/skills/storycut   ← git submodule → storycut@<tag/commit>
├── bin/, lib/, editor/     ← the engine    ├── .claude/skills/<channel>/ ← channel-specific skill (research, voice, packaging)
├── styles/                 ← 5 styles      ├── storycut.config.json      ← channel name, style, songs, sponsor
├── examples/               ← templates     ├── assets/music/{intro,outro,library}, assets/brand, sfx, memes
└── test/                                   ├── episodes/NNN/ (scripts, captions, music plans; recordings/renders git-ignored)
                                            └── data/ (story collections, episode history)
```

**Rule:** anything that would help another creator goes in the engine. Anything that names your channel, your sponsor, your songs or your content stays private.

| Belongs in the public engine | Stays private |
|---|---|
| a new segment type, style, caption animation, QC check | your `storycut.config.json` (sponsor, channel, songs) |
| a bug fix in reconcile/build/music | scripts, recordings, renders, episode data |
| generic docs and examples | channel voice, research workflow, packaging rules |
| a new style that isn't tied to your brand | brand assets, fonts you licensed, your own music |

## Promoting a change from private to public

1. Make the change inside the submodule. It's a normal clone of the public repo:
   ```bash
   cd .claude/skills/storycut
   git checkout -b feat/better-ducking
   ```
2. Test it with a private episode, then **check the diff for private details**: channel names, sponsor text, file paths from your repo, emails, keys.
   ```bash
   git diff main --stat
   git grep -n -i -E "<your-channel>|<your-sponsor>|<your-email>|api[_-]?key"
   ```
3. Push the branch to the public repo and open a PR there. After merging:
   ```bash
   git checkout main && git pull
   ```
4. In the private repo, record the new engine version:
   ```bash
   git add .claude/skills/storycut
   git commit -m "storycut → <commit>"
   ```

## Pulling public updates into private

```bash
git submodule update --remote .claude/skills/storycut   # moves to the public main
git add .claude/skills/storycut
git commit -m "Update storycut"
```

## Cloning the private repo (any machine, cloud sessions)

```bash
git clone --recurse-submodules <private repo>      # or, after a plain clone:
git submodule update --init
```

The submodule URL is the public HTTPS URL, so it needs no credentials.

## Never publish private files

- The public repo contains no config files, only `examples/storycut.config.example.json`.
- The private repo's `.gitignore` excludes recordings, renders and build output.
- Before every push to the public repo, run the `git grep` above. Check the repo's visibility on GitHub before the first push.
