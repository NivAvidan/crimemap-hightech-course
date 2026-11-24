import React, { useState, useMemo, useRef, useEffect } from 'react';
import { DIM_LABELS, fmt, NA } from './api.js';
import { HEAT_STOPS, NODATA_COLOR, ZERO_COLOR } from './mapStyle.js';

export const Icon = ({ n, className = '' }) => <span className={'material-symbols-outlined ' + className}>{n}</span>;

function useOutside(ref, fn) {
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) fn(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [fn]);
}

export function MultiSelect({ label, options, value, onChange, placeholder = 'הכל' }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useOutside(ref, () => setOpen(false));
  const set = new Set(value);
  const shown = useMemo(() => {
    const f = q ? options.filter((o) => o.name.includes(q) || o.code.includes(q)) : options;
    return f.slice(0, 250);
  }, [options, q]);
  const names = value.map((v) => options.find((o) => o.code === v)?.name || v);
  const toggle = (c) => onChange(set.has(c) ? value.filter((v) => v !== c) : [...value, c]);
  return (
    <div className="field" ref={ref}>
      <label>{label}</label>
      <button type="button" className={'select-btn' + (value.length ? ' active' : '')} onClick={() => setOpen(!open)}>
        <span className="select-text">{value.length ? (value.length === 1 ? names[0] : `${value.length} נבחרו`) : placeholder}</span>
        {value.length > 0 && <span className="clear-x" onClick={(e) => { e.stopPropagation(); onChange([]); }}>✕</span>}
        <Icon n="expand_more" />
      </button>
      {open && (
        <div className="dropdown">
          {options.length > 8 && <input autoFocus className="dd-search" placeholder="חיפוש..." value={q} onChange={(e) => setQ(e.target.value)} />}
          <div className="dd-list">
            {shown.map((o) => (
              <label key={o.code} className="dd-item">
                <input type="checkbox" checked={set.has(o.code)} onChange={() => toggle(o.code)} />
                <span className="dd-name">{o.name}</span>
                <span className="mono dd-count">{fmt(o.count)}</span>
              </label>
            ))}
            {!shown.length && <div className="empty-sm">אין תוצאות</div>}
            {options.length > shown.length && !q && <div className="empty-sm">מוצגות {shown.length} מתוך {fmt(options.length)} – השתמשו בחיפוש</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export function Filters({ meta, filters, setFilters, onReset, onClose, heatOn, setHeatOn, heatOpacity, setHeatOpacity, lifeOn, setLifeOn }) {
  const o = meta.options;
  const areaOpts = useMemo(() => (filters.yeshuv?.length ? o.area.filter((a) => filters.yeshuv.includes(a.parent || NA) || (a.code === NA)) : o.area), [o, filters.yeshuv]);
  const typeOpts = useMemo(() => (filters.group?.length ? o.type.filter((t) => filters.group.includes(t.parent)) : o.type), [o, filters.group]);
  const set = (dim, v) => {
    const next = { ...filters, [dim]: v };
    if (dim === 'yeshuv' && v.length && next.area?.length) next.area = next.area.filter((a) => a === NA || v.includes(o.area.find((x) => x.code === a)?.parent));
    if (dim === 'group' && v.length && next.type?.length) next.type = next.type.filter((t) => v.includes(o.type.find((x) => x.code === t)?.parent));
    setFilters(next);
  };
  const active = Object.values(filters).reduce((a, v) => a + (v?.length ? 1 : 0), 0);
  const ms = (dim, opts = o[dim]) => <MultiSelect label={DIM_LABELS[dim]} options={opts} value={filters[dim] || []} onChange={(v) => set(dim, v)} />;
  return (
    <aside className="panel filters">
      <div className="panel-head">
        <div className="row gap">
          <div className="icon-chip"><Icon n="tune" /></div>
          <div>
            <h2>מסנני חקירה ופילוח</h2>
            <p className="mono dim">{active ? `${active} מסננים פעילים` : 'ללא סינון – כלל הנתונים'}</p>
          </div>
        </div>
        <button className="icon-btn" title="סגירת פאנל" onClick={onClose}><Icon n="chevron_right" /></button>
      </div>
      <div className="panel-body">
        <div className="field">
          <label>רבעון ({meta.years.join(', ')})</label>
          <div className="chips">
            {o.quarter.slice().sort((a, b) => a.code.localeCompare(b.code)).map((q) => {
              const on = filters.quarter?.includes(q.code);
              return <button key={q.code} className={'chip' + (on ? ' on' : '')} onClick={() => set('quarter', on ? filters.quarter.filter((x) => x !== q.code) : [...(filters.quarter || []), q.code])}>{q.code}</button>;
            })}
          </div>
        </div>
        {o.year.length > 1 && ms('year')}
        {ms('group')}
        {ms('type', typeOpts)}
        {ms('yeshuv')}
        {ms('area', areaOpts)}
        {ms('municipal')}
        {ms('district')}
        <div className="grid2">{ms('merhav')}{ms('station')}</div>

        <div className="layers">
          <span className="section-label">שכבות מפה</span>
          <label className="layer-row">
            <span className="row gap"><span className="dot heat" />שכבת מפת חום (כמות רשומות)</span>
            <input type="checkbox" checked={heatOn} onChange={(e) => setHeatOn(e.target.checked)} />
          </label>
          <label className="layer-row col">
            <span className="row between"><span>שקיפות מפת החום</span><span className="mono">{Math.round(heatOpacity * 100)}%</span></span>
            <input type="range" min="0.15" max="1" step="0.05" value={heatOpacity} disabled={!heatOn} onChange={(e) => setHeatOpacity(+e.target.value)} />
          </label>
          <label className="layer-row">
            <span className="row gap"><span className="dot life" />רחוב חי – הולכי רגל, רכבים ורמזורים</span>
            <input type="checkbox" checked={lifeOn} onChange={(e) => setLifeOn(e.target.checked)} />
          </label>
        </div>
      </div>
      <div className="panel-foot">
        <button className="btn ghost" disabled={!active} onClick={onReset}><Icon n="restart_alt" />איפוס פילטרים</button>
      </div>
    </aside>
  );
}

export function Search({ options, onPick }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useOutside(ref, () => setOpen(false));
  const res = useMemo(() => (q.trim() ? options.filter((o) => o.code !== NA && (o.name.includes(q.trim()) || o.code === q.trim())).slice(0, 12) : []), [q, options]);
  return (
    <div className="search" ref={ref}>
      <Icon n="search" />
      <input placeholder="חיפוש יישוב..." value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && res[0]) { onPick(res[0]); setOpen(false); setQ(''); } }} />
      {open && q.trim() && (
        <div className="dropdown search-dd">
          {res.map((o) => (
            <button key={o.code} className="dd-item" onClick={() => { onPick(o); setOpen(false); setQ(''); }}>
              <span className="dd-name">{o.name}</span><span className="mono dd-count">קוד {o.code} · {fmt(o.count)}</span>
            </button>
          ))}
          {!res.length && <div className="empty-sm">לא נמצא יישוב בנתונים</div>}
        </div>
      )}
    </div>
  );
}

export function Legend({ level, max }) {
  const ticks = [0.25, 0.5, 0.75, 1].map((t) => Math.max(1, Math.round(t * t * (max || 1))));
  const grad = `linear-gradient(to left, ${HEAT_STOPS.map(([t, c]) => `${c} ${t * 100}%`).join(', ')})`;
  return (
    <div className="panel legend">
      <div className="row between">
        <span className="label">מספר רשומות לפי {level === 'area' ? 'אזור סטטיסטי' : 'יישוב'}</span>
        <span className="mono dim">סולם √ · מקס׳ {fmt(max)}</span>
      </div>
      <div className="legend-bar" style={{ background: grad }} />
      <div className="legend-ticks mono"><span>1</span>{ticks.map((t, i) => <span key={i}>{fmt(t)}</span>)}</div>
      <div className="legend-keys">
        <span><i style={{ background: ZERO_COLOR }} />0 רשומות בסינון</span>
        <span><i className="hatch" style={{ borderColor: NODATA_COLOR }} />אין מידע במקור</span>
      </div>
      <div className="dim tiny">כמות רשומות בלבד – אינו מדד בטיחות או שיעור פשיעה באוכלוסייה</div>
    </div>
  );
}

export function Kpis({ data, scopeLabel, period, onUnmapped }) {
  if (!data) return <div className="kpis"><div className="kpi skeleton" /><div className="kpi skeleton" /><div className="kpi skeleton" /></div>;
  const groups = data.byGroup.filter((g) => !g.technical).slice(0, 3);
  const colors = ['var(--secondary)', 'var(--primary-c)', 'var(--error)'];
  const un = data.unmapped;
  return (
    <div className="kpis">
      <div className="kpi main">
        <div className="row between"><span className="label">סה״כ רשומות · {scopeLabel}</span><span className="tag mono">{period}</span></div>
        <div className="metric mono">{fmt(data.total)}</div>
        <div className="row between dim tiny"><span>לפי הפילטרים הפעילים</span>{data.technical > 0 && <span title="שגיאת הזנה / סעיפי הגדרה – מסומנים ונספרים">מתוכן {fmt(data.technical)} סיווג טכני</span>}</div>
      </div>
      {groups.map((g, i) => (
        <div className="kpi" key={g.code}>
          <div className="label ellipsis">{g.name}</div>
          <div className="row between base"><span className="metric mono sm" style={{ color: colors[i] }}>{fmt(g.count)}</span><span className="mono dim">{g.pct}%</span></div>
          <div className="bar"><div style={{ width: g.pct + '%', background: colors[i] }} /></div>
        </div>
      ))}
      <button className="kpi warn" onClick={onUnmapped} title="רשומות שאינן מוצגות על המפה – זמינות בטבלאות">
        <div className="label">רשומות ללא מיפוי</div>
        <div className="row between base"><span className="metric mono sm">{fmt(un.noYeshuv + un.yeshuvNotOnMap)}</span><span className="mono dim">ללא יישוב</span></div>
        <div className="dim tiny">ללא אזור סטטיסטי ממופה: {fmt(un.noArea + un.areaNotOnMap)}</div>
      </button>
    </div>
  );
}

export function InfoPanel({ detail, loading, error, period, mapped, onClose, onExpand, onStreet, onFly, onPickArea }) {
  return (
    <aside className="panel info">
      <div className="accent" />
      <div className="panel-head">
        <div>
          <p className="mono dim">{detail ? (detail.kind === 'area' ? `אזור סטטיסטי · ${detail.code}` : `יישוב · קוד ${detail.code}`) : 'טוען...'}</p>
          <h2>{detail?.name || '—'}</h2>
          {detail?.kind === 'area' && <p className="dim">{detail.yeshuvName} · {period}</p>}
          {detail?.kind === 'yeshuv' && <p className="dim">{period}</p>}
        </div>
        <button className="icon-btn" onClick={onClose} title="ביטול בחירה"><Icon n="close" /></button>
      </div>
      <div className="panel-body">
        {error && <div className="state error"><Icon n="error" />{error}</div>}
        {loading && !detail && <div className="state"><span className="spinner" />טוען נתונים...</div>}
        {detail && (
          <>
            {!mapped && <div className="note warn"><Icon n="location_off" />אין גיאומטריה למיקום זה – הנתונים מוצגים בטבלה בלבד</div>}
            {detail.kind === 'area' && detail.geo?.division === 2022 && <div className="note"><Icon n="info" />גבול לפי חלוקת אזורים 2022 (התאמת קוד) – דיוק הגבול מוגבל</div>}
            <div className="grid2">
              <div className="stat"><span className="label">רשומות בסינון</span><span className="metric mono sm">{fmt(detail.total)}</span></div>
              <div className="stat"><span className="label">קבוצה מובילה</span><span className="lead ellipsis">{detail.byGroup[0] ? `${detail.byGroup[0].name} (${detail.byGroup[0].pct}%)` : '—'}</span></div>
            </div>
            {detail.total === 0 ? <div className="state"><Icon n="filter_alt_off" />אין רשומות התואמות לסינון הנוכחי</div> : (
              <>
                <span className="section-label">התפלגות לפי קבוצות עבירות</span>
                <BarList rows={detail.byGroup.slice(0, 6)} />
                <span className="section-label">רבעונים</span>
                <QuarterBars rows={detail.byQuarter} />
                {detail.kind === 'yeshuv' && detail.byArea.length > 0 && (
                  <>
                    <span className="section-label">אזורים סטטיסטיים מובילים</span>
                    <BarList rows={detail.byArea.slice(0, 5)} onClick={(r) => r.code !== NA && onPickArea(r.code)} color="var(--secondary)" />
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
      <div className="panel-foot col">
        <button className="btn primary" onClick={onExpand}><span>תצוגה מורחבת, רשומות וייצוא</span><Icon n="arrow_back" /></button>
        <div className="row gap">
          <button className="btn ghost grow" disabled={!mapped} onClick={onFly}><Icon n="center_focus_strong" />התמקדות</button>
          <button className="btn ghost grow" disabled={!mapped} onClick={onStreet}><Icon n="view_in_ar" />רמת רחוב 3D</button>
        </div>
      </div>
    </aside>
  );
}

export function BarList({ rows, onClick, color = 'var(--primary-c)' }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="barlist">
      {rows.map((r) => (
        <div key={r.code} className={'barrow' + (onClick ? ' click' : '')} onClick={() => onClick?.(r)}>
          <div className="row between"><span className="ellipsis">{r.name}{r.technical && <em className="tech">טכני</em>}</span><span className="mono">{fmt(r.count)} <span className="dim">· {r.pct}%</span></span></div>
          <div className="bar"><div style={{ width: (r.count / max) * 100 + '%', background: r.technical ? 'var(--outline)' : color }} /></div>
        </div>
      ))}
    </div>
  );
}

export function QuarterBars({ rows, tall }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className={'qbars' + (tall ? ' tall' : '')}>
      {rows.map((r) => (
        <div key={r.code} className="qbar">
          <span className="mono qv">{fmt(r.count)}</span>
          <div className="qcol"><div style={{ height: (r.count / max) * 100 + '%' }} /></div>
          <span className="mono dim">{r.code}</span>
        </div>
      ))}
    </div>
  );
}
