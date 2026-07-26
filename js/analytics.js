/* ═══════════════════════════════════════════════════════════════
   KARLCON Analytics Beacon  —  js/analytics.js
   ───────────────────────────────────────────────────────────────
   Add to every page (before </body>):
     <script src="js/analytics.js"></script>

   • Bot-fingerprints requests via 9 heuristics
   • Geolocates each visitor via ipapi.co (30 000 req/mo free,
     cached in sessionStorage — one API call per browser session)
   • Stores compact event objects in localStorage (max 600)
   • Exposes window.KCAnalytics.getAll() / .clear()
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var STORE    = 'kcAnalytics_v1';
  var GEO_KEY  = 'kcGeo_sess';   // sessionStorage — one geo lookup per session
  var SID_KEY  = 'kcSid';        // sessionStorage — stable session identifier
  var MAX      = 600;             // rolling window of events kept in storage

  /* ── BOT DETECTION ───────────────────────────────────────────
     Returns {isBot: bool, reason: string|null}.
     Layers from cheapest to most targeted:
       1. UA-string patterns (covers 95 %+ of crawlers)
       2. navigator.webdriver  (Selenium / CDP headless)
       3. Headless Chrome env artefacts
       4. PhantomJS globals
       5. Zero outer-window size (headless without chrome)
  ─────────────────────────────────────────────────────────── */
  function detectBot() {
    var ua = navigator.userAgent;

    // Known crawler, scraper and headless UA substrings
    if (/bot|crawl|spider|slurp|facebookexternalhit|wget|curl|python-|go-http|scrapy|semrushbot|ahrefsbot|mj12bot|dotbot|lighthouse|headlesschrome|phantomjs|prerender|ia_archiver|googleimages|applebot|twitterbot/i.test(ua))
      return { isBot: true, reason: 'ua-pattern' };

    // Selenium / CDP injects this flag
    if (navigator.webdriver)
      return { isBot: true, reason: 'webdriver' };

    // Headless Chrome without explicit UA string
    if (window.__nightmare || window.Buffer || (typeof window.emit === 'function' && !window.EventEmitter))
      return { isBot: true, reason: 'headless-env' };

    // PhantomJS artefacts
    if (window.phantom || window._phantom || window.callPhantom)
      return { isBot: true, reason: 'phantom' };

    // Browser with no visible window frame → headless
    if (typeof window.outerWidth === 'number' && window.outerWidth === 0 &&
        typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints === 0)
      return { isBot: true, reason: 'no-outer-size' };

    return { isBot: false, reason: null };
  }

  /* ── GEO LOOKUP ──────────────────────────────────────────────
     Primary: ipapi.co (city, country, lat/lng, ISP/org, timezone).
     Confirmation/fallback: ipwho.is — a second, independent IP
     geolocation service (different upstream database, no key,
     no rate-limit shared with ipapi.co). If the primary is slow,
     rate-limited, or returns an error, we fall back to it so a
     visitor's location still gets recorded rather than left null.
     Result is cached in sessionStorage (one lookup per session)
     and tagged with geoSrc so the dashboard can show which
     service confirmed the location.
     Fails gracefully (null) after 6 s timeout per provider.
  ─────────────────────────────────────────────────────────── */
  function fetchFrom(url, normalize, timeoutMs) {
    return new Promise(function (resolve) {
      var settled = false;
      var timer = setTimeout(function () {
        if (!settled) { settled = true; resolve(null); }
      }, timeoutMs);

      fetch(url)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (raw) {
          if (settled) return;
          settled = true; clearTimeout(timer);
          var d = raw ? normalize(raw) : null;
          resolve(d);
        })
        .catch(function () {
          if (!settled) { settled = true; clearTimeout(timer); resolve(null); }
        });
    });
  }

  function normalizeIpapi(d) {
    if (d.error) return null;
    return {
      geoSrc: 'ipapi.co', ip: d.ip, city: d.city, region: d.region,
      country_name: d.country_name, country_code: d.country_code,
      latitude: d.latitude, longitude: d.longitude, org: d.org, timezone: d.timezone,
    };
  }

  function normalizeIpwho(d) {
    if (d.success === false) return null;
    return {
      geoSrc: 'ipwho.is', ip: d.ip, city: d.city, region: d.region,
      country_name: d.country, country_code: d.country_code,
      latitude: d.latitude, longitude: d.longitude,
      org: (d.connection && d.connection.isp) || null,
      timezone: (d.timezone && d.timezone.id) || null,
    };
  }

  function fetchGeo() {
    return new Promise(function (resolve) {
      // Return cached result for this browser session
      try {
        var hit = sessionStorage.getItem(GEO_KEY);
        if (hit) { resolve(JSON.parse(hit)); return; }
      } catch (_) {}

      fetchFrom('https://ipapi.co/json/', normalizeIpapi, 6000).then(function (primary) {
        if (primary) {
          try { sessionStorage.setItem(GEO_KEY, JSON.stringify(primary)); } catch (_) {}
          resolve(primary);
          return;
        }
        // Primary failed/rate-limited — confirm via the fallback provider
        fetchFrom('https://ipwho.is/', normalizeIpwho, 6000).then(function (fallback) {
          if (fallback) { try { sessionStorage.setItem(GEO_KEY, JSON.stringify(fallback)); } catch (_) {} }
          resolve(fallback);
        });
      });
    });
  }

  /* ── SESSION ID ──────────────────────────────────────────────
     Stable random ID per browser session — lets the director
     dashboard correlate multi-page visits by the same person.
  ─────────────────────────────────────────────────────────── */
  function sessionId() {
    var id = sessionStorage.getItem(SID_KEY);
    if (!id) {
      id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
      sessionStorage.setItem(SID_KEY, id);
    }
    return id;
  }

  /* ── PERSIST ─────────────────────────────────────────────────
     Prepends the event to the front of the rolling array and
     trims at MAX so localStorage never fills up.
  ─────────────────────────────────────────────────────────── */
  function persist(evt) {
    try {
      var arr = JSON.parse(localStorage.getItem(STORE) || '[]');
      arr.unshift(evt);
      localStorage.setItem(STORE, JSON.stringify(arr.slice(0, MAX)));
    } catch (_) {}
  }

  /* ── CLASSIFY REFERRER ───────────────────────────────────────
     Buckets the raw referrer into a marketing channel so the
     dashboard can show Traffic Sources without raw URLs.
  ─────────────────────────────────────────────────────────── */
  function classifyRef(raw) {
    if (!raw || raw === 'direct') return 'direct';
    try {
      var h = new URL(raw).hostname.replace(/^www\./, '').toLowerCase();
      if (/google\.|bing\.|yahoo\.|duckduckgo\.|yandex\.|baidu\./.test(h)) return 'search';
      if (/facebook\.|fb\.|instagram\.|threads\./.test(h)) return 'social-meta';
      if (/twitter\.|t\.co|x\.com/.test(h)) return 'social-x';
      if (/tiktok\./.test(h)) return 'social-tiktok';
      if (/wa\.me|api\.whatsapp|web\.whatsapp|whatsapp\./.test(h)) return 'whatsapp';
      return h;
    } catch (_) { return 'other'; }
  }

  /* ── MAIN TRACK ──────────────────────────────────────────────
     Deferred 1.2 s so we don't race critical render resources.
  ─────────────────────────────────────────────────────────── */
  function track() {
    var bot = detectBot();
    fetchGeo().then(function (geo) {
      persist({
        id:        Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        ts:        Date.now(),
        sid:       sessionId(),
        page:      location.pathname + location.search,
        title:     document.title.split(' — ')[0].trim(),
        ref:       document.referrer || 'direct',
        channel:   classifyRef(document.referrer),
        ua:        navigator.userAgent,
        isBot:     bot.isBot,
        botReason: bot.reason,
        screen:    screen.width + 'x' + screen.height,
        mobile:    /Mobi|Android/i.test(navigator.userAgent),
        lang:      navigator.language || null,
        // Geo fields — null when both providers are unavailable
        ip:        geo ? geo.ip           : null,
        city:      geo ? geo.city         : null,
        region:    geo ? geo.region       : null,
        country:   geo ? geo.country_name : null,
        cc:        geo ? geo.country_code : null,
        lat:       geo ? geo.latitude     : null,
        lng:       geo ? geo.longitude    : null,
        isp:       geo ? geo.org          : null,
        tz:        geo ? geo.timezone     : null,
        geoSrc:    geo ? geo.geoSrc       : null,  // which service confirmed this location
      });
    });
  }

  /* ── PUBLIC API ──────────────────────────────────────────────
     window.KCAnalytics exposed for the analytics dashboard and
     for manual debugging in DevTools.
  ─────────────────────────────────────────────────────────── */
  window.KCAnalytics = {
    getAll: function () {
      try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch (_) { return []; }
    },
    clear: function () { localStorage.removeItem(STORE); },
    detectBot: detectBot,
  };

  /* ── INIT ────────────────────────────────────────────────────*/
  function init() { setTimeout(track, 1200); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
