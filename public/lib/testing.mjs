// Orbit Transit's own switches in the kit's 測試工具 (hidden until unlocked:
// Orbit Pass › seven taps on 除錯紀錄). Each changes only what's shown or read,
// never what's saved or sent; read where it acts as globalThis.ORBIT_TEST?.flags?.<name>
// (the page reloads when one changes). The kit's clock, place and network
// switches work here as everywhere: Transit's clock is every Date, its place
// the page's geolocation (api.mjs's one watch).
//   busNow   every bus ETA (bus.mjs etaOf): now 進站中 · due 即將進站 · soon 5 分 · stale 資料停住 · off 今日停駛
//   tdx      every TDX read (api.mjs ask): fail 503 · busy 429 · copy the proxy's copy, 10 minutes old
//   traLate  every 台鐵 train on the boards 12 minutes late (raildata.mjs traLive, traTrain)
//   bikes    every YouBike station (bike.mjs mergeBikes): empty · full (no docks) · low (1 bike)
//   dayOff   today a day off, as a typhoon's (util.mjs holidayOn): weekly trips and 通勤小幫手 rest
//   導航：已抵達  (an action) the trip being navigated there now (nav.mjs navArriveNow)
import { W } from '#kit/lang.mjs';
import { navArriveNow } from './nav.mjs';

const app = 'transit';
(globalThis.ORBIT_TEST_TOOLS ||= []).push(
  {
    app,
    title: W('公車到站', 'Bus arrivals'),
    sub: W('每一班公車的到站時間都換成選的狀態', 'Every bus’s time set to the state picked'),
    flag: 'busNow',
    options: [
      { id: 'now', label: W('進站中', 'Arriving') },
      { id: 'due', label: W('即將進站', 'Due') },
      { id: 'soon', label: W('5 分', '5 min') },
      { id: 'stale', label: W('資料停住', 'Feed stopped') },
      { id: 'off', label: W('今日停駛', 'Not running') }
    ]
  },
  {
    app,
    title: W('交通資料', 'Transit data'),
    sub: W('讀不到、太忙，或只有 10 分鐘前的副本', 'Failing, busy, or only a copy 10 minutes old'),
    flag: 'tdx',
    options: [
      { id: 'fail', label: W('失敗', 'Failing') },
      { id: 'busy', label: W('太忙', 'Busy') },
      { id: 'copy', label: W('只有副本', 'Copies') }
    ]
  },
  { app, title: W('台鐵誤點', 'TRA trains late'), sub: W('看板上每一班台鐵都晚 12 分', 'Every TRA train on the boards 12 min late'), flag: 'traLate' },
  {
    app,
    title: W('YouBike 站', 'YouBike stations'),
    sub: W('每一站都沒車、沒位，或只剩 1 台', 'Every station empty, full, or down to 1 bike'),
    flag: 'bikes',
    options: [
      { id: 'empty', label: W('沒車', 'No bikes') },
      { id: 'full', label: W('沒位', 'No docks') },
      { id: 'low', label: W('剩 1 台', '1 bike') }
    ]
  },
  { app, title: W('今天放假', 'Day off today'), sub: W('今天當作颱風假：每週的行程今天休息', 'Today a typhoon day off: weekly trips rest'), flag: 'dayOff' },
  {
    app,
    title: W('導航：已抵達', 'Navigation: arrived'),
    sub: W('正在導航的行程直接到達目的地', 'The trip being navigated arrives now'),
    label: W('抵達', 'Arrive'),
    run: () => {
      document.querySelector('dialog.q-tester[open]')?.close();
      if (!navArriveNow()) return W('先開始一段導航', 'Start a navigation first');
    }
  }
);
