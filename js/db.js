// Tiny IndexedDB wrapper. Falls back to memory if IndexedDB is unavailable.
const NAME = 'daybook', VERSION = 1;
let dbp = null, memory = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    if (!('indexedDB' in self)) return rej(new Error('no idb'));
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('shifts')) db.createObjectStore('shifts', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }).catch(err => { console.warn('IndexedDB unavailable, using memory', err); memory = { entries: new Map(), shifts: new Map(), notes: new Map(), meta: new Map() }; return null; });
  return dbp;
}
const keyOf = (store, v) => store === 'entries' ? v.id : store === 'meta' ? v.key : v.date;

function tx(store, mode, fn) {
  return open().then(db => {
    if (!db) { const r = fn(null); return r && 'result' in r ? r.result : undefined; }
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode), s = t.objectStore(store);
      const req = fn(s);
      t.oncomplete = () => res(req && 'result' in req ? req.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  });
}
export const isMemory = () => !!memory;
export const getAll = store => tx(store, 'readonly', s => s ? s.getAll() : { result: [...memory[store].values()] });
export const put = (store, v) => tx(store, 'readwrite', s => { s ? s.put(v) : memory[store].set(keyOf(store, v), v); });
export const del = (store, k) => tx(store, 'readwrite', s => { s ? s.delete(k) : memory[store].delete(k); });
export const replaceAll = (store, vals) => tx(store, 'readwrite', s => {
  if (!s) { memory[store].clear(); vals.forEach(v => memory[store].set(keyOf(store, v), v)); return; }
  s.clear(); vals.forEach(v => s.put(v));
});
export const putMany = (store, vals) => tx(store, 'readwrite', s => {
  if (!s) { vals.forEach(v => memory[store].set(keyOf(store, v), v)); return; }
  vals.forEach(v => s.put(v));
});
