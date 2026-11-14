// Tries every combination of the given values for the pose's parameters and lists the ones that distort the
// lattice least.   node test/pose-scan.mjs '{"pitch":[0.9,1.0],"hip.1":[0.44,0.5],"arm":[0.45,0.55]}'
// A key is a field of POSE; "hip.1" is the second number of POSE.hip.
import { S, poseRatios } from './lib.mjs';
const grid = JSON.parse(process.argv[2] || '{}'), keys = Object.keys(grid), mesh = S.buildSimMesh(), rows = [];
const set = (k, v) => { const p = k.split('.'); let o = S.POSE; for (const q of p.slice(0, -1)) o = o[q]; o[p[p.length - 1]] = v; };
const walk = (i, pick) => {
  if (i === keys.length) {
    for (const k of keys) set(k, pick[k]);
    const r = [[1, 0], [1, 1], [1, -1], [0.5, 0.5]].map(([a, w]) => poseRatios(mesh, a, w));
    rows.push({ ...pick, least: Math.min(...r.map(q => q.min)), most: Math.max(...r.map(q => q.max)), volume: r[0].total, top: r[0].top });
    return;
  }
  for (const v of grid[keys[i]]) walk(i + 1, { ...pick, [keys[i]]: v });
};
walk(0, {});
rows.sort((a, b) => b.least - a.least);
for (const r of rows.slice(0, 14)) console.log(JSON.stringify(r, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v)));
