// Adds ?v=<version> to every local script, stylesheet and module import in
// public/, so a deploy never mixes new files with ones a browser cached from
// the last deploy (GitHub Pages caches for 10 minutes; one stale module can
// stop the whole page from starting). Also stamps the version into
// index.html and writes public/version.json: the page compares the two and
// reloads itself when a newer deploy is out. Run by the deploy workflow only.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';

const version = process.argv[2];
if (!version) throw new Error('usage: node scripts/stamp-version.mjs <version>');
const root = new URL('../public/', import.meta.url).pathname;

async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path)));
    else if (/\.(html|js|mjs)$/.test(entry.name)) out.push(path);
  }
  return out;
}

// './x.js', './lib/x.mjs', './styles.css' inside import/from/src/href/new URL.
const LOCAL = /((?:from|import\(|src=|href=|new URL\()\s*['"])(\.\/[^'"?]+\.(?:m?js|css))(['"])/g;

// Every module the page imports up front (its static import graph), listed
// in the page as modulepreload: the browser asks for them all at once instead
// of finding them one import level at a time, a round trip per level.
const STATIC = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"?]+)['"]|(?:^|[\s;])import\s*['"](\.{1,2}\/[^'"?]+)['"]/g;
async function graph(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const text = await readFile(file, 'utf8').catch(() => '');
  for (const m of text.matchAll(STATIC)) await graph(join(dirname(file), m[1] || m[2]), seen);
  return seen;
}
const indexHtml = await readFile(join(root, 'index.html'), 'utf8');
const entries = [...indexHtml.matchAll(/<script type="module" src="\.\/([^"?]+)"/g)].map(m => join(root, m[1]));
const modules = new Set();
for (const entry of entries) for (const f of await graph(entry)) if (!entries.includes(f)) modules.add(f);
const preloads = [...modules].map(f => `<link rel="modulepreload" href="./${relative(root, f)}" />`).join('\n');
for (const path of await files(root)) {
  const text = await readFile(path, 'utf8');
  const stamped = text.replace(LOCAL, (_, before, file, after) => `${before}${file}?v=${version}${after}`);
  if (stamped !== text) await writeFile(path, stamped);
}

// The page's own version, and the latest one, fetched past every cache.
const index = join(root, 'index.html');
const page = (await readFile(index, 'utf8')).replace('content="dev"', `content="${version}"`);
await writeFile(index, preloads ? page.replace('</head>', `${preloads.replaceAll('" />', `?v=${version}" />`)}\n</head>`) : page);
await writeFile(join(root, 'version.json'), JSON.stringify({ version }) + '\n');
