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

// Pulls the first plain number out of a scraped price string ("$70" -> 70,
// "R1 200" -> 1200). Returns null (not 0) when nothing usable is found, so
// callers can fall back to a sane default rather than silently charging $0.
function parsePriceNumber(raw){
  if (raw == null) return null;
  const s = String(raw).replace(/[, ]/g, '');
  const m = s.match(/(\d+(\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
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

// ── Reverse geocoding for copy/paste into InDrive, WhatsApp, etc ──────────
// Turns a raw lat/lng into a short human place name ("Borrowdale, Harare")
// instead of a bare coordinate pair, so it can be pasted directly into a
// ride app's pickup/drop-off search box. Uses OSM Nominatim (free, no key).
// Results are cached per-session since the same pickup/listing coordinate
// gets asked for repeatedly as drivers move.
const _kcGeocodeCache = new Map();

async function reverseGeocodeShortName(lat, lng){
  const key = lat.toFixed(4) + ',' + lng.toFixed(4);
  if (_kcGeocodeCache.has(key)) return _kcGeocodeCache.get(key);

  try{
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    if (!res.ok) throw new Error('reverse geocode failed: ' + res.status);
    const data = await res.json();
    const a = data.address || {};
    // Prefer a suburb/neighbourhood + city pairing — short enough to paste
    // into an app's search box, specific enough to actually find the spot.
    const primary = a.suburb || a.neighbourhood || a.village || a.town || a.city_district || a.road;
    const secondary = a.city || a.town || a.county;
    let short;
    if (primary && secondary && primary !== secondary) short = `${primary}, ${secondary}`;
    else short = primary || secondary || data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

    _kcGeocodeCache.set(key, short);
    return short;
  } catch (err){
    console.info('[reverse-geocode] falling back to coordinates:', err.message);
    const fallback = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    _kcGeocodeCache.set(key, fallback);
    return fallback;
  }
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
// Draws a route from `from` to `to` on `map`. Prefers real road routing via
// Leaflet Routing Machine + the public OSRM demo router; falls back to a
// dashed as-the-crow-flies line (with a haversine distance) if the routing
// service is unavailable, so the feature still works offline/degraded.
//
// Always exposes the actual drawn line as map._kcRouteLine (a plain
// L.polyline, whether the geometry came from OSRM or the fallback) so
// callers can reliably grab its DOM element — e.g. for a draw-in animation
// — instead of reaching into Leaflet Routing Machine's internal line layer,
// which isn't a stable public API.
function drawRoute(map, from, to, opts){
  opts = opts || {};
  clearRoute(map);

  function fallbackLine(){
    map._kcRouteLine = L.polyline([from, to], {color:'#0E7A4C', weight:4, dashArray:'2 10', opacity:.85}).addTo(map);
    map.fitBounds(map._kcRouteLine.getBounds(), {padding:[50,50]});
    const km = haversineKm(from, to).toFixed(1);
    opts.onSummary && opts.onSummary(`${km} km · straight line (no road route found)`);
    opts.onRouteReady && opts.onRouteReady(map._kcRouteLine);
  }

  if (typeof L.Routing !== 'undefined'){
    try{
      // show:false + a styles array of zero-opacity hides Routing Machine's
      // own line so it doesn't double up with the polyline we draw below
      // from the same route's coordinates — one line, one we fully control.
      const control = L.Routing.control({
        waypoints:[L.latLng(from), L.latLng(to)],
        addWaypoints:false, draggableWaypoints:false, fitSelectedRoutes:true,
        show:false, createMarker:() => null,
        lineOptions:{styles:[{opacity:0, weight:0}]},
        router: L.Routing.osrmv1({serviceUrl:'https://router.project-osrm.org/route/v1'})
      }).addTo(map);
      control.on('routesfound', (e) => {
        const r = e.routes[0];
        const km = (r.summary.totalDistance/1000).toFixed(1);
        const mins = Math.round(r.summary.totalTime/60);
        opts.onSummary && opts.onSummary(`${km} km · ${mins} min drive`);

        // Draw our own visible polyline from the route's actual road
        // geometry (r.coordinates is the full turn-by-turn path, not just
        // the two endpoints) so it looks like real road routing rather
        // than a straight line, while still being a plain polyline we can
        // animate reliably.
        if (map._kcRouteLine) map.removeLayer(map._kcRouteLine);
        map._kcRouteLine = L.polyline(r.coordinates, {color:'#0E7A4C', weight:5, opacity:.88}).addTo(map);
        opts.onRouteReady && opts.onRouteReady(map._kcRouteLine);
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

/* ── LIVE RIDE — driver cars on the map + booking panel ─────────
   Connects to a small WebSocket dispatch server (see dispatch_server.py)
   that streams a table of { driver_id: {lat,lng,heading,...} }. Each
   driver gets a rotated car marker that glides between GPS pings instead
   of jumping. Works two ways, chosen by what you pass in:

     - opts.dest = {lat,lng,title,price}   -> "listing" mode: every car
       shows its ETA/fare to THIS one destination. `price` is the listing's
       own raw nightly price string (e.g. "$70") and is used as the
       booking fee, per-listing — not the ride fare itself. Used on
       listing.html, where there's one obvious place a guest wants a ride to.

     - opts.listings = LISTINGS array -> "fleet" mode: no single
       destination, so each car's ETA/price is shown to whichever listing
       is nearest to it. Used on index.html's globe map, where showing a
       live fleet roaming the whole country is the point, not booking to
       one address yet.

   Set window.KARLCON_RIDE_WS_URL before calling initLiveRide, or pass
   opts.wsUrl directly — this is the one placeholder you need to fill in
   once dispatch_server.py is deployed somewhere with a wss:// URL.

   Usage:
     initLiveRide(map, { dest: {lat:l.lat, lng:l.lng, title:l.title},
                          panelMount: document.querySelector('.side-card'),
                          whatsappNumber: '263780563561' });
─────────────────────────────────────────────────────────────── */

const KC_RIDE_TIER_COLOR = { near: '#0E7A4C', mid: '#D97706', far: '#8A8578' };
const KC_RIDE_AVG_SPEED_KMH = 28;

// Flat-rate pricing: the ride FARE is intentionally NOT a function of
// distance — only the ETA/arrival clock moves as cars get closer or
// farther. The BOOKING FEE is per-listing: it mirrors that listing's own
// nightly price (see rideFareBreakdown), so KC_RIDE_BOOKING_FEE_FALLBACK is
// only used if a listing's price couldn't be parsed to a number at all.
const KC_RIDE_FLAT_FARE = 3.50;
const KC_RIDE_BOOKING_FEE_FALLBACK = 0.39;

let _kcCarStylesInjected = false;
function injectCarMarkerStyles(){
  if (_kcCarStylesInjected) return;
  _kcCarStylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .kc-car-icon{ background:none; border:none; }
    .kc-car-wrap{ position:relative; width:34px; height:34px; }
    .kc-car-pulse{
      position:absolute; inset:0; border-radius:50%; opacity:.35;
      animation:kcCarPulse 1.8s ease-out infinite;
    }
    @keyframes kcCarPulse{
      0%   { transform:scale(.6); opacity:.4; }
      70%  { transform:scale(1.6); opacity:0; }
      100% { transform:scale(1.6); opacity:0; }
    }
    @media (prefers-reduced-motion: reduce){ .kc-car-pulse{ animation:none; opacity:.18; } }

    .kc-ride-panel{
      display:flex; flex-direction:column; gap:11px;
      margin-top:12px; padding:14px 15px; background:rgba(14,122,76,.06);
      border:1px solid rgba(14,122,76,.18); border-radius:14px;
      font-family:var(--sans, inherit);
    }
    .kc-ride-top{ display:flex; align-items:center; gap:10px; }
    .kc-ride-avatar{
      width:38px; height:38px; border-radius:50%; flex:0 0 auto;
      display:flex; align-items:center; justify-content:center;
      background:linear-gradient(160deg, rgba(20,168,104,.95), rgba(14,122,76,1));
      box-shadow:0 4px 10px rgba(14,122,76,.35);
    }
    .kc-ride-avatar svg{ width:19px; height:19px; }
    .kc-ride-name{ margin:0; font-size:13.5px; font-weight:700; color:var(--txt1,#151512); }
    .kc-ride-sub{ margin:1px 0 0; font-size:11.5px; color:var(--txt2,#6b6558); }
    .kc-ride-nearest-tag{
      margin-left:auto; font-size:10px; font-weight:700; letter-spacing:.04em; text-transform:uppercase;
      color:#0E7A4C; background:rgba(14,122,76,.12); border-radius:99px; padding:4px 9px;
    }
    .kc-ride-stats{ display:flex; gap:8px; }
    .kc-ride-pill{
      flex:1; text-align:center; padding:8px 4px; border-radius:10px;
      background:rgba(255,255,255,.7); border:1px solid rgba(14,122,76,.14);
    }
    .kc-ride-pill b{ display:block; font-size:14px; color:var(--txt1,#151512); line-height:1.3; }
    .kc-ride-pill span{ font-size:9.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--txt3,#9a958a); }

    /* Fare breakdown — fare + booking fee are shown as distinct line items
       that sum to a subtotal, never blended into a single "Fare" figure. */
    .kc-ride-breakdown{
      display:flex; flex-direction:column; gap:5px; margin:2px 0 2px;
      padding:9px 11px; border-radius:10px;
      background:rgba(255,255,255,.7); border:1px solid rgba(14,122,76,.14);
    }
    .kc-ride-bd-row{ display:flex; justify-content:space-between; font-size:12px; color:var(--txt2,#6b6558); }
    .kc-ride-bd-row b{ color:var(--txt1,#151512); font-weight:600; }
    .kc-ride-bd-row.kc-ride-bd-total{
      border-top:1px solid rgba(14,122,76,.14); padding-top:5px; margin-top:1px;
      font-size:12.5px; color:var(--txt1,#151512); font-weight:700;
    }
    .kc-ride-locline{
      font-size:11px; color:var(--txt3,#9a958a); line-height:1.5; margin:0 0 8px;
      overflow-wrap:anywhere;
    }
    .kc-ride-book{
      border:none; border-radius:10px; padding:11px; font-weight:700;
      font-size:13px; background:#25D366; color:#fff; cursor:pointer; transition:opacity .2s;
      display:flex; align-items:center; justify-content:center; gap:7px;
    }
    .kc-ride-book:disabled, .kc-ride-book[data-disabled="1"]{ opacity:.5; pointer-events:none; }
    .kc-ride-empty{ font-size:12.5px; color:var(--txt3,#9a958a); font-family:var(--sans, inherit); margin-top:10px; }

    /* Ring drawn around whichever car is currently priced in the panel —
       auto-follows the nearest driver so there's always an obvious answer
       to "which car is that quote for" on a map with a dozen cars on it. */
    .kc-car-wrap.kc-car-selected::after{
      content:''; position:absolute; inset:-7px; border-radius:50%;
      border:2px solid #fff; box-shadow:0 0 0 2.5px rgba(14,122,76,.6), 0 0 16px rgba(14,122,76,.55);
      pointer-events:none;
    }
  `;
  document.head.appendChild(style);
}

// Top-down car silhouettes, one profile per vehicle_type so the fleet
// doesn't look like identical clones. Half-width/half-length pairs, in the
// same 34x34 marker box the old icon used.
const KC_CAR_SHAPES = {
  sedan: { bodyW: 11,   bodyL: 25,   roofW: 8,    roofL: 12.5, roofY: -0.5 },
  suv:   { bodyW: 12.5, bodyL: 23,   roofW: 9.5,  roofL: 14,   roofY: 0.5  },
  hatch: { bodyW: 11,   bodyL: 20,   roofW: 8.5,  roofL: 10.5, roofY: 1.5  },
};
let _kcCarIconSeq = 0;

function carDivIcon(heading, tier, vehicleType){
  injectCarMarkerStyles();
  const color = KC_RIDE_TIER_COLOR[tier] || KC_RIDE_TIER_COLOR.mid;
  const shape = KC_CAR_SHAPES[vehicleType] || KC_CAR_SHAPES.sedan;
  // Unique gradient IDs per marker — url(#id) resolves against the whole
  // document, so reusing one ID across many inlined car SVGs would make
  // every car repaint itself off whichever marker happened to render first.
  const uid = 'kcCar' + (_kcCarIconSeq++);
  const hw = shape.bodyW / 2, hl = shape.bodyL / 2;
  const rw = shape.roofW / 2, rl = shape.roofL / 2;
  const html = `
    <div class="kc-car-wrap" style="transform:rotate(${heading || 0}deg);">
      <span class="kc-car-pulse" style="background:${color};"></span>
      <svg width="34" height="34" viewBox="-17 -17 34 34" xmlns="http://www.w3.org/2000/svg"
           style="filter:drop-shadow(0 2px 2.5px rgba(0,0,0,.45));">
        <defs>
          <linearGradient id="${uid}body" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"  stop-color="#000" stop-opacity=".22"/>
            <stop offset="16%" stop-color="${color}"/>
            <stop offset="55%" stop-color="${color}"/>
            <stop offset="100%" stop-color="#000" stop-opacity=".2"/>
          </linearGradient>
          <linearGradient id="${uid}glass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#e4edf4"/>
            <stop offset="100%" stop-color="#8fa4b6"/>
          </linearGradient>
        </defs>
        <!-- body shell -->
        <rect x="${-hw}" y="${-hl}" width="${shape.bodyW}" height="${shape.bodyL}"
              rx="${hw * 0.7}" ry="${hw * 0.95}"
              fill="url(#${uid}body)" stroke="rgba(0,0,0,.4)" stroke-width="0.5"/>
        <!-- wheel wells peeking from under the body -->
        <rect x="${-hw - 1.3}" y="${-hl + 3}" width="1.9" height="5" rx="1" fill="#1a1a1a"/>
        <rect x="${hw - 0.6}"  y="${-hl + 3}" width="1.9" height="5" rx="1" fill="#1a1a1a"/>
        <rect x="${-hw - 1.3}" y="${hl - 8}"  width="1.9" height="5" rx="1" fill="#1a1a1a"/>
        <rect x="${hw - 0.6}"  y="${hl - 8}"  width="1.9" height="5" rx="1" fill="#1a1a1a"/>
        <!-- glass roof -->
        <rect x="${-rw}" y="${shape.roofY - rl}" width="${shape.roofW}" height="${shape.roofL}"
              rx="${rw * 0.55}" fill="url(#${uid}glass)" opacity=".93"/>
        <line x1="${-rw}" y1="${shape.roofY - rl * 0.1}" x2="${rw}" y2="${shape.roofY - rl * 0.1}"
              stroke="rgba(0,0,0,.28)" stroke-width="0.4"/>
        <!-- gloss sheen down one flank -->
        <rect x="${-hw}" y="${-hl}" width="${shape.bodyW * 0.36}" height="${shape.bodyL}"
              rx="${hw * 0.7}" fill="#fff" opacity=".16"/>
        <!-- head/tail lights, front is -y (matches heading 0 = north/up) -->
        <ellipse cx="${-hw * 0.55}" cy="${-hl + 1.3}" rx="1" ry="0.7" fill="#fff6d8"/>
        <ellipse cx="${hw * 0.55}"  cy="${-hl + 1.3}" rx="1" ry="0.7" fill="#fff6d8"/>
        <ellipse cx="${-hw * 0.55}" cy="${hl - 1.3}"  rx="1" ry="0.7" fill="#c62828"/>
        <ellipse cx="${hw * 0.55}"  cy="${hl - 1.3}"  rx="1" ry="0.7" fill="#c62828"/>
      </svg>
    </div>`;
  return L.divIcon({ className: 'kc-car-icon', html, iconSize:[34,34], iconAnchor:[17,17] });
}

function rideEtaMinutes(km){ return Math.round((km / KC_RIDE_AVG_SPEED_KMH) * 60 * 10) / 10; }

// Fare breakdown — the ride fare is a fixed flat rate; the booking fee is
// NOT fixed, it mirrors this specific listing's own nightly price (per
// Rulez: "booking fee should equal the retreat listing's own $/night
// price"). listingPriceRaw is the listing's raw price string/number as
// scraped (e.g. "$70"); falls back to a constant only if unparseable.
function rideFareBreakdown(listingPriceRaw){
  const fare = KC_RIDE_FLAT_FARE;
  const parsed = parsePriceNumber(listingPriceRaw);
  const bookingFee = parsed != null ? parsed : KC_RIDE_BOOKING_FEE_FALLBACK;
  const subtotal = Math.round((fare + bookingFee) * 100) / 100;
  return { fare, bookingFee, subtotal };
}
function rideTier(min){ return min <= 5 ? 'near' : min <= 10 ? 'mid' : 'far'; }

// One live driver marker: rotated icon, glides between pings via rAF
// rather than snapping, matches the interpolation approach used for
// smartPanToMarker above.
function createCarMarker(map, lat, lng, heading, tier, vehicleType){
  const state = { lat, lng, heading: heading||0, tier: tier||'mid', vehicleType: vehicleType||'sedan', anim:null };
  state.marker = L.marker([lat, lng], { icon: carDivIcon(state.heading, state.tier, state.vehicleType), interactive:false, zIndexOffset: 800 }).addTo(map);
  // divIcon markers are non-interactive by design (smoother dragging/perf
  // elsewhere on the map) — a transparent circleMarker on top catches clicks.
  state.hit = L.circleMarker([lat, lng], { radius:15, opacity:0, fillOpacity:0 }).addTo(map);

  state.setTier = function(tier){
    if (tier === state.tier) return;
    state.tier = tier;
    state.marker.setIcon(carDivIcon(state.heading, state.tier, state.vehicleType));
  };

  state.moveTo = function(toLat, toLng, toHeading, durationMs){
    durationMs = durationMs || 1400;
    if (state.anim) cancelAnimationFrame(state.anim);
    const fromLat = state.lat, fromLng = state.lng, fromHeading = state.heading;
    const dh = ((toHeading - fromHeading) % 360 + 540) % 360 - 180;
    const start = performance.now();
    function step(now){
      const t = Math.min(1, (now - start) / durationMs);
      const ease = t < .5 ? 2*t*t : -1 + (4 - 2*t)*t;
      const curLat = fromLat + (toLat - fromLat) * ease;
      const curLng = fromLng + (toLng - fromLng) * ease;
      const curHeading = fromHeading + dh * ease;
      state.marker.setLatLng([curLat, curLng]);
      state.hit.setLatLng([curLat, curLng]);
      const el = state.marker.getElement();
      const wrap = el && el.querySelector('.kc-car-wrap');
      if (wrap) wrap.style.transform = `rotate(${curHeading}deg)`;
      if (t < 1){ state.anim = requestAnimationFrame(step); }
      else { state.lat = toLat; state.lng = toLng; state.heading = (fromHeading + dh + 360) % 360; }
    }
    state.anim = requestAnimationFrame(step);
  };

  state.remove = function(){
    if (state.anim) cancelAnimationFrame(state.anim);
    map.removeLayer(state.marker);
    map.removeLayer(state.hit);
  };

  return state;
}

// Wires a map up to the dispatch server's rider feed and keeps one
// createCarMarker() per live driver in sync with it. Returns
// { disconnect() } so a page can tear it down (e.g. on SPA-style nav,
// not needed on this multi-page site but cheap to offer).
function initLiveRide(map, opts){
  opts = opts || {};
  const wsUrl = opts.wsUrl || window.KARLCON_RIDE_WS_URL;
  const whatsappNumber = opts.whatsappNumber || '263780563561';
  const dest = opts.dest || null;                 // {lat,lng,title} — listing mode
  const listings = opts.listings || null;          // array — fleet mode (nearest-retreat)
  const panelMount = opts.panelMount || null;

  if (!wsUrl || /YOUR-DISPATCH-SERVER/.test(wsUrl)){
    console.info('[live-ride] KARLCON_RIDE_WS_URL not set yet — skipping live driver layer.');
    return { disconnect(){} };
  }

  const cars = new Map();     // driver_id -> car marker state
  const targets = new Map();  // driver_id -> {lat,lng,title,km,min,price} it's currently priced against
  let selectedId = null;
  let userPicked = false;     // true once the rider taps a specific car, overriding auto-follow-nearest
  let ws = null;
  let panel = null;

  const CAR_GLYPH_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 13l1.6-4.8A2 2 0 0 1 6.5 7h11a2 2 0 0 1 1.9 1.2L21 13"/>
    <path d="M3 13h18v3.5a1 1 0 0 1-1 1h-1.2a1 1 0 0 1-1-1V16H6.2v.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V13z"/>
    <circle cx="7.2" cy="17" r="1.3"/><circle cx="16.8" cy="17" r="1.3"/>
  </svg>`;

  if (panelMount){
    panel = document.createElement('div');
    panel.className = 'kc-ride-panel';
    panel.innerHTML = `
      <div class="kc-ride-top">
        <div class="kc-ride-avatar">${CAR_GLYPH_SVG}</div>
        <div style="flex:1;min-width:0;">
          <p class="kc-ride-name">No drivers online yet</p>
          <p class="kc-ride-sub">&nbsp;</p>
        </div>
        <span class="kc-ride-nearest-tag" style="display:none;">Nearest</span>
      </div>
      <div class="kc-ride-breakdown">
        <div class="kc-ride-bd-row"><span>Fare</span><b class="kc-ride-fare">–</b></div>
        <div class="kc-ride-bd-row"><span>Booking fee</span><b class="kc-ride-bookingfee">–</b></div>
        <div class="kc-ride-bd-row kc-ride-bd-total"><span>Subtotal</span><b class="kc-ride-subtotal">–</b></div>
      </div>
      <div class="kc-ride-stats">
        <div class="kc-ride-pill"><b class="kc-ride-min">–</b><span>Away</span></div>
        <div class="kc-ride-pill"><b class="kc-ride-clock">–</b><span>Arrives</span></div>
      </div>
      <p class="kc-ride-locline"></p>
      <button class="kc-ride-book" data-disabled="1">💬 Book via WhatsApp</button>`;
    panelMount.appendChild(panel);
  }

  function nearestListingTo(lat, lng){
    if (!listings || !listings.length) return null;
    let best = null, bestKm = Infinity;
    listings.forEach((l) => {
      if (!isValidZimCoord(l.lat, l.lng)) return;
      const km = haversineKm([lat, lng], [l.lat, l.lng]);
      if (km < bestKm){ bestKm = km; best = l; }
    });
    return best ? { lat: best.lat, lng: best.lng, title: best.title, listingPrice: best.price, km: bestKm } : null;
  }

  function targetFor(driver){
    // Once we know the rider's actual location (via locateUser — now asked
    // for proactively on load, not just on "Directions from me"), price the
    // ride the way a real dispatch would: ETA is how far the DRIVER is from
    // the PICKUP point, and the fare is the PICKUP-to-destination distance —
    // not the driver's own distance to the retreat, which was never the
    // rider's actual trip.
    const pickup = map._kcUserLatLng || null;
    if (dest){
      if (pickup){
        const pickupKm = haversineKm([driver.lat, driver.lng], pickup);
        const rideKm = haversineKm(pickup, [dest.lat, dest.lng]);
        return { lat: dest.lat, lng: dest.lng, title: dest.title, listingPrice: dest.price, pickupKm, rideKm, hasPickup: true };
      }
      // No known pickup point yet — fall back to the old single-leg
      // estimate (driver straight to the retreat) rather than blocking.
      const km = haversineKm([driver.lat, driver.lng], [dest.lat, dest.lng]);
      return { lat: dest.lat, lng: dest.lng, title: dest.title, listingPrice: dest.price, pickupKm: km, rideKm: km, hasPickup: false };
    }
    const nearest = nearestListingTo(driver.lat, driver.lng);
    if (!nearest) return null;
    return { ...nearest, pickupKm: nearest.km, rideKm: nearest.km, hasPickup: false };
  }

  // Turns "sim-4" or "driver-ab12cd" into something a rider can actually
  // read on a WhatsApp confirmation instead of a raw internal id.
  function friendlyDriverLabel(driverId){
    const m = String(driverId).match(/(\d+)$/);
    if (m) return 'Driver ' + m[1];
    return 'Driver ' + String(driverId).slice(-4).toUpperCase();
  }

  function etaClockLabel(min){
    const arrival = new Date(Date.now() + min * 60000);
    return arrival.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Draws the glow ring around whichever car the panel is currently
  // quoting — re-applied every sync tick because setIcon() (tier/color
  // changes) replaces the marker's DOM node and would otherwise silently
  // drop the class.
  let ringedId = null;
  function setSelectedRing(driverId){
    if (ringedId && ringedId !== driverId && cars.has(ringedId)){
      const prevEl = cars.get(ringedId).marker.getElement();
      const prevWrap = prevEl && prevEl.querySelector('.kc-car-wrap');
      if (prevWrap) prevWrap.classList.remove('kc-car-selected');
    }
    ringedId = driverId;
    if (driverId && cars.has(driverId)){
      const el = cars.get(driverId).marker.getElement();
      const wrap = el && el.querySelector('.kc-car-wrap');
      if (wrap) wrap.classList.add('kc-car-selected');
    }
  }

  function updateSummary(driverId, isAuto){
    if (!panel) return;
    const t = targets.get(driverId);
    const nameEl = panel.querySelector('.kc-ride-name');
    const subEl = panel.querySelector('.kc-ride-sub');
    const tagEl = panel.querySelector('.kc-ride-nearest-tag');
    const fareEl = panel.querySelector('.kc-ride-fare');
    const feeEl = panel.querySelector('.kc-ride-bookingfee');
    const subtotalEl = panel.querySelector('.kc-ride-subtotal');
    const minEl = panel.querySelector('.kc-ride-min');
    const clockEl = panel.querySelector('.kc-ride-clock');
    const locEl = panel.querySelector('.kc-ride-locline');
    const bookBtn = panel.querySelector('.kc-ride-book');

    if (!t){
      nameEl.textContent = 'No drivers online yet';
      subEl.innerHTML = '&nbsp;';
      tagEl.style.display = 'none';
      fareEl.textContent = feeEl.textContent = subtotalEl.textContent = '–';
      minEl.textContent = clockEl.textContent = '–';
      locEl.textContent = '';
      if (bookBtn){ bookBtn.setAttribute('data-disabled', '1'); bookBtn.onclick = null; }
      if (opts.onQuote) opts.onQuote(null);
      return;
    }

    const car = cars.get(driverId);
    const vType = car ? car.vehicleType : 'sedan';
    const breakdown = rideFareBreakdown(t.listingPrice);
    nameEl.textContent = friendlyDriverLabel(driverId);
    subEl.textContent = vType.charAt(0).toUpperCase() + vType.slice(1) + ' · to ' + (t.title || 'the retreat');
    tagEl.style.display = isAuto ? 'inline-block' : 'none';
    fareEl.textContent = '$' + breakdown.fare.toFixed(2);
    feeEl.textContent = '$' + breakdown.bookingFee.toFixed(2);
    subtotalEl.textContent = '$' + breakdown.subtotal.toFixed(2);
    minEl.textContent = t.min + ' min';
    clockEl.textContent = etaClockLabel(t.min);
    if (bookBtn){
      bookBtn.removeAttribute('data-disabled');
      bookBtn.onclick = () => bookRide(driverId, t);
    }

    // Fill in human-readable place names for easy copy/paste into InDrive —
    // async and non-blocking; panel shows coordinates briefly, then updates
    // in place once the lookup resolves (or falls back silently on failure).
    const pickup = map._kcUserLatLng || null;
    locEl.textContent = 'Looking up place names…';
    (async () => {
      const dropName = await reverseGeocodeShortName(t.lat, t.lng);
      const pickupName = (t.hasPickup && pickup) ? await reverseGeocodeShortName(pickup[0], pickup[1]) : null;
      if (locEl.isConnected){
        locEl.textContent = pickupName ? `${pickupName} → ${dropName}` : `To: ${dropName}`;
      }
      t.dropName = dropName;
      t.pickupName = pickupName;
    })();

    if (opts.onQuote){
      const car = cars.get(driverId);
      opts.onQuote({
        driverId,
        label: friendlyDriverLabel(driverId),
        vehicleType: car ? car.vehicleType : 'sedan',
        min: t.min,
        fare: breakdown.fare,
        bookingFee: breakdown.bookingFee,
        subtotal: breakdown.subtotal,
        arrivalClock: etaClockLabel(t.min),
        destLat: t.lat, destLng: t.lng, destTitle: t.title,
        pickupLat: pickup ? pickup[0] : null, pickupLng: pickup ? pickup[1] : null,
        hasPickup: !!t.hasPickup,
      });
    }
  }

  async function bookRide(driverId, t){
    const car = cars.get(driverId);
    const vType = car ? car.vehicleType : 'car';
    const pickup = map._kcUserLatLng || null;
    const breakdown = rideFareBreakdown(t.listingPrice);

    // Prefer the place names already resolved by updateSummary; if the
    // lookup hasn't landed yet, resolve now rather than falling back to
    // raw coordinates in the actual booking message.
    const dropName = t.dropName || await reverseGeocodeShortName(t.lat, t.lng);
    const dropMapsUrl = `https://maps.google.com/?q=${t.lat},${t.lng}`;
    const pickupName = (t.hasPickup && pickup)
      ? (t.pickupName || await reverseGeocodeShortName(pickup[0], pickup[1]))
      : null;
    const pickupMapsUrl = (t.hasPickup && pickup) ? `https://maps.google.com/?q=${pickup[0]},${pickup[1]}` : null;

    // Each location goes out in BOTH formats: the short place name (for
    // pasting into InDrive's search box) and the Google Maps link (for
    // tapping straight to the pin) — per Rulez's ask, not either/or.
    const pickupLine = pickupName
      ? `Pickup: ${pickupName}\n${pickupMapsUrl}\n`
      : '';
    const msg = `Hi Karl! I'd like to book a ride to "${t.title || 'a KarlCon retreat'}".\n` +
      `${friendlyDriverLabel(driverId)} (${vType}) is ${t.min} min away — arriving around ${etaClockLabel(t.min)}.\n` +
      `Fare: $${breakdown.fare.toFixed(2)}\n` +
      `Booking fee: $${breakdown.bookingFee.toFixed(2)}\n` +
      `Subtotal: $${breakdown.subtotal.toFixed(2)}\n` +
      pickupLine +
      `Drop-off: ${dropName}\n${dropMapsUrl}\n` +
      `Can you confirm pickup?`;
    window.open(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(msg)}`, '_blank');
  }

  function syncDrivers(drivers){
    const seen = new Set();
    Object.keys(drivers).forEach((driverId) => {
      const d = drivers[driverId];
      seen.add(driverId);
      const t = targetFor(d);
      if (t){
        t.min = rideEtaMinutes(t.pickupKm);
        const breakdown = rideFareBreakdown(t.listingPrice);
        t.bookingFee = breakdown.bookingFee;
        t.price = breakdown.subtotal; // kept for any old callers reading t.price
        targets.set(driverId, t);
      }
      const tier = t ? rideTier(t.min) : 'mid';

      let car = cars.get(driverId);
      if (!car){
        car = createCarMarker(map, d.lat, d.lng, d.heading, tier, d.vehicle_type);
        car.hit.on('click', () => { userPicked = true; selectedId = driverId; updateSummary(driverId, false); setSelectedRing(driverId); });
        cars.set(driverId, car);
      } else {
        car.moveTo(d.lat, d.lng, d.heading || car.heading);
        car.setTier(tier);
      }
    });

    for (const [id, car] of cars){
      if (!seen.has(id)){
        car.remove(); cars.delete(id); targets.delete(id);
        if (selectedId === id){ selectedId = null; userPicked = false; }
      }
    }

    // Always keep an answer on screen: follow whichever driver is nearest
    // unless the rider tapped a specific different car on the map, and
    // fall back to auto-follow again if their pick goes offline.
    if (!userPicked || !cars.has(selectedId)){
      let bestId = null, bestMin = Infinity;
      for (const [id, t] of targets){
        if (t.min < bestMin){ bestMin = t.min; bestId = id; }
      }
      selectedId = bestId;
    }

    updateSummary(selectedId, !userPicked);
    setSelectedRing(selectedId);
  }

  function connect(){
    ws = new WebSocket(wsUrl);
    ws.onmessage = (evt) => { try { syncDrivers(JSON.parse(evt.data)); } catch(e){} };
    ws.onclose = () => setTimeout(connect, 3000);
    ws.onerror = () => {};
  }
  connect();

  return { disconnect(){ if (ws){ ws.onclose = null; ws.close(); } for (const car of cars.values()) car.remove(); } };
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
