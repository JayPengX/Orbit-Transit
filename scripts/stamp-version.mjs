// Readies public/ for GitHub Pages: every script, module and stylesheet
// minified and its address stamped with its own content hash (a deploy
// re-downloads only what it changed), the build's version in index.html and
// version.json (the page reloads itself onto a newer deploy), the
// modulepreload list, and the kit's current file hashes. The kit's build
// tool, kit/stamp-app.mjs (.kit in CI, the checkout beside this one here).
// Run by the deploy workflow only.
//   node scripts/stamp-version.mjs <version> [site folder]
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const version = process.argv[2];
if (!version) throw new Error('usage: node scripts/stamp-version.mjs <version> [site folder]');
const kitDir = [new URL('../.kit/', import.meta.url).pathname, new URL('../../Orbit-Core/kit/', import.meta.url).pathname].find(d => existsSync(`${d}stamp-app.mjs`));
if (!kitDir) throw new Error('the kit (.kit or ../Orbit-Core/kit) is missing');
const { stampApp } = await import(pathToFileURL(`${kitDir}stamp-app.mjs`).href);
const done = await stampApp({ root: process.argv[3] || new URL('../public/', import.meta.url).pathname, version, kitDir });
console.log(`stamped ${done.files} files, kit ${done.kit || 'not baked'}`);
