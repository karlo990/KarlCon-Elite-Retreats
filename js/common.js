/* ═══════════════════════════════════════════════════════════
   KARLCON — shared chrome: nav scroll state, reveal, map init
   ═══════════════════════════════════════════════════════════ */

// Some scraped listings have junk in the price field (the scraper grabbed
// the full "About this space" description, an availability date, or an
// amenity name instead of a price). A real price always has a currency
// marker directly against a digit — "$180", "R1 200", "ZAR 1200" — so
// anything short that lacks that pattern (like "September 2026" or
// "Decor 5", both of which contain digits but aren't prices) is just as
// much junk as a long paragraph and should fall back too.
//
// Note: the currency marker must be preceded by the start of the string or
// a non-letter — otherwise a word that just happens to END in "r" right
// before a number (e.g. "Septembe-r 2026") would false-positive as "R 2026".
const PRICE_LOOKS_REAL_RE = /(^|[^a-z])(\$|r|zar|usd)\s?\d/i;

function cleanPriceLabel(raw, fallback){
  fallback = fallback || 'POA';
  if (!raw) return fallback;
  const s = String(raw).trim();
  if (!s) return fallback;
  if (/^(POA|price on request)$/i.test(s)) return s;
  if (s.length > 24) return fallback;
  if (s.split(/\s+/).length > 4) return fallback;
  if (!PRICE_LOOKS_REAL_RE.test(s)) return fallback;
  return s;
}

// Zimbabwe's real bounding box (with a little padding) — anything a scraper
// hands us outside this box is a bad coordinate (a mis-scraped lat/lng pair
// picked up from unrelated JSON on the source page — map bounds, some other
// preview, a default config — not the actual listing), and should never be
// plotted or used to steer the map's camera.
const ZIM_BOUNDS = { minLat: -23.0, maxLat: -15.0, minLng: 24.5, maxLng: 34.0 };
function isValidZimCoord(lat, lng){
  return typeof lat === 'number' && typeof lng === 'number' &&
    isFinite(lat) && isFinite(lng) &&
    lat >= ZIM_BOUNDS.minLat && lat <= ZIM_BOUNDS.maxLat &&
    lng >= ZIM_BOUNDS.minLng && lng <= ZIM_BOUNDS.maxLng;
}

// Smart pan — when a marker is clicked/tapped, nudge the map by the
// minimum amount needed to bring it (and the popup that's about to open
// above it) out from behind the floating UI chrome — the top overlay
// chips, the locate/route controls top-right, and the legend bottom-right.
// It's a "grid" of safe-zone margins rather than a fixed recenter: if the
// marker already has clear space, nothing moves at all. Works identically
// for mouse clicks on desktop and taps on mobile — Leaflet fires the same
// 'click' event for both — and margins shrink automatically on narrow
// viewports where the legend is hidden and controls stack tighter.
function marginsForViewport(map){
  const w = map.getSize().x;
  const mobile = w < 640;
  return mobile
    ? {top:130, right:70, bottom:40, left:20}
    : {top:150, right:190, bottom:90, left:40};
}

function smartPanToMarker(map, latlng, marginOverride){
  const margin = marginOverride || marginsForViewport(map);
  const size = map.getSize();
  const pt = map.latLngToContainerPoint(latlng);
  let dx = 0, dy = 0;
  if (pt.x < margin.left) dx = pt.x - margin.left;
  else if (pt.x > size.x - margin.right) dx = pt.x - (size.x - margin.right);
  if (pt.y < margin.top) dy = pt.y - margin.top;
  else if (pt.y > size.y - margin.bottom) dy = pt.y - (size.y - margin.bottom);
  if (!dx && !dy) return;
  const centerPt = map.project(map.getCenter(), map.getZoom()).add([dx, dy]);
  const target = map.unproject(centerPt, map.getZoom());
  map.panTo(target, {animate:true, duration:.5, easeLinearity:.25});
}

function mountFooter(){
  const y = new Date().getFullYear();
  document.querySelectorAll('[data-year]').forEach(el => el.textContent = y);
}

function initNavScroll(){
  const nav = document.querySelector('.nav');
  if (!nav) return;
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 24);
  window.addEventListener('scroll', onScroll, {passive:true});
  onScroll();
}

function initReveal(){
  const els = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)){ els.forEach(e=>e.classList.add('in')); return; }
  const io = new IntersectionObserver((entries)=>{
    entries.forEach(en => { if (en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); } });
  }, {threshold:.15});
  els.forEach(e=>io.observe(e));
}

// Satellite-raster world map (Esri World Imagery) — same tile-provider
// pattern as the K1RL Telematics fleet dashboard, reused here for a
// photoreal earth instead of a flat vector basemap.
function initSatelliteMap(elId, opts){
  opts = opts || {};
  const map = L.map(elId, {
    zoomControl:true, attributionControl:true, worldCopyJump:true,
    center: opts.center || [-19.0154, 29.1549], // Zimbabwe default
    zoom: opts.zoom || 5.4,
    scrollWheelZoom: opts.scrollWheelZoom !== undefined ? opts.scrollWheelZoom : true,
  });
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, USDA, USGS, AeroGRID, IGN'
  }).addTo(map);
  // subtle place-label overlay on top of the imagery for readability
  L.tileLayer('https://cartodb-basemaps-a.global.ssl.fastly.net/dark_nolabels/{z}/{x}/{y}.png', {
    maxZoom: 19, opacity: .0
  }).addTo(map);
  return map;
}

function greenDivIcon(){
  return L.divIcon({
    className: '', html: '<div class="pin-pulse"></div>',
    iconSize:[14,14], iconAnchor:[7,7]
  });
}

// Glassmorphic 3D "house bubble" marker — a frosted-glass pill with a
// gradient house-emoji medallion and a matching glass tail, anchored at
// its bottom tip so it sits above the actual coordinate rather than
// centered on it. Styles are injected once at runtime (see
// injectGlassPinStyles) so this marker never depends on css/style.css.
function priceDivIcon(label, opts){
  opts = opts || {};
  injectGlassPinStyles();
  const cls = opts.className ? ' ' + opts.className : '';
  const emoji = opts.emoji || '🏡';
  const delay = (opts.delay || 0) + 'ms';
  return L.divIcon({
    className: '',
    html: `
      <div class="kc-pin-wrap${cls}" style="animation-delay:${delay}">
        <div class="kc-pin-bubble">
          <span class="kc-pin-house">${emoji}</span>
          <span class="kc-pin-label">${label}</span>
        </div>
        <div class="kc-pin-tail"></div>
        <div class="kc-pin-ground"></div>
      </div>`,
    iconSize:[0,0], iconAnchor:[0,0]
  });
}

let _kcGlassPinStylesInjected = false;
function injectGlassPinStyles(){
  if (_kcGlassPinStylesInjected) return;
  _kcGlassPinStylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .kc-pin-wrap{
      position:relative;
      display:flex;
      flex-direction:column;
      align-items:center;
      transform:translate(-50%,-100%);
      transform-origin:bottom center;
      cursor:pointer;
      animation:kcPinPop .55s cubic-bezier(.34,1.56,.64,1) backwards;
      z-index:1;
    }
    .kc-pin-wrap:hover{ z-index:1000; }
    .kc-pin-bubble{
      position:relative;
      display:flex;
      align-items:center;
      gap:7px;
      padding:6px 13px 6px 6px;
      border-radius:20px;
      background:linear-gradient(155deg, rgba(255,255,255,.78), rgba(255,255,255,.32));
      backdrop-filter:blur(14px) saturate(180%);
      -webkit-backdrop-filter:blur(14px) saturate(180%);
      border:1px solid rgba(255,255,255,.65);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.95),
        inset 0 -8px 12px rgba(255,255,255,.18),
        0 10px 20px -4px rgba(14,122,76,.42),
        0 3px 8px rgba(6,40,26,.22);
      transition:transform .28s cubic-bezier(.2,.7,.3,1), box-shadow .28s ease;
    }
    .kc-pin-wrap:hover .kc-pin-bubble{
      transform:translateY(-6px) scale(1.07);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.95),
        inset 0 -8px 12px rgba(255,255,255,.18),
        0 20px 32px -6px rgba(14,122,76,.55),
        0 6px 14px rgba(6,40,26,.28);
    }
    .kc-pin-house{
      width:26px; height:26px; flex:0 0 auto;
      display:flex; align-items:center; justify-content:center;
      font-size:15px; line-height:1;
      border-radius:50%;
      background:linear-gradient(155deg,#12a869,#0b5c39 78%);
      box-shadow:
        inset 0 1px 1px rgba(255,255,255,.55),
        inset 0 -3px 5px rgba(0,0,0,.25),
        0 3px 6px rgba(0,0,0,.28);
    }
    .kc-pin-label{
      font-family:var(--sans, 'Inter', sans-serif);
      font-weight:700;
      font-size:12.5px;
      color:#0b3d26;
      letter-spacing:-.2px;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
      max-width:140px;
      text-shadow:0 1px 0 rgba(255,255,255,.5);
    }
    .kc-pin-tail{
      width:13px; height:13px;
      margin-top:-7px;
      background:linear-gradient(155deg, rgba(255,255,255,.6), rgba(255,255,255,.22));
      backdrop-filter:blur(14px);
      -webkit-backdrop-filter:blur(14px);
      border:1px solid rgba(255,255,255,.55);
      border-top:none; border-left:none;
      border-radius:0 0 5px 0;
      transform:rotate(45deg);
      transition:transform .28s cubic-bezier(.2,.7,.3,1);
    }
    .kc-pin-wrap:hover .kc-pin-tail{ transform:rotate(45deg) translateY(-4px); }
    .kc-pin-ground{
      width:30px; height:9px;
      margin-top:4px;
      border-radius:50%;
      background:radial-gradient(ellipse at center, rgba(20,168,104,.55) 0%, rgba(20,168,104,.22) 55%, rgba(20,168,104,0) 78%);
      filter:blur(1.5px);
      transform:scaleY(.55);
      transition:transform .28s cubic-bezier(.2,.7,.3,1), opacity .28s ease;
      pointer-events:none;
    }
    .kc-pin-wrap:hover .kc-pin-ground{
      transform:scaleY(.4) scaleX(.82);
      opacity:.55;
    }
    @keyframes kcPinPop{
      0%{ transform:translate(-50%,-100%) scale(0); opacity:0; }
      65%{ transform:translate(-50%,-100%) scale(1.14); opacity:1; }
      100%{ transform:translate(-50%,-100%) scale(1); }
    }
    @media (prefers-reduced-motion: reduce){
      .kc-pin-wrap{ animation:none; }
    }
    /* Cluster bubble — same glass/green language as the individual pins,
       shown by Leaflet.markercluster in place of overlapping markers when
       several retreats sit close together at the current zoom level. */
    .kc-cluster-bubble{
      width:40px; height:40px;
      display:flex; align-items:center; justify-content:center;
      border-radius:50%;
      background:linear-gradient(160deg, rgba(20,168,104,.92), rgba(14,122,76,.96));
      color:#fff;
      font-family:var(--sans, 'Inter', sans-serif);
      font-weight:700;
      font-size:14px;
      box-shadow:0 6px 18px rgba(14,122,76,.4), 0 0 0 4px rgba(255,255,255,.85);
      border:1.5px solid rgba(255,255,255,.6);
      cursor:pointer;
      transition:transform .18s ease;
    }
    .kc-cluster-bubble:hover{ transform:scale(1.08); }
  `;
  document.head.appendChild(style);
}

// Google-Maps-style pulsing blue dot for "you are here".
function userDivIcon(){
  return L.divIcon({
    className: '', html: '<div class="user-dot"><div class="user-dot-core"></div></div>',
    iconSize:[20,20], iconAnchor:[10,10]
  });
}

// Faded blue "neighbourhood" coverage circle around a retreat — not a
// precise service radius, just a soft visual cue for the surrounding area,
// matching the circular faded-blue treatment requested for the map.
function addAreaCircle(map, lat, lng, radiusMeters){
  return L.circle([lat, lng], {
    radius: radiusMeters || 2000,
    color:'#2F80ED', weight:1.4, opacity:.4, dashArray:'3 7',
    fillColor:'#2F80ED', fillOpacity:.10, interactive:false
  }).addTo(map);
}

function haversineKm(a, b){
  const toRad = d => d * Math.PI / 180;
  const R = 6371;
  const dLat = toRad(b[0]-a[0]), dLng = toRad(b[1]-a[1]);
  const la1 = toRad(a[0]), la2 = toRad(b[0]);
  const h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
}

// Device geolocation — drops/updates a "you are here" marker on the given
// map and hands the coordinates back for routing. Each map keeps its own
// marker reference so the overview map and a listing's mini-map don't clash.
function locateUser(map, onLocated, onError){
  if (!navigator.geolocation){
    onError && onError('Geolocation is not supported by this browser.');
    return;
  }
  navigator.geolocation.getCurrentPosition((pos) => {
    const latlng = [pos.coords.latitude, pos.coords.longitude];
    if (map._kcUserMarker) map.removeLayer(map._kcUserMarker);
    if (map._kcAccuracyCircle) map.removeLayer(map._kcAccuracyCircle);
    map._kcAccuracyCircle = L.circle(latlng, {
      radius: pos.coords.accuracy || 500, color:'#1A73E8', weight:1, opacity:.25,
      fillColor:'#1A73E8', fillOpacity:.07, interactive:false
    }).addTo(map);
    map._kcUserMarker = L.marker(latlng, {icon: userDivIcon(), zIndexOffset: 2000})
      .addTo(map).bindPopup('You are here');
    map._kcUserLatLng = latlng;
    onLocated && onLocated(latlng);
  }, (err) => {
    const msg = err && err.code === 1 ? 'Location permission denied.' : 'Could not get your location.';
    onError && onError(msg);
  }, {enableHighAccuracy:true, timeout:12000, maximumAge:60000});
}

// Draws a route from `from` to `to` on `map`. Prefers real road routing via
// Leaflet Routing Machine + the public OSRM demo router; falls back to a
// dashed as-the-crow-flies line (with a haversine distance) if the routing
// service is unavailable, so the feature still works offline/degraded.
function drawRoute(map, from, to, opts){
  opts = opts || {};
  clearRoute(map);

  function fallbackLine(){
    map._kcRouteLine = L.polyline([from, to], {color:'#0E7A4C', weight:4, dashArray:'2 10', opacity:.85}).addTo(map);
    map.fitBounds(map._kcRouteLine.getBounds(), {padding:[50,50]});
    const km = haversineKm(from, to).toFixed(1);
    opts.onSummary && opts.onSummary(`${km} km · straight line (no road route found)`);
  }

  if (typeof L.Routing !== 'undefined'){
    try{
      const control = L.Routing.control({
        waypoints:[L.latLng(from), L.latLng(to)],
        addWaypoints:false, draggableWaypoints:false, fitSelectedRoutes:true,
        show:false, createMarker:() => null,
        lineOptions:{styles:[{color:'#0E7A4C', weight:5, opacity:.88}]},
        router: L.Routing.osrmv1({serviceUrl:'https://router.project-osrm.org/route/v1'})
      }).addTo(map);
      control.on('routesfound', (e) => {
        const r = e.routes[0];
        const km = (r.summary.totalDistance/1000).toFixed(1);
        const mins = Math.round(r.summary.totalTime/60);
        opts.onSummary && opts.onSummary(`${km} km · ${mins} min drive`);
      });
      control.on('routingerror', () => { map.removeControl(control); map._kcRouteControl = null; fallbackLine(); });
      map._kcRouteControl = control;
      return;
    } catch(e){ fallbackLine(); return; }
  }
  fallbackLine();
}

function clearRoute(map){
  if (map._kcRouteControl){ map.removeControl(map._kcRouteControl); map._kcRouteControl = null; }
  if (map._kcRouteLine){ map.removeLayer(map._kcRouteLine); map._kcRouteLine = null; }
}

/* ── BACKGROUND MUSIC — activity-adaptive volume ducking ───────
   Browsers block audio autoplay outright until the visitor has
   interacted with the page — so this arms itself on load, then
   starts playback on the FIRST scroll, click, or touch anywhere
   on the page (whichever happens first), which satisfies every
   major browser's autoplay policy. A small floating toggle lets
   the visitor mute/unmute, remembered via localStorage across
   pages.

   On top of that, the track is routed through a Web Audio
   GainNode (not the stepped `audio.volume` property, which
   produces an audible "zipper" artifact when changed) so volume
   can be ramped smoothly. That gain is driven by how active the
   visitor currently is on the page:

     - No mouse/scroll/key/touch input for a few seconds usually
       means they've stopped skimming and started actually
       reading a description or weighing a decision. The
       systematic review by Cheah, Wong, Spitzer & Coutinho
       (2022, "Background Music and Cognitive Task Performance")
       and a 2025 Cognitive Research: Principles & Implications
       study on sonic salience both found busier/louder background
       audio measurably interferes with memory- and language-heavy
       tasks, while barely affecting quick glance-and-scan actions.
       That maps onto Sweller's Cognitive Load Theory — competing
       sensory input costs the most exactly when working memory is
       already occupied by a decision. So: idle → duck.
     - Any renewed activity (scrolling on, clicking a photo,
       typing in search) means they're back to browsing/scanning,
       where a fuller mix doesn't cost them anything, so volume
       recovers.

   The ramp shapes borrow from standard broadcast/game-audio
   ducking practice: a slower, gentler *release* down into the
   duck (so the drop doesn't itself become a distracting cue) and
   a snappier *attack* back up to full presence the instant they
   re-engage, so the music still feels alive rather than just quiet.

   ── CROSS-PAGE CONTINUATION ──────────────────────────────────
   This is a multi-page site, so every internal link is a full
   document reload that destroys and rebuilds the <audio> element.
   Two things make that feel like one continuous track instead of
   a restart-or-silence on every click:

     1. An immediate, unrequested play() attempt fires as soon as
        a later page's script runs, before any listener is even
        attached. This isn't reckless — Chrome's autoplay policy
        explicitly allows unmuted autoplay once a site crosses the
        user's Media Engagement Index (a rolling per-origin score
        of past >7s unmuted plays), and separately treats a
        same-tab navigation driven by a click as carrying that
        click's activation over to the destination document
        (developer.chrome.com/blog/autoplay). So on a returning
        page within the same visit, play() typically just
        succeeds outright. If a browser (Safari, or Chrome before
        MEI is earned) still blocks it, the promise rejects
        silently and the existing scroll/click/touch/keydown
        listeners below catch it the normal way — no behavior
        regresses, this only adds a faster path.
     2. The exact playback position is carried forward in
        sessionStorage (not just an "it was playing" flag) and
        re-applied before the new page's element starts, so the
        track picks up where it left off rather than looping back
        to 0:00. This matters beyond polish: a 2025 meta-analysis
        of the Zeigarnik/Ovsiankina literature (Kuhbandner et al.,
        Humanities & Social Sciences Communications) found the
        original Zeigarnik memory-advantage doesn't reliably
        replicate, but confirmed a robust, general tendency for
        people to want to *resume* an interrupted activity from
        where it stopped, not restart it — true resumption, not
        just "something is playing again," is what reads as
        uninterrupted to a visitor.

   Usage: call initBackgroundMusic('assets/audio/theme.mp3') once,
   from a page's own script (after common.js loads).
─────────────────────────────────────────────────────────────── */
function initBackgroundMusic(src, opts){
  opts = opts || {};
  const MUTE_KEY = 'kcMusicMuted';
  // This is a multi-page site — every internal link click is a full page
  // reload, which destroys and rebuilds the <audio> element from scratch.
  // These two sessionStorage keys are what make the music feel continuous
  // across that reload instead of restarting (or falling silent) on every
  // new page: STARTED_KEY says "music was already playing this visit, don't
  // wait for another gesture", TIME_KEY says "and here's exactly where it
  // was", so the new page's <audio> element can pick up mid-track.
  const STARTED_KEY = 'kcMusicStarted';
  const TIME_KEY    = 'kcMusicTime';
  const BASE_VOLUME      = opts.volume         != null ? opts.volume         : 0.35;
  const DUCK_LEVEL        = opts.duckLevel       != null ? opts.duckLevel       : 0.45; // fraction of base while "thinking"
  const IDLE_MS           = opts.idleMs          != null ? opts.idleMs          : 3800; // no input this long = treat as idle
  const DUCK_RAMP_SEC     = opts.duckRampSec     != null ? opts.duckRampSec     : 1.6;   // slow, unobtrusive release down
  const RESTORE_RAMP_SEC  = opts.restoreRampSec  != null ? opts.restoreRampSec  : 0.35;  // quick, alive attack back up
  const CHECK_MS = 500; // idle-poll cadence — cheap, and plenty responsive for a music cue

  const audio = document.createElement('audio');
  audio.src = src;
  audio.loop = true;
  audio.preload = 'auto';
  audio.crossOrigin = 'anonymous';
  audio.setAttribute('playsinline', ''); // iOS Safari
  document.body.appendChild(audio);

  const wasStarted = sessionStorage.getItem(STARTED_KEY) === '1';
  const savedTime = parseFloat(sessionStorage.getItem(TIME_KEY) || '0') || 0;

  const userMuted = localStorage.getItem(MUTE_KEY) === '1';
  let muted = userMuted;
  let ducked = false;

  // --- Web Audio graph -----------------------------------------------
  // Routing the element through a GainNode makes every future volume
  // change (mute, duck, restore) a smooth ramp instead of a hard jump.
  // Once connected this way the <audio> element's own .volume/.muted
  // stop mattering — gainNode.gain becomes the single source of truth —
  // so the graph is built lazily on the visitor's first real gesture
  // (AudioContext also starts "suspended" until then in every major
  // browser, same root cause as the autoplay block itself).
  let ctx = null, gainNode = null;
  function ensureGraph(){
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return; // ancient browser: silently fall back to plain audio.volume below
    try{
      ctx = new AC();
      const source = ctx.createMediaElementSource(audio);
      gainNode = ctx.createGain();
      gainNode.gain.value = muted ? 0 : BASE_VOLUME;
      source.connect(gainNode).connect(ctx.destination);
    } catch(e){
      ctx = null; gainNode = null; // e.g. a second element already piped through this element
    }
  }

  function targetGain(){
    if (muted) return 0;
    return ducked ? BASE_VOLUME * DUCK_LEVEL : BASE_VOLUME;
  }

  function rampTo(rampSec){
    if (gainNode && ctx){
      const now = ctx.currentTime;
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      gainNode.gain.linearRampToValueAtTime(targetGain(), now + rampSec);
    } else {
      // No Web Audio available — still respect mute/duck, just without the smooth ramp.
      audio.volume = targetGain();
    }
  }

  // Floating toggle — same glass/green language as the rest of the chrome.
  const btn = document.createElement('button');
  btn.className = 'kc-music-toggle';
  btn.setAttribute('aria-label', userMuted ? 'Unmute background music' : 'Mute background music');
  btn.innerHTML = musicIconSVG(!userMuted);
  btn.classList.toggle('is-muted', userMuted);
  document.body.appendChild(btn);
  injectMusicToggleStyles();

  // Re-apply the position carried over from the previous page. currentTime
  // can only be set once metadata is loaded, and with preload="auto" that's
  // usually already true by the time this runs — but fall back to waiting
  // for it rather than silently dropping the seek on a slow connection.
  function applySavedTime(){
    if (!wasStarted || savedTime <= 0) return;
    const seek = () => { try { audio.currentTime = savedTime; } catch(e){} };
    if (audio.readyState >= 1) seek();
    else audio.addEventListener('loadedmetadata', seek, { once: true });
  }

  let started = false;
  function startPlayback(){
    if (started) return;
    started = true;
    ensureGraph();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    audio.volume = 1; // real volume now lives in gainNode; keep the element itself at unity
    applySavedTime();
    audio.play().catch(() => {
      // Blocked (or, on the unrequested attempt below, simply not yet
      // earned autoplay rights) — fail quietly. The gesture listeners
      // registered right after this are still armed and will retry
      // startPlayback on the visitor's next scroll/click/touch/key.
      started = false;
    });
  }

  // The instant this page's script runs, mark the element as "actually
  // playing" so the position-saving interval below has something to save
  // even if the visitor never touches the mute button — and so a same-tab
  // link click straight to yet another page still has a fresh flag/time
  // to hand off.
  audio.addEventListener('playing', () => {
    sessionStorage.setItem(STARTED_KEY, '1');
  });

  // Fires on the very first scroll, click, or touch — passive + once so it
  // costs nothing and cleans itself up immediately after firing.
  ['scroll', 'click', 'touchstart', 'keydown'].forEach(evt => {
    window.addEventListener(evt, startPlayback, { passive: true, once: true });
  });

  // Cross-page continuation: on any page after the first, jump straight to
  // startPlayback() without waiting for a gesture at all. See the "CROSS-PAGE
  // CONTINUATION" note in the header comment for why this is allowed to
  // succeed outright on most returning visits, and why it's safe to just try
  // — a rejection here quietly falls back to the listeners above.
  if (wasStarted) startPlayback();

  btn.addEventListener('click', () => {
    if (!started) startPlayback();
    muted = !muted;
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    btn.innerHTML = musicIconSVG(!muted);
    btn.setAttribute('aria-label', muted ? 'Unmute background music' : 'Mute background music');
    btn.classList.toggle('is-muted', muted);
    rampTo(RESTORE_RAMP_SEC * 0.6); // the mute toggle itself should feel immediate, not laggy
  });

  // --- Activity tracking -----------------------------------------------
  // Cheap by design: listeners just stamp a timestamp, no per-event work.
  // A single lightweight interval decides whether to duck or restore.
  let lastActivity = Date.now();
  function markActive(){
    lastActivity = Date.now();
    if (ducked){
      ducked = false;
      rampTo(RESTORE_RAMP_SEC);
    }
  }
  ['mousemove', 'scroll', 'wheel', 'keydown', 'touchstart', 'touchmove', 'click']
    .forEach(evt => window.addEventListener(evt, markActive, { passive: true }));

  setInterval(() => {
    // Keep TIME_KEY current regardless of mute state — the track keeps
    // advancing even when muted, and a mid-track nav should still resume
    // from the right spot rather than snapping back to the last unmuted
    // moment.
    if (started) sessionStorage.setItem(TIME_KEY, String(audio.currentTime));
    if (!started || muted) return;
    const idleFor = Date.now() - lastActivity;
    if (idleFor >= IDLE_MS && !ducked){
      ducked = true;
      rampTo(DUCK_RAMP_SEC);
    }
  }, CHECK_MS);

  // Belt-and-suspenders flush for the moment of navigation itself, in case
  // it lands between two 500ms polls — pagehide is the reliable one for a
  // real unload (unlike beforeunload, it still fires when the page is
  // going into the back/forward cache), visibilitychange catches the rest.
  function flushTime(){
    if (!started) return;
    sessionStorage.setItem(TIME_KEY, String(audio.currentTime));
    sessionStorage.setItem(STARTED_KEY, '1');
  }
  window.addEventListener('pagehide', flushTime);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushTime();
  });

  return { audio, toggleButton: btn };
}

// Blurred-backdrop "Talk to Karl" WhatsApp nudge — appears once per browser
// session, exactly 90 seconds (1.5 min) after the page loads, so it only
// interrupts someone who's actually spent real time browsing, never on
// first paint. sessionStorage keeps it from firing again on every page
// nav within the same visit (index.html -> listing.html -> back, etc.).

function musicIconSVG(playing){
  return playing
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 18V6l10-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 18V6l10-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/><line x1="3" y1="3" x2="21" y2="21"/></svg>';
}

let _kcMusicStylesInjected = false;
function injectMusicToggleStyles(){
  if (_kcMusicStylesInjected) return;
  _kcMusicStylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .kc-music-toggle{
      position:fixed; left:18px; bottom:18px; z-index:900;
      width:42px; height:42px; border-radius:50%;
      display:flex; align-items:center; justify-content:center;
      background:rgba(255,255,255,.92); backdrop-filter:blur(8px);
      border:1px solid rgba(14,122,76,.25);
      color:#0E7A4C; cursor:pointer;
      box-shadow:0 6px 18px rgba(0,0,0,.14);
      transition:transform .18s ease, background .18s ease, color .18s ease;
    }
    .kc-music-toggle:hover{ transform:scale(1.08); }
    .kc-music-toggle.is-muted{ color:#9AA0A6; }
    @media (max-width:640px){
      .kc-music-toggle{ left:14px; bottom:14px; width:38px; height:38px; }
    }
  `;
  document.head.appendChild(style);
}

function initWhatsAppPopup(){
  const SHOWN_KEY = 'kcWhatsappPopupShown';
  const DELAY_MS = 90 * 1000; // exactly 1.5 minutes
  const REDIRECT_MS = 10 * 1000; // auto-redirect after 10s if untouched
  const PHONE = '263780563561';
  const WA_URL = `https://wa.me/${PHONE}`;

  if (sessionStorage.getItem(SHOWN_KEY)) return;

  function build(){
    const overlay = document.createElement('div');
    overlay.className = 'kc-wa-overlay';
    overlay.innerHTML = `
      <div class="kc-wa-card" role="dialog" aria-modal="true" aria-labelledby="kc-wa-title">
        <button class="kc-wa-close" aria-label="Close">&times;</button>
        <div class="kc-wa-icon-wrap">
          <div class="kc-wa-icon-ring"></div>
          <div class="kc-wa-icon-ring d2"></div>
          <div class="kc-wa-icon">💬</div>
        </div>
        <div class="kc-wa-title" id="kc-wa-title">Still deciding?</div>
        <p class="kc-wa-body">Talk to Karl on WhatsApp for quick checkouts — real-time availability, fast answers, no forms.</p>
        <a class="kc-wa-cta" href="${WA_URL}" target="_blank" rel="noopener">
          💬 Talk to Karl on WhatsApp
        </a>
        <div class="kc-wa-progress-track"><div class="kc-wa-progress-fill"></div></div>
        <div class="kc-wa-progress-label">Opening WhatsApp automatically in <b id="kc-wa-count">10</b>s…</div>
      </div>`;
    document.body.appendChild(overlay);

    requestAnimationFrame(() => overlay.classList.add('in'));

    const fill = overlay.querySelector('.kc-wa-progress-fill');
    const countEl = overlay.querySelector('#kc-wa-count');
    let redirectTimer, tickTimer, secondsLeft = 10;

    function startCountdown(){
      requestAnimationFrame(() => { fill.style.transitionDuration = REDIRECT_MS + 'ms'; fill.style.width = '100%'; });
      tickTimer = setInterval(() => {
        secondsLeft -= 1;
        if (countEl) countEl.textContent = Math.max(secondsLeft, 0);
        if (secondsLeft <= 3) fill.classList.add('urgent');
        if (secondsLeft <= 0) clearInterval(tickTimer);
      }, 1000);
      redirectTimer = setTimeout(() => {
        sessionStorage.setItem(SHOWN_KEY, '1');
        window.location.href = WA_URL;
      }, REDIRECT_MS);
    }

    function stopCountdown(){
      clearTimeout(redirectTimer);
      clearInterval(tickTimer);
    }

    function close(){
      stopCountdown();
      overlay.classList.remove('in');
      setTimeout(() => overlay.remove(), 280);
      sessionStorage.setItem(SHOWN_KEY, '1');
    }
    overlay.querySelector('.kc-wa-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function onEsc(e){
      if (e.key === 'Escape'){ close(); document.removeEventListener('keydown', onEsc); }
    });
    overlay.querySelector('.kc-wa-cta').addEventListener('click', () => {
      stopCountdown();
      sessionStorage.setItem(SHOWN_KEY, '1');
    });

    startCountdown();
  }

  setTimeout(build, DELAY_MS);
}

document.addEventListener('DOMContentLoaded', () => {
  initNavScroll();
  initReveal();
  mountFooter();
  initWhatsAppPopup();
});
