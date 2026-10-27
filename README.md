<p align="center">
  <img src="public/icons/icon-192.png" width="96" height="96" alt="">
</p>

<h1 align="center">Orbit Transit</h1>

<p align="center">
  <b>Bus, train and bike.</b><br>
  <a href="https://jaypengx.com/transit/"><b>jaypengx.com/transit</b></a>
</p>

<p align="center">
  <img alt="JavaScript" src="https://img.shields.io/badge/JavaScript-ES_modules-F7DF1E?logo=javascript&logoColor=000"> <img alt="PWA" src="https://img.shields.io/badge/PWA-works_offline-5A0FC8?logo=pwa&logoColor=fff"> <img alt="Cloudflare" src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=fff"> <img alt="GitHub" src="https://img.shields.io/badge/GitHub-Pages-24292F?logo=github&logoColor=fff"> <img alt="Tests" src="https://img.shields.io/badge/Tests-node_--test-339933?logo=nodedotjs&logoColor=fff">
</p>

Taiwan's buses, 台鐵, 高鐵, metros and YouBike in one app, with trips planned the way people really travel. Part of **Orbit**, a family of phone apps for life in Taiwan that share one sign-in, the Orbit Pass. See them all at [jaypengx.com](https://jaypengx.com/).

<p align="center">
  <img src="docs/screenshots/transit-1.webp" width="240" alt="The map">
  <img src="docs/screenshots/transit-2.webp" width="240" alt="Train times">
  <img src="docs/screenshots/transit-3.webp" width="240" alt="A metro map">
</p>

## Features

- **Map:** every bus stop with live arrival times, YouBike stations with bikes and docks (the five nearest along the bottom), train and metro stations, search and your pins.
- **Trip planning** across bus, 台鐵, 高鐵, the metros and YouBike, ranked by door-to-door minutes and how much bother each way is. There is always a recommendation.
- **Navigation** that follows the trip: every step moves on by itself, countdowns, the stops to go, a buzz before yours, the next bus if you miss one, and it survives the app being swiped away.
- **Timetables:** 台鐵 and 高鐵 station to station, bus routes and stops, and each city's metro drawn as a metro map with the trains arriving now.
- **YouBike rental timer** that warns before TPASS's free half hour runs out and offers docks nearby.
- **到站提醒:** "tell me when the 5608 is 5 minutes away", checked by the server while the phone is locked.
- **Service notices** from the operators themselves: a stopped line or route is marked and never planned.
- **Saved places and trips** (家, 學校, your own), synced through the Orbit Pass.

## Tech stack

| Layer | What |
| --- | --- |
| App | Plain JavaScript (ES modules), HTML and CSS; no framework, no build step, no dependencies |
| Platform | Installable web app with a service worker; location and vibration for navigation, lock-screen notices while it runs |
| Shared | Look, Orbit Pass, notices and data reads from the kit in [Shared-Proxy](https://github.com/JayPengX/Shared-Proxy) |
| Data | TDX (Taiwan's transport data exchange) through the Orbit proxy on Cloudflare Workers; weekly bus packs and line shapes in Cloudflare R2 |
| Maps | Google Maps under the month's cap, else Leaflet with NLSC's tiles; walks on Google's streets, else OpenStreetMap |
| Routing | Our own 台鐵/高鐵 router (Connection Scan) and metro router, beside Google's and TDX's planners |
| Tests | `node --test`, including navigation driven fix by fix and the owner's verdicts on real trips |

## How it works

```
plan a trip
  ├─ Google's planner ┐
  ├─ TDX's planner    ├─► every way, re-timed by live bus estimates
  ├─ rail.mjs (CSA)   │
  └─ metro router     ┘
        ▼
  plan.mjs rank: 1. fold the ways a person wouldn't take
                 2. order the rest by minutes + a small table of bother
        ▼
  nav.mjs: the whole trip on the map, step by step, live
```

- **Costs in minutes, the way a person feels them:** a short wait at home counts a third, changing onto a train is easy and onto a bus a risk, YouBike past 30 minutes counts 4.5× per minute, walking is 5 km/h.
- **Planned once:** a saved trip's ways are kept and only re-timed; the billed planners are asked again only when the ways could differ.
- **What's near you** is worked out on the phone from R2 packs, not asked of a server.

The full map, the ranking rules and the decisions in force: **[MAP.md](MAP.md)**.

## Project structure

```
public/
├── index.html, app.mjs    the frame: Pass, tabs, location
├── transit.css            the app's look on top of the kit's
├── lib/                   42 modules
│   ├── planner.mjs, plan.mjs, live.mjs        planning, ranking, live re-timing
│   ├── rail.mjs, metro*.mjs                   train router; metro router, boards, maps
│   ├── bus.mjs, near.mjs, packs.mjs, shapes.mjs
│   ├── bike.mjs, rental.mjs, rivers.mjs, tpass.mjs
│   ├── nav.mjs, navlive.mjs, buzz.mjs, alerts.mjs
│   ├── service.mjs                            operators' notices as rules
│   └── tab-*.mjs, map.mjs, store.mjs          each tab; the map; the Pass's data
└── sw.js
scripts/                   live trips, verdicts, replays, metro maps
tests/                     node --test, with tests/verdicts/
MAP.md                     how it works, file by file
```

## Getting started

The app loads the shared kit from a sibling folder, so clone this repo next to [Shared-Proxy](https://github.com/JayPengX/Shared-Proxy):

```bash
git clone https://github.com/JayPengX/Shared-Proxy.git
git clone https://github.com/JayPengX/Orbit-Transit.git
cd Orbit-Transit
```

Requirements: Node.js 22 or newer. There is nothing to install: no framework, no `node_modules`.

```bash
npm test   # links ../Shared-Proxy/kit as .kit, then runs node --test
```

See it on a phone-sized screen, signed in with a made-up wallet and real data (needs Playwright):

```bash
# a screenshot, saved in /tmp/orbit-preview
node ../Shared-Proxy/tools/preview.mjs transit --live --width 375
# serve it, then open http://localhost:8123/Orbit-Transit/
node ../Shared-Proxy/tools/preview.mjs transit --live --serve --port 8123
```

`--dark`, `--lang en`, `--webkit` (Safari's engine) and the other flags are listed in [Shared-Proxy/tools/README.md](https://github.com/JayPengX/Shared-Proxy/blob/main/tools/README.md).

Run a trip on today's real data, and compare the ranking before and after a change:

```bash
node scripts/live.mjs 竹東站 縣體育場
node scripts/live.mjs --against HEAD
```

`scripts/replay.mjs` re-runs a debug log (`--why` shows each way's score) and `scripts/verdict.mjs` saves a new verdict.

## Deploying

Push to `main`. GitHub Actions runs the tests, stamps every file with its content hash (so a phone downloads only what changed) and publishes `public/` to GitHub Pages; the site Worker serves it at its jaypengx.com address. There are no pull requests or release branches.

## Part of Orbit

| App | What it is |
| --- | --- |
| [Orbit Sports](https://github.com/JayPengX/Orbit-Sports) | Every game you can watch in Taiwan, live |
| [Orbit Transit](https://github.com/JayPengX/Orbit-Transit) | Bus, train, metro and YouBike, planned and navigated |
| [Orbit Weather](https://github.com/JayPengX/Orbit-Weather) | One clear forecast, to the township |
| [Orbit Words](https://github.com/JayPengX/Orbit-Words) | English vocabulary that stays |
| [Orbit Securities](https://github.com/JayPengX/Orbit-Securities) | A Taiwan broker on play money |
| [Orbit Class](https://github.com/JayPengX/Orbit-Class) | Today's classes at a glance |
| [Orbit Beats](https://github.com/JayPengX/Orbit-Beats) | Endless music and your own beats |
| [Orbit Law](https://github.com/JayPengX/Orbit-Law) | Laws, rulings and bills, linked |
| [Orbit Money](https://github.com/JayPengX/Orbit-Money) | Your own books |
| [Shared-Proxy](https://github.com/JayPengX/Shared-Proxy) | The kit, the Orbit Pass and the Workers behind them all |

How it was all built, in pictures and numbers: [jaypengx.com/showcase](https://jaypengx.com/showcase/).
