// ===== physics.js =====
// ─────────────────────────────────────────────────────────────
//  XPBD tetrahedral soft bodies: several bunnies in one solver, each with firm
//  ears and legs and a firm skin round a soft, wobbling body
//  · co-rotational tet constraints → elasticity (each tet pulled toward its
//                                    best-fit rotated rest shape; recovers inversions)
//  · tet volume constraints        → near-incompressibility
//  · soft grab attachment, ground contact with friction
//  · the lattice nodes of different bunnies push each other apart (they bump, lean and pile up)
//  · a rest shape that can be re-posed (standing up), and a soft pull toward that pose above the hind feet
//  · relative-velocity damping along edges (internal viscosity)
//  Fixed step, fixed substeps, "small steps" XPBD (1 iteration / substep).
// ─────────────────────────────────────────────────────────────

// compliance multipliers per region (0 dark layer, 1 clear jelly, 2 skin, 3 ears and legs, 4 tail): smaller is firmer
const FIRM_OF = [0.3, 0.42, 0.2, 0.07, 0.14];
const VOLK_OF = [2, 2.6, 1.4, 1, 1.2];

// the rotation nearest to a covariance f (row-major 3×3), from a warm start q (Müller et al. 2016): q is updated
// in place and the rotation written to R (row-major)
function fitRotation(f, q, R, iters) {
  let qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  let r00, r01, r02, r10, r11, r12, r20, r21, r22;
  for (let it = 0; it <= iters; it++) {
    r00 = 1 - 2 * (qy * qy + qz * qz); r01 = 2 * (qx * qy - qw * qz); r02 = 2 * (qx * qz + qw * qy);
    r10 = 2 * (qx * qy + qw * qz); r11 = 1 - 2 * (qx * qx + qz * qz); r12 = 2 * (qy * qz - qw * qx);
    r20 = 2 * (qx * qz - qw * qy); r21 = 2 * (qy * qz + qw * qx); r22 = 1 - 2 * (qx * qx + qy * qy);
    if (it === iters) break;
    const ox = (r10 * f[6] - r20 * f[3]) + (r11 * f[7] - r21 * f[4]) + (r12 * f[8] - r22 * f[5]);
    const oy = (r20 * f[0] - r00 * f[6]) + (r21 * f[1] - r01 * f[7]) + (r22 * f[2] - r02 * f[8]);
    const oz = (r00 * f[3] - r10 * f[0]) + (r01 * f[4] - r11 * f[1]) + (r02 * f[5] - r12 * f[2]);
    const den = Math.abs(r00 * f[0] + r10 * f[3] + r20 * f[6] + r01 * f[1] + r11 * f[4] + r21 * f[7] + r02 * f[2] + r12 * f[5] + r22 * f[8]) + 1e-12;
    const wx = ox / den, wy = oy / den, wz = oz / den;
    const w = Math.sqrt(wx * wx + wy * wy + wz * wz);
    if (w < 1e-7) continue;
    const sc = w > 1 ? 0.5 / w : 0.5, ax = wx * sc, ay = wy * sc, az = wz * sc;
    const nx = qx + ax * qw + ay * qz - az * qy;
    const ny = qy - ax * qz + ay * qw + az * qx;
    const nz = qz + ax * qy - ay * qx + az * qw;
    const nw = qw - ax * qx - ay * qy - az * qz;
    const nl = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
    qx = nx * nl; qy = ny * nl; qz = nz * nl; qw = nw * nl;
  }
  q[0] = qx; q[1] = qy; q[2] = qz; q[3] = qw;
  R[0] = r00; R[1] = r01; R[2] = r02; R[3] = r10; R[4] = r11; R[5] = r12; R[6] = r20; R[7] = r21; R[8] = r22;
}

class SoftBody {
  // mesh: one bunny (rest positions, tets, regions) · insts: where each copy stands, [{ scale, x, z, yaw }]
  constructor(mesh, insts, opts = {}) {
    const n1 = mesh.rest.length / 3, nT1 = mesh.tets.length / 4, N = insts.length;
    const n = n1 * N, nT = nT1 * N;
    this.N = N; this.n1 = n1; this.nT1 = nT1; this.n = n; this.nT = nT;
    this.tets = new Uint32Array(nT * 4);
    this.rest0 = new Float32Array(n * 3);     // the bunny's own rest coordinates (the same for every copy)
    this.shape = new Float32Array(n * 3);     // the shape each copy is pulled toward now: posed, and at its own scale
    this.x = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    this.invMass = new Float32Array(n);
    this.mass = new Float32Array(n);
    this.restVol = new Float32Array(nT);
    this.region = new Uint8Array(n);
    this.bodyOf = new Uint8Array(n);
    this.rad = new Float32Array(n);
    this.density = 1.0;
    this.bodies = insts.map((I, b) => ({
      b, p0: b * n1, t0: b * nT1, scale: I.scale, home: [I.x, I.z], yaw: I.yaw,
      q: new Float32Array([0, 0, 0, 1]), R: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), c: [0, 0, 0], vc: [0, 0, 0],
      lo: [0, 0, 0], hi: [0, 0, 0], speed: 0, mass: 0, poseA: 0, poseWave: 0, poseK: 0,
    }));
    for (const B of this.bodies) {
      const s = B.scale;
      this.rest0.set(mesh.rest, 3 * B.p0);
      this.region.set(mesh.region, B.p0);
      for (let i = B.p0; i < B.p0 + n1; i++) { this.bodyOf[i] = B.b; this.rad[i] = 0.4 * mesh.h[0] * s; }
      for (let k = 0; k < 3 * n1; k++) this.shape[3 * B.p0 + k] = mesh.rest[k] * s;
      for (let k = 0; k < 4 * nT1; k++) this.tets[4 * B.t0 + k] = mesh.tets[k] + B.p0;
    }
    const tets = this.tets;

    // masses from rest volumes
    let vol = 0;
    for (let t = 0; t < nT; t++) {
      const v = this.tetVol(this.shape, t);
      this.restVol[t] = v; vol += v;
      for (let k = 0; k < 4; k++) this.mass[tets[4 * t + k]] += v * this.density / 4;
    }
    this.totalRestVolume = vol;
    this.totalMass = 0;
    for (let i = 0; i < n; i++) { this.invMass[i] = 1 / this.mass[i]; this.totalMass += this.mass[i]; this.bodies[this.bodyOf[i]].mass += this.mass[i]; }

    // the unique edges of one bunny (shuffled a little: reduces Gauss–Seidel directional bias), copied for the others
    const set = new Map(), pairs = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
    for (let t = 0; t < nT1; t++) for (const [a, b] of pairs) {
      let i = mesh.tets[4 * t + a], j = mesh.tets[4 * t + b];
      if (i > j) [i, j] = [j, i];
      set.set(i * 65536 + j, [i, j]);
    }
    const e1 = [...set.values()];
    for (let k = e1.length - 1; k > 0; k--) { const r = (k * 2654435761) % (k + 1), q = e1[k]; e1[k] = e1[r]; e1[r] = q; }
    this.nE = e1.length * N;
    this.edges = new Uint32Array(this.nE * 2);
    for (let b = 0, e = 0; b < N; b++) for (const [i, j] of e1) { this.edges[2 * e] = i + b * n1; this.edges[2 * e + 1] = j + b * n1; e++; }

    // co-rotational tet elasticity: rest shape about the tet's centroid, warm-started rotation
    this.tetQ = new Float32Array(nT * 12);
    this.tetRot = new Float32Array(nT * 4);     // quaternion (x, y, z, w)
    this.tetFirm = new Float32Array(nT);
    this.tetVolK = new Float32Array(nT);
    for (let t = 0; t < nT; t++) {
      // ears and legs are firmest (so the legs carry the body rather than buckle), then the tail and the skin;
      // the clear jelly is the softest, and the dark layer, set a little firmer, sits in between
      let fc = 0, vk = 0;
      for (let k = 0; k < 4; k++) { const r = this.region[tets[4 * t + k]]; fc += FIRM_OF[r] / 4; vk += VOLK_OF[r] / 4; }
      this.tetFirm[t] = fc; this.tetVolK[t] = vk; this.tetRot[4 * t + 3] = 1;
    }
    for (let b = 0; b < N; b++) this.setShape(b);

    // by rest position, the same for every bunny: the soles of the feet, the two hind thumper feet, how far forward a
    // node is (the front leaves the table first in a hop), how much it belongs to the cottontail and to the head
    const G = { floor: [], hindL: [], hindR: [] };
    this.xi = new Float32Array(n1); this.tailW = new Float32Array(n1); this.headW = new Float32Array(n1);
    let fx = 0, fy = 0, fn = 0;
    for (let i = 0; i < n1; i++) {
      const x = mesh.rest[3 * i], y = mesh.rest[3 * i + 1], z = mesh.rest[3 * i + 2];
      if (y < 0.004) G.floor.push(i);
      if (y < 0.13 && x > -0.48 && x < -0.02 && Math.abs(z) > 0.04) { (z > 0 ? G.hindR : G.hindL).push(i); fx += x; fy += y; fn++; }
      this.xi[i] = Math.max(-1, Math.min(1, (x + 0.04) / 0.52));
      this.tailW[i] = sstep(-0.40, -0.68, x);
      this.headW[i] = sstep(0.14, 0.42, x) * sstep(0.25, 0.42, y);
    }
    this.groups = G;
    this.feet0 = [fx / Math.max(1, fn), fy / Math.max(1, fn)];

    // parameters (tuned in sim units: metres-ish, seconds)
    this.gravity = -9.81;
    this.firmness = opts.firmness ?? 0.5;   // 0..1 UI value
    this.damping = opts.damping ?? 0.45;    // 0..1 UI value
    this.substeps = 10;
    this.stepDt = 1 / 60;
    this.friction = 0.55;
    this.floorY = 0;
    this.maxSpeed = 12;
    this.poseGain = 0.005;                  // per substep: how hard a standing bunny is held to its pose

    // grab state
    this.grabIdx = new Int32Array(n);
    this.grabW = new Float32Array(n);
    this.grabOff = new Float32Array(n * 3);
    this.grabN = 0;
    this.grabTarget = new Float32Array(3);
    this.grabRot = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    this.grabbing = false;
    this.grabBody = -1;

    this.pairs = [];
    this.time = 0;
    this.reset(0);
  }

  tetVol(p, t) {
    const T = this.tets;
    const a = T[4 * t], b = T[4 * t + 1], c = T[4 * t + 2], d = T[4 * t + 3];
    const ax = p[3 * a], ay = p[3 * a + 1], az = p[3 * a + 2];
    const b0 = p[3 * b] - ax, b1 = p[3 * b + 1] - ay, b2 = p[3 * b + 2] - az;
    const c0 = p[3 * c] - ax, c1 = p[3 * c + 1] - ay, c2 = p[3 * c + 2] - az;
    const d0 = p[3 * d] - ax, d1 = p[3 * d + 1] - ay, d2 = p[3 * d + 2] - az;
    return (b0 * (c1 * d2 - c2 * d1) - b1 * (c0 * d2 - c2 * d0) + b2 * (c0 * d1 - c1 * d0)) / 6;
  }

  // tetrahedra of bunny b take their rest shape and rest volume from `shape` (after it is posed)
  setShape(b) {
    const B = this.bodies[b], { tets, mass, tetQ, restVol, shape: S } = this;
    let dv = 0;
    for (let t = B.t0; t < B.t0 + this.nT1; t++) {
      let M = 0, cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 4; k++) { const v = tets[4 * t + k], m = mass[v]; M += m; cx += S[3 * v] * m; cy += S[3 * v + 1] * m; cz += S[3 * v + 2] * m; }
      cx /= M; cy /= M; cz /= M;
      for (let k = 0; k < 4; k++) { const v = 3 * tets[4 * t + k]; tetQ[12 * t + 3 * k] = S[v] - cx; tetQ[12 * t + 3 * k + 1] = S[v + 1] - cy; tetQ[12 * t + 3 * k + 2] = S[v + 2] - cz; }
      const V = this.tetVol(S, t);
      dv += V - restVol[t]; restVol[t] = V;
    }
    this.totalRestVolume += dv;
  }
  // pose bunny b: a = 0 on all fours … 1 standing; wave = the forepaws paddling
  pose(b, a, wave) {
    const B = this.bodies[b];
    if (Math.abs(a - B.poseA) < 1e-4 && Math.abs(wave - B.poseWave) < 1e-3) return;
    B.poseA = a; B.poseWave = wave;
    const s = B.scale, R0 = this.rest0, S = this.shape, o = [0, 0, 0];
    for (let i = B.p0; i < B.p0 + this.n1; i++) {
      posePoint(R0[3 * i], R0[3 * i + 1], R0[3 * i + 2], a, wave, o);
      S[3 * i] = o[0] * s; S[3 * i + 1] = o[1] * s; S[3 * i + 2] = o[2] * s;
    }
    this.setShape(b);
  }

  // put bunny b down at `at` (x, z) facing `yaw`, `drop` above the table, on all fours and at rest
  place(b, drop = 0.35, at = null, yaw = null) {
    const B = this.bodies[b];
    if (B.poseA !== 0 || B.poseWave !== 0) this.pose(b, 0, 0);
    B.poseK = 0;
    const psi = yaw ?? B.yaw, ox = (at ?? B.home)[0], oz = (at ?? B.home)[1], c = Math.cos(psi), s = Math.sin(psi), S = this.shape;
    for (let i = B.p0; i < B.p0 + this.n1; i++) {
      const lx = S[3 * i], ly = S[3 * i + 1], lz = S[3 * i + 2];
      this.x[3 * i] = ox + lx * c + lz * s;
      this.x[3 * i + 1] = ly + drop;
      this.x[3 * i + 2] = oz - lx * s + lz * c;
      this.prev[3 * i] = this.x[3 * i]; this.prev[3 * i + 1] = this.x[3 * i + 1]; this.prev[3 * i + 2] = this.x[3 * i + 2];
      this.v[3 * i] = 0; this.v[3 * i + 1] = 0; this.v[3 * i + 2] = 0;
    }
    const qy = Math.sin(psi / 2), qw = Math.cos(psi / 2);
    for (let t = B.t0; t < B.t0 + this.nT1; t++) { this.tetRot[4 * t] = 0; this.tetRot[4 * t + 1] = qy; this.tetRot[4 * t + 2] = 0; this.tetRot[4 * t + 3] = qw; }
    B.q[0] = 0; B.q[1] = qy; B.q[2] = 0; B.q[3] = qw;
    this.frame(b);
  }
  reset(drop = 0.35) {
    this.endGrab();
    for (let b = 0; b < this.N; b++) this.place(b, drop > 0 ? drop + 0.12 * b : 0);
    this.bounds();
  }

  // stiffness mapping: firmness 0..1 → edge compliance (log scale)
  shapeCompliance() { return Math.exp(Math.log(3.0) + (Math.log(0.05) - Math.log(3.0)) * this.firmness); }
  volCompliance() { return 1e-4 * (1 - 0.7 * this.firmness); }
  // damping 0..1 → rate (1/s) of relative-velocity decay along edges
  dampRate() { return 2 + 40 * this.damping * this.damping; }

  centroid() {
    let x = 0, y = 0, z = 0, m = 0;
    for (let i = 0; i < this.n; i++) {
      const w = this.mass[i]; m += w;
      x += this.x[3 * i] * w; y += this.x[3 * i + 1] * w; z += this.x[3 * i + 2] * w;
    }
    return [x / m, y / m, z / m];
  }

  // ── what a bunny knows of itself ──
  // its middle, how fast that is moving, and the rotation that best carries its (posed) rest shape onto its
  // particles: R's first column is the way it faces, its second the way its back points
  frame(b) {
    const B = this.bodies[b], { x, v, mass, shape: S } = this, i0 = B.p0, i1 = i0 + this.n1;
    let M = 0, cx = 0, cy = 0, cz = 0, sx = 0, sy = 0, sz = 0, vx = 0, vy = 0, vz = 0;
    for (let i = i0; i < i1; i++) {
      const m = mass[i], k = 3 * i; M += m;
      cx += x[k] * m; cy += x[k + 1] * m; cz += x[k + 2] * m;
      sx += S[k] * m; sy += S[k + 1] * m; sz += S[k + 2] * m;
      vx += v[k] * m; vy += v[k + 1] * m; vz += v[k + 2] * m;
    }
    cx /= M; cy /= M; cz /= M; sx /= M; sy /= M; sz /= M;
    B.c[0] = cx; B.c[1] = cy; B.c[2] = cz;
    B.vc[0] = vx / M; B.vc[1] = vy / M; B.vc[2] = vz / M;
    B.speed = Math.hypot(B.vc[0], B.vc[1], B.vc[2]);
    const f = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = i0; i < i1; i++) {
      const m = mass[i], k = 3 * i;
      const px = (x[k] - cx) * m, py = (x[k + 1] - cy) * m, pz = (x[k + 2] - cz) * m;
      const q0 = S[k] - sx, q1 = S[k + 1] - sy, q2 = S[k + 2] - sz;
      f[0] += px * q0; f[1] += px * q1; f[2] += px * q2; f[3] += py * q0; f[4] += py * q1; f[5] += py * q2; f[6] += pz * q0; f[7] += pz * q1; f[8] += pz * q2;
    }
    fitRotation(f, B.q, B.R, 6);
  }
  // the box round each bunny
  bounds() {
    const x = this.x;
    for (const B of this.bodies) {
      const lo = B.lo, hi = B.hi;
      lo[0] = lo[1] = lo[2] = 1e9; hi[0] = hi[1] = hi[2] = -1e9;
      for (let k = 3 * B.p0; k < 3 * (B.p0 + this.n1); k += 3) for (let d = 0; d < 3; d++) { const q = x[k + d]; if (q < lo[d]) lo[d] = q; if (q > hi[d]) hi[d] = q; }
    }
  }
  // how much of its soles is on the table (0 … 1)
  grounded(b) {
    const G = this.groups.floor, p0 = this.bodies[b].p0, x = this.x;
    let k = 0;
    for (const i of G) if (x[3 * (p0 + i) + 1] < 0.02) k++;
    return k / Math.max(1, G.length);
  }

  // ── pushes: all a jelly bunny has for muscles ──
  // every particle of bunny b gets v += lin + ang × (x − c), and `lift` more upward speed the further forward it is
  kick(b, lin, ang, lift = 0) {
    const B = this.bodies[b], { x, v, xi } = this, c = B.c;
    for (let i = 0; i < this.n1; i++) {
      const k = 3 * (B.p0 + i), rx = x[k] - c[0], ry = x[k + 1] - c[1], rz = x[k + 2] - c[2];
      v[k] += lin[0] + ang[1] * rz - ang[2] * ry;
      v[k + 1] += lin[1] + ang[2] * rx - ang[0] * rz + lift * xi[i];
      v[k + 2] += lin[2] + ang[0] * ry - ang[1] * rx;
    }
  }
  // a sideways push on the tail (dv > 0 toward the bunny's own +z side)
  wag(b, dv) {
    const B = this.bodies[b], { v, tailW } = this, R = B.R;
    for (let i = 0; i < this.n1; i++) {
      const w = tailW[i] * dv; if (w === 0) continue;
      const k = 3 * (B.p0 + i);
      v[k] += R[2] * w; v[k + 1] += R[5] * w; v[k + 2] += R[8] * w;
    }
  }
  // a dip of the head
  nod(b, dv) {
    const B = this.bodies[b], { v, headW } = this;
    for (let i = 0; i < this.n1; i++) v[3 * (B.p0 + i) + 1] -= headW[i] * dv;
  }

  // ── grabbing (one bunny at a time: `body`, or whichever the nearest particle belongs to) ──
  beginGrab(hit, radius = 0.4, body = -1) {
    this.grabN = 0;
    let nearest = -1, nd = Infinity;
    for (let i = 0; i < this.n; i++) {
      if (body >= 0 && this.bodyOf[i] !== body) continue;
      const d = Math.hypot(this.x[3 * i] - hit[0], this.x[3 * i + 1] - hit[1], this.x[3 * i + 2] - hit[2]);
      if (d < nd) { nd = d; nearest = i; }
    }
    if (nearest < 0) return;
    const who = this.bodyOf[nearest], B = this.bodies[who];
    for (let i = B.p0; i < B.p0 + this.n1; i++) {
      const dx = this.x[3 * i] - hit[0], dy = this.x[3 * i + 1] - hit[1], dz = this.x[3 * i + 2] - hit[2];
      const d = Math.hypot(dx, dy, dz);
      if (d < radius) {
        const f = 1 - d / radius;
        const k = this.grabN++;
        this.grabIdx[k] = i; this.grabW[k] = f * f * (3 - 2 * f);
        this.grabOff[3 * k] = dx; this.grabOff[3 * k + 1] = dy; this.grabOff[3 * k + 2] = dz;
      }
    }
    if (this.grabN === 0) {
      this.grabIdx[0] = nearest; this.grabW[0] = 1;
      this.grabOff[0] = this.x[3 * nearest] - hit[0]; this.grabOff[1] = this.x[3 * nearest + 1] - hit[1]; this.grabOff[2] = this.x[3 * nearest + 2] - hit[2];
      this.grabN = 1;
    }
    this.grabTarget.set(hit);
    this.grabStart = Float32Array.from(hit);
    this.grabRot.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    this.grabbing = true;
    this.grabBody = who;
  }
  moveGrab(target, rot) {
    this.grabTarget.set(target);
    // bounded reach: a strong stretch, never an unbounded one
    const dx = target[0] - this.grabStart[0], dy = target[1] - this.grabStart[1], dz = target[2] - this.grabStart[2];
    const d = Math.hypot(dx, dy, dz), maxReach = 2.2;
    if (d > maxReach) { const k = maxReach / d; this.grabTarget[0] = this.grabStart[0] + dx * k; this.grabTarget[1] = this.grabStart[1] + dy * k; this.grabTarget[2] = this.grabStart[2] + dz * k; }
    if (rot) this.grabRot.set(rot);
    // never drive the held patch into the floor: lift the whole patch instead of crushing it
    const R = this.grabRot;
    let lowest = Infinity;
    for (let k = 0; k < this.grabN; k++) lowest = Math.min(lowest, R[3] * this.grabOff[3 * k] + R[4] * this.grabOff[3 * k + 1] + R[5] * this.grabOff[3 * k + 2]);
    if (Number.isFinite(lowest)) this.grabTarget[1] = Math.max(this.grabTarget[1], this.floorY + 0.004 - lowest);
  }
  endGrab() { this.grabbing = false; this.grabN = 0; this.grabBody = -1; }

  // ── bunnies against each other: pairs of lattice nodes from different bunnies that are near enough to touch ──
  buildContacts() {
    const P = this.pairs, x = this.x, rad = this.rad, n1 = this.n1;
    P.length = 0;
    for (let a = 0; a < this.N; a++) for (let b = a + 1; b < this.N; b++) {
      const A = this.bodies[a], B = this.bodies[b], lo = [0, 0, 0], hi = [0, 0, 0];
      let apart = false;
      for (let d = 0; d < 3; d++) { lo[d] = Math.max(A.lo[d], B.lo[d]) - 0.12; hi[d] = Math.min(A.hi[d], B.hi[d]) + 0.12; if (lo[d] > hi[d]) apart = true; }
      if (apart) continue;
      const la = [], lb = [];
      for (const [Q, l] of [[A, la], [B, lb]]) for (let i = Q.p0; i < Q.p0 + n1; i++) {
        const k = 3 * i;
        if (x[k] > lo[0] && x[k] < hi[0] && x[k + 1] > lo[1] && x[k + 1] < hi[1] && x[k + 2] > lo[2] && x[k + 2] < hi[2]) l.push(i);
      }
      for (const i of la) for (const j of lb) {
        const dx = x[3 * j] - x[3 * i], dy = x[3 * j + 1] - x[3 * i + 1], dz = x[3 * j + 2] - x[3 * i + 2], rs = rad[i] + rad[j] + 0.05;
        if (dx * dx + dy * dy + dz * dz < rs * rs) P.push(i, j);
      }
    }
  }
  solveContacts() {
    const P = this.pairs, { x, rad, invMass } = this;
    for (let k = 0; k < P.length; k += 2) {
      const i = P[k], j = P[k + 1], I = 3 * i, J = 3 * j;
      const dx = x[J] - x[I], dy = x[J + 1] - x[I + 1], dz = x[J + 2] - x[I + 2], rs = rad[i] + rad[j];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= rs * rs || d2 < 1e-12) continue;
      // a soft push, a third of the overlap each substep: jelly on jelly gives before it shoves
      const d = Math.sqrt(d2), wi = invMass[i], wj = invMass[j], s = 0.35 * (rs - d) / (d * (wi + wj));
      x[I] -= dx * s * wi; x[I + 1] -= dy * s * wi; x[I + 2] -= dz * s * wi;
      x[J] += dx * s * wj; x[J + 1] += dy * s * wj; x[J + 2] += dz * s * wj;
    }
  }

  // a standing bunny: every node is drawn a little toward its place in the pose, set upright over the hind feet and
  // turned the way those feet face. This is what holds it up; the tetrahedra, re-posed, do the bending.
  solvePose(B) {
    const { x, shape: S, groups: G } = this, p0 = B.p0;
    let lx = 0, lz = 0, rx = 0, rz = 0;
    for (const i of G.hindL) { lx += x[3 * (p0 + i)]; lz += x[3 * (p0 + i) + 2]; }
    for (const i of G.hindR) { rx += x[3 * (p0 + i)]; rz += x[3 * (p0 + i) + 2]; }
    lx /= G.hindL.length; lz /= G.hindL.length; rx /= G.hindR.length; rz /= G.hindR.length;
    let zx = rx - lx, zz = rz - lz; const zl = Math.hypot(zx, zz);
    if (zl < 1e-4) return;
    zx /= zl; zz /= zl;
    const fx = zz, fz = -zx;                                    // forward = up × (left → right)
    // where the hind feet are in the pose itself (it moves them a little)
    let f0x = 0;
    for (const i of G.hindL) f0x += S[3 * (p0 + i)];
    for (const i of G.hindR) f0x += S[3 * (p0 + i)];
    f0x /= G.hindL.length + G.hindR.length;
    const Fx = (lx + rx) / 2, Fz = (lz + rz) / 2, k = this.poseGain * B.poseK;
    for (let i = p0; i < p0 + this.n1; i++) {
      const q = 3 * i, ax = S[q] - f0x, ay = S[q + 1], az = S[q + 2];
      x[q] += (Fx + fx * ax + zx * az - x[q]) * k;
      x[q + 1] += (ay - x[q + 1]) * k;
      x[q + 2] += (Fz + fz * ax + zz * az - x[q + 2]) * k;
    }
  }

  // Each tetrahedron's rotation is tracked from one substep to the next, and trails a turning body by a hair; pulling
  // the tets toward those trailing rotations bleeds off the body's spin, as if it turned in syrup. Forces inside a
  // body cannot change its angular momentum, so each bunny's is measured before the tet solve (give = false) and
  // handed back after it (give = true) as one small rigid turn about its middle.
  spin(give) {
    const { x, prev, mass } = this;
    for (const B of this.bodies) {
      const i0 = B.p0, i1 = i0 + this.n1;
      let M = 0, cx = 0, cy = 0, cz = 0;
      for (let i = i0; i < i1; i++) { const m = mass[i], k = 3 * i; M += m; cx += x[k] * m; cy += x[k + 1] * m; cz += x[k + 2] * m; }
      cx /= M; cy /= M; cz /= M;
      let hx = 0, hy = 0, hz = 0, ixx = 0, iyy = 0, izz = 0, ixy = 0, ixz = 0, iyz = 0;
      for (let i = i0; i < i1; i++) {
        const m = mass[i], k = 3 * i, rx = x[k] - cx, ry = x[k + 1] - cy, rz = x[k + 2] - cz;
        const dx = x[k] - prev[k], dy = x[k + 1] - prev[k + 1], dz = x[k + 2] - prev[k + 2];
        hx += m * (ry * dz - rz * dy); hy += m * (rz * dx - rx * dz); hz += m * (rx * dy - ry * dx);
        if (give) { ixx += m * (ry * ry + rz * rz); iyy += m * (rx * rx + rz * rz); izz += m * (rx * rx + ry * ry); ixy -= m * rx * ry; ixz -= m * rx * rz; iyz -= m * ry * rz; }
      }
      if (!give) { B.hx = hx; B.hy = hy; B.hz = hz; continue; }
      const I = inv3([ixx, ixy, ixz, ixy, iyy, iyz, ixz, iyz, izz]);
      const ex = B.hx - hx, ey = B.hy - hy, ez = B.hz - hz;
      const px = I[0] * ex + I[1] * ey + I[2] * ez, py = I[3] * ex + I[4] * ey + I[5] * ez, pz = I[6] * ex + I[7] * ey + I[8] * ez;
      if (!Number.isFinite(px + py + pz)) continue;
      for (let i = i0; i < i1; i++) {
        const k = 3 * i, rx = x[k] - cx, ry = x[k + 1] - cy, rz = x[k + 2] - cz;
        x[k] += py * rz - pz * ry; x[k + 1] += pz * rx - px * rz; x[k + 2] += px * ry - py * rx;
      }
    }
  }

  // ── simulation ──
  step() {
    const sub = this.substeps;
    const dt = this.stepDt / sub;
    this.bounds();
    this.buildContacts();
    for (let s = 0; s < sub; s++) this.substep(dt);
    this.time += this.stepDt;
    const { v, mass, x } = this;
    for (const B of this.bodies) {
      const i0 = B.p0, i1 = i0 + this.n1;
      // settling: once a bunny is nearly still, bleed off the last residual jitter
      if (!(this.grabbing && this.grabBody === B.b)) {
        let e = 0;
        for (let i = i0; i < i1; i++) { const k = 3 * i; e += 0.5 * mass[i] * (v[k] * v[k] + v[k + 1] * v[k + 1] + v[k + 2] * v[k + 2]); }
        const ke = e / B.mass; // ≈ ½ v²
        if (ke < 2e-3) {
          const f = Math.max(0.86, 1 - 0.14 * (1 - ke / 2e-3));
          for (let k = 3 * i0; k < 3 * i1; k++) v[k] *= f;
        }
      }
      // safety: any non-finite value → put that bunny back, gently
      for (let k = 3 * i0; k < 3 * i1; k += 97) if (!Number.isFinite(x[k])) { if (this.grabBody === B.b) this.endGrab(); this.place(B.b, 0.2); break; }
    }
  }

  substep(dt) {
    const { x, prev, v, n } = this;
    const g = this.gravity * dt;
    // light air drag; while held, the hand steadies that bunny a little more
    const air = Math.exp(-0.08 * dt), held = Math.exp(-2.5 * dt), gb = this.grabbing ? this.grabBody : -1, bodyOf = this.bodyOf;
    for (let i = 0; i < n; i++) {
      const k = 3 * i, a = bodyOf[i] === gb ? held : air;
      v[k + 1] += g;
      v[k] *= a; v[k + 1] *= a; v[k + 2] *= a;
      prev[k] = x[k]; prev[k + 1] = x[k + 1]; prev[k + 2] = x[k + 2];
      x[k] += v[k] * dt; x[k + 1] += v[k + 1] * dt; x[k + 2] += v[k + 2] * dt;
    }
    if (this.grabbing) this.solveGrab(dt);
    for (const B of this.bodies) if (B.poseK > 0) this.solvePose(B);
    this.spin(false);
    this.solveTets(dt);
    this.spin(true);
    this.solveVolumes(dt);
    if (this.pairs.length) this.solveContacts();
    this.solveFloor();
    const inv = 1 / dt, vmax = this.maxSpeed;
    for (let i = 0; i < 3 * n; i += 3) {
      let vx = (x[i] - prev[i]) * inv, vy = (x[i + 1] - prev[i + 1]) * inv, vz = (x[i + 2] - prev[i + 2]) * inv;
      const sp = Math.hypot(vx, vy, vz);
      if (sp > vmax) { const f = vmax / sp; vx *= f; vy *= f; vz *= f; }
      v[i] = vx; v[i + 1] = vy; v[i + 2] = vz;
    }
    this.dampEdges(dt);
  }

  solveGrab(dt) {
    const { x, invMass } = this;
    const a = 2e-6 / (dt * dt);
    const R = this.grabRot, T = this.grabTarget;
    for (let k = 0; k < this.grabN; k++) {
      const i = this.grabIdx[k], w = invMass[i];
      const ox = this.grabOff[3 * k], oy = this.grabOff[3 * k + 1], oz = this.grabOff[3 * k + 2];
      const tx = T[0] + R[0] * ox + R[1] * oy + R[2] * oz;
      const ty = Math.max(T[1] + R[3] * ox + R[4] * oy + R[5] * oz, this.floorY + 0.005);
      const tz = T[2] + R[6] * ox + R[7] * oy + R[8] * oz;
      let f = this.grabW[k] * w / (w + a);
      // pressing down near the table: yield instead of crushing the jelly underneath
      if (ty < x[3 * i + 1] && ty < 0.45) f *= Math.max(0.12, ty / 0.45);
      x[3 * i] += (tx - x[3 * i]) * f;
      x[3 * i + 1] += (ty - x[3 * i + 1]) * f;
      x[3 * i + 2] += (tz - x[3 * i + 2]) * f;
    }
  }

  // Per-tet co-rotational shape matching: find the rotation that best maps the rest tet onto the
  // current one (Müller et al. 2016, warm-started quaternion), then pull the four corners toward the
  // rotated rest shape with XPBD compliance. Inverted tets are always pushed back to a proper shape.
  solveTets(dt) {
    const { x, tets, tetQ, tetRot: Q, tetFirm, mass } = this;
    const base = this.shapeCompliance() / (dt * dt);
    for (let t = 0; t < this.nT; t++) {
      const a = 3 * tets[4 * t], b = 3 * tets[4 * t + 1], c = 3 * tets[4 * t + 2], d = 3 * tets[4 * t + 3];
      const ma = mass[a / 3], mb = mass[b / 3], mc = mass[c / 3], md = mass[d / 3];
      const M = ma + mb + mc + md;
      const cx = (x[a] * ma + x[b] * mb + x[c] * mc + x[d] * md) / M;
      const cy = (x[a + 1] * ma + x[b + 1] * mb + x[c + 1] * mc + x[d + 1] * md) / M;
      const cz = (x[a + 2] * ma + x[b + 2] * mb + x[c + 2] * mc + x[d + 2] * md) / M;
      const T = 12 * t;
      // A = Σ m p qᵀ (mass-weighted covariance of current vs rest, both about their centroids)
      let f00 = 0, f01 = 0, f02 = 0, f10 = 0, f11 = 0, f12 = 0, f20 = 0, f21 = 0, f22 = 0;
      {
        let px = (x[a] - cx) * ma, py = (x[a + 1] - cy) * ma, pz = (x[a + 2] - cz) * ma;
        let q0 = tetQ[T], q1 = tetQ[T + 1], q2 = tetQ[T + 2];
        f00 += px * q0; f01 += px * q1; f02 += px * q2; f10 += py * q0; f11 += py * q1; f12 += py * q2; f20 += pz * q0; f21 += pz * q1; f22 += pz * q2;
        px = (x[b] - cx) * mb; py = (x[b + 1] - cy) * mb; pz = (x[b + 2] - cz) * mb; q0 = tetQ[T + 3]; q1 = tetQ[T + 4]; q2 = tetQ[T + 5];
        f00 += px * q0; f01 += px * q1; f02 += px * q2; f10 += py * q0; f11 += py * q1; f12 += py * q2; f20 += pz * q0; f21 += pz * q1; f22 += pz * q2;
        px = (x[c] - cx) * mc; py = (x[c + 1] - cy) * mc; pz = (x[c + 2] - cz) * mc; q0 = tetQ[T + 6]; q1 = tetQ[T + 7]; q2 = tetQ[T + 8];
        f00 += px * q0; f01 += px * q1; f02 += px * q2; f10 += py * q0; f11 += py * q1; f12 += py * q2; f20 += pz * q0; f21 += pz * q1; f22 += pz * q2;
        px = (x[d] - cx) * md; py = (x[d + 1] - cy) * md; pz = (x[d + 2] - cz) * md; q0 = tetQ[T + 9]; q1 = tetQ[T + 10]; q2 = tetQ[T + 11];
        f00 += px * q0; f01 += px * q1; f02 += px * q2; f10 += py * q0; f11 += py * q1; f12 += py * q2; f20 += pz * q0; f21 += pz * q1; f22 += pz * q2;
      }
      let qx = Q[4 * t], qy = Q[4 * t + 1], qz = Q[4 * t + 2], qw = Q[4 * t + 3];
      let r00, r01, r02, r10, r11, r12, r20, r21, r22;
      for (let it = 0; it < 2; it++) {
        r00 = 1 - 2 * (qy * qy + qz * qz); r01 = 2 * (qx * qy - qw * qz); r02 = 2 * (qx * qz + qw * qy);
        r10 = 2 * (qx * qy + qw * qz); r11 = 1 - 2 * (qx * qx + qz * qz); r12 = 2 * (qy * qz - qw * qx);
        r20 = 2 * (qx * qz - qw * qy); r21 = 2 * (qy * qz + qw * qx); r22 = 1 - 2 * (qx * qx + qy * qy);
        const ox = (r10 * f20 - r20 * f10) + (r11 * f21 - r21 * f11) + (r12 * f22 - r22 * f12);
        const oy = (r20 * f00 - r00 * f20) + (r21 * f01 - r01 * f21) + (r22 * f02 - r02 * f22);
        const oz = (r00 * f10 - r10 * f00) + (r01 * f11 - r11 * f01) + (r02 * f12 - r12 * f02);
        const den = Math.abs(r00 * f00 + r10 * f10 + r20 * f20 + r01 * f01 + r11 * f11 + r21 * f21 + r02 * f02 + r12 * f12 + r22 * f22) + 1e-12;
        const wx = ox / den, wy = oy / den, wz = oz / den;
        const w = Math.sqrt(wx * wx + wy * wy + wz * wz);
        if (w < 1e-6) break;
        // small-angle quaternion step (renormalised below); large jumps are clamped
        const sc = w > 1 ? 0.5 / w : 0.5;
        const ax = wx * sc, ay = wy * sc, az = wz * sc, cs = 1;
        const nx = cs * qx + ax * qw + ay * qz - az * qy;
        const ny = cs * qy - ax * qz + ay * qw + az * qx;
        const nz = cs * qz + ax * qy - ay * qx + az * qw;
        const nw = cs * qw - ax * qx - ay * qy - az * qz;
        const nl = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
        qx = nx * nl; qy = ny * nl; qz = nz * nl; qw = nw * nl;
      }
      r00 = 1 - 2 * (qy * qy + qz * qz); r01 = 2 * (qx * qy - qw * qz); r02 = 2 * (qx * qz + qw * qy);
      r10 = 2 * (qx * qy + qw * qz); r11 = 1 - 2 * (qx * qx + qz * qz); r12 = 2 * (qy * qz - qw * qx);
      r20 = 2 * (qx * qz - qw * qy); r21 = 2 * (qy * qz + qw * qx); r22 = 1 - 2 * (qx * qx + qy * qy);
      Q[4 * t] = qx; Q[4 * t + 1] = qy; Q[4 * t + 2] = qz; Q[4 * t + 3] = qw;
      // the same fraction for all four corners keeps linear and angular momentum intact
      const f = 1 / (1 + base * tetFirm[t] * M * 0.25);
      let q0 = tetQ[T], q1 = tetQ[T + 1], q2 = tetQ[T + 2];
      x[a] += (cx + r00 * q0 + r01 * q1 + r02 * q2 - x[a]) * f; x[a + 1] += (cy + r10 * q0 + r11 * q1 + r12 * q2 - x[a + 1]) * f; x[a + 2] += (cz + r20 * q0 + r21 * q1 + r22 * q2 - x[a + 2]) * f;
      q0 = tetQ[T + 3]; q1 = tetQ[T + 4]; q2 = tetQ[T + 5];
      x[b] += (cx + r00 * q0 + r01 * q1 + r02 * q2 - x[b]) * f; x[b + 1] += (cy + r10 * q0 + r11 * q1 + r12 * q2 - x[b + 1]) * f; x[b + 2] += (cz + r20 * q0 + r21 * q1 + r22 * q2 - x[b + 2]) * f;
      q0 = tetQ[T + 6]; q1 = tetQ[T + 7]; q2 = tetQ[T + 8];
      x[c] += (cx + r00 * q0 + r01 * q1 + r02 * q2 - x[c]) * f; x[c + 1] += (cy + r10 * q0 + r11 * q1 + r12 * q2 - x[c + 1]) * f; x[c + 2] += (cz + r20 * q0 + r21 * q1 + r22 * q2 - x[c + 2]) * f;
      q0 = tetQ[T + 9]; q1 = tetQ[T + 10]; q2 = tetQ[T + 11];
      x[d] += (cx + r00 * q0 + r01 * q1 + r02 * q2 - x[d]) * f; x[d + 1] += (cy + r10 * q0 + r11 * q1 + r12 * q2 - x[d + 1]) * f; x[d + 2] += (cz + r20 * q0 + r21 * q1 + r22 * q2 - x[d + 2]) * f;
    }
  }

  solveVolumes(dt) {
    const { x, invMass, tets, restVol } = this;
    const alpha0 = this.volCompliance() / (dt * dt);
    for (let t = 0; t < this.nT; t++) {
      const a = tets[4 * t], b = tets[4 * t + 1], c = tets[4 * t + 2], d = tets[4 * t + 3];
      const A = 3 * a, B = 3 * b, Cc = 3 * c, D = 3 * d;
      // gradients (Müller): g_a = (d-b)×(c-b), g_b = (c-a)×(d-a), g_c = (d-a)×(b-a), g_d = (b-a)×(c-a)
      const bax = x[B] - x[A], bay = x[B + 1] - x[A + 1], baz = x[B + 2] - x[A + 2];
      const cax = x[Cc] - x[A], cay = x[Cc + 1] - x[A + 1], caz = x[Cc + 2] - x[A + 2];
      const dax = x[D] - x[A], day = x[D + 1] - x[A + 1], daz = x[D + 2] - x[A + 2];
      const dbx = x[D] - x[B], dby = x[D + 1] - x[B + 1], dbz = x[D + 2] - x[B + 2];
      const cbx = x[Cc] - x[B], cby = x[Cc + 1] - x[B + 1], cbz = x[Cc + 2] - x[B + 2];
      const gax = dby * cbz - dbz * cby, gay = dbz * cbx - dbx * cbz, gaz = dbx * cby - dby * cbx;
      const gbx = cay * daz - caz * day, gby = caz * dax - cax * daz, gbz = cax * day - cay * dax;
      const gcx = day * baz - daz * bay, gcy = daz * bax - dax * baz, gcz = dax * bay - day * bax;
      const gdx = bay * caz - baz * cay, gdy = baz * cax - bax * caz, gdz = bax * cay - bay * cax;
      const V = (dax * gdx + day * gdy + daz * gdz) / 6;
      const wa = invMass[a], wb = invMass[b], wc = invMass[c], wd = invMass[d];
      const wsum = wa * (gax * gax + gay * gay + gaz * gaz) + wb * (gbx * gbx + gby * gby + gbz * gbz)
                 + wc * (gcx * gcx + gcy * gcy + gcz * gcz) + wd * (gdx * gdx + gdy * gdy + gdz * gdz);
      if (wsum < 1e-12) continue;
      const r0 = restVol[t];
      // anti-inversion: elements far below rest volume get a rigid (compliance-free) correction
      const alpha = V < 0.25 * r0 ? 0 : alpha0 * this.tetVolK[t];
      const C = 6 * (V - r0);
      let s = -C / (wsum + alpha);
      x[A] += gax * s * wa; x[A + 1] += gay * s * wa; x[A + 2] += gaz * s * wa;
      x[B] += gbx * s * wb; x[B + 1] += gby * s * wb; x[B + 2] += gbz * s * wb;
      x[Cc] += gcx * s * wc; x[Cc + 1] += gcy * s * wc; x[Cc + 2] += gcz * s * wc;
      x[D] += gdx * s * wd; x[D + 1] += gdy * s * wd; x[D + 2] += gdz * s * wd;
    }
  }

  solveFloor() {
    const { x, prev, n } = this;
    const fy = this.floorY, mu = this.friction;
    for (let i = 0; i < n; i++) {
      const k = 3 * i;
      const pen = fy - x[k + 1];
      if (pen <= 0) continue;
      x[k + 1] = fy;
      // Coulomb-style positional friction
      const dx = x[k] - prev[k], dz = x[k + 2] - prev[k + 2];
      const dl = Math.hypot(dx, dz);
      if (dl < 1e-12) continue;
      // static friction for micro-slip, kinetic friction otherwise (never locks in large strain)
      const f = dl < mu * pen ? 1 : mu * pen / dl;
      x[k] -= dx * f; x[k + 2] -= dz * f;
    }
  }

  dampEdges(dt) {
    const { x, v, invMass, edges } = this;
    const k = 1 - Math.exp(-this.dampRate() * dt);
    for (let e = 0; e < this.nE; e++) {
      const i = edges[2 * e], j = edges[2 * e + 1];
      const I = 3 * i, J = 3 * j;
      let nx = x[J] - x[I], ny = x[J + 1] - x[I + 1], nz = x[J + 2] - x[I + 2];
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (l < 1e-9) continue;
      nx /= l; ny /= l; nz /= l;
      const rv = (v[J] - v[I]) * nx + (v[J + 1] - v[I + 1]) * ny + (v[J + 2] - v[I + 2]) * nz;
      const wi = invMass[i], wj = invMass[j], ws = wi + wj;
      const imp = rv * k / ws;
      v[I] += nx * imp * wi; v[I + 1] += ny * imp * wi; v[I + 2] += nz * imp * wi;
      v[J] -= nx * imp * wj; v[J + 1] -= ny * imp * wj; v[J + 2] -= nz * imp * wj;
    }
  }

  // ── diagnostics ──
  volumeRatio() {
    let s = 0;
    for (let t = 0; t < this.nT; t++) s += this.tetVol(this.x, t);
    return s / this.totalRestVolume;
  }
  minVolumeRatio() {
    let m = Infinity;
    for (let t = 0; t < this.nT; t++) m = Math.min(m, this.tetVol(this.x, t) / this.restVol[t]);
    return m;
  }
}

function inv3(m) { // row-major 3x3
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C, k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}


// ─────────────────────────────────────────────────────────────
//  Berries: small rigid balls of jelly, kept out of sight until they are tossed onto the table. Each has an
//  orientation: it falls, lands, bounces, rolls and knocks into the others, and meets the bunnies themselves, so
//  one can land on a bunny's back and roll down its flank, or be nosed along the table.
// ─────────────────────────────────────────────────────────────
class DropSet {
  constructor(list, sim) {
    this.sim = sim;
    this.n = list.length;
    this.list = list.map(A => ({
      home: A.p.slice(), r: A.r, mass: A.r * A.r * A.r * 4.19 * 1.3,
      hidden: true, free: false, held: false, x: A.p.slice(), v: [0, 0, 0], R: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), w: [0, 0, 0],
      target: [0, 0, 0], sleep: 0, ghost: 0, touch: false, age: 0,
    }));
    this.stamp = new Int32Array(sim.nT); this.stampN = 0;
    this.floorY = 0;
    this.freeCount = 0;
    this.box = [[0, 0, 0], [0, 0, 0]];
  }
  reset() {
    for (const A of this.list) { A.free = false; A.hidden = true; A.held = false; A.v = [0, 0, 0]; A.w = [0, 0, 0]; A.sleep = 0; }
    this.freeCount = 0;
  }
  count() { this.freeCount = this.list.reduce((s, q) => s + (q.free ? 1 : 0), 0); }

  // blow a drop out from x with velocity v and spin w
  release(i, x, v, w) {
    const A = this.list[i];
    A.free = true; A.hidden = false; A.held = false;
    A.x = x.slice(); A.R.set([1, 0, 0, 0, 1, 0, 0, 0, 1]); A.v = v.slice(); A.w = w.slice();
    A.sleep = 0; A.ghost = 0.16; A.age = 0;
    this.count();
  }

  step(dt, subs = 3) {
    const h = dt / subs;
    // is any loose drop near a bunny? then the bunnies' tetrahedra are binned for contact tests this step
    const x = this.sim.x, mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let i = 0; i < x.length; i += 3) for (let d = 0; d < 3; d++) { mn[d] = Math.min(mn[d], x[i + d]); mx[d] = Math.max(mx[d], x[i + d]); }
    this.box = [mn, mx];
    // a berry lying still is woken when a bunny on the move comes over it
    for (const A of this.list) if (A.free && !A.held && A.sleep > 0.6) for (const B of this.sim.bodies) {
      const m = A.r + 0.04;
      if (B.speed > 0.12 && A.x[0] > B.lo[0] - m && A.x[0] < B.hi[0] + m && A.x[1] < B.hi[1] + m && A.x[2] > B.lo[2] - m && A.x[2] < B.hi[2] + m) { A.sleep = 0; break; }
    }
    let near = false;
    for (const A of this.list) if (A.free && !(A.sleep > 0.6 && !A.held) && A.ghost <= 0.05 && this.nearBox(A)) { near = true; break; }
    if (near) this.binTets();
    for (let s = 0; s < subs; s++) this.substep(h, near);
  }
  nearBox(A) {
    const [mn, mx] = this.box, m = A.r + 0.05;
    return A.x[0] > mn[0] - m && A.x[0] < mx[0] + m && A.x[1] > mn[1] - m && A.x[1] < mx[1] + m && A.x[2] > mn[2] - m && A.x[2] < mx[2] + m;
  }
  // a uniform grid of the deformed tetrahedra's bounding boxes
  binTets() {
    const sim = this.sim, x = sim.x, T = sim.tets, cell = 0.2, g = new Map();
    for (let t = 0; t < sim.nT; t++) {
      let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
      for (let k = 0; k < 4; k++) { const v = 3 * T[4 * t + k]; x0 = Math.min(x0, x[v]); x1 = Math.max(x1, x[v]); y0 = Math.min(y0, x[v + 1]); y1 = Math.max(y1, x[v + 1]); z0 = Math.min(z0, x[v + 2]); z1 = Math.max(z1, x[v + 2]); }
      for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) for (let j = Math.floor(y0 / cell); j <= Math.floor(y1 / cell); j++) for (let k = Math.floor(z0 / cell); k <= Math.floor(z1 / cell); k++) {
        const K = (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512); let l = g.get(K); if (!l) g.set(K, l = []); l.push(t);
      }
    }
    this.grid = g;
  }
  // where a ball (centre P, radius r) presses into a deformed bunny: carry its centre back to rest space through
  // the tetrahedron it is in (or nearest), ask the bunny's signed distance there, push out along the deformed normal
  bodyQuery(P, r) {
    const sim = this.sim, x = sim.x, X = sim.rest0, T = sim.tets, cell = 0.2;
    this.stampN++;
    let best = -1, bs = -1e9, bb = null;
    for (let i = Math.floor((P[0] - r) / cell); i <= Math.floor((P[0] + r) / cell); i++)
      for (let j = Math.floor((P[1] - r) / cell); j <= Math.floor((P[1] + r) / cell); j++)
        for (let k = Math.floor((P[2] - r) / cell); k <= Math.floor((P[2] + r) / cell); k++) {
          const l = this.grid.get((i + 512) * 1048576 + (j + 512) * 1024 + (k + 512)); if (!l) continue;
          for (const t of l) {
            if (this.stamp[t] === this.stampN) continue; this.stamp[t] = this.stampN;
            const a = 3 * T[4 * t];
            const m = [];
            for (let c = 1; c < 4; c++) { const v = 3 * T[4 * t + c]; m.push(x[v] - x[a], x[v + 1] - x[a + 1], x[v + 2] - x[a + 2]); }
            const Ds = [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
            const I = inv3(Ds);
            const dx = P[0] - x[a], dy = P[1] - x[a + 1], dz = P[2] - x[a + 2];
            const b1 = I[0] * dx + I[1] * dy + I[2] * dz, b2 = I[3] * dx + I[4] * dy + I[5] * dz, b3 = I[6] * dx + I[7] * dy + I[8] * dz;
            const sc = Math.min(1 - b1 - b2 - b3, b1, b2, b3);
            if (sc > bs) { bs = sc; best = t; bb = [b1, b2, b3, Ds, I]; }
          }
        }
    if (best < 0 || bs < -0.8) return null;
    const t = best, a = 3 * T[4 * t], [b1, b2, b3, , I] = bb;
    const Dm = [];
    for (let c = 1; c < 4; c++) { const v = 3 * T[4 * t + c]; Dm.push(X[v] - X[a], X[v + 1] - X[a + 1], X[v + 2] - X[a + 2]); }
    const Q = [X[a] + Dm[0] * b1 + Dm[3] * b2 + Dm[6] * b3, X[a + 1] + Dm[1] * b1 + Dm[4] * b2 + Dm[7] * b3, X[a + 2] + Dm[2] * b1 + Dm[5] * b2 + Dm[8] * b3];
    const sd = animalSD(Q[0], Q[1], Q[2]) * sim.bodies[sim.bodyOf[T[4 * t]]].scale;
    if (sd >= r) return null;
    const g = sdGrad(animalSD, Q[0], Q[1], Q[2], 2e-3);
    const dg = [Dm[0] * g[0] + Dm[1] * g[1] + Dm[2] * g[2], Dm[3] * g[0] + Dm[4] * g[1] + Dm[5] * g[2], Dm[6] * g[0] + Dm[7] * g[1] + Dm[8] * g[2]];
    let n = [I[0] * dg[0] + I[3] * dg[1] + I[6] * dg[2], I[1] * dg[0] + I[4] * dg[1] + I[7] * dg[2], I[2] * dg[0] + I[5] * dg[1] + I[8] * dg[2]];
    const nl = Math.hypot(...n) || 1; n = n.map(q => q / nl);
    const w = [Math.max(0, 1 - b1 - b2 - b3), Math.max(0, b1), Math.max(0, b2), Math.max(0, b3)];
    return { n, pen: Math.min(r - sd, 0.08), t, w };
  }
  bodyContact(A, h) {
    const sim = this.sim, T = sim.tets, P = A.x, r = A.r;
    A.touch = false;
    const c = this.bodyQuery(P, r);
    if (!c) return;
    const { n, pen, t, w } = c;
    P[0] += n[0] * pen; P[1] += n[1] * pen; P[2] += n[2] * pen;
    A.touch = true;
    // the jelly's velocity there, and an exchange of momentum with its four corners
    const ws = w[0] + w[1] + w[2] + w[3] || 1;
    const vb = [0, 0, 0];
    for (let c = 0; c < 4; c++) { const v = 3 * T[4 * t + c]; for (let d = 0; d < 3; d++) vb[d] += sim.v[v + d] * w[c] / ws; }
    const rv = [A.v[0] - vb[0], A.v[1] - vb[1], A.v[2] - vb[2]], vn = rv[0] * n[0] + rv[1] * n[1] + rv[2] * n[2];
    if (vn < 0) {
      let mb = 0; for (let c = 0; c < 4; c++) mb += sim.mass[T[4 * t + c]] * w[c] / ws;
      // jelly on jelly: a soft, slightly sticky bounce
      const j0 = -(1 + (vn < -1.2 ? 0.3 : 0.08)) * vn / (1 / A.mass + 1 / mb);
      for (let d = 0; d < 3; d++) A.v[d] += n[d] * j0 / A.mass;
      for (let c = 0; c < 4; c++) { const v = 3 * T[4 * t + c], f = w[c] / ws; for (let d = 0; d < 3; d++) sim.v[v + d] -= n[d] * j0 / mb * f; }
    }
    // friction: slide less, roll more
    const tv = [A.v[0] - vb[0], A.v[1] - vb[1], A.v[2] - vb[2]], tn = tv[0] * n[0] + tv[1] * n[1] + tv[2] * n[2];
    const k = 1 - Math.exp(-5 * h);
    for (let d = 0; d < 3; d++) A.v[d] -= (tv[d] - tn * n[d]) * k;
    const rw = [n[1] * tv[2] - n[2] * tv[1], n[2] * tv[0] - n[0] * tv[2], n[0] * tv[1] - n[1] * tv[0]];
    for (let d = 0; d < 3; d++) A.w[d] += (-rw[d] / r - A.w[d]) * k;
  }
  substep(h, near) {
    const L = this.list, g = this.sim.gravity;
    for (const A of L) if (A.free && A.ghost > 0) A.ghost -= h;
    for (const A of L) {
      if (!A.free) continue;
      A.age += h;
      if (A.held) {
        // a soft spring to the finger: quick, but it still swings and lags
        const k = 260, c = 26;
        for (let d = 0; d < 3; d++) A.v[d] += ((A.target[d] - A.x[d]) * k - A.v[d] * c) * h;
        for (let d = 0; d < 3; d++) A.w[d] *= Math.exp(-4 * h);
      } else {
        if (A.sleep > 0.6) continue;
        A.v[1] += g * h;
        const air = Math.exp(-0.3 * h);
        for (let d = 0; d < 3; d++) A.v[d] *= air;
      }
      for (let d = 0; d < 3; d++) A.x[d] += A.v[d] * h;
      const wl = Math.hypot(A.w[0], A.w[1], A.w[2]);
      if (wl > 1e-6) rotateBy(A.R, A.w[0] / wl, A.w[1] / wl, A.w[2] / wl, wl * h);
      // the table: a gummy drop lands with a small bounce, then rolls and slows
      const r = A.r;
      if (A.x[1] < this.floorY + r) {
        A.x[1] = this.floorY + r;
        if (A.v[1] < 0) A.v[1] = A.v[1] < -0.9 ? -A.v[1] * 0.26 : 0;
        const rw = [A.v[2] / r, 0, -A.v[0] / r];
        const k = 1 - Math.exp(-14 * h);
        for (let d = 0; d < 3; d++) A.w[d] += (rw[d] - A.w[d]) * k;
        const roll = Math.exp(-3.6 * h);
        A.v[0] *= roll; A.v[2] *= roll;
      }
    }
    // knocks between loose drops
    for (let i = 0; i < L.length; i++) {
      const A = L[i]; if (!A.free) continue;
      for (let j = i + 1; j < L.length; j++) {
        const B = L[j]; if (!B.free) continue;
        const dx = B.x[0] - A.x[0], dy = B.x[1] - A.x[1], dz = B.x[2] - A.x[2], rr = A.r + B.r;
        if (Math.abs(dx) > rr || Math.abs(dy) > rr || Math.abs(dz) > rr) continue;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-12) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d, pen = rr - d;
        const wa = A.held ? 0 : 1 / A.mass, wb = B.held ? 0 : 1 / B.mass, ws = wa + wb || 1;
        A.x[0] -= nx * pen * wa / ws; A.x[1] -= ny * pen * wa / ws; A.x[2] -= nz * pen * wa / ws;
        B.x[0] += nx * pen * wb / ws; B.x[1] += ny * pen * wb / ws; B.x[2] += nz * pen * wb / ws;
        const rv = (B.v[0] - A.v[0]) * nx + (B.v[1] - A.v[1]) * ny + (B.v[2] - A.v[2]) * nz;
        if (rv < 0) {
          const j0 = -(1 + 0.25) * rv / ws;
          A.v[0] -= nx * j0 * wa; A.v[1] -= ny * j0 * wa; A.v[2] -= nz * j0 * wa;
          B.v[0] += nx * j0 * wb; B.v[1] += ny * j0 * wb; B.v[2] += nz * j0 * wb;
          if (Math.abs(rv) > 0.3) { A.sleep = 0; B.sleep = 0; }
        }
      }
    }
    // the bunnies themselves
    for (const A of L) {
      if (!A.free || (A.sleep > 0.6 && !A.held) || A.ghost > 0) continue;
      if (near && this.nearBox(A)) this.bodyContact(A, h); else A.touch = false;
    }
    // put still drops to sleep (and wake any a bunny moves under)
    for (const A of L) {
      if (!A.free || A.held) { A.sleep = 0; continue; }
      const sp = Math.hypot(A.v[0], A.v[1], A.v[2]);
      const still = sp < 0.05 && A.x[1] < this.floorY + A.r + 0.002 && !A.touch;
      if (still) { A.sleep += h; if (A.sleep > 0.6) { A.v = [0, 0, 0]; A.w = [0, 0, 0]; } }
      else A.sleep = 0;
    }
  }
}

// rotate the 3×3 (row-major) R by angle a about unit axis (x, y, z), in world space: R ← Rot · R
function rotateBy(R, x, y, z, a) {
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  const M = [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
  const o = new Float64Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[3 * i + j] = M[3 * i] * R[j] + M[3 * i + 1] * R[3 + j] + M[3 * i + 2] * R[6 + j];
  R.set(o);
}


// ─────────────────────────────────────────────────────────────
//  The troupe: what each bunny does with itself. It hops to places on the table and to berries, eats them, wags its
//  tail, gets back on its feet when it has been turned over, and stands up to say rawr.
// ─────────────────────────────────────────────────────────────
const RAWR_IN = 0.34, RAWR_HOLD = 1.5, RAWR_OUT = 0.5;
const ease = t => { const u = Math.min(1, Math.max(0, t)); return u * u * (3 - 2 * u); };

class Troupe {
  // opts.anchor(b, i, out): where point i of ANCHORS is now, on bunny b
  constructor(sim, drops, opts = {}) {
    this.sim = sim; this.drops = drops; this.anchor = opts.anchor;
    this.R = rng(opts.seed ?? 9117);
    this.arena = opts.arena ?? 1.5;        // they keep to a disc of this radius about `centre`
    this.centre = [0, 0];
    this.calm = !!opts.calm;               // reduced motion: smaller hops, a gentler wag
    this.tmp = [0, 0, 0];
    this.list = sim.bodies.map((B, b) => ({ b, head: [1, 0], goal: [B.home[0], B.home[1]], slots: Array.from({ length: SLOTS }, () => ({ t: -1, grow: 0, age: 0, life: 50 })) }));
    this.reset();
  }
  reset() {
    this.hops = 0; this.eaten = 0; this.rawrs = 0;
    for (const P of this.list) {
      Object.assign(P, { mode: 'idle', wait: 1.1 + 0.5 * P.b, berry: -1, hopT: 0, walkT: 0, cad: 0.6, tumbleT: 0, rawrT: -1, rawrDue: Infinity, wagT: 0, wagClock: 0, upright: true, grounded: false });
      for (const S of P.slots) { S.t = -1; S.grow = 0; S.age = 0; }
    }
  }
  // every bunny that can will stand up, one after another
  rawrAll() { this.list.forEach((P, k) => { if (P.rawrT < 0) P.rawrDue = 0.02 + 0.14 * k; }); }
  // put down after being picked up: it has something to say about that
  released(b) { const P = this.list[b]; if (P && P.rawrT < 0) P.rawrDue = 0.35; }
  inside() { let n = 0; for (const P of this.list) for (const S of P.slots) if (S.t >= 0) n++; return n; }
  hungry(P) { return P.slots.some(S => S.t < 0); }
  nearestBerry(B) {
    let best = -1, bd = Infinity;
    this.drops.list.forEach((A, i) => {
      if (!A.free || A.held || A.age < 0.5 || A.x[1] > 0.3) return;
      if (Math.hypot(A.x[0] - this.centre[0], A.x[2] - this.centre[1]) > this.arena + 1.3) return;
      const d = Math.hypot(A.x[0] - B.c[0], A.x[2] - B.c[2]);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  step(dt) {
    const sim = this.sim, R = this.R;
    for (const P of this.list) sim.frame(P.b);
    for (const P of this.list) {
      const B = sim.bodies[P.b], s = B.scale, Rm = B.R;
      // the berries inside: in at the mouth, back to the stomach, and after a while digested
      for (const S of P.slots) if (S.t >= 0) {
        S.age += dt; S.t = Math.min(1, S.t + dt / 1.5);
        if (S.age > S.life) { S.grow -= dt * 0.5; if (S.grow <= 0) { S.grow = 0; S.t = -1; } } else S.grow = Math.min(1, S.grow + dt * 5);
      }
      const fl = Math.hypot(Rm[0], Rm[6]);
      if (fl > 0.3) { P.head[0] = Rm[0] / fl; P.head[1] = Rm[6] / fl; }
      P.grounded = sim.grounded(P.b) > 0.4 && Math.abs(B.vc[1]) < 0.7;
      P.upright = Rm[4] > 0.8;
      P.hopT += dt; P.wait -= dt;
      if (P.wagT > 0) { P.wagT -= dt; P.wagClock += dt; sim.wag(P.b, 34 * Math.cos(P.wagClock * 20) * dt * (this.calm ? 0.5 : 1) * Math.sqrt(s)); }

      // in the hand: nothing to be done about it
      if (sim.grabbing && sim.grabBody === P.b) { if (P.rawrT >= 0) this.endRawr(P, B); P.mode = 'held'; continue; }
      if (P.mode === 'held') { P.mode = 'idle'; P.wait = 0.4; }

      // standing up: the pose comes in, is held while the forepaws paddle, and goes out again
      if (P.rawrT >= 0) {
        P.rawrT += dt;
        const t = P.rawrT;
        const a = t < RAWR_IN ? ease(t / RAWR_IN) : t < RAWR_IN + RAWR_HOLD ? 1 : 1 - ease((t - RAWR_IN - RAWR_HOLD) / RAWR_OUT);
        const wave = t > RAWR_IN * 0.6 && t < RAWR_IN + RAWR_HOLD ? Math.sin((t - RAWR_IN * 0.6) * 11) * (this.calm ? 0.4 : 1) : 0;
        sim.pose(P.b, a, wave); B.poseK = a;
        if (t >= RAWR_IN + RAWR_HOLD + RAWR_OUT) this.endRawr(P, B);
        continue;
      }

      // on its side or its back: throw itself into the air with a roll about its own length, and see how it lands
      // (stood on its nose or its tail, it tips over instead)
      if (!P.upright) {
        P.tumbleT += dt;
        if (P.tumbleT > 0.45 && P.wait <= 0 && B.lo[1] < 0.06 && Math.abs(B.vc[1]) < 0.8) {
          const root = Math.sqrt(s);
          let ang, vu;
          if (Math.abs(Rm[3]) < 0.75) {
            const th = Math.atan2(Rm[5], Rm[4]), fl = Math.hypot(Rm[0], Rm[6]) || 1;
            vu = (1.55 + 0.5 * Math.abs(th) / Math.PI) * root;
            const w = th / (2 * vu / 9.81);
            ang = [Rm[0] / fl * w, 0, Rm[6] / fl * w];
          } else {
            const th = Math.atan2(-Rm[3], Rm[4]);
            vu = 1.6 * root;
            const w = th / (2 * vu / 9.81);
            ang = [Rm[2] * w, Rm[5] * w, Rm[8] * w];
          }
          sim.kick(P.b, [0, vu, 0], ang);
          P.wait = 2 * vu / 9.81 + 0.4; this.hops++;
        }
        continue;
      }
      P.tumbleT = 0;

      if (P.rawrDue < 1e8) {
        P.rawrDue -= dt;
        if (P.rawrDue <= 0 && P.grounded) { this.startRawr(P, B); continue; }
        if (P.rawrDue < -6) P.rawrDue = Infinity;
      }

      if (P.mode === 'idle' && P.wait <= 0) this.choose(P, B);
      if (P.mode !== 'walk') continue;
      P.walkT += dt;
      let tx = P.goal[0], tz = P.goal[1], near;
      if (P.berry >= 0) {
        const A = this.drops.list[P.berry];
        if (!A.free || A.held || !this.hungry(P)) { P.berry = -1; P.mode = 'idle'; P.wait = 0.15; continue; }
        // near enough when its muzzle is over the berry (or it has hopped right on top of it)
        const m = this.anchor(P.b, A_MOUTH, this.tmp);
        const md = Math.hypot(A.x[0] - m[0], A.x[2] - m[2]), cd = Math.hypot(A.x[0] - B.c[0], A.x[2] - B.c[2]);
        if ((md < 0.20 * s + A.r || cd < 0.48 * s) && A.x[1] < 0.5 * s && P.grounded) { this.eat(P, B, P.berry); continue; }
        tx = A.x[0]; tz = A.x[2]; near = md;
      } else {
        near = Math.hypot(tx - B.c[0], tz - B.c[2]);
        if (near < 0.3) { P.mode = 'idle'; P.wait = 0.7 + 2.6 * R(); if (R() < 0.3) { P.wagT = 0.8; P.wagClock = 0; } continue; }
      }
      if (P.walkT > 10) { P.berry = -1; P.mode = 'idle'; P.wait = 0.3; continue; }
      if (P.grounded && P.hopT > P.cad) this.hop(P, B, tx, tz, near);
    }
  }

  choose(P, B) {
    const R = this.R;
    P.walkT = 0; P.cad = 0.36 + 0.26 * B.scale + 0.14 * R();
    if (this.hungry(P)) { const i = this.nearestBerry(B); if (i >= 0) { P.berry = i; P.mode = 'walk'; return; } }
    P.berry = -1;
    // now and then: a wiggle of the cottontail, or a curious periscope at nothing in particular
    const r = R();
    if (r < 0.12) { P.wagT = 0.9; P.wagClock = 0; P.wait = 1.0; return; }
    if (r < 0.18) { P.rawrDue = 0; P.wait = 0.2; return; }
    // somewhere else on the table: the best of a few spots, away from the others and from where they are headed
    let best = P.goal, bs = -1;
    for (let k = 0; k < 6; k++) {
      const a = R() * 2 * Math.PI, rad = this.arena * Math.sqrt(R());
      const g = [this.centre[0] + Math.cos(a) * rad, this.centre[1] + Math.sin(a) * rad];
      let sc = Math.min(1.2, Math.hypot(g[0] - B.c[0], g[1] - B.c[2]));
      for (const Q of this.list) if (Q !== P) { const C = this.sim.bodies[Q.b].c; sc = Math.min(sc, Math.hypot(g[0] - C[0], g[1] - C[2]), Math.hypot(g[0] - Q.goal[0], g[1] - Q.goal[1])); }
      if (sc > bs) { bs = sc; best = g; }
    }
    P.goal = best; P.mode = 'walk';
  }

  // one hop toward (tx, tz): a push forward and up, the front a little more than the back, and a turn in the air
  hop(P, B, tx, tz, near) {
    const sim = this.sim, s = B.scale, c = B.c;
    let dx = tx - c[0], dz = tz - c[2];
    const dist = Math.hypot(dx, dz) || 1e-6; dx /= dist; dz /= dist;
    // keep clear of the others
    for (const Q of this.list) if (Q !== P) {
      const QB = sim.bodies[Q.b], ex = c[0] - QB.c[0], ez = c[2] - QB.c[2], d = Math.hypot(ex, ez) || 1e-6, reach = 0.55 * (s + QB.scale) + 0.25;
      if (d < reach) { const k = 1.6 * (1 - d / reach); dx += ex / d * k; dz += ez / d * k; }
    }
    const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const hx = P.head[0], hz = P.head[1];
    const delta = Math.atan2(hz * dx - hx * dz, hx * dx + hz * dz);     // the turn (about +y) that would face it
    const turn = Math.max(-0.75, Math.min(0.75, delta));
    const k = this.calm ? 0.7 : 1, root = Math.sqrt(s);
    const vu = (1.38 + 0.22 * this.R()) * root * k;
    const vf = Math.abs(delta) > 1.1 ? 0.2 : 1.15 * root * k * Math.min(1, 0.3 + near / 0.6);
    const T = 2 * vu / 9.81;
    const ch = Math.cos(turn / 2), sh = Math.sin(turn / 2), mx = hx * ch + hz * sh, mz = -hx * sh + hz * ch;
    sim.kick(P.b, [mx * vf, vu, mz * vf], [0, turn / T, 0], 0.28 * vu);
    P.hopT = 0; this.hops++;
  }

  eat(P, B, i) {
    const S = P.slots.find(q => q.t < 0);
    if (!S) return;
    const A = this.drops.list[i];
    A.free = false; A.hidden = true; A.held = false; this.drops.count();
    S.t = 0; S.grow = 0; S.age = 0; S.life = 40 + 25 * this.R();
    this.eaten++;
    P.berry = -1; P.mode = 'idle'; P.wait = 0.9; P.wagT = 1.2; P.wagClock = 0;
    this.sim.nod(P.b, 1.3 * Math.sqrt(B.scale));
  }
  startRawr(P, B) {
    P.rawrT = 0; P.rawrDue = Infinity; P.mode = 'idle'; P.berry = -1;
    const root = Math.sqrt(B.scale);
    this.sim.kick(P.b, [0, 0.5 * root, 0], [0, 0, 0], 1.0 * root);
    this.rawrs++;
  }
  endRawr(P, B) {
    this.sim.pose(P.b, 0, 0); B.poseK = 0;
    P.rawrT = -1; P.mode = 'idle'; P.wait = 0.3 + 0.5 * this.R();
  }
}
