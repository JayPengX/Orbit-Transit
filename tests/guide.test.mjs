// Transit's guide (帶我走一遍, kit coach.mjs GUIDES.transit): every step's
// target is something the app still draws, so a redesign that moves a
// button fails here, not on a person's first open (Jay 2026-11-19).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { GUIDES } from '#kit/coach.mjs';

const root = new URL('../', import.meta.url);
const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => (e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'dist' ? [] : e.isDirectory() ? walk(new URL(`${e.name}/`, d)) : /\.(mjs|js|html)$/.test(e.name) ? [readFileSync(new URL(e.name, d), 'utf8')] : []));
const app = ['public/', 'src/'].filter(d => existsSync(new URL(d, root))).flatMap(d => walk(new URL(d, root))).join('\n') + (existsSync(new URL('index.html', root)) ? readFileSync(new URL('index.html', root), 'utf8') : '');
const kit = readdirSync(new URL('.kit/', root)).filter(f => f.endsWith('.mjs')).map(f => readFileSync(new URL(`.kit/${f}`, root), 'utf8')).join('\n');

test("every step of Transit's guide points at something the app draws", () => {
  const steps = GUIDES.transit;
  assert.ok(steps?.length, 'Transit has a guide');
  for (const s of steps) {
    const sel = s.tap || s.show;
    if (!sel) continue;
    // Each id, class and attribute value the selector names is in the app's code (or the kit's: its tabs, sheets, buttons).
    const names = [...sel.matchAll(/#([\w-]+)|\.([\w-]+)|\[[\w-]+="([^"]+)"\]/g)].map(m => m[1] || m[2] || m[3]);
    for (const name of names) assert.ok(app.includes(name) || kit.includes(name), `${sel}: “${name}” is nowhere in the app`);
  }
});
