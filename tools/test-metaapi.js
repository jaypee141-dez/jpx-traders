// Tests the MetaApi integration end to end against a LOCAL stand-in that mimics MetaApi's documented REST API.
// (The real MetaApi service cannot be reached from the build sandbox, so this verifies our side of the contract.)
process.env.JPX_DB = '/tmp/jpx-test-meta.db';
process.env.ADMIN_EMAIL = 'admin@x.com';
process.env.JPX_NO_BACKGROUND = '1';
for (const s of ['', '-wal', '-shm']) require('node:fs').rmSync('/tmp/jpx-test-meta.db' + s, { force: true });
const http = require('node:http');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };

const state = { connected: false, calls: [], removed: [] };
const T = (min) => new Date(Date.UTC(2026, 9, 1, 10, 0) + min * 60000).toISOString();
const deals = [
  { id: 'd1', type: 'DEAL_TYPE_BALANCE', entryType: 'DEAL_ENTRY_IN', profit: 5000, time: T(-500), positionId: undefined },
  { id: 'd2', type: 'DEAL_TYPE_BUY', entryType: 'DEAL_ENTRY_IN', symbol: 'EURUSD', volume: 0.5, price: 1.1, profit: 0, commission: -1.5, swap: 0, time: T(0), positionId: 'P1' },
  { id: 'd3', type: 'DEAL_TYPE_SELL', entryType: 'DEAL_ENTRY_OUT', symbol: 'EURUSD', volume: 0.5, price: 1.101, profit: 50, commission: -1.5, swap: -0.2, time: T(60), positionId: 'P1' },
  { id: 'd4', type: 'DEAL_TYPE_SELL', entryType: 'DEAL_ENTRY_IN', symbol: 'XAUUSD', volume: 0.1, price: 2900, profit: 0, commission: -0.7, swap: 0, time: T(100), positionId: 'P2' },
  { id: 'd5', type: 'DEAL_TYPE_BUY', entryType: 'DEAL_ENTRY_OUT', symbol: 'XAUUSD', volume: 0.1, price: 2902, profit: -20, commission: -0.7, swap: 0, time: T(130), positionId: 'P2' },
  { id: 'd6', type: 'DEAL_TYPE_BUY', entryType: 'DEAL_ENTRY_IN', symbol: 'GBPUSD', volume: 1, price: 1.3, profit: 0, commission: 0, swap: 0, time: T(200), positionId: 'P3' }, // still open
  { id: 'd7', type: 'DEAL_TYPE_SELL', entryType: 'DEAL_ENTRY_OUT', symbol: 'USDJPY', volume: 0.2, price: 150.5, profit: 30, commission: -1, swap: 0, time: T(210), positionId: 'P4' }, // opened before the window
];
const p4All = [{ id: 'd8', type: 'DEAL_TYPE_BUY', entryType: 'DEAL_ENTRY_IN', symbol: 'USDJPY', volume: 0.2, price: 150, profit: 0, commission: -1, swap: 0, time: T(-3000), positionId: 'P4' }, deals[6]];

const mock = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'); let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (st, j) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(j === undefined ? '' : JSON.stringify(j)); };
    state.calls.push(req.method + ' ' + url.pathname);
    if (req.headers['auth-token'] !== 'tok') return send(401, { message: 'invalid token' });
    const p = url.pathname;
    if (req.method === 'POST' && p === '/users/current/accounts') {
      const b = JSON.parse(body); state.lastCreate = b;
      if (b.login === '1111') return send(400, { message: 'Authentication failed. Please check login, password and server name.' });
      return send(201, { id: 'acc-1', state: 'DEPLOYING' });
    }
    if (req.method === 'GET' && p === '/users/current/accounts/acc-1') return send(200, { _id: 'acc-1', state: 'DEPLOYED', connectionStatus: state.connected ? 'CONNECTED' : 'DISCONNECTED', region: 'new-york' });
    if (req.method === 'POST' && p.endsWith('/undeploy')) return send(204);
    if (req.method === 'DELETE' && p === '/users/current/accounts/acc-1') { state.removed.push('acc-1'); return send(204); }
    if (p.startsWith('/users/current/accounts/acc-1/history-deals/time/')) { const off = Number(url.searchParams.get('offset') || 0); return send(200, off === 0 ? deals : []); }
    if (p === '/users/current/accounts/acc-1/history-deals/position/P4') return send(200, p4All);
    if (p === '/users/current/accounts/acc-1/positions') return send(200, [{ id: 'P3', type: 'POSITION_TYPE_BUY', symbol: 'GBPUSD', volume: 1, openPrice: 1.3, stopLoss: 1.29, takeProfit: 1.32, time: T(200) }]);
    send(404, { message: 'not found' });
  });
});

class Client {
  constructor(base) { this.base = base; this.cookie = ''; }
  async call(method, url, body) {
    const r = await fetch(this.base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'jpx', Cookie: this.cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j };
  }
}

mock.listen(0, () => {
  const mbase = `http://127.0.0.1:${mock.address().port}`;
  process.env.METAAPI_PROVISIONING_URL = mbase; process.env.METAAPI_CLIENT_URL = mbase;
  const { server } = require('../server');
  const { q } = require('../lib/db'); const meta = require('../lib/metaapi');
  server.listen(0, async () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    const [A, U, F] = [new Client(base), new Client(base), new Client(base)];
    try {
      await A.call('POST', '/api/auth/register', { name: 'Admin', email: 'admin@x.com', password: 'password1' });
      await U.call('POST', '/api/auth/register', { name: 'Trader One', email: 'u@x.com', password: 'password1' });
      await F.call('POST', '/api/auth/register', { name: 'Free User', email: 'f@x.com', password: 'password1' });
      let r = await U.call('POST', '/api/accounts', { name: 'Broker acct', platform: 'mt5', starting_balance: 5000 }); const acc = r.body.account;
      r = await U.call('GET', '/api/metaapi/config'); ok(r.body.enabled === false || r.body.enabled === true, 'config endpoint');

      // not configured -> clear 503
      const saved = process.env.METAAPI_TOKEN; delete process.env.METAAPI_TOKEN;
      r = await U.call('POST', `/api/accounts/${acc.id}/metaapi`, { login: '123456', password: 'pw', server: 'Broker-Live', platform: 'mt5' }); ok(r.status === 503 && /METAAPI_TOKEN/.test(r.body.error), 'clear message when MetaApi is not configured');
      process.env.METAAPI_TOKEN = 'tok';
      r = await U.call('GET', '/api/metaapi/config'); ok(r.body.enabled === true, 'config enabled with token');

      // validation + provider errors
      r = await U.call('POST', `/api/accounts/${acc.id}/metaapi`, { login: 'abc', password: 'pw', server: 'S' }); ok(r.status === 400, 'login must be digits');
      r = await U.call('POST', `/api/accounts/${acc.id}/metaapi`, { login: '1234567', password: '', server: 'S' }); ok(r.status === 400, 'password required');
      r = await U.call('POST', `/api/accounts/${acc.id}/metaapi`, { login: '1111', password: 'wrong', server: 'Broker-Live', platform: 'mt5' }); ok(r.status === 400 && /Authentication failed/.test(r.body.error), 'broker rejection is shown to the user');
      const pf = await F.call('POST', '/api/accounts', { name: 'free acct' });
      await A.call('PATCH', `/api/admin/users/${(await F.call('GET', '/api/me')).body.user.id}/plan`, { plan: 'free' });
      r = await F.call('POST', `/api/accounts/${pf.body.account.id}/metaapi`, { login: '123456', password: 'pw', server: 'S' }); ok(r.status === 402, 'free plan cannot connect a broker');

      // connect
      r = await U.call('POST', `/api/accounts/${acc.id}/metaapi`, { login: '7654321', password: 'investor-pw', server: 'ICMarketsSC-Live', platform: 'mt5' });
      ok(r.status === 200 && r.body.account.auto.status === 'connecting' && r.body.account.auto.login === '7654321', 'connect creates a cloud connection');
      ok(state.lastCreate.login === '7654321' && state.lastCreate.server === 'ICMarketsSC-Live' && state.lastCreate.platform === 'mt5' && state.lastCreate.type === 'cloud-g2', 'sent the documented provisioning fields');
      const stored = JSON.stringify(q.get('SELECT * FROM accounts WHERE id = ?', acc.id)); ok(!stored.includes('investor-pw'), 'password is never stored');
      r = await U.call('POST', `/api/accounts/${acc.id}/metaapi`, { login: '7654321', password: 'x', server: 'S' }); ok(r.status === 400, 'cannot connect twice');
      r = await U.call('POST', `/api/accounts/${acc.id}/metaapi/sync`); ok(r.body.status === 'connecting', 'sync while broker still connecting reports connecting');
      state.connected = true;
      r = await U.call('POST', `/api/accounts/${acc.id}/metaapi/sync`); ok(r.status === 200 && r.body.status === 'connected' && r.body.inserted === 3, 'first sync imports the 3 closed positions: ' + JSON.stringify(r.body));
      r = await U.call('GET', '/api/trades?limit=50&sort=close_asc'); const t = r.body.trades;
      const p1 = t.find((x) => x.external_id === 'P1'), p2 = t.find((x) => x.external_id === 'P2'), p4 = t.find((x) => x.external_id === 'P4');
      ok(t.length === 3 && !t.find((x) => x.external_id === 'P3'), 'open position not imported as a closed trade');
      ok(p1 && p1.side === 'long' && p1.symbol === 'EURUSD' && p1.volume === 0.5 && p1.profit === 50 && p1.commission === -3 && p1.swap === -0.2 && p1.net === 46.8 && p1.source === 'metaapi' && p1.entry_price === 1.1 && p1.exit_price === 1.101, 'P1 mapped correctly (net 46.8)');
      ok(p2 && p2.side === 'short' && p2.net === -21.4, 'P2 short mapped (net -21.4)');
      ok(p4 && p4.side === 'long' && p4.open_time === T(-3000) && p4.net === 28, 'P4 opened before the window is completed via position deals (net 28)');
      r = await U.call('POST', `/api/accounts/${acc.id}/metaapi/sync`); ok(r.body.inserted === 0 && r.body.updated === 3, 'repeat sync is idempotent');
      r = await U.call('GET', '/api/accounts'); ok(r.body.accounts[0].auto.status === 'connected' && r.body.accounts[0].auto.last_poll && r.body.accounts[0].trades === 3, 'account shows connected + last sync');

      // leader + live open positions
      r = await U.call('PUT', '/api/copy/profile', { alias: 'MetaLeader', account_id: acc.id, accept: true }); ok(r.status === 200, 'publish strategy on a broker-linked account');
      await U.call('POST', `/api/accounts/${acc.id}/metaapi/sync`);
      const sig = q.get("SELECT * FROM signals WHERE ref = 'P3'"); ok(sig && sig.status === 'open' && sig.symbol === 'GBPUSD' && sig.side === 'long' && sig.stop_loss === 1.29, 'open broker position becomes a live copy signal');

      // scheduler path
      q.run('UPDATE accounts SET last_poll = ? WHERE id = ?', new Date(Date.now() - 3600000).toISOString(), acc.id);
      const before = q.get('SELECT last_poll FROM accounts WHERE id = ?', acc.id).last_poll; await meta.tick();
      ok(q.get('SELECT last_poll FROM accounts WHERE id = ?', acc.id).last_poll > before, 'background scheduler refreshes connected accounts');

      // disconnect
      r = await U.call('DELETE', `/api/accounts/${acc.id}/metaapi`); ok(r.status === 200 && state.removed.includes('acc-1') && state.calls.some((c) => c.endsWith('/undeploy')), 'disconnect removes the cloud connection');
      r = await U.call('GET', '/api/accounts'); ok(r.body.accounts[0].auto === null && r.body.accounts[0].trades === 3, 'disconnect keeps imported trades');

      // deleting an account cleans up the cloud connection too
      state.removed.length = 0;
      r = await U.call('POST', '/api/accounts', { name: 'second' }); const a2 = r.body.account;
      await U.call('POST', `/api/accounts/${a2.id}/metaapi`, { login: '7654321', password: 'x', server: 'S', platform: 'mt4' });
      await U.call('DELETE', `/api/accounts/${a2.id}`); await new Promise((res) => setTimeout(res, 150)); ok(state.removed.includes('acc-1'), 'deleting an account also removes its cloud connection');
      process.env.METAAPI_TOKEN = saved || 'tok';
    } catch (e) { console.log('ERROR', e); fail++; }
    console.log(`\n${pass} passed, ${fail} failed`);
    server.close(); mock.close(); process.exit(fail ? 1 : 0);
  });
});
