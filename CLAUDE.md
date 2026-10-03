# Working on Quadra

- **Push every change to `main` directly, always** (the owner's standing
  instruction). `main` deploys on push (GitHub Pages for the apps, Cloudflare
  for Shared-Proxy's Workers). Work on any branch the session gives you, then
  also `git push origin HEAD:main` after each validated change.
- Run the tests before pushing (`npm test`; Orbit Class also `npx eslint .`).
- The shared kit lives in `Shared-Proxy/kit/` and only there: every app
  loads it from Shared-Proxy's GitHub Pages (`kit/loader.html`; modules
  import `#kit/quadra.mjs`), so a kit change is one push to Shared-Proxy.
  `node kit/link.mjs` links the apps here for their tests.
- The brand (Quadra: Securities, Play, the Pass; Orbit: Class, Weather,
  Transit, Sports, Words) is `Shared-Proxy/kit/brand.mjs`; icons, share
  cards and page tags come from `node brand/generate.mjs`.
- Notes on the whole family: `Shared-Proxy/docs/HANDOFF.md`; tools (phone
  screenshots with real data, ESPN probes, word audio):
  `Shared-Proxy/tools/README.md`.
