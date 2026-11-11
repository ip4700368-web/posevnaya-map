/* Карта посёлка Посевная — логика приложения.
   Зависимости: lib/leaflet.js (Leaflet 1.9.4) и data.js (данные OpenStreetMap). */
(function () {
  'use strict';

  var D = window.MAP_DATA;

  function fatal(msg) {
    document.body.insertAdjacentHTML('afterbegin',
      '<div style="position:absolute;z-index:2000;top:10px;left:10px;background:#fff;' +
      'padding:14px 18px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.3);' +
      'font:13px sans-serif;max-width:320px">' + msg + '</div>');
  }

  if (!window.L) { fatal('Не загрузился Leaflet (файл lib/leaflet.js). Проверьте папку lib.'); return; }
  if (!D) { fatal('Не загрузился data.js. Проверьте, что он лежит рядом с index.html.'); return; }

  /* ==================== справочники ==================== */

  var CAT_META = {
    edu:      { name: 'Образование',       color: '#1a73e8' },
    med:      { name: 'Медицина',          color: '#d93025' },
    pharmacy: { name: 'Аптека',            color: '#188038' },
    admin:    { name: 'Администрация',     color: '#9334e6' },
    shop:     { name: 'Магазин',           color: '#e8710a' },
    food:     { name: 'Кафе / еда',        color: '#f9ab00' },
    service:  { name: 'Услуги',            color: '#5f6368' },
    safety:   { name: 'Полиция / МЧС',     color: '#d93025' },
    culture:  { name: 'Культура',          color: '#9334e6' },
    leisure:  { name: 'Парк / отдых',      color: '#188038' },
    religion: { name: 'Храм',              color: '#795548' },
    fuel:     { name: 'АЗС',               color: '#795548' },
    transport:{ name: 'Транспорт',         color: '#5f6368' },
    industry: { name: 'Производство',      color: '#616161' },
    tourism:  { name: 'Туризм',            color: '#1a73e8' },
    man_made: { name: 'Сооружение',        color: '#616161' },
    other:    { name: 'Объект',            color: '#5f6368' }
  };

  var WATERWAY_RU = {
    river: 'река', stream: 'ручей', dam: 'плотина',
    ditch: 'канава', canal: 'канал', drain: 'дренаж'
  };

  function fmtArea(km2) {
    var ha = (km2 || 0) * 100;
    if (ha >= 1) return '≈ ' + ha.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' га';
    return '≈ ' + Math.round((km2 || 0) * 1e6).toLocaleString('ru-RU') + ' м²';
  }

  function fmtDist(m) {
    if (m < 1000) return Math.round(m) + ' м';
    return (m / 1000).toFixed(2).replace('.', ',') + ' км';
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* площадь кольца [ [lat,lon], ... ] в м² (та же формула, что в fetch_data.py) */
  function ringAreaM2(ring) {
    if (!ring || ring.length < 4) return 0;
    var s = 0, R = Math.PI / 180;
    for (var i = 0; i < ring.length - 1; i++) {
      var lat1 = ring[i][0] * R,     lon1 = ring[i][1] * R;
      var lat2 = ring[i + 1][0] * R, lon2 = ring[i + 1][1] * R;
      s += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
    }
    return Math.abs(s) * 6371000 * 6371000 / 2;
  }

  /* ==================== карта и подложки ==================== */

  var scheme = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  });
  var satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Esri, Maxar, Earthstar Geographics'
  });

  var map = L.map('map', { zoomControl: false, attributionControl: false });
  map.setView(D.center, D.zoom || 14);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);

  /* ==================== автономная векторная подложка ====================
     Рисуется из basemap.js (данные OSM), работает без интернета.
     Панель с zIndex 250 — выше тайлов (200), ниже слоёв данных (400). */

  var offlineBase = null;
  var hasBasemap = !!window.BASEMAP;

  if (hasBasemap) {
    map.createPane('offlineBase');
    map.getPane('offlineBase').style.zIndex = 250;
    var offRenderer = L.canvas({ pane: 'offlineBase' });
    offlineBase = L.layerGroup();

    var AREA_STYLE = {
      forest:      { color: '#9fbf8f', fillColor: '#add19e', fillOpacity: 1, weight: 1 },
      farmland:    { color: '#d9d6b8', fillColor: '#f1ecda', fillOpacity: 1, weight: 1 },
      farmyard:    { color: '#dccf9e', fillColor: '#efe3c0', fillOpacity: 1, weight: 1 },
      meadow:      { color: '#b6d9b0', fillColor: '#d5ecd2', fillOpacity: 1, weight: 1 },
      grass:       { color: '#b6d9a8', fillColor: '#cfe8bb', fillOpacity: 1, weight: 1 },
      residential: { color: '#d6d2cc', fillColor: '#e8e4de', fillOpacity: 1, weight: 1 },
      industrial:  { color: '#dfc9d6', fillColor: '#efdfe8', fillOpacity: 1, weight: 1 },
      cemetery:    { color: '#b6cbb0', fillColor: '#d1e0cd', fillOpacity: 1, weight: 1 },
      quarry:      { color: '#c5c1c4', fillColor: '#ddd9dc', fillOpacity: 1, weight: 1 },
      wetland:     { color: '#a8c4dd', fillColor: '#c8dff0', fillOpacity: 1, weight: 1 },
      scrub:       { color: '#a8cfa0', fillColor: '#c3e2b8', fillOpacity: 1, weight: 1 },
      park:        { color: '#a8d190', fillColor: '#cdebb4', fillOpacity: 1, weight: 1 },
      allotments:  { color: '#c9d3a8', fillColor: '#e9f0d8', fillOpacity: 1, weight: 1 }
    };

    /* суша под всем: большие участки вне угодий не должны просвечивать цветом воды */
    var landBounds = L.latLngBounds([]);
    (window.BASEMAP.buildings || []).forEach(function (flat) {
      for (var i = 0; i < flat.length; i += 2) landBounds.extend([flat[i], flat[i + 1]]);
    });
    (window.BASEMAP.roads || []).forEach(function (r) {
      r.c.forEach(function (p) { landBounds.extend(p); });
    });
    if (landBounds.isValid()) {
      var land = landBounds.toBBoxString().split(',').map(Number);
      var pad = 0.012;
      L.polygon([
        [land[1] - pad, land[0] - pad],
        [land[1] - pad, land[2] + pad],
        [land[3] + pad, land[2] + pad],
        [land[3] + pad, land[0] - pad]
      ], { renderer: offRenderer, interactive: false,
           color: '#f2efe9', weight: 0, fillColor: '#f2efe9', fillOpacity: 1 })
        .addTo(offlineBase);
    }

    (window.BASEMAP.areas || []).forEach(function (a) {
      var st = AREA_STYLE[a.k];
      if (st) {
        L.polygon(a.c, { renderer: offRenderer, interactive: false,
          color: st.color, weight: st.weight,
          fillColor: st.fillColor, fillOpacity: st.fillOpacity }).addTo(offlineBase);
      }
    });

    (window.BASEMAP.buildings || []).forEach(function (flat) {
      var pts = [];
      for (var i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
      if (pts.length >= 3) {
        L.polygon(pts, { renderer: offRenderer, interactive: false,
          color: '#c6bcae', weight: .5, fillColor: '#ddd4c9', fillOpacity: 1 })
          .addTo(offlineBase);
      }
    });

    var ROAD_STYLE = {
      1: { w: 5,   c: '#f3ba78' },
      2: { w: 4,   c: '#f7cf94' },
      3: { w: 2.4, c: '#ffffff' },
      4: { w: 1.6, c: '#cfc9bf', dash: '4 4' }
    };
    (window.BASEMAP.roads || []).forEach(function (r) {
      var st = ROAD_STYLE[r.t] || ROAD_STYLE[3];
      var opts = { renderer: offRenderer, interactive: false,
                   color: st.c, weight: st.w, opacity: 1 };
      if (st.dash) opts.dashArray = st.dash;
      L.polyline(r.c, opts).addTo(offlineBase);
    });

    (window.BASEMAP.rails || []).forEach(function (c) {
      L.polyline(c, { renderer: offRenderer, interactive: false,
        color: '#9c9c9c', weight: 2, opacity: .9 }).addTo(offlineBase);
    });

    L.marker(D.center, { interactive: false, icon: L.divIcon({
      className: '', iconSize: null,
      html: '<span class="town-label">ПОСЕВНАЯ</span>'
    }) }).addTo(offlineBase);
  }

  var bases = { scheme: scheme, satellite: satellite };
  if (offlineBase) bases.offline = offlineBase;
  var currentBase = null;

  function updateBaseButtons() {
    ['scheme', 'satellite', 'offline'].forEach(function (n) {
      var b = document.getElementById('btn-' + n);
      if (b) b.classList.toggle('active', currentBase === n);
    });
  }

  function setBase(name) {
    if (!bases[name] || name === currentBase) return;
    if (currentBase) map.removeLayer(bases[currentBase]);
    bases[name].addTo(map);
    currentBase = name;
    /* у автономной схемы фон — суша, а не вода */
    map.getContainer().style.background =
      (name === 'offline') ? '#f2efe9' : '#aad3df';
    updateBaseButtons();
    /* сразу догружаем тайлы текущего вида */
    if (name !== 'offline' && bases[name].redraw) bases[name].redraw();
  }

  /* стартовая подложка: ?base=offline / ?base=satellite / по умолчанию схема */
  var startBase = null;
  try {
    startBase = new URLSearchParams(window.location.search).get('base');
  } catch (e) { /* старые браузеры — не страшно */ }
  if (!(startBase && bases[startBase])) startBase = 'scheme';
  setBase(startBase);

  document.getElementById('btn-scheme').addEventListener('click', function () { setBase('scheme'); });
  document.getElementById('btn-satellite').addEventListener('click', function () { setBase('satellite'); });
  var btnOffline = document.getElementById('btn-offline');
  if (btnOffline) {
    if (bases.offline) {
      btnOffline.addEventListener('click', function () { setBase('offline'); });
    } else {
      btnOffline.style.display = 'none'; // нет basemap.js — прячем кнопку
    }
  }

  /* если онлайн-тайлы не отвечают — сами включаем автономный режим */
  function notice(msg) {
    var d = document.createElement('div');
    d.className = 'notice';
    d.textContent = msg;
    document.body.appendChild(d);
    setTimeout(function () { d.classList.add('hide'); }, 6000);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 6600);
  }

  if (bases.offline) {
    var tileLoaded = false, tileErrors = 0;
    scheme.on('tileload', function () { tileLoaded = true; });
    scheme.on('tileerror', function () {
      tileErrors++;
      if (!tileLoaded && tileErrors >= 3 && currentBase === 'scheme') {
        setBase('offline');
        notice('Онлайн-подложка недоступна — включён автономный режим (работает без интернета).');
      }
    });
    setTimeout(function () {
      if (!tileLoaded && tileErrors === 0 && currentBase === 'scheme') {
        setBase('offline');
        notice('Онлайн-подложка не ответила — включён автономный режим.');
      }
    }, 7000);
  }

  /* ==================== слои данных ==================== */

  var waterLayer    = L.layerGroup().addTo(map);
  var streamsLayer  = L.layerGroup().addTo(map);
  var poiLayer      = L.layerGroup().addTo(map);
  var waterLabels   = L.layerGroup().addTo(map);

  var townBounds    = L.latLngBounds([]);
  var searchIndex = [];

  /* --- водоёмы --- */
  var waters = (D.water || []).slice()
    .sort(function (a, b) { return (b.area_km2 || 0) - (a.area_km2 || 0); });

  var num = 0;
  waters.forEach(function (w) {
    var title = w.name || ('водоём №' + (++num));
    w.title = title;
    var mainPoly = null;
    (w.polygons || []).forEach(function (rings) {
      var p = L.polygon(rings, {
        color: '#2b7cd3', weight: 1.5, opacity: .85,
        fillColor: '#64b5f6', fillOpacity: .55
      }).bindPopup(
        '<div class="pond-card-title">' + esc(title) + '</div>' +
        'площадь ' + fmtArea(w.area_km2) + '<br>' +
        '<span style="color:#80868b;font-size:11px">источник: OpenStreetMap</span>'
      ).addTo(waterLayer);
      if (!mainPoly) mainPoly = p;
    });
    if (mainPoly) {
      w.layer = mainPoly;
      var b = mainPoly.getBounds();
      searchIndex.push({
        always: true, color: '#64b5f6',
        name: title, sub: 'водоём · ' + fmtArea(w.area_km2),
        kw: 'водоём пруд озеро вода' + (w.name ? ' ' + w.name : ''),
        bounds: b, open: function () { mainPoly.openPopup(b.getCenter()); }
      });
    }
    /* подпись на карте — для именованных и крупных безымянных */
    if (mainPoly && (w.name || (w.area_km2 || 0) >= 0.02)) {
      L.marker(mainPoly.getBounds().getCenter(), {
        interactive: false,
        icon: L.divIcon({
          className: '', iconSize: null,
          html: '<span class="water-label">' + esc(title) + '</span>'
        })
      }).addTo(waterLabels);
    }
  });

  /* --- реки и ручьи --- */
  (D.streams || []).forEach(function (s) {
    var isDam = s.kind === 'dam';
    var title = s.name || (WATERWAY_RU[s.kind] || 'Водоток');
    var line = s.line || [];
    if (line.length < 2) return;
    var mid = line[Math.floor(line.length / 2)];
    L.polyline(line, {
      color: isDam ? '#5d4037' : '#3d8bd4',
      weight: isDam ? 4 : 2.5,
      opacity: .9
    }).bindPopup('<b>' + esc(title) + '</b><br>' + (WATERWAY_RU[s.kind] || s.kind || ''))
      .addTo(streamsLayer);
    searchIndex.push({
      always: true, color: '#3d8bd4',
      name: title, sub: WATERWAY_RU[s.kind] || s.kind || 'водоток',
      kw: 'река ручей вода плотина',
      latlng: mid, zoom: 15
    });
  });

  /* --- объекты (POI) --- */
  (D.pois || []).forEach(function (p) {
    var meta = CAT_META[p.cat] || CAT_META.other;
    var m = L.marker([p.lat, p.lon], {
      icon: L.divIcon({
        className: '',
        html: '<div class="poi-icon" style="background:' + meta.color + '"></div>',
        iconSize: [16, 16], iconAnchor: [8, 8]
      })
    }).bindPopup('<b>' + esc(p.name) + '</b><br>' + meta.name)
      .addTo(poiLayer);
    searchIndex.push({
      always: true, color: meta.color,
      name: p.name, sub: meta.name,
      kw: 'объект' + (CAT_META[p.cat] ? ' ' + CAT_META[p.cat].name : ''),
      latlng: [p.lat, p.lon], zoom: 17,
      open: function () { m.openPopup(); }
    });
  });

  /* --- улицы (только для поиска) --- */
  (D.streets || []).forEach(function (s) {
    searchIndex.push({
      always: false, color: '#9aa0a6',
      name: s.name, sub: 'улица',
      kw: 'улица улица',
      latlng: [s.lat, s.lon], zoom: 16
    });
  });

  /* --- граница посёлка: не рисуется (убрана по просьбе),
         но её габариты нужны кнопке «Показать весь посёлок» --- */
  (D.boundary || []).forEach(function (rings) {
    (rings || []).forEach(function (ring) {
      (ring || []).forEach(function (pt) { townBounds.extend(pt); });
    });
  });

  /* ==================== легенда (слои) ==================== */

  function makeSwatch(fillColor, lineColor, dashed, text) {
    var sw = document.createElement('span');
    if (text) {
      sw.className = 'swatch txt';
      sw.textContent = text;
      return sw;
    }
    if (lineColor) {
      sw.className = 'swatch ln';
      sw.style.borderTopColor = lineColor;
      if (dashed) sw.style.borderTopStyle = 'dashed';
      return sw;
    }
    sw.className = 'swatch';
    sw.style.background = fillColor;
    return sw;
  }

  var legendEl = document.getElementById('legend');

  function legendRow(cfg) {
    var row = document.createElement('label');
    row.className = 'legend-row';
    var chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = true;
    chk.addEventListener('change', function () {
      if (chk.checked) map.addLayer(cfg.layer); else map.removeLayer(cfg.layer);
    });
    row.appendChild(chk);
    if (cfg.sw) row.appendChild(cfg.sw);
    var nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = cfg.title;
    row.appendChild(nm);
    if (cfg.count != null) {
      var cnt = document.createElement('span');
      cnt.className = 'cnt';
      cnt.textContent = String(cfg.count);
      row.appendChild(cnt);
    }
    return row;
  }

  [
    { title: 'Водоёмы', layer: waterLayer, count: waters.length, sw: makeSwatch('#64b5f6') },
    { title: 'Реки и ручьи', layer: streamsLayer, count: (D.streams || []).length, sw: makeSwatch(null, '#3d8bd4') },
    { title: 'Объекты посёлка', layer: poiLayer, count: (D.pois || []).length, sw: makeSwatch('#9aa0a6') },
    { title: 'Подписи водоёмов', layer: waterLabels, sw: makeSwatch(null, null, false, 'Аа') }
  ].forEach(function (cfg) { legendEl.appendChild(legendRow(cfg)); });

  /* --- линейка --- */
  var hint = document.getElementById('measure-hint');
  var measure = { on: false, pts: [], line: null, dots: [], tipMarker: null, finished: false };

  function clearMeasure() {
    if (measure.line) { map.removeLayer(measure.line); measure.line = null; }
    measure.dots.forEach(function (d) { map.removeLayer(d); });
    measure.dots = [];
    if (measure.tipMarker) { map.removeLayer(measure.tipMarker); measure.tipMarker = null; }
    measure.pts = [];
    measure.finished = false;
  }

  function measureTotal() {
    var t = 0;
    for (var i = 1; i < measure.pts.length; i++) t += measure.pts[i - 1].distanceTo(measure.pts[i]);
    return t;
  }

  function updateMeasureTip() {
    if (measure.tipMarker) { map.removeLayer(measure.tipMarker); measure.tipMarker = null; }
    if (!measure.pts.length) return;
    var last = measure.pts[measure.pts.length - 1];
    measure.tipMarker = L.marker(last, {
      interactive: false,
      icon: L.divIcon({
        className: '', iconSize: null,
        html: '<span class="measure-tip">' + fmtDist(measureTotal()) + '</span>'
      })
    }).addTo(map);
  }

  function measureSet(on) {
    measure.on = on;
    map.getContainer().classList.toggle('measuring', on);
    hint.style.display = on ? 'block' : 'none';
    if (on) { map.doubleClickZoom.disable(); } else { clearMeasure(); map.doubleClickZoom.enable(); }
  }

  map.on('click', function (e) {
    if (!measure.on) return;
    if (measure.finished) clearMeasure();
    measure.pts.push(e.latlng);
    if (!measure.line) {
      measure.line = L.polyline([e.latlng], {
        color: '#111', weight: 3, dashArray: '6 4', interactive: false
      }).addTo(map);
    } else {
      measure.line.setLatLngs(measure.pts);
    }
    measure.dots.push(L.circleMarker(e.latlng, {
      radius: 4, color: '#111', weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false
    }).addTo(map));
    updateMeasureTip();
  });

  map.on('dblclick', function () {
    if (measure.on && measure.pts.length) measure.finished = true;
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') clearMeasure();
  });

  /* ряд «Линейка» в легенде */
  (function () {
    var row = document.createElement('label');
    row.className = 'legend-row';
    var chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.addEventListener('change', function () { measureSet(chk.checked); });
    row.appendChild(chk);
    var sw = document.createElement('span');
    sw.className = 'swatch txt';
    sw.textContent = '⇿';
    row.appendChild(sw);
    var nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = 'Линейка (расстояние)';
    row.appendChild(nm);
    legendEl.appendChild(row);
  })();

  /* ==================== список объектов и поиск ==================== */

  var listEl = document.getElementById('objects');
  var searchEl = document.getElementById('search');
  var currentResults = [];

  function norm(s) { return (s || '').toLowerCase().replace(/ё/g, 'е'); }

  function itemEl(it) {
    var li = document.createElement('li');
    var dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = it.color || '#9aa0a6';
    li.appendChild(dot);
    var txt = document.createElement('span');
    txt.className = 'txt';
    txt.innerHTML = esc(it.name) +
      (it.sub ? '<span class="sub">' + esc(it.sub) + '</span>' : '');
    li.appendChild(txt);
    li.addEventListener('click', function () { activate(it); });
    return li;
  }

  function renderList(q) {
    q = norm(q && q.trim());
    listEl.innerHTML = '';
    var items;
    if (!q) {
      items = searchIndex.filter(function (i) { return i.always; });
    } else {
      items = searchIndex.filter(function (i) {
        return norm(i.name + ' ' + i.sub + ' ' + (i.kw || '')).indexOf(q) !== -1;
      });
    }
    currentResults = items;
    if (!items.length) {
      var d = document.createElement('li');
      d.className = 'empty';
      d.textContent = 'Ничего не найдено';
      listEl.appendChild(d);
      return;
    }
    items.forEach(function (it) { listEl.appendChild(itemEl(it)); });
  }

  function activate(it) {
    if (it.bounds) {
      map.flyToBounds(it.bounds, { padding: [40, 40], maxZoom: 16, duration: .7 });
    } else {
      map.flyTo(it.latlng, it.zoom || 16, { duration: .7 });
    }
    if (it.open) {
      setTimeout(it.open, 780);
    } else {
      setTimeout(function () {
        var m = L.circleMarker(it.latlng, {
          radius: 9, color: '#1a73e8', weight: 2, fillColor: '#1a73e8', fillOpacity: .25
        }).bindTooltip(it.name, { permanent: true, direction: 'top' }).addTo(map);
        setTimeout(function () { map.removeLayer(m); }, 4000);
      }, 780);
    }
  }

  searchEl.addEventListener('input', function () { renderList(this.value); });
  searchEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && currentResults.length) activate(currentResults[0]);
  });
  renderList('');

  /* ==================== «показать весь посёлок» ==================== */

  document.getElementById('btn-fit').addEventListener('click', function () {
    if (townBounds.isValid()) {
      map.flyToBounds(townBounds, { padding: [30, 30], duration: .7 });
    } else {
      map.flyTo(D.center, D.zoom || 14, { duration: .7 });
    }
  });
})();
