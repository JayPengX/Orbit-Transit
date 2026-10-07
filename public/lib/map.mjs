// The map: Google's (the most detail for Taiwan: every shop and place, and
// its transit lines) while the month is under the proxy's cap, else
// Taiwan's own NLSC map (內政部國土測繪中心, free) in Leaflet. One small
// interface over both: markers as HTML (bikes, stops, stations), lines (a
// plan's route), taps on the map and on Google's places.

import { TAIWAN_BOX } from './util.mjs';

const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
const NLSC = 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}';

// Google's map in the app's dark colours (the page is always dark).
export const DARK = [
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
  googleLoad ||= new Promise((resolve, reject) => {
    globalThis.__otMaps = resolve;
    script(`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&language=zh-TW&region=TW&loading=async&callback=__otMaps`).catch(reject);
    setTimeout(() => reject(new Error('maps timeout')), 15_000);
  });
  return googleLoad;
}
let leafletLoad = null;
function loadLeaflet() {
  if (globalThis.L?.map) return Promise.resolve();
  style(`${LEAFLET}leaflet.min.css`);
  leafletLoad ||= script(`${LEAFLET}leaflet.min.js`);
  return leafletLoad;
}

// Markers as HTML: set(items) keeps those with the same id (only their
// content changed), adds the new, drops the rest.
//   item: { id, lat, lon, html, cls, z, data }
function domItems(make) {
  const els = new Map();
  return {
    els,
    set(items) {
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

function googleMap(el, { center, zoom, onPick, onTap, onIdle, onPlace, onDrag }) {
  const g = globalThis.google.maps;
  const map = new g.Map(el, {
    center: { lat: center.lat, lng: center.lon },
    zoom,
    styles: DARK,
    backgroundColor: '#0a0b0f',
    disableDefaultUI: true,
    clickableIcons: true,
    gestureHandling: 'greedy',
    keyboardShortcuts: false,
    isFractionalZoomEnabled: false,
    // Taiwan only (what the app covers): never the world, never off the island's edges.
    restriction: { latLngBounds: { north: TAIWAN_BOX.n, south: TAIWAN_BOX.s, west: TAIWAN_BOX.w, east: TAIWAN_BOX.e }, strictBounds: false },
    minZoom: 7
  });
  const transit = new g.TransitLayer();
  transit.setMap(map);
  map.addListener('click', ev => {
    // A tap on one of Google's places: ours to show, not Google's bubble.
    if (ev.placeId) {
      ev.stop();
      return onPlace({ id: ev.placeId, lat: ev.latLng.lat(), lon: ev.latLng.lng() });
    }
    onTap({ lat: ev.latLng.lat(), lon: ev.latLng.lng() });
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
      this.items = domItems(it => this.make(it));
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
        update: x => {
          if (x.html !== rec.it.html) node.innerHTML = x.html;
          if (x.cls !== rec.it.cls) node.className = `ot-mk ${x.cls || ''}`;
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
  return {
    kind: 'google',
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
    setView(lat, lon, z) {
      byApp = Date.now();
      map.panTo({ lat, lng: lon });
      if (z) map.setZoom(z);
    },
    fit(points, pad = 60) {
      if (!points.length) return;
      byApp = Date.now();
      const b = new g.LatLngBounds();
      for (const p of points) b.extend({ lat: p.lat, lng: p.lon });
      map.fitBounds(b, typeof pad === 'object' ? pad : { top: pad, bottom: pad, left: pad, right: pad });
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

function leafletMap(el, { center, zoom, onPick, onTap, onIdle, onDrag }) {
  const L = globalThis.L;
  // (Taiwan only, as the Google map.)
  const map = L.map(el, { zoomControl: false, attributionControl: true, center: [center.lat, center.lon], zoom, maxZoom: 19, minZoom: 7, maxBounds: [[TAIWAN_BOX.s, TAIWAN_BOX.w], [TAIWAN_BOX.n, TAIWAN_BOX.e]], maxBoundsViscosity: 1 });
  map.attributionControl.setPrefix('');
  L.tileLayer(NLSC, { maxZoom: 19, maxNativeZoom: 19, attribution: '© 內政部國土測繪中心', className: 'ot-tiles' }).addTo(map);
  map.on('click', ev => onTap({ lat: ev.latlng.lat, lon: ev.latlng.lng }));
  map.on('moveend', () => onIdle());
  map.on('dragstart', () => onDrag());
  let byApp = 0;
  map.on('zoomstart', () => Date.now() - byApp > 1500 && onDrag());
  const layers = new Map();
  const lineSets = new Map();
  const markerLayer = () =>
    domItems(it => {
      const icon = x => L.divIcon({ className: `ot-mk ${x.cls || ''}`, html: x.html, iconSize: null });
      const m = L.marker([it.lat, it.lon], { icon: icon(it), zIndexOffset: (it.z || 1) * 100, keyboard: false }).addTo(map);
      const rec = {
        it,
        update: x => {
          if (x.html !== rec.it.html || x.cls !== rec.it.cls) m.setIcon(icon(x));
          if (x.lat !== rec.it.lat || x.lon !== rec.it.lon) m.setLatLng([x.lat, x.lon]);
          rec.it = x;
        },
        remove: () => m.remove()
      };
      m.on('click', ev => {
        L.DomEvent.stopPropagation(ev);
        onPick(rec.it);
      });
      return rec;
    });
  return {
    kind: 'nlsc',
    raw: map,
    center: () => ({ lat: map.getCenter().lat, lon: map.getCenter().lng }),
    zoom: () => map.getZoom(),
    bounds() {
      const b = map.getBounds();
      return { n: b.getNorth(), e: b.getEast(), s: b.getSouth(), w: b.getWest() };
    },
    setView(lat, lon, z) {
      byApp = Date.now();
      map.setView([lat, lon], z || map.getZoom());
    },
    fit(points, pad = 60) {
      if (!points.length) return;
      byApp = Date.now();
      const p = typeof pad === 'object' ? pad : { top: pad, bottom: pad, left: pad, right: pad };
      map.fitBounds(L.latLngBounds(points.map(x => [x.lat, x.lon])), { paddingTopLeft: [p.left, p.top], paddingBottomRight: [p.right, p.bottom] });
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
