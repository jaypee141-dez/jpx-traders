'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { q } = require('./lib/db');
const { analyze, localParts } = require('./lib/analytics');
const { parseTradeCSV, normalizeTrade, parseDT } = require('./lib/importer');
const { PLANS, TRIAL_DAYS, effectivePlan, planInfo } = require('./lib/plans');
const copy = require('./lib/copy');

const scrypt = promisify(crypto.scrypt);
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC = path.join(__dirname, 'public');
const SESSION_MS = 30 * 24 * 3600 * 1000;
const REGISTRATION_OPEN = process.env.REGISTRATION !== 'closed';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'jpee49275@gmail.com').toLowerCase();
q.run("UPDATE users SET role = 'admin' WHERE email = ? AND role != 'admin'", ADMIN_EMAIL); // the owner account is always an admin
const COOKIE = 'jpx_sid';

/* ------------------------------------------------------------------ helpers */
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new HttpError(400, m);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
async function verifyPassword(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = await scrypt(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(keyHex, 'hex');
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) { buckets.set(key, { count: 1, reset: now + windowMs }); return; }
  if (++b.count > max) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 60000).unref();
setInterval(() => q.run('DELETE FROM sessions WHERE expires_at < ?', Date.now()), 3600000).unref();

function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  const data = isObj ? JSON.stringify(body) : body;
  res.writeHead(status, { 'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

function readBody(req, limit = 6 * 1024 * 1024, ctx = null) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Request is too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      const text = Buffer.concat(chunks).toString('utf8');
      if (ctx) ctx.raw = text;
      try { resolve(JSON.parse(text)); } catch { reject(bad('Request body is not valid JSON')); }
    });
    req.on('error', reject);
  });
}

const parseCookies = (h = '') => Object.fromEntries(h.split(';').map((p) => p.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const isSecure = (req) => process.env.COOKIE_SECURE === '1' || req.headers['x-forwarded-proto'] === 'https';
function setSession(req, res, token) {
  const parts = [`${COOKIE}=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${SESSION_MS / 1000}`];
  if (isSecure(req)) parts.push('Secure');
  return parts.join('; ');
}
const clearCookie = (req) => `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${isSecure(req) ? '; Secure' : ''}`;
const clientIp = (req) => (process.env.TRUST_PROXY === '1' ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress || '';

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, status: u.status, timezone: u.timezone, currency: u.currency, created_at: u.created_at, plan: planInfo(u) };
}
function limits(u) { return planInfo(u).limits; }
function needPlan(u, ok, message) { if (!ok) throw new HttpError(402, message); }
function authUser(req) {
  const tok = parseCookies(req.headers.cookie)[COOKIE];
  if (!tok) return null;
  const s = q.get('SELECT s.user_id, s.expires_at FROM sessions s WHERE s.token_hash = ?', sha(tok));
  if (!s || s.expires_at < Date.now()) return null;
  const u = q.get('SELECT * FROM users WHERE id = ?', s.user_id);
  if (!u || u.status !== 'active') return null;
  return u;
}
function requireUser(ctx) { if (!ctx.user) throw new HttpError(401, 'Please sign in to continue'); return ctx.user; }
function requireAdmin(ctx) { const u = requireUser(ctx); if (u.role !== 'admin') throw new HttpError(403, 'Admin access required'); return u; }

function validTimezone(tz) { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const str = (v, max, name, required = false) => {
  const s = String(v ?? '').trim();
  if (required && !s) throw bad(`${name} is required`);
  if (s.length > max) throw bad(`${name} must be ${max} characters or fewer`);
  return s;
};
const intParam = (v, d, min, max) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };

/** Convert a naive local datetime in `tz` to a UTC ISO string. Strings carrying Z/offset pass through. */
function zonedToUtc(value, tz) {
  const s = String(value || '').trim();
  if (!s) return null;
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) return parseDT(s, 0);
  const asUtc = parseDT(s, 0);
  if (!asUtc) return null;
  const guess = Date.parse(asUtc);
  const offsetAt = (ms) => {
    const p = {};
    for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms))) p[x.type] = x.value;
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
  };
  let utc = guess - offsetAt(guess);
  utc = guess - offsetAt(utc);
  return new Date(utc).toISOString();
}

/* ------------------------------------------------------------------ data access */
const TRADE_FIELDS = ['external_id', 'symbol', 'side', 'volume', 'entry_price', 'exit_price', 'stop_loss', 'take_profit', 'open_time', 'close_time', 'profit', 'commission', 'swap', 'net', 'risk_amount', 'setup', 'tags', 'emotion', 'mistakes', 'rating', 'notes'];

function ownedAccount(user, id) {
  const a = q.get('SELECT * FROM accounts WHERE id = ? AND user_id = ?', Number(id), user.id);
  if (!a) throw new HttpError(404, 'Account not found');
  return a;
}
function publicAccount(a) {
  const stats = q.get('SELECT COUNT(*) AS trades, COALESCE(SUM(net),0) AS net FROM trades WHERE account_id = ?', a.id);
  return { id: a.id, name: a.name, broker: a.broker, platform: a.platform, currency: a.currency, starting_balance: a.starting_balance, utc_offset: a.utc_offset, api_key_prefix: a.api_key_prefix, has_api_key: !!a.api_key_hash, last_sync: a.last_sync, created_at: a.created_at, trades: stats.trades, net: Math.round(stats.net * 100) / 100, auto: a.metaapi_id ? { status: a.metaapi_status, login: a.metaapi_login, server: a.metaapi_server, error: a.metaapi_error, last_poll: a.last_poll } : null };
}

function insertTrade(userId, accountId, t, source) {
  const res = insertTradeRaw(userId, accountId, t, source);
  if (source !== 'copy') { try { copy.publishClosedTrade(q.get('SELECT * FROM trades WHERE id = ?', Number(res.lastInsertRowid)), insertTrade); } catch (e) { console.error('copy publish failed', e); } }
  return res;
}
function insertTradeRaw(userId, accountId, t, source) {
  return q.run(
    `INSERT INTO trades (user_id, account_id, external_id, symbol, side, volume, entry_price, exit_price, stop_loss, take_profit, open_time, close_time, profit, commission, swap, net, risk_amount, setup, tags, emotion, mistakes, rating, notes, source)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    userId, accountId, t.external_id, t.symbol, t.side, t.volume, t.entry_price, t.exit_price, t.stop_loss, t.take_profit, t.open_time, t.close_time, t.profit, t.commission, t.swap, t.net, t.risk_amount, t.setup, t.tags, t.emotion, t.mistakes, t.rating, t.notes, source);
}

/** Load a user's trades honouring filters. Date filters are local dates in the user's timezone. */
function loadTrades(user, query) {
  const where = ['t.user_id = ?']; const params = [user.id];
  if (query.account_id && query.account_id !== 'all') { where.push('t.account_id = ?'); params.push(Number(query.account_id)); }
  if (query.symbol) { where.push('t.symbol = ?'); params.push(String(query.symbol).toUpperCase()); }
  if (query.side === 'long' || query.side === 'short') { where.push('t.side = ?'); params.push(query.side); }
  if (query.setup) { where.push('t.setup = ?'); params.push(query.setup); }
  if (query.result === 'win') where.push('t.net > 0');
  if (query.result === 'loss') where.push('t.net < 0');
  if (query.result === 'be') where.push('t.net = 0');
  if (query.q) { where.push("(t.symbol LIKE ? ESCAPE '\\' OR t.notes LIKE ? ESCAPE '\\' OR t.tags LIKE ? ESCAPE '\\' OR t.setup LIKE ? ESCAPE '\\')"); const like = `%${String(query.q).replace(/[%_\\]/g, '\\$&')}%`; params.push(like, like, like, like); }
  // Pre-filter by a padded UTC window, then exact-filter by local date
  if (query.from) { where.push('t.close_time >= ?'); params.push(new Date(Date.parse(query.from + 'T00:00:00Z') - 36 * 3600000).toISOString()); }
  if (query.to) { where.push('t.close_time <= ?'); params.push(new Date(Date.parse(query.to + 'T23:59:59Z') + 36 * 3600000).toISOString()); }
  let rows = q.all(`SELECT t.*, a.name AS account_name, a.currency AS account_currency FROM trades t JOIN accounts a ON a.id = t.account_id WHERE ${where.join(' AND ')} ORDER BY t.close_time DESC, t.id DESC`, ...params);
  if (query.from || query.to) {
    rows = rows.filter((r) => {
      const d = localParts(r.close_time, user.timezone).date;
      return (!query.from || d >= query.from) && (!query.to || d <= query.to);
    });
  }
  return rows;
}

function startingBalance(user, accountId) {
  if (accountId && accountId !== 'all') return q.get('SELECT COALESCE(starting_balance,0) AS s FROM accounts WHERE id = ? AND user_id = ?', Number(accountId), user.id)?.s || 0;
  return q.get('SELECT COALESCE(SUM(starting_balance),0) AS s FROM accounts WHERE user_id = ?', user.id).s;
}

function audit(actor, action, target) { q.run('INSERT INTO audit_log (actor_id, action, target) VALUES (?,?,?)', actor, action, target); }

/* ------------------------------------------------------------------ routes */
const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler, opts });

// ---- Auth
route('POST', '/api/auth/register', async (ctx) => {
  if (!REGISTRATION_OPEN) throw new HttpError(403, 'Registration is currently closed');
  rateLimit(`reg:${ctx.ip}`, 10, 3600000);
  const b = ctx.body;
  const name = str(b.name, 80, 'Name', true);
  const email = str(b.email, 200, 'Email', true).toLowerCase();
  if (!EMAIL_RE.test(email)) throw bad('Enter a valid email address');
  const pw = String(b.password || '');
  if (pw.length < 8) throw bad('Password must be at least 8 characters');
  if (pw.length > 200) throw bad('Password is too long');
  let tz = String(b.timezone || 'UTC'); if (!validTimezone(tz)) tz = 'UTC';
  if (q.get('SELECT id FROM users WHERE email = ?', email)) throw bad('An account with this email already exists');
  const role = email === ADMIN_EMAIL ? 'admin' : 'user';
  const hash = await hashPassword(pw);
  const r = q.run("INSERT INTO users (email, name, password_hash, role, timezone, plan, plan_source, trial_ends_at) VALUES (?,?,?,?,?,'pro','trial',?)", email, name, hash, role, tz, new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString());
  const uid = Number(r.lastInsertRowid);
  q.run('INSERT INTO risk_rules (user_id) VALUES (?)', uid);
  return startSession(ctx, uid);
}, { public: true });

function startSession(ctx, uid) {
  const token = crypto.randomBytes(32).toString('base64url');
  q.run('INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES (?,?,?,?)', sha(token), uid, Date.now() + SESSION_MS, String(ctx.req.headers['user-agent'] || '').slice(0, 200));
  q.run("UPDATE users SET last_login = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", uid);
  const user = q.get('SELECT * FROM users WHERE id = ?', uid);
  return { status: 200, headers: { 'Set-Cookie': setSession(ctx.req, ctx.res, token) }, body: { user: publicUser(user) } };
}

route('POST', '/api/auth/login', async (ctx) => {
  const email = String(ctx.body.email || '').trim().toLowerCase();
  const pw = String(ctx.body.password || '');
  rateLimit(`login:${ctx.ip}`, 30, 15 * 60000);
  rateLimit(`login:${email}`, 8, 15 * 60000);
  const u = q.get('SELECT * FROM users WHERE email = ?', email);
  const ok = u ? await verifyPassword(pw, u.password_hash) : (await verifyPassword(pw, 'scrypt$00$00'), false);
  if (!ok) throw new HttpError(401, 'Incorrect email or password');
  if (u.status !== 'active') throw new HttpError(403, 'This account has been suspended. Contact support.');
  return startSession(ctx, u.id);
}, { public: true });

route('POST', '/api/auth/logout', (ctx) => {
  const tok = parseCookies(ctx.req.headers.cookie)[COOKIE];
  if (tok) q.run('DELETE FROM sessions WHERE token_hash = ?', sha(tok));
  return { status: 200, headers: { 'Set-Cookie': clearCookie(ctx.req) }, body: { ok: true } };
}, { public: true });

route('GET', '/api/me', (ctx) => ({ user: ctx.user ? publicUser(ctx.user) : null }), { public: true });

route('PATCH', '/api/me', (ctx) => {
  const u = requireUser(ctx); const b = ctx.body;
  const name = b.name !== undefined ? str(b.name, 80, 'Name', true) : u.name;
  let tz = b.timezone !== undefined ? String(b.timezone) : u.timezone;
  if (!validTimezone(tz)) throw bad('Unknown timezone');
  const currency = b.currency !== undefined ? str(b.currency, 8, 'Currency', true).toUpperCase() : u.currency;
  q.run('UPDATE users SET name = ?, timezone = ?, currency = ? WHERE id = ?', name, tz, currency, u.id);
  return { user: publicUser(q.get('SELECT * FROM users WHERE id = ?', u.id)) };
});

route('POST', '/api/me/password', async (ctx) => {
  const u = requireUser(ctx);
  rateLimit(`pw:${u.id}`, 8, 15 * 60000);
  if (!(await verifyPassword(String(ctx.body.current || ''), u.password_hash))) throw bad('Current password is incorrect');
  const pw = String(ctx.body.next || '');
  if (pw.length < 8) throw bad('New password must be at least 8 characters');
  q.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(pw), u.id);
  const tok = parseCookies(ctx.req.headers.cookie)[COOKIE];
  q.run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', u.id, sha(tok));
  return { ok: true };
});

route('DELETE', '/api/me', async (ctx) => {
  const u = requireUser(ctx);
  if (!(await verifyPassword(String(ctx.body.password || ''), u.password_hash))) throw bad('Password is incorrect');
  if (u.role === 'admin' && q.get("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND status='active'").n <= 1) throw bad('You are the only admin. Promote another user before deleting your account.');
  for (const x of q.all('SELECT metaapi_id FROM accounts WHERE user_id = ? AND metaapi_id IS NOT NULL', u.id)) require('./lib/metaapi').removeAccount(x.metaapi_id);
  q.run('DELETE FROM users WHERE id = ?', u.id);
  return { status: 200, headers: { 'Set-Cookie': clearCookie(ctx.req) }, body: { ok: true } };
});

// ---- Accounts
route('GET', '/api/accounts', (ctx) => {
  const u = requireUser(ctx);
  return { accounts: q.all('SELECT * FROM accounts WHERE user_id = ? ORDER BY id', u.id).map(publicAccount) };
});

function accountFields(b, existing) {
  const platform = ['manual', 'mt5', 'mt4', 'csv', 'other'].includes(b.platform) ? b.platform : (existing?.platform || 'manual');
  const bal = b.starting_balance === undefined ? (existing?.starting_balance ?? 0) : Number(b.starting_balance);
  if (!Number.isFinite(bal) || bal < 0) throw bad('Starting balance must be zero or more');
  const off = b.utc_offset === undefined ? (existing?.utc_offset ?? 0) : Number(b.utc_offset);
  if (!Number.isFinite(off) || off < -14 || off > 14) throw bad('Server UTC offset must be between -14 and 14 hours');
  return {
    name: b.name !== undefined ? str(b.name, 60, 'Account name', true) : existing.name,
    broker: b.broker !== undefined ? str(b.broker, 60, 'Broker') : (existing?.broker || ''),
    platform, currency: b.currency !== undefined ? str(b.currency, 8, 'Currency', true).toUpperCase() : (existing?.currency || 'USD'),
    starting_balance: bal, utc_offset: off,
  };
}
route('POST', '/api/accounts', (ctx) => {
  const u = requireUser(ctx);
  const have = q.get('SELECT COUNT(*) AS n FROM accounts WHERE user_id = ?', u.id).n;
  needPlan(u, have < limits(u).accounts, `Your ${planInfo(u).name} plan includes ${limits(u).accounts} trading account${limits(u).accounts === 1 ? '' : 's'}. Upgrade to add more.`);
  const f = accountFields({ currency: u.currency, ...ctx.body });
  const r = q.run('INSERT INTO accounts (user_id, name, broker, platform, currency, starting_balance, utc_offset) VALUES (?,?,?,?,?,?,?)', u.id, f.name, f.broker, f.platform, f.currency, f.starting_balance, f.utc_offset);
  return { account: publicAccount(q.get('SELECT * FROM accounts WHERE id = ?', Number(r.lastInsertRowid))) };
});
route('PATCH', '/api/accounts/:id', (ctx) => {
  const u = requireUser(ctx); const a = ownedAccount(u, ctx.params.id);
  const f = accountFields(ctx.body, a);
  q.run('UPDATE accounts SET name=?, broker=?, platform=?, currency=?, starting_balance=?, utc_offset=? WHERE id=?', f.name, f.broker, f.platform, f.currency, f.starting_balance, f.utc_offset, a.id);
  return { account: publicAccount(q.get('SELECT * FROM accounts WHERE id = ?', a.id)) };
});
route('DELETE', '/api/accounts/:id', (ctx) => {
  const u = requireUser(ctx); const a = ownedAccount(u, ctx.params.id);
  require('./lib/metaapi').removeAccount(a.metaapi_id); // stop the cloud connection (and its billing) in the background
  q.run('DELETE FROM accounts WHERE id = ?', a.id);
  return { ok: true };
});
route('POST', '/api/accounts/:id/api-key', (ctx) => {
  const u = requireUser(ctx); const a = ownedAccount(u, ctx.params.id);
  needPlan(u, limits(u).mt5, 'Live MT5 sync is included in Starter and above. Upgrade to connect MT5.');
  const key = `jpx_${crypto.randomBytes(24).toString('hex')}`;
  q.run('UPDATE accounts SET api_key_hash = ?, api_key_prefix = ? WHERE id = ?', sha(key), key.slice(0, 8), a.id);
  return { api_key: key, note: 'Copy this key now. It is shown only once.' };
});
route('DELETE', '/api/accounts/:id/api-key', (ctx) => {
  const u = requireUser(ctx); const a = ownedAccount(u, ctx.params.id);
  q.run('UPDATE accounts SET api_key_hash = NULL, api_key_prefix = NULL WHERE id = ?', a.id);
  return { ok: true };
});

// ---- Trades
route('GET', '/api/trades', (ctx) => {
  const u = requireUser(ctx);
  let rows = loadTrades(u, ctx.query);
  const total = rows.length;
  const sort = ctx.query.sort || 'close_desc';
  const sorters = { close_asc: (a, b) => (a.close_time < b.close_time ? -1 : 1), net_desc: (a, b) => b.net - a.net, net_asc: (a, b) => a.net - b.net };
  if (sorters[sort]) rows = rows.sort(sorters[sort]);
  const limit = intParam(ctx.query.limit, 25, 1, 200); const page = intParam(ctx.query.page, 1, 1, 100000);
  const sums = rows.reduce((s, r) => { s.net += r.net; if (r.net > 0) s.wins++; return s; }, { net: 0, wins: 0 });
  return { total, page, limit, net: Math.round(sums.net * 100) / 100, wins: sums.wins, trades: rows.slice((page - 1) * limit, page * limit) };
});

route('GET', '/api/trades/facets', (ctx) => {
  const u = requireUser(ctx);
  return {
    symbols: q.all("SELECT DISTINCT symbol AS v FROM trades WHERE user_id = ? ORDER BY symbol", u.id).map((r) => r.v),
    setups: q.all("SELECT DISTINCT setup AS v FROM trades WHERE user_id = ? AND setup != '' ORDER BY setup", u.id).map((r) => r.v),
  };
});

function tradeFromBody(user, account, body, existing) {
  const tz = user.timezone;
  const raw = { ...(existing || {}), ...body };
  raw.open_time = zonedToUtc(raw.open_time, tz) || raw.open_time;
  raw.close_time = zonedToUtc(raw.close_time, tz) || raw.close_time;
  const res = normalizeTrade(raw, { offsetHours: 0 });
  if (!res.ok) throw bad(res.error);
  return res.trade;
}

route('POST', '/api/trades', (ctx) => {
  const u = requireUser(ctx);
  const a = ownedAccount(u, ctx.body.account_id);
  const t = tradeFromBody(u, a, { ...ctx.body, external_id: null });
  const r = insertTrade(u.id, a.id, t, 'manual');
  return { trade: q.get('SELECT * FROM trades WHERE id = ?', Number(r.lastInsertRowid)) };
});
function ownedTrade(user, id) {
  const t = q.get('SELECT * FROM trades WHERE id = ? AND user_id = ?', Number(id), user.id);
  if (!t) throw new HttpError(404, 'Trade not found');
  return t;
}
route('GET', '/api/trades/:id', (ctx) => ({ trade: ownedTrade(requireUser(ctx), ctx.params.id) }));
route('PATCH', '/api/trades/:id', (ctx) => {
  const u = requireUser(ctx); const old = ownedTrade(u, ctx.params.id);
  const body = { ...ctx.body }; delete body.external_id; delete body.account_id;
  const t = tradeFromBody(u, null, body, old);
  q.run(`UPDATE trades SET symbol=?, side=?, volume=?, entry_price=?, exit_price=?, stop_loss=?, take_profit=?, open_time=?, close_time=?, profit=?, commission=?, swap=?, net=?, risk_amount=?, setup=?, tags=?, emotion=?, mistakes=?, rating=?, notes=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
    t.symbol, t.side, t.volume, t.entry_price, t.exit_price, t.stop_loss, t.take_profit, t.open_time, t.close_time, t.profit, t.commission, t.swap, t.net, t.risk_amount, t.setup, t.tags, t.emotion, t.mistakes, t.rating, t.notes, old.id);
  return { trade: q.get('SELECT * FROM trades WHERE id = ?', old.id) };
});
route('DELETE', '/api/trades/:id', (ctx) => {
  const u = requireUser(ctx); const t = ownedTrade(u, ctx.params.id);
  q.run('DELETE FROM trades WHERE id = ?', t.id);
  return { ok: true };
});
route('POST', '/api/trades/bulk-delete', (ctx) => {
  const u = requireUser(ctx);
  const ids = Array.isArray(ctx.body.ids) ? ctx.body.ids.map(Number).filter(Number.isInteger).slice(0, 1000) : [];
  if (!ids.length) throw bad('Select at least one trade');
  const n = q.tx(() => ids.reduce((c, id) => c + Number(q.run('DELETE FROM trades WHERE id = ? AND user_id = ?', id, u.id).changes), 0));
  return { deleted: n };
});

// ---- Import
function dedupeKey(t) { return [t.symbol, t.side, t.open_time, t.close_time, t.volume, t.profit].join('|'); }
route('POST', '/api/import', (ctx) => {
  const u = requireUser(ctx); const a = ownedAccount(u, ctx.body.account_id);
  const text = String(ctx.body.text || '');
  if (!text.trim()) throw bad('The file is empty');
  const { trades, errors } = parseTradeCSV(text, a.utc_offset);
  if (!trades.length && errors.length) return { imported: 0, skipped: 0, errors: errors.slice(0, 20), errorCount: errors.length };
  let imported = 0, skipped = 0;
  q.tx(() => {
    const existing = new Set(q.all('SELECT symbol, side, open_time, close_time, volume, profit FROM trades WHERE account_id = ?', a.id).map(dedupeKey));
    for (const t of trades) {
      const k = dedupeKey(t);
      if (existing.has(k)) { skipped++; continue; }
      try { insertTrade(u.id, a.id, t, 'csv'); existing.add(k); imported++; }
      catch (e) { if (/UNIQUE/.test(e.message)) skipped++; else throw e; }
    }
  });
  return { imported, skipped, errors: errors.slice(0, 20), errorCount: errors.length };
});

function ingestForAccount(a, list, openList, source) {
  let inserted = 0, updated = 0, signals = 0; const errors = [];
  q.tx(() => {
    list.forEach((raw, i) => {
      if (!raw || !raw.external_id) { errors.push({ index: i, error: 'external_id (ticket) is required' }); return; }
      const res = normalizeTrade(raw, { offsetHours: a.utc_offset });
      if (!res.ok) { errors.push({ index: i, error: res.error }); return; }
      const t = res.trade;
      const ex = q.get('SELECT id FROM trades WHERE account_id = ? AND external_id = ?', a.id, t.external_id);
      if (ex) {
        q.run(`UPDATE trades SET symbol=?, side=?, volume=?, entry_price=?, exit_price=?, stop_loss=?, take_profit=?, open_time=?, close_time=?, profit=?, commission=?, swap=?, net=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
          t.symbol, t.side, t.volume, t.entry_price, t.exit_price, t.stop_loss, t.take_profit, t.open_time, t.close_time, t.profit, t.commission, t.swap, t.net, ex.id);
        updated++;
        try { copy.publishClosedTrade(q.get('SELECT * FROM trades WHERE id = ?', ex.id), insertTrade); } catch (e) { console.error(e); }
      } else {
        const mir = q.get("SELECT m.id, lp.alias FROM mirrors m JOIN follows f ON f.id = m.follow_id JOIN signals s ON s.id = m.signal_id JOIN leader_profiles lp ON lp.user_id = s.leader_user_id WHERE f.follower_account_id = ? AND m.open_ticket = ?", a.id, t.external_id);
        if (mir) { t.setup = `Copy · ${mir.alias}`; t.tags = 'copy-trade'; }
        insertTrade(a.user_id, a.id, t, source || (a.platform === 'mt4' ? 'mt4' : 'mt5')); inserted++;
      }
    });
    openList.forEach((raw, i) => {
      const side = String(raw && raw.side || '').toLowerCase(), sym = String(raw && raw.symbol || '').toUpperCase().slice(0, 32);
      const vol = Number(raw && raw.volume), ref = raw && raw.external_id, opened = parseDT(raw && raw.open_time, a.utc_offset);
      if (!ref || !sym || !['buy', 'sell', 'long', 'short'].includes(side) || !(vol > 0) || !opened) { errors.push({ index: i, error: 'open position needs external_id, symbol, side, volume, open_time' }); return; }
      const prof = q.get('SELECT 1 FROM leader_profiles WHERE user_id = ? AND account_id = ?', a.user_id, a.id);
      if (!prof) return; // only strategy leaders publish live signals
      signals += copy.upsertOpenSignals(a.user_id, a.id, [{ ref: String(ref), symbol: sym, side: side === 'buy' || side === 'long' ? 'long' : 'short', volume: vol, entry_price: Number(raw.entry_price) || null, stop_loss: Number(raw.stop_loss) || null, take_profit: Number(raw.take_profit) || null, opened_at: opened }]);
    });
    q.run("UPDATE accounts SET last_sync = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", a.id);
  });
  return { inserted, updated, signals, errors };
}

// ---- Broker ingest (MT5 Expert Advisor / any HTTP client) — API-key authenticated
route('POST', '/api/ingest', (ctx) => {
  const key = String(ctx.req.headers['x-api-key'] || '');
  if (!/^jpx_[0-9a-f]{48}$/.test(key)) throw new HttpError(401, 'Missing or malformed X-API-Key header');
  rateLimit(`ing:${sha(key)}`, 120, 60000);
  const a = q.get('SELECT * FROM accounts WHERE api_key_hash = ?', sha(key));
  if (!a) throw new HttpError(401, 'Invalid API key');
  const owner = q.get('SELECT * FROM users WHERE id = ?', a.user_id);
  if (!owner || owner.status !== 'active') throw new HttpError(403, 'Account owner is suspended');
  const list = Array.isArray(ctx.body.trades) ? ctx.body.trades : [];
  const openList = Array.isArray(ctx.body.open_positions) ? ctx.body.open_positions : [];
  if (!list.length && !openList.length) throw bad('Body must contain a non-empty "trades" or "open_positions" array');
  if (list.length > 500 || openList.length > 200) throw bad('Too many items in one request');
  return ingestForAccount(a, list, openList);
}, { public: true, noCsrf: true });

route('GET', '/api/ingest/ping', (ctx) => {
  const key = String(ctx.req.headers['x-api-key'] || '');
  if (!/^jpx_[0-9a-f]{48}$/.test(key)) throw new HttpError(401, 'Missing or malformed X-API-Key header');
  rateLimit(`ping:${sha(key)}`, 30, 60000);
  const a = q.get('SELECT id, name FROM accounts WHERE api_key_hash = ?', sha(key));
  if (!a) throw new HttpError(401, 'Invalid API key');
  const last = q.get('SELECT MAX(close_time) AS t FROM trades WHERE account_id = ? AND external_id IS NOT NULL', a.id);
  return { ok: true, account: a.name, last_close_time: last.t };
}, { public: true });

// ---- Analytics
route('GET', '/api/analytics', (ctx) => {
  const u = requireUser(ctx);
  const rows = loadTrades(u, ctx.query);
  const useStart = !ctx.query.from && !ctx.query.to && !ctx.query.symbol && !ctx.query.setup && !ctx.query.side && !ctx.query.result;
  const out = analyze(rows, { tz: u.timezone, startingBalance: useStart ? startingBalance(u, ctx.query.account_id) : 0 });
  if (!limits(u).advancedAnalytics) {
    for (const k of ['byHour', 'byWeekday', 'bySymbol', 'bySetup', 'bySide', 'byTag', 'rBuckets']) out[k] = [];
    out.locked = true;
  }
  return out;
});

route('GET', '/api/export/trades.csv', (ctx) => {
  const u = requireUser(ctx);
  const rows = loadTrades(u, ctx.query).reverse();
  const cols = ['account_name', 'external_id', 'symbol', 'side', 'volume', 'entry_price', 'exit_price', 'stop_loss', 'take_profit', 'open_time', 'close_time', 'profit', 'commission', 'swap', 'net', 'risk_amount', 'setup', 'tags', 'emotion', 'mistakes', 'rating', 'notes'];
  const esc = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s) && isNaN(Number(s))) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  return { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="jpx-trades.csv"' }, raw: csv };
});

// ---- Journal
route('GET', '/api/journal', (ctx) => {
  const u = requireUser(ctx);
  const params = [u.id]; let where = 'user_id = ?';
  if (ctx.query.from) { where += ' AND date >= ?'; params.push(ctx.query.from); }
  if (ctx.query.to) { where += ' AND date <= ?'; params.push(ctx.query.to); }
  return { entries: q.all(`SELECT * FROM journal WHERE ${where} ORDER BY date DESC LIMIT 400`, ...params) };
});
route('PUT', '/api/journal/:date', (ctx) => {
  const u = requireUser(ctx);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ctx.params.date)) throw bad('Date must be YYYY-MM-DD');
  const b = ctx.body;
  const e = { mood: str(b.mood, 30, 'Mood'), plan: str(b.plan, 10000, 'Plan'), content: str(b.content, 20000, 'Review'), lessons: str(b.lessons, 10000, 'Lessons') };
  if (!e.mood && !e.plan && !e.content && !e.lessons) {
    q.run('DELETE FROM journal WHERE user_id = ? AND date = ?', u.id, ctx.params.date);
    return { entry: null };
  }
  q.run(`INSERT INTO journal (user_id, date, mood, plan, content, lessons) VALUES (?,?,?,?,?,?)
         ON CONFLICT(user_id, date) DO UPDATE SET mood=excluded.mood, plan=excluded.plan, content=excluded.content, lessons=excluded.lessons, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    u.id, ctx.params.date, e.mood, e.plan, e.content, e.lessons);
  return { entry: q.get('SELECT * FROM journal WHERE user_id = ? AND date = ?', u.id, ctx.params.date) };
});

// ---- Risk
function getRules(uid) { return q.get('SELECT * FROM risk_rules WHERE user_id = ?', uid) || { user_id: uid, max_daily_loss: null, max_trades_per_day: null, max_consecutive_losses: null, max_risk_per_trade: null }; }
route('GET', '/api/risk/rules', (ctx) => ({ rules: getRules(requireUser(ctx).id) }));
route('PUT', '/api/risk/rules', (ctx) => {
  const u = requireUser(ctx); const b = ctx.body;
  const pos = (v, name, int) => { if (v === '' || v == null) return null; const n = Number(v); if (!Number.isFinite(n) || n <= 0 || (int && !Number.isInteger(n))) throw bad(`${name} must be a positive ${int ? 'whole ' : ''}number`); return n; };
  const r = { a: pos(b.max_daily_loss, 'Max daily loss'), b: pos(b.max_trades_per_day, 'Max trades per day', true), c: pos(b.max_consecutive_losses, 'Max consecutive losses', true), d: pos(b.max_risk_per_trade, 'Max risk per trade') };
  q.run(`INSERT INTO risk_rules (user_id, max_daily_loss, max_trades_per_day, max_consecutive_losses, max_risk_per_trade) VALUES (?,?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET max_daily_loss=excluded.max_daily_loss, max_trades_per_day=excluded.max_trades_per_day, max_consecutive_losses=excluded.max_consecutive_losses, max_risk_per_trade=excluded.max_risk_per_trade`, u.id, r.a, r.b, r.c, r.d);
  return { rules: getRules(u.id) };
});
route('GET', '/api/risk/status', (ctx) => {
  const u = requireUser(ctx); const rules = getRules(u.id);
  const today = localParts(new Date().toISOString(), u.timezone).date;
  const all = q.all('SELECT net, risk_amount, close_time FROM trades WHERE user_id = ? AND close_time >= ? ORDER BY close_time DESC, id DESC', u.id, new Date(Date.now() - 3 * 86400000).toISOString());
  const todays = all.filter((t) => localParts(t.close_time, u.timezone).date === today);
  const net = todays.reduce((s, t) => s + t.net, 0);
  let streak = 0; for (const t of todays) { if (t.net < 0) streak++; else break; }
  const maxRisk = todays.reduce((m, t) => Math.max(m, t.risk_amount || 0), 0);
  const checks = [
    { key: 'max_daily_loss', label: 'Daily loss', limit: rules.max_daily_loss, value: Math.max(0, -net), breached: rules.max_daily_loss != null && -net >= rules.max_daily_loss },
    { key: 'max_trades_per_day', label: 'Trades today', limit: rules.max_trades_per_day, value: todays.length, breached: rules.max_trades_per_day != null && todays.length >= rules.max_trades_per_day },
    { key: 'max_consecutive_losses', label: 'Losses in a row', limit: rules.max_consecutive_losses, value: streak, breached: rules.max_consecutive_losses != null && streak >= rules.max_consecutive_losses },
    { key: 'max_risk_per_trade', label: 'Largest risk today', limit: rules.max_risk_per_trade, value: maxRisk, breached: rules.max_risk_per_trade != null && maxRisk > rules.max_risk_per_trade },
  ];
  return { date: today, net: Math.round(net * 100) / 100, trades: todays.length, checks };
});

// ---- Contact form (public) + admin inbox
route('POST', '/api/contact', (ctx) => {
  rateLimit(`contact:${ctx.ip}`, 5, 3600000);
  const b = ctx.body;
  if (b.website) return { ok: true }; // honeypot field: bots fill it, humans never see it
  const name = str(b.name, 80, 'Name', true);
  const email = str(b.email, 200, 'Email', true).toLowerCase();
  if (!EMAIL_RE.test(email)) throw bad('Enter a valid email address');
  const message = str(b.message, 4000, 'Message', true);
  if (message.length < 10) throw bad('Please write a little more so we can help');
  q.run('INSERT INTO contact_messages (name, email, message) VALUES (?,?,?)', name, email, message);
  return { ok: true };
}, { public: true });
route('GET', '/api/admin/messages', (ctx) => {
  requireAdmin(ctx);
  return { messages: q.all('SELECT * FROM contact_messages ORDER BY id DESC LIMIT 200') };
});
route('DELETE', '/api/admin/messages/:id', (ctx) => {
  const a = requireAdmin(ctx);
  q.run('DELETE FROM contact_messages WHERE id = ?', Number(ctx.params.id));
  audit(a.id, 'deleted contact message', ctx.params.id);
  return { ok: true };
});

// ---- Admin
route('GET', '/api/admin/stats', (ctx) => {
  requireAdmin(ctx);
  const day = new Date(Date.now() - 86400000).toISOString(), week = new Date(Date.now() - 7 * 86400000).toISOString();
  return {
    users: q.get('SELECT COUNT(*) AS n FROM users').n,
    active_users: q.get("SELECT COUNT(*) AS n FROM users WHERE status='active'").n,
    suspended: q.get("SELECT COUNT(*) AS n FROM users WHERE status='suspended'").n,
    admins: q.get("SELECT COUNT(*) AS n FROM users WHERE role='admin'").n,
    new_week: q.get('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', week).n,
    active_day: q.get('SELECT COUNT(*) AS n FROM users WHERE last_login >= ?', day).n,
    accounts: q.get('SELECT COUNT(*) AS n FROM accounts').n,
    synced_accounts: q.get('SELECT COUNT(*) AS n FROM accounts WHERE api_key_hash IS NOT NULL').n,
    trades: q.get('SELECT COUNT(*) AS n FROM trades').n,
    trades_by_source: q.all('SELECT source AS key, COUNT(*) AS count FROM trades GROUP BY source'),
    signups: q.all("SELECT substr(created_at,1,10) AS date, COUNT(*) AS count FROM users WHERE created_at >= ? GROUP BY 1 ORDER BY 1", new Date(Date.now() - 30 * 86400000).toISOString()),
    audit: q.all('SELECT l.id, l.action, l.target, l.created_at, u.email AS actor FROM audit_log l LEFT JOIN users u ON u.id = l.actor_id ORDER BY l.id DESC LIMIT 15'),
  };
});
route('GET', '/api/admin/users', (ctx) => {
  requireAdmin(ctx);
  const like = ctx.query.q ? `%${String(ctx.query.q).replace(/[%_\\]/g, '\\$&')}%` : '%';
  const users = q.all(`SELECT u.*, (SELECT COUNT(*) FROM trades t WHERE t.user_id = u.id) AS trades, (SELECT COUNT(*) FROM accounts a WHERE a.user_id = u.id) AS accounts
                       FROM users u WHERE u.email LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' ORDER BY u.id DESC LIMIT 500`, like, like);
  return { users: users.map((u) => ({ ...publicUser(u), last_login: u.last_login, trades: u.trades, accounts: u.accounts })) };
});
route('PATCH', '/api/admin/users/:id', (ctx) => {
  const admin = requireAdmin(ctx); const id = Number(ctx.params.id);
  const target = q.get('SELECT * FROM users WHERE id = ?', id);
  if (!target) throw new HttpError(404, 'User not found');
  const role = ctx.body.role ?? target.role, status = ctx.body.status ?? target.status;
  if (!['user', 'admin'].includes(role) || !['active', 'suspended'].includes(status)) throw bad('Invalid role or status');
  const losesAdmin = target.role === 'admin' && target.status === 'active' && (role !== 'admin' || status !== 'active');
  if (losesAdmin && q.get("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND status='active'").n <= 1) throw bad('At least one active admin is required');
  q.run('UPDATE users SET role = ?, status = ? WHERE id = ?', role, status, id);
  if (status === 'suspended') q.run('DELETE FROM sessions WHERE user_id = ?', id);
  audit(admin.id, `set role=${role}, status=${status}`, target.email);
  return { ok: true };
});
route('POST', '/api/admin/users/:id/reset-password', async (ctx) => {
  const admin = requireAdmin(ctx); const target = q.get('SELECT * FROM users WHERE id = ?', Number(ctx.params.id));
  if (!target) throw new HttpError(404, 'User not found');
  const temp = crypto.randomBytes(9).toString('base64url');
  q.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(temp), target.id);
  q.run('DELETE FROM sessions WHERE user_id = ?', target.id);
  audit(admin.id, 'reset password', target.email);
  return { temporary_password: temp };
});
route('DELETE', '/api/admin/users/:id', (ctx) => {
  const admin = requireAdmin(ctx); const target = q.get('SELECT * FROM users WHERE id = ?', Number(ctx.params.id));
  if (!target) throw new HttpError(404, 'User not found');
  if (target.id === admin.id) throw bad('Use Settings to delete your own account');
  for (const x of q.all('SELECT metaapi_id FROM accounts WHERE user_id = ? AND metaapi_id IS NOT NULL', target.id)) require('./lib/metaapi').removeAccount(x.metaapi_id);
  q.run('DELETE FROM users WHERE id = ?', target.id);
  audit(admin.id, 'deleted user', target.email);
  return { ok: true };
});

require('./lib/routes-extra')({ route, q, HttpError, bad, requireUser, requireAdmin, str, rateLimit, sha, EMAIL_RE, audit, limits, needPlan, loadTrades, analyze, publicUser, ingestForAccount, hashPassword, publicAccount });
require('./lib/metaapi').start({ ingestForAccount });

/* ------------------------------------------------------------------ static + dispatch */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.mq5': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
const PAGES = { '/': 'index.html', '/app': 'app.html', '/login': 'app.html', '/register': 'app.html' };

function serveStatic(req, res, pathname) {
  let rel = PAGES[pathname] || decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden', SEC_HEADERS);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found', SEC_HEADERS);
    const ext = path.extname(file);
    const headers = { ...SEC_HEADERS, 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300' };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname.replace(/(.)\/+$/, '$1');
  try {
    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', SEC_HEADERS);
      return serveStatic(req, res, pathname);
    }
    const r = routes.find((x) => x.method === req.method && x.re.test(pathname));
    if (!r) return send(res, 404, { error: 'Endpoint not found' }, SEC_HEADERS);
    const m = pathname.match(r.re);
    const ctx = { req, res, params: m.groups || {}, query: Object.fromEntries(url.searchParams), ip: clientIp(req), body: {}, user: null };
    if (!r.opts.noCsrf && req.method !== 'GET') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Cross-origin request blocked');
      if (req.headers['x-requested-with'] !== 'jpx') throw new HttpError(403, 'Missing request header');
    }
    ctx.user = authUser(req);
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) ctx.body = await readBody(req, undefined, ctx);
    const out = await r.handler(ctx);
    if (out && out.raw !== undefined) return send(res, out.status || 200, out.raw, { ...SEC_HEADERS, ...out.headers });
    if (out && out.status && out.body) return send(res, out.status, out.body, { ...SEC_HEADERS, ...out.headers });
    return send(res, 200, out, SEC_HEADERS);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message }, SEC_HEADERS);
    console.error(e);
    return send(res, 500, { error: 'Something went wrong on our side. Please try again.' }, SEC_HEADERS);
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`JPX Traders running on http://${HOST}:${PORT}`));
}
module.exports = { server };
