// ===== main.js =====
// ─────────────────────────────────────────────────────────────
//  App: sim ↔ render glue, camera, picking, the berries, the lights, UI
// ─────────────────────────────────────────────────────────────

const srgbToLin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linToSrgb = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const hex = rgb => '#' + rgb.map(c => Math.round(Math.min(1, Math.max(0, linToSrgb(c))) * 255).toString(16).padStart(2, '0')).join('');
const hexLin = h => [1, 3, 5].map(i => srgbToLin(parseInt(h.slice(i, i + 2), 16) / 255));
const vnorm = v => { const l = Math.hypot(...v) || 1; return v.map(q => q / l); };
const lerp3 = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);

// three colourways (authored in sRGB, used in linear RGB)
// flesh: the clear jelly in transmission, density: how strongly it absorbs · fleshDeep: its scattering
// cola: the dark layer (the belly band and the paddles) · cream: the snout and the shell bands · ring: the pale shell bands
// skin: the line of the mouth · seed: the eyes and nose · berry, berryIn: a berry on the table and inside · glow: its light
const PALETTES = {
  seaGlass: {
    name: 'Sea Glass',
    flesh: hexLin('#b3e2d4'), density: 1.9, fleshDeep: hexLin('#4fc0a0'), cola: hexLin('#1a4a48'), cream: hexLin('#e8f5f0'),
    skin: hexLin('#7ab9a6'), seed: hexLin('#1f4a48'), berry: hexLin('#66d4b4'), berryIn: hexLin('#e8fff5'), glow: hexLin('#a3e6d4'),
    ring: hexLin('#d9f3e8'), ringW: 0.4, shadowTint: [0.5, 0.6, 0.55], rough: 0.06,
    ui: { deep: hexLin('#4fc0a0'), mid: hexLin('#b3e2d4'), pale: hexLin('#1a4a48') },
  },
  coral: {
    name: 'Coral',
    flesh: hexLin('#ef9e6a'), density: 2.0, fleshDeep: hexLin('#d45a36'), cola: hexLin('#3a1a14'), cream: hexLin('#fff5e8'),
    skin: hexLin('#c45a30'), seed: hexLin('#20160c'), berry: hexLin('#ffb050'), berryIn: hexLin('#ffe5c8'), glow: hexLin('#ffc088'),
    ring: hexLin('#ffdec8'), ringW: 0.5, shadowTint: [0.65, 0.45, 0.38], rough: 0.07,
    ui: { deep: hexLin('#d45a36'), mid: hexLin('#ef9e6a'), pale: hexLin('#3a1a14') },
  },
  mint: {
    name: 'Mint',
    flesh: hexLin('#c8e9cf'), density: 1.8, fleshDeep: hexLin('#5db880'), cola: hexLin('#1d4a40'), cream: hexLin('#eaf7e8'),
    skin: hexLin('#8ec4a0'), seed: hexLin('#204034'), berry: hexLin('#48cf8a'), berryIn: hexLin('#d4ffdc'), glow: hexLin('#9ae8c0'),
    ring: hexLin('#dff3e6'), ringW: 0.35, shadowTint: [0.45, 0.55, 0.45], rough: 0.05,
    ui: { deep: hexLin('#5db880'), mid: hexLin('#c8e9cf'), pale: hexLin('#1d4a40') },
  },
};

// the backdrop, chosen so that after the Neutral tone map it lands exactly on the page colour (lights on / out)
function invNeutral(o) {
  const m = Math.min(...o);
  const off = m >= 0.04 ? 0.04 : Math.sqrt(m / 6.25) - m;
  return o.map(v => v + off);
}
const BG_ON = invNeutral(hexLin('#e2dfda'));
const BG_OFF = invNeutral(hexLin('#15181e'));

const SCALE_CM = 2.0;      // illustrative: 1 simulation unit ≈ 2 cm (the biggest turtle is ≈ 3.6 cm from nose to tail tip)
const DENSITY = 1.3;       // g/cm³, gummy candy

// the three of them: how big each is, and where it is put down (x, z, the way it faces)
const TRIO = [
  { scale: 1.0, x: -0.8, z: 0.35, yaw: 0.5 },
  { scale: 0.84, x: 0.8, z: 0.55, yaw: 2.6 },
  { scale: 0.68, x: -0.05, z: -0.95, yaw: -1.8 },
];

const $ = s => document.querySelector(s);

function setStatus(text, state) {
  const el = $('#status');
  $('#statusText').textContent = text;
  el.dataset.state = state;
}

function showFallback(title, detail) {
  const f = $('#fallback');
  f.hidden = false;
  $('#fallbackTitle').textContent = title;
  $('#fallbackDetail').textContent = detail;
  document.body.classList.add('no-gpu');
  setStatus('THREE.JS · UNAVAILABLE', 'off');
  for (const el of document.querySelectorAll('.panel button, .panel input')) el.disabled = true;
}

async function main() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const canvas = $('#gl');
  const N = TRIO.length;

  // ── build everything once: one turtle's lattice and surfaces, then the table of them ──
  const simMesh = buildSimMesh(0.13);
  const scene = buildScene(N);
  const PM = scene.animal, nV1 = scene.nV1, nV = scene.rest.length / 3, fixedV = PM.fixedVerts;
  const dropList = scene.drops;
  const emb = embed(simMesh.rest, simMesh.tets, new Float32Array(PM.pos), [fixedV, nV1 - fixedV]);
  const embC = embed(simMesh.rest, simMesh.tets, new Float32Array(ANCHORS.flat()));
  const sim = new SoftBody(simMesh, TRIO, { firmness: 0.5, damping: reduced.matches ? 0.65 : 0.4 });
  const n1 = sim.n1, T1 = simMesh.tets;
  const vol0 = sim.totalRestVolume;
  const drops = new DropSet(dropList, sim);
  // a point that rides the jelly of turtle b: point i of ANCHORS, wherever its tetrahedron has gone
  const anchor = (b, i, out) => {
    const x = sim.x, i4 = 4 * i, t = 4 * embC.tetOf[i], p0 = b * n1;
    const a = 3 * (T1[t] + p0), b2 = 3 * (T1[t + 1] + p0), c = 3 * (T1[t + 2] + p0), d = 3 * (T1[t + 3] + p0);
    const w0 = embC.w[i4], w1 = embC.w[i4 + 1], w2 = embC.w[i4 + 2], w3 = embC.w[i4 + 3];
    out[0] = x[a] * w0 + x[b2] * w1 + x[c] * w2 + x[d] * w3;
    out[1] = x[a + 1] * w0 + x[b2 + 1] * w1 + x[c + 1] * w2 + x[d + 1] * w3;
    out[2] = x[a + 2] * w0 + x[b2 + 2] * w1 + x[c + 2] * w2 + x[d + 2] * w3;
    return out;
  };
  const troupe = new Troupe(sim, drops, { anchor, arena: 1.7, calm: reduced.matches });

  // the loose berries are rigid, and the berries inside ride their paths: both keep their vertices as offsets from a centre
  const dropOf = new Int32Array(nV).fill(-1), dropOff = new Float32Array(nV * 3);
  dropList.forEach((A, i) => { for (let v = A.v0; v < A.v0 + A.nv; v++) { dropOf[v] = i; for (let k = 0; k < 3; k++) dropOff[3 * v + k] = scene.rest[3 * v + k] - A.p[k]; } });
  const slotOf = new Int32Array(nV1).fill(-1), beadOff = new Float32Array(nV1 * 3);
  PM.tummy.forEach((A, i) => { for (let v = A.v0; v < A.v0 + A.nv; v++) { slotOf[v] = i; for (let k = 0; k < 3; k++) beadOff[3 * v + k] = PM.pos[3 * v + k] - A.p[k]; } });
  const index = scene.index;
  const bodyTriEnd = scene.body.count;
  const coreFirst = scene.core.first, coreEnd = scene.core.first + scene.core.count;

  let currentPalette = 'russet';
  const swatches = $('#swatches');
  for (const [key, p] of Object.entries(PALETTES)) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'swatch'; b.dataset.key = key;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', p.name + ' turtles');
    b.innerHTML = `<span class="chip"><i style="background:${hex(p.ui.mid)}"></i><i style="background:${hex(p.ui.deep)}"></i><i style="background:${hex(p.ui.pale)}"></i></span><span class="swname">${p.name}</span>`;
    b.addEventListener('click', () => setPalette(key));
    swatches.appendChild(b);
  }
  function setPalette(key) {
    currentPalette = key;
    for (const b of swatches.children) b.setAttribute('aria-checked', String(b.dataset.key === key));
    document.documentElement.style.setProperty('--accent', hex(PALETTES[key].ui.mid));
    document.documentElement.style.setProperty('--glow', hex(PALETTES[key].glow));
  }
  setPalette('seaGlass');

  let renderer;
  try {
    renderer = await Renderer.create(canvas, { mesh: scene, simEdges: sim.edges, nParticles: sim.n });
  } catch (err) {
    console.warn(err);
    const msg = String(err && err.message || err);
    if (msg === 'no-webgl2' || /WebGL context/i.test(msg)) showFallback('These turtles need WebGL 2.', 'The browser could not create a WebGL 2 context, so three.js has nothing to draw with. Switch hardware acceleration on, or try a current Chrome, Edge, Firefox or Safari.');
    else if (msg === 'no-float-targets') showFallback('Float render targets are missing.', 'This GPU exposes WebGL 2 but not EXT_color_buffer_float, which the jelly needs for its depth and HDR passes. Try another browser or device.');
    else showFallback('The renderer could not start.', msg.slice(0, 400));
    return;
  }
  const dyn = renderer.dyn;
  const D = DYN;
  // the eyes, noses and bubbles carry their own (rest-space) centre for the shader
  for (let b = 0; b < N; b++) for (let v = PM.bodyVerts; v < fixedV; v++) for (let k = 0; k < 4; k++) dyn[D * (b * nV1 + v) + 6 + k] = PM.ctr[4 * v + k];
  const camera = renderer.camera;
  const vp = new THREE.Matrix4(), ivp = new THREE.Matrix4();

  // ── state ──
  const state = {
    paused: false, slow: false, showMesh: false,
    az: 0.62, el: 0.4, zoom: 1,
    time: 0,
    lightsOut: false, dark: 0,
  };
  renderer.onLost = () => setStatus('THREE.JS · CONTEXT LOST', 'off');
  renderer.onRestored = () => { setStatus(state.paused ? 'THREE.JS · PAUSED' : 'THREE.JS · LIVE', state.paused ? 'paused' : 'live'); requestAnimationFrame(frame); };

  // ── skinning: the jelly, the dark layer, the eyes, the nose and the bubbles follow their tetrahedra;
  //    a berry inside rides along its path, between the points of it that ride the jelly;
  //    a loose berry is rigid; one not yet tossed (or eaten) waits, folded to a point, under the table ──
  const nsm = new Float32Array(N * nV1 * 3);
  const kp = [0, 0, 0], ka = [0, 0, 0], kb = [0, 0, 0];
  const slotAt = (b, si, t, out) => {
    const f = Math.min(Math.max(t, 0), 1) * (KP - 1), j = Math.min(KP - 2, Math.floor(f)), u = f - j;
    anchor(b, A_PATH + si * KP + j, ka); anchor(b, A_PATH + si * KP + j + 1, kb);
    for (let k = 0; k < 3; k++) out[k] = ka[k] + (kb[k] - ka[k]) * u;
    return out;
  };
  const hole = scene.home;
  const tetOf = emb.tetOf, skinW = emb.w;
  function skin() {
    const x = sim.x, L = drops.list;
    for (let b = 0; b < N; b++) {
      const base = b * nV1, p0 = b * n1, s = sim.bodies[b].scale, slots = troupe.list[b].slots;
      for (let lv = 0; lv < fixedV; lv++) {
        const o = D * (base + lv), i4 = 4 * lv, t = 4 * tetOf[lv];
        const a = 3 * (T1[t] + p0), b2 = 3 * (T1[t + 1] + p0), c = 3 * (T1[t + 2] + p0), d = 3 * (T1[t + 3] + p0);
        const w0 = skinW[i4], w1 = skinW[i4 + 1], w2 = skinW[i4 + 2], w3 = skinW[i4 + 3];
        dyn[o] = x[a] * w0 + x[b2] * w1 + x[c] * w2 + x[d] * w3;
        dyn[o + 1] = x[a + 1] * w0 + x[b2 + 1] * w1 + x[c + 1] * w2 + x[d + 1] * w3;
        dyn[o + 2] = x[a + 2] * w0 + x[b2 + 2] * w1 + x[c + 2] * w2 + x[d + 2] * w3;
        dyn[o + 3] = 0; dyn[o + 4] = 0; dyn[o + 5] = 0;
      }
      let last = -1, c = hole, g = 0;
      for (let lv = fixedV; lv < nV1; lv++) {
        const o = D * (base + lv), si = slotOf[lv], k3 = 3 * lv;
        if (si !== last) {
          last = si;
          const K = slots[si];
          if (K.t >= 0) { c = slotAt(b, si, K.t, kp); g = K.grow * s; } else { c = hole; g = 0; }
        }
        dyn[o] = c[0] + beadOff[k3] * g; dyn[o + 1] = c[1] + beadOff[k3 + 1] * g; dyn[o + 2] = c[2] + beadOff[k3 + 2] * g;
        dyn[o + 3] = 0; dyn[o + 4] = 0; dyn[o + 5] = 0;
        dyn[o + 6] = c[0]; dyn[o + 7] = c[1]; dyn[o + 8] = c[2]; dyn[o + 9] = PM.tummy[si].r * s;
      }
    }
    for (let v = N * nV1; v < nV; v++) {
      const o = D * v, A = L[dropOf[v]];
      if (A.free) {
        const R = A.R, k = 3 * v, ox = dropOff[k], oy = dropOff[k + 1], oz = dropOff[k + 2];
        dyn[o] = A.x[0] + R[0] * ox + R[1] * oy + R[2] * oz;
        dyn[o + 1] = A.x[1] + R[3] * ox + R[4] * oy + R[5] * oz;
        dyn[o + 2] = A.x[2] + R[6] * ox + R[7] * oy + R[8] * oz;
        dyn[o + 6] = A.x[0]; dyn[o + 7] = A.x[1]; dyn[o + 8] = A.x[2];
      } else {
        dyn[o] = hole[0]; dyn[o + 1] = hole[1]; dyn[o + 2] = hole[2];
        dyn[o + 6] = hole[0]; dyn[o + 7] = hole[1]; dyn[o + 8] = hole[2];
      }
      dyn[o + 3] = 0; dyn[o + 4] = 0; dyn[o + 5] = 0;
      dyn[o + 9] = A.r;
    }
    for (let t = 0; t < index.length; t += 3) {
      const a = D * index[t], b = D * index[t + 1], c = D * index[t + 2];
      const e1x = dyn[b] - dyn[a], e1y = dyn[b + 1] - dyn[a + 1], e1z = dyn[b + 2] - dyn[a + 2];
      const e2x = dyn[c] - dyn[a], e2y = dyn[c + 1] - dyn[a + 1], e2z = dyn[c + 2] - dyn[a + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      dyn[a + 3] += nx; dyn[a + 4] += ny; dyn[a + 5] += nz;
      dyn[b + 3] += nx; dyn[b + 4] += ny; dyn[b + 5] += nz;
      dyn[c + 3] += nx; dyn[c + 4] += ny; dyn[c + 5] += nz;
    }
    for (let o = 0; o < dyn.length; o += D) {
      const l = Math.hypot(dyn[o + 3], dyn[o + 4], dyn[o + 5]) || 1;
      dyn[o + 3] /= l; dyn[o + 4] /= l; dyn[o + 5] /= l;
    }
    // one smoothing pass over the jelly's surface and the dark layer: the lattice deforms piecewise-linearly,
    // and without this the studio's reflections pick out every kink between tetrahedra
    nsm.fill(0);
    const smooth = (t0, t1) => {
      for (let t = t0; t < t1; t += 3) {
        const a = index[t], b = index[t + 1], c = index[t + 2];
        const A = D * a, B = D * b, C = D * c;
        const sx = dyn[A + 3] + dyn[B + 3] + dyn[C + 3], sy = dyn[A + 4] + dyn[B + 4] + dyn[C + 4], sz = dyn[A + 5] + dyn[B + 5] + dyn[C + 5];
        nsm[3 * a] += sx; nsm[3 * a + 1] += sy; nsm[3 * a + 2] += sz;
        nsm[3 * b] += sx; nsm[3 * b + 1] += sy; nsm[3 * b + 2] += sz;
        nsm[3 * c] += sx; nsm[3 * c + 1] += sy; nsm[3 * c + 2] += sz;
      }
    };
    smooth(0, bodyTriEnd); smooth(coreFirst, coreEnd);
    for (let v = 0; v < N * nV1; v++) {
      const k = 3 * v, l = Math.hypot(nsm[k], nsm[k + 1], nsm[k + 2]);
      if (l > 1e-9) { dyn[D * v + 3] = nsm[k] / l; dyn[D * v + 4] = nsm[k + 1] / l; dyn[D * v + 5] = nsm[k + 2] / l; }
    }
  }

  // ── camera & framing (keeps the turtles clear of the text and panel) ──
  const cam = { viewProj: null, view: null, invViewProj: null, pos: [0, 0, 0], fwd: [0, 0, -1] };
  const target = [0, 0.34, 0.0];
  const FOV = 27 * Math.PI / 180;
  function safeRect() {
    const cr = canvas.getBoundingClientRect();
    if (document.body.classList.contains('stacked')) return { x: 0, y: 0, w: cr.width, h: cr.height };
    const panel = $('.panel').getBoundingClientRect();
    const head = $('.masthead').getBoundingClientRect();
    const read = $('.readouts').getBoundingClientRect();
    const left = Math.min(head.right - cr.left, cr.width * 0.24) * 0.55;
    const right = panel.left - cr.left - 12;
    const top = Math.min(head.bottom - cr.top, cr.height * 0.34) * 0.5;
    const bottom = read.top - cr.top + 24;
    return { x: left, y: top, w: Math.max(200, right - left), h: Math.max(200, bottom - top) };
  }
  // the camera eases a little way after the turtles, wherever the three of them are (never while one is held)
  const home = target.slice();
  function follow(dt) {
    if (drag.mode === 'grab') return;
    let mx = 0, mz = 0;
    for (const B of sim.bodies) { mx += B.c[0] / N; mz += B.c[2] / N; }
    const k = 1 - Math.exp(-dt * 1.2);
    target[0] += (home[0] + mx * 0.45 - target[0]) * k; target[2] += (home[2] + mz * 0.45 - target[2]) * k;
    troupe.centre[0] = home[0]; troupe.centre[1] = home[2];
  }
  function updateCamera() {
    const W = renderer.w, H = renderer.h;
    const cr = canvas.getBoundingClientRect();
    const r = safeRect();
    const aspect = W / H;
    const hf = r.h / cr.height, wf = r.w / cr.width;
    // fit the table the turtles keep to, with room for the one that has just been flung
    const st = document.body.classList.contains('stacked');
    const Rh = troupe.arena + (st ? 0.5 : 0.6), Rv = st ? 1.25 : 0.98;
    const t2 = Math.tan(FOV / 2);
    const dist = Math.max(Rv / (t2 * 0.9 * hf), Rh / (t2 * 0.92 * aspect * wf)) * state.zoom;
    const ce = Math.cos(state.el);
    const eye = [target[0] + dist * Math.sin(state.az) * ce, target[1] + dist * Math.sin(state.el), target[2] + dist * Math.cos(state.az) * ce];
    camera.fov = FOV * 180 / Math.PI; camera.aspect = aspect; camera.near = 0.1; camera.far = 80;
    camera.position.set(eye[0], eye[1], eye[2]);
    camera.lookAt(target[0], target[1], target[2]);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    // lens shift so the target lands at the centre of the safe rect
    const cx = (r.x + r.w / 2) / cr.width, cy = (r.y + r.h / 2) / cr.height;
    const pe = camera.projectionMatrix.elements;
    pe[8] -= (cx * 2 - 1); pe[9] -= -(cy * 2 - 1);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    ivp.copy(vp).invert();
    cam.view = camera.matrixWorldInverse.elements; cam.viewProj = vp.elements; cam.invViewProj = ivp.elements;
    cam.pos = eye;
    const f = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
    const fl = Math.hypot(...f); cam.fwd = f.map(v => v / fl);
  }

  // light rig: key from behind and above (so ears and tails glow toward the camera)
  const keyDir = vnorm([-0.45, 0.86, -0.36]);
  const light = { dir: keyDir, intensity: 2.3, at: [0, 0.3, 0] };
  function updateLight() {
    // shadow and height maps are centred where the camera looks, which is where the turtles are
    light.at = [target[0], 0.3, target[2]];
    light.intensity = 2.3 * (1 - 0.86 * state.dark);
  }

  // ── resize ──
  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, window.__fixPR || 2);
    renderer.resize(r.width * dpr, r.height * dpr, r.width, r.height, dpr);
  }
  const stacked = matchMedia('(max-width: 860px), (max-height: 560px) and (max-width: 1000px)');
  const viewEl = () => (stacked.matches ? 0.7 : 0.4);
  const applyLayout = () => {
    document.body.classList.toggle('stacked', stacked.matches);
    // a narrow stage is a smaller table, seen from higher up, so the turtles stay a fair size on it
    troupe.arena = stacked.matches ? 1.3 : 1.7;
    state.el = viewEl();
    resize();
  };
  stacked.addEventListener('change', applyLayout);
  applyLayout();
  new ResizeObserver(resize).observe(canvas);

  // ── picking ──
  function rayFrom(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1, ny = 1 - ((clientY - r.top) / r.height) * 2;
    const m = cam.invViewProj;
    const un = (x, y, z) => {
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
    };
    const a = un(nx, ny, -1), b = un(nx, ny, 1);
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const l = Math.hypot(...d);
    return { o: a, d: d.map(v => v / l) };
  }
  // nearest hit on a turtle's surface: distance along the ray (or Infinity); pickT.body is the turtle that was hit
  function pickT(ray) {
    let best = Infinity, bv = -1;
    const { o, d } = ray;
    for (let t = 0; t < bodyTriEnd; t += 3) {
      const a = D * index[t], b = D * index[t + 1], c = D * index[t + 2];
      const e1x = dyn[b] - dyn[a], e1y = dyn[b + 1] - dyn[a + 1], e1z = dyn[b + 2] - dyn[a + 2];
      const e2x = dyn[c] - dyn[a], e2y = dyn[c + 1] - dyn[a + 1], e2z = dyn[c + 2] - dyn[a + 2];
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const tx = o[0] - dyn[a], ty = o[1] - dyn[a + 1], tz = o[2] - dyn[a + 2];
      const uu = (tx * px + ty * py + tz * pz) * inv; if (uu < 0 || uu > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const vv = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (vv < 0 || uu + vv > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (tt > 1e-4 && tt < best) { best = tt; bv = index[t]; }
    }
    pickT.body = bv < 0 ? -1 : Math.floor(bv / nV1);
    return best;
  }
  // nearest loose drop along the ray (not one hidden behind a turtle)
  function pickDrop(ray, bodyT, touch) {
    const { o, d } = ray;
    let best = -1, bt = Infinity;
    for (let i = 0; i < drops.n; i++) {
      const A = drops.list[i]; if (!A.free) continue;
      const cx = A.x[0] - o[0], cy = A.x[1] - o[1], cz = A.x[2] - o[2];
      const tc = cx * d[0] + cy * d[1] + cz * d[2];
      if (tc <= 0) continue;
      const r = A.r * (touch ? 2.6 : 1.8);
      const d2 = cx * cx + cy * cy + cz * cz - tc * tc;
      if (d2 > r * r) continue;
      const t = tc - Math.sqrt(r * r - d2);
      if (t > bodyT + 0.02) continue;
      if (t < bt) { bt = t; best = i; }
    }
    return best;
  }

  // forgiving fallback for grabs that land just outside the rounded silhouette: the nearest particle on screen
  function pickNear(clientX, clientY, maxPx) {
    const r = canvas.getBoundingClientRect(), M = cam.viewProj, x = sim.x;
    let best = -1, bd = maxPx * maxPx;
    for (let i = 0; i < sim.n; i++) {
      const X = x[3 * i], Y = x[3 * i + 1], Z = x[3 * i + 2];
      const w = M[3] * X + M[7] * Y + M[11] * Z + M[15];
      const sx = r.left + ((M[0] * X + M[4] * Y + M[8] * Z + M[12]) / w * 0.5 + 0.5) * r.width;
      const sy = r.top + (0.5 - (M[1] * X + M[5] * Y + M[9] * Z + M[13]) / w * 0.5) * r.height;
      const dd = (sx - clientX) ** 2 + (sy - clientY) ** 2 - w * 1e-3; // prefer nearer particles on ties
      if (dd < bd) { bd = dd; best = i; }
    }
    pickNear.body = best < 0 ? -1 : sim.bodyOf[best];
    return best < 0 ? null : [x[3 * best], x[3 * best + 1], x[3 * best + 2]];
  }

  // ── pointer interaction ──
  // grab: a turtle · drop: a loose berry, in the hand · orbit: the view
  const drag = { mode: null, id: -1, plane: null, twist: 0, twist0: 0, second: null, lastX: 0, lastY: 0, drop: -1, grabOff: null, body: -1 };
  function rotMat(axis, ang) {
    const [x, y, z] = axis, c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
    return [t * x * x + c, t * x * y - s * z, t * x * z + s * y,
      t * x * y + s * z, t * y * y + c, t * y * z - s * x,
      t * x * z - s * y, t * y * z + s * x, t * z * z + c];
  }
  function dragTarget(clientX, clientY) {
    const ray = rayFrom(clientX, clientY);
    const { p, n } = drag.plane;
    const den = ray.d[0] * n[0] + ray.d[1] * n[1] + ray.d[2] * n[2];
    if (Math.abs(den) < 1e-5) return null;
    const t = ((p[0] - ray.o[0]) * n[0] + (p[1] - ray.o[1]) * n[1] + (p[2] - ray.o[2]) * n[2]) / den;
    const q = [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t];
    // keep the grab within a generous but finite reach, and above the floor
    const dx = q[0] - target[0], dz = q[2] - target[2], lim = 3.4, dl = Math.hypot(dx, dz);
    if (dl > lim) { q[0] = target[0] + dx / dl * lim; q[2] = target[2] + dz / dl * lim; }
    q[1] = Math.min(Math.max(q[1], 0.02), 3.2);
    return q;
  }
  function applyDrag(x, y) {
    const q = dragTarget(x, y);
    if (!q) return;
    if (drag.mode === 'grab') sim.moveGrab(q, rotMat(cam.fwd, drag.twist));
    else if (drag.mode === 'drop') {
      const A = drops.list[drag.drop], o = drag.grabOff || [0, 0, 0];
      q[0] += o[0]; q[1] += o[1]; q[2] += o[2];
      q[1] = Math.max(q[1], A.r);
      A.target = q;
    }
  }
  function letGo() {
    if (drag.mode === 'grab') { sim.endGrab(); troupe.released(drag.body); }
    if (drag.mode === 'drop' && drag.drop >= 0) drops.list[drag.drop].held = false;
    drag.mode = null; drag.id = -1; drag.second = null; drag.drop = -1; drag.body = -1;
  }
  canvas.addEventListener('pointerdown', e => {
    if (drag.mode === 'grab' && e.pointerId !== drag.id && e.pointerType === 'touch') {
      // second finger twists the grabbed patch
      drag.second = { id: e.pointerId, x: e.clientX, y: e.clientY };
      drag.twist0 = drag.twist - Math.atan2(e.clientY - drag.lastY, e.clientX - drag.lastX);
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }
      return;
    }
    if (drag.mode) return;
    if (e.button !== undefined && e.button > 0 && e.pointerType === 'mouse') return;
    drag.id = e.pointerId; drag.lastX = e.clientX; drag.lastY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }
    canvas.dataset.cursor = 'grabbing';
    e.preventDefault();
    if (state.paused) { drag.mode = 'orbit'; canvas.dataset.cursor = 'orbit'; return; }
    const ray = rayFrom(e.clientX, e.clientY), bt = pickT(ray);
    let body = pickT.body;
    const di = pickDrop(ray, bt, e.pointerType === 'touch');
    if (di >= 0) {
      const A = drops.list[di], c = A.x.slice();
      drag.drop = di; drag.mode = 'drop';
      drag.plane = { p: c, n: cam.fwd.slice() };
      const q0 = dragTarget(e.clientX, e.clientY) || c.slice();
      drag.grabOff = [c[0] - q0[0], c[1] - q0[1], c[2] - q0[2]];
      A.held = true; A.target = c; A.sleep = 0;
      return;
    }
    let hit = null;
    if (bt < Infinity) hit = [ray.o[0] + ray.d[0] * bt, ray.o[1] + ray.d[1] * bt, ray.o[2] + ray.d[2] * bt];
    else { hit = pickNear(e.clientX, e.clientY, e.pointerType === 'touch' ? 34 : 18); body = pickNear.body; }
    if (hit && body >= 0) {
      drag.mode = 'grab'; drag.twist = 0; drag.body = body;
      drag.plane = { p: hit, n: cam.fwd.slice() };
      sim.beginGrab(hit, 0.34 * sim.bodies[body].scale, body);
    } else {
      drag.mode = 'orbit';
      canvas.dataset.cursor = 'orbit';
    }
  });
  canvas.addEventListener('pointermove', e => {
    if (drag.second && e.pointerId === drag.second.id) {
      drag.second.x = e.clientX; drag.second.y = e.clientY;
      drag.twist = drag.twist0 + Math.atan2(drag.second.y - drag.lastY, drag.second.x - drag.lastX);
      drag.twist = Math.max(-1.3, Math.min(1.3, drag.twist));
      applyDrag(drag.lastX, drag.lastY);
      return;
    }
    if (e.pointerId !== drag.id || !drag.mode) { hoverX = e.clientX; hoverY = e.clientY; hoverDirty = true; return; }
    const dx = e.clientX - drag.lastX, dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX; drag.lastY = e.clientY;
    if (drag.mode === 'orbit') {
      state.az = state.az - dx * 0.006;
      state.el = Math.max(0.12, Math.min(1.3, state.el + dy * 0.005));
    } else applyDrag(e.clientX, e.clientY);
  });
  const endPointer = e => {
    if (drag.second && e.pointerId === drag.second.id) { drag.second = null; return; }
    if (e.pointerId !== drag.id) return;
    letGo();
    canvas.dataset.cursor = '';
    hoverDirty = true;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('lostpointercapture', endPointer);
  // wheel: twists the held turtle (wherever the pointer is), otherwise zooms when over the stage
  window.addEventListener('wheel', e => {
    if (drag.mode === 'grab') {
      e.preventDefault();
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      drag.twist = Math.max(-1.3, Math.min(1.3, drag.twist + d * 0.004));
      applyDrag(drag.lastX, drag.lastY);
    } else if (e.target === canvas) {
      e.preventDefault();
      state.zoom = Math.max(0.5, Math.min(1.7, state.zoom * Math.exp(e.deltaY * 0.001)));
    }
  }, { passive: false });
  canvas.addEventListener('dblclick', () => { state.az = 0.62; state.el = viewEl(); state.zoom = 1; });
  let hoverX = 0, hoverY = 0, hoverDirty = false;

  // ── UI ──
  const firm = $('#firmness'), damp = $('#damping');
  const firmOut = $('#firmnessOut'), dampOut = $('#dampingOut');
  const syncSliders = () => {
    sim.firmness = firm.value / 100; sim.damping = damp.value / 100;
    firmOut.textContent = (firm.value / 100).toFixed(2);
    dampOut.textContent = (damp.value / 100).toFixed(2);
  };
  firm.value = Math.round(sim.firmness * 100); damp.value = Math.round(sim.damping * 100);
  firm.addEventListener('input', syncSliders); damp.addEventListener('input', syncSliders);
  syncSliders();

  // ── berries: a handful tossed onto the table from above, each from its own height so they arrive one by one ──
  function toss() {
    if (state.paused) return;
    const L = drops.list;
    for (let k = 0; k < 7; k++) {
      let i = L.findIndex(A => A.hidden);
      if (i < 0) {
        // all out: take back the one that has lain still on the table the longest
        let bs = -1;
        L.forEach((A, q) => { if (A.free && !A.held && A.sleep > 0.6 && A.age > bs) { bs = A.age; i = q; } });
      }
      if (i < 0) return;
      const a = Math.random() * 2 * Math.PI, rad = troupe.arena * 0.95 * Math.sqrt(Math.random());
      drops.release(i, [home[0] + Math.cos(a) * rad, 1.5 + 0.3 * k + 0.2 * Math.random(), home[2] + Math.sin(a) * rad],
        [(Math.random() - 0.5) * 0.7, -0.4 * Math.random(), (Math.random() - 0.5) * 0.7],
        [(Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12]);
    }
  }

  let acc = 0;
  $('#rawr').addEventListener('click', () => { if (!state.paused) troupe.rawrAll(); });
  $('#berries').addEventListener('click', toss);
  $('#reset').addEventListener('click', () => {
    letGo();
    canvas.dataset.cursor = '';
    sim.reset(reduced.matches ? 0 : 0.3); drops.reset(); troupe.reset(); acc = 0;
  });
  $('#slow').addEventListener('change', e => { state.slow = e.target.checked; });
  $('#mesh').addEventListener('change', e => { state.showMesh = e.target.checked; });
  const pauseBtn = $('#pause');
  pauseBtn.addEventListener('click', () => {
    state.paused = !state.paused;
    if (state.paused && (drag.mode === 'grab' || drag.mode === 'drop')) letGo();
    pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
    pauseBtn.setAttribute('aria-pressed', String(state.paused));
    setStatus(state.paused ? 'THREE.JS · PAUSED' : 'THREE.JS · LIVE', state.paused ? 'paused' : 'live');
  });
  // the lights: out, the room goes dark and the berries the turtles have eaten are the only light left
  const lightsBtn = $('#lights');
  function setLights(out) {
    state.lightsOut = out;
    document.body.classList.toggle('lights-out', out);
    lightsBtn.textContent = out ? 'Lights on' : 'Lights out';
    lightsBtn.setAttribute('aria-pressed', String(out));
  }
  lightsBtn.addEventListener('click', () => setLights(!state.lightsOut));
  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, button, summary')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ') { e.preventDefault(); pauseBtn.click(); }
    if (e.key === 'r' || e.key === 'R') $('#rawr').click();
    if (e.key === 'b' || e.key === 'B') $('#berries').click();
    if (e.key === 'x' || e.key === 'X') $('#reset').click();
    if (e.key === 'l' || e.key === 'L') lightsBtn.click();
  });

  $('#nParticles').textContent = n1.toLocaleString('en');
  $('#nTets').textContent = sim.nT1.toLocaleString('en');
  $('#nBubbles').textContent = String(PM.bubbleCount);
  $('#nSlots').textContent = String(SLOTS);
  const massOut = $('#massOut'), volOut = $('#volOut'), hopOut = $('#hopOut'), berryOut = $('#berryOut');
  // the mass from the volume enclosed by one turtle's surface (divergence theorem over its triangles), at each one's size
  let encl = 0;
  { const p = PM.pos, I = PM.body; for (let t = 0; t < I.length; t += 3) { const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2];
    encl += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6; } }
  massOut.textContent = (Math.abs(encl) * TRIO.reduce((s, I) => s + I.scale ** 3, 0) * SCALE_CM ** 3 * DENSITY).toFixed(1);
  function updateReadouts() {
    volOut.textContent = (sim.volumeRatio() * sim.totalRestVolume / vol0 * 100).toFixed(1);
    hopOut.textContent = String(troupe.hops);
    berryOut.textContent = String(troupe.inside());
  }

  // keep loose berries on a table of finite size (a soft lip round the edge of the view)
  function corral() {
    for (const A of drops.list) {
      if (!A.free || A.held) continue;
      const dx = A.x[0] - home[0], dz = A.x[2] - home[2], d = Math.hypot(dx, dz), lim = troupe.arena + 1.0;
      if (d > lim) { A.x[0] = home[0] + dx / d * lim; A.x[2] = home[2] + dz / d * lim; const vn = (A.v[0] * dx + A.v[2] * dz) / d; if (vn > 0) { A.v[0] -= 1.5 * vn * dx / d; A.v[2] -= 1.5 * vn * dz / d; } }
    }
  }

  // one fixed step of everything: what the turtles decide, the jelly, the loose berries
  function fixedStep() {
    troupe.step(sim.stepDt);
    sim.step();
    if (drops.freeCount) { drops.step(sim.stepDt); corral(); }
  }
  // a small hook for automated checks
  window.__jelly = { sim, drops, troupe, state, cam, pickT, pickDrop, rayFrom, renderer, toss, anchor, dyn, drag, scene, setLights, setPalette, advance: n => { for (let i = 0; i < n; i++) fixedStep(); }, get fps() { return fps; }, get stepMs() { return stepAvg; } };

  // ── loop ──
  sim.reset(reduced.matches ? 0 : 0.3);
  troupe.step(0);
  let last = performance.now(), fpsStart = last, readoutT = 0, fps = 60, frames = 0, fpsT = 0, first = true, stepAvg = 4;
  skin();
  const glow = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], instDepth = [0, 0, 0], tum = [0, 0, 0];
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!state.paused) {
      acc += dt * (state.slow ? 0.25 : 1);
      let steps = 0;
      while (acc >= sim.stepDt && steps < 3) {
        const t0 = performance.now();
        fixedStep();
        acc -= sim.stepDt; steps++;
        stepAvg += (performance.now() - t0 - stepAvg) * 0.05;
      }
      // a slow device: trade a few substeps for a steady frame rate (once)
      if (stepAvg > 11 && sim.substeps > 7 && state.time > 2) sim.substeps = 7;
      if (steps === 3) acc = Math.min(acc, sim.stepDt);
      state.time += dt;
    }
    // the room's lights ease in and out
    const goal = state.lightsOut ? 1 : 0;
    state.dark += (goal - state.dark) * (1 - Math.exp(-dt * (reduced.matches ? 20 : 3.2)));
    if (Math.abs(goal - state.dark) < 1e-3) state.dark = goal;
    skin();
    follow(dt);
    updateCamera();
    updateLight();
    if (hoverDirty && !drag.mode) {
      hoverDirty = false;
      if (state.paused) canvas.dataset.cursor = '';
      else {
        const ray = rayFrom(hoverX, hoverY), bt = pickT(ray);
        canvas.dataset.cursor = (pickDrop(ray, bt, false) >= 0 || bt < Infinity || pickNear(hoverX, hoverY, 18)) ? 'grab' : '';
      }
    }
    const P = PALETTES[currentPalette];
    // each turtle's light: from the middle of its stomach, as bright as there are berries in it
    for (let b = 0; b < N; b++) {
      const B = sim.bodies[b];
      let k = 0;
      for (const S of troupe.list[b].slots) if (S.t >= 0) k += S.grow * Math.min(1, S.t * 2);
      anchor(b, A_TUM, tum);
      const breathe = reduced.matches ? 0 : 0.1 * Math.sin(state.time * 1.7 + 2.1 * b) + 0.05 * Math.sin(state.time * 4.3 + b);
      glow[b][0] = tum[0]; glow[b][1] = tum[1]; glow[b][2] = tum[2];
      glow[b][3] = Math.min(1, k / 5) * (0.2 + 1.9 * state.dark) * (1 + breathe) * B.scale;
      instDepth[b] = (B.c[0] - cam.pos[0]) * cam.fwd[0] + (B.c[1] - cam.pos[1]) * cam.fwd[1] + (B.c[2] - cam.pos[2]) * cam.fwd[2];
    }
    renderer.setUniforms(cam, light, P, {
      time: state.time, exposure: 1.0, meshAlpha: state.showMesh ? 0.32 : 0,
      bg: lerp3(BG_ON, BG_OFF, state.dark), dark: state.dark, glow, glowC: P.glow, instDepth,
    });
    renderer.uploadGeometry(sim.x, state.showMesh);
    renderer.draw(state.showMesh);
    if (first) { first = false; setStatus('THREE.JS · LIVE', 'live'); document.body.classList.add('ready'); }
    readoutT += dt; frames++; fpsT += dt;
    if (fpsT > 0.5) { fps = frames / ((now - fpsStart) / 1000); frames = 0; fpsT = 0; fpsStart = now; }
    if (readoutT > 0.12) { readoutT = 0; updateReadouts(); }
    if (!renderer.lost) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch(err => { console.error(err); showFallback('Something went wrong while starting.', String(err && err.message || err)); });
