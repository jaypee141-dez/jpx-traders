'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = process.env.JPX_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(process.env.JPX_DB || path.join(DATA_DIR, 'jpx.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  broker TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT 'manual',
  currency TEXT NOT NULL DEFAULT 'USD',
  starting_balance REAL NOT NULL DEFAULT 0,
  utc_offset REAL NOT NULL DEFAULT 0,
  api_key_hash TEXT,
  api_key_prefix TEXT,
  last_sync TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_key ON accounts(api_key_hash);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  external_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('long','short')),
  volume REAL NOT NULL DEFAULT 0,
  entry_price REAL,
  exit_price REAL,
  stop_loss REAL,
  take_profit REAL,
  open_time TEXT NOT NULL,
  close_time TEXT NOT NULL,
  profit REAL NOT NULL DEFAULT 0,
  commission REAL NOT NULL DEFAULT 0,
  swap REAL NOT NULL DEFAULT 0,
  net REAL NOT NULL DEFAULT 0,
  risk_amount REAL,
  setup TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  emotion TEXT NOT NULL DEFAULT '',
  mistakes TEXT NOT NULL DEFAULT '',
  rating INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_trades_user_close ON trades(user_id, close_time);
CREATE INDEX IF NOT EXISTS idx_trades_account ON trades(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_ext ON trades(account_id, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  mood TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  lessons TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS risk_rules (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  max_daily_loss REAL,
  max_trades_per_day INTEGER,
  max_consecutive_losses INTEGER,
  max_risk_per_trade REAL
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS featured_traders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alias TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '',
  gain REAL NOT NULL DEFAULT 0, win_rate REAL NOT NULL DEFAULT 0, profit_factor REAL NOT NULL DEFAULT 0,
  trades INTEGER NOT NULL DEFAULT 0, followers INTEGER NOT NULL DEFAULT 0, max_dd REAL NOT NULL DEFAULT 0,
  spark TEXT NOT NULL DEFAULT '[]', sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS testimonials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, role TEXT NOT NULL DEFAULT '', quote TEXT NOT NULL, rating INTEGER NOT NULL DEFAULT 5,
  avatar TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  action TEXT NOT NULL,
  target TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`);

function addCol(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addCol('users', 'plan', "TEXT NOT NULL DEFAULT 'free'");
addCol('users', 'plan_source', "TEXT NOT NULL DEFAULT 'none'");
addCol('users', 'plan_interval', "TEXT NOT NULL DEFAULT 'month'");
addCol('users', 'trial_ends_at', 'TEXT');
addCol('users', 'stripe_customer_id', 'TEXT');
addCol('users', 'stripe_subscription_id', 'TEXT');
addCol('users', 'account_manager', "TEXT NOT NULL DEFAULT ''");
for (const [c, d] of [['metaapi_id', 'TEXT'], ['metaapi_region', 'TEXT'], ['metaapi_status', 'TEXT'], ['metaapi_error', 'TEXT'], ['metaapi_login', 'TEXT'], ['metaapi_server', 'TEXT'], ['last_poll', 'TEXT'], ['metaapi_since', 'TEXT']]) addCol('accounts', c, d);
// Existing users (created before plans existed) get the same 14-day Pro trial as new sign-ups.
db.prepare("UPDATE users SET plan='pro', plan_source='trial', trial_ends_at=? WHERE plan_source='none' AND trial_ends_at IS NULL").run(new Date(Date.now() + 14 * 86400000).toISOString());

db.exec(`
CREATE TABLE IF NOT EXISTS leader_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  alias TEXT NOT NULL UNIQUE COLLATE NOCASE,
  bio TEXT NOT NULL DEFAULT '',
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  is_public INTEGER NOT NULL DEFAULT 1,
  elite_only INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS follows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  leader_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  follower_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'ratio' CHECK (mode IN ('ratio','fixed')),
  multiplier REAL NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(follower_id, leader_user_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_leader ON follows(leader_user_id);
CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  leader_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  leader_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ref TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  volume REAL NOT NULL,
  entry_price REAL, stop_loss REAL, take_profit REAL,
  opened_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  closed_at TEXT, exit_price REAL,
  profit REAL NOT NULL DEFAULT 0, commission REAL NOT NULL DEFAULT 0, swap REAL NOT NULL DEFAULT 0,
  UNIQUE(leader_account_id, ref)
);
CREATE TABLE IF NOT EXISTS mirrors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  follow_id INTEGER NOT NULL REFERENCES follows(id) ON DELETE CASCADE,
  signal_id INTEGER NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  follower_volume REAL NOT NULL,
  follower_trade_id INTEGER,
  open_ack INTEGER NOT NULL DEFAULT 0, close_ack INTEGER NOT NULL DEFAULT 0, open_ticket TEXT,
  close_done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(follow_id, signal_id)
);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'open', priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id INTEGER, is_staff INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL, quote TEXT NOT NULL, role TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL, prefix TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_tokens_hash ON api_tokens(token_hash);
`);

addCol('leader_profiles', 'site_hidden', 'INTEGER NOT NULL DEFAULT 0');
addCol('leader_profiles', 'site_approved', 'INTEGER NOT NULL DEFAULT 0');
addCol('users', 'avatar', "TEXT NOT NULL DEFAULT ''");
addCol('testimonials', 'demo', 'INTEGER NOT NULL DEFAULT 0');

// node:sqlite rejects undefined and booleans; normalise.
const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
const q = {
  get: (sql, ...p) => db.prepare(sql).get(...p.map(norm)),
  all: (sql, ...p) => db.prepare(sql).all(...p.map(norm)),
  run: (sql, ...p) => db.prepare(sql).run(...p.map(norm)),
  tx(fn) {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  },
};
module.exports = { db, q };
