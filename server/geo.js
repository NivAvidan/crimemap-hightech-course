// Geographic matching by codes only. Sources: CBS Israel open layers (see scripts/fetch-geo.mjs).
// Localities  -> union of 2022 statistical-area polygons sharing SEMEL_YISHUV (matched by YeshuvKod).
// Stat. areas -> 2011 division polygons (YISHUV_STA == StatisticAreaKod), fallback to 2022 division by code.
import fs from 'node:fs';
import path from 'node:path';
import { store } from './data.js';

export const geo = { ok: false, localities: null, areas: null, locInfo: new Map(), areaInfo: new Map(), coverage: null };

function bboxOf(geom, bb = [180, 90, -180, -90]) {
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < bb[0]) bb[0] = c[0];
      if (c[1] < bb[1]) bb[1] = c[1];
      if (c[0] > bb[2]) bb[2] = c[0];
      if (c[1] > bb[3]) bb[3] = c[1];
    } else c.forEach(walk);
  };
  walk(geom.coordinates);
  return bb;
}

export function loadGeo(dir) {
  try {
    const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const a22 = read('stat_areas_2022.geojson');
    const a11 = read('stat_areas_2011.geojson');
    const pts = read('localities_points.geojson');

    const dataYeshuv = store.names.yeshuv;
    const dataAreas = store.names.area;
    const areaYeshuv = new Map(); // area code -> yeshuv code as appears in the crime file
    for (const r of store.rows) if (r.StatisticAreaKod && !areaYeshuv.has(r.StatisticAreaKod)) areaYeshuv.set(r.StatisticAreaKod, r.YeshuvKod);

    const points = new Map();
    for (const f of pts.features) points.set(String(f.properties.SETL_CODE), f.geometry.coordinates);

    // ---- localities layer
    let id = 0;
    const locFeatures = [];
    for (const f of a22.features) {
      if (!f.geometry) continue;
      const y = String(f.properties.SEMEL_YISHUV);
      if (!y || y === '0' || y === 'null') continue;
      const hasData = dataYeshuv.has(y);
      locFeatures.push({ type: 'Feature', id: ++id, geometry: f.geometry, properties: { y, name: hasData ? dataYeshuv.get(y) : f.properties.SHEM_YISHUV, hasData } });
      let info = geo.locInfo.get(y);
      if (!info) geo.locInfo.set(y, (info = { code: y, bbox: [180, 90, -180, -90], hasPolygon: true }));
      bboxOf(f.geometry, info.bbox);
    }
    for (const [y, info] of geo.locInfo) {
      info.center = points.get(y) || [(info.bbox[0] + info.bbox[2]) / 2, (info.bbox[1] + info.bbox[3]) / 2];
      info.centerSource = points.has(y) ? 'נקודת יישוב – למ"ס' : 'מרכז תיבת הגבול';
    }
    // localities with a verified point but no polygon
    for (const y of dataYeshuv.keys()) {
      if (!geo.locInfo.has(y) && points.has(y)) geo.locInfo.set(y, { code: y, center: points.get(y), bbox: null, hasPolygon: false, centerSource: 'נקודת יישוב – למ"ס' });
    }
    geo.localities = { type: 'FeatureCollection', features: locFeatures };

    // ---- statistical areas layer
    const areaFeatures = [];
    const seen = new Set();
    const add = (f, code, y, division) => {
      if (!f.geometry || seen.has(code)) return;
      // verify the area belongs to the locality recorded in the crime file
      const expectY = areaYeshuv.get(code);
      if (expectY && expectY !== y) return;
      seen.add(code);
      const hasData = dataAreas.has(code);
      areaFeatures.push({ type: 'Feature', id: Number(code), geometry: f.geometry, properties: { a: code, y, name: hasData ? dataAreas.get(code) : '', division, hasData } });
      const bb = bboxOf(f.geometry);
      geo.areaInfo.set(code, { code, yeshuv: y, division, bbox: bb, center: [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2] });
    };
    for (const f of a11.features) add(f, String(f.properties.YISHUV_STA), String(f.properties.SEMEL_YISH), 2011);
    for (const f of a22.features) {
      const code = String(f.properties.YISHUV_STAT_2022);
      if (dataAreas.has(code) && !seen.has(code)) add(f, code, String(f.properties.SEMEL_YISHUV), 2022);
    }
    geo.areas = { type: 'FeatureCollection', features: areaFeatures };

    const unmappedYeshuv = [...dataYeshuv.keys()].filter((y) => !geo.locInfo.has(y));
    const unmappedAreas = [...dataAreas.keys()].filter((a) => !geo.areaInfo.has(a));
    geo.unmappedYeshuv = new Set(unmappedYeshuv);
    geo.unmappedAreas = new Set(unmappedAreas);
    geo.coverage = {
      localitiesInData: dataYeshuv.size,
      localitiesMapped: dataYeshuv.size - unmappedYeshuv.length,
      localitiesPolygon: [...dataYeshuv.keys()].filter((y) => geo.locInfo.get(y)?.hasPolygon).length,
      unmappedLocalities: unmappedYeshuv.map((c) => ({ code: c, name: dataYeshuv.get(c) })),
      areasInData: dataAreas.size,
      areasMapped: dataAreas.size - unmappedAreas.length,
      areasFallback2022: [...dataAreas.keys()].filter((a) => geo.areaInfo.get(a)?.division === 2022).length,
      unmappedAreas: unmappedAreas.map((c) => ({ code: c, name: dataAreas.get(c) })),
      sources: 'גבולות: הלשכה המרכזית לסטטיסטיקה (אזורים סטטיסטיים 2011 / 2022, נקודות יישובים)',
    };
    geo.ok = true;
  } catch (e) {
    geo.ok = false;
    console.error('Geo load failed:', e.message);
  }
}
