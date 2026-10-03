// A buzz for "get off next" and a bus alert. Android vibrates; an iPhone's
// Safari has no navigator.vibrate, so it plays a short chime instead. iOS
// only lets a page make sound once a tap has started its audio: primeBuzz()
// runs on the tap that starts navigation or sets an alert. (The ring/silent
// switch still silences it, as it should.)

let ctx = null;

export function primeBuzz() {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) return;
  try {
    ctx ||= new (globalThis.AudioContext || globalThis.webkitAudioContext)();
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
  } catch {}
}

export function buzz() {
  try {
    if (navigator.vibrate?.([200, 100, 200])) return;
  } catch {}
  if (!ctx) return;
  // Back from the background, iOS leaves it suspended ("interrupted").
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  try {
    // Two short rising notes, like the buzz's two pulses.
    for (const [at, hz] of [[0, 880], [0.28, 1175]]) {
      const t = ctx.currentTime + at;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.24);
    }
  } catch {}
}
