// The map: Google's (the most detail for Taiwan: every shop and place, and
// its transit lines) while the month is under the proxy's cap, else
// Taiwan's own NLSC map (內政部國土測繪中心, free) in Leaflet. One small
// interface over both: markers as HTML (bikes, stops, stations), lines (a
// plan's route), taps on the map and on Google's places.

import { TAIWAN_BOX } from './util.mjs';

import { W, en } from '#kit/lang.mjs';
const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
const NLSC = 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}';

// Is the page dark now (the phone's setting, or the page's own data-theme)?
const darkNow = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : Boolean(globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches);
};

// Google's map in the app's dark colours (its own default look in light).
const DARK = [
  { elementType: 'geometry', stylers: [{ color: '#161a22' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9aa3b5' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0d0f14' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#2a2f3a' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#c6ccd8' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#8e97a8' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#1a1f29' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#14261d' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#5f8f72' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#262b36' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1b1f28' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8f98aa' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#343b4a' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1f2430' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#c2c9d6' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2b3140' }] },
  { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#b9c2d3' }] },
  // Google's own bus stops off: ours (each side of the road, with live times) are the ones to tap.
  { featureType: 'transit.station.bus', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0c1724' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4e6680' }] }
];

function script(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`load ${src}`));
    document.head.append(s);
  });
}
function style(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  document.head.append(l);
}

let googleLoad = null;
function loadGoogle(key) {
  if (globalThis.google?.maps?.Map) return Promise.resolve();
  // (Asked by the page as it opened, with this key: that one.)
  if (!googleLoad && globalThis.__otMapsEarly && String(document.querySelector('script[src*="maps.googleapis.com"]')?.src || '').includes(encodeURIComponent(key)))
    googleLoad = Promise.race([globalThis.__otMapsEarly, new Promise((_, reject) => setTimeout(() => reject(new Error('maps timeout')), 15_000))]);
  googleLoad ||= new Promise((resolve, reject) => {
    globalThis.__otMaps = resolve;
    script(`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&language=${en ? 'en' : 'zh-TW'}&region=TW&loading=async&callback=__otMaps`).catch(reject);
    setTimeout(() => reject(new Error('maps timeout')), 15_000);
  });
  return googleLoad;
}
let leafletLoad = null;
function loadLeaflet() {
  if (globalThis.L?.map) return Promise.resolve();
  style(`${LEAFLET}leaflet.min.css`);
  // (Asked by the page as it opened: that one, or again if it failed.)
  leafletLoad ||= globalThis.__otLeafletEarly ? globalThis.__otLeafletEarly.catch(() => script(`${LEAFLET}leaflet.min.js`)) : script(`${LEAFLET}leaflet.min.js`);
  return leafletLoad;
}

// Markers as HTML: set(items) keeps those with the same id (only their
// content changed), adds the new, drops the rest.
//   item: { id, lat, lon, html, cls, z, data }
// The marker tapped (map.select): drawn as itself, selected (.is-sel, on top),
// not covered by a pin.
function domItems(make, selected = () => null) {
  const els = new Map();
  let last = [];
  return {
    els,
    again() {
      this.set(last);
    },
    set(list) {
      last = list;
      const s = selected();
      const items = s ? list.map(it => (it.id === s.id && it.lat === s.lat && it.lon === s.lon ? { ...it, cls: `${it.cls || ''} is-sel`, z: (it.z || 1) + 50 } : it)) : list;
      const keep = new Set();
      for (const it of items) {
        keep.add(it.id);
        let rec = els.get(it.id);
        if (!rec) {
          rec = make(it);
          els.set(it.id, rec);
        } else rec.update(it);
      }
      for (const [id, rec] of els) if (!keep.has(id)) {
        rec.remove();
        els.delete(id);
      }
    }
  };
}

// onDrag: the map moved by a finger (not by the app), e.g. to stop following you.
export async function createMap(el, { provider = 'nlsc', key = '', center, zoom = 15, onPick = () => {}, onTap = () => {}, onIdle = () => {}, onPlace = () => {}, onDrag = () => {} } = {}) {
  // A pinch (two fingers) or a wheel is the person's, however soon after one
  // of the app's own fits (a zoom within 1.5 s of one counts as the app's:
  // the owner, 2026-10-28, a pinch just after tapping a step snapped back).
  el.addEventListener('touchstart', ev => ev.touches.length > 1 && onDrag(), { passive: true });
  el.addEventListener('wheel', () => onDrag(), { passive: true });
  if (provider === 'google' && key) {
    try {
      await loadGoogle(key);
      return googleMap(el, { center, zoom, onPick, onTap, onIdle, onPlace, onDrag });
    } catch {
      // Google didn't load (offline, the key refused): Taiwan's map instead.
    }
  }
  await loadLeaflet();
  return leafletMap(el, { center, zoom, onPick, onTap, onIdle, onDrag });
}

// Room between a fit's paddings: none while a page comes back from the
// background (its size not known yet, or the cards over the map taller than
// it), and a fit then zooms out to the whole island (the owner, navigating,
// 2026-10-13); it's left for the next one.
// The pin nearest a tap that missed it by a finger's width (a pin's own tap is lost when its
// icon is redrawn under the finger, or the finger lands beside it): the tap's page point, the
// marker layers' items → the item or null.
const HIT_PAD = 14;
function pinAt(event, itemSets) {
  const t = event?.changedTouches?.[0] || event;
  if (!Number.isFinite(t?.clientX)) return null;
  let best = null;
  let bestD = Infinity;
  for (const els of itemSets)
    for (const rec of els.values()) {
      const r = rec.it.kind && rec.el?.()?.getBoundingClientRect();
      if (!r || !r.width) continue;
      if (t.clientX < r.left - HIT_PAD || t.clientX > r.right + HIT_PAD || t.clientY < r.top - HIT_PAD || t.clientY > r.bottom + HIT_PAD) continue;
      const d = Math.hypot(t.clientX - (r.left + r.right) / 2, t.clientY - (r.top + r.bottom) / 2);
      if (d < bestD) [best, bestD] = [rec.it, d];
    }
  return best;
}
const roomFor = (el, p) => el.clientWidth - p.left - p.right >= 60 && el.clientHeight - p.top - p.bottom >= 60;

function googleMap(el, { center, zoom, onPick, onTap, onIdle, onPlace, onDrag }) {
  const g = globalThis.google.maps;
  const map = new g.Map(el, {
    center: { lat: center.lat, lng: center.lon },
    zoom,
    styles: darkNow() ? DARK : null,
    backgroundColor: darkNow() ? '#0a0b0f' : '#e8eaed',
    disableDefaultUI: true,
    clickableIcons: true,
    gestureHandling: 'greedy',
    keyboardShortcuts: false,
    isFractionalZoomEnabled: false,
    // Taiwan only (what the app covers): never the world, never off the island's edges.
    restriction: { latLngBounds: { north: TAIWAN_BOX.n, south: TAIWAN_BOX.s, west: TAIWAN_BOX.w, east: TAIWAN_BOX.e }, strictBounds: false },
    minZoom: 7
  });
  // (The phone changes between light and dark while the app is open.)
  globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => map.setOptions({ styles: darkNow() ? DARK : null }));
  const transit = new g.TransitLayer();
  transit.setMap(map);
  // (The first screen's tiles in: what the loading screen waits for.)
  const tiles = new Promise(r => g.event.addListenerOnce(map, 'tilesloaded', r));
  map.addListener('click', ev => {
    // A tap on one of Google's places: ours to show, not Google's bubble.
    if (ev.placeId) {
      ev.stop();
      return onPlace({ id: ev.placeId, lat: ev.latLng.lat(), lon: ev.latLng.lng() });
    }
    onTap({ lat: ev.latLng.lat(), lon: ev.latLng.lng() }, pinAt(ev.domEvent, [...layers.values()].map(l => l.items.els)));
  });
  map.addListener('idle', () => onIdle());
  map.addListener('dragstart', () => onDrag());
  // A zoom by a finger (a pinch, a double tap) counts too; the app's own (following you, fitting a way) don't.
  let byApp = 0;
  map.addListener('zoom_changed', () => Date.now() - byApp > 1500 && onDrag());

  // One overlay for all HTML markers, placed once a frame.
  class Layer extends g.OverlayView {
    constructor() {
      super();
      this.box = document.createElement('div');
      this.box.className = 'ot-layer';
      this.items = domItems(it => this.make(it), () => sel);
    }
    onAdd() {
      this.getPanes().overlayMouseTarget.append(this.box);
    }
    onRemove() {
      this.box.remove();
    }
    make(it) {
      const node = document.createElement('div');
      g.OverlayView.preventMapHitsAndGesturesFrom(node);
      node.addEventListener('click', ev => {
        ev.stopPropagation();
        onPick(rec.it);
      });
      const rec = {
        it,
        node,
        el: () => node,
        update: x => {
          if (x.html !== rec.it.html) node.innerHTML = x.html;
          if (x.cls !== rec.it.cls) node.className = `ot-mk ${x.cls || ''}`;
          if (x.z !== rec.it.z) node.style.zIndex = String(x.z || 1);
          if (x.lat !== rec.it.lat || x.lon !== rec.it.lon) {
            rec.it = x;
            this.place(rec);
          }
          rec.it = x;
        },
        remove: () => node.remove()
      };
      node.className = `ot-mk ${it.cls || ''}`;
      node.innerHTML = it.html;
      node.style.zIndex = String(it.z || 1);
      this.box.append(node);
      this.place(rec);
      return rec;
    }
    place(rec) {
      const p = this.getProjection()?.fromLatLngToDivPixel(new g.LatLng(rec.it.lat, rec.it.lon));
      if (p) rec.node.style.transform = `translate(${p.x}px, ${p.y}px)`;
    }
    draw() {
      for (const rec of this.items.els.values()) this.place(rec);
    }
  }
  const layers = new Map();
  const lineSets = new Map();
  let sel = null;
  return {
    kind: 'google',
    tiles: () => tiles,
    select(it) {
      sel = it ? { id: it.id, lat: it.lat, lon: it.lon } : null;
      for (const l of layers.values()) l.items.again();
    },
    raw: map,
    center: () => ({ lat: map.getCenter().lat(), lon: map.getCenter().lng() }),
    zoom: () => map.getZoom(),
    bounds() {
      const b = map.getBounds();
      if (!b) return null;
      const ne = b.getNorthEast();
      const sw = b.getSouthWest();
      return { n: ne.lat(), e: ne.lng(), s: sw.lat(), w: sw.lng() };
    },
    // `dy`: the point `dy` px above the middle (the middle of what a sheet over the map leaves in view),
    // `dx`: and `dx` px left of it (the middle of what the round buttons at the right leave).
    setView(lat, lon, z, dy = 0, dx = 0) {
      byApp = Date.now();
      map.panTo({ lat, lng: lon });
      if (z) map.setZoom(z);
      if (Math.round(dy) || Math.round(dx)) map.panBy(Math.round(dx), Math.round(dy));
    },
    // A point `dy` px above the map's middle (the middle of what the
    // search bar and a card over the map leave in view).
    focus(lat, lon, dy = 0, dx = 0) {
      byApp = Date.now();
      map.panTo({ lat, lng: lon });
      if (Math.round(dy) || Math.round(dx)) map.panBy(Math.round(dx), Math.round(dy));
    },
    fit(points, pad = 60) {
      if (!points.length) return;
      const p = typeof pad === 'object' ? pad : { top: pad, bottom: pad, left: pad, right: pad };
      if (!roomFor(el, p)) return false;
      byApp = Date.now();
      const b = new g.LatLngBounds();
      for (const x of points) b.extend({ lat: x.lat, lng: x.lon });
      map.fitBounds(b, p);
      return true;
    },
    layer(name) {
      if (!layers.has(name)) {
        const l = new Layer();
        l.setMap(map);
        layers.set(name, l);
      }
      return layers.get(name).items;
    },
    lines(name, list) {
      for (const p of lineSets.get(name) || []) p.setMap(null);
      lineSets.set(
        name,
        list.map(
          l =>
            new g.Polyline({
              map,
              path: l.pts.map(([lat, lng]) => ({ lat, lng })),
              strokeColor: l.color,
              strokeOpacity: l.dash ? 0 : 0.95,
              strokeWeight: l.width || 6,
              zIndex: l.z || 5,
              icons: l.dash ? [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: l.color, scale: 3 }, offset: '0', repeat: '10px' }] : []
            })
        )
      );
    },
    showTransit(on) {
      transit.setMap(on ? map : null);
    },
    resize() {
      g.event.trigger(map, 'resize');
    }
  };
}

// A marker's name (its `> span`) hidden where it would overlap a name or an
// icon above it (by z-index; the selected one is never hidden).
function declutter(pane) {
  if (!pane) return;
  const els = [...pane.querySelectorAll('.ot-mk')].sort((a, b) => (Number(b.style.zIndex) || 0) - (Number(a.style.zIndex) || 0));
  const taken = [];
  const hits = r => taken.some(t => r.left < t.right - 1 && r.right > t.left + 1 && r.top < t.bottom - 1 && r.bottom > t.top + 1);
  // (Leaflet adds each marker's height on the screen to its z: a step of a
  // thousand keeps a station over a bike lower down, not just a hundred.)
  for (const m of els) {
    // A YouBike count over a station's icon, a place or your dot steps aside
    // the same way, by the other markers only (bikes side by side stay put).
    if (m.classList.contains('bike') && !m.classList.contains('plan')) {
      m.style.translate = '';
      const r = m.getBoundingClientRect();
      const others = taken.filter(t => !t.bike);
      const over = x => others.some(t => x.left < t.right - 1 && x.right > t.left + 1 && x.top < t.bottom - 1 && x.bottom > t.top + 1);
      const t = r.width ? others.find(t => r.left < t.right - 1 && r.right > t.left + 1 && r.top < t.bottom - 1 && r.bottom > t.top + 1) : null;
      let box = r;
      if (t) {
        const moves = [
          [t.right + 3 - r.left, 0],
          [t.left - 3 - r.right, 0],
          [0, t.top - 3 - r.bottom],
          [0, t.bottom + 3 - r.top]
        ].sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
        const at = ([dx, dy]) => ({ left: r.left + dx, right: r.right + dx, top: r.top + dy, bottom: r.bottom + dy });
        const d = moves.find(d => !over(at(d)));
        if (d) {
          m.style.translate = `${Math.round(d[0])}px ${Math.round(d[1])}px`;
          box = at(d);
        }
      }
      if (r.width) taken.push({ left: box.left, right: box.right, top: box.top, bottom: box.bottom, bike: true });
      continue;
    }
    // A trip's station badge (its bikes, its docks) under a pin or your dot
    // moves to the nearest clear side instead (a badge can't hide: it's the plan).
    if (m.classList.contains('plan')) {
      m.style.translate = '';
      const r = m.getBoundingClientRect();
      const t = r.width ? taken.find(t => r.left < t.right - 1 && r.right > t.left + 1 && r.top < t.bottom - 1 && r.bottom > t.top + 1) : null;
      if (t) {
        const moves = [
          [t.right + 4 - r.left, 0],
          [t.left - 4 - r.right, 0],
          [0, t.top - 4 - r.bottom],
          [0, t.bottom + 4 - r.top]
        ].sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
        const at = ([dx, dy]) => ({ left: r.left + dx, right: r.right + dx, top: r.top + dy, bottom: r.bottom + dy });
        const [dx, dy] = moves.find(d => !hits(at(d))) || moves[0];
        m.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
        taken.push(at([dx, dy]));
      } else if (r.width) taken.push(r);
      continue;
    }
    const label = m.querySelector(':scope > span');
    const icon = m.querySelector(':scope > svg, :scope > i');
    const ir = (icon || m).getBoundingClientRect();
    if (label) {
      const lr = label.getBoundingClientRect();
      const hide = !m.classList.contains('sel') && lr.width > 0 && hits(lr);
      m.classList.toggle('ot-lb-hide', hide);
      if (!hide) taken.push(lr);
    }
    if (ir.width) taken.push(ir);
  }
}

function leafletMap(el, { center, zoom, onPick, onTap, onIdle, onDrag }) {
  const L = globalThis.L;
  // (Taiwan only, as the Google map.)
  const map = L.map(el, { zoomControl: false, attributionControl: true, center: [center.lat, center.lon], zoom, maxZoom: 19, minZoom: 7, maxBounds: [[TAIWAN_BOX.s, TAIWAN_BOX.w], [TAIWAN_BOX.n, TAIWAN_BOX.e]], maxBoundsViscosity: 1 });
  map.attributionControl.setPrefix('');
  const layer = L.tileLayer(NLSC, { maxZoom: 19, maxNativeZoom: 19, attribution: W('© 內政部國土測繪中心', '© NLSC'), className: 'ot-tiles' });
  const tiles = new Promise(r => layer.once('load', r));
  layer.addTo(map);
  map.on('click', ev => onTap({ lat: ev.latlng.lat, lon: ev.latlng.lng }, pinAt(ev.originalEvent, [...layers.values()].map(l => l.els))));
  map.on('moveend', () => onIdle());
  map.on('dragstart', () => onDrag());
  // Names that would run into each other (北新竹 under 千甲's icon) aren't
  // shown: the higher marker's name stays, a lower one's hides, its icon kept.
  let tidyRaf = 0;
  const tidy = () => {
    tidyRaf ||= requestAnimationFrame(() => {
      tidyRaf = 0;
      declutter(map.getPane('markerPane'));
    });
  };
  map.on('zoomend moveend', tidy);
  if (typeof MutationObserver === 'function') new MutationObserver(tidy).observe(map.getPane('markerPane'), { childList: true });
  let byApp = 0;
  map.on('zoomstart', () => Date.now() - byApp > 1500 && onDrag());
  const layers = new Map();
  const lineSets = new Map();
  let sel = null;
  const markerLayer = () =>
    domItems(it => {
      const icon = x => L.divIcon({ className: `ot-mk ${x.cls || ''}`, html: x.html, iconSize: null });
      const m = L.marker([it.lat, it.lon], { icon: icon(it), zIndexOffset: (it.z || 1) * 1000, keyboard: false }).addTo(map);
      const rec = {
        it,
        el: () => m.getElement(),
        update: x => {
          if (x.html !== rec.it.html || x.cls !== rec.it.cls) m.setIcon(icon(x));
          if (x.lat !== rec.it.lat || x.lon !== rec.it.lon) m.setLatLng([x.lat, x.lon]);
          if (x.z !== rec.it.z) m.setZIndexOffset((x.z || 1) * 1000);
          rec.it = x;
        },
        remove: () => m.remove()
      };
      m.on('click', ev => {
        L.DomEvent.stopPropagation(ev);
        onPick(rec.it);
      });
      return rec;
    }, () => sel);
  return {
    kind: 'nlsc',
    tiles: () => tiles,
    select(it) {
      sel = it ? { id: it.id, lat: it.lat, lon: it.lon } : null;
      for (const l of layers.values()) l.again();
    },
    raw: map,
    center: () => ({ lat: map.getCenter().lat, lon: map.getCenter().lng }),
    zoom: () => map.getZoom(),
    bounds() {
      const b = map.getBounds();
      return { n: b.getNorth(), e: b.getEast(), s: b.getSouth(), w: b.getWest() };
    },
    setView(lat, lon, z, dy = 0, dx = 0) {
      byApp = Date.now();
      const zoom = z || map.getZoom();
      map.setView(dy || dx ? map.unproject(map.project([lat, lon], zoom).add([Math.round(dx), Math.round(dy)]), zoom) : [lat, lon], zoom);
    },
    focus(lat, lon, dy = 0, dx = 0) {
      byApp = Date.now();
      const z = map.getZoom();
      map.panTo(map.unproject(map.project([lat, lon], z).add([Math.round(dx), Math.round(dy)]), z));
    },
    fit(points, pad = 60) {
      if (!points.length) return;
      const p = typeof pad === 'object' ? pad : { top: pad, bottom: pad, left: pad, right: pad };
      if (!roomFor(el, p)) return false;
      byApp = Date.now();
      map.fitBounds(L.latLngBounds(points.map(x => [x.lat, x.lon])), { paddingTopLeft: [p.left, p.top], paddingBottomRight: [p.right, p.bottom] });
      return true;
    },
    layer(name) {
      if (!layers.has(name)) layers.set(name, markerLayer());
      return layers.get(name);
    },
    lines(name, list) {
      for (const p of lineSets.get(name) || []) p.remove();
      lineSets.set(
        name,
        list.map(l => L.polyline(l.pts, { color: l.color, weight: l.width || 6, opacity: 0.95, dashArray: l.dash ? '2 10' : null, lineCap: 'round' }).addTo(map))
      );
    },
    showTransit() {},
    resize() {
      map.invalidateSize();
    }
  };
}
