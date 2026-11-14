// Builds the page from src/.
//   node build.mjs [name] [--stale word,word] [--full]
// writes
//   out/<name>.html   the page, ready to publish as an artifact (no <html> or <body>: publishing wraps it)
//   out/<name>.full.html   with --full: the same page as a whole document, to hand over as a file where there is
//                          nowhere to publish (it opens straight from disk, and fetches three.js from the CDN)
//   test/_sim.mjs     geometry + physics alone, for the node tests; its default export reaches every top-level name
//   test/_page.mjs    the page's script alone, for `node --check test/_page.mjs`
// --stale lists the lines that still contain any of the given words (the last animal's name, say).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), at = args.indexOf('--stale');
const stale = at >= 0 ? (args[at + 1] || '').split(',').filter(Boolean) : [];
const name = args.find((a, i) => !a.startsWith('--') && (at < 0 || i !== at + 1)) || 'jelly-animals';
const src = f => fs.readFileSync(path.join(here, 'src', f), 'utf8');

const parts = ['geometry.js', 'physics.js', 'shaders.js', 'renderer.js', 'main.js'].map(src);
const js = parts.join('\n\n');
const page = src('head.html') + js + '\n</script>\n';

// where each animal is put down, as the page has it, so the node tests set the same table
const trio = (src('main.js').match(/^const TRIO = \[[\s\S]*?^\];/m) || ['const TRIO = [{ scale: 1, x: 0, z: 0, yaw: 0 }];'])[0];
const sim = parts[0] + '\n' + parts[1] + '\n' + trio + `
// every top-level name above, by name: S.buildSimMesh, S.SHAPE, S.POSE …
export default new Proxy({}, { get: (_, k) => { try { return typeof k === 'string' && /^[A-Za-z_$][\\w$]*$/.test(k) ? eval(k) : undefined; } catch (e) { return undefined; } } });
`;

for (const d of ['out', 'test']) fs.mkdirSync(path.join(here, d), { recursive: true });
fs.writeFileSync(path.join(here, 'out', name + '.html'), page);
fs.writeFileSync(path.join(here, 'test', '_sim.mjs'), sim);
fs.writeFileSync(path.join(here, 'test', '_page.mjs'), js);
console.log(`out/${name}.html written: ${(page.length / 1024).toFixed(1)} KB`);
if (args.includes('--full')) {
  const doc = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<style>body { margin: 0; } [hidden] { display: none !important; }</style>\n</head>\n<body>\n' + page + '</body>\n</html>\n';
  fs.writeFileSync(path.join(here, 'out', name + '.full.html'), doc);
  console.log(`out/${name}.full.html written`);
}
if (stale.length) {
  const re = new RegExp(stale.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
  let n = 0;
  page.split('\n').forEach((l, i) => { if (re.test(l)) { n++; if (n <= 60) console.log(`stale @${i + 1}: ${l.trim().slice(0, 130)}`); } });
  console.log(n ? `${n} lines still mention ${stale.join(', ')}` : `no line mentions ${stale.join(', ')}`);
}
