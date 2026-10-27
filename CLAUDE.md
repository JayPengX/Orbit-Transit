# Working on Orbit Transit

Read `../Orbit-Core/docs/TRUTH.md` first (one page: how the owner works and what matters).
MAP.md is this repo's map (README.md is the short public front page).

- `npm test`, then `git push origin HEAD:main`.
- `node scripts/live.mjs <from> <to>` runs a trip on today's real data; `--against HEAD` compares a batch old vs new when changing how plans rank.
- See it on a phone: `node ../Orbit-Core/tools/preview.mjs transit --live --width 375`.
