import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { store, loadCsv, parseFilters, applyFilters, groupBy, toCsv, DIMS, COLUMNS, NA, BadRequest, TECHNICAL_GROUPS } from './data.js';
import { geo, loadGeo } from './geo.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const isDev = process.argv.includes('--dev');
try { process.loadEnvFile(path.join(root, '.env')); } catch { /* no .env – chat disabled */ }
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

// AI agent chat – proxies the saved OpenAI agent (Agents API, beta). The key stays server-side (.env) and never reaches the browser.
const OA = 'https://api.openai.com/v1/agents/sessions';
const oaHeaders = (extra) => ({ Authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json', 'OpenAI-Beta': 'agents=v1', ...extra });
const oaError = async (r) => (await r.json().catch(() => null))?.error?.message || 'HTTP ' + r.status;
api.post('/chat', express.json({ limit: '20kb' }), async (req, res) => {
  const text = String(req.body?.message ?? '').trim().slice(0, 4000);
  const sessionId = String(req.body?.sessionId ?? '');
  if (!text) throw new BadRequest('הודעה ריקה');
  if (sessionId && !/^sess_[A-Za-z0-9]+$/.test(sessionId)) throw new BadRequest('מזהה שיחה לא תקין');
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_AGENT_ID) return res.status(503).json({ error: 'הצ׳אט אינו מוגדר: חסר OPENAI_API_KEY או OPENAI_AGENT_ID בקובץ ‎.env' });

  const input = [{ role: 'user', content: [{ type: 'input_text', text }] }];
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  const signal = AbortSignal.any([ac.signal, AbortSignal.timeout(300000)]);
  const send = (o) => res.write('data: ' + JSON.stringify(o) + '\n\n');
  try {
    let upstream;
    if (sessionId) { // follow-up turn: subscribe to the session's events first, then post the message
      upstream = await fetch(`${OA}/${sessionId}/events?stream=true`, { headers: oaHeaders({ Accept: 'text/event-stream' }), signal });
      if (upstream.ok) {
        const post = await fetch(`${OA}/${sessionId}/events`, { method: 'POST', signal, headers: oaHeaders({ 'Idempotency-Key': crypto.randomUUID() }), body: JSON.stringify({ events: [{ type: 'agent.session.input.message', input }] }) });
        if (!post.ok) { upstream.body.cancel().catch(() => {}); upstream = post; }
      }
    } else {
      upstream = await fetch(OA, { method: 'POST', signal, headers: oaHeaders(), body: JSON.stringify({ agent_id: process.env.OPENAI_AGENT_ID, environment: { type: 'none' }, stream: true, input }) });
    }
    if (!upstream.ok) return res.status(upstream.status === 404 ? 404 : 502).json({ error: 'שגיאה מהסוכן: ' + (await oaError(upstream)) });

    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
    const commentary = new Set(), streamed = new Set();
    let finished = false;
    const finish = (o) => { if (!finished) { finished = true; send(o); } };
    const handle = (ev) => {
      const t = String(ev.type || '').replace('agent.session.', '');
      if (t === 'created') send({ type: 'session', id: ev.session?.id });
      else if (t === 'turn.item.added') {
        const it = ev.item || {};
        if (it.type === 'message') { if (it.role === 'assistant' && it.phase === 'commentary') commentary.add(it.id); }
        else if (/search/.test(it.type || '')) send({ type: 'status', text: 'מחפש מידע ברשת…' });
        else if (it.type === 'reasoning') send({ type: 'status', text: 'חושב…' });
      } else if (t === 'turn.output_text.delta') {
        if (!commentary.has(ev.item_id) && ev.delta) { streamed.add(ev.item_id); send({ type: 'delta', text: ev.delta }); }
      } else if (t === 'turn.output_text.done') {
        if (!commentary.has(ev.item_id) && !streamed.has(ev.item_id) && ev.text) send({ type: 'delta', text: ev.text }); // deltas may be absent
      } else if (t === 'turn.completed') { if (!ev.turn?.subagent_id) finish({ type: 'done' }); }
      else if (t === 'turn.failed' || t === 'failed' || t === 'error') finish({ type: 'error', message: ev.turn?.error?.message || ev.error?.message || (typeof ev.session?.error === 'string' && ev.session.error) || 'הסוכן נכשל בעיבוד הבקשה' });
      else if (t === 'turn.cancelled') finish({ type: 'error', message: 'הבקשה בוטלה' });
      else if (t === 'requires_action') finish({ type: 'error', message: 'הסוכן ממתין לפעולה שאינה נתמכת בצ׳אט' });
      else if (t === 'idle') finish({ type: 'done' });
    };
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of upstream.body) {
      buf = (buf + dec.decode(chunk, { stream: true })).replace(/\r\n/g, '\n');
      for (let i; (i = buf.indexOf('\n\n')) >= 0;) {
        const data = buf.slice(0, i).split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
        buf = buf.slice(i + 2);
        if (!data) continue;
        try { handle(JSON.parse(data)); } catch { /* skip malformed event */ }
      }
      if (finished) break; // session streams stay open after the turn – stop here
    }
    finish({ type: 'error', message: 'החיבור לסוכן נותק לפני קבלת תשובה' });
    res.end();
  } catch (e) {
    if (ac.signal.aborted) return res.end(); // browser went away
    console.error('chat:', e.message);
    const message = e.name === 'TimeoutError' ? 'הסוכן לא השיב בזמן' : 'לא ניתן להתחבר לסוכן כעת';
    if (res.headersSent) { send({ type: 'error', message }); res.end(); } else res.status(502).json({ error: message });
  }
});

// "Mark a suspicious point": forwards a single value (the location) to the Make webhook. URL stays server-side (.env).
api.post('/report-point', express.json({ limit: '5kb' }), async (req, res) => {
  const location = String(req.body?.location ?? '').trim().slice(0, 300);
  if (!location) throw new BadRequest('חסר מיקום');
  if (!process.env.MAKE_WEBHOOK_URL) return res.status(503).json({ error: 'חסר MAKE_WEBHOOK_URL בקובץ ‎.env' });
  try {
    const r = await fetch(process.env.MAKE_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ city: location }), signal: AbortSignal.timeout(20000) });
    if (!r.ok) return res.status(502).json({ error: 'ה-Webhook של Make החזיר שגיאה (' + r.status + ')' });
    res.json({ ok: true });
  } catch (e) {
    console.error('webhook:', e.message);
    res.status(502).json({ error: 'לא ניתן להתחבר ל-Webhook של Make' });
  }
});

// "Recipes": sends the requested chefs to a Make webhook and returns the webhook's own response to the chat.
api.post('/recipes', express.json({ limit: '5kb' }), async (req, res) => {
  const chef = String(req.body?.chef ?? '').trim().slice(0, 300);
  if (!chef) throw new BadRequest('חסר שם שף');
  if (!process.env.MAKE_RECIPES_WEBHOOK_URL) return res.status(503).json({ error: 'חסר MAKE_RECIPES_WEBHOOK_URL בקובץ ‎.env' });
  try {
    const r = await fetch(process.env.MAKE_RECIPES_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chef }), signal: AbortSignal.timeout(180000) });
    const raw = (await r.text()).trim();
    if (!r.ok) return res.status(502).json({ error: 'ה-Webhook של Make החזיר שגיאה (' + r.status + ')' + (raw ? ': ' + raw.slice(0, 200) : '') });
    let reply = raw;
    try { const j = JSON.parse(raw); reply = typeof j === 'string' ? j : j?.reply ?? j?.text ?? j?.answer ?? j?.message ?? j?.result ?? JSON.stringify(j, null, 2); } catch { /* plain text */ }
    res.json({ reply: String(reply || 'ה-Webhook לא החזיר תוכן').slice(0, 20000) });
  } catch (e) {
    console.error('recipes webhook:', e.message);
    res.status(502).json({ error: e.name === 'TimeoutError' ? 'ה-Webhook של Make לא השיב בזמן' : 'לא ניתן להתחבר ל-Webhook של Make' });
  }
});

// Competing chat – Google AI Studio (Gemini). Stateless API: the browser sends the conversation history each turn.
const GEMINI_SYSTEM = process.env.GEMINI_SYSTEM || 'כל מה שאומרים לך אתה אומר טסט';
api.post('/chat/gemini', express.json({ limit: '200kb' }), async (req, res) => {
  const list = Array.isArray(req.body?.messages) ? req.body.messages.slice(-40) : [];
  const contents = list.map((m) => ({ role: m?.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m?.text ?? '').slice(0, 8000) }] })).filter((c) => c.parts[0].text.trim());
  while (contents.length && contents[0].role !== 'user') contents.shift();
  if (!contents.length || contents[contents.length - 1].role !== 'user') throw new BadRequest('הודעה ריקה');
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'הצ׳אט אינו מוגדר: חסר GEMINI_API_KEY בקובץ ‎.env' });

  const ac = new AbortController();
  res.on('close', () => ac.abort());
  const signal = AbortSignal.any([ac.signal, AbortSignal.timeout(120000)]);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite')}:streamGenerateContent?alt=sse`;
  const call = () => fetch(url, {
    method: 'POST', signal, headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: GEMINI_SYSTEM }] }, generationConfig: { thinkingConfig: { thinkingLevel: 'minimal' } }, contents }),
  });
  try {
    let upstream = await call();
    for (let i = 0; i < 2 && upstream.status === 503; i++) { await new Promise((r) => setTimeout(r, 1200)); upstream = await call(); }
    if (!upstream.ok) {
      const msg = upstream.status === 429 ? 'חריגה ממכסת השימוש של מפתח ה-Gemini' : upstream.status === 503 ? 'המודל עמוס כרגע, נסו שוב בעוד רגע' : await oaError(upstream);
      return res.status(502).json({ error: 'שגיאה מ-Gemini: ' + msg });
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
    const send = (o) => res.write('data: ' + JSON.stringify(o) + '\n\n');
    const dec = new TextDecoder();
    let buf = '', got = false, failed = '';
    for await (const chunk of upstream.body) {
      buf = (buf + dec.decode(chunk, { stream: true })).replace(/\r\n/g, '\n');
      for (let i; (i = buf.indexOf('\n\n')) >= 0;) {
        const data = buf.slice(0, i).split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
        buf = buf.slice(i + 2);
        if (!data) continue;
        let ev; try { ev = JSON.parse(data); } catch { continue; }
        if (ev.error) failed = ev.error.message || 'שגיאה';
        if (ev.promptFeedback?.blockReason) failed = 'הבקשה נחסמה על ידי Gemini';
        const text = (ev.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought && p.text).map((p) => p.text).join('');
        if (text) { got = true; send({ type: 'delta', text }); }
      }
    }
    send(failed ? { type: 'error', message: failed } : got ? { type: 'done' } : { type: 'error', message: 'לא התקבלה תשובה מ-Gemini' });
    res.end();
  } catch (e) {
    if (ac.signal.aborted) return res.end();
    console.error('gemini:', e.message);
    const message = e.name === 'TimeoutError' ? 'Gemini לא השיב בזמן' : 'לא ניתן להתחבר ל-Gemini כעת';
    if (res.headersSent) { res.write('data: ' + JSON.stringify({ type: 'error', message }) + '\n\n'); res.end(); } else res.status(502).json({ error: message });
  }
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

// Hosted platforms (Railway etc.) set PORT and route traffic from outside the container, so bind all interfaces there; stay loopback-only locally.
const HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
app.listen(PORT, HOST, () => {
  console.log(`מפת הפשיעה: http://localhost:${PORT}  |  רשומות: ${store.meta?.records ?? 0}  |  geo: ${geo.ok}`);
});
