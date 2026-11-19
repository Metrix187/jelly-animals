// ===== geometry.js =====
// ─────────────────────────────────────────────────────────────
//  Geometry: a flamingo cast in jelly, standing on two webbed
//  feet. A signed distance field gives the body: a broad low body,
//  a long S neck and a small head, a downward black-tipped bill,
//  two splayed legs with webbed feet and a short tail, joined with
//  smooth unions. Under a wavy line the belly and the legs are a
//  second, deeper-rose layer of jelly; inside, a few bubbles and
//  room in the stomach for the shrimp it eats. A snapped hex lattice
//  (5 tets per cell) for the simulation, surface-nets render surfaces
//  for the clear jelly and the dark layer, and the barycentric
//  embedding that ties every vertex to a tetrahedron. One flamingo
//  is built; the table holds copies.
// ─────────────────────────────────────────────────────────────

// rest frame: bill toward +x, tail toward −x, feet on the floor (y = 0), z across (the bird is mirrored in z)
const SHAPE = {
  torso:  { c: [-0.1, 0.42, 0], r: [0.4, 0.22, 0.25] },
  tail:   { a: [-0.4, 0.46, 0], b: [-0.6, 0.58, 0], ra: 0.11, rb: 0.06 },
  neck:   [ { a: [0.0, 0.54, 0], b: [0.16, 0.8, 0], ra: 0.18, rb: 0.16 },
            { a: [0.16, 0.8, 0], b: [0.26, 0.88, 0], ra: 0.16, rb: 0.145 } ],
  head:   { c: [0.3, 0.9, 0], r: [0.13, 0.14, 0.15] },
  beak:   { a: [0.38, 0.84, 0], b: [0.42, 0.64, 0], ra: 0.12, rb: 0.1 },
  leg:    { x: 0.0, z: 0.18, top: 0.2, r: 0.1 },
  eye:    { dir: [0.82, 0.22, 0.53], a: 0.04, c: 0.03 },
  nose:   { dir: [0.18, -0.98, 0], a: 0.03, b: 0.05, c: 0.03 },   // the black tip of the bill
  muzzle: { c: [0.38, 0.84, 0] },                                 // anchor for the tip bead
  mouth:  [0.35, 0.8, 0],           // where a shrimp goes in
  tummy:  [-0.1, 0.46, 0],           // the middle of the stomach
  skin: 0.014,                       // the dark layer sits this far under the surface
};

// seeded PRNG so the specimen is identical on each load
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const clamp01 = v => Math.min(1, Math.max(0, v));
const sstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const vnorm3 = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// iq's uneven capsule in 2D: a circle of radius r1 at the origin joined by tangent lines to one of radius r2 at (0, h)
function sdUnevenCapsule(px, py, r1, r2, h) {
  px = Math.abs(px);
  const b = (r1 - r2) / h, a = Math.sqrt(1 - b * b), k = -b * px + a * py;
  if (k < 0) return Math.hypot(px, py) - r1;
  if (k > a * h) return Math.hypot(px, py - h) - r2;
  return a * px + b * py - r1;
}
// a 2D outline given thickness 2·th, its edges rounded with radius rr
function extrude(d2, t, th, rr) {
  const wx = d2 + rr, wy = Math.abs(t) - th + rr;
  return Math.min(Math.max(wx, wy), 0) + Math.hypot(Math.max(wx, 0), Math.max(wy, 0)) - rr;
}
function sdEllipsoid(px, py, pz, a, b, c) {
  const k0 = Math.hypot(px / a, py / b, pz / c);
  if (k0 < 1) return (k0 - 1) * Math.min(a, b, c);
  const k1 = Math.hypot(px / (a * a), py / (b * b), pz / (c * c));
  return k0 * (k0 - 1) / k1;
}
// a capsule standing upright, its axis from y0 to y1
function sdVCapsule(px, py, pz, y0, y1, r) {
  const dy = py - Math.min(Math.max(py, y0), y1);
  return Math.sqrt(px * px + dy * dy + pz * pz) - r;
}
// iq's round cone: a sphere of radius r1 at A joined to one of radius r2 at B
function sdRoundCone(px, py, pz, A, B, r1, r2) {
  const bx = B[0] - A[0], by = B[1] - A[1], bz = B[2] - A[2];
  const l2 = bx * bx + by * by + bz * bz, rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const ax = px - A[0], ay = py - A[1], az = pz - A[2];
  const y = ax * bx + ay * by + az * bz, z = y - l2;
  const cx = ax * l2 - bx * y, cy = ay * l2 - by * y, cz = az * l2 - bz * y;
  const x2 = cx * cx + cy * cy + cz * cz, y2 = y * y * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

// ── the parts (z ≥ 0: the bird is mirrored across its midline) ──
// a leg: a stout capsule from the body down to a wide webbed foot (the foot widens the stance in x)
function legSD(x, y, z) {
  const L = SHAPE.leg;
  let d = sdVCapsule(x - L.x, y, z - L.z, 0.05, L.top, L.r);
  d = Math.min(d, sdEllipsoid(x - (L.x + 0.06), y - 0.02, z - L.z, 0.2, 0.05, 0.13));
  return d;
}
// the neck: two round cones, a gentle S from the body up to the head
function neckSD(x, y, z) {
  let d = Infinity;
  for (const n of SHAPE.neck) d = Math.min(d, sdRoundCone(x, y, z, n.a, n.b, n.ra, n.rb));
  return d;
}
// the bill: a downward round cone from the head to a blunt tip
function beakSD(x, y, z) { const B = SHAPE.beak; return sdRoundCone(x, y, z, B.a, B.b, B.ra, B.rb); }
// the tail: short and slight, for balance
function tailSD(x, y, z) { const T = SHAPE.tail; return sdRoundCone(x, y, z, T.a, T.b, T.ra, T.rb); }
// torso, head, neck, bill and tail
function trunkSD(x, y, z) {
  const P = SHAPE, t = P.torso, h = P.head;
  let d = sdEllipsoid(x - t.c[0], y - t.c[1], z, t.r[0], t.r[1], t.r[2]);
  d = smin(d, sdEllipsoid(x - h.c[0], y - h.c[1], z, h.r[0], h.r[1], h.r[2]), 0.07);
  d = smin(d, neckSD(x, y, z), 0.08);
  d = smin(d, beakSD(x, y, z), 0.05);
  return smin(d, tailSD(x, y, z), 0.08);
}
function animalSD(x, y, z) {
  z = Math.abs(z);
  let d = trunkSD(x, y, z);
  d = smin(d, legSD(x, y, z), 0.07);
  return Math.max(d, -y);
}
// the line between the clear jelly above and the dark layer below: it waves along the flank, and drops away under
// the neck, head and tail, so the dark is the belly and the legs
function darkY(x) {
  let yb = 0.33 + 0.02 * Math.sin(5.0 * x + 0.4) + 0.008 * Math.sin(13.0 * x);
  yb += (0.1 - yb) * sstep(0.2, 0.45, x);
  return yb - 0.5 * sstep(-0.45, -0.6, x);
}
// the dark layer: the body drawn in by the skin, below the wavy line
function coreSD(x, y, z) { return smax(animalSD(x, y, z) + SHAPE.skin, y - darkY(x), 0.02); }
// which part a rest-space point belongs to: 4 the tail, 3 legs / neck / bill, 2 the skin, 1 the clear jelly, 0 the dark layer
function partOf(x, y, z) {
  const az = Math.abs(z);
  if (legSD(x, y, az) < 0.02 && y < 0.25) return 3;
  if (neckSD(x, y, az) < 0.02) return 3;
  if (beakSD(x, y, az) < 0.03) return 3;
  if (tailSD(x, y, az) < 0.03) return 4;
  if (-animalSD(x, y, z) < 0.06) return 2;
  return coreSD(x, y, z) < 0 ? 0 : 1;
}

// ── the resting pose: a flamingo tucks its head down and back, the long neck folding so the bill points toward the
//    body ── a: 0 standing … 1 tucked; wave: −1 … 1, the bill dipping a little as it holds. Everything forward of and
//    above the neck base swings down about it; the legs and the tail stay where they are, a tripod.
const POSE = { base: [0.04, 0.55], pitch: -0.42, tilt: 0.2, u0: -0.22, u1: 0.7, neck: [0.2, 0.85], nod: 0.0 };
function posePoint(x, y, z, a, wave, out) {
  out[0] = x; out[1] = y; out[2] = z;
  if (a <= 0) return out;
  const Q = POSE;
  // swing the neck and head down about the neck base (wide blend so the tetrahedra are not sheared)
  const wb = a * sstep(Q.u0, Q.u1, (x - Q.base[0]) + Q.tilt * (y - Q.base[1]));
  if (wb > 1e-4) {
    const th = wb * Q.pitch, c = Math.cos(th), s = Math.sin(th);
    const qx = x - Q.base[0], qy = y - Q.base[1];
    x = Q.base[0] + qx * c - qy * s; y = Q.base[1] + qx * s + qy * c;
  }
  // the head tips a little further down so the bill points at the body, not the floor
  const wn = a * sstep(-0.02, 0.22, (out[0] - Q.neck[0]) + 0.5 * (out[1] - Q.neck[1]));
  if (wn > 1e-4) {
    const th = wn * Q.nod, c = Math.cos(th), s = Math.sin(th);
    const qx = x - Q.neck[0], qy = y - Q.neck[1];
    x = Q.neck[0] + qx * c - qy * s; y = Q.neck[1] + qx * s + qy * c;
  }
  out[0] = x; out[1] = y;
  return out;
}

function sdGrad(sd, x, y, z, e = 1e-3) {
  const gx = sd(x + e, y, z) - sd(x - e, y, z), gy = sd(x, y + e, z) - sd(x, y - e, z), gz = sd(x, y, z + e) - sd(x, y, z - e);
  const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
  return [gx / l, gy / l, gz / l, l / (2 * e)];
}
// Newton steps onto the zero set
function project(sd, p, iters = 4) {
  for (let it = 0; it < iters; it++) {
    const d = sd(p[0], p[1], p[2]);
    if (Math.abs(d) < 1e-5) break;
    const g = sdGrad(sd, p[0], p[1], p[2]);
    const s = d / Math.max(0.3, g[3]);
    p[0] -= g[0] * s; p[1] -= g[1] * s; p[2] -= g[2] * s;
  }
  return p;
}

// ── surface nets: one vertex per sign-changing cell, projected onto the surface ──
function surfaceNets(sd, box, s) {
  const x0 = box[0] - s, y0 = box[1] - s, z0 = box[2] - s;
  const nx = Math.ceil((box[3] - box[0]) / s) + 3, ny = Math.ceil((box[4] - box[1]) / s) + 3, nz = Math.ceil((box[5] - box[2]) / s) + 3;
  const nxy = nx * ny;
  const val = new Float32Array(nxy * nz);
  for (let k = 0; k < nz; k++) { const z = z0 + k * s; for (let j = 0; j < ny; j++) { const y = y0 + j * s, o = nx * j + nxy * k; for (let i = 0; i < nx; i++) val[o + i] = sd(x0 + i * s, y, z); } }
  const cellV = new Int32Array(nxy * nz).fill(-1);
  const pos = [], nrm = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const off = [0, 1, nx, nx + 1, nxy, nxy + 1, nxy + nx, nxy + nx + 1];
  const cv = new Float64Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const base = i + nx * j + nxy * k;
    let neg = 0;
    for (let c = 0; c < 8; c++) { cv[c] = val[base + off[c]]; if (cv[c] < 0) neg++; }
    if (neg === 0 || neg === 8) continue;
    let ax = 0, ay = 0, az = 0, n = 0;
    for (const [a, b] of E) {
      if ((cv[a] < 0) === (cv[b] < 0)) continue;
      const t = cv[a] / (cv[a] - cv[b]);
      ax += (a & 1) + (((b & 1) - (a & 1)) * t); ay += ((a >> 1) & 1) + ((((b >> 1) & 1) - ((a >> 1) & 1)) * t); az += ((a >> 2) & 1) + ((((b >> 2) & 1) - ((a >> 2) & 1)) * t);
      n++;
    }
    const p = project(sd, [x0 + (i + ax / n) * s, y0 + (j + ay / n) * s, z0 + (k + az / n) * s], 3);
    const g = sdGrad(sd, p[0], p[1], p[2]);
    cellV[base] = pos.length / 3;
    pos.push(p[0], p[1], p[2]); nrm.push(g[0], g[1], g[2]);
  }
  const idx = [];
  const quad = (a, b, c, d) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    const dAC = (pos[3 * a] - pos[3 * c]) ** 2 + (pos[3 * a + 1] - pos[3 * c + 1]) ** 2 + (pos[3 * a + 2] - pos[3 * c + 2]) ** 2;
    const dBD = (pos[3 * b] - pos[3 * d]) ** 2 + (pos[3 * b + 1] - pos[3 * d + 1]) ** 2 + (pos[3 * b + 2] - pos[3 * d + 2]) ** 2;
    if (dAC < dBD) idx.push(a, b, c, a, c, d); else idx.push(a, b, d, b, c, d);
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const base = i + nx * j + nxy * k, in0 = val[base] < 0;
    if (in0 !== (val[base + 1] < 0)) quad(cellV[base - nx - nxy], cellV[base - nxy], cellV[base], cellV[base - nx]);
    if (in0 !== (val[base + nx] < 0)) quad(cellV[base - 1 - nxy], cellV[base - 1], cellV[base], cellV[base - nxy]);
    if (in0 !== (val[base + nxy] < 0)) quad(cellV[base - 1 - nx], cellV[base - nx], cellV[base], cellV[base - 1]);
  }
  return { pos, nrm, idx };
}

// ── simulation lattice: hex cells, 5 tets each, boundary nodes snapped onto the surface ──
// a node layer lands exactly on the floor (y = 0), so the soles of the feet stay flat
function buildSimMesh(h = 0.115) {
  const sd = animalSD;
  const hh = [h, h * 0.85, h];
  const ext = [[-1.12, 0.82], [-0.48, 0.48]];
  const n = [Math.ceil((ext[0][1] - ext[0][0]) / hh[0]), Math.ceil(1.2 / hh[1]), Math.ceil((ext[1][1] - ext[1][0]) / hh[2])];
  const o = [(ext[0][0] + ext[0][1]) / 2 - n[0] * hh[0] / 2, 0, -n[2] * hh[2] / 2];
  const S = [n[0] + 1, n[1] + 1, n[2] + 1];
  const nodeAt = (i, j, k) => [o[0] + i * hh[0], o[1] + j * hh[1], o[2] + k * hh[2]];
  const hm = Math.min(...hh);
  const keep = new Uint8Array(n[0] * n[1] * n[2]);
  for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) {
    const x = o[0] + (i + 0.5) * hh[0], y = o[1] + (j + 0.5) * hh[1], z = o[2] + (k + 0.5) * hh[2];
    // generous, so the ears and the end of the tail keep a connected run of cells
    if (sd(x, y, z) < 0.4 * hm) keep[i + n[0] * (j + n[1] * k)] = 1;
  }
  const kept = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < n[0] && j < n[1] && k < n[2] && keep[i + n[0] * (j + n[1] * k)] === 1;
  const nodeId = new Int32Array(S[0] * S[1] * S[2]).fill(-1);
  const rest = [], boundary = [];
  const nid = (i, j, k) => {
    const key = i + S[0] * (j + S[1] * k);
    if (nodeId[key] >= 0) return nodeId[key];
    const p = nodeAt(i, j, k);
    nodeId[key] = rest.length / 3;
    rest.push(p[0], p[1], p[2]);
    let all = true;
    for (let a = 0; a < 8; a++) if (!kept(i - 1 + (a & 1), j - 1 + ((a >> 1) & 1), k - 1 + ((a >> 2) & 1))) { all = false; break; }
    boundary.push(all ? 0 : 1);
    return nodeId[key];
  };
  const tets = [];
  const T0 = [[0, 1, 3, 5], [0, 3, 2, 6], [0, 5, 4, 6], [3, 5, 6, 7], [0, 3, 5, 6]];
  const T1 = [[0, 1, 2, 4], [3, 1, 2, 7], [5, 1, 4, 7], [6, 2, 4, 7], [1, 2, 4, 7]];
  for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) {
    if (!kept(i, j, k)) continue;
    const cn = [];
    for (let a = 0; a < 8; a++) cn.push(nid(i + (a & 1), j + ((a >> 1) & 1), k + ((a >> 2) & 1)));
    for (const t of ((i + j + k) & 1 ? T1 : T0)) tets.push(cn[t[0]], cn[t[1]], cn[t[2]], cn[t[3]]);
  }
  const nN = rest.length / 3;
  const R = new Float64Array(rest);
  const volOf = (P, t) => tetVolume(P, tets[4 * t], tets[4 * t + 1], tets[4 * t + 2], tets[4 * t + 3]);
  for (let t = 0; t < tets.length / 4; t++) if (volOf(R, t) < 0) { const q = tets[4 * t + 2]; tets[4 * t + 2] = tets[4 * t + 3]; tets[4 * t + 3] = q; }
  const v0 = hh[0] * hh[1] * hh[2] / 6;
  // snap boundary nodes onto the surface (in or out), then back off wherever that would crush a tet
  const snapped = new Float64Array(nN * 3);
  for (let i = 0; i < nN; i++) {
    const p = [R[3 * i], R[3 * i + 1], R[3 * i + 2]];
    if (boundary[i] && p[1] > 1e-6 && sd(p[0], p[1], p[2]) > -0.95 * hm) project(sd, p, 6);
    if (boundary[i] && p[1] <= 1e-6) {                    // floor nodes slide along the floor only
      // (only where the panda does stand on the floor: under the tail, which hangs just clear of it, such a node
      //  goes up onto the tail's underside instead)
      const q = [p[0], 0.002, p[2]];
      if (animalSD(q[0], q[1], q[2]) < 0.03) { project((x, y, z) => animalSD(x, 0.002, z), q, 6); p[0] = q[0]; p[2] = q[2]; p[1] = 0; }
      else { p[1] = 0.004; project(sd, p, 6); }
    }
    snapped.set(p, 3 * i);
  }
  const P = new Float64Array(snapped);
  const blend = new Float32Array(nN).fill(1);
  for (let pass = 0; pass < 6; pass++) {
    let bad = 0;
    for (let t = 0; t < tets.length / 4; t++) {
      if (volOf(P, t) > 0.12 * v0) continue;
      bad++;
      for (let q = 0; q < 4; q++) {
        const v = tets[4 * t + q];
        if (!boundary[v] || blend[v] <= 0) continue;
        blend[v] = Math.max(0, blend[v] - 0.34);
        for (let k = 0; k < 3; k++) P[3 * v + k] = R[3 * v + k] + (snapped[3 * v + k] - R[3 * v + k]) * blend[v];
      }
    }
    if (!bad) break;
  }
  const keepT = [];
  for (let t = 0; t < tets.length / 4; t++) if (volOf(P, t) > 0.03 * v0) keepT.push(tets[4 * t], tets[4 * t + 1], tets[4 * t + 2], tets[4 * t + 3]);
  // drop nodes no surviving tet uses
  const used = new Int32Array(nN).fill(-1); let nu = 0;
  for (const v of keepT) if (used[v] < 0) used[v] = nu++;
  const restOut = new Float32Array(nu * 3);
  for (let i = 0; i < nN; i++) if (used[i] >= 0) restOut.set([P[3 * i], P[3 * i + 1], P[3 * i + 2]], 3 * used[i]);
  const tetsOut = new Uint32Array(keepT.map(v => used[v]));
  const region = new Uint8Array(nu);
  for (let i = 0; i < nu; i++) region[i] = partOf(restOut[3 * i], restOut[3 * i + 1], restOut[3 * i + 2]);
  return { rest: restOut, tets: tetsOut, region, h: hh };
}

function tetVolume(p, a, b, c, d) {
  const ax = p[3 * a], ay = p[3 * a + 1], az = p[3 * a + 2];
  const b0 = p[3 * b] - ax, b1 = p[3 * b + 1] - ay, b2 = p[3 * b + 2] - az;
  const c0 = p[3 * c] - ax, c1 = p[3 * c + 1] - ay, c2 = p[3 * c + 2] - az;
  const d0 = p[3 * d] - ax, d1 = p[3 * d + 1] - ay, d2 = p[3 * d + 2] - az;
  return (b0 * (c1 * d2 - c2 * d1) - b1 * (c0 * d2 - c2 * d0) + b2 * (c0 * d1 - c1 * d0)) / 6;
}

// a point on the outer surface: out from p along the unit direction d
function surfaceAlong(p, d) {
  let lo = 0, hi = 0.9;
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (animalSD(p[0] + d[0] * m, p[1] + d[1] * m, p[2] + d[2] * m) < 0) lo = m; else hi = m; }
  return [p[0] + d[0] * lo, p[1] + d[1] * lo, p[2] + d[2] * lo];
}

// an eye (z > 0 side; mirrored for the other): a dark bead set into the front of the face, above the muzzle
const EYE = (() => {
  const E = SHAPE.eye, H = SHAPE.head.c;
  const s = surfaceAlong([H[0], H[1], 0], vnorm3(E.dir)), g = sdGrad(animalSD, s[0], s[1], s[2]);
  const w = [g[0], g[1], g[2]];
  const u = vnorm3([1 - w[0] * w[0], -w[0] * w[1], -w[0] * w[2]]);
  const v = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
  const p = [s[0] - w[0] * E.c * 0.35, s[1] - w[1] * E.c * 0.35, s[2] - w[2] * E.c * 0.35];
  return { p, u, v, w };
})();
// the nose: a dark bead on the tip of the muzzle
const NOSE = (() => {
  const Nn = SHAPE.nose, M = SHAPE.muzzle.c;
  const s = surfaceAlong([M[0], M[1], 0], vnorm3(Nn.dir)), g = sdGrad(animalSD, s[0], s[1], s[2]);
  const w = vnorm3([g[0], g[1], 0]), u = [-w[1], w[0], 0], v = [0, 0, 1];
  const p = [s[0] - w[0] * Nn.c * 0.3, s[1] - w[1] * Nn.c * 0.3, 0];
  return { p, u, v, w, s };
})();

// the stomach: places for the berries a panda has eaten, each with a path in rest space from the mouth, down the
// throat and back to its place (the path's points are embedded in the tetrahedra, so a berry rides the jelly)
const SLOTS = 8, KP = 6;
const TUMMY = (() => {
  const R = rng(4242), out = [], M = SHAPE.mouth;
  const ok = p => animalSD(p[0], p[1], p[2]) < -0.075 && coreSD(p[0], p[1], p[2]) > 0.055;
  for (let i = 0; i < SLOTS; i++) {
    const r = 0.04 + 0.01 * R();
    let spot = null;
    for (let k = 0; k < 800 && !spot; k++) {
      const p = [-0.38 + 0.42 * R(), 0.32 + 0.22 * R(), (R() - 0.5) * 0.34];
      if (ok(p) && !out.some(o => Math.hypot(o.spot[0] - p[0], o.spot[1] - p[1], o.spot[2] - p[2]) < o.r + r + 0.008)) spot = p;
    }
    if (!spot) spot = [-0.1, 0.45, 0];
    const mid = [0.32, 0.72, spot[2] * 0.5], path = [];
    for (let k = 0; k < KP; k++) { const t = k / (KP - 1), a = (1 - t) * (1 - t), b = 2 * t * (1 - t), c = t * t; path.push([0, 1, 2].map(d => a * M[d] + b * mid[d] + c * spot[d])); }
    out.push({ spot, path, r });
  }
  return out;
})();
// points that ride the jelly, the same for every panda: the mouth, the stomach, the head, then every berry path
const A_MOUTH = 0, A_TUM = 1, A_HEAD = 2, A_PATH = 3;
const ANCHORS = (() => {
  const out = [SHAPE.mouth, SHAPE.tummy, [0.3, 0.9, 0]];
  for (const K of TUMMY) for (const p of K.path) out.push(p);
  return out;
})();

// ── render mesh ──
// material ids: 0 body (clear jelly), 1 a loose berry, 2 eye, 3 the dark layer, 4 bubble, 5 nose, 6 a berry inside
function meshBuilder() {
  const pos = [], nrm = [], mat = [], ctr = [];
  const add = (x, y, z, m, nx, ny, nz, c = null) => { pos.push(x, y, z); nrm.push(nx, ny, nz); mat.push(m); if (c) ctr.push(c[0], c[1], c[2], c[3]); else ctr.push(0, 0, 0, 0); return pos.length / 3 - 1; };
  // a little ellipsoid of rings × segs, in a frame (u, w, v) about p, semi-axes (a along u, c along w, b along v)
  const ovoid = (idx, p, u, w, v, a, b, c, m, rings, segs, cv) => {
    const base = pos.length / 3;
    const local = (t, ph) => [-Math.cos(t) * a, Math.cos(ph) * Math.sin(t) * c, Math.sin(ph) * Math.sin(t) * b];
    const toW = q => [p[0] + u[0] * q[0] + w[0] * q[1] + v[0] * q[2], p[1] + u[1] * q[0] + w[1] * q[1] + v[1] * q[2], p[2] + u[2] * q[0] + w[2] * q[1] + v[2] * q[2]];
    const vtx = q => {
      const P = toW(q);
      const nq = [q[0] / (a * a), q[1] / (c * c), q[2] / (b * b)], n = toW(nq).map((x, k) => x - p[k]); const l = Math.hypot(n[0], n[1], n[2]) || 1;
      return add(P[0], P[1], P[2], m, n[0] / l, n[1] / l, n[2] / l, cv);
    };
    const top = vtx(local(0, 0));
    for (let i = 1; i < rings; i++) for (let j = 0; j < segs; j++) vtx(local(Math.PI * i / rings, 2 * Math.PI * j / segs + (i & 1) * Math.PI / segs));
    const bot = vtx(local(Math.PI, 0));
    const ring = i => base + 1 + (i - 1) * segs;
    for (let j = 0; j < segs; j++) idx.push(top, ring(1) + j, ring(1) + (j + 1) % segs);
    for (let i = 1; i < rings - 1; i++) for (let j = 0; j < segs; j++) {
      const p0 = ring(i) + j, p1 = ring(i) + (j + 1) % segs, p2 = ring(i + 1) + j, p3 = ring(i + 1) + (j + 1) % segs;
      idx.push(p0, p2, p3, p0, p3, p1);
    }
    for (let j = 0; j < segs; j++) idx.push(ring(rings - 1) + j, bot, ring(rings - 1) + (j + 1) % segs);
    return { v0: base, nv: pos.length / 3 - base };
  };
  return { pos, nrm, mat, ctr, add, ovoid, count: () => pos.length / 3 };
}
// make every triangle's winding agree with its analytic outward normal (CCW = front)
function fixWinding(idx, pos, nrm) {
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b1 = idx[i + 1], c = idx[i + 2];
    const e1 = [pos[3 * b1] - pos[3 * a], pos[3 * b1 + 1] - pos[3 * a + 1], pos[3 * b1 + 2] - pos[3 * a + 2]];
    const e2 = [pos[3 * c] - pos[3 * a], pos[3 * c + 1] - pos[3 * a + 1], pos[3 * c + 2] - pos[3 * a + 2]];
    const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    let d = 0;
    for (const v of [a, b1, c]) d += fn[0] * nrm[3 * v] + fn[1] * nrm[3 * v + 1] + fn[2] * nrm[3 * v + 2];
    if (d < 0) { idx[i + 1] = c; idx[i + 2] = b1; }
  }
}

// one panda: the clear jelly, the dark layer, the eyes and nose, the bubbles, and the places for berries
function buildAnimalMesh() {
  const M = meshBuilder(), E = SHAPE.eye, Nn = SHAPE.nose, X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  const nets = surfaceNets(animalSD, [-1.1, -0.02, -0.44, 0.7, 1.2, 0.44], 0.025);
  for (let v = 0; v < nets.pos.length / 3; v++) M.add(nets.pos[3 * v], nets.pos[3 * v + 1], nets.pos[3 * v + 2], 0, nets.nrm[3 * v], nets.nrm[3 * v + 1], nets.nrm[3 * v + 2]);
  const body = nets.idx.slice(), bodyVerts = M.count();

  // ── the dark layer: its own surface, under the skin ──
  const cn = surfaceNets(coreSD, [-0.5, -0.02, -0.34, 0.44, 0.36, 0.34], 0.024);
  for (let v = 0; v < cn.pos.length / 3; v++) M.add(cn.pos[3 * v], cn.pos[3 * v + 1], cn.pos[3 * v + 2], 3, cn.nrm[3 * v], cn.nrm[3 * v + 1], cn.nrm[3 * v + 2]);
  const core = cn.idx.map(i => i + bodyVerts);

  const misc = [];
  // ── the eyes and the nose ──
  for (const sgn of [1, -1]) {
    const m = q => [q[0], q[1], q[2] * sgn];
    M.ovoid(misc, m(EYE.p), m(EYE.u), m(EYE.w), m(EYE.v), E.a, E.a * 0.9, E.c, 2, 8, 14, [...m(EYE.p), E.a]);
  }
  M.ovoid(misc, NOSE.p, NOSE.u, NOSE.w, NOSE.v, Nn.a, Nn.b, Nn.c, 5, 7, 12, [...NOSE.p, Nn.b]);

  // ── bubbles trapped in the clear jelly as it set (most of them small), kept out of the face and the stomach ──
  const R = rng(5858), bubbles = [];
  let tries = 0;
  while (bubbles.length < 12 && tries++ < 20000) {
    const x = -1.0 + R() * 1.7, y = 0.1 + R() * 0.7, z = (R() - 0.5) * 0.6;
    const r = 0.008 + 0.018 * Math.pow(R(), 2.2);
    if (animalSD(x, y, z) > -(0.035 + r) || y < darkY(x) + 0.03 + r) continue;
    if (x > 0.4 && y > 0.6) continue;
    if (TUMMY.some(K => Math.hypot(K.spot[0] - x, K.spot[1] - y, K.spot[2] - z) < K.r + r + 0.03)) continue;
    if (bubbles.some(b => Math.hypot(b[0] - x, b[1] - y, b[2] - z) < b[3] + r + 0.02)) continue;
    bubbles.push([x, y, z, r]);
  }
  for (const b of bubbles) M.ovoid(misc, [b[0], b[1], b[2]], X, Y, Z, b[3], b[3], b[3] * 0.92, 4, b[3] > 0.015 ? 5 : 4, b[3] > 0.015 ? 9 : 6, b);
  const fixedVerts = M.count();

  // ── the berries inside: hidden until one is eaten, then carried along its path ──
  const tummy = [];
  for (const K of TUMMY) {
    const c = K.path[0], o = M.ovoid(misc, c, X, Y, Z, K.r, K.r, K.r * 0.94, 6, 5, 8, [c[0], c[1], c[2], K.r]);
    tummy.push({ p: c.slice(), r: K.r, v0: o.v0, nv: o.nv });
  }
  for (const I of [body, core, misc]) fixWinding(I, M.pos, M.nrm);
  return { pos: M.pos, nrm: M.nrm, mat: M.mat, ctr: M.ctr, body, core, misc, bodyVerts, fixedVerts, nV: M.count(), tummy, bubbleCount: bubbles.length };
}

// the whole table: N copies of the panda, then a pool of loose berries. Vertices run panda by panda; triangles run
// [every body | every dark layer | everything else | the berries], so each kind is one draw range.
const BERRY_POOL = 30;
function buildScene(N) {
  const P = buildAnimalMesh(), nV1 = P.nV;
  const D = meshBuilder(), dIdx = [], drops = [], RD = rng(77), home = [0, -4, 0];
  for (let i = 0; i < BERRY_POOL; i++) {
    const r = 0.05 + 0.014 * RD();
    const o = D.ovoid(dIdx, home, [1, 0, 0], [0, 1, 0], [0, 0, 1], r, r * 0.96, r * 0.93, 1, 6, 10, [0, 0, 0, r]);
    drops.push({ p: home.slice(), r, v0: N * nV1 + o.v0, nv: o.nv });
  }
  fixWinding(dIdx, D.pos, D.nrm);
  const nV = N * nV1 + D.count();
  const rest = new Float32Array(nV * 3), mat = new Float32Array(nV), ctr = new Float32Array(nV * 4), inst = new Float32Array(nV);
  for (let b = 0; b < N; b++) { rest.set(P.pos, 3 * b * nV1); mat.set(P.mat, b * nV1); ctr.set(P.ctr, 4 * b * nV1); inst.fill(b, b * nV1, (b + 1) * nV1); }
  rest.set(D.pos, 3 * N * nV1); mat.set(D.mat, N * nV1); ctr.set(D.ctr, 4 * N * nV1);
  const index = new Uint32Array(N * (P.body.length + P.core.length + P.misc.length) + dIdx.length);
  let o = 0;
  for (const seg of [P.body, P.core, P.misc]) for (let b = 0; b < N; b++) { const base = b * nV1; for (let k = 0; k < seg.length; k++) index[o++] = seg[k] + base; }
  for (let k = 0; k < dIdx.length; k++) index[o++] = dIdx[k] + N * nV1;
  const nb = N * P.body.length, nc = N * P.core.length;
  return {
    rest, mat, ctr, inst, index, N, nV1, animal: P, drops, home,
    body: { first: 0, count: nb }, core: { first: nb, count: nc }, props: { first: nb, count: index.length - nb },
  };
}

// ── barycentric embedding of points into tets (nearest tet when a point lies outside) ──
// `skip` = [first, count] of vertices to leave out
function embed(simRest, tets, verts, skip = [0, 0]) {
  const nT = tets.length / 4, nV = verts.length / 3;
  const cell = 0.25;
  const grid = new Map();
  const key = (i, j, k) => (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512);
  const inv = new Float64Array(nT * 9);
  for (let t = 0; t < nT; t++) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    const id = [tets[4 * t], tets[4 * t + 1], tets[4 * t + 2], tets[4 * t + 3]];
    for (const v of id) for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], simRest[3 * v + c]); mx[c] = Math.max(mx[c], simRest[3 * v + c]); }
    for (let i = Math.floor(mn[0] / cell); i <= Math.floor(mx[0] / cell); i++)
      for (let j = Math.floor(mn[1] / cell); j <= Math.floor(mx[1] / cell); j++)
        for (let k = Math.floor(mn[2] / cell); k <= Math.floor(mx[2] / cell); k++) {
          const K = key(i, j, k); let l = grid.get(K); if (!l) grid.set(K, l = []); l.push(t);
        }
    const a = id[0], m = [];
    for (let c = 1; c < 4; c++) for (let r = 0; r < 3; r++) m.push(simRest[3 * id[c] + r] - simRest[3 * a + r]);
    const M = [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
    const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
    const id2 = 1 / det;
    inv[9 * t + 0] = (M[4] * M[8] - M[5] * M[7]) * id2; inv[9 * t + 1] = (M[2] * M[7] - M[1] * M[8]) * id2; inv[9 * t + 2] = (M[1] * M[5] - M[2] * M[4]) * id2;
    inv[9 * t + 3] = (M[5] * M[6] - M[3] * M[8]) * id2; inv[9 * t + 4] = (M[0] * M[8] - M[2] * M[6]) * id2; inv[9 * t + 5] = (M[2] * M[3] - M[0] * M[5]) * id2;
    inv[9 * t + 6] = (M[3] * M[7] - M[4] * M[6]) * id2; inv[9 * t + 7] = (M[1] * M[6] - M[0] * M[7]) * id2; inv[9 * t + 8] = (M[0] * M[4] - M[1] * M[3]) * id2;
  }
  const tetOf = new Uint32Array(nV);
  const w = new Float32Array(nV * 4);
  for (let v = 0; v < nV; v++) {
    if (v >= skip[0] && v < skip[0] + skip[1]) continue;
    const x = verts[3 * v], y = verts[3 * v + 1], z = verts[3 * v + 2];
    let best = -1, bestScore = -Infinity, b0 = 0, b1 = 0, b2 = 0, b3 = 0;
    const tryT = t => {
      const a = tets[4 * t];
      const dx = x - simRest[3 * a], dy = y - simRest[3 * a + 1], dz = z - simRest[3 * a + 2], I = 9 * t;
      const q1 = inv[I] * dx + inv[I + 1] * dy + inv[I + 2] * dz;
      const q2 = inv[I + 3] * dx + inv[I + 4] * dy + inv[I + 5] * dz;
      const q3 = inv[I + 6] * dx + inv[I + 7] * dy + inv[I + 8] * dz;
      const q0 = 1 - q1 - q2 - q3;
      const s = Math.min(q0, q1, q2, q3);
      if (s > bestScore) { bestScore = s; best = t; b0 = q0; b1 = q1; b2 = q2; b3 = q3; }
    };
    const ci = Math.floor(x / cell), cj = Math.floor(y / cell), ck = Math.floor(z / cell);
    for (let r = 0; r <= 4; r++) {
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) for (let k = ck - r; k <= ck + r; k++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj), Math.abs(k - ck)) !== r) continue;
        const l = grid.get(key(i, j, k)); if (l) for (const t of l) tryT(t);
      }
      if (bestScore >= -1e-4 || (r >= 1 && best >= 0 && bestScore > -0.45)) break;
    }
    if (best < 0) for (let t = 0; t < nT; t++) tryT(t);
    tetOf[v] = best; w[4 * v] = b0; w[4 * v + 1] = b1; w[4 * v + 2] = b2; w[4 * v + 3] = b3;
  }
  return { tetOf, w };
}
