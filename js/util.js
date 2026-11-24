// Small helpers: DOM, escaping, dates and time formatting.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const MIN = 60000, HOUR = 3600000, DAY = 86400000;
export const pad = n => String(n).padStart(2, '0');
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

let clock12 = true;
export const setClock = mode => { clock12 = mode !== '24'; };

export const dkey = d => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return dkey(d); };
export const dayStart = k => fromKey(k).getTime();
export const dayEnd = k => { const d = fromKey(k); d.setDate(d.getDate() + 1); return d.getTime(); };
export const todayKey = () => dkey(new Date());
export const weekKey = k => { const d = fromKey(k); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return dkey(d); };
export const weekday = k => fromKey(k).getDay(); // 0 = Sunday

// "HH:MM" <-> minutes / ms
export const hm = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const hmToMin = s => { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export const minToHm = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
export const atTime = (k, s) => dayStart(k) + hmToMin(s) * MIN;
export const minOfDay = ms => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };

export function fmtClock(ms) {
  const d = new Date(ms); return fmtMinClock(d.getHours() * 60 + d.getMinutes());
}
export function fmtMinClock(m) {
  m = ((Math.round(m) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = pad(m % 60);
  if (!clock12) return `${pad(h)}:${mm}`;
  return `${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}
export function fmtDur(min) {
  min = Math.round(Math.max(0, min || 0));
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
export function fmtSigned(min) { return (min < 0 ? '−' : '+') + fmtDur(Math.abs(min)); }
export function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60;
  return `${h}:${pad(m)}:${pad(ss)}`;
}
const DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dayShort = k => DN[weekday(k)];
export function fmtDate(k, long) {
  const d = fromKey(k);
  return `${(long ? DL : DN)[d.getDay()]}, ${d.getDate()} ${MN[d.getMonth()]}`;
}
export function relDay(k) {
  const t = todayKey();
  if (k === t) return 'Today';
  if (k === addDays(t, -1)) return 'Yesterday';
  if (k === addDays(t, 1)) return 'Tomorrow';
  return fmtDate(k);
}
export function fmtWeek(wk) {
  const a = fromKey(wk), b = fromKey(addDays(wk, 6));
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()}–${b.getDate()} ${MN[b.getMonth()]}`
    : `${a.getDate()} ${MN[a.getMonth()]} – ${b.getDate()} ${MN[b.getMonth()]}`;
}
export function ago(ms) {
  if (!ms) return 'never';
  const d = Math.floor((Date.now() - ms) / DAY);
  if (d <= 0) return 'today';
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
export const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), i = s.length >> 1; return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };
export const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
