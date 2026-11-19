// ===== shaders.js =====
// ─────────────────────────────────────────────────────────────
//  GLSL (three.js ShaderMaterials): the studio sweep and its soft shadows,
//  everything inside the jelly (the dark layer, the eyes and noses, the
//  berries and their glow, the bubbles), the clear jelly with refraction /
//  Beer–Lambert / scattering and the red panda's own markings, and the
//  tone-map pass.
// ─────────────────────────────────────────────────────────────

const gf = v => (Math.round(v * 1e5) / 1e5).toFixed(5);
const g3 = a => `vec3(${a.map(gf).join(', ')})`;
// the panda's rest-space landmarks, mirrored from geometry.js so the shaders can find the muzzle, the cheeks and
// brows, the ears, the rings of the tail and the line of the dark layer
const GLSL_SHAPE = /* glsl */`
const vec3 EYE_C = ${g3(EYE.p)}; const vec3 EYE_W = ${g3(EYE.w)};
const vec3 HEAD_C = ${g3([SHAPE.head.c[0], SHAPE.head.c[1], 0])};
const vec3 NOSE_C = ${g3(NOSE.s)};
const vec3 BEAK_A = ${g3(SHAPE.beak.a)}; const vec3 BEAK_B = ${g3(SHAPE.beak.b)}; const vec3 BEAK_R = ${g3([SHAPE.beak.ra, SHAPE.beak.rb, 0])};
// the depth range of the key light's orthographic shadow map (far − near)
const float LIGHT_DEPTH = 15.9;
// the height of the line between the clear jelly and the dark layer under it
float darkY(float x) {
  float yb = 0.33 + 0.02 * sin(5.0 * x + 0.4) + 0.008 * sin(13.0 * x);
  yb += (0.1 - yb) * smoothstep(0.2, 0.45, x);
  return yb - 0.5 * (1.0 - smoothstep(-0.6, -0.45, x));
}
`;

const GLSL_COMMON = /* glsl */`
#define PI 3.14159265
uniform mat4 uViewProj;
uniform mat4 uInvViewProj;
uniform mat4 uLightVP;
uniform mat4 uTopVP;
uniform vec4 uCamPos;     // xyz, w = time
uniform vec3 uCamFwd;
uniform vec4 uKeyDir;     // xyz toward light, w = intensity
uniform vec4 uScreen;     // w, h, 1/w, 1/h
uniform vec4 uFlesh;      // the clear jelly's colour in transmission; w = how strongly it absorbs
uniform vec3 uFleshDeep;  // its scattering albedo
uniform vec3 uDark;       // the dark layer: belly and legs
uniform vec3 uCream;      // the muzzle, cheeks, brows and ear rims
uniform vec3 uSkin;       // the line of the mouth
uniform vec4 uRing;     // the pale rings of the tail: rgb their tint, w how strong
uniform vec3 uBerryIn;      // a berry inside
uniform vec3 uSeed;       // the eyes and noses
uniform float uRough;
uniform vec4 uMisc;       // exposure, meshAlpha, floorY, how dark the room is (0 lights on … 1 lights out)
uniform vec3 uBg;
uniform vec3 uShadowTint;
uniform vec3 uBerry;       // a loose berry
uniform vec4 uGlowP[3];   // the berries' glow, one light per panda: xyz the middle of its stomach, w how bright
uniform vec3 uGlowC;
uniform float uInstDepth[3];   // how far each panda's middle is from the camera

float hash3(vec3 p) {
  vec3 q = fract(p * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash3(i), hash3(i + vec3(1.0, 0.0, 0.0)), u.x), mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), u.x), u.y);
  float b = mix(mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), u.x), mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), u.x), u.y);
  return mix(a, b, u.z);
}
float fbm(vec3 p) {
  return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.13 + 7.1) + 0.15 * vnoise(p * 4.37 + 3.3);
}

// rounded rectangle softbox seen along direction d
float softbox(vec3 d, vec3 c, vec3 up, vec2 size, float blur) {
  float cd = dot(d, c);
  if (cd <= 0.0) return 0.0;
  vec3 t1 = normalize(cross(up, c));
  vec3 t2 = cross(c, t1);
  vec2 uv = vec2(dot(d, t1), dot(d, t2)) / cd;
  vec2 q = abs(uv) - size;
  float sd = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - 0.04;
  return 1.0 - smoothstep(-blur, blur, sd);
}

// procedural photo studio: pale cyclorama, overhead softbox, back-left strip, front-right fill card (dimmed with the lights)
vec3 studioEnv(vec3 d, float rough, vec3 bg) {
  float b = 0.012 + rough * 0.55;
  float y = d.y;
  float on = 1.0 - 0.9 * uMisc.w;
  vec3 col = mix(bg * 0.62, bg * 1.05, smoothstep(-0.35, 0.25, y));
  col += bg * 0.55 * (1.0 - smoothstep(0.0, 0.3, abs(y + 0.08)));
  col = mix(col, bg * 0.8, smoothstep(0.3, 1.0, y));
  col += on * vec3(1.0, 0.985, 0.96) * 3.2 * softbox(d, normalize(vec3(0.05, 1.0, -0.15)), vec3(0.0, 0.0, 1.0), vec2(0.55, 0.32), b);
  col += on * vec3(1.0, 0.98, 0.95) * 3.0 * softbox(d, normalize(vec3(-0.42, 0.34, -0.8)), vec3(0.0, 1.0, 0.0), vec2(0.7, 0.06), b);
  col += on * vec3(1.0, 0.97, 0.93) * 4.0 * softbox(d, normalize(vec3(-0.8, 0.38, -0.2)), vec3(0.0, 1.0, 0.0), vec2(0.08, 0.55), b);
  col += on * vec3(0.95, 0.97, 1.0) * 1.2 * softbox(d, normalize(vec3(0.85, 0.3, 0.55)), vec3(0.0, 1.0, 0.0), vec2(0.45, 0.5), b * 1.3);
  return col;
}

float ggx(vec3 N, vec3 V, vec3 L, float rough) {
  vec3 H = normalize(V + L);
  float a = max(rough * rough, 0.002);
  float a2 = a * a;
  float NdH = max(dot(N, H), 0.0);
  float NdL = max(dot(N, L), 0.0);
  float NdV = max(dot(N, V), 1e-3);
  float dd = NdH * NdH * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * dd * dd);
  float k = a * 0.5;
  float G = (NdL / (NdL * (1.0 - k) + k)) * (NdV / (NdV * (1.0 - k) + k));
  return D * G / max(4.0 * NdL * NdV, 1e-3) * NdL;
}

float linearDepth(vec3 p) { return dot(p - uCamPos.xyz, uCamFwd); }
// the berries' light reaching a surface at P facing N
vec3 glowLight(vec3 P, vec3 N, float k) {
  // the light crosses the clear jelly on its way out, so it leaves the berries pale and arrives red
  vec3 sJ = -log(clamp(uFlesh.rgb, vec3(0.002), vec3(0.999))) * uFlesh.w;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    vec3 d = uGlowP[i].xyz - P; float l = length(d);
    acc += uGlowP[i].w * clamp((dot(N, d / max(l, 1e-4)) + 0.4) / 1.4, 0.0, 1.0) / (1.0 + l * l * k) * exp(-sJ * min(l, 0.35) * 0.7);
  }
  return uGlowC * acc;
}
` + GLSL_SHAPE;

const GLSL_SHADOW_FNS = /* glsl */`
uniform sampler2D uShadowDepth;
uniform highp sampler2DShadow uShadowCmp;
uniform sampler2D uHeight;
const vec2 POISSON[16] = vec2[16](
  vec2(-0.94201624, -0.39906216), vec2(0.94558609, -0.76890725), vec2(-0.094184101, -0.92938870), vec2(0.34495938, 0.29387760),
  vec2(-0.91588581, 0.45771432), vec2(-0.81544232, -0.87912464), vec2(-0.38277543, 0.27676845), vec2(0.97484398, 0.75648379),
  vec2(0.44323325, -0.97511554), vec2(0.53742981, -0.47373420), vec2(-0.26496911, -0.41893023), vec2(0.79197514, 0.19090188),
  vec2(-0.24188840, 0.99706507), vec2(-0.81409955, 0.91437590), vec2(0.19984126, 0.78641367), vec2(0.14383161, -0.14100790));

float keyShadow(vec3 P, float bias) {
  vec4 lp = uLightVP * vec4(P, 1.0);
  vec2 uv = lp.xy * 0.5 + 0.5;
  float z = lp.z * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1.0;
  // blocker search → penumbra size (PCSS-lite)
  vec2 dims = vec2(textureSize(uShadowDepth, 0));
  float blk = 0.0; float nb = 0.0;
  for (int i = 0; i < 16; i++) {
    vec2 s = uv + POISSON[i] * 0.02;
    float d = texelFetch(uShadowDepth, ivec2(clamp(s, vec2(0.0), vec2(0.999)) * dims), 0).r;
    if (d < z - bias) { blk += d; nb += 1.0; }
  }
  if (nb < 0.5) return 1.0;
  blk /= nb;
  float pen = clamp((z - blk) * 0.45, 0.003, 0.022);
  float sum = 0.0;
  float rot = hash3(P * 91.7) * 6.2831;
  vec2 cs = vec2(cos(rot), sin(rot));
  for (int i = 0; i < 16; i++) {
    vec2 o = POISSON[i];
    vec2 r = vec2(o.x * cs.x - o.y * cs.y, o.x * cs.y + o.y * cs.x);
    sum += texture(uShadowCmp, vec3(uv + r * pen, z - bias));
  }
  return sum / 16.0;
}

float contactAO(vec3 P) {
  vec4 tp = uTopVP * vec4(P, 1.0);
  vec2 uv = tp.xy * 0.5 + 0.5;
  vec2 dims = vec2(textureSize(uHeight, 0));
  float occ = 0.0;
  // the height map holds (y + 1) / 5 of the lowest surface above each point of the floor
  for (int ring = 0; ring < 3; ring++) {
    float rad = 0.012 + float(ring) * 0.028;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398 + float(ring) * 0.39;
      vec2 s = uv + vec2(cos(a), sin(a)) * rad;
      if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) continue;
      float d = texelFetch(uHeight, ivec2(s * dims), 0).r;
      float h = d * 5.0 - 1.0;
      if (d < 0.9999) {
        float dist = float(ring) * 0.028 * 5.2 + 0.05;
        occ += (1.0 - smoothstep(0.0, 0.55 + dist, h)) * (1.0 - float(ring) * 0.22);
      }
    }
  }
  return clamp(occ / 16.0, 0.0, 1.0);
}

// light from the key that has crossed the clear jelly to reach P: the shadow map holds the depth of the first
// surface toward the light, so the path inside is the difference, absorbed with the jelly's own colour
// (capped near a panda's own thickness: for a point on the floor under a lifted panda, most of it is air)
vec3 jellyLight(vec3 P, vec3 sigJ, float maxPath) {
  vec4 lp = uLightVP * vec4(P, 1.0);
  vec2 uv = lp.xy * 0.5 + 0.5;
  float z = lp.z * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(1.0);
  vec2 dims = vec2(textureSize(uShadowDepth, 0));
  vec3 acc = vec3(0.0);
  for (int k = 0; k < 5; k++) {
    vec2 s = uv + POISSON[k] * 0.004;
    float d = texelFetch(uShadowDepth, ivec2(clamp(s, vec2(0.0), vec2(0.999)) * dims), 0).r;
    float path = min(max(z - d - 0.0006, 0.0) * LIGHT_DEPTH, maxPath);
    acc += exp(-sigJ * path);
  }
  return acc / 5.0;
}
`;

const GLSL_FULL_VS = /* glsl */`
varying vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// deforming meshes: world-space position/normal from the CPU skinning (model matrix = identity), plus rest coords
// and which panda the vertex belongs to
const GLSL_MESH_VS = /* glsl */`
attribute vec3 rest;
attribute float mat;
attribute vec4 ctr;
attribute float inst;
varying vec3 vWp;
varying vec3 vN;
varying vec3 vRest;
varying float vMat;
varying vec4 vCtr;
varying float vInst;
void main() {
  vWp = position; vN = normal; vRest = rest; vMat = mat; vCtr = ctr; vInst = inst;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const GLSL_POS_VS = /* glsl */`
varying vec3 vWp;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWp = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
`;

const GLSL_SHADOW_FS = /* glsl */`
void main() { gl_FragColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0); }
`;

// top-down height map, seen from under the floor so the lowest surface wins; stores (y + 1) / 5
const GLSL_HEIGHT_FS = /* glsl */`
varying vec3 vWp;
void main() { gl_FragColor = vec4((vWp.y + 1.0) / 5.0, 0.0, 0.0, 1.0); }
`;

// ── the studio sweep: soft key shadow tinted by the jelly it crossed, contact occlusion, the berries' glow ──
const GLSL_FLOOR_FS = GLSL_COMMON + GLSL_SHADOW_FNS + /* glsl */`
varying vec2 vNdc;
void main() {
  vec4 a = uInvViewProj * vec4(vNdc, -1.0, 1.0);
  vec4 b = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 ro = a.xyz / a.w;
  vec3 rd = normalize(b.xyz / b.w - ro);
  vec3 col = uBg;
  float dep = 1000.0;
  // slight falloff above the horizon, like a paper sweep lit from above
  col *= 1.0 - 0.08 * smoothstep(0.0, 0.6, rd.y);
  if (rd.y < -1e-4) {
    float t = (uMisc.z - ro.y) / rd.y;
    vec3 P = ro + rd * t;
    dep = linearDepth(P);
    float sh = keyShadow(P, 0.0015);
    float ao = contactAO(P);
    // translucent jelly casts a tinted shadow: pale under the ears and the tail, deep under the body; contact occlusion stays neutral
    vec3 jT = clamp(uFlesh.rgb, vec3(0.002), vec3(0.999));
    vec3 trans = jellyLight(P, -log(jT) * uFlesh.w, 0.75);
    vec3 shadowCol = mix(vec3(1.0), max(trans, uShadowTint * 0.52) * 0.92, (1.0 - sh) * (1.0 - 0.6 * uMisc.w));
    vec3 fl = uBg * (0.9 + 0.1 * clamp(1.0 - length(P.xz - vec2(0.0, 0.8)) * 0.12, 0.0, 1.0));
    fl *= shadowCol;
    fl *= 1.0 - ao * 0.55;
    // the berries' light, coming out through the red of each panda
    for (int i = 0; i < 3; i++) {
      float gd = length(P - uGlowP[i].xyz);
      fl += uGlowC * uGlowP[i].w * 0.1 / (1.0 + gd * gd * 3.5) * exp(log(jT) * uFlesh.w * 0.3) * (1.0 - ao * 0.5);
    }
    float fade = smoothstep(7.0, 22.0, t);
    col = mix(fl, col, fade);
  }
  gl_FragColor = vec4(col, dep);
}
`;

// ── inside / beside the jelly: berries, eyes and noses, the dark layer, bubbles ──
const GLSL_PROPS_FS = GLSL_COMMON + GLSL_SHADOW_FNS + /* glsl */`
varying vec3 vWp;
varying vec3 vN;
varying vec3 vRest;
varying float vMat;
varying vec4 vCtr;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos.xyz - vWp);
  float NdV = max(dot(N, V), 1e-3);
  vec3 L = uKeyDir.xyz;
  float key = uKeyDir.w;
  vec3 keyC = vec3(1.0, 0.97, 0.92) * key;
  float NdL = dot(N, L);
  vec3 jellyT = clamp(uFlesh.rgb, vec3(0.002), vec3(0.999));
  vec3 sigJ = -log(jellyT) * uFlesh.w;
  int m = int(vMat + 0.5);
  float t = uCamPos.w;
  vec3 col;
  if (m == 1) {
    // ── a loose berry: a bead of clear golden jelly, bright where the light comes through it ──
    float sh = keyShadow(vWp, 0.0015);
    float r = max(vCtr.w, 1e-3);
    float chord = 2.0 * r * NdV;
    vec3 sigB = -log(clamp(uBerry, vec3(0.002), vec3(0.999))) * 3.0;
    vec3 T = exp(-sigB * chord * 2.6);
    vec3 behind = uBg * 0.84;
    float wrap = clamp((NdL + 0.5) / 1.5, 0.0, 1.0);
    vec3 amb = uBg * mix(0.35, 0.8, N.y * 0.5 + 0.5);
    float focus = pow(clamp(-NdL * 0.5 + 0.5, 0.0, 1.0), 5.0) * key * 0.8 * sh;
    float thru = pow(clamp(dot(V, -L), 0.0, 1.0), 2.0) * 0.5 * key;
    vec3 base = behind * T + uBerry * (amb * 0.55 + keyC * 0.32 * wrap * mix(0.4, 1.0, sh)) * (1.0 - T)
              + uBerry * (focus + thru) * mix(vec3(1.0), clamp(uBerry, vec3(0.0), vec3(1.0)), 0.5);
    float F = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
    vec3 env = studioEnv(reflect(-V, N), 0.05, uBg);
    // in the dark a berry on the table still glows a little of its own accord
    col = base * (1.0 - F) + env * F + keyC * ggx(N, V, L, 0.05) * sh + uGlowC * uMisc.w * (0.25 + 0.5 * pow(NdV, 0.6));
  } else if (m == 2) {
    // ── an eye: a dark glossy bead, a faint brown ring round the pupil ──
    float sh = keyShadow(vWp, 0.0015);
    vec3 W = vec3(EYE_W.x, EYE_W.y, EYE_W.z * sign(vRest.z));
    float ca = dot(normalize(vRest - vCtr.xyz), W);
    vec3 base = uSeed;
    base = mix(base, base * vec3(3.4, 2.2, 1.5) + vec3(0.012, 0.007, 0.003), (1.0 - smoothstep(0.87, 0.93, ca)) * smoothstep(0.6, 0.78, ca) * 0.8);
    float wrap = clamp((NdL + 0.3) / 1.3, 0.0, 1.0);
    vec3 amb = uBg * mix(0.25, 0.6, N.y * 0.5 + 0.5);
    float F = 0.045 + 0.955 * pow(1.0 - NdV, 5.0);
    vec3 env = studioEnv(reflect(-V, N), 0.06, uBg);
    col = base * (amb + keyC * 0.4 * wrap * mix(0.4, 1.0, sh)) + env * F * 0.9 + keyC * ggx(N, V, L, 0.06) * sh;
  } else if (m == 3) {
    // ── the dark layer: lit by light that has crossed the clear jelly above it, and by the berries ──
    vec3 Q = vRest;
    vec3 T = jellyLight(vWp, sigJ, 1.2);
    float onLine = 1.0 - smoothstep(0.004, 0.03, darkY(Q.x) - Q.y);
    vec3 ambT = mix(vec3(1.0), exp(-sigJ * 0.22), onLine);
    float wrap = clamp((NdL + 0.7) / 1.7, 0.0, 1.0);
    vec3 amb = uBg * mix(0.42, 0.88, N.y * 0.5 + 0.5) * ambT;
    float cloud = fbm(Q * 7.0 + vec3(3.0));
    vec3 base = uDark * (0.9 + 0.2 * cloud);
    col = base * (amb + keyC * 0.6 * wrap * T) + base * T * key * 0.06 + base * glowLight(vWp, N, 9.0) * 1.6;
  } else if (m == 4) {
    // ── a bubble: a pocket of air, bright round its rim and clear in the middle ──
    vec3 T = jellyLight(vWp, sigJ, 1.2);
    float rim = pow(1.0 - NdV, 2.0);
    vec3 env = studioEnv(reflect(-V, N), 0.08, uBg);
    vec3 clear = uBg * 0.95 * mix(vec3(1.0), T, 0.4);
    col = mix(clear, env * 0.7 + vec3(0.05), rim * 0.7) + keyC * ggx(N, V, L, 0.06) * T * 0.5 + glowLight(vWp, N, 10.0) * rim * 0.4;
  } else if (m == 5) {
    // ── a nose: a dark glossy bead ──
    float sh = keyShadow(vWp, 0.0015);
    float wrap = clamp((NdL + 0.3) / 1.3, 0.0, 1.0);
    vec3 amb = uBg * mix(0.25, 0.6, N.y * 0.5 + 0.5);
    float F = 0.045 + 0.955 * pow(1.0 - NdV, 5.0);
    vec3 env = studioEnv(reflect(-V, N), 0.1, uBg);
    col = uSeed * 1.6 * (amb + keyC * 0.4 * wrap * mix(0.4, 1.0, sh)) + env * F * 0.8 + keyC * ggx(N, V, L, 0.1) * sh;
  } else {
    // ── a berry inside: pale gold, lit through the jelly round it, glowing when the lights are out ──
    vec3 T = jellyLight(vWp, sigJ, 1.2);
    float wrap = clamp((NdL + 0.6) / 1.6, 0.0, 1.0);
    vec3 amb = uBg * mix(0.4, 0.85, N.y * 0.5 + 0.5);
    float F = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
    vec3 env = studioEnv(reflect(-V, N), 0.1, uBg);
    float core = pow(NdV, 0.6);
    vec3 base = mix(uBerryIn * 0.6, uBerryIn, core);
    vec3 em = uGlowC * (0.22 + 1.9 * uMisc.w) * (0.4 + 0.8 * core);
    col = base * (amb * 0.9 + keyC * 0.5 * wrap * T) + em + keyC * ggx(N, V, L, 0.1) * T * 0.5 + env * F * 0.35;
  }
  gl_FragColor = vec4(col, linearDepth(vWp));
}
`;

// ── back faces → linear depth, for view-ray thickness: each panda's into its own channel, farthest wins (MAX blend).
//    Depths are kept relative to that panda's middle, so they keep their precision in a half-float target. ──
const GLSL_BACK_VS = /* glsl */`
attribute float inst;
varying vec3 vWp;
varying float vInst;
void main() { vWp = position; vInst = inst; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }
`;
const GLSL_BACK_FS = GLSL_COMMON + /* glsl */`
varying vec3 vWp;
varying float vInst;
void main() {
  int i = int(vInst + 0.5);
  float d = max(linearDepth(vWp) - uInstDepth[i] + 2.0, 0.01);
  gl_FragColor = vec4(i == 0 ? d : 0.0, i == 1 ? d : 0.0, i == 2 ? d : 0.0, 0.0);
}
`;

const GLSL_COPY_FS = /* glsl */`
uniform sampler2D uSceneTex;
void main() { gl_FragColor = vec4(texelFetch(uSceneTex, ivec2(gl_FragCoord.xy), 0).rgb, 1.0); }
`;

// ── the clear jelly ──
const GLSL_JELLY_FS = GLSL_COMMON + /* glsl */`
uniform sampler2D uSceneTex;
uniform sampler2D uBackTex;
varying vec3 vWp;
varying vec3 vN;
varying vec3 vRest;
varying float vInst;

vec2 toUV(vec3 p) {
  vec4 c = uViewProj * vec4(p, 1.0);
  return c.xy / c.w * 0.5 + 0.5;
}
// bump a normal by a scalar height field using screen-space derivatives (Mikkelsen 2010): no tangents needed,
// and the pattern stays glued to the rest-space coordinates of the jelly
vec3 bumpNormal(vec3 N, vec3 P, float h) {
  vec3 dPx = dFdx(P), dPy = dFdy(P);
  float dhx = dFdx(h), dhy = dFdy(h);
  vec3 r1 = cross(dPy, N), r2 = cross(N, dPx);
  float det = dot(dPx, r1);
  vec3 g = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * N - g);
}

void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 P = vWp;
  vec3 V = normalize(uCamPos.xyz - P);
  vec3 L = uKeyDir.xyz;
  float key = uKeyDir.w;

  // ── a flamingo's markings, all from rest-space coordinates (so they ride the wobble) ──
  vec3 Q = vRest;
  float az = abs(Q.z);
  vec3 q = vec3(Q.x, Q.y, az);
  // the folded wing: a deeper rose patch on the upper flank (both sides, since z is mirrored)
  float wing = 1.0 - smoothstep(0.7, 1.0, length((q - vec3(-0.05, 0.5, 0.0)) / vec3(0.34, 0.24, 0.42)));
  wing *= smoothstep(0.66, 0.58, q.y);                 // keep it off the very top of the back
  // the bill: a black tip and a faint pink gape line
  vec3 bd = BEAK_B - BEAK_A; float bl = length(bd); bd /= bl;
  float bs = dot(Q - BEAK_A, bd);
  float onBeak = smoothstep(0.04, 0.12, bs) * (1.0 - smoothstep(BEAK_R.x * 1.3, BEAK_R.x * 0.5, length(Q - BEAK_A - bd * bs)));
  float tip = onBeak * smoothstep(bl * 0.42, bl * 0.66, bs);
  float gape = onBeak * (1.0 - smoothstep(0.004, 0.012, abs(length(Q - BEAK_A - bd * bs) - BEAK_R.y * 0.5)));
  // the eye: a pale patch round it
  float eyeP = 1.0 - smoothstep(0.6, 1.1, length((q - EYE_C) / vec3(0.08, 0.08, 0.1)));
  // the mouth: a short dark line where the bill meets the face
  float mb = 0.84;
  float mouth = (1.0 - smoothstep(0.0035, 0.009, az)) * step(mb - 0.05, Q.y) * step(Q.y, mb);
  float fw = length(fwidth(Q));
  float aa = 1.0 - smoothstep(0.012, 0.03, fw);
  float graze = smoothstep(0.05, 0.4, abs(dot(N, V)));
  float bumpH = (-0.0045 * mouth + (vnoise(Q * 46.0) - 0.5) * 0.0009) * aa * graze;
  N = bumpNormal(N, P, bumpH);
  float NdV = max(dot(N, V), 1e-3);

  // ── thickness along the view ray: to the back faces, or to whatever sits inside (the dark layer, a bubble, a berry) ──
  vec2 uv = gl_FragCoord.xy * uScreen.zw;
  ivec2 pix = ivec2(gl_FragCoord.xy);
  float fz = linearDepth(P);
  // (this panda's own back faces: another panda behind it must not thicken it)
  int ii = int(vInst + 0.5);
  vec4 bk = texelFetch(uBackTex, pix, 0);
  float bv = ii == 0 ? bk.r : (ii == 1 ? bk.g : bk.b);
  float bz = bv > 0.005 ? bv - 2.0 + uInstDepth[ii] : fz;
  float sz = texelFetch(uSceneTex, pix, 0).a;
  float cosv = max(dot(-V, uCamFwd), 0.35);
  float thick = clamp((min(bz, sz) - fz) / cosv, 0.0, 3.0);
  float thickBack = clamp((bz - fz) / cosv, 0.0, 3.0);

  // ── the clear jelly: Beer–Lambert absorption in its own colour, a faint cloud ──
  float grain = fbm(Q * 9.0);
  float dens = 1.0 + (grain - 0.5) * 0.18;
  vec3 jellyT = clamp(uFlesh.rgb, vec3(0.002), vec3(0.999));
  vec3 sigma = -log(jellyT) * uFlesh.w * dens;
  float scatK = 1.1;
  float rough = uRough;

  // ── refraction: bend the view ray into the jelly, find what it meets ──
  float ior = 1.4;
  vec3 Rr = refract(-V, N, 1.0 / ior);
  vec3 exitP = P + Rr * min(thick, 0.9) * 0.5;
  vec2 ruv = mix(uv, toUV(exitP), 0.85);
  float blurR = 0.0008 + 0.0035 * min(thick, 1.0);
  vec3 transmitted = vec3(0.0);
  float pathL = 0.0;
  for (int k = 0; k < 7; k++) {
    float a = float(k) * 0.8976 + 0.3;
    vec2 o = k == 6 ? vec2(0.0) : vec2(cos(a), sin(a)) * blurR;
    vec4 s = textureLod(uSceneTex, clamp(ruv + o, vec2(0.001), vec2(0.999)), 0.0);
    float pl = clamp(min(thickBack, max(s.a - fz, 0.0) / cosv + 0.01), 0.0, 3.0);
    transmitted += s.rgb * exp(-sigma * pl);
    pathL += pl;
  }
  transmitted /= 7.0; pathL /= 7.0;
  float scat = 1.0 - exp(-scatK * pathL * 0.5 - 0.015);

  // ── light scattered inside the body ──
  float NdL = dot(N, L);
  float wrap = clamp((NdL + 0.6) / 1.6, 0.0, 1.0);
  vec3 amb = uBg * mix(0.3, 0.75, N.y * 0.5 + 0.5);
  vec3 inner = uFleshDeep * (amb + vec3(1.0, 0.97, 0.92) * key * 0.45 * wrap);
  // the berries' light, caught in the jelly round them
  vec3 sq = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float gd = length(P - uGlowP[i].xyz);
    sq += uGlowC * uGlowP[i].w * exp(-gd * 3.4) * (1.0 - exp(-pathL * 1.6)) * exp(-sigma * min(gd, 0.35) * 0.7) * 1.3;
  }

  // thin parts (the ears, the end of the tail) glow when the key light is behind them
  float back = pow(clamp(dot(V, -L), 0.0, 1.0), 3.0) * 1.4 + 0.25;
  vec3 thinK = exp(-sigma * (pathL * 0.6 + 0.04));
  vec3 glow = jellyT * thinK * back * key * 0.38 * clamp(1.0 - NdL * 0.6, 0.0, 1.0);

  vec3 body = transmitted * (1.0 - scat) + inner * scat + glow + sq;
  // the markings: a deeper rose wing, a black bill tip and gape, a pale eye patch, and the line of the mouth
  vec3 keyC = vec3(1.0, 0.97, 0.92) * key;
  vec3 milk = amb * 1.15 + keyC * 0.5 * wrap + glowLight(P, N, 9.0) * 0.5;
  body = mix(body, uCream * milk + body * 0.1, eyeP * 0.8);
  body = mix(body, body * vec3(0.62, 0.34, 0.46), wing * 0.7);
  body = mix(body, vec3(0.05, 0.03, 0.04), max(tip, gape) * 0.92);
  body = mix(body, uSkin, mouth * 0.9);

  // ── surface: Fresnel reflection of the studio + key highlight ──
  vec3 R = reflect(-V, N);
  float F0 = 0.04;
  float F = F0 + (1.0 - F0) * pow(1.0 - NdV, 5.0);
  vec3 env = studioEnv(R, rough, uBg);
  vec3 spec = ggx(N, V, L, rough) * key * vec3(1.0, 0.97, 0.93);
  float gloss = 0.8 * (1.0 - mouth * 0.4);
  vec3 col = body * (1.0 - F * gloss) + env * F * gloss + spec * gloss;
  gl_FragColor = vec4(col, 1.0);
}
`;

const GLSL_LINE_VS = /* glsl */`
uniform vec4 uCamPos;
uniform vec3 uCamFwd;
varying float vD;
void main() {
  vD = dot(position - uCamPos.xyz, uCamFwd);
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;
const GLSL_LINE_FS = /* glsl */`
uniform vec4 uMisc;
varying float vD;
void main() {
  float a = uMisc.y * mix(0.9, 0.35, clamp((vD - 5.0) * 0.5, 0.0, 1.0));
  gl_FragColor = vec4(vec3(0.04, 0.05, 0.06) * a, a);
}
`;

// ── post: three.js Khronos PBR Neutral tone mapping + sRGB output, then a 1/255 dither ──
const GLSL_POST_FS = /* glsl */`
uniform sampler2D uHdr;
float hash3(vec3 p) { vec3 q = fract(p * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main() {
  vec3 c = texelFetch(uHdr, ivec2(gl_FragCoord.xy), 0).rgb;
  gl_FragColor = vec4(max(c, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += (hash3(vec3(gl_FragCoord.xy, 1.0)) - 0.5) / 255.0;
}
`;
