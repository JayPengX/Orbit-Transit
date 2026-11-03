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
- At a bus stop 5 minutes before its timetable time, 2 before a bus seen live; trains as timed — `public/lib/plan.mjs`, `public/lib/planner.mjs`, `public/lib/tab-go.mjs`: `boardEarly`, `BUS_EARLY`
- A bus seen gone is never planned or shown again; 趕不上了, never 快一點, when hurrying can't make it — `public/lib/live.mjs`, `public/lib/nav.mjs`: `seenAt`, `nextCatchable`, `pastHurry`, `趕不上了`
- 追公車: a YouBike to a stop further along the bus's way, planned and offered while navigating — `public/lib/chase.mjs`, `public/lib/planner.mjs`, `public/lib/nav.mjs`: `chasePlan`, `chases(`, `chaseFrom`, `騎車追上`
- A trip with stops navigated as one: the stops and what's after them in the chips, the last place's time — `public/lib/nav.mjs`, `public/lib/tab-map.mjs`: `laterEnd`, `navLater`, `ot-nav-chip stop`, `全程剩`
- 停著 or 還車 at a stop, with which is sooner — `public/lib/nav.mjs`: `parkAsk`, `到了要還車嗎`
- 附近換車 from 25 minutes on a YouBike with the free half hour — `public/lib/nav.mjs`: `附近換車`, `splitRide`
- A trip asked for on a bus or train planned from it (its stops ahead), 不在車上 to plan from the street — `public/lib/aboard.mjs`, `public/lib/planner.mjs`, `public/lib/tab-map.mjs`: `trainAboard`, `busesAboard`, `planAboard`, `不在車上`
- 交通 as one board: 要去哪裡, your places, every trip and pin a row in your order, 附近 — `public/lib/tab-go.mjs`, `public/lib/board.mjs`: `renderBoard`, `boardTrip`, `boardBuses`, `boardTrains`, `boardNear`, `boardRow`
- A trip's row says when to leave, or why not; a tap opens its ways on the map — `public/lib/tab-go.mjs`: `tripWhy`, `whenHtml(p.dep`, `data-all-trip`
- 附近 says which way each bus goes, and the timetable's next where none is coming — `public/lib/tab-go.mjs`: `nearHeads`, `nearPlanned`
- A place chip opens the place: its buses, its bikes, 怎麼去 — `public/lib/tab-go.mjs`: `openPlace`, `data-go-place`
- A route's stops with its buses on the line (on a stop, between two), 進站中 / 即將進站 — `public/lib/bus-ui.mjs`, `public/transit.css`: `busAt`, `busBetween`, `ot-rs-bus`, `li.at .ot-rs-dot`
