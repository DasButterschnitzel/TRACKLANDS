// Persistent storage (IndexedDB with localStorage fallback), save versioning
// and migration, backups, export and import with validation.
import { SAVE_VERSION } from '../config.js';

const DB = 'tracklands', STORE = 'saves', LS_KEY = 'tracklands.save', LS_BACKUP = 'tracklands.backup';

function idbOpen() {
  return new Promise((res, rej) => {
    if (!('indexedDB' in window)) { rej(new Error('no idb')); return; }
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export class SaveStore {
  constructor() { this.db = null; this.useLS = false; }
  async init() {
    try { this.db = await idbOpen(); } catch (e) { this.useLS = true; }
  }
  async put(key, value) {
    const str = JSON.stringify(value);
    if (!this.useLS && this.db) {
      try {
        await new Promise((res, rej) => {
          const tx = this.db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(str, key);
          tx.oncomplete = res; tx.onerror = () => rej(tx.error);
        });
        return true;
      } catch (e) { this.useLS = true; }
    }
    try { localStorage.setItem(key === 'main' ? LS_KEY : key === 'backup' ? LS_BACKUP : 'tracklands.' + key, str); return true; } catch (e) { return false; }
  }
  async get(key) {
    let str = null;
    if (!this.useLS && this.db) {
      try {
        str = await new Promise((res, rej) => {
          const tx = this.db.transaction(STORE, 'readonly');
          const rq = tx.objectStore(STORE).get(key);
          rq.onsuccess = () => res(rq.result ?? null); rq.onerror = () => rej(rq.error);
        });
      } catch (e) { str = null; }
    }
    if (str == null) { try { str = localStorage.getItem(key === 'main' ? LS_KEY : key === 'backup' ? LS_BACKUP : 'tracklands.' + key); } catch (e) { str = null; } }
    if (str == null) return null;
    try { return JSON.parse(str); } catch (e) { return { corrupt: true }; }
  }
  async remove(key) {
    if (this.db) { try { await new Promise((res) => { const tx = this.db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(key); tx.oncomplete = res; tx.onerror = res; }); } catch (e) { /* ignore */ } }
    try { localStorage.removeItem(key === 'main' ? LS_KEY : key === 'backup' ? LS_BACKUP : 'tracklands.' + key); } catch (e) { /* ignore */ }
  }
}

// Upgrade older save structures step by step. Never discards data silently.
export function migrate(d) {
  if (!d || typeof d !== 'object') return null;
  let v = d.saveVersion | 0;
  if (v < 1) return null;
  if (v === 1) {
    // v1 had no decorations, cleared trees or legacy data
    d.decor = d.decor || [];
    d.cleared = d.cleared || [];
    if (d.progression && !d.progression.legacy) d.progression.legacy = { count: 0 };
    v = 2;
  }
  d.saveVersion = v;
  return v === SAVE_VERSION ? d : v > SAVE_VERSION ? d : null;
}

export function validate(d) {
  if (!d || typeof d !== 'object') return 'err_save_invalid';
  if (typeof d.seed !== 'number' || !isFinite(d.seed)) return 'err_save_invalid';
  if (!d.net || typeof d.net.conn !== 'string') return 'err_save_invalid';
  if (!d.economy || !d.progression) return 'err_save_invalid';
  if ((d.saveVersion | 0) < 1) return 'err_save_version';
  return null;
}

export function exportText(d) {
  const json = JSON.stringify(d);
  return 'TRKL1:' + btoa(unescape(encodeURIComponent(json)));
}
export function importText(text) {
  text = String(text || '').trim();
  try {
    if (text.startsWith('TRKL1:')) return JSON.parse(decodeURIComponent(escape(atob(text.slice(6)))));
    return JSON.parse(text);
  } catch (e) { return null; }
}
export function downloadJSON(d, name) {
  const blob = new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
