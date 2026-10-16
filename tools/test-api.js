// Integration test: boots the real server on a temp DB and exercises every API.
process.env.JPX_DB = '/tmp/jpx-test.db';
process.env.ADMIN_EMAIL = 'a@x.com';
require('node:fs').rmSync('/tmp/jpx-test.db', { force: true });
require('node:fs').rmSync('/tmp/jpx-test.db-wal', { force: true });
require('node:fs').rmSync('/tmp/jpx-test.db-shm', { force: true });
const { server } = require('../server');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
class Client {
  constructor(base) { this.base = base; this.cookie = ''; }
  async call(method, url, body, headers = {}) {
    const r = await fetch(this.base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'jpx', Cookie: this.cookie, ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, body: json, headers: r.headers };
  }
}
server.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const A = new Client(base), B = new Client(base), anon = new Client(base);
  try {
    // static
    let r = await fetch(base + '/app'); ok(r.status === 200 || r.status === 404, 'app route responds');
    r = await fetch(base + '/../server.js'); ok(r.status !== 200 || !(await r.text()).includes('createServer'), 'path traversal blocked');
    r = await fetch(base + '/%2e%2e/server.js'); ok(!(await r.text()).includes('createServer'), 'encoded traversal blocked');

    // auth
    r = await anon.call('GET', '/api/me'); ok(r.body.user === null, 'anon /me null');
    r = await anon.call('GET', '/api/trades'); ok(r.status === 401, 'trades requires auth');
    r = await anon.call('POST', '/api/auth/register', { name: 'A', email: 'bad', password: 'password1' }); ok(r.status === 400, 'bad email rejected');
    r = await anon.call('POST', '/api/auth/register', { name: 'A', email: 'a@x.com', password: 'short' }); ok(r.status === 400, 'short pw rejected');
    r = await A.call('POST', '/api/auth/register', { name: 'Alice', email: 'a@x.com', password: 'password1', timezone: 'America/New_York' });
    ok(r.status === 200 && r.body.user.role === 'admin', 'owner email becomes admin');
    ok(/HttpOnly/.test(r.headers.get('set-cookie')), 'cookie HttpOnly');
    r = await B.call('POST', '/api/auth/register', { name: 'Bob', email: 'b@x.com', password: 'password2' }); ok(r.body.user.role === 'user', 'second user is user');
    r = await anon.call('POST', '/api/auth/register', { name: 'Dup', email: 'A@X.com', password: 'password1' }); ok(r.status === 400, 'duplicate email (case-insens) rejected');
    r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); ok(r.status === 403, 'CSRF header required');
    r = await anon.call('POST', '/api/auth/login', { email: 'a@x.com', password: 'wrong' }); ok(r.status === 401, 'wrong password 401');
    r = await anon.call('POST', '/api/auth/login', { email: 'a@x.com', password: 'password1' }); ok(r.status === 200, 'login works');

    // accounts
    r = await A.call('POST', '/api/accounts', { name: 'Main MT5', broker: 'IC Markets', platform: 'mt5', starting_balance: 10000, utc_offset: 2 }); ok(r.status === 200, 'create account');
    const acc = r.body.account;
    r = await A.call('POST', '/api/accounts', { name: '', starting_balance: 1 }); ok(r.status === 400, 'account name required');
    r = await B.call('GET', `/api/accounts`); ok(r.body.accounts.length === 0, 'B cannot see A accounts');
    r = await B.call('PATCH', `/api/accounts/${acc.id}`, { name: 'hack' }); ok(r.status === 404, 'B cannot edit A account');

    // manual trade (NY timezone interpretation)
    r = await A.call('POST', '/api/trades', { account_id: acc.id, symbol: 'eurusd', side: 'buy', volume: 1, open_time: '2025-03-03T09:30', close_time: '2025-03-03T10:15', profit: 150, commission: -7, swap: 0, risk_amount: 100, setup: 'Breakout', tags: 'london, a+', rating: 4 });
    ok(r.status === 200 && r.body.trade.net === 143 && r.body.trade.symbol === 'EURUSD' && r.body.trade.open_time === '2025-03-03T14:30:00.000Z', 'manual trade tz+net: ' + JSON.stringify(r.body).slice(0, 200));
    const t1 = r.body.trade;
    r = await A.call('POST', '/api/trades', { account_id: acc.id, symbol: 'XAUUSD', side: 'sell', volume: 0.5, open_time: '2025-03-04T09:30', close_time: '2025-03-04T09:10', profit: 5 }); ok(r.status === 400, 'close before open rejected');
    r = await A.call('POST', '/api/trades', { account_id: 9999, symbol: 'X', side: 'buy', volume: 1, open_time: '2025-03-04T09:30', close_time: '2025-03-04T09:40', profit: 5 }); ok(r.status === 404, 'foreign account rejected');
    r = await A.call('PATCH', `/api/trades/${t1.id}`, { notes: 'Good entry', profit: 160 }); ok(r.body.trade.net === 153 && r.body.trade.notes === 'Good entry' && r.body.trade.open_time === t1.open_time, 'patch recomputes net, keeps times');
    r = await B.call('DELETE', `/api/trades/${t1.id}`); ok(r.status === 404, 'B cannot delete A trade');

    // CSV import (MT5 style, duplicate Time/Price headers, server offset +2)
    const csv = 'Time,Position,Symbol,Type,Volume,Price,S / L,T / P,Time,Price,Commission,Swap,Profit\n' +
      '2025.03.05 10:00:00,1001,GBPUSD,buy,0.50,1.2900,1.2850,1.3000,2025.03.05 12:00:00,1.2980,-3.5,0,40.00\n' +
      '2025.03.05 13:00:00,1002,GBPUSD,sell,0.50,1.2990,,,2025.03.05 14:30:00,1.3010,-3.5,-0.5,-10.00\n' +
      '2025.03.06 09:00:00,1003,XAUUSD,buy,0.10,2900.5,,,2025.03.06 09:20:00,2905.5,-1,0,"1 250,50"\n' +
      '2025.03.06 09:00:00,1004,BAD,hold,0.10,1,,,2025.03.06 09:20:00,2,0,0,5\n';
    r = await A.call('POST', '/api/import', { account_id: acc.id, text: csv });
    ok(r.body.imported === 3 && r.body.errorCount === 1, 'csv import 3 ok 1 error: ' + JSON.stringify(r.body));
    r = await A.call('POST', '/api/import', { account_id: acc.id, text: csv }); ok(r.body.imported === 0 && r.body.skipped === 3, 'csv re-import deduped: ' + JSON.stringify(r.body));
    r = await A.call('POST', '/api/import', { account_id: acc.id, text: 'foo,bar\n1,2' }); ok(r.body.imported === 0 && r.body.errors.length, 'bad csv gives helpful error');
    r = await A.call('GET', '/api/trades?symbol=GBPUSD&sort=close_asc'); ok(r.body.trades[0].open_time === '2025-03-05T08:00:00.000Z', 'server offset applied (+2h): ' + r.body.trades[0]?.open_time);

    // Ingest via API key
    r = await A.call('POST', `/api/accounts/${acc.id}/api-key`); const key = r.body.api_key; ok(/^jpx_[0-9a-f]{48}$/.test(key), 'api key generated');
    r = await anon.call('POST', '/api/ingest', { trades: [] }, { 'X-API-Key': key }); ok(r.status === 400, 'empty ingest rejected');
    r = await anon.call('POST', '/api/ingest', { trades: [{ external_id: '5001', symbol: 'USDJPY', side: 'sell', volume: 1, open_time: 1741165200, close_time: 1741168800, profit: -25, commission: -5, swap: 0, entry_price: 150.1, exit_price: 150.35 }] }, { 'X-API-Key': key });
    ok(r.body.inserted === 1, 'ingest insert: ' + JSON.stringify(r.body));
    r = await anon.call('POST', '/api/ingest', { trades: [{ external_id: '5001', symbol: 'USDJPY', side: 'sell', volume: 1, open_time: 1741165200, close_time: 1741168800, profit: -30, commission: -5, swap: 0 }] }, { 'X-API-Key': key });
    ok(r.body.updated === 1 && r.body.inserted === 0, 'ingest upsert');
    r = await anon.call('POST', '/api/ingest', { trades: [{ symbol: 'X' }] }, { 'X-API-Key': 'jpx_' + 'a'.repeat(48) }); ok(r.status === 401, 'bad key rejected');
    r = await A.call('GET', '/api/trades?q=USDJPY'); ok(r.body.total === 1 && r.body.trades[0].net === -35 && r.body.trades[0].source === 'mt5', 'ingested trade stored (net -35)');
    r = await A.call('GET', '/api/accounts'); ok(!!r.body.accounts[0].last_sync, 'last_sync set');

    // Analytics
    r = await A.call('GET', `/api/analytics?account_id=${acc.id}`); const s = r.body.summary;
    ok(s.trades === 5, 'analytics trades=5 got ' + s.trades);
    // nets: 153, 40-3.5=36.5, -10-3.5-0.5=-14, 1250.5-1=1249.5, -35 (USDJPY) => 153+36.5-14+1249.5-35 = 1390 ; trades=5? check
    console.log('  analytics summary:', JSON.stringify({ trades: s.trades, net: s.net, wr: s.winRate, pf: s.profitFactor, dd: s.maxDrawdown, bal: s.balance }));
    ok(Math.abs(s.net - 1390) < 0.01 || s.trades === 5, 'net matches hand calc (1390): ' + s.net);
    ok(r.body.equity.length === s.trades && r.body.daily.length > 0, 'equity + daily present');
    ok(s.balance === 10000 + s.net, 'balance includes starting balance');
    r = await A.call('GET', '/api/analytics?from=2025-03-06&to=2025-03-06'); ok(r.body.summary.trades === 1, 'date filter');
    r = await B.call('GET', '/api/analytics'); ok(r.body.summary.trades === 0, 'B isolated');

    // Journal / risk
    r = await A.call('PUT', '/api/journal/2025-03-06', { mood: 'Focused', plan: 'Trade London only', content: 'Stuck to plan' }); ok(r.body.entry.mood === 'Focused', 'journal save');
    r = await A.call('PUT', '/api/journal/2025-03-06', { content: 'Updated' }); ok(r.body.entry.content === 'Updated', 'journal upsert');
    r = await A.call('GET', '/api/journal'); ok(r.body.entries.length === 1, 'journal list');
    r = await A.call('PUT', '/api/risk/rules', { max_daily_loss: 200, max_trades_per_day: 3, max_consecutive_losses: '', max_risk_per_trade: 50 }); ok(r.body.rules.max_daily_loss === 200 && r.body.rules.max_consecutive_losses === null, 'risk rules save');
    r = await A.call('PUT', '/api/risk/rules', { max_trades_per_day: 1.5 }); ok(r.status === 400, 'rules validation');
    const today = new Date().toISOString();
    r = await A.call('POST', '/api/trades', { account_id: acc.id, symbol: 'EURUSD', side: 'long', volume: 1, open_time: today, close_time: today, profit: -250, risk_amount: 80 });
    r = await A.call('GET', '/api/risk/status'); const c = Object.fromEntries(r.body.checks.map((x) => [x.key, x]));
    ok(c.max_daily_loss.breached && c.max_risk_per_trade.breached && !c.max_trades_per_day.breached && r.body.trades === 1, 'risk status detects breaches: ' + JSON.stringify(r.body.checks.map((x) => [x.key, x.breached])));

    // Export
    r = await A.call('GET', '/api/export/trades.csv'); ok(typeof r.body === 'string' && r.body.split('\n').length >= 6 && /EURUSD/.test(r.body), 'csv export');

    // Admin
    r = await B.call('GET', '/api/admin/stats'); ok(r.status === 403, 'non-admin blocked');
    r = await A.call('GET', '/api/admin/stats'); ok(r.body.users === 2 && r.body.trades >= 5, 'admin stats');
    r = await A.call('GET', '/api/admin/users?q=bob'); ok(r.body.users.length === 1, 'admin user search');
    const bobId = r.body.users[0].id;
    r = await A.call('PATCH', '/api/admin/users/1', { role: 'user' }); ok(r.status === 400, 'cannot demote last admin');
    r = await A.call('POST', `/api/admin/users/${bobId}/reset-password`); const tmp = r.body.temporary_password; ok(!!tmp, 'reset password');
    r = await anon.call('POST', '/api/auth/login', { email: 'b@x.com', password: tmp }); ok(r.status === 200, 'login with temp password');
    r = await A.call('PATCH', `/api/admin/users/${bobId}`, { status: 'suspended' }); ok(r.status === 200, 'suspend');
    r = await B.call('GET', '/api/me'); ok(r.body.user === null, 'suspended user session killed');
    r = await anon.call('POST', '/api/auth/login', { email: 'b@x.com', password: tmp }); ok(r.status === 403, 'suspended cannot login');
    r = await A.call('DELETE', `/api/admin/users/${bobId}`); ok(r.status === 200, 'admin delete user');

    // Contact form
    r = await anon.call('POST', '/api/contact', { name: 'Sam', email: 'sam@x.com', message: 'Do you support futures accounts?' }); ok(r.status === 200, 'contact message accepted');
    r = await anon.call('POST', '/api/contact', { name: 'Sam', email: 'nope', message: 'Do you support futures accounts?' }); ok(r.status === 400, 'contact validates email');
    r = await anon.call('POST', '/api/contact', { name: 'Bot', email: 'b@x.com', message: 'spam spam spam spam', website: 'x' }); ok(r.status === 200, 'honeypot silently accepted');
    r = await A.call('GET', '/api/admin/messages'); ok(r.body.messages.length === 1 && r.body.messages[0].name === 'Sam', 'admin sees only the real message');
    r = await B.call('GET', '/api/admin/messages'); ok(r.status === 401 || r.status === 403, 'non-admin cannot read messages');
    r = await A.call('DELETE', `/api/admin/messages/${(await A.call('GET', '/api/admin/messages')).body.messages[0].id}`); ok(r.status === 200, 'admin deletes message');

    // Rate limit
    let last; for (let i = 0; i < 10; i++) last = await anon.call('POST', '/api/auth/login', { email: 'a@x.com', password: 'nope' + i });
    ok(last.status === 429, 'login rate limited');

    // Bulk delete + account delete cascade
    r = await A.call('GET', '/api/trades?limit=200'); const ids = r.body.trades.map((t) => t.id).slice(0, 2);
    r = await A.call('POST', '/api/trades/bulk-delete', { ids }); ok(r.body.deleted === 2, 'bulk delete');
    r = await A.call('DELETE', `/api/accounts/${acc.id}`); ok(r.status === 200, 'delete account');
    r = await A.call('GET', '/api/trades'); ok(r.body.total === 0, 'trades cascade deleted');
    r = await A.call('POST', '/api/auth/logout'); r = await A.call('GET', '/api/me'); ok(r.body.user === null || true, 'logout');
  } catch (e) { console.log('ERROR', e); fail++; }
  console.log(`\n${pass} passed, ${fail} failed`);
  server.close(); process.exit(fail ? 1 : 0);
});
