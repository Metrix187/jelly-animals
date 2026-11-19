// Films an entry's page into preview.gif. Every animal gets the same reel, so the cards compare like with like:
// hop toward the camera, strike the pose, a treat each, lights out, and across the table with lit stomachs.
//
//   node tools/gif.mjs models/grokbot/lion     rehearse, film, encode → models/grokbot/lion/preview.gif
//   node tools/gif.mjs --missing               every entry that has no preview.gif yet
//   node tools/gif.mjs <entry> --dry           rehearse and draw four key frames only (tools/.work/<entry>/keys/)
//   node tools/gif.mjs <entry> --rehearse      ignore the entry's reel.json and pick a staging again
//
// Once (in tools/): npm i     Needs ffmpeg on the PATH, and Chromium for Playwright (npx playwright install chromium).
//
// How it works. The page's clock is stood still and the simulation is stepped by hand, so each frame is exact
// however slow the software renderer is. The simulation is chaotic: a staging that suits one animal tips another
// over. So a handful of stagings are first run without drawing (seconds each) and judged in numbers: does everyone
// stay on its feet, stay in the picture, eat, and go by side-on in the dark. The best one is filmed and written to
// the entry's reel.json, which pins it: the same command later films the same reel.
// The staging and the beats are those of the skill's own kit/gif/capture.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import gifsicle from 'gifsicle';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '..');
const W = 720, H = 540, TOTAL = 196, SKIP = 8, LIGHTS = 140, KEYS = [0, 68, 110, 195], LIMIT = 5 * 1024 * 1024;
const BASE = { lane: [0.3, 0.72, 1.0], go: [1.3, 1.2, 0.3], turn: 0 };
const TRIES = [{}, { turn: 0.05 }, { turn: -0.05 }, { go: [1.2, 1.1, 0.4] }, { lane: [0.2, 0.7, 1.1] }, { go: [1.4, 1.0, 0.2], turn: 0.03 }, { turn: 0.1 }, { turn: -0.1 }];
const THREE = fs.readFileSync(path.join(path.dirname(createRequire(import.meta.url).resolve('three')), 'three.module.js'), 'utf8');

const flags = new Set(process.argv.slice(2).filter(a => a.startsWith('--')));
let entries = process.argv.slice(2).filter(a => !a.startsWith('--')).map(a => path.resolve(a));
if (flags.has('--missing')) {
  const dirs = d => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join(d, e.name)) : [];
  entries = [...dirs(path.join(root, 'reference')), ...dirs(path.join(root, 'models')).flatMap(dirs)]
    .filter(d => fs.existsSync(path.join(d, 'index.html')) && !fs.existsSync(path.join(d, 'preview.gif')));
}
if (!entries.length) { console.log(flags.has('--missing') ? 'every entry has a preview.gif' : 'usage: node tools/gif.mjs <entry folder> | --missing  [--dry] [--rehearse]'); process.exit(0); }

// the page, up and running, with its clock stood still; `stageOnly` hides everything but the table and the name
async function open(entry, stageOnly) {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
  await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'text/javascript', body: THREE }));   // three.js from disk
  await page.addInitScript(() => { window.__fixPR = 1; window.__keepFrame = true; });
  await page.clock.install({ time: new Date('2026-01-01T12:00:00Z') });
  await page.goto(pathToFileURL(path.join(entry, 'index.html')).href);
  let up = false;
  for (let k = 0; k < 480 && !up; k++) {
    up = await page.evaluate(() => !!window.__jelly || !document.getElementById('fallback').hidden);
    if (!up) await new Promise(r => setTimeout(r, 250));
  }
  const fallback = await page.evaluate(() => (window.__jelly ? null : document.getElementById('fallbackTitle').textContent + ' :: ' + document.getElementById('fallbackDetail').textContent));
  if (fallback) { await browser.close(); throw new Error('the page did not start: ' + fallback); }
  await page.clock.pauseAt(new Date('2026-01-01T12:05:00Z'));
  if (stageOnly) await page.addStyleTag({ content: `
    .status, .panel, .readouts, .notes, .masthead .kicker, .masthead .caption { display: none !important; }
    body { display: block !important; overflow: hidden !important; padding: 0 !important; }
    .stage { position: fixed !important; inset: 0 !important; height: auto !important; border: 0 !important; }
    canvas { transition: none !important; opacity: 1 !important; }
    .masthead { position: fixed !important; top: 4.4vh; left: 4.2vw; padding: 0 !important; z-index: 2; }
    .masthead h1 { font-size: 7.6vh !important; margin: 0 !important; }
  ` });
  return { browser, page };
}

// put the animals down at the back of the table facing the camera, a first helping inside, and send them forward
const setStage = (page, S) => page.evaluate(S => {
  const p = window.__jelly, T = p.troupe, L = p.drops.list, sim = p.sim, n = sim.bodies.length;
  p.state.paused = true;                      // the page stops stepping the simulation itself; advance() does it
  T.arena = 1.25;
  Object.assign(p.state, { zoom: 1.12, el: 0.38, az: 0.62 });
  // "depth" is toward the camera and "side" across it, as the camera stands
  const az = 0.66, d = [Math.sin(az), Math.cos(az)], side = [Math.cos(az), -Math.sin(az)];
  const at = (sg, dp) => [side[0] * sg + d[0] * dp, side[1] * sg + d[1] * dp];
  const start = [[0.02, -0.92, 0.06], [1.08, -0.72, -0.12], [-1.0, -0.6, 0.14]].slice(0, n);
  T.reset();
  start.forEach(([sg, dp, turn], b) => sim.place(b, 0.05, at(sg, dp), az - Math.PI / 2 + turn + S.turn));
  T.list.forEach((P, b) => P.slots.slice(0, [4, 4, 3][b]).forEach((slot, k) => { slot.t = 1; slot.grow = 1; slot.age = 2 * k; slot.life = 70; }));
  p.advance(45);
  T.list.forEach((P, b) => { P.goal = at(start[b][0] * 1.08, 1.5); P.mode = 'walk'; P.berry = -1; P.walkT = 0; P.wait = 0; P.cad = 0.5 + 0.2 * sim.bodies[b].scale + 0.05 * b; });
  p.advance(24);
  window.__hold = () => T.list.forEach(P => { if (P.mode === 'idle' && P.rawrT < 0) P.wait = 9; });
  // one treat each, a little way in front of its nose
  window.__serve = () => T.list.forEach((P, b) => {
    const B = sim.bodies[b], s = B.scale, i = L.findIndex(A => A.hidden); if (i < 0) return;
    p.drops.release(i, [B.c[0] + P.head[0] * 1.3 * s, 1.25, B.c[2] + P.head[1] * 1.3 * s], [0, 0, 0], [4, 0, 3]);
  });
}, S);

// one frame of the reel: its beat, three simulation steps, and where everyone is afterwards
const frame = (page, f, S) => page.evaluate(([f, S, LIGHTS]) => {
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
      const c = p.sim.bodies[b].c, sg = c[0] * side[0] + c[2] * side[1] - S.go[b];
      P.goal = [side[0] * sg + d[0] * S.lane[b], side[1] * sg + d[1] * S.lane[b]]; P.mode = 'walk'; P.walkT = 0; P.wait = 0; P.rawrDue = Infinity;
    });
  }
  if (f === LIGHTS) p.setLights(true);
  p.advance(3);
  p.state.time += 0.05;
  const az = p.state.az, cd = [Math.sin(az), Math.cos(az)], sd = [Math.cos(az), -Math.sin(az)];
  return { up: p.sim.bodies.map(B => B.R[4]), side: p.sim.bodies.map(B => B.c[0] * sd[0] + B.c[2] * sd[1]), facing: T.list.map(P => P.head[0] * cd[0] + P.head[1] * cd[1]), inside: T.list.map(P => P.slots.filter(slot => slot.t >= 0).length) };
}, [f, S, LIGHTS]);

// a reel in numbers: the share of the time everyone is on its feet and in the picture, who ate, and how side-on
// they are once the lights are out
function judge(stats) {
  const n = stats[0].up.length, all = k => stats.flatMap(s => s[k]), share = (k, ok) => all(k).filter(ok).length / (stats.length * n);
  const dark = stats.slice(LIGHTS).flatMap(s => s.facing), last = stats[stats.length - 1].inside;
  const J = {
    upright: share('up', v => v >= 0.6), inFrame: share('side', v => Math.abs(v) <= 1.5),
    fed: last.filter((v, b) => v > stats[0].inside[b]).length / n,
    sideOn: 1 - dark.reduce((a, v) => a + Math.abs(v), 0) / dark.length,
    leastUp: Math.min(...all('up')), widest: Math.max(...all('side').map(Math.abs)),
  };
  J.score = 3 * J.upright + 3 * J.inFrame + J.fed + 0.5 * J.sideOn;
  return J;
}
const line = J => `on its feet ${(100 * J.upright).toFixed(0)}% · in the picture ${(100 * J.inFrame).toFixed(0)}% · fed ${(100 * J.fed).toFixed(0)}% · side-on in the dark ${J.sideOn.toFixed(2)} · least up ${J.leastUp.toFixed(2)} · widest ${J.widest.toFixed(2)}`;

async function rehearse(entry, S) {
  const { browser, page } = await open(entry, false);
  try {
    await setStage(page, S);
    const stats = [];
    for (let f = 0; f < TOTAL; f++) stats.push(await frame(page, f, S));
    return judge(stats);
  } finally { await browser.close(); }
}

async function film(entry, S, dir, dry) {
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const { browser, page } = await open(entry, true);
  try {
    await setStage(page, S);
    // A still camera (a GIF pays for every pixel that changes). The page's camera follows the animals, so it is
    // shown one spot as their position until it settles there, and then held: it does not follow while something
    // is "grabbed".
    await page.evaluate(() => { const p = window.__jelly; p.__c = p.sim.bodies.map(B => B.c.slice()); p.sim.bodies.forEach(B => { B.c[0] = 0.594; B.c[2] = 1.214; }); });
    for (let k = 0; k < 50; k++) await page.clock.fastForward(100);
    await page.evaluate(() => { const p = window.__jelly; p.sim.bodies.forEach((B, b) => { B.c[0] = p.__c[b][0]; B.c[2] = p.__c[b][2]; }); p.drag.mode = 'grab'; });
    const stats = [], t0 = Date.now();
    for (let f = 0; f < TOTAL; f++) {
      stats.push(await frame(page, f, S));
      if (dry && !KEYS.includes(f)) continue;
      await page.clock.fastForward(50);
      await page.screenshot(dry ? { type: 'jpeg', quality: 92, path: path.join(dir, `key_${f}.jpg`) } : { type: 'png', path: path.join(dir, `f_${String(f).padStart(4, '0')}.png`) });
      if (!dry && f % 49 === 0) console.log(`  frame ${f} of ${TOTAL} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
    return judge(stats);
  } finally { await browser.close(); }
}

function encode(frames, work, out) {
  const raw = path.join(work, 'raw.gif');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '20', '-start_number', String(SKIP), '-i', path.join(frames, 'f_%04d.png'), '-frames:v', String(TOTAL - SKIP),
    '-vf', `scale=${W}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, '-loop', '0', raw]);
  let lossy;
  for (lossy of [36, 60, 90, 130, 180]) {                // raise --lossy before shrinking the picture
    execFileSync(gifsicle, ['-O3', `--lossy=${lossy}`, raw, '-o', out]);
    if (fs.statSync(out).size <= LIMIT) break;
  }
  return lossy;
}

for (const entry of entries) {
  const name = path.relative(root, entry).split(path.sep).join('/'), work = path.join(here, '.work', name.replace(/\//g, '-'));
  if (!fs.existsSync(path.join(entry, 'index.html'))) { console.log(`${name}: no index.html, skipped`); continue; }
  console.log(`\n${name}`);
  const pin = path.join(entry, 'reel.json');
  let S, J;
  if (fs.existsSync(pin) && !flags.has('--rehearse')) {
    S = { ...BASE, ...JSON.parse(fs.readFileSync(pin, 'utf8')).stage };
    console.log(`  staging from reel.json ${JSON.stringify(S)}`);
  } else {
    for (const [k, t] of TRIES.entries()) {
      const s = { ...BASE, ...t }, j = await rehearse(entry, s);
      console.log(`  rehearsal ${k + 1}: ${line(j)}`);
      if (!J || j.score > J.score) { S = s; J = j; }
      if (j.upright > 0.97 && j.inFrame === 1 && j.fed === 1) break;      // nothing to improve on
    }
    console.log(`  chosen ${JSON.stringify(S)}`);
  }
  const dry = flags.has('--dry'), shots = path.join(work, dry ? 'keys' : 'frames');
  const F = await film(entry, S, shots, dry);
  if (J && Math.abs(F.score - J.score) > 1e-6) console.log('  note: the filmed reel differs from its rehearsal: ' + line(F));
  if (dry) { console.log(`  key frames in ${path.relative(root, shots)}`); continue; }
  const out = path.join(entry, 'preview.gif'), lossy = encode(shots, work, out);
  for (const f of ['preview.png', 'preview.jpg']) fs.rmSync(path.join(entry, f), { force: true });     // the GIF is the card now
  fs.writeFileSync(pin, JSON.stringify({ stage: S, reel: line(F) }, null, 2) + '\n');
  console.log(`  ${name}/preview.gif  ${(fs.statSync(out).size / 1048576).toFixed(2)} MB (lossy ${lossy})  ${line(F)}`);
}
