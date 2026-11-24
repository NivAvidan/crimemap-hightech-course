import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import MapView from './MapView.jsx';
import DetailView from './DetailView.jsx';
import { Filters, Search, Legend, Kpis, InfoPanel, Icon } from './Panels.jsx';
import { api, toQuery, fmt, NA } from './api.js';

export default function App() {
  const [meta, setMeta] = useState(null);
  const [fatal, setFatal] = useState('');
  const [filters, setFilters] = useState({});
  const [selection, setSelection] = useState(null);
  const [summary, setSummary] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailErr, setDetailErr] = useState('');
  const [mapData, setMapData] = useState(null);
  const [dataErr, setDataErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('map'); // 'map' | 'detail'
  const [filtersOpen, setFiltersOpen] = useState(() => window.innerWidth > 900);
  const [heatOn, setHeatOn] = useState(true);
  const [heatOpacity, setHeatOpacity] = useState(0.85);
  const [is3D, setIs3D] = useState(true);
  const [lifeOn, setLifeOn] = useState(true);
  const [level, setLevel] = useState('locality');
  const [cam, setCam] = useState(null);
  const [life, setLife] = useState(null);
  const [geoErr, setGeoErr] = useState('');
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef(null);

  useEffect(() => { api('/metadata').then(setMeta).catch((e) => setFatal(e.message)); }, []);

  const fq = toQuery(filters);
  useEffect(() => {
    if (!meta) return;
    const ac = new AbortController();
    setLoading(true); setDataErr('');
    Promise.all([api('/summary?' + fq, ac.signal), api('/map?level=locality&' + fq, ac.signal), api('/map?level=area&' + fq, ac.signal)])
      .then(([s, l, a]) => { setSummary(s); setMapData({ locality: l, area: a }); setLoading(false); })
      .catch((e) => { if (e.name !== 'AbortError') { setDataErr(e.message); setLoading(false); } });
    return () => ac.abort();
  }, [fq, meta]);

  useEffect(() => {
    if (!selection) { setDetail(null); setDetailErr(''); return; }
    const ac = new AbortController();
    setDetailErr('');
    api(`/${selection.kind === 'area' ? 'areas' : 'localities'}/${encodeURIComponent(selection.code)}?${fq}`, ac.signal)
      .then(setDetail).catch((e) => e.name !== 'AbortError' && (setDetail(null), setDetailErr(e.message)));
    return () => ac.abort();
  }, [selection, fq]);

  const select = useCallback((sel, fromMap) => {
    setDetail((d) => (sel && d && d.code === sel.code ? d : null));
    setSelection(sel);
    if (sel && !fromMap) setTimeout(() => mapRef.current?.flyToSelection(sel), 50);
  }, []);

  const period = meta ? `${meta.years.join('–')} · ${filters.quarter?.length ? [...filters.quarter].sort().join(', ') : `${meta.quarters[0]}–${meta.quarters[meta.quarters.length - 1]}`}` : '';
  const kpiData = selection ? detail : summary;
  const scopeLabel = selection ? detail?.name || '...' : 'ארצי';
  const mapped = !!selection && mapReady && mapRef.current?.isMapped(selection);
  const filterUnmapped = () => { setFilters({ ...filters, yeshuv: [NA] }); setSelection(null); setView('detail'); };

  if (fatal) return <div className="fatal"><Icon n="error" /><h1>מקור הנתונים לא נטען</h1><p>{fatal}</p><p className="dim">לא מוצגים נתונים חלופיים. ודאו שהשרת פועל ושקובץ ה-CSV קיים.</p></div>;
  if (!meta) return <div className="fatal"><span className="spinner big" /><p>טוען את מערכת מפת הפשיעה...</p></div>;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo"><Icon n="shield" /></div>
          <div>
            <div className="title">מפת הפשיעה בישראל</div>
            <div className="subtitle">מערכת חקירה גיאוגרפית · נתוני משטרת ישראל</div>
          </div>
        </div>
        <nav className="tabs">
          <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}><Icon n="public" />מפה</button>
          <button className={view === 'detail' ? 'on' : ''} onClick={() => setView('detail')}><Icon n="table_chart" />נתונים ורשומות</button>
        </nav>
        <div className="top-actions">
          <Search options={meta.options.yeshuv} onPick={(o) => { setView('map'); select({ kind: 'yeshuv', code: o.code }); }} />
          <div className="tag period" title="תקופת הנתונים בקובץ המקור"><Icon n="calendar_today" /><span className="mono">{period}</span></div>
          <div className="tag hide-sm" title={meta.sourceFile}><span className="pulse" /><span>קובץ מקור קבוע · {fmt(meta.records)} רשומות</span></div>
        </div>
      </header>

      <main className="stage">
        <MapView ref={mapRef} mapData={mapData} heatOn={heatOn} heatOpacity={heatOpacity} is3D={is3D} lifeOn={lifeOn} selection={selection}
          onSelect={select} onLevel={setLevel} onCamera={setCam} onLife={setLife} onGeoError={setGeoErr} onReady={() => setMapReady(true)} />

        <div className={'hud' + (view === 'detail' ? ' hidden' : '')}>
          <div className="hud-top">
            <Kpis data={kpiData} scopeLabel={scopeLabel} period={period} onUnmapped={filterUnmapped} />
            {(dataErr || geoErr) && <div className="state error banner"><Icon n="error" />{dataErr || geoErr}</div>}
          </div>

          {filtersOpen ? (
            <Filters meta={meta} filters={filters} setFilters={setFilters} onReset={() => setFilters({})} onClose={() => setFiltersOpen(false)}
              heatOn={heatOn} setHeatOn={setHeatOn} heatOpacity={heatOpacity} setHeatOpacity={setHeatOpacity} lifeOn={lifeOn} setLifeOn={setLifeOn} />
          ) : (
            <button className="panel fab filters-fab" onClick={() => setFiltersOpen(true)}><Icon n="tune" />פילטרים{Object.values(filters).some((v) => v?.length) && <span className="badge">{Object.values(filters).filter((v) => v?.length).length}</span>}</button>
          )}

          {selection && (
            <InfoPanel detail={detail} loading={!detail && !detailErr} error={detailErr} period={period} mapped={mapped}
              onClose={() => select(null)} onExpand={() => setView('detail')} onFly={() => mapRef.current?.flyToSelection(selection)}
              onStreet={() => mapRef.current?.flyToSelection(selection, true, selection.kind === 'yeshuv' ? detail?.geo?.center : null)} onPickArea={(code) => select({ kind: 'area', code })} />
          )}

          <div className="hud-bottom-start">
            {heatOn && <Legend level={level} max={mapData?.[level]?.max || 0} />}
          </div>

          <div className="hud-bottom-end">
            <div className="panel controls">
              <button title="איפוס לצפון" onClick={() => mapRef.current?.north()}><Icon n="explore" className="compass" /><i style={{ transform: `rotate(${-(cam?.bearing || 0)}deg)` }} /></button>
              <button className={'txt' + (is3D ? ' on' : '')} title="תצוגת תלת־ממד" onClick={() => setIs3D(true)}>3D</button>
              <button className={'txt' + (!is3D ? ' on' : '')} title="תצוגת דו־ממד" onClick={() => setIs3D(false)}>2D</button>
            </div>
            <div className="panel controls">
              <button title="התקרבות" onClick={() => mapRef.current?.zoomIn()}><Icon n="add" /></button>
              <button title="התרחקות" onClick={() => mapRef.current?.zoomOut()}><Icon n="remove" /></button>
              <button title="חזרה למבט ארצי" onClick={() => mapRef.current?.home()}><Icon n="crop_free" /></button>
            </div>
            {cam && (
              <div className="telemetry mono">
                <div dir="ltr">{cam.lat.toFixed(4)}° N, {cam.lng.toFixed(4)}° E · Z{cam.zoom.toFixed(1)}</div>
                <div>הטיה {Math.round(cam.pitch)}° · כיוון {Math.round((cam.bearing + 360) % 360)}° · רמה: {level === 'area' ? 'אזורים סטטיסטיים' : 'יישובים'}</div>
                {lifeOn && <div className="life">{life?.active ? `רחוב חי: ${life.peds} הולכי רגל · ${life.cars} רכבים · ${life.lights} רמזורים${life.estimated && life.lights ? ' (בצמתים ראשיים)' : ''}` : 'רחוב חי: התקרבו לרמת רחוב (זום 15+)'}</div>}
              </div>
            )}
          </div>
          {loading && <div className="loading-pill"><span className="spinner" />מעדכן נתונים...</div>}
        </div>

        {view === 'detail' && (
          <DetailView data={selection ? detail : summary} selection={selection} filters={filters} period={period} meta={meta}
            onBack={() => setView('map')} onSelect={(s) => select(s)} onFilterUnmapped={filterUnmapped} />
        )}
      </main>
    </div>
  );
}
