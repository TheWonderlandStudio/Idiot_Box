/* Idiot Box — shared live stats (chatlog + download pages)
   Sources:
   - GitHub Releases API  → total downloads, updates, per-release totals
   - countapi (public)    → total installs (anonymous counter, +1 per install)
   - MQTT retained heartbeat (public broker) → online users + app version
   No cookies, no accounts, no personal data. */
(function () {
  'use strict';

  var REPO = 'TheWonderlandStudio/Idiot_Box';
  var GH = 'https://api.github.com/repos/' + REPO;
  var COUNTER_API = 'https://countapi.mileshilliard.com/api/v1';
  var COUNTER_KEY = 'idiotbox-total-installs-9f4c2';
  var HB_TOPIC = 'idiotbox9f4c2/hb/';        // prefix — app publishes idiotbox9f4c2/hb/<clientId>
  var HB_SUB = 'idiotbox9f4c2/hb/+';
  var BROKER = 'wss://broker.emqx.io:8084/mqtt';
  var HEARTBEAT_MS = 30000;                  // app side publish interval
  var ONLINE_TTL = 120000;                   // 4 missed heartbeats → offline
  var CACHE_MS = 10 * 60 * 1000;

  function cacheGet(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.t !== 'number' || Date.now() - parsed.t > CACHE_MS) return null;
      return parsed.v;
    } catch (e) { return null; }
  }
  function cacheSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v: value })); } catch (e) {}
  }

  function formatNum(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return Number(n).toLocaleString('en-US');
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function releaseDownloads(release) {
    if (!release || !Array.isArray(release.assets)) return 0;
    var sum = 0;
    release.assets.forEach(function (a) { sum += Number(a && a.download_count) || 0; });
    return sum;
  }

  // ── GitHub releases (cached — 60 req/hr unauthenticated limit) ─────────────
  function fetchReleases(perPage) {
    perPage = perPage || 100;
    var key = 'ibx-releases-' + perPage;
    var cached = cacheGet(key);
    if (cached) return Promise.resolve(cached);

    function page(n) {
      return fetch(GH + '/releases?per_page=' + perPage + '&page=' + n, {
        headers: { Accept: 'application/vnd.github+json' }
      }).then(function (res) {
        if (!res.ok) throw new Error('github ' + res.status);
        return res.json();
      });
    }

    return page(1).then(function (first) {
      if (!Array.isArray(first)) throw new Error('bad payload');
      if (first.length < perPage) return first;
      return page(2).then(function (second) {
        return first.concat(Array.isArray(second) ? second : []);
      });
    }).then(function (list) {
      cacheSet(key, list);
      return list;
    });
  }

  // totals: downloads = sum of every asset download_count, updates = release count
  function getTotals() {
    var key = 'ibx-totals';
    var cached = cacheGet(key);
    if (cached) return Promise.resolve(cached);
    return fetchReleases(100).then(function (releases) {
      var downloads = 0;
      releases.forEach(function (r) { downloads += releaseDownloads(r); });
      var totals = {
        downloads: downloads,
        updates: releases.length,
        latest: releases[0] || null
      };
      cacheSet(key, totals);
      return totals;
    });
  }

  // ── total installs — public counter (+1 per install, app side) ────────────
  function getTotalUsers() {
    var key = 'ibx-total-users';
    var cached = cacheGet(key);
    if (cached !== null) return Promise.resolve(cached);
    return fetch(COUNTER_API + '/get/' + COUNTER_KEY)
      .then(function (res) {
        if (res.status === 404) return 0;
        if (!res.ok) throw new Error('counter ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var value = data && typeof data.value === 'number' ? data.value : 0;
        cacheSet(key, value);
        return value;
      })
      .catch(function () { return null; });
  }

  // ── online users — retained MQTT heartbeat from the running app ───────────
  // retained messages = page kholte hi sabhi currently-online apps turant
  // mil jaate hain, chahe unka heartbeat page load se pehle aaya ho.
  function watchOnline(onUpdate) {
    var lib = window.mqtt;
    if (!lib || typeof lib.connect !== 'function') { onUpdate(null); return function () {}; }

    var seen = {}; // clientId -> { v: version, t: epoch ms }
    var client;
    try {
      client = lib.connect(BROKER, {
        connectTimeout: 10000,
        reconnectPeriod: 8000,
        keepalive: 60,
        clean: true
      });
    } catch (e) { onUpdate(null); return function () {}; }

    var connected = false;
    var stopped = false;

    function compute() {
      if (stopped) return;
      var now = Date.now();
      var versions = {};
      var online = 0;
      Object.keys(seen).forEach(function (id) {
        var entry = seen[id];
        if (!entry || typeof entry.t !== 'number') return;
        if (now - entry.t > ONLINE_TTL) return;      // TTL → offline
        if (entry.t > now + 60000) return;           // clock skew guard
        online++;
        var v = entry.v || '?';
        versions[v] = (versions[v] || 0) + 1;
        if (now - entry.t > 6 * 60 * 60 * 1000) delete seen[id]; // housekeeping
      });
      onUpdate({
        online: connected ? online : null,
        versions: Object.keys(versions)
          .sort(function (a, b) { return versions[b] - versions[a]; })
          .map(function (v) { return { version: v, count: versions[v] }; })
      });
    }

    client.on('connect', function () {
      connected = true;
      client.subscribe(HB_SUB, { qos: 0 }, function () {});
      compute();
    });
    client.on('message', function (topic, payload) {
      if (typeof topic !== 'string' || topic.indexOf(HB_TOPIC) !== 0) return;
      var id = topic.slice(HB_TOPIC.length);
      if (!id || id.length > 64) return;
      var text;
      try { text = payload.toString(); } catch (e) { return; }
      if (!text) return;                        // empty retained → app quit, drop
      var data;
      try { data = JSON.parse(text); } catch (e) { return; }
      if (!data || typeof data.t !== 'number') return;
      seen[id] = { v: typeof data.v === 'string' ? data.v.slice(0, 16) : '?', t: data.t };
      compute();
    });
    client.on('offline', function () { connected = false; compute(); });
    client.on('error', function () { /* silent — stats are best effort */ });

    var timer = setInterval(compute, 15000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) compute();
    });

    return function stop() {
      stopped = true;
      clearInterval(timer);
      try { client.end(true); } catch (e) {}
    };
  }

  // ── render into any container that has [data-stat] nodes ─────────────────
  function initStats(root) {
    root = root || document;
    function set(name, value) {
      var el = root.querySelector('[data-stat="' + name + '"]');
      if (el) el.textContent = value;
    }

    set('downloads', '…');
    set('updates', '…');
    set('users', '…');
    set('online', '…');

    getTotals().then(function (t) {
      set('downloads', formatNum(t.downloads));
      set('updates', formatNum(t.updates));
    }).catch(function () {
      set('downloads', '—');
      set('updates', '—');
    });

    getTotalUsers().then(function (n) {
      set('users', formatNum(n));
    });

    return watchOnline(function (state) {
      if (!state || state.online === null) { set('online', '—'); return; }
      set('online', formatNum(state.online));
      var box = root.querySelector('[data-stat="versions"]');
      if (!box) return;
      if (!state.versions.length) { box.hidden = true; box.innerHTML = ''; return; }
      box.hidden = false;
      box.innerHTML = state.versions.map(function (v) {
        return '<span class="ver-chip">v' + esc(v.version.replace(/^v/, '')) + ' · ' + v.count + '</span>';
      }).join('');
    });
  }

  window.IBXStats = {
    fetchReleases: fetchReleases,
    getTotals: getTotals,
    getTotalUsers: getTotalUsers,
    watchOnline: watchOnline,
    initStats: initStats,
    releaseDownloads: releaseDownloads,
    formatNum: formatNum,
    esc: esc
  };
})();
