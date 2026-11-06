// A trip as navigation recorded it (nav.mjs `trace`: the plan, every fix,
// the steps reached, the trouble cards shown; 除錯紀錄's `navtrip`) driven
// again through today's navigation, fix by fix, on its own clock. Only what
// GPS decides replays (live times are offline here): the steps moving on,
// getting off, the wrong ride, off its way.
import { clock, pos, tick, start } from './navsim.mjs';
const nav = await import('../public/lib/nav.mjs');

const settle = async () => {
  for (let n = 0; n < 20; n++) await new Promise(r => setImmediate(r));
};
// → { steps: [[i, phase]…], trouble: [kind…], st }
export async function replay(trace) {
  clock.set(trace.t0);
  // (The phone's last fix is where this trip starts, not where the last one ended.)
  nav.stopNav();
  const [, lat, lon] = trace.fixes[0] || [];
  if (trace.here || lat != null) pos(trace.here || { lat, lon });
  const plan = JSON.parse(JSON.stringify(trace.plan));
  const { st } = start(plan, { resume: trace.resume || null, here: trace.here ? { ...trace.here, at: trace.t0 } : null });
  await settle();
  for (const [s, lat, lon, acc] of trace.fixes) {
    const t = trace.t0 + s * 1000;
    if (t > clock.get()) tick(t - clock.get());
    pos({ lat, lon }, acc);
    await settle();
  }
  st.render?.();
  return { steps: st.trace.steps.map(([, i, phase]) => [i, phase]), trouble: st.trace.trouble.map(([, k]) => k), st };
}
