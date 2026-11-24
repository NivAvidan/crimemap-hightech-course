// Downloads open geographic layers (CBS Israel, public ArcGIS services, no API key) into server/geo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'geo');
const BASE = 'https://services2.arcgis.com/xMRYm7cNgdR5RN6F/arcgis/rest/services';
async function fetchAll(service, params) {
  const feats = [];
  for (let offset = 0; ; ) {
    const q = new URLSearchParams({ where: '1=1', outFields: '*', outSR: '4326', f: 'geojson', resultOffset: String(offset), resultRecordCount: '1000', orderByFields: 'OBJECTID', ...params });
    const r = await fetch(`${BASE}/${service}/FeatureServer/0/query?${q}`);
    if (!r.ok) throw new Error(service + ' HTTP ' + r.status);
    const j = await r.json();
    if (j.error) throw new Error(JSON.stringify(j.error));
    feats.push(...j.features);
    console.log(service, feats.length);
    if (!j.features.length || !(j.exceededTransferLimit || j.properties?.exceededTransferLimit)) break;
    offset += j.features.length;
  }
  return { type: 'FeatureCollection', features: feats };
}
const areas = await fetchAll('Statistical__Areas_2022', { maxAllowableOffset: '0.00015', geometryPrecision: '5', outFields: 'SEMEL_YISHUV,SHEM_YISHUV,STAT_2022,YISHUV_STAT_2022' });
fs.writeFileSync(path.join(out, 'stat_areas_2022.geojson'), JSON.stringify(areas));
const pts = await fetchAll('Setl_Point', { geometryPrecision: '5' });
fs.writeFileSync(path.join(out, 'localities_points.geojson'), JSON.stringify(pts));
// 2011 statistical-area division (CBS socio-economic layer) – used for codes that follow the 2011 division.
async function fetchLayer(service, layer, params, file) {
  const feats = [];
  for (let offset = 0; ; ) {
    const q = new URLSearchParams({ where: '1=1', outSR: '4326', f: 'geojson', resultOffset: String(offset), resultRecordCount: '500', orderByFields: 'OBJECTID', ...params });
    const j = await (await fetch(`${BASE}/${service}/FeatureServer/${layer}/query?${q}`)).json();
    if (j.error) throw new Error(JSON.stringify(j.error));
    feats.push(...j.features);
    console.log(service, feats.length);
    if (j.features.length < 500) break;
    offset += j.features.length;
  }
  fs.writeFileSync(path.join(out, file), JSON.stringify({ type: 'FeatureCollection', features: feats }));
}
await fetchLayer('SOEC_Stat11_2021', 27, { maxAllowableOffset: '0.00015', geometryPrecision: '5', outFields: 'SEMEL_YISH,STAT11,YISHUV_STA,SHEM_YISHU' }, 'stat_areas_2011.geojson');
