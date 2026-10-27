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

## What it does

- **Map:** live bus times at every stop, YouBike stations and train and metro stations around you.
- **Trip planning** that compares every real way to go and ranks them by door-to-door time and bother.
- **Navigation** that follows the trip step by step, buzzes before your stop and finds the next bus if you miss one.
- **Timetables** for trains, buses and each city's metro map with trains arriving live.
- **Alerts** like "tell me when the 5608 is 5 minutes away", even with the phone locked.

## Stack

- Plain JavaScript (ES modules), HTML and CSS: no framework, no build step, no runtime dependencies.
- An installable phone web app (Add to Home Screen), cached by a service worker.
- The look, sign-in (the Orbit Pass) and notices come from the shared kit in [Shared-Proxy](https://github.com/JayPengX/Shared-Proxy).
- Live data goes through the Orbit proxy on Cloudflare Workers (`api.jaypengx.com`). Live transit data from TDX; maps from Google, falling back to NLSC and OpenStreetMap.
- Hosted on GitHub Pages and served at jaypengx.com by a Cloudflare Worker; every push to `main` tests and deploys.

## For developers

```bash
npm test
```

How it works, file by file, and the decisions still in force: **[MAP.md](MAP.md)**.
