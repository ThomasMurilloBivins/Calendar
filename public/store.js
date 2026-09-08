// Local-first store. IndexedDB is the source of truth for the UI; the server is
// a backup that two devices merge through. Never block the UI on the network:
// Render's free tier sleeps and a cold wake takes 30-60s.

const DB_NAME = 'planner';
const STORE = 'kv';
const KEY = 'doc';

// Every collection is an id-keyed map of records, and every record carries an
// `updatedAt`. That makes merging two devices one rule with no special cases:
// union by id, newer record wins.
const COLLECTIONS = [
  'items',
  'fixedBlocks',
  'habits',
  'habitLogs',
  'events',
  'projects',
  'hourLogs',
  'reflections',
  'weeklyGoals',
];

export function blankDoc() {
  const doc = { v: 1 };
  for (const c of COLLECTIONS) doc[c] = {};
  doc.settings = { dayStart: '07:00', dayEnd: '23:00', overflowHour: '20:00', updatedAt: 0 };
  return doc;
}

export const state = blankDoc();

let serverVersion = 0;
let token = localStorage.getItem('passcode') || '';
let listeners = [];
let syncTimer = null;
let syncState = 'idle'; // idle | syncing | synced | offline | locked | local

export function onChange(fn) {
  listeners.push(fn);
}
function emit() {
  for (const fn of listeners) fn();
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function getSyncState() {
  return syncState;
}

// --- IndexedDB -----------------------------------------------------------
function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function persist() {
  await idb('readwrite', (s) => s.put({ doc: state, serverVersion }, KEY));
}

function adopt(doc) {
  for (const c of COLLECTIONS) state[c] = doc[c] || {};
  state.settings = doc.settings || blankDoc().settings;
}

// --- merge ---------------------------------------------------------------
// Union by id, newer `updatedAt` wins. Deletes are tombstones (a `deleted`
// flag or a `dropped` status), never missing keys, so a delete on one device
// isn't silently resurrected by the other.
export function mergeDocs(a, b) {
  const out = blankDoc();
  for (const c of COLLECTIONS) {
    out[c] = { ...(a[c] || {}) };
    for (const [id, rec] of Object.entries(b[c] || {})) {
      const mine = out[c][id];
      if (!mine || (rec.updatedAt || 0) > (mine.updatedAt || 0)) out[c][id] = rec;
    }
  }
  const sa = a.settings || {};
  const sb = b.settings || {};
  out.settings = (sb.updatedAt || 0) > (sa.updatedAt || 0) ? sb : sa;
  return out;
}

// --- mutation ------------------------------------------------------------
export function put(collection, record) {
  const rec = { ...record };
  if (!rec.id) rec.id = uid();
  rec.updatedAt = Date.now();
  state[collection][rec.id] = rec;
  save();
  return rec;
}

export function patch(collection, id, changes) {
  const existing = state[collection][id];
  if (!existing) return null;
  return put(collection, { ...existing, ...changes });
}

export function setSettings(changes) {
  state.settings = { ...state.settings, ...changes, updatedAt: Date.now() };
  save();
}

export function save() {
  persist();
  emit();
  clearTimeout(syncTimer);
  syncTimer = setTimeout(push, 1500);
}

// --- sync ----------------------------------------------------------------
function headers() {
  return { 'content-type': 'application/json', authorization: `Bearer ${token}` };
}

function setSync(s) {
  syncState = s;
  emit();
}

export async function unlock(passcode) {
  const res = await fetch('/api/unlock', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passcode }),
  });
  if (!res.ok) return false;
  token = passcode;
  localStorage.setItem('passcode', passcode);
  await pull();
  return true;
}

export async function pull() {
  if (!navigator.onLine) return setSync('offline');
  try {
    const res = await fetch('/api/snapshot', { headers: headers() });
    if (res.status === 401) return setSync('locked');
    const { version, state: remote } = await res.json();
    serverVersion = version;
    if (remote && remote.v) {
      adopt(mergeDocs(state, remote));
      await persist();
      emit();
    }
    setSync('synced');
  } catch {
    setSync('offline');
  }
}

export async function push(attempt = 0) {
  if (!navigator.onLine || syncState === 'locked') return;
  setSync('syncing');
  try {
    const res = await fetch('/api/snapshot', {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ baseVersion: serverVersion, state }),
    });
    if (res.status === 401) return setSync('locked');
    // Someone else (the laptop, the phone) wrote first. Merge their state into
    // ours and try again rather than clobbering it.
    if (res.status === 409) {
      const current = await res.json();
      serverVersion = current.version;
      adopt(mergeDocs(state, current.state));
      await persist();
      emit();
      if (attempt < 3) return push(attempt + 1);
      return setSync('offline');
    }
    const { version } = await res.json();
    serverVersion = version;
    await persist();
    setSync('synced');
  } catch {
    setSync('offline');
  }
}

export async function init() {
  const stored = await idb('readonly', (s) => s.get(KEY)).catch(() => null);
  if (stored?.doc) {
    adopt(stored.doc);
    serverVersion = stored.serverVersion || 0;
  }
  emit();

  const config = await fetch('/api/config')
    .then((r) => r.json())
    .catch(() => null);

  if (config && !config.syncEnabled) {
    setSync('local');
    return config;
  }
  if (config?.authRequired && !token) {
    setSync('locked');
    return config;
  }
  await pull();

  // No background jobs exist on the free tier, so the client re-syncs at the
  // only moments that matter: coming back to the tab, and coming back online.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pull();
  });
  window.addEventListener('online', () => pull());
  return config;
}
