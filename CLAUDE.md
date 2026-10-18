# Working on Orbit Transit

Read `../Shared-Proxy/docs/TRUTH.md` first (one page: how the owner works and what matters).
The README is this repo's map.

- `npm test`, then `git push origin HEAD:main`.
- `node scripts/live.mjs <from> <to>` runs a trip on today's real data; `--against HEAD` compares a batch old vs new when changing how plans rank.
- See it on a phone: `node ../Shared-Proxy/tools/preview.mjs transit --live --width 375`.
