// App state held in memory and mirrored to IndexedDB.
import * as db from './db.js';
import { uid } from './util.js';

export const OFFICE = 'office', SLEEP = 'sleep', MEALS = 'meals';
export const KINDS = {
  productive: { name: 'Productive', color: '#2f6bff' },
  necessary: { name: 'Necessary', color: '#8b94a7' },
  leisure: { name: 'Leisure', color: '#f2a516' },
  waste: { name: 'Waste', color: '#ef4444' },
};
export const KIND_ORDER = ['productive', 'necessary', 'leisure', 'waste'];
export const SWATCHES = ['#2f6bff', '#5a63d8', '#16a34a', '#0f9f8f', '#06a3c4', '#f59e0b', '#fb8c3c', '#b7791f', '#d6409f', '#a78bfa', '#ef4444', '#b42318', '#7c8798', '#a3adbf', '#65a30d', '#0ea5e9'];

export const DEFAULT_CATS = [
  { id: 'sleep', name: 'Sleep', icon: 'moon', color: '#5a63d8', kind: 'necessary' },
  { id: 'office', name: 'Office work', icon: 'briefcase', color: '#2f6bff', kind: 'productive' },
  { id: 'learning', name: 'Learning', icon: 'book', color: '#16a34a', kind: 'productive', growth: true },
  { id: 'freelance', name: 'Freelance', icon: 'laptop', color: '#0f9f8f', kind: 'productive', growth: true },
  { id: 'meals', name: 'Meals', icon: 'meal', color: '#f59e0b', kind: 'necessary' },
  { id: 'commute', name: 'Commute', icon: 'bus', color: '#7c8798', kind: 'necessary' },
  { id: 'care', name: 'Getting ready', icon: 'sparkle', color: '#a3adbf', kind: 'necessary' },
  { id: 'exercise', name: 'Exercise', icon: 'dumbbell', color: '#06a3c4', kind: 'necessary' },
  { id: 'chores', name: 'Chores & errands', icon: 'home', color: '#b7791f', kind: 'necessary' },
  { id: 'family', name: 'Family & friends', icon: 'users', color: '#d6409f', kind: 'leisure' },
  { id: 'rest', name: 'Rest & breaks', icon: 'coffee', color: '#a78bfa', kind: 'leisure' },
  { id: 'tv', name: 'TV & OTT', icon: 'tv', color: '#fb8c3c', kind: 'leisure' },
  { id: 'social', name: 'Social media', icon: 'phone', color: '#ef4444', kind: 'waste' },
  { id: 'idle', name: 'Timepass', icon: 'hourglass', color: '#b42318', kind: 'waste' },
];
export const DEFAULT_SETTINGS = {
  workMin: 510, breaksExtend: true, autoLunch: 30, workDays: [1, 2, 3, 4, 5],
  goalMin: 120, sleepMin: 450, wakeTime: '07:00', clock: '12',
  lastBackup: 0, installed: 0,
};
const DEFAULT_ROUTINES = [
  { id: 'r-morning', name: 'Weekday morning', items: [
    { cat: 'care', start: '07:15', dur: 30 },
    { cat: 'meals', start: '07:45', dur: 20 },
    { cat: 'commute', start: '08:20', dur: 40 },
  ] },
];

export const S = { settings: { ...DEFAULT_SETTINGS }, cats: [], entries: [], shifts: {}, notes: {}, routines: [] };
let catMap = new Map();
const FALLBACK = { id: '?', name: 'Deleted activity', icon: 'dot', color: '#9aa1b0', kind: 'necessary' };
export const cat = id => catMap.get(id) || FALLBACK;
export const visibleCats = () => S.cats.filter(c => !c.hidden);
const rebuild = () => { catMap = new Map(S.cats.map(c => [c.id, c])); };

export async function load() {
  const [entries, shifts, notes, meta] = await Promise.all([db.getAll('entries'), db.getAll('shifts'), db.getAll('notes'), db.getAll('meta')]);
  const m = Object.fromEntries((meta || []).map(x => [x.key, x.value]));
  S.settings = { ...DEFAULT_SETTINGS, ...(m.settings || {}) };
  S.cats = m.cats || DEFAULT_CATS.map(c => ({ ...c }));
  S.routines = m.routines || DEFAULT_ROUTINES.map(r => ({ ...r, items: r.items.map(i => ({ ...i })) }));
  S.entries = entries || [];
  S.shifts = Object.fromEntries((shifts || []).map(s => [s.date, s]));
  S.notes = Object.fromEntries((notes || []).map(n => [n.date, n]));
  rebuild();
  if (!m.settings) { S.settings.installed = Date.now(); await Promise.all([saveSettings(), saveCats(), saveRoutines()]); }
}

export const saveSettings = () => db.put('meta', { key: 'settings', value: S.settings });
export const saveCats = () => { rebuild(); return db.put('meta', { key: 'cats', value: S.cats }); };
export const saveRoutines = () => db.put('meta', { key: 'routines', value: S.routines });

export async function putEntry(e) {
  e.updated = Date.now();
  if (!e.id) e.id = uid();
  if (!e.created) e.created = e.updated;
  const i = S.entries.findIndex(x => x.id === e.id);
  if (i < 0) S.entries.push(e); else S.entries[i] = e;
  await db.put('entries', e);
  return e;
}
export async function delEntry(id) { S.entries = S.entries.filter(e => e.id !== id); await db.del('entries', id); }
export async function putShift(sh) { sh.updated = Date.now(); S.shifts[sh.date] = sh; await db.put('shifts', sh); }
export async function delShift(date) { delete S.shifts[date]; await db.del('shifts', date); }
export async function putNote(date, text) {
  if (!text.trim()) { delete S.notes[date]; return db.del('notes', date); }
  S.notes[date] = { date, text, updated: Date.now() };
  return db.put('notes', S.notes[date]);
}
export const running = () => S.entries.find(e => e.end == null) || null;
export const openShift = () => Object.values(S.shifts).find(s => s.in && !s.out) || null;

// One level of undo: a snapshot of entries and shifts before a change.
let snap = null;
export function snapshot() { snap = { entries: S.entries.map(e => ({ ...e })), shifts: JSON.parse(JSON.stringify(S.shifts)) }; }
export async function undo() {
  if (!snap) return false;
  S.entries = snap.entries; S.shifts = snap.shifts; snap = null;
  await Promise.all([db.replaceAll('entries', S.entries), db.replaceAll('shifts', Object.values(S.shifts))]);
  return true;
}

// Backup
export function exportData() {
  return { app: 'daybook', version: 1, exportedAt: new Date().toISOString(), settings: S.settings, categories: S.cats, routines: S.routines, entries: S.entries, shifts: Object.values(S.shifts), notes: Object.values(S.notes) };
}
export function validateBackup(o) {
  if (!o || o.app !== 'daybook' || !Array.isArray(o.entries)) throw new Error('This file is not a Daybook backup.');
  return { entries: o.entries.length, shifts: (o.shifts || []).length, notes: (o.notes || []).length, cats: (o.categories || []).length };
}
export async function importData(o, mode) {
  const ok = e => e && typeof e.id === 'string' && typeof e.start === 'number' && (e.end == null || typeof e.end === 'number') && typeof e.cat === 'string';
  const entries = o.entries.filter(ok);
  const shifts = (o.shifts || []).filter(s => s && typeof s.date === 'string' && typeof s.in === 'number');
  const notes = (o.notes || []).filter(n => n && typeof n.date === 'string' && typeof n.text === 'string');
  if (mode === 'replace') {
    S.entries = entries; S.shifts = Object.fromEntries(shifts.map(s => [s.date, s])); S.notes = Object.fromEntries(notes.map(n => [n.date, n]));
    if (Array.isArray(o.categories) && o.categories.length) S.cats = o.categories;
    if (Array.isArray(o.routines)) S.routines = o.routines;
    if (o.settings) S.settings = { ...DEFAULT_SETTINGS, ...o.settings };
  } else {
    const byId = new Map(S.entries.map(e => [e.id, e]));
    for (const e of entries) { const cur = byId.get(e.id); if (!cur || (e.updated || 0) > (cur.updated || 0)) byId.set(e.id, e); }
    S.entries = [...byId.values()];
    for (const s of shifts) { const cur = S.shifts[s.date]; if (!cur || (s.updated || 0) > (cur.updated || 0)) S.shifts[s.date] = s; }
    for (const n of notes) { const cur = S.notes[n.date]; if (!cur || (n.updated || 0) > (cur.updated || 0)) S.notes[n.date] = n; }
    const have = new Set(S.cats.map(c => c.id));
    for (const c of o.categories || []) if (c && c.id && !have.has(c.id)) S.cats.push(c);
    const haveR = new Set(S.routines.map(r => r.id));
    for (const r of o.routines || []) if (r && r.id && !haveR.has(r.id)) S.routines.push(r);
  }
  // Only one entry may be running.
  const runningOnes = S.entries.filter(e => e.end == null).sort((a, b) => b.start - a.start);
  runningOnes.slice(1).forEach(e => { e.end = Math.min(Date.now(), e.start + 3600000); });
  await Promise.all([
    db.replaceAll('entries', S.entries), db.replaceAll('shifts', Object.values(S.shifts)), db.replaceAll('notes', Object.values(S.notes)),
    saveCats(), saveRoutines(), saveSettings(),
  ]);
}
export async function eraseAll() {
  S.entries = []; S.shifts = {}; S.notes = {};
  S.cats = DEFAULT_CATS.map(c => ({ ...c })); S.routines = []; S.settings = { ...DEFAULT_SETTINGS, installed: Date.now() };
  await Promise.all([db.replaceAll('entries', []), db.replaceAll('shifts', []), db.replaceAll('notes', []), saveCats(), saveRoutines(), saveSettings()]);
}
