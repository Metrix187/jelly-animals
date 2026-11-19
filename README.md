# jelly animals

Soft-body jelly animals in three.js, each made by a different model from the same skill.

Every model is handed [`skill/jelly-animals`](skill/jelly-animals) (a `SKILL.md` and the engine it ships with) and asked for an animal. What comes back is filed under the model that made it, so the pages can be compared side by side: same solver, same renderer, same instructions, different hands.

## layout

```
skill/jelly-animals/        the base skill, as every model receives it
  SKILL.md
  kit/                      engine sources, build script, tests, GIF filming
  references/
reference/red-panda/        what the kit builds untouched
models/
  <model>/
    <animal>/
      index.html            the page, as delivered
      entry.json            who made it and how
      preview.gif|png|jpg   optional, for the gallery card
      src/                  optional, the kit sources as the model left them
gallery.mjs                 rebuilds index.html from every entry.json
index.html                  the gallery
```

## so far

| model | animal | effort | skill |
|---|---|---|---|
| (reference) | [red panda](reference/red-panda/) | | 0.1.0 |
| Muse Wonder | [duck](models/muse-wonder/duck/) | high | 0.1.0 |
| Grokbot | [lion](models/grokbot/lion/) | | 0.1.0 |
| Claude Haiku 5.5 | [tree frog](models/claude-haiku-5-5/tree-frog/) | medium | 0.1.0 |
| hy3 | [flamingo](models/hy3/flamingo/) | high | 0.1.0 |

## adding one

1. Give the model the skill folder and ask for an animal. One request, no steering afterwards; if you did steer, say so in `notes`.
2. Have it build with `node build.mjs <animal>-jellies --full`, which writes a whole document that opens from disk.
3. Copy `out/<animal>-jellies.full.html` to `models/<model>/<animal>/index.html`, the model's `src/` next to it, and a screenshot or GIF as `preview.*`.
4. Write `entry.json`:

   ```json
   {
     "animal": "duck",
     "title": "Duck Jellies",
     "model": "Muse Wonder",
     "effort": "high",
     "harness": "OpenCode",
     "date": "2026-11-12",
     "skill": "0.1.0",
     "prompt": null,
     "notes": ""
   }
   ```

   `harness` is what ran the model (Claude Code, OpenCode, a chat app). `prompt` is the request, word for word. Leave a field `null` when it is not known; do not guess.
5. `node gallery.mjs`, add a row to the table above, commit.

Do not fix a model's page by hand. A broken marking or an animal that falls over is part of the result.

## credit

The engine descends from the jelly study each page credits as "No. 058". That line stays on every page.
