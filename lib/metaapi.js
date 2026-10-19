'use strict';
/* Automatic trade import through MetaApi (metaapi.cloud).
   - Provisioning API creates a cloud MT4/MT5 connection from the user's login, password and broker server.
   - Client REST API returns history deals and open positions, which we convert into journal trades.
   The password is sent to MetaApi once and is never stored by this app. */
const { q } = require('./db');

const token = () => process.env.METAAPI_TOKEN || '';
const configured = () => !!token();
const PROV = () => (process.env.METAAPI_PROVISIONING_URL || 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai').replace(/\/$/, '');
const clientBase = (region) => (process.env.METAAPI_CLIENT_URL || 'https://mt-client-api-v1.{region}.agiliumtrade.ai').replace('{region}', region || 'new-york').replace(/\/$/, '');
const POLL_MS = Math.max(15, Number(process.env.METAAPI_POLL_SECONDS || 60)) * 1000;
const CONNECT_TIMEOUT_MS = 10 * 60 * 1000;

class MetaApiError extends Error { constructor(status, message, retry) { super(message); this.status = status; this.retry = !!retry; } }

async function call(method, url, body) {
  let r;
  try {
    r = await fetch(url, { method, headers: { 'auth-token': token(), 'Content-Type': 'application/json', Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  } catch (e) { throw new MetaApiError(0, 'Could not reach MetaApi: ' + e.message, true); }
  const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (r.status === 202) throw new MetaApiError(202, 'MetaApi is still preparing this account', true);
  if (r.status === 429) throw new MetaApiError(429, 'MetaApi rate limit reached', true);
  if (!r.ok) throw new MetaApiError(r.status, (j && (j.message || j.error)) || `MetaApi request failed (${r.status})`, r.status >= 500);
  return j;
}

async function createAccount({ name, login, password, server, platform }) {
  return call('POST', PROV() + '/users/current/accounts', { name, login: String(login), password, server, platform, type: 'cloud-g2', magic: 0, application: 'MetaApi', reliability: 'regular' });
}
const getAccount = (id) => call('GET', PROV() + `/users/current/accounts/${encodeURIComponent(id)}`);
async function removeAccount(id) {
  if (!id || !configured()) return;
  try { await call('POST', PROV() + `/users/current/accounts/${encodeURIComponent(id)}/undeploy`); } catch { /* may already be undeployed */ }
  try { await call('DELETE', PROV() + `/users/current/accounts/${encodeURIComponent(id)}`); } catch (e) { console.error('metaapi remove failed:', e.message); }
}

async function fetchDeals(id, region, from, to) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await call('GET', `${clientBase(region)}/users/current/accounts/${encodeURIComponent(id)}/history-deals/time/${from.toISOString()}/${to.toISOString()}?offset=${offset}&limit=1000`);
    const rows = Array.isArray(page) ? page : [];
    out.push(...rows);
    if (rows.length < 1000 || offset > 20000) break;
  }
  return out;
}
const fetchPositions = (id, region) => call('GET', `${clientBase(region)}/users/current/accounts/${encodeURIComponent(id)}/positions`).then((r) => (Array.isArray(r) ? r : []));
const fetchPositionDeals = (id, region, pid) => call('GET', `${clientBase(region)}/users/current/accounts/${encodeURIComponent(id)}/history-deals/position/${encodeURIComponent(pid)}`).then((r) => (Array.isArray(r) ? r : []));

const isTrade = (d) => d.type === 'DEAL_TYPE_BUY' || d.type === 'DEAL_TYPE_SELL';
const isIn = (d) => d.entryType === 'DEAL_ENTRY_IN';
const isOut = (d) => d.entryType === 'DEAL_ENTRY_OUT' || d.entryType === 'DEAL_ENTRY_OUT_BY' || d.entryType === 'DEAL_ENTRY_INOUT';

/** Turn MetaApi deals into fully closed positions (one journal trade per position). */
function buildTrades(deals, openIds = new Set()) {
  const byPos = new Map();
  for (const d of deals) {
    if (!isTrade(d)) continue; // balance, credit, etc.
    const pid = String(d.positionId || d.orderId || d.id);
    if (!byPos.has(pid)) byPos.set(pid, []);
    byPos.get(pid).push(d);
  }
  const trades = [], needIn = [];
  for (const [pid, ds] of byPos) {
    if (openIds.has(pid)) continue; // still open (maybe partially closed)
    const ins = ds.filter(isIn).sort((a, b) => a.time.localeCompare(b.time)), outs = ds.filter(isOut).sort((a, b) => a.time.localeCompare(b.time));
    if (!outs.length) continue;
    if (!ins.length) { needIn.push(pid); continue; }
    const sum = (arr, f) => arr.reduce((s, d) => s + (Number(d[f]) || 0), 0);
    const wavg = (arr) => { const v = sum(arr, 'volume'); return v > 0 ? arr.reduce((s, d) => s + d.price * d.volume, 0) / v : null; };
    trades.push({
      external_id: pid, symbol: ins[0].symbol, side: ins[0].type === 'DEAL_TYPE_BUY' ? 'buy' : 'sell', volume: sum(ins, 'volume'),
      entry_price: wavg(ins), exit_price: wavg(outs), open_time: ins[0].time, close_time: outs[outs.length - 1].time,
      profit: Math.round(sum(ds, 'profit') * 100) / 100, commission: Math.round(sum(ds, 'commission') * 100) / 100, swap: Math.round(sum(ds, 'swap') * 100) / 100,
    });
  }
  return { trades, needIn };
}

let ingestFn = null;
const running = new Set();
const nowIso = () => new Date().toISOString();
const setStatus = (id, status, error) => q.run('UPDATE accounts SET metaapi_status = ?, metaapi_error = ? WHERE id = ?', status, error || null, id);

async function syncAccount(acct) {
  if (running.has(acct.id)) return { skipped: true };
  running.add(acct.id);
  try {
    const to = new Date(Date.now() + 60000), from = acct.last_poll ? new Date(Date.parse(acct.last_poll) - 3 * 86400000) : new Date(Date.now() - 180 * 86400000);
    const [deals, positions] = await Promise.all([fetchDeals(acct.metaapi_id, acct.metaapi_region, from, to), fetchPositions(acct.metaapi_id, acct.metaapi_region)]);
    const openIds = new Set(positions.map((p) => String(p.id)));
    let { trades, needIn } = buildTrades(deals, openIds);
    for (const pid of needIn.slice(0, 25)) { // positions opened before the window: fetch their opening deal
      const all = await fetchPositionDeals(acct.metaapi_id, acct.metaapi_region, pid).catch(() => []);
      trades = trades.concat(buildTrades(all, openIds).trades);
    }
    const openList = positions.map((p) => ({ external_id: String(p.id), symbol: p.symbol, side: p.type === 'POSITION_TYPE_BUY' ? 'buy' : 'sell', volume: p.volume, open_time: p.time, entry_price: p.openPrice, stop_loss: p.stopLoss, take_profit: p.takeProfit }));
    const fresh = q.get('SELECT * FROM accounts WHERE id = ?', acct.id);
    if (!fresh || !fresh.metaapi_id) return { skipped: true };
    const res = ingestFn(fresh, trades, openList, 'metaapi');
    q.run("UPDATE accounts SET last_poll = ?, metaapi_status = 'connected', metaapi_error = NULL WHERE id = ?", nowIso(), acct.id);
    return { ...res, deals: deals.length, open: positions.length };
  } catch (e) {
    if (e instanceof MetaApiError && [401, 403, 404].includes(e.status)) setStatus(acct.id, 'error', e.message);
    else q.run('UPDATE accounts SET metaapi_error = ? WHERE id = ?', String(e.message).slice(0, 300), acct.id);
    throw e;
  } finally { running.delete(acct.id); }
}

/** One scheduler pass: finish connecting accounts and refresh connected ones. */
async function tick() {
  if (!configured() || !ingestFn) return;
  const rows = q.all(`SELECT a.* FROM accounts a JOIN users u ON u.id = a.user_id WHERE a.metaapi_id IS NOT NULL AND u.status = 'active' AND a.metaapi_status IN ('connecting','connected') ORDER BY COALESCE(a.last_poll, '') LIMIT 40`);
  for (const a of rows) {
    try {
      if (a.metaapi_status === 'connecting') {
        const info = await getAccount(a.metaapi_id);
        if (info.region && info.region !== a.metaapi_region) q.run('UPDATE accounts SET metaapi_region = ? WHERE id = ?', info.region, a.id);
        if (info.connectionStatus === 'CONNECTED') { await syncAccount({ ...a, metaapi_region: info.region || a.metaapi_region }); continue; }
        if (Date.now() - Date.parse(a.metaapi_since || a.created_at) > CONNECT_TIMEOUT_MS && !a.last_poll) setStatus(a.id, 'error', 'Could not connect. Check the login, password and broker server name, then connect again.');
        continue;
      }
      if (!a.last_poll || Date.now() - Date.parse(a.last_poll) >= POLL_MS - 1000) await syncAccount(a);
    } catch (e) { console.error(`metaapi sync account ${a.id}:`, e.message); }
  }
}

function start({ ingestForAccount }) {
  ingestFn = ingestForAccount;
  if (process.env.JPX_NO_BACKGROUND === '1') return;
  const t = setInterval(() => { tick().catch((e) => console.error('metaapi tick', e)); }, Math.min(30000, POLL_MS));
  t.unref();
}

module.exports = { configured, createAccount, getAccount, removeAccount, syncAccount, tick, buildTrades, start, MetaApiError };
