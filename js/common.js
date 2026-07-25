/* ═══════════════════════════════════════════════════════════
   KARLCON — shared chrome: nav scroll state, reveal, map init
   ═══════════════════════════════════════════════════════════ */

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
      filter:drop-shadow(0 10px 16px rgba(6,40,26,.35));
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
        0 8px 18px rgba(14,122,76,.30);
      transition:transform .28s cubic-bezier(.2,.7,.3,1), box-shadow .28s ease;
    }
    .kc-pin-wrap:hover .kc-pin-bubble{
      transform:translateY(-4px) scale(1.07);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.95),
        inset 0 -8px 12px rgba(255,255,255,.18),
        0 16px 28px rgba(14,122,76,.42);
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
    }
    @keyframes kcPinPop{
      0%{ transform:translate(-50%,-100%) scale(0); opacity:0; }
      65%{ transform:translate(-50%,-100%) scale(1.14); opacity:1; }
      100%{ transform:translate(-50%,-100%) scale(1); }
    }
    @media (prefers-reduced-motion: reduce){
      .kc-pin-wrap{ animation:none; }
    }
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

document.addEventListener('DOMContentLoaded', () => {
  initNavScroll();
  initReveal();
  mountFooter();
});
