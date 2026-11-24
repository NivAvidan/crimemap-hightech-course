// CSV loader, validation, in-memory dataset, filtering & aggregation.
import fs from 'node:fs';
import iconv from 'iconv-lite';
import { parse } from 'csv-parse/sync';

export const COLUMNS = [
  'FictiveIDNumber', 'Year', 'Quarter', 'YeshuvKod', 'Yeshuv', 'PoliceDistrictKod', 'PoliceDistrict',
  'PoliceMerhavKod', 'PoliceMerhav', 'PoliceStationKod', 'PoliceStation', 'municipalKod', 'municipalName',
  'StatisticAreaKod', 'StatisticArea', 'StatisticGroupKod', 'StatisticGroup', 'StatisticTypeKod', 'StatisticType',
];

// Filter dimension -> [code column, name column]
export const DIMS = {
  year: ['Year', null],
  quarter: ['Quarter', null],
  yeshuv: ['YeshuvKod', 'Yeshuv'],
  municipal: ['municipalKod', 'municipalName'],
  district: ['PoliceDistrictKod', 'PoliceDistrict'],
  merhav: ['PoliceMerhavKod', 'PoliceMerhav'],
  station: ['PoliceStationKod', 'PoliceStation'],
  area: ['StatisticAreaKod', 'StatisticArea'],
  group: ['StatisticGroupKod', 'StatisticGroup'],
  type: ['StatisticTypeKod', 'StatisticType'],
};
export const NA = '__NA__';
// Technical classifications in the source (data-entry errors / definition clauses). Flagged, never dropped.
export const TECHNICAL_GROUPS = new Set(['-1', '1300']);

export const store = { loaded: false, error: null, rows: [], meta: null, names: {} };

export function loadCsv(file) {
  try {
    const text = iconv.decode(fs.readFileSync(file), 'win1255');
    const records = parse(text, { columns: false, skip_empty_lines: true, relax_column_count: false });
    const header = records[0].map((h) => h.trim());
    if (header.length !== COLUMNS.length || COLUMNS.some((c, i) => c !== header[i])) {
      throw new Error('כותרות הקובץ אינן תואמות את הסכמה הצפויה');
    }
    const rows = records.slice(1).map((r) => {
      const o = {};
      for (let i = 0; i < COLUMNS.length; i++) o[COLUMNS[i]] = (r[i] ?? '').trim(); // codes kept as strings; '' = missing
      return o;
    });
    store.rows = rows;
    // code -> name dictionaries (first seen name per code)
    for (const [dim, [codeCol, nameCol]] of Object.entries(DIMS)) {
      const m = new Map();
      for (const r of rows) {
        const c = r[codeCol];
        if (c && !m.has(c)) m.set(c, nameCol ? r[nameCol] || c : c);
      }
      store.names[dim] = m;
    }
    const uniq = (col) => new Set(rows.map((r) => r[col]).filter(Boolean)).size;
    const byQuarter = {};
    for (const r of rows) byQuarter[r.Quarter] = (byQuarter[r.Quarter] || 0) + 1;
    store.meta = {
      sourceFile: 'Badook-2012026154636-2025-hangashat-meyda-plili (2).csv',
      records: rows.length,
      columns: header.length,
      uniqueFictiveIds: uniq('FictiveIDNumber'),
      years: [...new Set(rows.map((r) => r.Year))].sort(),
      quarters: [...new Set(rows.map((r) => r.Quarter))].sort(),
      byQuarter,
      uniqueYeshuv: uniq('YeshuvKod'),
      uniqueAreas: uniq('StatisticAreaKod'),
      uniqueGroups: uniq('StatisticGroupKod'),
      uniqueTypes: uniq('StatisticTypeKod'),
      uniqueDistricts: uniq('PoliceDistrictKod'),
      uniqueMerhavim: uniq('PoliceMerhavKod'),
      uniqueStations: uniq('PoliceStationKod'),
      missingYeshuv: rows.filter((r) => !r.YeshuvKod).length,
      missingArea: rows.filter((r) => !r.StatisticAreaKod).length,
      technicalRecords: rows.filter((r) => TECHNICAL_GROUPS.has(r.StatisticGroupKod)).length,
    };
    store.loaded = true;
  } catch (e) {
    store.loaded = false;
    store.error = e.message;
    console.error('CSV load failed:', e.message);
  }
}

// ---- filtering -------------------------------------------------------------
export class BadRequest extends Error {}

export function parseFilters(query) {
  const f = {};
  for (const dim of Object.keys(DIMS)) {
    const raw = query[dim];
    if (raw == null || raw === '') continue;
    if (typeof raw !== 'string' || raw.length > 20000) throw new BadRequest(`פרמטר לא תקין: ${dim}`);
    const vals = raw.split(',').map((s) => s.trim()).filter(Boolean);
    for (const v of vals) {
      if (v !== NA && !store.names[dim].has(v)) throw new BadRequest(`קוד לא מוכר בפרמטר ${dim}`);
    }
    if (vals.length) f[dim] = new Set(vals);
  }
  // explicit geographic selection (scope of the detail panel) – ANDed with the filters
  for (const [p, dim] of [['selYeshuv', 'yeshuv'], ['selArea', 'area']]) {
    const v = query[p];
    if (v == null || v === '') continue;
    if (typeof v !== 'string' || (v !== NA && !store.names[dim].has(v))) throw new BadRequest(`קוד לא מוכר בפרמטר ${p}`);
    f['_' + p] = v;
  }
  return f;
}

export function applyFilters(f, skipDim) {
  const tests = [];
  for (const [dim, set] of Object.entries(f)) {
    if (dim === skipDim) continue;
    if (dim === '_selYeshuv') { tests.push((r) => (r.YeshuvKod || NA) === set); continue; }
    if (dim === '_selArea') { tests.push((r) => (r.StatisticAreaKod || NA) === set); continue; }
    const col = DIMS[dim][0];
    tests.push((r) => set.has(r[col] || NA));
  }
  if (!tests.length) return store.rows;
  return store.rows.filter((r) => tests.every((t) => t(r)));
}

export function groupBy(rows, dim, extra) {
  const [codeCol] = DIMS[dim];
  const m = new Map();
  for (const r of rows) {
    const c = r[codeCol] || NA;
    m.set(c, (m.get(c) || 0) + 1);
  }
  const total = rows.length || 1;
  const out = [...m.entries()].map(([code, count]) => ({
    code,
    name: code === NA ? 'לא ידוע' : store.names[dim].get(code) || code,
    count,
    pct: +((count / total) * 100).toFixed(2),
    ...(extra ? extra(code) : {}),
  }));
  out.sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name), 'he'));
  return out;
}

export function toCsv(rows) {
  const esc = (v) => (/[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  const lines = [COLUMNS.join(',')];
  for (const r of rows) lines.push(COLUMNS.map((c) => esc(r[c])).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n'; // BOM -> Hebrew opens correctly in Excel
}
