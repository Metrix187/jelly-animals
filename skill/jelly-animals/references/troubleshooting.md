# When something is wrong

Find the row, fix the cause, and run the test named in the skill for that step again. The engine itself (solver, renderer) is almost never the culprit: look first at what changed since the last working build.

| You see | Cause | Do |
|---|---|---|
| Fallback panel, "GLSL compile error" | a redefined name or a typo in a shader | read the message `shot.mjs` prints after `FALLBACK:` |
| `shot.mjs` waits a minute, then prints `FALLBACK:` with no detail and a `[pageerror]` line | the script threw while loading, often `GLSL_SHAPE` reading a part that `SHAPE` no longer has | fix what the `[pageerror]` line names |
| A part missing or sliced flat | outside `ext` or a `surfaceNets(` box | widen the boxes |
| A part flops, or its skin tears | thinner than about 0.1 | fatten it; check "worst barycentric weight" |
| Collapses or explodes in the pose | inverted tetrahedra | `geo.mjs` least ratio; widen the blends, lower the angles, `pose-scan.mjs` |
| Stands up, then falls backward | pivot behind the feet | move the pivot over the support; keep a tripod |
| Falls over while walking | tall, narrow, or weight ahead of the feet | lower and widen it; move the legs under the mass |
| Never gets back up | `spin` removed, or no long axis | restore it; lengthen the body along x |
| A marking is in the wrong place | a coordinate retyped in GLSL | take it from `GLSL_SHAPE` |
| The dark layer pokes through or looks cut | the two `darkY` differ, or its `surfaceNets(` box is too small | match them; widen the box |
| Treats are never eaten | `SHAPE.mouth` not at the front of the face, or no room in the stomach | move it; check the stomach places in `geo.mjs` |
| Slow, and the wobble is mushy | too many tetrahedra | `behave.mjs prof`; raise `h` |
| The GIF runs in real time | the clock was never paused | `pauseAt` |
