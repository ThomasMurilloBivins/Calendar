import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT || 3000;
const PASSCODE = process.env.APP_PASSCODE || '';
const DATABASE_URL = process.env.DATABASE_URL || '';
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

// --- storage -------------------------------------------------------------
// With DATABASE_URL set we persist one row in Postgres. Without it the app
// still runs (local-only): the browser keeps everything in IndexedDB anyway,
// so an unconfigured server just means "no backup yet", not "broken".
let store;

if (DATABASE_URL) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS snapshot (
      id int PRIMARY KEY,
      version int NOT NULL,
      state jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  await pool.query(
    `INSERT INTO snapshot (id, version, state) VALUES (1, 0, '{}'::jsonb)
     ON CONFLICT (id) DO NOTHING`
  );

  store = {
    async read() {
      const { rows } = await pool.query('SELECT version, state FROM snapshot WHERE id = 1');
      return rows[0];
    },
    // Compare-and-set: only writes if the client's baseVersion is still current.
    // Returns null on conflict so the caller can hand back the winning state.
    async write(baseVersion, state) {
      const { rows } = await pool.query(
        `UPDATE snapshot SET state = $1, version = version + 1, updated_at = now()
         WHERE id = 1 AND version = $2 RETURNING version`,
        [state, baseVersion]
      );
      return rows[0] ? rows[0].version : null;
    },
  };
} else {
  let current = { version: 0, state: {} };
  store = {
    async read() {
      return current;
    },
    async write(baseVersion, state) {
      if (baseVersion !== current.version) return null;
      current = { version: current.version + 1, state };
      return current.version;
    },
  };
}

// --- auth ----------------------------------------------------------------
function passcodeOk(given) {
  if (!PASSCODE) return true;
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(PASSCODE);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireAuth(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer /, '');
  if (!passcodeOk(token)) return res.status(401).json({ error: 'bad passcode' });
  next();
}

// --- app -----------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '4mb' }));

app.get('/api/config', (req, res) => {
  res.json({ authRequired: Boolean(PASSCODE), syncEnabled: Boolean(DATABASE_URL) });
});

app.post('/api/unlock', (req, res) => {
  if (!passcodeOk(req.body?.passcode)) return res.status(401).json({ error: 'bad passcode' });
  res.json({ ok: true });
});

app.get('/api/snapshot', requireAuth, async (req, res) => {
  res.json(await store.read());
});

app.put('/api/snapshot', requireAuth, async (req, res) => {
  const { baseVersion, state } = req.body || {};
  if (typeof baseVersion !== 'number' || !state || typeof state !== 'object') {
    return res.status(400).json({ error: 'baseVersion and state required' });
  }
  const version = await store.write(baseVersion, state);
  if (version === null) return res.status(409).json(await store.read());
  res.json({ version });
});

app.use(express.static(publicDir));
app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

app.listen(PORT, () => {
  console.log(`planner on :${PORT}` + (DATABASE_URL ? '' : ' (local-only, no DATABASE_URL)'));
});
