// Quadra's loading screen and first update check, shared by every app (a
// classic script, loaded right after <div id="loading"> so it runs before
// the app's modules): the kit's copy, synced as public/boot.js. Never edit
// an app's copy.
//
// - Draws the loading screen into #loading (logo, the app's name from
//   data-title, a progress line and what it's doing), so every app opens
//   the same way.
// - Checks version.json while the app's files load: a newer deploy than
//   this page (meta build-version) is loaded straight away, its old cached
//   files dropped (data-cache, the service worker's cache prefix), before
//   anything starts. The kit's watchUpdates keeps the page current after.
// - When the app fails to start (an error: an installed app whose cached
//   page mixed an old version's files with a new one's), mends itself once
//   in ten minutes: its cached files dropped, the latest deploy loaded from
//   the network. Otherwise (or still failing, or 15 s) a way out: reload,
//   or open anyway. The app says it started with window.__fxStarted and
//   hides #loading itself (the kit does).
(function () {
  // A phone or a tablet (an iPad says Macintosh, with touch): the phone's
  // frame, set before the first paint (quadra.css .q-touch).
  var ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) document.documentElement.classList.add('q-touch');
  var box = document.getElementById('loading');
  if (!box) return;
  var zh = /^zh/i.test(document.documentElement.lang || navigator.language || '');
  var L = function (a, b) {
    return zh ? a : b;
  };
  var title = box.getAttribute('data-title') || document.title;
  var logo = box.getAttribute('data-logo') || './favicon.svg';
  box.className = 'loading q-boot';
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  box.innerHTML =
    '<div class="q-boot-box">' +
    '<img class="q-boot-logo" alt="" width="72" height="72">' +
    '<p class="q-boot-brand">QUADRA</p>' +
    '<p class="q-boot-title"></p>' +
    '<div class="q-boot-bar" aria-hidden="true"><i></i></div>' +
    '<p class="q-boot-step"></p>' +
    '<div class="q-boot-error" hidden><p class="q-boot-error-text"></p>' +
    '<div class="q-boot-actions"><button type="button" class="q-btn primary" data-act="reload"></button><button type="button" class="q-btn" data-act="skip"></button></div></div>' +
    '</div>';
  var q = function (sel) {
    return box.querySelector(sel);
  };
  q('.q-boot-logo').src = logo;
  q('.q-boot-title').textContent = title;
  q('[data-act=reload]').textContent = L('重新整理', 'Reload');
  q('[data-act=skip]').textContent = L('直接開啟', 'Open anyway');
  q('[data-act=reload]').onclick = function () {
    location.reload();
  };
  q('[data-act=skip]').onclick = function () {
    box.hidden = true;
  };

  // The progress line follows what has really loaded: the app's own files
  // (counted as they arrive, against how many it took last time on this
  // device), then the steps the app names (window.__bootStep('…', part)).
  // Hiding #loading ends it.
  var shown = 0.04;
  var bar = q('.q-boot-bar i');
  var step = q('.q-boot-step');
  var paint = function () {
    bar.style.transform = 'scaleX(' + shown.toFixed(3) + ')';
  };
  paint();
  step.textContent = L('載入中…', 'Loading…');
  var countKey = 'quadra.bootFiles:' + location.pathname;
  var expected = 0;
  try {
    expected = Number(localStorage.getItem(countKey)) || 0;
  } catch (e) {}
  var files = function () {
    if (!window.performance || !performance.getEntriesByType) return 0;
    return performance.getEntriesByType('resource').filter(function (r) {
      return r.name.indexOf(location.origin) === 0 && !/version\.json/.test(r.name);
    }).length;
  };
  var stepPart = 0;
  var tick = function () {
    var done = files();
    // Files make up the first 70%; without last time's count, each file
    // closes part of the gap that's left.
    var part = expected ? 0.7 * Math.min(1, done / expected) : 0.7 * (1 - Math.pow(0.88, done));
    var next = Math.max(part, stepPart);
    if (next > shown) {
      shown = Math.min(0.98, next);
      paint();
    }
  };
  var counted = false;
  var timer = setInterval(function () {
    if (box.hidden) return clearInterval(timer);
    // The app's modules have run: that many files is what it takes.
    if (!counted && started()) {
      counted = true;
      var n = files();
      expected = n;
      try {
        if (n > 2) localStorage.setItem(countKey, String(n));
      } catch (e) {}
    }
    tick();
  }, 100);
  window.__bootStep = function (text, part) {
    if (text) step.textContent = text;
    if (part > stepPart) {
      stepPart = part;
      tick();
    }
  };

  var started = function () {
    return Boolean(window.__fxStarted);
  };
  var cachePrefix = box.getAttribute('data-cache') || '';
  // The app's cached files dropped, then `then`.
  var dropCache = function (then) {
    if (!window.caches || !cachePrefix) return then();
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names
            .filter(function (n) {
              return n.indexOf(cachePrefix) === 0;
            })
            .map(function (n) {
              return caches.delete(n);
            })
        );
      })
      .then(then, then);
  };
  var healKey = 'quadra.bootHeal:' + location.pathname;
  var heal = function () {
    var last = 0;
    try {
      last = Number(localStorage.getItem(healKey)) || 0;
      if (Date.now() - last < 10 * 60000) return false;
      localStorage.setItem(healKey, String(Date.now()));
    } catch (e) {
      return false;
    }
    window.__bootUpdating = true;
    step.textContent = L('更新中…', 'Updating…');
    dropCache(function () {
      location.replace(location.pathname + '?v=' + Date.now() + location.hash);
    });
    return true;
  };
  var fail = function (message, broken) {
    if (box.hidden || !q('.q-boot-error').hidden || window.__bootUpdating) return;
    if (broken && heal()) return;
    q('.q-boot-error-text').textContent = message || L('頁面沒有正常啟動，可能是網路不穩。', "The page didn't start, maybe a network hiccup.");
    q('.q-boot-error').hidden = false;
    q('.q-boot-bar').hidden = true;
    step.hidden = true;
  };
  // The names the apps' scripts already call.
  var broke = function () {
    fail('', true);
  };
  window.__quadraFail = window.__fxFail = window.__oddsFail = window.__stockFail = broke;
  window.addEventListener('error', function () {
    if (!started()) broke();
  });
  setTimeout(function () {
    if (!started()) fail();
  }, 15000);

  // A newer deploy than this page: load it now, before the app starts.
  var meta = document.querySelector('meta[name="build-version"]');
  var current = meta && meta.content;
  if (!current || current === 'dev' || !window.fetch) return;
  var ctl = window.AbortController ? new AbortController() : null;
  setTimeout(function () {
    if (ctl) ctl.abort();
  }, 3000);
  fetch('./version.json?t=' + Date.now(), { cache: 'no-store', signal: ctl && ctl.signal })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (v) {
      var latest = v && v.version;
      if (!latest || latest === current) return;
      var flag = 'quadra.bootTo:' + location.pathname;
      if (sessionStorage.getItem(flag) === latest) return;
      sessionStorage.setItem(flag, latest);
      window.__bootUpdating = true;
      dropCache(function () {
        location.replace(location.pathname + '?v=' + encodeURIComponent(latest) + location.hash);
      });
    })
    .catch(function () {});
})();
