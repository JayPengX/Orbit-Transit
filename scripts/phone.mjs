// A phone's storage for the scripts, kept in a folder (PHONE_DIR) from one
// run to the next: Cache Storage (where the app keeps stations, timetables,
// fares, packs) and localStorage. A second run on the same folder is the
// same phone opening Transit again (scripts/timing.mjs --warm).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const dir = process.env.PHONE_DIR;
if (dir) {
  mkdirSync(join(dir, 'caches'), { recursive: true });
  const file = (name, req) => join(dir, 'caches', createHash('sha1').update(`${name} ${typeof req === 'string' ? req : req.url}`).digest('hex'));
  const cache = name => ({
    async match(req) {
      const f = file(name, req);
      if (!existsSync(f)) return undefined;
      const { body, headers, status } = JSON.parse(readFileSync(f, 'utf8'));
      return new Response(Buffer.from(body, 'base64'), { status, headers });
    },
    async put(req, res) {
      const body = Buffer.from(await res.arrayBuffer()).toString('base64');
      writeFileSync(file(name, req), JSON.stringify({ body, headers: [...res.headers], status: res.status }));
    },
    async delete() {
      return false;
    },
    async keys() {
      return [];
    }
  });
  globalThis.caches = { open: async name => cache(name), match: async () => undefined, keys: async () => [], delete: async () => true };
  const lsFile = join(dir, 'localStorage.json');
  const ls = existsSync(lsFile) ? JSON.parse(readFileSync(lsFile, 'utf8')) : {};
  const save = () => writeFileSync(lsFile, JSON.stringify(ls));
  globalThis.localStorage = {
    getItem: k => (k in ls ? ls[k] : null),
    setItem: (k, v) => ((ls[k] = String(v)), save()),
    removeItem: k => (delete ls[k], save()),
    key: i => Object.keys(ls)[i] ?? null,
    get length() {
      return Object.keys(ls).length;
    },
    clear: () => {
      for (const k of Object.keys(ls)) delete ls[k];
      save();
    }
  };
}
