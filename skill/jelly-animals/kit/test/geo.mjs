// The animal's geometry without a browser: lattice size, render mesh, how far the signature pose distorts the
// lattice, and a side-on and a top-down picture in characters.   node test/geo.mjs
import { S, poseRatios } from './lib.mjs';
const f2 = v => v.toFixed(2);

let t0 = performance.now();
const mesh = S.buildSimMesh();
const n = mesh.rest.length / 3, nT = mesh.tets.length / 4;
console.log(`lattice: ${n} particles, ${nT} tetrahedra per animal (${(performance.now() - t0).toFixed(0)} ms).  Aim for about 1,000–1,300 tetrahedra.`);
const reg = []; for (const r of mesh.region) reg[r] = (reg[r] || 0) + 1;
console.log('nodes per region (as partOf numbers them):', Array.from(reg, v => v || 0).join(' '));
const lo = [9, 9, 9], hi = [-9, -9, -9];
for (let i = 0; i < n; i++) for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], mesh.rest[3 * i + d]); hi[d] = Math.max(hi[d], mesh.rest[3 * i + d]); }
console.log('extent  x', f2(lo[0]), '…', f2(hi[0]), ' y', f2(lo[1]), '…', f2(hi[1]), ' z', f2(lo[2]), '…', f2(hi[2]));

console.log('\nthe signature pose (tetrahedron volume in the pose ÷ at rest; keep the least above about 0.25, never below 0):');
for (const [a, w] of [[1, 0], [1, 1], [1, -1], [0.5, 0.5]]) {
  const r = poseRatios(mesh, a, w);
  console.log(`  a=${a} wave=${w}: least ${f2(r.min)} at rest (${r.at.map(f2)}), ${r.low} under 0.3, most ${f2(r.max)}, whole volume ×${r.total.toFixed(3)}, top at y=${f2(r.top)}`);
}

t0 = performance.now();
const pm = S.buildAnimalMesh();
console.log(`\nrender mesh: ${pm.nV} vertices (${pm.bodyVerts} on the body), ${pm.body.length / 3} body triangles, ${pm.core.length / 3} in the dark layer, ${pm.bubbleCount} bubbles (${(performance.now() - t0).toFixed(0)} ms)`);
const emb = S.embed(mesh.rest, mesh.tets, new Float32Array(pm.pos), [pm.fixedVerts, pm.nV - pm.fixedVerts]);
let worst = 0; for (let v = 0; v < pm.fixedVerts; v++) for (let k = 0; k < 4; k++) worst = Math.min(worst, emb.w[4 * v + k]);
console.log('worst barycentric weight (how far outside its tetrahedron a vertex sits; past about −0.5 thin parts will tear):', f2(worst));
if (S.EYE) console.log('eye', S.EYE.p.map(f2).join(','), S.NOSE ? ' nose ' + S.NOSE.p.map(f2).join(',') : '');
if (S.TUMMY) console.log('places in the stomach:', S.TUMMY.map(K => K.spot.map(f2).join(',')).join(' | '));

// pictures: # the dark layer, o the clear jelly on the midline, : clear jelly off it
const W = 100, pad = 0.04, x0 = lo[0] - pad, x1 = hi[0] + pad;
console.log('\nside-on (nose to the right):');
for (let j = 27; j >= 0; j--) {
  let row = '';
  for (let i = 0; i < W; i++) {
    const x = x0 + (i + 0.5) / W * (x1 - x0), y = (j + 0.5) / 28 * (hi[1] + pad);
    let c = ' ';
    for (let z = 0; z <= hi[2] && c === ' '; z += 0.03) if (S.animalSD(x, y, z) < 0) c = S.coreSD(x, y, z) < 0 ? '#' : (z < 0.06 ? 'o' : ':');
    row += c;
  }
  console.log(row);
}
console.log('\nfrom above:');
for (let k = 0; k < 22; k++) {
  let row = '';
  for (let i = 0; i < W; i++) {
    const x = x0 + (i + 0.5) / W * (x1 - x0), z = hi[2] + pad - (k + 0.5) / 22 * 2 * (hi[2] + pad);
    let c = ' ';
    for (let y = 0.01; y <= hi[1] && c === ' '; y += 0.03) if (S.animalSD(x, y, z) < 0) c = 'o';
    row += c;
  }
  console.log(row);
}
