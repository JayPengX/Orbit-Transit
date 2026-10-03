# Working on Quadra

- **Push every change to `main` directly, always** (the owner's standing
  instruction). `main` deploys on push (GitHub Pages for the apps, Cloudflare
  for Shared-Proxy's Workers). Work on any branch the session gives you, then
  also `git push origin HEAD:main` after each validated change.
- Run the tests before pushing (`npm test`; Orbit Class also `npx eslint .`).
- The shared kit lives in `Shared-Proxy/kit/`; copy it with
  `node kit/sync.mjs` and commit every app. Never edit an app's copy.
- Notes on the whole family: `Shared-Proxy/docs/HANDOFF.md`; tools (phone
  screenshots with real data, ESPN probes, word audio):
  `Shared-Proxy/tools/README.md`.
