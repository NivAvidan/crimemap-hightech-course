export const NA = '__NA__';
export const DIM_LABELS = {
  year: 'שנה', quarter: 'רבעון', yeshuv: 'יישוב', municipal: 'רשות מקומית', district: 'מחוז משטרתי',
  merhav: 'מרחב משטרתי', station: 'תחנת משטרה', area: 'אזור סטטיסטי', group: 'קבוצת עבירות', type: 'סוג עבירה',
};
export function toQuery(filters, selection, extra = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v?.length) p.set(k, v.join(','));
  if (selection?.kind === 'yeshuv') p.set('selYeshuv', selection.code);
  if (selection?.kind === 'area') p.set('selArea', selection.code);
  for (const [k, v] of Object.entries(extra)) if (v !== '' && v != null) p.set(k, v);
  return p.toString();
}
export async function api(path, signal) {
  const r = await fetch('/api' + path, { signal });
  let body = null;
  try { body = await r.json(); } catch { /* non-json */ }
  if (!r.ok) throw new Error(body?.error || 'שגיאת תקשורת עם השרת');
  return body;
}
export const fmt = (n) => (n ?? 0).toLocaleString('he-IL');
