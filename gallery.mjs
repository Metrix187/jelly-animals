// Builds index.html, the gallery, from every entry.json under reference/ and models/.
//   node gallery.mjs
// An entry is a folder  models/<model>/<animal>/  holding
//   index.html    the page as the model delivered it (a whole document: build with --full)
//   entry.json    who made it and how (see README)
//   preview.gif | preview.png | preview.jpg   optional, shown on the card
//   src/          optional, the kit sources as the model left them
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dirs = d => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort() : [];

function readEntry(rel) {
  const dir = path.join(here, rel), file = path.join(dir, 'entry.json');
  if (!fs.existsSync(file)) { console.warn(`skipped ${rel}: no entry.json`); return null; }
  const e = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!fs.existsSync(path.join(dir, 'index.html'))) { console.warn(`skipped ${rel}: no index.html`); return null; }
  const preview = ['preview.gif', 'preview.png', 'preview.jpg'].find(f => fs.existsSync(path.join(dir, f)));
  return { ...e, rel, preview, hasSrc: fs.existsSync(path.join(dir, 'src')) };
}

const groups = [];
const ref = dirs(path.join(here, 'reference')).map(a => readEntry(`reference/${a}`)).filter(Boolean);
if (ref.length) groups.push({ name: 'Reference', note: 'What the kit builds before anyone touches it.', entries: ref });
for (const m of dirs(path.join(here, 'models'))) {
  const entries = dirs(path.join(here, 'models', m)).map(a => readEntry(`models/${m}/${a}`)).filter(Boolean);
  if (entries.length) groups.push({ name: entries[0].model || m, note: `models/${m}/`, entries });
}

const card = e => {
  const meta = [e.effort && `effort ${e.effort}`, e.harness, e.date, e.skill && `skill ${e.skill}`].filter(Boolean).map(esc).join(' · ');
  return `      <li class="card">
        <a class="shot" href="${esc(e.rel)}/" aria-label="Open ${esc(e.title)}">${e.preview ? `<img src="${esc(e.rel)}/${e.preview}" alt="" loading="lazy">` : '<span class="blank">no preview yet</span>'}</a>
        <h3><a href="${esc(e.rel)}/">${esc(e.title)}</a></h3>
        <p class="meta">${meta}</p>${e.notes ? `\n        <p class="notes">${esc(e.notes)}</p>` : ''}${e.hasSrc ? `\n        <p class="meta"><a href="https://github.com/${esc(repo)}/tree/main/${esc(e.rel)}/src">sources</a></p>` : ''}
      </li>`;
};

const repo = 'Metrix187/jelly-animals';
const total = groups.reduce((n, g) => n + g.entries.length, 0);      // every card on the page, the reference included
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Jelly Animals</title>
<meta name="description" content="Soft-body jelly animals, each made by a different model from the same skill.">
<style>
  :root { --bg: #E2DFDA; --ink: #1c1b19; --muted: #6d6962; --line: rgba(28, 27, 25, .18); --card: #ebe8e3; --accent: #c9263c;
    --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
    --sans: "Helvetica Neue", Helvetica, "Segoe UI", system-ui, Arial, sans-serif; color-scheme: light; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #15181e; --ink: #e9e4da; --muted: #9a958c; --line: rgba(233, 228, 218, .16); --card: #1c2028; --accent: #ff7b8b; color-scheme: dark; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.5 var(--sans); -webkit-font-smoothing: antialiased; }
  main { max-width: 68rem; margin: 0 auto; padding: clamp(24px, 6vw, 64px) 16px; }
  .kicker { font: 500 10.5px/1 var(--sans); letter-spacing: .2em; text-transform: uppercase; color: var(--muted); }
  h1 { font: italic 400 clamp(44px, 9vw, 92px)/.9 var(--serif); letter-spacing: -.025em; margin: 16px 0 18px; }
  .lede { font: 400 16px/1.5 var(--serif); color: var(--muted); max-width: 46ch; margin: 0; }
  section { margin-top: clamp(32px, 5vw, 56px); border-top: 1px solid var(--line); padding-top: 16px; }
  h2 { font: italic 400 28px/1.1 var(--serif); margin: 0; }
  .group-note { color: var(--muted); margin: 4px 0 0; font-size: 12.5px; }
  ul { list-style: none; margin: 18px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr)); gap: 18px; }
  .card { background: var(--card); border: 1px solid var(--line); padding: 10px 10px 12px; }
  .shot { display: block; aspect-ratio: 4 / 3; overflow: hidden; background: var(--bg); border: 1px solid var(--line); }
  .shot img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .blank { display: grid; place-items: center; height: 100%; color: var(--muted); font: italic 14px var(--serif); }
  h3 { font: italic 400 20px/1.2 var(--serif); margin: 12px 0 2px; }
  a { color: inherit; text-underline-offset: 3px; }
  h3 a { text-decoration: none; }
  h3 a:hover, .meta a { color: var(--accent); }
  a:focus-visible { outline: 1px solid var(--ink); outline-offset: 2px; }
  .meta { color: var(--muted); font-size: 12px; margin: 0; }
  .notes { margin: 6px 0 4px; font-size: 13px; }
  footer { margin-top: 48px; border-top: 1px solid var(--line); padding-top: 14px; color: var(--muted); font-size: 12.5px; }
</style>
</head>
<body>
<main>
  <header>
    <div class="kicker">Material Studies / one skill, many hands</div>
    <h1>Jelly Animals.</h1>
    <p class="lede">Every model gets the same skill and the same engine, and is asked for an animal. ${plural(total, 'animal')} so far, filed by who made them.</p>
  </header>
${groups.map(g => `  <section>
    <h2>${esc(g.name)}</h2>
    <p class="group-note">${esc(g.note)}</p>
    <ul>
${g.entries.map(card).join('\n')}
    </ul>
  </section>`).join('\n')}
  <footer>The skill and its kit are in <a href="https://github.com/${repo}/tree/main/skill/jelly-animals">skill/jelly-animals</a>. The engine descends from the jelly study each page credits as No. 058.</footer>
</main>
</body>
</html>
`;
fs.writeFileSync(path.join(here, 'index.html'), html);
console.log(`index.html written: ${groups.length} groups, ${groups.reduce((n, g) => n + g.entries.length, 0)} entries`);
