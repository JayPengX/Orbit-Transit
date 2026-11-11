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
- 偏好電輔車 in 我的, off by default (every trip's ⚡ starts on) — `public/lib/tab-me.mjs`: `ebikeRow`
- 電輔車 counted first on station cards when preferred — `public/lib/look.mjs`: `ebikeFirst`
- 換附近的站 only when a station runs low — `public/lib/nav.mjs`: `換附近的站`
- 換附近的站 takes the station the planner would from where you are, its pin moving with it — `public/lib/nav.mjs`: `swapPick`, `l.rent = { ...station }`
- Operators' notices: 今日停駛, 可能停駛 — `public/lib/service.mjs`, `public/lib/near-ui.mjs`: `可能停駛`, `今日停駛`
- 附近 waits for nearby — `public/lib/near-ui.mjs`: `NEAR_WAIT_MS`
- 查時刻: TPASS-only trains, said so — `public/lib/tab-train.mjs`: `passOnly`, `只列 TPASS`
- 捷運: each city's metro map, straight lines, big and full screen; pinch, drag, two taps in — `public/lib/metromap.mjs`, `public/lib/tab-metro.mjs`: `straighten`, `mountMap`, `placeNames`, `mm-full`
- 捷運: 搜尋車站 across all nine systems by name, English name or code (BL12), with 最近查看, 附近, 轉乘站 — `public/lib/tab-metro.mjs`: `findMetro`, `findSheet`, `最近查看`
- 捷運: a station tapped on the map is ringed and opens its next trains — `public/lib/metromap.mjs`, `public/lib/tab-metro.mjs`: `select(node)`, `view?.select(n)`, `stationSheet`
- 高鐵訂票: a 高鐵 ride (a trip's step, 查時刻) opens 高鐵's own booking with it filled in — `public/lib/book.mjs`, `public/lib/tab-map.mjs`, `public/lib/tab-train.mjs`: `openBooking`, `canBook`, `data-book`
- A trip short enough to walk is always a walk, Google's planner or not (OpenStreetMap's streets and line past Google's 100 trips a day) — `public/lib/planner.mjs`: `walkPlan`, `WALK_TRIP_M`, `allWalk`
- Another app's link to a trip (Sports' 去球場, Class's 出門時間): `#plan?to=<lat>,<lon>,<name>&by=<ISO>` plans from where you are, arriving by then — `public/lib/links.mjs`, `public/app.mjs`: `planLink`, `planHash`, `openLink`
- The family's notebook on the phone: your 家, 學校 and 公司 places and saved trips (Weather's 下雨改搭公車 reads them), and a trip set out on with one known fare as your latest ride (Money's 車資記帳 offers it, never adds it alone) — `public/lib/family-share.mjs`, `public/app.mjs`, `public/lib/tab-map.mjs`: `shareFamily`, `rideFact`, `shareRide`
- 下雨改搭車: rain due on the way (Weather's notebook) puts a bus or the metro before a YouBike and a long walk, the wet legs marked with a drop and 會淋雨 — `public/lib/rain.mjs`, `public/lib/plan.mjs`, `public/lib/ui.mjs`: `rainFor`, `rainCost`, `markWet`, `ot-leg walk${wet}`
- 查時刻's bus search 全部: every city's and county's routes and the 公路客運 in one search, yours and around first, each found route saying where it runs (far ones by their two ends: a loop once, 循環; a long pair without its brackets); nothing found nearby offers 找全部 — `public/lib/tab-times.mjs`, `public/lib/bus.mjs`: `ALL`, `nearCities`, `findRoutes(list, text, n = 60, rank = null)`, `找全部`
- A route's 票價: on and off at any two stops, 全票 and each other rider (學生, 孩童, 敬老, 愛心, 半票, those at one price together; 刷卡 when it differs), by sections crossed (buffer zones counted), stop to stop or by stage (inside one stage, its 基本票價), as the operator publishes them — `public/lib/fare.mjs`, `public/lib/bus-ui.mjs`: `fareBetween`, `fareRows`, `fareGroups`, `data-fare-on`, `data-fare-off`
- A route's 時刻表 at a stop past the first: the first stop's times plus the ride, said so — `public/lib/live.mjs`, `public/lib/bus-ui.mjs`: `stopTable`, `發車時間推估`
- 查時刻: train kinds coloured, legs on one line — `public/lib/ui.mjs`: `trainColor`, `fitLegs`
- 建議 guesses a place: 去公司 / 去學校 from the first day, 常去 by Taiwan's calendar, a card passed over too often stops coming — `public/lib/suggest.mjs`, `public/lib/learn.mjs`: `goScore`, `workday`, `placeItem`, `cardsShown`
- Station picker on a county line map (winding rows, 新竹 one area, 高鐵 beside 台鐵 as one stop) — `public/lib/linemap.mjs`: `lineMapHtml`
- Bus arrival alerts — `public/lib/alerts.mjs`: `startAlerts`
- At a bus stop 5 minutes before its timetable time, 2 before a bus seen live; trains as timed — `public/lib/plan.mjs`, `public/lib/planner.mjs`, `public/lib/tab-go.mjs`: `boardEarly`, `BUS_EARLY`
- A bus seen gone is never planned or shown again; 趕不上了, never 快一點, when hurrying can't make it — `public/lib/live.mjs`, `public/lib/nav.mjs`: `seenAt`, `nextCatchable`, `pastHurry`, `趕不上了`
- 追公車: a YouBike to a stop further along the bus's way, planned (never on a replan under way, nor offered while navigating) — `public/lib/chase.mjs`, `public/lib/planner.mjs`: `chasePlan`, `chases(`, `chase: false`; kept steady and safe — `chaseSlack`, `chaseGain`, `chaseNow`, `steadyLead`
- 出狀況 under way, one card: missed or late for a bus, train or metro (下一班 or 最快, each with when you're there), late for a set time, no bikes or docks nearby, on the wrong ride, got off, gone another way — `public/lib/trouble.mjs`, `public/lib/nav.mjs`, `public/lib/tab-map.mjs`: `troubleHtml`, `fastest(`, `wrongRide`, `askMiss`, `navFastest`, `好像搭錯車了`
- A trip with stops navigated as one: the stops and what's after them in the chips (each a tap to look at), the bottom bar's time the next stop's (Jay 2026-11-07) — `public/lib/nav.mjs`, `public/lib/tab-map.mjs`: `navLater`, `data-nav-peek`, `ot-nav-chip stop`, `stopShort`
- On a bus that comes back past itself, a rough fix never ends the ride early or takes it back (Jay 2026-11-09) — `public/lib/navlive.mjs`, `public/lib/nav.mjs`: `rideAlong`, `rideOn`
- A step ahead looked at shows its own length and time, the trip's times unchanged — `public/lib/nav.mjs`: `state.reached`, `reachedPhase`
- 停著 or 還車 at a stop, with which is sooner — `public/lib/nav.mjs`: `parkAsk`, `到了要還車嗎`
- 附近換車 from 25 minutes on a YouBike with the free half hour — `public/lib/nav.mjs`: `附近換車`, `splitRide`
- A trip asked for on a bus or train planned from it (its stops ahead), 不在車上 to plan from the street — `public/lib/aboard.mjs`, `public/lib/planner.mjs`, `public/lib/tab-map.mjs`: `trainAboard`, `busesAboard`, `planAboard`, `不在車上`
- 交通 as one board: 要去哪裡, your places, each trip its own card (its own icon (the place it ends at, else its name: 學校, 家, 公司), its way as one line, the other ways), every pin a row in your order — `public/lib/tab-go.mjs`, `public/lib/board.mjs`, `public/lib/look.mjs`: `renderBoard`, `tripCard`, `tripTile`, `boardBuses`, `boardTrains`, `boardRow`
- A trip's row says when to leave, or why not; a tap opens its ways on the map — `public/lib/tab-go.mjs`: `tripWhy`, `whenHtml(p.dep`, `data-all-trip`
- A place chip opens the place: its buses, its bikes, 怎麼去 — `public/lib/tab-go.mjs`: `openPlace`, `data-go-place`
- A route's stops with its buses on the line (on a stop, between two), 進站中 / 即將進站 — `public/lib/bus-ui.mjs`, `public/transit.css`: `busAt`, `busBetween`, `ot-rs-bus`, `li.at .ot-rs-dot`
- 用說的查路線: a trip said in words (「明天八點前到台大醫院」), the plain ones read by code, a time read by the AI and shown as understood before 看路線; your own places by name, else the place search with the words in it — `public/lib/said.mjs`, `public/lib/say-trip.mjs`, `public/lib/tab-map.mjs`: `readSaid`, `whenOf`, `placeNamed`, `planSaid`
