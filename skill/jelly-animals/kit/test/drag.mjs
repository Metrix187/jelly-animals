// Picks the first animal up with the mouse, holds it in the air and lets go, then shows another colourway with the
// lattice drawn.   node test/drag.mjs   → test/shots/held.png, test/shots/mesh.png
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from './browser.mjs';
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');
fs.mkdirSync(out, { recursive: true });
const { browser, page, logs, fallback } = await openPage();
if (fallback) { console.log('FALLBACK:', fallback); await browser.close(); process.exit(1); }
await page.evaluate(() => { const p = window.__jelly; p.advance(180); p.troupe.list.forEach(P => { P.wait = 99; P.mode = 'idle'; }); });
await page.waitForTimeout(1500);
// where the first animal is on screen
const at = await page.evaluate(() => { const p = window.__jelly, c = p.sim.bodies[0].c, M = p.cam.viewProj, r = document.getElementById('gl').getBoundingClientRect(); const w = M[3] * c[0] + M[7] * c[1] + M[11] * c[2] + M[15]; return [r.left + ((M[0] * c[0] + M[4] * c[1] + M[8] * c[2] + M[12]) / w * 0.5 + 0.5) * r.width, r.top + (0.5 - (M[1] * c[0] + M[5] * c[1] + M[9] * c[2] + M[13]) / w * 0.5) * r.height]; });
const st = () => page.evaluate(() => { const p = window.__jelly, B = p.sim.bodies[0], P = p.troupe.list[0]; return `mode=${P.mode} drag=${p.drag.mode} body=${p.drag.body} grabbing=${p.sim.grabbing} height=${B.c[1].toFixed(2)} up=${B.R[4].toFixed(2)} pose=${B.poseA.toFixed(2)} cursor=${document.getElementById('gl').dataset.cursor}`; });
await page.mouse.move(at[0], at[1]); await page.waitForTimeout(1500); console.log('hover  ', await st(), ' (cursor should be grab)');
await page.mouse.down(); await page.waitForTimeout(300); console.log('down   ', await st(), ' (mode held, grabbing true)');
await page.mouse.move(at[0] + 40, at[1] - 170, { steps: 6 });
await page.evaluate(() => window.__jelly.advance(40)); await page.waitForTimeout(1500); console.log('lifted ', await st(), ' (height well above rest)');
await page.screenshot({ path: path.join(out, 'held.png') });
await page.mouse.up(); await page.waitForTimeout(200); console.log('let go ', await st());
for (let k = 0; k < 5; k++) { await page.evaluate(() => window.__jelly.advance(40)); console.log('after  ', await st()); }
console.log('         (it should land, get upright, strike its pose once, and go back to walking)');
await page.click('#swatches .swatch:last-child'); await page.click('label:has(#mesh)');
await page.evaluate(() => { window.__jelly.state.zoom = 0.8; }); await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(out, 'mesh.png') });
console.log(logs.join('\n') || 'no page errors');
await browser.close();
