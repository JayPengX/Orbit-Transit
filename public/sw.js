// Orbit Transit: the family's one service worker (Shared-Proxy/kit/sw.js),
// with this app's settings. It keeps the page's own files so the app opens
// without a connection and can be installed, and never keeps a file that
// isn't the one its address names (GitHub's CDN can answer a new address
// with the old file for a while after a deploy).
// Transit data lives in its own cache (orbit-transit-data), kept across versions.
self.ORBIT_SW = { cache: 'orbit-transit-v1', spare: ['orbit-transit-data'], title: 'Orbit Transit' };
importScripts('../Shared-Proxy/kit/sw.js');
