# Features kept

Every feature a person uses in this app, with the code that makes it.
`tests/features.test.mjs` fails if any mark below disappears, so a refactor cannot
drop a feature silently (2026-11-03, after the lost-features audit).
To remove a feature on purpose, delete its line here in the same commit and say why.
- Navigation by one standard table, following you off the plan — `public/lib/tab-map.mjs`, `public/lib/nav.mjs`: `navLook`, `offPlan`
- Walks and YouBike rides drawn along the roads — `public/lib/tab-map.mjs`, `public/lib/api.mjs`: `roadLegs`, `roadPath`
- A trip's YouBike stations with bikes and docks — `public/lib/tab-map.mjs`: `planBikes`
- YouBike logo, 一般 and 電輔車 counted apart — `public/lib/look.mjs`: `bikeTile`, `bikeStats`
- 偏好電輔車 per trip — `public/lib/plan.mjs`: `偏好電輔車`, `PREFER_SEC`
- 換附近的站 only when a station runs low — `public/lib/nav.mjs`: `換附近的站`
- Operators' notices: 今日停駛, 可能停駛 — `public/lib/service.mjs`, `public/lib/near-ui.mjs`: `可能停駛`, `今日停駛`
- 附近 waits for nearby — `public/lib/near-ui.mjs`: `NEAR_WAIT_MS`
- 查時刻: TPASS-only trains, said so — `public/lib/tab-train.mjs`: `passOnly`, `只列 TPASS`
- 查時刻: train kinds coloured, legs on one line — `public/lib/ui.mjs`: `trainColor`, `fitLegs`
- Station picker on a county line map — `public/lib/linemap.mjs`: `lineMapHtml`
- Bus arrival alerts — `public/lib/alerts.mjs`: `startAlerts`
