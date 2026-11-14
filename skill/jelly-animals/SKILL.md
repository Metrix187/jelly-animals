---
name: jelly-animals
description: "This skill should be used when the user asks for jelly, gummy, squishy or wobbly animals in 3D, says \"make jelly bunnies\", \"another animal like the red panda jellies\" or \"remix this jelly page\", or wants a GIF of one. It builds an interactive three.js soft-body page where jelly animals hop, wobble, get flung, strike a signature pose and eat glowing treats, from an engine bundled with the skill.\n"
metadata:
  version: "0.1.0"
---

# Jelly animals

A jelly animal page is one self-contained HTML artifact: a few animals cast in clear jelly on a table, simulated as soft bodies and drawn with hand-written three.js shaders. They hop about on their own, bump and pile up, can be picked up and flung, get back on their feet, strike a signature pose, and eat treats that glow inside them when the lights go out. The reference build is **Red Panda Jellies**.

The engine exists and is tuned. A new animal is five jobs, in this order: shape it, give it a move, paint it, rewrite the page's words, film it if asked. Each job has a test that runs in seconds. Pass it before going on, because each job stands on the one before: markings sit on the shape, and the pose bends the lattice the shape produced.

Do not rewrite the solver or the renderer from memory. They are about 3,000 lines whose constants were found by testing, and the kit that ships with this skill hands them to you working.

## What you need

- A shell with Node 18 or later, and npm (the browser checks install three.js once).
- Somewhere to deliver the page: the Artifact tool where the session has one, otherwise a file (section 10).
- Playwright (1.45 or later) with Chromium, for screenshots. Many sandboxes ship it; then install nothing. Otherwise `npm i playwright` in `test/` and `npx playwright install chromium`. Without a browser you can still build and run every numeric test, but you would be publishing shaders you have never seen compile, so tell the user that plainly.

Say in one line what you are making, then start. Ask first only when the animal itself is unclear. Defaults when the user does not say: three animals at scales 1.0, 0.84 and 0.68; three colourways; one signature move the real animal is known for; one treat it would eat.

The shape and the pose take most of the time. Publish as soon as the animal stands, walks, poses and is painted, and polish after the user has seen it.

## 1. Unpack the kit

The engine ships inside this skill. The `kit/` folder next to this file holds the page's sources, the build script, the test tools and the GIF filming script, and nothing is fetched from anywhere else. The skill's base directory is given when the skill loads. Work on a copy, because that directory may be read-only and the tools write into the folder they run from:

```
cp -r "<this skill's base directory>/kit" <scratchpad>/jelly
cd <scratchpad>/jelly
node build.mjs red-panda-jellies && node --check test/_page.mjs
node test/geo.mjs | head -12          # 466 particles, 1200 tetrahedra; pose "least" 0.27 to 0.35
(cd test && npm i three@0.170.0)      # once: most sandboxes cannot reach the page's CDN, so three.js is served from disk
node test/shot.mjs                    # prints THREE.JS · LIVE and "no page errors"; look at test/shots/desk.png
```

```
kit/
  build.mjs           joins src/ into one page: out/<name>.html, plus test/_sim.mjs and test/_page.mjs for the tests
  src/head.html       title, styles, the stage, the panel, every word on the page
  src/geometry.js     the animal as a signed distance field, the signature pose, the lattice, the render mesh
  src/physics.js      the soft-body solver, the treats, and what each animal decides to do
  src/shaders.js      every shader: table, dark layer, the clear jelly and its markings
  src/renderer.js     the render passes
  src/main.js         colourways, who stands where, camera, picking up, controls
  test/               geo.mjs, behave.mjs, pose-scan.mjs (no browser); shot.mjs, drag.mjs (browser); lib.mjs, browser.mjs
  gif/capture.mjs     films a staged reel frame by frame
```

As shipped the kit builds Red Panda Jellies. Keep that first build as your reference: when something breaks later, the question is always what you changed since it worked.

## 2. Where the animal lives

Read these places, not whole files (`physics.js` alone is 1,100 lines). Search for the names.

| What | Where |
|---|---|
| Size and position of every body part | `SHAPE` at the top of `geometry.js` |
| The body as a signed distance field | the part functions (`trunkSD`, `earSD`, `legsSD`, `tailSD`) and `animalSD`, which joins them |
| The dark inner layer | `darkY` and `coreSD` in `geometry.js`, and the copy of `darkY` inside `GLSL_SHAPE` in `shaders.js` |
| Which part each lattice node belongs to | `partOf` in `geometry.js`; firmness of each part in `FIRM_OF` and `VOLK_OF` in `physics.js` |
| The signature pose | `POSE` and `posePoint` in `geometry.js` |
| The box the lattice and the render surfaces are cut from | `ext` and `0.94` in `buildSimMesh`; the two `surfaceNets(` boxes in `buildAnimalMesh` |
| Eyes, nose, mouth, stomach | `SHAPE.eye/nose/mouth/tummy`, then `EYE`, `NOSE`, `TUMMY`, `ANCHORS` in `geometry.js` |
| Hind feet, head, tail and "how far forward" node weights | the block that fills `G.hindL`, `xi`, `tailW`, `headW`, near the end of the `SoftBody` constructor |
| What the animals decide to do | `class Troupe` in `physics.js` (`step`, `choose`, `hop`, `eat`, `startRawr`) |
| Markings | the block that starts `// ── a red panda's markings` in `GLSL_JELLY_FS`, and the lines after `// the markings:` further down, in `shaders.js` |
| Colours, how many animals, where they stand | `PALETTES` and `TRIO` in `main.js` |
| Every word on the page, and `--accent` / `--glow` | `src/head.html` |

Rename what the page says, not the engine's names. `rawrAll`, `rawrT`, `berry`, `#rawr`, `#berries`, `A_HEAD` and `window.__jelly` are used by the tests and the filming script. A button can be labelled "Binky" and still have the id `rawr`.

Early on, replace the old animal's name through all of `src/` (singular, plural, possessive), so that comments describe the animal that is really there. Later `node build.mjs <name> --stale panda,russet` lists every line of the page that still mentions the old animal. Words like rawr and berry also live in the engine's identifiers, so check those by reading `head.html` top to bottom, not by search.

## 3. Shape

### The frame

Nose toward +x, tail toward −x, feet on the floor at y = 0, z across. The animal is mirrored in z: `animalSD` starts with `z = Math.abs(z)`, so every part is written once for z ≥ 0. One unit is about 2 cm; this is a gummy sweet, whatever the real animal's size.

Keep every animal inside the red panda's envelope: about 1.9 long (x from −1.1 to 0.8), under 0.9 tall, under 0.8 wide. The camera, the table, the hop speeds and the treats are all tuned to that size. If a part must go past it, widen `ext` (and the `0.94` height) in `buildSimMesh` and both `surfaceNets(` boxes, or the part is cut off without any error. `geo.mjs` prints the extent; an extent that sits exactly on a box edge means something was cut.

### How to design it

1. Name the three to five features that make this animal read as itself at the size of a sweet. For the red panda: a head broader than it is tall with a short muzzle, big rounded ears set wide apart, a long thick ringed tail, a dark belly and legs, a cream face. A bunny is long ears, a round tail and big hind feet; a duck is a flat bill, a round breast and a flick of a tail. Exaggerate those and leave out everything else.
2. Build it from few, fat primitives joined with smooth unions. The kit has `sdEllipsoid`, `sdVCapsule` (an upright capsule, for legs), `sdRoundCone` (two spheres of different radius joined, for tails, necks, snouts), and `sdUnevenCapsule` + `extrude` (a rounded flat outline given thickness, for ears, fins, wings). `smin(a, b, k)` joins; k is the width of the blend: 0.04 keeps a part crisp (ears), 0.07 suits head and legs, 0.09 makes a fleshy root (tail).
3. Make it cuter than the animal: head as wide as the body or wider (the panda's head has a half-width of 0.30 against the torso's 0.28), legs short and thick, everything rounded.
4. End `animalSD` with `return Math.max(d, -y);`. That cuts the feet flat on the floor, and flat soles are what let it stand.

### What the physics needs from the shape

- **Nothing thin.** The lattice cells are 0.13 wide. A part thinner than about 0.1 through gets a single layer of flat tetrahedra, which flops, tears the skin and inverts in the pose. The panda's ears are 0.1 thick, its legs 0.115 to 0.12 in radius, its tail 0.115 at the root. Whiskers, claws, thin tails and stalk legs do not survive: fatten them or paint them on as markings.
- **A stable base.** Four feet, or two feet and a belly, or a flat belly alone, with the middle of the mass above the middle of the base. A tall narrow animal falls over on its first hop; make it squat.
- **A long axis along x.** Getting back on its feet is a roll about its own length, which needs a length.
- **About 1,000 to 1,300 tetrahedra per animal** for three animals at the default `h = 0.13`, and no more than about 3,600 in total (the page drops from 10 substeps to 7 on a slow device, and the wobble gets mushier). With one or two animals a finer lattice (h 0.10 to 0.11) is affordable, but the hops and the pose were tuned at 0.13, so run every behaviour test again.

### Check

`node build.mjs <name> && node test/geo.mjs`. It draws the animal side-on and from above in characters, which is enough to judge the silhouette. Iterate here until:

- the outline reads as the animal (`#` is the dark layer, `o` and `:` the clear jelly);
- tetrahedra per animal are in range, and every region has nodes ("nodes per region" lists them in `partOf` order: dark, clear, skin, firm parts, tail);
- "worst barycentric weight" is above about −0.5 (the panda: −0.37). Past that, a thin part is poorly held and its skin will tear.

## 4. Parts, firmness and what is inside

**`partOf`** labels each rest-space point: 0 the dark layer, 1 the clear jelly, 2 the skin (within 0.06 of the surface), 3 the parts that must be firm (ears and legs for the panda; horns, fins, beaks), 4 the tail. `FIRM_OF = [0.3, 0.42, 0.2, 0.07, 0.14]` gives each a compliance multiplier, smaller being firmer: legs are the firmest so that they carry the body instead of buckling, the clear jelly is the softest so that it wobbles. Rewrite the tests in `partOf` for the new parts and keep that ordering of firmness.

**The node groups** near the end of the `SoftBody` constructor are picked by rest position and must follow the new shape:

- `G.hindL` / `G.hindR`: the nodes of the two feet that stay on the floor during the pose (the panda: `y < 0.13 && x > -0.46 && x < -0.14 && Math.abs(z) > 0.03`). The pose is anchored and aimed by them, so both must be non-empty, one each side.
- `xi`: −1 at the back to 1 at the front; the front leaves the table first in a hop.
- `tailW` and `headW`: what wags and what nods.

Check: `node --input-type=module -e "import { world } from './test/lib.mjs'; const G = world().sim.groups; console.log(G.hindL.length, G.hindR.length, G.floor.length)"` (the panda: 16 16 19).

**The dark layer** is a second body of darker jelly under the skin, below the line `darkY(x)`: the panda's belly and legs. It is what stops the animal looking like a plain orange blob, so give every animal one (a belly, a saddle, socks). `darkY` exists twice, in `geometry.js` and in GLSL inside `GLSL_SHAPE`; change both together. In GLSL, `smoothstep(a, b, x)` with a > b is undefined, so a falling edge is written `1.0 - smoothstep(b, a, x)`.

**Eyes and nose** are dark beads placed by a direction from the head's (or muzzle's) centre out to the surface (`SHAPE.eye.dir`, `SHAPE.nose.dir`), so they stay on the face when you move or resize the head.

**The stomach.** `TUMMY` finds 8 places for eaten treats by sampling a box inside the torso, each with a path from `SHAPE.mouth`. Move the sampling box (`[-0.33 + 0.5 * R(), 0.37 + 0.17 * R(), …]`) and the path's middle point (`mid`) to suit the new body. `geo.mjs` prints the places; several at the same fallback point means the box misses the body. `SHAPE.mouth` must sit just inside the front of the face, and the third entry of `ANCHORS` is a point in the head. Also move the box the bubbles are scattered in, and the test that keeps them out of the face, in `buildAnimalMesh`.

## 5. Movement and the signature move

A jelly has no muscles, so nothing here animates limbs. An animal moves by **impulses given to all of its particles at once** (`sim.kick(b, linear, angular, lift)`), and the wobble that follows is the animation. This is why it looks alive for free, and why it never fights the solver.

- **Hop** (`Troupe.hop`): up at `(1.45 + 0.25·random)·√scale`, forward at `1.2·√scale` (less when close to the goal, almost none when it must first turn more than 1.1 rad), a turn of at most 0.75 rad per hop, and `lift = 0.32 ×` the upward speed so the front rises first. One hop every `0.4 + 0.28·scale` seconds or so. Every speed carries √scale so that small ones hop as high for their size as big ones.
- **Getting up** (`Troupe.step`, the `!P.upright` branch): on its side or back, it throws itself up with a roll about its own length, sized to land it upright; stood on its nose or tail, it tips over instead.
- **Small gestures**: `sim.wag` shakes the tail sideways, `sim.nod` dips the head when it eats.

Change the character with these numbers and nothing deeper: a frog takes one big hop and then waits; a duck takes small quick ones with a wag after each; a cat waits a long time and then goes.

**Treats** are small rigid balls from a pool of 30. An animal with room hops to the nearest, eats it when its mouth is over it, and carries it inside for the better part of a minute. Making them carrots or fish costs only words and colours; reshaping them means editing the drop mesh in `buildScene` and is rarely worth it.

### The signature pose

One held pose that says who the animal is (the panda stands on its hind legs with forepaws raised, as startled red pandas do). It works by **re-posing the rest shape**: `posePoint(x, y, z, a, wave, out)` maps each rest position to its posed position, the tetrahedra take that as their new rest shape, and a soft pull (`poseGain`) keeps the body over its hind feet. `a` runs 0 to 1 as the pose comes in; `wave` runs −1 to 1 for a small repeated motion while it holds (the paws paddling).

Write the pose as rotations in the side view (x, y) about pivots, each weighted by a `sstep` of the rest position (the panda's also reads `SHAPE.legF` to find the forelegs):

```js
const w = a * sstep(u0, u1, x + tilt * (y - 0.3));        // 0 behind the hips … 1 in front of them
const th = w * pitch, c = Math.cos(th), s = Math.sin(th);
const qx = x - hip[0], qy = y - hip[1];
x = hip[0] + qx * c - qy * s;  y = hip[1] + qx * s + qy * c;
```

Rules that were each learned by breaking it:

1. **Wide blends.** The weight must rise over at least two lattice cells (0.26), and over more for a big angle: the panda's body turns 1.0 rad across a blend 0.54 wide, its forelegs 0.5 rad across 0.26. A sharp edge between turned and unturned jelly shears the tetrahedra there until they invert.
2. **Leaf to root.** Turn the limbs first, then the head, then the whole front of the body, as the panda's `posePoint` does. Each later rotation carries the earlier ones with it.
3. **Leave a tripod alone.** Whatever stays on the floor (hind legs and tail) gets weight 0, and the pivot sits above it, so the posed body ends up over its feet and not behind them.
4. **Turn the head back.** After pitching the body up, nod the head down (`nod` is negative) or the animal stares at the ceiling instead of at the viewer.
5. **Measure the distortion.** `geo.mjs` prints, for the full pose and both ends of `wave`, the least and most tetrahedron volume against rest. Keep the least above about 0.25 and never below 0 (the panda: 0.27 to 0.35, most 3.4). `node test/pose-scan.mjs '{"pitch":[0.9,1.0],"hip.1":[0.44,0.5]}'` tries every combination and ranks them, which is far quicker than guessing.
6. **Unload the front feet.** `startRawr` gives a small upward kick with front lift as the pose begins; without it friction pins the forepaws to the table.

Then `node test/behave.mjs pose`: the head should rise within half a second, hold steady and come down (the panda's head goes from y 0.5 to 1.08 at scale 1), with "least tet" staying above 0.

A move that is a motion and not a held shape (a frog's leap, a bunny's twisting jump) needs no pose at all: give it a `kick` with spin in `startRawr` and set the pose times short.

## 6. Paint

Colour comes from three places.

**The jelly itself**: `PALETTES` in `main.js`. `flesh` is the colour of light that has crossed the clear jelly and `density` how fast it is absorbed, so thin parts (ears, tail tip) come out pale and bright and the body deep. `cola` is the dark layer, `cream` and `ring` the painted markings, `seed` the eyes and nose, `berry` / `berryIn` / `glow` the treats outside, inside and their light. Give three colourways with names, and set `--accent` and `--glow` in `head.html` to the first.

**Markings** are painted in the jelly's fragment shader from `vRest`, the rest-space position of the pixel, so they ride the wobble. Each is a soft mask:

```glsl
float muz  = 1.0 - smoothstep(0.86, 1.08, length((q - MUZ_C) / vec3(0.15, 0.115, 0.17)));   // an ellipsoid patch
float ring = onTail * smoothstep(-0.25, 0.25, sin(tp * 21.0 - 1.0));                       // stripes along an axis
```

`q` is the position with `abs(z)`, so one patch paints both sides. Further down, after the light through the jelly has been worked out, the masks are mixed in: pale markings as lit opaque paint (`mix(body, uCream * milk + body * 0.1, mask * 0.9)`), dark ones by multiplying (`body * vec3(0.3, 0.26, 0.26)`), fine lines like the mouth in `uSkin` with a slight dent in the normal (`bumpH`).

- Take every landmark from `GLSL_SHAPE`, which is filled from `SHAPE` when the page loads. Add constants there; never retype a coordinate in GLSL, or the marking stays behind when you move the part.
- `GLSL_SHAPE` reads `SHAPE.muzzle`, `SHAPE.head`, `SHAPE.ear`, `SHAPE.tail`, `EARF`, `EYE` and `NOSE` by name. Rename or drop one of those in `geometry.js` and the page's script throws while loading, which no Node test can see. Change `GLSL_SHAPE` in the same edit, and take a screenshot.
- Three to five markings are plenty. The face matters most: it is what people look at.
- A new variable must not reuse a name already in that shader's `main` (`inner`, `glow`, `body`, `ring`, `back`, `key`, `scat` and many more). A clash fails the compile and the page shows its fallback panel; `test/shot.mjs` prints the compiler's message after `FALLBACK:`.

**How many**: `TRIO` in `main.js` lists each animal's scale, place and facing. One, two or three all work as built. More than three does not: the glow lights (`uGlowP[3]`), the per-animal depths (`uInstDepth[3]`) and the back-face depth channels (r, g, b) are each sized for three.

## 7. Leave these alone

They look like details and each one is load-bearing.

- **`this.spin(false); this.solveTets(dt); this.spin(true);`** The tetrahedron solve quietly drains a turning body's angular momentum, as if it turned in syrup. `spin` measures it before and hands it back after. Without it nothing can roll over in the air, and getting up stops working.
- **Contacts push back only 0.35 of the overlap per substep.** Animals meet through their lattice nodes. A full push crushes the thin tetrahedra of the smallest animal when they pile up.
- **Floor nodes of the lattice slide along the floor only where the body really touches it**, and are lifted onto the underside elsewhere (under a tail that hangs just clear). Otherwise the tetrahedra under that part are crushed flat at rest.
- **A fixed 60 Hz step with 10 substeps**, however fast the screen is. `window.__jelly.advance(n)` runs n steps at once; tests and filming rely on it.
- **`rest0` is the animal's own rest shape, `shape` the posed, scaled one each copy is pulled toward.** Markings, treats and the stomach use `rest0`.

## 8. Test

Without a browser (seconds, except `all`):

| Command | Shows | Good |
|---|---|---|
| `node test/geo.mjs` | lattice, pose distortion, pictures | section 3 and 5 numbers |
| `node test/behave.mjs walk` | 10 s of wandering | `up` near 1, about 10 hops per animal, no `NaN` |
| `node test/behave.mjs pose` | the signature pose | rises, holds, comes down |
| `node test/behave.mjs flip` | dropped on back, sides, nose, tail | every animal upright again, mostly within 5 s |
| `node test/behave.mjs eat` | nine treats dropped | all eaten within about 20 s |
| `node test/behave.mjs extremes` | both sliders at both ends, 7 substeps | no `NaN`, nobody down for good |
| `node test/behave.mjs prof` | time per step, crushed tetrahedra | no slower than the kit as shipped, on the same machine |

`node test/behave.mjs all` runs the lot in about 90 s. A dip in `up` now and then is one animal mid-tumble, which is fine; an animal that never returns to 1 is not.

With a browser, which is the only proof that the shaders compile and the page works:

```
node test/shot.mjs '[{"steps":[
  {"advance":150,"wait":1500,"name":"desk"},
  {"js":"window.__jelly.troupe.rawrAll()","advance":60,"wait":1500,"name":"pose"},
  {"js":"window.__jelly.toss()","advance":600,"wait":1500,"name":"fed"},
  {"js":"window.__jelly.setLights(true)","advance":30,"wait":5000,"name":"dark"}]},
 {"w":390,"h":844,"steps":[{"advance":200,"wait":1500,"name":"phone"}]}]'
node test/drag.mjs
```

The browser tools open the newest page in `out/`. Software WebGL draws about one frame a second, so never wait for things to happen: `advance` the simulation, then wait a second or two for one frame to draw. Look at every picture. For the face, hold everyone still, turn one to the camera and move in:

```js
(() => { const p = window.__jelly; p.troupe.list.forEach(P => { P.mode = 'idle'; P.wait = 99; });
  p.sim.place(0, 0.05, [0, 0], p.state.az - Math.PI / 2); p.state.zoom = 0.55; })()
```

Check a claim in numbers before trusting a picture of it. `rawrAll` starts the animals 0.14 s apart and only once each is on the ground, so a picture taken too soon shows one standing; `sim.bodies[b].poseA` says who is really posed. `window.__jelly` also exposes `sim`, `drops`, `troupe`, `state` (`az`, `el`, `zoom`, `paused`), `setPalette`, `setLights`, `toss` and `stepMs`.

## 9. The page's words

`head.html` is written as a specimen card from a series called Material Studies, and every sentence about the old animal has to go: `<title>` (`<Animal> Jellies`), the meta description, the canvas `aria-label` (say what is on screen, for someone who cannot see it), the heading and its three-line caption, the panel ("three of them" is typed by hand, as is every other count), the two button labels, the hint, the readout labels, the footnote with the keys, and the five notes under "Inside the experiment" (the animals, getting about, the signature move, the treats, light through jelly). The palette names and status texts are in `main.js`.

- Voice: plain and a little dry, like the label beside an exhibit. Every sentence says something true about how the thing works. The animals supply the charm; the words do not need exclamation marks.
- Keep the notes true. If the pose or the treats changed, the paragraph that explains them changes. The counts in the notes fill themselves in (`#nParticles`, `#nTets`, `#nSlots`, `#nBubbles`).
- Keep "After No. 058" in the kicker. The engine descends from that study, and the line is the credit.
- Leave the layout and styles alone unless asked. The page is a deliberate single look with its own lights-out mode.

## 10. Publish

`node build.mjs <animal>-jellies` writes `out/<animal>-jellies.html` with no `<html>`, `<head>` or `<body>` tags, which is how the Artifact tool wants it. Before delivering: `node --check test/_page.mjs` passes, `behave.mjs all` is clean, the screenshots show "no page errors" at desk and phone size, and `--stale` finds nothing left of the old animal.

Publish that file with the Artifact tool, with a one-sentence `description` and a one-word `icon`. When the user opened an existing jelly artifact and asked for it to be changed, update that artifact; when they asked for a new animal, publish a new one. Where the session has no Artifact tool, add `--full` to the build and hand over `out/<animal>-jellies.full.html`: a whole document that opens straight from disk and fetches three.js from the CDN. Then tell them in a sentence or two what the animals do and which keys to try. Do not narrate the build. If something is still not right (a marking you could not place, a test that dips), say which.

## 11. A GIF, when asked

Read `references/gif.md` first. In short: film the page frame by frame on a clock that stands still, rehearse the staging in numbers before drawing anything, hold the camera still, and encode with ffmpeg and gifsicle to under 5 MB.

## When something is wrong

`references/troubleshooting.md` lists what each failure looks like, its cause and the fix. Read it at the first surprise, before changing the engine.
