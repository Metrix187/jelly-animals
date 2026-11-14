// Screenshots of the built page.   node test/shot.mjs '<plan>'   → test/shots/<name>.png
// plan: [{ "w": 1280, "h": 800, "steps": [{ "js": "…run in the page…", "advance": 150, "wait": 1500, "name": "first" }] }]
// advance runs that many simulation steps at once (software WebGL draws about a frame a second, so waiting for
// things to happen in real time is slow); wait gives the page time to draw before the picture is taken.
//   node test/shot.mjs '[{"steps":[{"advance":150,"wait":1500,"name":"desk"}]},{"w":390,"h":844,"steps":[{"advance":200,"wait":1500,"name":"phone"}]}]'
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from './browser.mjs';
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');
fs.mkdirSync(out, { recursive: true });
for (const shot of JSON.parse(process.argv[2] || '[{"steps":[{"advance":150,"wait":1500,"name":"desk"}]}]')) {
  const { browser, page, logs, fallback } = await openPage({ width: shot.w || 1280, height: shot.h || 800 });
  if (fallback) console.log('FALLBACK:', fallback);
  else {
    for (const step of shot.steps || [{}]) {
      if (step.js) await page.evaluate(step.js);
      if (step.advance) await page.evaluate(n => window.__jelly.advance(n), step.advance);
      await page.waitForTimeout(step.wait || 900);
      if (step.name) { await page.screenshot({ path: path.join(out, step.name + '.png') }); console.log('saved test/shots/' + step.name + '.png'); }
    }
    console.log(await page.evaluate(() => JSON.stringify({ status: document.getElementById('statusText').textContent, stepMs: +window.__jelly.stepMs.toFixed(1), hops: window.__jelly.troupe.hops, inside: window.__jelly.troupe.inside() })));
  }
  console.log(logs.join('\n') || 'no page errors');
  await browser.close();
}
