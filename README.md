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
      preview.gif           the gallery card, filmed by tools/gif.mjs
      reel.json             the staging that GIF was filmed with
      src/                  optional, the kit sources as the model left them
tools/gif.mjs               films an entry's page into its preview.gif
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
3. Copy `out/<animal>-jellies.full.html` to `models/<model>/<animal>/index.html`, and the model's `src/` next to it.
4. Film its card: `node tools/gif.mjs models/<model>/<animal>` (see below).
5. Write `entry.json`:

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
6. `node gallery.mjs`, add a row to the table above, commit.

Do not fix a model's page by hand. A broken marking or an animal that falls over is part of the result.

## the GIFs

Every card is the same nine-second reel, so the animals can be compared like with like: they hop toward the camera, strike their pose, get a treat each, the lights go out, and they cross the table with lit stomachs.

```
cd tools && npm i                         # once; also needs ffmpeg on the PATH
node tools/gif.mjs models/grokbot/lion    # one entry
node tools/gif.mjs --missing              # every entry without a preview.gif
```

Add `--dry` to stop after four key frames (in `tools/.work/`), or `--rehearse` to pick the staging again.

The simulation is chaotic, so a staging that suits one animal tips another over. The tool first runs a few stagings without drawing, a few seconds each, and scores them: is everyone on its feet, in the picture, fed, and side-on once it is dark. It films the best one with the page's clock stood still, encodes it at 720×540 under 5 MB, and writes the staging to the entry's `reel.json`, so the same command films the same reel again. The reel and its beats come from the skill's own `kit/gif/capture.mjs`.

A model's own GIF, when it made one, stays as it is: the tool only films entries you point it at, and `--missing` skips any entry that already has a `preview.gif`.

## credit

The engine descends from the jelly study each page credits as "No. 058". That line stays on every page.
