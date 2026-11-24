import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import maplibregl from 'maplibre-gl';
const rtlUrl = '/rtl-text.js';
import { buildStyle, HEAT_STOPS, NODATA_COLOR, ZERO_COLOR } from './mapStyle.js';
import { LifeLayer } from './LifeLayer.js';
import { fmt } from './api.js';

export const AREA_ZOOM = 10.5;
const HOME = { center: [35.0, 31.35], zoom: 6.85, pitch: 48, bearing: -6 };
const T = ['coalesce', ['feature-state', 't'], -1];
const HEAT_COLOR = ['case', ['<', T, 0], ZERO_COLOR, ['interpolate', ['linear'], T, ...HEAT_STOPS.flat()]];
const HEAT_LAYERS = ['loc-nodata', 'loc-fill', 'loc-ext', 'area-nodata', 'area-fill'];

if (maplibregl.getRTLTextPluginStatus() === 'unavailable') maplibregl.setRTLTextPlugin(rtlUrl, false).catch((e) => console.warn('RTL plugin', e));

function bbox(geom, bb) {
  const walk = (c) => {
    if (typeof c[0] === 'number') { bb[0] = Math.min(bb[0], c[0]); bb[1] = Math.min(bb[1], c[1]); bb[2] = Math.max(bb[2], c[0]); bb[3] = Math.max(bb[3], c[1]); }
    else c.forEach(walk);
  };
  walk(geom.coordinates);
  return bb;
}
function hatch(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  g.strokeStyle = color; g.lineWidth = 1.5;
  for (const o of [-16, 0, 16]) { g.beginPath(); g.moveTo(o, 16); g.lineTo(o + 16, 0); g.stroke(); }
  return g.getImageData(0, 0, 16, 16);
}

function windowsImage(cols) {
  const N = cols >= 32 ? 256 : 128, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  g.fillStyle = '#3f5370'; g.fillRect(0, 0, N, N);
  const cw = N / cols, pad = Math.max(1, cw * 0.2);
  let seed = 7 + cols;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let r = 0; r < cols; r++) {
    g.fillStyle = '#31425a'; g.fillRect(0, r * cw, N, Math.max(1, cw * 0.08)); // floor slab line
    for (let k = 0; k < cols; k++) {
      const v = rand();
      g.fillStyle = v > 0.74 ? '#ffd98a' : v > 0.64 ? '#cfe9ff' : v > 0.3 ? '#1b2a3f' : '#26394f';
      g.fillRect(k * cw + pad, r * cw + pad * 1.2, cw - pad * 2, cw - pad * 2.2);
    }
  }
  return g.getImageData(0, 0, N, N);
}

const MapView = forwardRef(function MapView({ mapData, heatOn, heatOpacity, is3D, lifeOn, selection, onSelect, onLevel, onCamera, onLife, onGeoError, onReady }, ref) {
  const el = useRef(null);
  const tip = useRef(null);
  const S = useRef({ map: null, ready: false, loc: null, area: null, locIds: new Map(), locBox: new Map(), areaBox: new Map(), hover: null, data: null, life: null }).current;
  const props = useRef({});
  props.current = { mapData, heatOn, heatOpacity, is3D, selection, onSelect, onLevel, onCamera, onLife };

  const applyData = () => {
    const { map, ready } = S;
    const d = props.current.mapData;
    if (!ready || !d) return;
    S.data = d;
    for (const [src, fc, m, key] of [['loc', S.loc, d.locality, 'y'], ['area', S.area, d.area, 'a']]) {
      const max = m.max || 1;
      for (const f of fc.features) {
        if (!f.properties.hasData) continue;
        const c = m.counts[f.properties[key]] || 0;
        map.setFeatureState({ source: src, id: f.id }, { c, t: c ? Math.max(0.03, Math.sqrt(c / max)) : -1 });
      }
    }
  };
  const applyView = () => {
    const { map, ready } = S;
    if (!ready) return;
    const p = props.current;
    for (const id of HEAT_LAYERS) map.setLayoutProperty(id, 'visibility', p.heatOn ? 'visible' : 'none');
    if (p.heatOn) {
      map.setLayoutProperty('loc-ext', 'visibility', p.is3D ? 'visible' : 'none');
      map.setLayoutProperty('loc-fill', 'visibility', p.is3D ? 'none' : 'visible');
    }
    map.setPaintProperty('loc-ext', 'fill-extrusion-opacity', p.heatOpacity);
    map.setPaintProperty('loc-fill', 'fill-opacity', p.heatOpacity * 0.85);
    const hov = ['boolean', ['feature-state', 'hover'], false];
    map.setPaintProperty('area-fill', 'fill-opacity', ['interpolate', ['linear'], ['zoom'], 14, ['case', hov, Math.min(1, p.heatOpacity * 0.95), p.heatOpacity * 0.7], 16.5, ['case', hov, p.heatOpacity * 0.6, p.heatOpacity * 0.42]]);
    for (const id of ['bld-3d', 'bld-win32', 'bld-win16', 'bld-win8', 'bld-win4', 'bld-roof']) map.setLayoutProperty(id, 'visibility', p.is3D ? 'visible' : 'none');
    map.setLayerZoomRange('bld-flat', 12.5, p.is3D ? 14 : 24);
  };
  const applySelection = () => {
    const { map, ready } = S;
    if (!ready) return;
    const sel = props.current.selection;
    let feats = [];
    if (sel?.kind === 'yeshuv') feats = S.loc.features.filter((f) => f.properties.y === sel.code);
    if (sel?.kind === 'area') feats = S.area.features.filter((f) => f.properties.a === sel.code);
    map.getSource('sel').setData({ type: 'FeatureCollection', features: feats });
  };
  const flyToSelection = (sel, street, center) => {
    const { map } = S;
    if (!map || !sel) return;
    const bb = sel.kind === 'yeshuv' ? S.locBox.get(sel.code) : S.areaBox.get(sel.code);
    if (!bb) return false;
    if (street) {
      map.flyTo({ center: center || [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2], zoom: 18.1, pitch: 70, bearing: map.getBearing() + 25, duration: 3200, essential: true });
    } else {
      const narrow = window.innerWidth < 900;
      map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: narrow ? 40 : { top: 150, bottom: 90, left: 420, right: 400 }, pitch: props.current.is3D ? 55 : 0, bearing: props.current.is3D ? -12 : 0, maxZoom: 15.2, duration: 2200, essential: true });
    }
    return true;
  };

  useImperativeHandle(ref, () => ({
    zoomIn: () => S.map?.zoomIn(), zoomOut: () => S.map?.zoomOut(),
    north: () => S.map?.easeTo({ bearing: 0 }),
    home: () => S.map?.flyTo({ ...HOME, pitch: props.current.is3D ? HOME.pitch : 0, bearing: props.current.is3D ? HOME.bearing : 0, duration: 2000, essential: true }),
    flyToSelection,
    isMapped: (sel) => !!(sel && (sel.kind === 'yeshuv' ? S.locBox : S.areaBox).get(sel.code)),
  }));

  useEffect(() => {
    const map = new maplibregl.Map({ container: el.current, style: buildStyle(), ...HOME, minZoom: 5.5, maxZoom: 20, maxPitch: 80, antialias: true, attributionControl: { compact: true }, dragRotate: true, maxBounds: [[29, 27], [41, 36]] });
    S.map = map;
    window.__map = map;
    map.touchZoomRotate.enableRotation();
    map.keyboard.enable();

    map.on('load', async () => {
      try {
        const [loc, area] = await Promise.all(['localities', 'areas'].map((l) => fetch('/api/geo/' + l).then((r) => { if (!r.ok) throw new Error(); return r.json(); })));
        S.loc = loc; S.area = area;
      } catch {
        onGeoError?.('שכבות הגבולות הגיאוגרפיים לא נטענו – הנתונים זמינים בטבלאות בלבד');
        S.loc = { type: 'FeatureCollection', features: [] }; S.area = { type: 'FeatureCollection', features: [] };
      }
      for (const f of S.loc.features) {
        const y = f.properties.y;
        if (!S.locBox.has(y)) S.locBox.set(y, [180, 90, -180, -90]);
        bbox(f.geometry, S.locBox.get(y));
      }
      for (const f of S.area.features) S.areaBox.set(f.properties.a, bbox(f.geometry, [180, 90, -180, -90]));

      map.addImage('hatch', hatch('rgba(150,165,190,0.55)'));
      map.addSource('loc', { type: 'geojson', data: S.loc, tolerance: 0.5 });
      map.addSource('area', { type: 'geojson', data: S.area, tolerance: 0.3 });
      map.addSource('sel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      const under = 'road-service-case', labels = 'road-label';
      const has = ['==', ['get', 'hasData'], true], no = ['==', ['get', 'hasData'], false];
      map.addLayer({ id: 'loc-nodata', type: 'fill', source: 'loc', filter: no, paint: { 'fill-pattern': 'hatch', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.55, 12, 0.3, 14, 0] } }, under);
      map.addLayer({ id: 'loc-fill', type: 'fill', source: 'loc', maxzoom: AREA_ZOOM, filter: has, paint: { 'fill-color': HEAT_COLOR, 'fill-opacity': 0.8 } }, under);
      map.addLayer({ id: 'loc-hit', type: 'fill', source: 'loc', filter: has, paint: { 'fill-color': '#000', 'fill-opacity': 0 } }, under);
      map.addLayer({ id: 'area-nodata', type: 'fill', source: 'area', minzoom: AREA_ZOOM, filter: no, paint: { 'fill-pattern': 'hatch', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10.5, 0.5, 15, 0.22] } }, under);
      map.addLayer({ id: 'area-fill', type: 'fill', source: 'area', minzoom: AREA_ZOOM, filter: has, paint: { 'fill-color': HEAT_COLOR, 'fill-opacity': 0.6 } }, under);
      map.addLayer({ id: 'area-line', type: 'line', source: 'area', minzoom: AREA_ZOOM, paint: { 'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#ffffff', 'rgba(195,245,255,0.45)'], 'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.6, 0.9] } }, labels);
      map.addLayer({ id: 'loc-line', type: 'line', source: 'loc', minzoom: 8.5, maxzoom: AREA_ZOOM, filter: has, paint: { 'line-color': 'rgba(195,245,255,0.25)', 'line-width': 0.5 } }, labels);
      map.addLayer({ id: 'loc-ext', type: 'fill-extrusion', source: 'loc', maxzoom: AREA_ZOOM, filter: has,
        paint: { 'fill-extrusion-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#ffffff', HEAT_COLOR],
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 6, ['*', ['max', T, 0], 52000], AREA_ZOOM, ['*', ['max', T, 0], 5000]],
          'fill-extrusion-opacity': 0.85, 'fill-extrusion-vertical-gradient': true } }, labels);
      map.addLayer({ id: 'sel-glow', type: 'line', source: 'sel', paint: { 'line-color': '#00e5ff', 'line-width': 9, 'line-blur': 8, 'line-opacity': 0.7 } }, labels);
      map.addLayer({ id: 'sel-line', type: 'line', source: 'sel', paint: { 'line-color': '#c3f5ff', 'line-width': 2.4 } }, labels);

      // facade texture (lit / dark windows) for street-level zooms + solid roof caps
      const H = ['coalesce', ['get', 'render_height'], 6], B = ['coalesce', ['get', 'render_min_height'], 0];
      [[32, 15.5, 17], [16, 17, 18], [8, 18, 19], [4, 19, 24]].forEach(([cols, minzoom, maxzoom]) => {
        map.addImage('win' + cols, windowsImage(cols));
        map.addLayer({ id: 'bld-win' + cols, type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom, maxzoom, paint: { 'fill-extrusion-pattern': 'win' + cols, 'fill-extrusion-height': H, 'fill-extrusion-base': B, 'fill-extrusion-opacity': 1 } }, labels);
      });
      map.addLayer({ id: 'bld-roof', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 15.5,
        paint: { 'fill-extrusion-color': ['interpolate', ['linear'], H, 0, '#3d5069', 20, '#4b6485', 60, '#6283ab', 150, '#8fb5e3'], 'fill-extrusion-height': ['+', H, 0.5], 'fill-extrusion-base': H, 'fill-extrusion-vertical-gradient': false } }, labels);
      map.setLayerZoomRange('bld-3d', 13.5, 15.5);

      S.life = new LifeLayer();
      S.life.enabled = lifeOn;
      S.life.onStats = (s) => props.current.onLife?.(s);
      map.addLayer(S.life, labels);

      S.ready = true;
      applyData(); applyView(); applySelection();
      onReady?.();
    });

    // --- hover / click on crime geography
    const pickFeature = (pt) => {
      if (!S.ready) return null;
      const z = map.getZoom();
      const layers = z >= AREA_ZOOM ? ['area-fill', 'area-nodata', 'loc-hit', 'loc-nodata'] : ['loc-ext', 'loc-fill', 'loc-hit', 'loc-nodata'];
      const fs = map.queryRenderedFeatures(pt, { layers: layers.filter((l) => map.getLayer(l)) });
      if (!fs.length) return null;
      if (z >= AREA_ZOOM) return fs.find((f) => f.source === 'area' && f.properties.hasData) || fs.find((f) => f.source === 'loc' && f.properties.hasData) || fs[0];
      return fs.find((f) => f.properties.hasData) || fs[0];
    };
    const setHover = (h) => {
      const prev = S.hover;
      if (prev && (!h || prev.key !== h.key)) prev.ids.forEach((id) => map.setFeatureState({ source: prev.source, id }, { hover: false }));
      if (h && (!prev || prev.key !== h.key)) h.ids.forEach((id) => map.setFeatureState({ source: h.source, id }, { hover: true }));
      S.hover = h;
    };
    map.on('mousemove', (e) => {
      const f = pickFeature(e.point);
      const t = tip.current;
      if (!f) { setHover(null); t.style.display = 'none'; map.getCanvas().style.cursor = ''; return; }
      const p = f.properties, isArea = f.source === 'area';
      const code = isArea ? p.a : p.y;
      if (!S.locIds.size) for (const lf of S.loc.features) { if (!S.locIds.has(lf.properties.y)) S.locIds.set(lf.properties.y, []); S.locIds.get(lf.properties.y).push(lf.id); }
      setHover(p.hasData ? { key: f.source + code, source: f.source, ids: isArea ? [f.id] : S.locIds.get(code) || [] } : null);
      map.getCanvas().style.cursor = p.hasData ? 'pointer' : '';
      const d = S.data?.[isArea ? 'area' : 'locality'];
      const c = d?.counts[code] || 0;
      t.style.display = 'block';
      t.style.left = e.point.x + 14 + 'px'; t.style.top = e.point.y + 14 + 'px';
      t.innerHTML = `<div class="tip-kind">${isArea ? 'אזור סטטיסטי' : 'יישוב'} · ${code}</div><div class="tip-name">${(p.name || 'ללא שם').replace(/</g, '&lt;')}</div>` +
        (p.hasData ? `<div class="tip-val"><b>${fmt(c)}</b> רשומות${c === 0 ? ' (אפס בסינון הנוכחי)' : ''}</div>` : '<div class="tip-na">אין מידע בקובץ המקור</div>');
    });
    map.on('mouseout', () => { setHover(null); if (tip.current) tip.current.style.display = 'none'; });
    map.on('click', (e) => {
      const f = pickFeature(e.point);
      if (!f || !f.properties.hasData) return;
      const sel = f.source === 'area' ? { kind: 'area', code: f.properties.a } : { kind: 'yeshuv', code: f.properties.y };
      props.current.onSelect?.(sel, true);
    });
    const cam = () => {
      const c = map.getCenter(), z = map.getZoom();
      props.current.onLevel?.(z >= AREA_ZOOM ? 'area' : 'locality');
      props.current.onCamera?.({ lat: c.lat, lng: c.lng, zoom: z, pitch: map.getPitch(), bearing: map.getBearing() });
    };
    map.on('move', cam);
    cam();
    return () => { map.remove(); S.map = null; S.ready = false; };
  }, []);

  useEffect(applyData, [mapData]);
  useEffect(() => {
    applyView();
    const map = S.map;
    if (map && S.ready) map.easeTo({ pitch: is3D ? Math.max(map.getPitch(), 55) : 0, bearing: is3D ? map.getBearing() : 0, duration: 900 });
  }, [is3D]);
  useEffect(applyView, [heatOn, heatOpacity]);
  useEffect(applySelection, [selection]);
  useEffect(() => { S.life?.setEnabled(lifeOn); }, [lifeOn]);

  return (
    <div className="map-wrap">
      <div ref={el} className="map" />
      <div ref={tip} className="map-tip" />
    </div>
  );
});
export default MapView;
