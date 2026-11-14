// The table as the page sets it, without a browser: every animal, the treats, and what the animals decide to do.
import S from './_sim.mjs';
export { S };

export function world({ firmness = 0.5, damping = 0.4, arena = 1.7, substeps = 0, treats = true } = {}) {
  const mesh = S.buildSimMesh();
  const sim = new S.SoftBody(mesh, S.TRIO, { firmness, damping });
  if (substeps) sim.substeps = substeps;
  const drops = new S.DropSet(treats ? S.buildScene(S.TRIO.length).drops : [], sim);
  // a point that rides the jelly of animal b: point i of ANCHORS, wherever its tetrahedron has gone
  const embC = S.embed(mesh.rest, mesh.tets, new Float32Array(S.ANCHORS.flat()));
  const anchor = (b, i, out) => {
    const x = sim.x, p0 = b * sim.n1, t = 4 * embC.tetOf[i];
    out[0] = out[1] = out[2] = 0;
    for (let c = 0; c < 4; c++) { const q = 3 * (mesh.tets[t + c] + p0), w = embC.w[4 * i + c]; out[0] += x[q] * w; out[1] += x[q + 1] * w; out[2] += x[q + 2] * w; }
    return out;
  };
  const troupe = new S.Troupe(sim, drops, { anchor, arena });
  sim.reset(0.3);
  const step = (n = 1) => { for (let i = 0; i < n; i++) { troupe.step(sim.stepDt); sim.step(); if (drops.freeCount) drops.step(sim.stepDt); } };
  return { mesh, sim, drops, troupe, anchor, step };
}
// the volume of each tetrahedron of the lattice in the pose (a, wave), over its volume at rest
export function poseRatios(mesh, a, wave) {
  const n = mesh.rest.length / 3, nT = mesh.tets.length / 4, P = new Float64Array(n * 3), R = Float64Array.from(mesh.rest), o = [0, 0, 0];
  for (let i = 0; i < n; i++) { S.posePoint(R[3 * i], R[3 * i + 1], R[3 * i + 2], a, wave, o); P.set(o, 3 * i); }
  const vol = (Q, t) => S.tetVolume(Q, mesh.tets[4 * t], mesh.tets[4 * t + 1], mesh.tets[4 * t + 2], mesh.tets[4 * t + 3]);
  let min = 9, max = 0, worst = -1, low = 0, tot = 0, tot0 = 0, top = 0;
  for (let t = 0; t < nT; t++) { const v = vol(P, t), v0 = vol(R, t), r = v / v0; tot += v; tot0 += v0; if (r < min) { min = r; worst = t; } if (r > max) max = r; if (r < 0.3) low++; }
  for (let i = 0; i < n; i++) top = Math.max(top, P[3 * i + 1]);
  const at = [0, 0, 0];
  for (let k = 0; k < 4; k++) for (let d = 0; d < 3; d++) at[d] += R[3 * mesh.tets[4 * worst + k] + d] / 4;
  return { min, max, low, total: tot / tot0, top, at };
}
