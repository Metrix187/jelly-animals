// Films the built page for a GIF, one frame at a time, with the page's clock stood still so every frame is exact:
// each frame is three simulation steps (20 frames a second), then the clock is moved on once so the page draws once.
//   node gif/capture.mjs log    runs the whole reel without drawing (seconds), and prints the staging in numbers
//   node gif/capture.mjs dry    the same, drawing only the key frames → gif/keys/
//   node gif/capture.mjs full   every frame → gif/frames/f_0000.png …
// then, from gif/:
//   ffmpeg -y -framerate 20 -start_number 8 -i frames/f_%04d.png -frames:v 184 -vf "scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -loop 0 raw.gif
//   npx gifsicle -O3 --lossy=36 raw.gif -o reel.gif        (npm i gifsicle; raise --lossy until it is under 5 MB)
// The staging below is the red pandas' reel: hop toward the camera, stand up at it, a berry each, lights out and
// across the table glowing. Restage it for another animal; the simulation is chaotic, so check every change with
// `log` (it takes seconds) before drawing anything. A third argument overrides STAGE as JSON.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from '../test/browser.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const MODE = process.argv[2] || 'log';
const STAGE = { lane: [0.3, 0.72, 1.0], go: [1.3, 1.2, 0.3], ...JSON.parse(process.argv[3] || '{}') };
const W = 720, H = 540, TOTAL = 196, LIGHTS = 140, KEYS = MODE === 'dry' ? [0, 68, 110, 195] : [];
const dir = path.join(here, MODE === 'full' ? 'frames' : 'keys');
if (MODE !== 'log') { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); }

const { browser, page, fallback } = await openPage({ width: W, height: H, clock: true });
if (fallback) { console.log('FALLBACK:', fallback); await browser.close(); process.exit(1); }
// the stage alone, with the name in the corner
await page.addStyleTag({ content: `
  .status, .panel, .readouts, .notes, .masthead .kicker, .masthead .caption { display: none !important; }
  body { display: block !important; overflow: hidden !important; padding: 0 !important; }
  .stage { position: fixed !important; inset: 0 !important; height: auto !important; border: 0 !important; }
  canvas { transition: none !important; opacity: 1 !important; }
  .masthead { position: fixed !important; top: 4.4vh; left: 4.2vw; padding: 0 !important; z-index: 2; }
  .masthead h1 { font-size: 7.6vh !important; margin: 0 !important; }
` });

await page.evaluate(() => {
  const p = window.__jelly, T = p.troupe, L = p.drops.list, sim = p.sim;
  p.state.paused = true;                      // the page stops stepping the simulation itself; advance() does it
  T.arena = 1.25;
  Object.assign(p.state, { zoom: 1.12, el: 0.38, az: 0.62 });
  // "depth" is toward the camera and "side" across it, as the camera stands
  const az = 0.66, d = [Math.sin(az), Math.cos(az)], side = [Math.cos(az), -Math.sin(az)];
  const at = (sg, dp) => [side[0] * sg + d[0] * dp, side[1] * sg + d[1] * dp];
  // put down at the back of the table, facing the camera (placing them beats herding them: it is exact)
  const start = [[0.02, -0.92, 0.06], [1.08, -0.72, -0.12], [-1.0, -0.6, 0.14]];
  T.reset();
  start.forEach(([sg, dp, turn], b) => sim.place(b, 0.05, at(sg, dp), az - Math.PI / 2 + turn));
  // a first helping already inside, so the stomachs are lit from the start
  T.list.forEach((P, b) => P.slots.slice(0, [4, 4, 3][b]).forEach((S, k) => { S.t = 1; S.grow = 1; S.age = 2 * k; S.life = 70; }));
  p.advance(45);
  // they set off toward the camera side by side; the goal is far enough that nobody arrives and wanders off
  T.list.forEach((P, b) => { P.goal = at(start[b][0] * 1.08, 1.5); P.mode = 'walk'; P.berry = -1; P.walkT = 0; P.wait = 0; P.cad = 0.5 + 0.2 * sim.bodies[b].scale + 0.05 * b; });
  p.advance(24);
  window.__hold = () => T.list.forEach(P => { if (P.mode === 'idle' && P.rawrT < 0) P.wait = 9; });
  // one treat each, a little way in front of its nose
  window.__serve = () => T.list.forEach((P, b) => {
    const B = sim.bodies[b], s = B.scale, i = L.findIndex(A => A.hidden); if (i < 0) return;
    p.drops.release(i, [B.c[0] + P.head[0] * 1.3 * s, 1.25, B.c[2] + P.head[1] * 1.3 * s], [0, 0, 0], [4, 0, 3]);
  });
});
// A still camera (a GIF pays for every pixel that changes). The page's camera follows the animals, so it is shown
// one spot as their position until it settles there, and then held: it does not follow while something is "grabbed".
if (MODE !== 'log') {
  await page.evaluate(() => { const p = window.__jelly; p.__c = p.sim.bodies.map(B => B.c.slice()); p.sim.bodies.forEach(B => { B.c[0] = 0.594; B.c[2] = 1.214; }); });
  for (let k = 0; k < 50; k++) await page.clock.fastForward(100);
  await page.evaluate(() => { const p = window.__jelly; p.sim.bodies.forEach((B, b) => { B.c[0] = p.__c[b][0]; B.c[2] = p.__c[b][2]; }); p.drag.mode = 'grab'; });
}

const frame = f => page.evaluate(([f, STAGE, LIGHTS]) => {
  const p = window.__jelly, T = p.troupe;
  if (f === 40) T.rawrAll();
  if (f === 88) window.__serve();
  if (f >= 86 && f < 104) window.__hold();              // they wait for the treats to land (or they would wander off)
  if (f === 104) T.list.forEach((P, b) => { if (P.rawrT < 0) P.wait = 0.02 + 0.12 * b; });
  // the finale: once it has eaten, each turns and sets off across the table in a lane of its own, so that all go
  // by side-on with their lit stomachs showing (seen from in front, the dark belly hides the glow)
  if (f >= 120 && f < 180) {
    const az = 0.5, d = [Math.sin(az), Math.cos(az)], side = [Math.cos(az), -Math.sin(az)];
    if (!window.__sent) window.__sent = new Set();
    T.list.forEach((P, b) => {
      if (window.__sent.has(b) || P.berry >= 0 || P.rawrT >= 0 || P.wagT > 0.45) return;
      window.__sent.add(b);
      const c = p.sim.bodies[b].c, sg = c[0] * side[0] + c[2] * side[1] - STAGE.go[b];
      P.goal = [side[0] * sg + d[0] * STAGE.lane[b], side[1] * sg + d[1] * STAGE.lane[b]]; P.mode = 'walk'; P.walkT = 0; P.wait = 0; P.rawrDue = Infinity;
    });
  }
  if (f === LIGHTS) p.setLights(true);
  p.advance(3);
  p.state.time += 0.05;
  const az = p.state.az, cd = [Math.sin(az), Math.cos(az)], sd = [Math.cos(az), -Math.sin(az)];
  const st = { up: p.sim.bodies.map(B => B.R[4]), side: p.sim.bodies.map(B => B.c[0] * sd[0] + B.c[2] * sd[1]), depth: p.sim.bodies.map(B => B.c[0] * cd[0] + B.c[2] * cd[1]), facing: T.list.map(P => P.head[0] * cd[0] + P.head[1] * cd[1]), inside: T.list.map(P => P.slots.filter(S => S.t >= 0).length) };
  st.info = `f${String(f).padStart(3)} pose ${T.list.map(P => P.rawrT.toFixed(1)).join('/')} inside ${st.inside.join('/')} loose ${p.drops.freeCount} ${T.list.map(P => P.mode[0]).join('')} facing ${st.facing.map(v => v.toFixed(1)).join('/')} up ${st.up.map(v => v.toFixed(1)).join('/')} side ${st.side.map(v => v.toFixed(1)).join('/')} depth ${st.depth.map(v => v.toFixed(1)).join('/')}`;
  return st;
}, [f, STAGE, LIGHTS]);

const t0 = Date.now(), stats = [];
for (let f = 0; f < TOTAL; f++) {
  const st = await frame(f);
  stats.push(st);
  if (MODE === 'full' || KEYS.includes(f)) {
    await page.clock.fastForward(50);
    await page.screenshot(MODE === 'full' ? { type: 'png', path: path.join(dir, `f_${String(f).padStart(4, '0')}.png`) } : { type: 'jpeg', quality: 92, path: path.join(dir, `key_${f}.jpg`) });
  }
  if (!process.env.QUIET && f % (MODE === 'log' ? 6 : 15) === 0) console.log(st.info, `(${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
{
  // the staging in a line: does anyone fall over (up well under 1), leave the picture (side past about ±1.5 at this
  // zoom), or turn its back in the dark (facing near ±1)?
  const D = stats.slice(LIGHTS), all = k => stats.flatMap(s => s[k]), inD = k => D.flatMap(s => s[k]), f2 = v => v.toFixed(2), last = stats[TOTAL - 1];
  console.log(`STAGE ${JSON.stringify(STAGE)} → least up ${f2(Math.min(...all('up')))} | side ${f2(Math.min(...all('side')))}…${f2(Math.max(...all('side')))} | depth ${f2(Math.min(...all('depth')))}…${f2(Math.max(...all('depth')))} | in the dark: mean |facing| ${f2(inD('facing').reduce((a, v) => a + Math.abs(v), 0) / inD('facing').length)} | at the end: side ${last.side.map(f2)} depth ${last.depth.map(f2)} inside ${last.inside}`);
}
console.log('done', TOTAL, 'frames in', ((Date.now() - t0) / 1000).toFixed(0), 's');
await browser.close();
