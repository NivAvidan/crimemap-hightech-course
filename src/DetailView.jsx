import React, { useState, useMemo, useEffect } from 'react';
import { api, fmt, toQuery, NA } from './api.js';
import { Icon, BarList, QuarterBars } from './Panels.jsx';

const COL_LABELS = {
  FictiveIDNumber: 'מזהה פיקטיבי', Year: 'שנה', Quarter: 'רבעון', YeshuvKod: 'קוד יישוב', Yeshuv: 'יישוב', PoliceDistrictKod: 'קוד מחוז', PoliceDistrict: 'מחוז',
  PoliceMerhavKod: 'קוד מרחב', PoliceMerhav: 'מרחב', PoliceStationKod: 'קוד תחנה', PoliceStation: 'תחנה', municipalKod: 'קוד רשות', municipalName: 'רשות מקומית',
  StatisticAreaKod: 'קוד אזור סטט׳', StatisticArea: 'אזור סטטיסטי', StatisticGroupKod: 'קוד קבוצה', StatisticGroup: 'קבוצת עבירות', StatisticTypeKod: 'קוד סוג', StatisticType: 'סוג עבירה',
};

function SortTable({ title, rows, nameLabel, onRow, extra }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ k: 'count', d: -1 });
  const view = useMemo(() => {
    let r = q ? rows.filter((x) => x.name.includes(q) || x.code.includes(q)) : rows;
    r = [...r].sort((a, b) => sort.d * (sort.k === 'count' ? a.count - b.count : String(a[sort.k]).localeCompare(String(b[sort.k]), 'he', { numeric: true })));
    return r;
  }, [rows, q, sort]);
  const th = (k, label) => <th onClick={() => setSort({ k, d: sort.k === k ? -sort.d : k === 'count' ? -1 : 1 })}>{label}{sort.k === k && <span className="sort">{sort.d > 0 ? '▲' : '▼'}</span>}</th>;
  return (
    <section className="card">
      <div className="card-head">
        <h3>{title} <span className="dim mono">({fmt(rows.length)})</span></h3>
        <input className="dd-search sm" placeholder="חיפוש..." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr>{th('name', nameLabel)}{th('code', 'קוד')}{th('count', 'רשומות')}<th>אחוז</th>{extra && <th>{extra.label}</th>}</tr></thead>
          <tbody>
            {view.map((r) => (
              <tr key={r.code} className={onRow && r.code !== NA ? 'click' : ''} onClick={() => onRow && r.code !== NA && onRow(r)}>
                <td>{r.name}{r.technical && <em className="tech">טכני</em>}</td><td className="mono dim">{r.code === NA ? '—' : r.code}</td><td className="mono">{fmt(r.count)}</td>
                <td className="mono pct"><span className="pctbar" style={{ width: r.pct + '%' }} />{r.pct}%</td>
                {extra && <td>{extra.render(r)}</td>}
              </tr>
            ))}
            {!view.length && <tr><td colSpan="5" className="empty-sm">אין תוצאות</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Records({ filters, selection }) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ k: '', d: 'asc' });
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const base = toQuery(filters, selection);
  useEffect(() => { const t = setTimeout(() => { setQd(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(1); }, [base]);
  const qs = toQuery(filters, selection, { q: qd, sort: sort.k, dir: sort.d });
  useEffect(() => {
    const ac = new AbortController();
    setErr('');
    api(`/records?${qs}&page=${page}&pageSize=50`, ac.signal).then(setData).catch((e) => e.name !== 'AbortError' && setErr(e.message));
    return () => ac.abort();
  }, [qs, page]);
  return (
    <section className="card wide">
      <div className="card-head">
        <h3>רשומות מקובץ המקור <span className="dim mono">({fmt(data?.total)})</span></h3>
        <div className="row gap">
          <input className="dd-search sm" placeholder="חיפוש חופשי ברשומות..." value={q} onChange={(e) => setQ(e.target.value)} />
          <a className="btn primary sm" href={`/api/export?${qs}`} download><Icon n="download" />ייצוא CSV</a>
        </div>
      </div>
      {err && <div className="state error"><Icon n="error" />{err}</div>}
      <div className="table-wrap records">
        <table>
          <thead><tr>{(data?.columns || []).map((c) => (
            <th key={c} title={c} onClick={() => setSort({ k: c, d: sort.k === c && sort.d === 'asc' ? 'desc' : 'asc' })}>{COL_LABELS[c]}{sort.k === c && <span className="sort">{sort.d === 'asc' ? '▲' : '▼'}</span>}</th>
          ))}</tr></thead>
          <tbody>
            {data?.rows.map((r, i) => <tr key={i}>{data.columns.map((c) => <td key={c} className={/Kod|ID|Year|Quarter/.test(c) ? 'mono dim' : ''} title={r[c]}>{c === 'FictiveIDNumber' ? r[c].slice(0, 10) + '…' : r[c] || <span className="na">לא ידוע</span>}</td>)}</tr>)}
            {data && !data.rows.length && <tr><td colSpan="19" className="empty-sm">אין רשומות התואמות לסינון</td></tr>}
          </tbody>
        </table>
      </div>
      {data && (
        <div className="pager">
          <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><Icon n="chevron_right" />הקודם</button>
          <span className="mono">עמוד {fmt(data.page)} מתוך {fmt(data.pages)}</span>
          <button className="btn ghost sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>הבא<Icon n="chevron_left" /></button>
        </div>
      )}
    </section>
  );
}

export default function DetailView({ data, selection, filters, period, meta, onBack, onSelect, onFilterUnmapped }) {
  const scope = data?.kind === 'area' ? `אזור סטטיסטי ${data.code}` : data?.kind === 'yeshuv' ? `יישוב · קוד ${data.code}` : 'כלל הארץ';
  const title = data?.name || 'מבט ארצי – כלל הנתונים';
  const nFilters = Object.values(filters).filter((v) => v?.length).length;
  return (
    <div className="detail">
      <div className="detail-head">
        <button className="btn ghost" onClick={onBack}><Icon n="arrow_forward" />חזרה למפה</button>
        <div className="grow">
          <p className="mono dim">{scope}{data?.kind === 'area' && ` · ${data.yeshuvName}`}</p>
          <h1>{title}</h1>
        </div>
        <div className="row gap wrap">
          <span className="tag"><Icon n="calendar_today" />{period}</span>
          <span className="tag"><Icon n="filter_alt" />{nFilters ? `${nFilters} מסננים פעילים` : 'ללא סינון'}</span>
          {selection?.kind === 'area' && data?.yeshuv && <button className="btn ghost sm" onClick={() => onSelect({ kind: 'yeshuv', code: data.yeshuv })}>לרמת היישוב ({data.yeshuvName})</button>}
          {selection && <button className="btn ghost sm" onClick={() => onSelect(null)}>למבט ארצי</button>}
        </div>
      </div>
      {!data ? <div className="state big"><span className="spinner" />טוען נתונים...</div> : (
        <div className="detail-grid">
          <section className="card stats">
            <div className="stat"><span className="label">רשומות בסינון</span><span className="metric mono">{fmt(data.total)}</span></div>
            <div className="stat"><span className="label">קבוצות עבירות</span><span className="metric mono sm">{data.byGroup.length}</span></div>
            <div className="stat"><span className="label">סוגי עבירות</span><span className="metric mono sm">{data.byType.length}</span></div>
            <div className="stat"><span className="label">סיווגים טכניים (שגיאת הזנה / סעיפי הגדרה)</span><span className="metric mono sm">{fmt(data.technical)}</span></div>
            <button className="stat click" onClick={onFilterUnmapped}><span className="label">ללא יישוב / יישוב לא ממופה</span><span className="metric mono sm warn">{fmt(data.unmapped.noYeshuv)} / {fmt(data.unmapped.yeshuvNotOnMap)}</span></button>
            <div className="stat"><span className="label">ללא אזור סטטיסטי / אזור לא ממופה</span><span className="metric mono sm warn">{fmt(data.unmapped.noArea)} / {fmt(data.unmapped.areaNotOnMap)}</span></div>
          </section>
          {data.total === 0 ? <div className="state big card wide"><Icon n="filter_alt_off" />אין רשומות התואמות לסינון ולבחירה הנוכחיים</div> : (
            <>
              <section className="card">
                <div className="card-head"><h3>התפלגות לפי קבוצות עבירות</h3></div>
                <BarList rows={data.byGroup} />
              </section>
              <section className="card">
                <div className="card-head"><h3>התפלגות לפי רבעונים</h3></div>
                <QuarterBars rows={data.byQuarter} tall />
                <div className="card-head"><h3>מחוזות משטרה</h3></div>
                <BarList rows={data.byDistrict} color="var(--secondary)" />
              </section>
              <SortTable title="סוגי עבירות" nameLabel="סוג עבירה" rows={data.byType} />
              {!selection && <SortTable title="יישובים" nameLabel="יישוב" rows={data.byYeshuv} onRow={(r) => onSelect({ kind: 'yeshuv', code: r.code })} extra={{ label: 'מיפוי', render: (r) => (r.code === NA ? <span className="na">ללא יישוב</span> : r.mapped ? <span className="ok">ממופה</span> : <span className="na">לא ממופה</span>) }} />}
              {selection?.kind !== 'area' && <SortTable title="אזורים סטטיסטיים" nameLabel="אזור" rows={data.byArea} onRow={(r) => onSelect({ kind: 'area', code: r.code })} extra={{ label: 'מיפוי', render: (r) => (r.code === NA ? <span className="na">ללא אזור</span> : r.mapped ? <span className="ok">ממופה</span> : <span className="na">לא ממופה</span>) }} />}
              <SortTable title="תחנות משטרה" nameLabel="תחנה" rows={data.byStation} />
            </>
          )}
          <Records filters={filters} selection={selection} />
          <div className="source wide dim tiny">מקור נתוני הפשיעה: משטרת ישראל – קובץ {meta.sourceFile} ({period}). יחידת הספירה היא רשומה בקובץ. {meta.geo?.sources}.</div>
        </div>
      )}
    </div>
  );
}
