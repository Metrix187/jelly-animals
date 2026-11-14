// What the animals do, without a browser.   node test/behave.mjs [walk|pose|flip|eat|extremes|prof|all]
import { S, world } from './lib.mjs';
const what = process.argv[2] || 'all', f2 = v => v.toFixed(2), on = k => what === 'all' || what === k;
const hold = W => W.troupe.list.forEach(P => { P.mode = 'idle'; P.wait = 99; });
const finite = sim => { for (let i = 0; i < sim.x.length; i++) if (!Number.isFinite(sim.x[i])) return false; return true; };

if (on('walk')) {
  console.log('── walk: 10 s of wandering. Each should stay upright (up ≈ 1), with its middle near its height at rest ──');
  const W = world(), { sim, troupe } = W;
  for (let s = 1; s <= 10; s++) {
    W.step(60);
    console.log(`t=${s}s  ` + sim.bodies.map((B, b) => `${troupe.list[b].mode[0]} (${f2(B.c[0])},${f2(B.c[1])},${f2(B.c[2])}) up ${f2(B.R[4])}`).join(' | ') + ` | least tet ${f2(sim.minVolumeRatio())}${finite(sim) ? '' : ' NaN!'}`);
  }
  console.log('hops', troupe.hops);
}
if (on('pose')) {
  console.log('── pose: all stand; the head should rise and hold, then come down ──');
  const W = world(), { sim, troupe } = W, head = [0, 0, 0];
  W.step(120); hold(W); W.step(40);
  troupe.rawrAll();
  for (let k = 0; k < 16; k++) {
    W.step(12);
    console.log(`+${f2((k + 1) * 0.2)}s  ` + sim.bodies.map((B, b) => `pose ${f2(B.poseA)} head y ${f2(W.anchor(b, S.A_HEAD, head)[1])} top ${f2(B.hi[1])}`).join(' | ') + ` | least tet ${f2(sim.minVolumeRatio())}`);
  }
}
if (on('flip')) {
  console.log('── flip: every animal turned over and dropped; each should be on its feet again within a few seconds ──');
  for (const [name, [roll, pitch]] of [['on its back', [Math.PI, 0]], ['on its side', [Math.PI / 2, 0]], ['other side', [-Math.PI / 2, 0]], ['on its nose', [0, -Math.PI / 2]], ['on its tail', [0, Math.PI / 2]]]) {
    const W = world({ treats: false }), { sim, troupe } = W;
    W.step(90);
    const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch);
    for (const B of sim.bodies) {
      const c = B.c.slice();
      for (let i = B.p0; i < B.p0 + sim.n1; i++) {
        const k = 3 * i; let x = sim.x[k] - c[0], y = sim.x[k + 1] - c[1], z = sim.x[k + 2] - c[2];
        [y, z] = [y * cr - z * sr, y * sr + z * cr];
        [x, y] = [x * cp - y * sp, x * sp + y * cp];
        sim.x[k] = c[0] + x; sim.x[k + 1] = c[1] + y + 0.75; sim.x[k + 2] = c[2] + z;
        for (let d = 0; d < 3; d++) { sim.prev[k + d] = sim.x[k + d]; sim.v[k + d] = 0; }
      }
    }
    const done = sim.bodies.map(() => -1), ups = [];
    for (let i = 1; i <= 600; i++) { W.step(); troupe.list.forEach((P, b) => { if (done[b] < 0 && i > 30 && P.upright && P.grounded) done[b] = i / 60; }); if (i % 60 === 0) ups.push(sim.bodies.map(B => B.R[4].toFixed(1)).join('/')); }
    console.log(name.padEnd(12), 'upright after', done.map(v => (v < 0 ? 'never' : v.toFixed(1) + 's')).join(', '), ' | up each second:', ups.join(' '));
  }
}
if (on('eat')) {
  console.log('── eat: nine treats dropped; they should all be eaten within about 20 s ──');
  const W = world(), { troupe, drops } = W;
  W.step(90);
  for (let i = 0; i < 9; i++) { const a = i * 0.7, r = 0.3 + 0.13 * i; drops.release(i, [Math.cos(a) * r, 1.2 + 0.15 * i, Math.sin(a) * r], [0, 0, 0], [3, 0, 2]); }
  for (let s = 1; s <= 25 && drops.freeCount; s++) { W.step(60); console.log(`t=${s}s eaten ${troupe.eaten} inside ${troupe.inside()} loose ${drops.freeCount}  ${troupe.list.map(P => P.mode + (P.berry >= 0 ? '→' + P.berry : '')).join(' ')}`); }
}
if (on('extremes')) {
  console.log('── extremes: both sliders at their ends, and the slow-device 7 substeps; nothing should blow up or fall over for good ──');
  for (const [label, firmness, damping, substeps] of [['default, 7 substeps', 0.5, 0.4, 7], ['trembling + lively', 0, 0, 0], ['set + syrupy', 1, 1, 0], ['trembling + syrupy', 0, 1, 0], ['set + lively', 1, 0, 0]]) {
    const W = world({ firmness, damping, substeps, treats: false }), { sim, troupe } = W;
    let ok = true, far = 0;
    const run = n => { for (let i = 0; i < n; i++) { W.step(); for (const B of sim.bodies) { if (!Number.isFinite(B.c[0])) ok = false; far = Math.max(far, Math.hypot(B.c[0], B.c[2])); } } };
    run(480);
    const hops = troupe.hops, up1 = sim.bodies.map(B => f2(B.R[4]));
    hold(W); run(40); troupe.rawrAll(); run(80);
    const tall = sim.bodies.map(B => f2(B.hi[1] / B.scale)), least = sim.minVolumeRatio();
    run(120);
    console.log(label.padEnd(20), `hops ${hops} | up ${up1} | standing height ÷ scale ${tall} least tet ${f2(least)} | farthest from the middle ${far.toFixed(1)}${ok ? '' : '  NaN!'}`);
  }
}
if (on('prof')) {
  console.log('── prof: where a step goes. The original single whale was about 3,300 tetrahedra; stay near that in total ──');
  const W = world({ treats: false }), { sim, troupe } = W, T = {};
  console.log('particles', sim.n, 'tetrahedra', sim.nT, 'edges', sim.nE);
  for (const m of ['solveTets', 'solveVolumes', 'solveFloor', 'dampEdges', 'solveContacts', 'buildContacts', 'spin', 'frame']) { const f = sim[m].bind(sim); T[m] = 0; sim[m] = (...a) => { const t = performance.now(), r = f(...a); T[m] += performance.now() - t; return r; }; }
  let total = 0; const crushed = [];
  for (let i = 0; i < 900; i++) {
    if (i === 300) { for (const k in T) T[k] = 0; total = 0; }
    const t0 = performance.now(); W.step(); total += performance.now() - t0;
    let mn = 9, wt = -1; for (let t = 0; t < sim.nT; t++) { const r = sim.tetVol(sim.x, t) / sim.restVol[t]; if (r < mn) { mn = r; wt = t; } }
    if (mn < 0.3) { const c = [0, 0, 0]; for (let k = 0; k < 4; k++) for (let d = 0; d < 3; d++) c[d] += sim.rest0[3 * sim.tets[4 * wt + k] + d] / 4; crushed.push(`t=${(i / 60).toFixed(2)} least ${f2(mn)} animal ${Math.floor(wt / sim.nT1)} at rest (${c.map(f2)}) touching pairs ${sim.pairs.length / 2}`); }
  }
  console.log(`total ${(total / 600).toFixed(2)} ms per step:  ` + Object.entries(T).map(([k, v]) => `${k} ${(v / 600).toFixed(2)}`).join('  '));
  console.log(`${crushed.length} of 900 steps had a tetrahedron under 0.3 of its volume (the red pandas show 100–300, nearly all of them the smallest being squeezed by the others or a foot landing; worry when it is most steps, or when the least stays below 0 with no pairs touching)`);
  console.log(crushed.filter((_, i) => i % Math.ceil(crushed.length / 12) === 0).join('\n'));
}
