# Filming a GIF

`gif/capture.mjs` films the built page frame by frame on a clock that stands still, so every frame is exact however slow the software renderer is. Its header has the commands. Copy it and restage it for the new animal; as shipped it films the red pandas' reel. The method:

1. **Stop the clock.** `page.clock.install()` alone does not stop time; `page.clock.pauseAt()` after the page is up does. From then on `page.clock.fastForward(50)` draws exactly one frame. Each frame is `advance(3)` (20 frames a second) and then one draw.
2. **Stage it like a film.** Put the animals where the shot needs them with `sim.place(b, 0.05, [x, z], yaw)` (`state.az - Math.PI / 2` faces the camera); placing is exact where herding is not. Give the reel beats on frame numbers: arrive, strike the pose at the camera, a treat each, lights out, cross the frame side-on with lit stomachs (from in front the dark belly hides the glow).
3. **Rehearse in numbers.** The simulation is chaotic, and any change to the staging changes everything after it. `node gif/capture.mjs log` runs the whole reel in seconds without drawing and prints whether anyone fell over, left the picture or turned its back. Try variations there. Then `dry` draws four key frames to look at, and only then `full`.
4. **Hold the camera still.** A GIF pays for every pixel that changes. The script lets the camera settle on one spot and freezes it; an orbiting camera made the red pandas' reel 40% bigger.
5. **Encode** PNG frames with ffmpeg (`palettegen` with `stats_mode=full`, `paletteuse` with `dither=bayer:bayer_scale=5`), then `gifsicle -O3 --lossy=36`. 720×540 at 20 frames a second for 9 seconds comes to just under 5 MB, which posts anywhere. Raise `--lossy` before shrinking the picture.

Send the GIF to the user as a file.

## Commands

```
node gif/capture.mjs log     # the whole reel without drawing (seconds); prints the staging in numbers
node gif/capture.mjs dry     # the same, drawing four key frames into gif/keys/
node gif/capture.mjs full    # every frame into gif/frames/f_0000.png …
cd gif
ffmpeg -y -framerate 20 -start_number 8 -i frames/f_%04d.png -frames:v 184 -vf "scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -loop 0 raw.gif
npm i gifsicle && npx gifsicle -O3 --lossy=36 raw.gif -o reel.gif
```

`log` ends with one line: the least `up` of any animal over the reel (well under 1 means someone fell over), how far to each side they went (past about ±1.5 at this zoom is out of the picture), and how they face once the lights are out. The red pandas' reel prints least up 0.92 and side −1.41 … 1.33. A third argument overrides the staging as JSON, so variations can be compared without editing the file.

The reel needs the page's clock paused, which needs Playwright 1.45 or later.
