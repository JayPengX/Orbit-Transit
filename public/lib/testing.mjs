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
//   模擬行程  (an action) the trip being navigated replayed into the GPS from its start
//            (tripsim.mjs; kit playTrip), the way picked (simWay: as planned, the
//            bus late, missed, stayed on, off early, the wrong one, walked away),
//            the GPS as picked (simGps), the clock 4 or 10 times as fast (simRate)
import { W } from '#kit/lang.mjs';
import { navArriveNow, navNow, navRide, legPts } from './nav.mjs';
import { truthPath, gpsFeed } from './tripsim.mjs';
import { isRide } from './util.mjs';

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
    sub: W('每一站都沒車、沒位、只剩 1 台，或暫停營運', 'Every station empty, full, down to 1 bike, or closed'),
    flag: 'bikes',
    options: [
      { id: 'empty', label: W('沒車', 'No bikes') },
      { id: 'full', label: W('沒位', 'No docks') },
      { id: 'low', label: W('剩 1 台', '1 bike') },
      { id: 'paused', label: W('暫停', 'Closed') }
    ]
  },
  { app, title: W('今天放假', 'Day off today'), sub: W('今天當作颱風假：每週的行程今天休息', 'Today a typhoon day off: weekly trips rest'), flag: 'dayOff' },
  {
    app,
    title: W('模擬：怎麼走', 'Replay: what happens'),
    sub: W('模擬行程時這個人怎麼走（第一段車）', 'How the replayed trip goes (its first ride)'),
    flag: 'simWay',
    options: [
      { id: 'late', label: W('車晚 6 分', 'Ride 6 min late') },
      { id: 'miss', label: W('錯過車', 'Missed it') },
      { id: 'over', label: W('坐過站', 'Stayed on') },
      { id: 'early', label: W('提早下車', 'Off early') },
      { id: 'wrong', label: W('搭錯車', 'Wrong ride') },
      { id: 'stray', label: W('走錯路', 'Walked away') }
    ]
  },
  {
    app,
    title: W('模擬：GPS', 'Replay: GPS'),
    sub: W('關＝一般手機；其他越來越差（跳點、沒訊號、隧道）', 'Off = a phone on a normal day; the rest worse (jumps, gaps, tunnels)'),
    flag: 'simGps',
    options: [
      { id: 'clean', label: W('很準', 'Clean') },
      { id: 'city', label: W('市區', 'City') },
      { id: 'background', label: W('常斷訊', 'Gaps') },
      { id: 'train', label: W('火車上', 'On a train') }
    ]
  },
  {
    app,
    title: W('模擬：速度', 'Replay: speed'),
    sub: W('關＝真實時間', 'Off = real time'),
    flag: 'simRate',
    options: [
      { id: '4', label: W('4 倍', '×4') },
      { id: '10', label: W('10 倍', '×10') }
    ]
  },
  {
    app,
    title: W('模擬行程', 'Replay the trip'),
    sub: W('正在導航的行程從頭重走一次，位置照上面選的', 'The trip being navigated, from its start, as picked above'),
    label: W('開始', 'Start'),
    run: async () => {
      const now = navNow();
      if (!now) return W('先開始一段導航', 'Start a navigation first');
      const tt = await import('#kit/testtools.mjs');
      if (!tt.playTrip) return W('需要更新後才能用', 'Needs an update first');
      const f = globalThis.ORBIT_TEST?.flags || {};
      const plan = now.plan;
      const k = plan.legs.findIndex(isRide);
      const rs = k >= 0 ? navRide(k) : null;
      const from = plan.dep - 60_000;
      const truth = truthPath(plan, { scenario: f.simWay || 'plan', k: k >= 0 ? k : null, legPts, start: from, more: rs?.stops?.slice((rs.j ?? -2) + 1), before: rs?.stops?.[(rs.j ?? 0) - 1] });
      const fixes = gpsFeed(truth, f.simGps || 'phone', Math.floor(Math.random() * 1e6)).map(x => [Math.round((x.got - from) / 1000), +x.lat.toFixed(6), +x.lon.toFixed(6), x.acc, Math.round((x.at - from) / 1000)]);
      // (Navigation picked up again from the trip's start, as it was set out on.)
      try {
        localStorage.setItem('ot.nav.v1', JSON.stringify({ plan, i: 0, reached: 0, phase: 'before', min: false, at: from }));
      } catch {}
      document.querySelector('dialog.q-tester[open]')?.close();
      tt.playTrip({ from, fixes, rate: Number(f.simRate) || 1 });
    }
  },
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
