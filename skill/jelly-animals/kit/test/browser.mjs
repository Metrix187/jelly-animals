// Opens the built page in headless Chromium with software WebGL, the way an artifact serves it, and hands back the
// page once the simulation is up. Needs `playwright` (local or global) and three.js: npm i three@0.170.0 (in test/).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));

// what publishing wraps round the page
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>';

function find(name) {
  const roots = [here, path.join(here, '..'), ...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)];
  try { roots.push(execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()); } catch (e) { /* no npm */ }
  for (const r of roots) for (const base of [path.join(r, 'node_modules'), r]) {
    const at = path.join(base, name);
    if (fs.existsSync(path.join(at, 'package.json'))) return { req: createRequire(path.join(base, 'x.js')), at };
  }
  throw new Error(`cannot find ${name}: npm i ${name === 'three' ? 'three@0.170.0' : name} in ${here}`);
}
export function newestPage() {
  const dir = path.join(here, '..', 'out');
  const f = fs.readdirSync(dir).filter(f => f.endsWith('.html') && !f.endsWith('.full.html')).map(f => path.join(dir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!f) throw new Error('nothing in out/: run node build.mjs first');
  return f;
}

// { width, height, file, clock }: with clock, the page's time stands still (see gif/capture.mjs)
export async function openPage({ width = 1280, height = 800, file = newestPage(), clock = false } = {}) {
  const { chromium } = find('playwright').req('playwright');
  const three = fs.readFileSync(path.join(find('three').at, 'build', 'three.module.js'), 'utf8');
  const html = SKELETON + '\n' + fs.readFileSync(file, 'utf8') + '\n</body></html>';
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })).newPage();
  const logs = [];
  page.on('console', m => { if (m.type() === 'error') logs.push('[error] ' + m.text().slice(0, 1500)); });
  page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 1500)));
  // the sandbox cannot reach the CDN the page loads three.js from, so it is served from disk
  await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'text/javascript', body: three }));
  await page.route('http://jelly.test/', r => r.fulfill({ contentType: 'text/html', body: html }));
  await page.addInitScript(() => { window.__fixPR = 1; window.__keepFrame = true; });
  if (clock) await page.clock.install({ time: new Date('2026-01-01T12:00:00Z') });
  await page.goto('http://jelly.test/');
  let up = false;
  for (let k = 0; k < 240 && !up; k++) {
    up = await page.evaluate(() => !!window.__jelly || !document.getElementById('fallback').hidden);
    if (!up) await new Promise(r => setTimeout(r, 250));
  }
  // a shader that does not compile, or no WebGL, shows in the page's own fallback panel
  const fallback = await page.evaluate(() => (window.__jelly ? null : document.getElementById('fallbackTitle').textContent + ' :: ' + document.getElementById('fallbackDetail').textContent));
  if (clock) await page.clock.pauseAt(new Date('2026-01-01T12:05:00Z'));
  return { browser, page, logs, fallback };
}
