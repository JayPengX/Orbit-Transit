// Which way the phone faces, for the beam on your dot (Jay 2026-11-03: "the
// little my location dot need the where I am facing"). The compass first:
// an iPhone's webkitCompassHeading (it needs a tap to ask, so the ask rides
// on 我的位置 or the first tap anywhere once it was allowed), elsewhere
// deviceorientationabsolute's alpha. Moving with no compass, the GPS's own
// heading. Nothing known: no beam (never a guess).

import { readJson, writeJson } from './util.mjs';

const OK_KEY = 'orbit-transit.compass.v1';
// A compass silent this long (a desk, a phone flat in a pocket) gives way to the GPS.
const COMPASS_MS = 3000;
// Walking pace and up: below it a GPS heading wanders.
const MOVING_MS = 1.2;

// Degrees clockwise from north, as the screen is held: the compass reads
// the phone's top edge, so a phone on its side turns it by the screen's angle.
export function screenHeading(deg, screenAngle = 0) {
  if (deg == null || !Number.isFinite(deg)) return null;
  return (((deg + (screenAngle || 0)) % 360) + 360) % 360;
}
// The reading of one orientation event (null when it has none).
export function eventHeading(ev) {
  if (ev == null) return null;
  if (ev.webkitCompassHeading != null && Number.isFinite(ev.webkitCompassHeading)) {
    // (Below zero: iOS says the compass isn't calibrated.)
    return ev.webkitCompassAccuracy != null && ev.webkitCompassAccuracy < 0 ? null : ev.webkitCompassHeading;
  }
  if (ev.absolute && ev.alpha != null && Number.isFinite(ev.alpha)) return (360 - ev.alpha) % 360;
  return null;
}
// The GPS's heading, only when moving.
export const fixHeading = fix => (fix && Number.isFinite(fix.heading) && fix.speed >= MOVING_MS ? fix.heading : null);
// The turn shown: the nearest way round from the last (no spin from 359° to 0°).
export function unwrap(prev, next) {
  if (prev == null) return next;
  const d = ((((next - prev) % 360) + 540) % 360) - 180;
  return prev + d;
}

const state = { compass: null, at: 0, gps: null, fns: new Set(), on: false };
const screenAngle = () => globalThis.screen?.orientation?.angle ?? globalThis.orientation ?? 0;
function emit() {
  const c = state.compass != null && Date.now() - state.at < COMPASS_MS ? state.compass : null;
  const h = c ?? state.gps;
  for (const f of state.fns) f(h);
}
let frame = 0;
function onTurn(ev) {
  const h = screenHeading(eventHeading(ev), screenAngle());
  if (h == null) return;
  state.compass = h;
  state.at = Date.now();
  if (!frame) frame = (globalThis.requestAnimationFrame || (f => setTimeout(f, 16)))(() => ((frame = 0), emit()));
}
function listen() {
  if (state.on || !globalThis.addEventListener) return;
  state.on = true;
  // (Android's absolute event where there is one; an iPhone's ordinary one carries webkitCompassHeading.)
  const abs = 'ondeviceorientationabsolute' in globalThis;
  globalThis.addEventListener(abs ? 'deviceorientationabsolute' : 'deviceorientation', onTurn);
}
const needsAsk = () => typeof globalThis.DeviceOrientationEvent?.requestPermission === 'function';

// From a tap (iOS asks only then): the compass allowed, and kept in mind so
// the next opening asks again quietly on the first tap.
export async function askCompass() {
  listen();
  // (Already turning, as on Android, which sends it unasked: nothing to ask.)
  if (!needsAsk() || state.at) return true;
  try {
    const ok = (await globalThis.DeviceOrientationEvent.requestPermission()) === 'granted';
    writeJson(OK_KEY, ok);
    if (ok) listen();
    return ok;
  } catch {
    return false;
  }
}
// fn(heading or null) as it turns; the GPS's fixes come in by gpsFix.
export function watchHeading(fn) {
  state.fns.add(fn);
  // (Listened to at once: where nothing needs asking it comes; an iPhone sends nothing until allowed.)
  const asked = state.on;
  listen();
  if (!asked && needsAsk() && readJson(OK_KEY) === true) {
    const once = () => {
      document.removeEventListener('touchend', once, true);
      document.removeEventListener('click', once, true);
      if (!state.at) askCompass();
    };
    document.addEventListener('touchend', once, true);
    document.addEventListener('click', once, true);
  }
  return () => state.fns.delete(fn);
}
export function gpsFix(fix) {
  state.gps = fixHeading(fix);
  emit();
}
