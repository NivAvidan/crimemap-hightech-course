import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { store, loadCsv, parseFilters, applyFilters, groupBy, toCsv, DIMS, COLUMNS, NA, BadRequest, TECHNICAL_GROUPS } from './data.js';
import { geo, loadGeo } from './geo.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const isDev = process.argv.includes('--dev');
const PORT = Number(process.env.PORT) || 5173;

loadCsv(path.join(root, 'data.csv'));
if (store.loaded) loadGeo(path.join(root, 'server', 'geo'));

const app = express();
const api = express.Router();

api.get('/health', (req, res) => {
  res.status(store.loaded ? 200 : 503).json({
    ok: store.loaded, geo: geo.ok,
    records: store.meta?.records ?? 0, columns: store.meta?.columns ?? 0, byQuarter: store.meta?.byQuarter ?? null,
    error: store.loaded ? null : 'קובץ המקור לא נטען',
  });
});
api.use((req, res, next) => (store.loaded ? next() : res.status(503).json({ error: 'קובץ המקור לא נטען. לא מוצגים נתונים.' })));

const optionList = (dim, rows, extra) => groupBy(rows, dim, extra).map(({ pct, ...o }) => o);

api.get('/metadata', (req, res) => {
  const rows = store.rows;
  const areaY = new Map(), typeG = new Map();
  for (const r of rows) {
    if (r.StatisticAreaKod && !areaY.has(r.StatisticAreaKod)) areaY.set(r.StatisticAreaKod, r.YeshuvKod);
    if (!typeG.has(r.StatisticTypeKod)) typeG.set(r.StatisticTypeKod, r.StatisticGroupKod);
  }
  const options = {};
  for (const dim of Object.keys(DIMS)) {
    options[dim] = optionList(dim, rows, dim === 'area' ? (c) => ({ parent: areaY.get(c) || '' }) : dim === 'type' ? (c) => ({ parent: typeG.get(c) || '' }) : null);
  }
  res.json({ ...store.meta, technicalGroups: [...TECHNICAL_GROUPS], options, geo: geo.coverage });
});

api.get('/localities', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  let list = optionList('yeshuv', store.rows).filter((o) => o.code !== NA);
  if (q) list = list.filter((o) => o.name.includes(q) || o.code === q);
  res.json(list.map((o) => ({ ...o, mapped: geo.locInfo.has(o.code), center: geo.locInfo.get(o.code)?.center || null, bbox: geo.locInfo.get(o.code)?.bbox || null })));
});

function summary(f) {
  const rows = applyFilters(f);
  const noYeshuv = rows.filter((r) => !r.YeshuvKod).length;
  const noArea = rows.filter((r) => !r.StatisticAreaKod).length;
  return {
    total: rows.length,
    byGroup: groupBy(rows, 'group', (c) => ({ technical: TECHNICAL_GROUPS.has(c) })),
    byType: groupBy(rows, 'type'),
    byQuarter: groupBy(rows, 'quarter').sort((a, b) => a.code.localeCompare(b.code)),
    byDistrict: groupBy(rows, 'district'),
    byStation: groupBy(rows, 'station'),
    byYeshuv: groupBy(rows, 'yeshuv', (c) => ({ mapped: geo.locInfo.has(c) })),
    byArea: groupBy(rows, 'area', (c) => ({ mapped: geo.areaInfo.has(c), yeshuv: c === NA ? '' : undefined })),
    unmapped: {
      noYeshuv, noArea,
      yeshuvNotOnMap: rows.filter((r) => r.YeshuvKod && geo.unmappedYeshuv?.has(r.YeshuvKod)).length,
      areaNotOnMap: rows.filter((r) => r.StatisticAreaKod && geo.unmappedAreas?.has(r.StatisticAreaKod)).length,
    },
    technical: rows.filter((r) => TECHNICAL_GROUPS.has(r.StatisticGroupKod)).length,
  };
}

api.get('/summary', (req, res) => res.json(summary(parseFilters(req.query))));

api.get('/map', (req, res) => {
  const level = req.query.level === 'area' ? 'area' : 'locality';
  const rows = applyFilters(parseFilters(req.query));
  const col = level === 'area' ? 'StatisticAreaKod' : 'YeshuvKod';
  const counts = {};
  let noCode = 0, notOnMap = 0;
  const info = level === 'area' ? geo.areaInfo : geo.locInfo;
  for (const r of rows) {
    const c = r[col];
    if (!c) { noCode++; continue; }
    counts[c] = (counts[c] || 0) + 1;
    if (!info.has(c)) notOnMap++;
  }
  let max = 0;
  for (const [c, n] of Object.entries(counts)) if (info.has(c) && n > max) max = n;
  res.json({ level, total: rows.length, counts, max, unmapped: { noCode, notOnMap } });
});

api.get('/localities/:code', (req, res) => {
  const code = req.params.code;
  if (!store.names.yeshuv.has(code)) return res.status(404).json({ error: 'יישוב לא נמצא בנתונים' });
  const f = parseFilters({ ...req.query, selYeshuv: code, selArea: '' });
  res.json({ kind: 'yeshuv', code, name: store.names.yeshuv.get(code), geo: geo.locInfo.get(code) || null, ...summary(f) });
});
api.get('/areas/:code', (req, res) => {
  const code = req.params.code;
  if (!store.names.area.has(code)) return res.status(404).json({ error: 'אזור סטטיסטי לא נמצא בנתונים' });
  const f = parseFilters({ ...req.query, selArea: code, selYeshuv: '' });
  const y = store.rows.find((r) => r.StatisticAreaKod === code)?.YeshuvKod || '';
  res.json({ kind: 'area', code, name: store.names.area.get(code), yeshuv: y, yeshuvName: store.names.yeshuv.get(y) || '', geo: geo.areaInfo.get(code) || null, ...summary(f) });
});

function sortedRecords(req) {
  let rows = applyFilters(parseFilters(req.query));
  const q = String(req.query.q || '').trim().slice(0, 80);
  if (q) rows = rows.filter((r) => COLUMNS.some((c) => r[c].includes(q)));
  const sort = String(req.query.sort || '');
  if (sort) {
    if (!COLUMNS.includes(sort)) throw new BadRequest('עמודת מיון לא תקינה');
    const dir = req.query.dir === 'desc' ? -1 : 1;
    rows = [...rows].sort((a, b) => dir * a[sort].localeCompare(b[sort], 'he', { numeric: true }));
  }
  return rows;
}
api.get('/records', (req, res) => {
  const rows = sortedRecords(req);
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 50));
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(pages, Math.max(1, parseInt(req.query.page, 10) || 1));
  res.json({ total: rows.length, page, pages, pageSize, columns: COLUMNS, rows: rows.slice((page - 1) * pageSize, page * pageSize) });
});
api.get('/export', (req, res) => {
  const rows = sortedRecords(req);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="crime-records-filtered.csv"');
  res.send(toCsv(rows));
});

// geographic layers (gzip once, cached in memory)
const gz = {};
api.get('/geo/:layer', (req, res) => {
  const layer = req.params.layer;
  if (!geo.ok || !['localities', 'areas'].includes(layer)) return res.status(404).json({ error: 'שכבה גיאוגרפית אינה זמינה' });
  gz[layer] ??= zlib.gzipSync(JSON.stringify(geo[layer]));
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Encoding', 'gzip');
  res.setHeader('Cache-Control', 'max-age=3600');
  res.send(gz[layer]);
});

// OSM traffic-signal nodes (decorative street layer only). Cached in memory + on disk; no API key.
const sigFile = path.join(root, 'server', 'geo', 'signals-cache.json');
let sigCache = {};
try { sigCache = JSON.parse(fs.readFileSync(sigFile, 'utf8')); } catch { /* no cache yet */ }
const sigPending = new Map();
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
async function fetchSignals(cx, cy) {
  const w = cx * 0.03, s = cy * 0.03;
  const q = `[out:json][timeout:20];node[highway=traffic_signals](${s.toFixed(3)},${w.toFixed(3)},${(s + 0.03).toFixed(3)},${(w + 0.03).toFixed(3)});out;`;
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url + '?data=' + encodeURIComponent(q), { headers: { 'User-Agent': 'crime-map-local/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      const j = await r.json();
      return j.elements.map((e) => [+e.lon.toFixed(6), +e.lat.toFixed(6)]);
    } catch { /* next mirror */ }
  }
  return null;
}
api.get('/osm/signals', async (req, res) => {
  const cx = parseInt(req.query.cx, 10), cy = parseInt(req.query.cy, 10);
  if (!(cx >= 1130 && cx <= 1200 && cy >= 970 && cy <= 1115)) return res.status(400).json({ error: 'תחום לא תקין' }); // Israel extent only
  const k = cx + ',' + cy;
  if (!sigCache[k]) {
    if (!sigPending.has(k)) sigPending.set(k, fetchSignals(cx, cy).finally(() => sigPending.delete(k)));
    const nodes = await sigPending.get(k);
    if (!nodes) return res.status(502).json({ error: 'שירות הרמזורים (OSM) אינו זמין כעת' });
    sigCache[k] = nodes;
    fs.writeFile(sigFile, JSON.stringify(sigCache), () => {});
  }
  res.json({ nodes: sigCache[k] });
});

api.use((req, res) => res.status(404).json({ error: 'נתיב לא קיים' }));
api.use((err, req, res, next) => {
  if (err instanceof BadRequest) return res.status(400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'שגיאת שרת פנימית' }); // no internal paths leaked
});
app.use('/api', api);

if (isDev) {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  const dist = path.join(root, 'dist');
  if (!fs.existsSync(dist)) console.warn('dist/ לא נמצא – הריצו "npm run build" או "npm run dev"');
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, '127.0.0.1', () => {
  console.log(`מפת הפשיעה: http://localhost:${PORT}  |  רשומות: ${store.meta?.records ?? 0}  |  geo: ${geo.ok}`);
});
