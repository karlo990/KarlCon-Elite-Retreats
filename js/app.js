(function(){
  const LISTINGS = window.LISTINGS || [];
  let activeQuery = '';

  const STAR = '<svg viewBox="0 0 24 24"><path d="M12 2l2.9 6.5L22 9.3l-5 4.9 1.2 7.1L12 17.8l-6.2 3.5L7 14.2 2 9.3l7.1-.8z"/></svg>';

  function fmtPrice(l){
    return cleanPriceLabel(l.price, 'Price on request');
  }

  function cardHTML(l){
    const img = l.images && l.images[0] ? l.images[0] : '';
    const ratingNum = parseFloat(l.rating);
    const rating = Number.isFinite(ratingNum)
      ? `<span class="card-rating">${STAR} ${ratingNum.toFixed(1)}</span>`
      : '';
    return `
    <a class="card reveal" href="listing.html?id=${encodeURIComponent(l.id)}">
      <div class="card-img">
        ${img ? `<img src="${img}" alt="${l.title}" loading="lazy">` : ''}
        <span class="card-badge">${l.areaLabel || 'Zimbabwe'}</span>
        <span class="card-heart">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>
        </span>
      </div>
      <div class="card-body">
        <div class="card-row">
          <div class="card-title">${l.title}</div>
          ${rating}
        </div>
        ${l.tagline ? `<div class="card-tag">${l.tagline}</div>` : ''}
        <div class="card-meta">
          <span>${l.host && l.host.name ? 'Hosted by ' + l.host.name : ''}</span>
          ${l.host && l.host.superhost ? '<span class="card-super">· Superhost</span>' : ''}
        </div>
        <div class="card-price">${fmtPrice(l)} <span>/ night</span></div>
      </div>
    </a>`;
  }

  function matches(l, q){
    if (!q) return true;
    const hay = [l.title, l.tagline, l.areaLabel].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q.toLowerCase());
  }

  function renderGrid(){
    const grid = document.getElementById('listing-grid');
    if (!grid) return;
    const visible = LISTINGS.filter(l => matches(l, activeQuery));
    if (LISTINGS.length === 0){
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--txt2);
        font-family:var(--sans);font-size:13px;padding:60px 0;">
        No retreats indexed yet — run build_manifest.py against your airbnb_data folder.
      </div>`;
      return;
    }
    if (visible.length === 0){
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--txt2);
        font-family:var(--sans);font-size:14px;padding:60px 0;">
        No retreats match "${activeQuery}" yet — try a different area or clear the search.
      </div>`;
      return;
    }
    grid.innerHTML = visible.map(cardHTML).join('');
    visible.forEach((_, i) => {
      const el = grid.children[i];
      requestAnimationFrame(() => el.classList.add('in'));
    });
  }

  function renderStats(){
    const withCoords = LISTINGS.filter(l => l.lat && l.lng).length;
    const photos = LISTINGS.reduce((n,l)=> n + (l.images ? l.images.length : 0), 0);
    const superhosts = LISTINGS.filter(l => l.host && l.host.superhost).length;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('stat-count', LISTINGS.length);
    set('stat-photos', photos);
    set('stat-mapped', withCoords);
    set('stat-super', superhosts);
  }

  function renderMap(){
    const el = document.getElementById('globe-map');
    if (!el || typeof L === 'undefined') return;

    // isValidZimCoord (common.js) rejects mis-scraped lat/lng pairs that land
    // outside Zimbabwe entirely (e.g. picked up from unrelated JSON on the
    // source page) — without this, one bad coordinate can send the whole
    // map's camera out into open ocean with nothing to look at.
    const pinned = LISTINGS.filter(l => isValidZimCoord(l.lat, l.lng));
    const skipped = LISTINGS.filter(l => (l.lat || l.lng) && !isValidZimCoord(l.lat, l.lng)).length;
    if (skipped > 0) console.warn(`[map] ${skipped} listing(s) had out-of-range coordinates and were not plotted.`);

    const fallbackCenter = [-19.0154, 29.1549];
    const targetZoom = pinned.length === 1 ? 12 : 5.4;

    // Start high above the earth, then fly down into the retreats once the
    // section actually enters view — a real "moving globe" rather than a
    // map that's just already sitting there.
    const map = initSatelliteMap('globe-map', { center: fallbackCenter, zoom: 2.2, scrollWheelZoom: true });

    // Cluster nearby pins instead of dumping 300+ individual markers on
    // screen — at low zoom they collapse into a single "N retreats" bubble
    // that expands as you zoom in, instead of a wall of overlapping pills.
    const hasCluster = typeof L.markerClusterGroup === 'function';
    const clusterGroup = hasCluster ? L.markerClusterGroup({
      maxClusterRadius: 55,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction: (cluster) => L.divIcon({
        html: `<div class="kc-cluster-bubble">${cluster.getChildCount()}</div>`,
        className: '', iconSize: [40, 40],
      }),
    }) : null;
    const markerTarget = clusterGroup || map;

    const markerLatLngs = [];
    pinned.forEach((l, i) => {
      addAreaCircle(map, l.lat, l.lng, 2200);
      const label = cleanPriceLabel(l.price, 'POA');
      const marker = L.marker([l.lat, l.lng], {icon: priceDivIcon(label, {delay: i * 45}), zIndexOffset: 500});
      marker.bindPopup(`
        <b>${l.title}</b><br>${l.areaLabel || ''}<br>
        <div class="popup-actions">
          <a href="listing.html?id=${encodeURIComponent(l.id)}">View retreat →</a>
          <button class="popup-directions" data-lat="${l.lat}" data-lng="${l.lng}">Directions</button>
        </div>`, { autoPan: false });
      marker.on('click', () => smartPanToMarker(map, [l.lat, l.lng]));
      marker.on('popupopen', (e) => {
        const btn = e.popup.getElement().querySelector('.popup-directions');
        if (!btn) return;
        btn.onclick = () => requestDirectionsTo(map, [l.lat, l.lng]);
      });
      marker.addTo(markerTarget);
      markerLatLngs.push([l.lat, l.lng]);
    });
    if (clusterGroup) map.addLayer(clusterGroup);

    document.getElementById('map-listed-count') &&
      (document.getElementById('map-listed-count').textContent = pinned.length);

    // Fit the camera to every valid pin instead of flying to listing #1 —
    // one bad coordinate can no longer strand the map somewhere empty, and
    // as a bonus the view now actually frames all your retreats.
    const bounds = markerLatLngs.length ? L.latLngBounds(markerLatLngs) : null;

    let flown = false;
    const mapSection = document.getElementById('map');
    const doFly = () => {
      if (bounds) {
        map.flyToBounds(bounds, { padding: [50, 50], duration: 2.4, maxZoom: 12 });
      } else {
        map.flyTo(fallbackCenter, targetZoom, { duration: 2.4 });
      }
    };
    if ('IntersectionObserver' in window && mapSection){
      const io = new IntersectionObserver((entries) => {
        entries.forEach(en => {
          if (en.isIntersecting && !flown){
            flown = true;
            setTimeout(doFly, 200);
            io.disconnect();
          }
        });
      }, {threshold: .3});
      io.observe(mapSection);
    } else if (bounds) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
    } else {
      map.setView(fallbackCenter, targetZoom);
    }

    initMapControls(map);

    // Live fleet, ambient mode: no single destination on this map (it shows
    // every retreat at once), so each car prices itself to whichever
    // listing is nearest to it — see nearestListingTo() in common.js.
    // No-ops quietly until KARLCON_RIDE_WS_URL points at a deployed
    // dispatch_server.py.
    if (typeof initLiveRide === 'function'){
      initLiveRide(map, {
        listings: pinned,
        panelMount: document.querySelector('.map-shell'),
      });
    }
  }

  // "Use my location" + route summary chip, wired to the shared locateUser/
  // drawRoute helpers in common.js. Also exposes requestDirectionsTo() so a
  // marker popup's "Directions" button can trigger a locate-then-route flow
  // even if the visitor hasn't pressed "Use my location" yet.
  function initMapControls(map){
    const btn = document.getElementById('locate-btn');
    const status = document.getElementById('locate-status');
    const chip = document.getElementById('route-chip');
    const chipText = document.getElementById('route-chip-text');
    const chipClear = document.getElementById('route-clear');
    if (!btn) return;

    btn.addEventListener('click', () => {
      btn.disabled = true;
      status.textContent = 'Locating…';
      locateUser(map, (latlng) => {
        btn.disabled = false;
        status.textContent = 'Location found';
        map.flyTo(latlng, 12, {duration: 1.6});
        setTimeout(() => { status.textContent = ''; }, 3000);
      }, (msg) => {
        btn.disabled = false;
        status.textContent = msg;
        setTimeout(() => { status.textContent = ''; }, 3600);
      });
    });

    chipClear && chipClear.addEventListener('click', () => {
      clearRoute(map);
      chip.style.display = 'none';
    });

    window.requestDirectionsTo = function(mapRef, dest){
      mapRef.closePopup();
      function go(){
        drawRoute(mapRef, mapRef._kcUserLatLng, dest, {
          onSummary: (text) => { chip.style.display = 'flex'; chipText.textContent = text; }
        });
      }
      if (mapRef._kcUserLatLng){ go(); return; }
      btn.disabled = true; status.textContent = 'Locating…';
      locateUser(mapRef, () => { btn.disabled = false; status.textContent = ''; go(); }, (msg) => {
        btn.disabled = false; status.textContent = msg;
        setTimeout(() => { status.textContent = ''; }, 3600);
      });
    };
  }

  function initSearch(){
    const form = document.getElementById('search-form');
    const input = document.getElementById('search-where');
    if (!form || !input) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      activeQuery = input.value.trim();
      renderGrid();
      document.getElementById('collection').scrollIntoView({behavior:'smooth'});
    });
  }

  renderGrid();
  renderStats();
  renderMap();
  initSearch();
})();
