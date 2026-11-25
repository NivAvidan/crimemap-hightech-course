import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Panels.jsx';

const SUGGESTIONS = ['מה המגמות האחרונות בפשיעה בישראל?', 'אילו סוגי עבירות נפוצים ביותר?', 'איך קוראים את נתוני המשטרה?'];
const AGENTS = [
  { id: 'openai', store: 'crime-map-chat-v1', endpoint: '/api/chat', icon: 'smart_toy', fabIcon: 'forum', label: 'OpenAI',
    title: 'סוכן חוקר נתוני פשיעה', subtitle: 'OpenAI · חיפוש חי ברשת', hello: 'שאלו אותי על נתוני הפשיעה של משטרת ישראל.' },
  { id: 'gemini', store: 'crime-map-chat-gemini-v1', endpoint: '/api/chat/gemini', icon: 'auto_awesome', fabIcon: 'auto_awesome', label: 'Gemini', stateless: true,
    title: 'סוכן Gemini', subtitle: 'Google AI Studio · Gemini', hello: 'הסוכן המתחרה, מבוסס Google Gemini. שאלו אותו את אותה שאלה והשוו.' },
];
const load = (key) => { try { return JSON.parse(sessionStorage.getItem(key)) || {}; } catch { return {}; } };

// Minimal, safe markdown: renders React nodes only (no raw HTML).
function inline(text, k) {
  const out = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?])/g;
  let last = 0, m, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = k + '-' + i++;
    if (m[1]) out.push(<strong key={key}>{m[1]}</strong>);
    else if (m[2]) out.push(<code key={key}>{m[2]}</code>);
    else out.push(<a key={key} href={m[4] || m[5]} target="_blank" rel="noopener noreferrer">{m[3] || new URL(m[5]).hostname.replace(/^www\./, '')}</a>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
function Markdown({ text }) {
  const blocks = [];
  let list = null;
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    const li = line.match(/^([-*•]|\d+[.)])\s+(.*)$/);
    if (li) {
      const ordered = /\d/.test(li[1]);
      if (!list || list.ordered !== ordered) { list = { ordered, items: [], key: i }; blocks.push(list); }
      list.items.push(<li key={i}>{inline(li[2], i)}</li>);
      return;
    }
    list = null;
    if (!line) return;
    const h = line.match(/^#{1,6}\s+(.*)$/);
    blocks.push(h ? <h4 key={i}>{inline(h[1], i)}</h4> : <p key={i}>{inline(line, i)}</p>);
  });
  return blocks.map((b) => (b.items ? (b.ordered ? <ol key={b.key}>{b.items}</ol> : <ul key={b.key}>{b.items}</ul>) : b));
}

function ChatPanel({ cfg, open, onClose }) {
  const saved = useRef(load(cfg.store)).current;
  const [messages, setMessages] = useState(saved.messages || []);
  const [sessionId, setSessionId] = useState(saved.sessionId || '');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [mode, setMode] = useState('chat'); // 'chat' | 'point'
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const acRef = useRef(null);

  useEffect(() => { try { sessionStorage.setItem(cfg.store, JSON.stringify({ messages, sessionId })); } catch { /* storage unavailable */ } }, [messages, sessionId]);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, status, open]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => () => acRef.current?.abort(), []);

  const patchLast = (fn) => setMessages((ms) => ms.map((m, i) => (i === ms.length - 1 ? fn(m) : m)));

  const startPoint = () => {
    if (busy || mode === 'point') return;
    setMode('point');
    setMessages((ms) => [...ms, { role: 'assistant', text: 'מה המיקום של הנקודה?', local: true }]);
    inputRef.current?.focus();
  };
  const startRecipes = () => {
    if (busy || mode === 'recipes') return;
    setMode('recipes');
    setMessages((ms) => [...ms, { role: 'assistant', text: 'מתכונים של איזה שפים אתה רוצה?', local: true }]);
    inputRef.current?.focus();
  };
  // "recipes": the answer goes to the Make webhook and the webhook's response comes back into the chat
  async function sendRecipes(chef) {
    setMessages((ms) => [...ms, { role: 'user', text: chef, local: true }, { role: 'assistant', text: '', local: true }]);
    setInput(''); setBusy(true); setStatus('מחפש מתכונים…');
    try {
      const r = await fetch('/api/recipes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chef }) });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || 'שגיאת תקשורת עם השרת');
      patchLast((m) => ({ ...m, text: j.reply }));
      setMode('chat');
    } catch (e) {
      patchLast((m) => ({ ...m, error: e.message + ' – אפשר לנסות שוב.' }));
    } finally { setBusy(false); setStatus(''); }
  }
  const startChat = () => { if (!busy) { setMode('chat'); inputRef.current?.focus(); } };

  // "mark a suspicious point": exactly one value (the location) goes to the Make webhook via the server
  async function sendPoint(location) {
    setMessages((ms) => [...ms, { role: 'user', text: location, local: true }, { role: 'assistant', text: '', local: true }]);
    setInput(''); setBusy(true); setStatus('שולח את הנקודה…');
    try {
      const r = await fetch('/api/report-point', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location }) });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || 'שגיאת תקשורת עם השרת');
      patchLast((m) => ({ ...m, text: `הנקודה החשודה **${location}** סומנה ונשלחה בהצלחה ✅` }));
      setMode('chat');
    } catch (e) {
      patchLast((m) => ({ ...m, error: e.message + ' – אפשר לנסות לשלוח שוב את המיקום.' }));
    } finally { setBusy(false); setStatus(''); }
  }

  async function sendMessage(text, sid = sessionId, retried = false) {
    text = text.trim();
    if (text && !busy && mode === 'point' && !retried) return sendPoint(text.slice(0, 300));
    if (text && !busy && mode === 'recipes' && !retried) return sendRecipes(text.slice(0, 300));
    if (!text || (busy && !retried)) return;
    if (!retried) { setMessages((ms) => [...ms, { role: 'user', text }, { role: 'assistant', text: '' }]); setInput(''); }
    setBusy(true); setStatus('מתחבר לסוכן…');
    const body = cfg.stateless
      ? { messages: [...messages.filter((m) => m.text && !m.error && !m.local).map(({ role, text: t }) => ({ role, text: t })), { role: 'user', text }] }
      : { message: text, sessionId: sid || undefined };
    const ac = (acRef.current = new AbortController());
    let done = false;
    try {
      const r = await fetch(cfg.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal });
      if (!r.ok) {
        if (r.status === 404 && sid && !retried) { setSessionId(''); return await sendMessage(text, '', true); } // session expired – start a fresh one
        throw new Error((await r.json().catch(() => null))?.error || 'שגיאת תקשורת עם השרת');
      }
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done: eof } = await reader.read();
        if (eof) break;
        buf += dec.decode(value, { stream: true });
        for (let i; (i = buf.indexOf('\n\n')) >= 0;) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          if (!line.startsWith('data:')) continue;
          const ev = JSON.parse(line.slice(5));
          if (ev.type === 'session') setSessionId(ev.id);
          else if (ev.type === 'status') setStatus(ev.text);
          else if (ev.type === 'note') patchLast((m) => ({ ...m, note: ev.text }));
          else if (ev.type === 'delta') { setStatus(''); patchLast((m) => ({ ...m, text: m.text + ev.text })); }
          else if (ev.type === 'error') throw new Error(ev.message);
          else if (ev.type === 'done') done = true;
        }
      }
      if (!done) throw new Error('החיבור נותק לפני סיום התשובה');
    } catch (e) {
      if (e.name !== 'AbortError') patchLast((m) => ({ ...m, error: e.message }));
    } finally {
      if (acRef.current === ac) { setBusy(false); setStatus(''); }
    }
  }

  const reset = () => { acRef.current?.abort(); acRef.current = null; setBusy(false); setStatus(''); setMessages([]); setSessionId(''); setMode('chat'); inputRef.current?.focus(); };
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendMessage(input); } };

  return (
        <section className={'chat-window panel ' + cfg.id} hidden={!open} role="dialog" aria-label={cfg.title}>
          <div className="accent" />
          <header className="chat-head">
            <div className="chat-avatar"><Icon n={cfg.icon} /></div>
            <div className="grow">
              <h3>{cfg.title}</h3>
              <p className="tiny dim"><span className={'chat-dot' + (busy ? ' busy' : '')} />{busy ? 'מעבד את הבקשה…' : cfg.subtitle}</p>
            </div>
            <button className="icon-btn" title="שיחה חדשה" onClick={reset} disabled={!messages.length}><Icon n="restart_alt" /></button>
            <button className="icon-btn" title="סגירה" onClick={onClose}><Icon n="close" /></button>
          </header>

          <div className="chat-list" ref={listRef}>
            {!messages.length && (
              <div className="chat-empty">
                <div className="chat-avatar lg"><Icon n={cfg.icon} /></div>
                <h3>שלום! במה אפשר לעזור?</h3>
                <p className="dim">{cfg.hello}</p>
                <div className="chat-suggest">
                  {SUGGESTIONS.map((s) => <button key={s} onClick={() => sendMessage(s)}>{s}</button>)}
                </div>
              </div>
            )}
            {messages.map((m, i) => {
              const pending = busy && i === messages.length - 1 && m.role === 'assistant' && !m.text && !m.error;
              return (
                <div key={i} className={'chat-msg ' + m.role}>
                  {pending ? <div className="chat-typing"><i /><i /><i /><span>{status}</span></div>
                    : m.role === 'user' ? <p>{m.text}</p> : <Markdown text={m.text} />}
                  {m.note && <div className="chat-note"><Icon n="info" />{m.note}</div>}
                  {m.error && <div className="chat-error"><Icon n="error" />{m.error}</div>}
                </div>
              );
            })}
          </div>

          <div className="chat-modes">
            <button type="button" className={mode === 'chat' ? 'on' : ''} onClick={startChat} disabled={busy}><Icon n="forum" />דבר עם הסוכן</button>
            <button type="button" className={mode === 'point' ? 'on point' : 'point'} onClick={startPoint} disabled={busy}><Icon n="add_location_alt" />סימון נקודה חשודה</button>
            <button type="button" className={mode === 'recipes' ? 'on recipes' : 'recipes'} onClick={startRecipes} disabled={busy}><Icon n="restaurant" />מתכונים</button>
          </div>
          <form className="chat-form" onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}>
            <textarea ref={inputRef} rows={1} value={input} maxLength={4000} placeholder={mode === 'point' ? 'מיקום הנקודה (כתובת / יישוב)…' : mode === 'recipes' ? 'שמות השפים…' : 'כתבו הודעה…'} dir="auto"
              onChange={(e) => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }} onKeyDown={onKey} />
            <button type="submit" className="chat-send" disabled={busy || !input.trim()} title="שליחה">{busy ? <span className="spinner" /> : <Icon n="send" />}</button>
          </form>
        </section>
  );
}

export default function ChatWidget() {
  const [open, setOpen] = useState('');
  return (
    <div className="chat">
      {AGENTS.map((a) => <ChatPanel key={a.id} cfg={a} open={open === a.id} onClose={() => setOpen('')} />)}
      <div className="chat-fabs">
        {AGENTS.map((a) => (
          <button key={a.id} className={`chat-fab ${a.id}` + (open === a.id ? ' open' : '')} onClick={() => setOpen(open === a.id ? '' : a.id)}
            title={open === a.id ? 'סגירת הצ׳אט' : `צ׳אט עם ${a.title}`} aria-expanded={open === a.id}>
            <Icon n={open === a.id ? 'close' : a.fabIcon} />
            <span className="chat-fab-label">{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
