// Integration tests for plans, copy trading, leaderboard, billing webhook, support, reviews and API access.
process.env.JPX_DB = '/tmp/jpx-test-extra.db';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
process.env.ADMIN_EMAIL = 'admin@x.com';
for (const s of ['', '-wal', '-shm']) require('node:fs').rmSync('/tmp/jpx-test-extra.db' + s, { force: true });
const crypto = require('node:crypto');
const { server } = require('../server');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
class Client {
  constructor(base) { this.base = base; this.cookie = ''; }
  async call(method, url, body, headers = {}) {
    const r = await fetch(this.base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'jpx', Cookie: this.cookie, ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, body: json };
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
server.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const [A, L, F, F2, F3, anon] = [0, 1, 2, 3, 4, 5].map(() => new Client(base));
  const reg = async (c, name, email) => (await c.call('POST', '/api/auth/register', { name, email, password: 'password1' })).body.user;
  try {
    const admin = await reg(A, 'Admin Person', 'admin@x.com');
    const leader = await reg(L, 'Leo Leader', 'leo@x.com');
    const f1 = await reg(F, 'Fiona Follower', 'fi@x.com');
    const f2 = await reg(F2, 'Finn Follower', 'finn@x.com');
    const f3 = await reg(F3, 'Free Rider', 'free@x.com');
    ok(leader.plan.key === 'pro' && leader.plan.trialing && leader.plan.trial_ends_at, 'new users start on a Pro trial');

    // public endpoints
    let r = await anon.call('GET', '/api/public/plans'); ok(r.body.plans.length === 3 && r.body.plans[1].price.month === 49 && r.body.plans[2].price.month === 99 && r.body.plans[0].price.month === 19, 'public plans match pricing 19/49/99');
    r = await anon.call('GET', '/api/public/stats'); ok(r.body.traders === 5 && r.body.active_traders === 5, 'public stats are real counts');

    // leader sets up
    r = await L.call('POST', '/api/accounts', { name: 'Leader MT5', platform: 'mt5', starting_balance: 10000 }); const lacc = r.body.account;
    r = await L.call('PUT', '/api/copy/profile', { alias: 'AlphaFX', bio: 'London session breakouts', account_id: lacc.id }); ok(r.status === 400, 'leader must accept disclosure');
    r = await L.call('PUT', '/api/copy/profile', { alias: 'a!', account_id: lacc.id, accept: true }); ok(r.status === 400, 'alias validated');
    r = await L.call('PUT', '/api/copy/profile', { alias: 'AlphaFX', bio: 'London session breakouts', account_id: lacc.id, accept: true }); ok(r.status === 200 && r.body.profile.is_public === 1, 'leader profile created');
    r = await F.call('PUT', '/api/copy/profile', { alias: 'alphafx', account_id: 1, accept: true }); ok(r.status === 400 || r.status === 404, 'alias unique / account ownership enforced');
    // history for leaderboard (>=3 trades)
    const now = Date.now(), iso = (d) => new Date(d).toISOString();
    const hist = [[3, 120], [2, -50], [1, 80]];
    for (const [days, profit] of hist) { r = await L.call('POST', '/api/trades', { account_id: lacc.id, symbol: 'EURUSD', side: 'buy', volume: 1, open_time: iso(now - days * 86400000), close_time: iso(now - days * 86400000 + 3600000), profit, commission: 0 }); ok(r.status === 200, 'leader history trade'); }
    r = await anon.call('GET', '/api/public/leaders'); const top = r.body.leaders[0];
    ok(top && top.alias === 'AlphaFX' && top.trades === 3 && top.gain === 1.5 && top.win_rate > 66 && top.user_id === undefined, 'public leaderboard shows real stats (+1.5%) without internal ids: ' + JSON.stringify(top && [top.gain, top.trades]));

    // followers
    r = await F.call('POST', '/api/accounts', { name: 'Follower MT5', platform: 'mt5', starting_balance: 5000 }); const facc = r.body.account;
    r = await F2.call('POST', '/api/accounts', { name: 'F2 acct', platform: 'mt5', starting_balance: 8000 }); const f2acc = r.body.account;
    r = await F.call('GET', '/api/copy/leaders'); ok(r.body.leaders.length === 1 && r.body.leaders[0].me === false, 'in-app leaderboard');
    const leaderId = r.body.leaders[0].user_id;
    r = await F.call('POST', '/api/copy/follows', { leader_id: leaderId, account_id: facc.id, mode: 'ratio' }); ok(r.status === 200, 'follow (ratio) works: ' + JSON.stringify(r.body));
    r = await F.call('POST', '/api/copy/follows', { leader_id: leaderId, account_id: facc.id }); ok(r.status === 400, 'cannot follow twice');
    r = await L.call('POST', '/api/copy/follows', { leader_id: leaderId, account_id: lacc.id }); ok(r.status === 400, 'cannot copy yourself');
    r = await F2.call('POST', '/api/copy/follows', { leader_id: leaderId, account_id: f2acc.id, mode: 'fixed', multiplier: 0.5 }); ok(r.status === 200, 'follow (fixed 0.5x) works');
    r = await F2.call('POST', '/api/copy/follows', { leader_id: leaderId, account_id: f2acc.id, mode: 'fixed', multiplier: 500 }); ok(r.status === 400, 'duplicate/invalid multiplier rejected');
    await sleep(30);

    // follower keys for EA execution flow
    r = await F.call('POST', `/api/accounts/${facc.id}/api-key`); const fkey = r.body.api_key;
    r = await L.call('POST', `/api/accounts/${lacc.id}/api-key`); const lkey = r.body.api_key;

    // leader publishes an OPEN position; follower EA should see an open action scaled by balance ratio
    await sleep(1100); const openT = Math.floor(Date.now() / 1000);
    r = await anon.call('POST', '/api/ingest', { open_positions: [{ external_id: '9001', symbol: 'EURUSD', side: 'buy', volume: 1, open_time: openT, entry_price: 1.1, stop_loss: 1.095, take_profit: 1.11 }] }, { 'X-API-Key': lkey });
    ok(r.status === 200 && r.body.signals === 1, 'leader open position published as signal: ' + JSON.stringify(r.body));
    r = await anon.call('GET', '/api/copy/pending', null, { 'X-API-Key': fkey });
    const lbal = 10000 + 150, expectVol = Math.round((1 * 5000 / lbal) * 100) / 100;
    ok(r.body.actions.length === 1 && r.body.actions[0].action === 'open' && r.body.actions[0].symbol === 'EURUSD' && r.body.actions[0].side === 'long' && Math.abs(r.body.actions[0].volume - expectVol) < 0.011, 'follower EA gets scaled open action (vol ~' + expectVol + '): ' + JSON.stringify(r.body.actions));
    const mid = r.body.actions[0].mirror_id;
    r = await anon.call('POST', '/api/copy/ack', { mirror_id: mid, action: 'open', ok: true, ticket: 'FT-77' }, { 'X-API-Key': fkey }); ok(r.status === 200, 'follower EA acks open');
    r = await anon.call('GET', '/api/copy/pending', null, { 'X-API-Key': fkey }); ok(r.body.actions.length === 0, 'no repeat open action after ack');
    // leader closes -> follower gets close action, and no synthetic journal trade (the real one syncs from MT5)
    r = await anon.call('POST', '/api/ingest', { trades: [{ external_id: '9001', symbol: 'EURUSD', side: 'buy', volume: 1, open_time: openT, close_time: openT + 600, profit: 100, commission: -4, swap: 0, entry_price: 1.1, exit_price: 1.101 }] }, { 'X-API-Key': lkey });
    ok(r.status === 200 && r.body.inserted === 1, 'leader closed trade ingested');
    r = await anon.call('GET', '/api/copy/pending', null, { 'X-API-Key': fkey }); ok(r.body.actions.length === 1 && r.body.actions[0].action === 'close' && r.body.actions[0].ticket === 'FT-77', 'follower EA gets close action for its ticket');
    await anon.call('POST', '/api/copy/ack', { mirror_id: mid, action: 'close' }, { 'X-API-Key': fkey });
    r = await anon.call('GET', '/api/copy/pending', null, { 'X-API-Key': fkey }); ok(r.body.actions.length === 0, 'close acked');
    r = await F.call('GET', '/api/trades?limit=50'); ok(r.body.trades.filter((t) => t.source === 'copy').length === 0, 'no duplicate synthetic trade when EA executed');
    // real executed trade syncs back with the same ticket and is tagged as a copy
    r = await anon.call('POST', '/api/ingest', { trades: [{ external_id: 'FT-77', symbol: 'EURUSD', side: 'buy', volume: 0.5, open_time: openT, close_time: openT + 600, profit: 50, commission: -2, swap: 0 }] }, { 'X-API-Key': fkey });
    r = await F.call('GET', '/api/trades?q=FT'); r = await F.call('GET', '/api/trades?limit=50'); const real = r.body.trades.find((t) => t.external_id === 'FT-77'); ok(real && real.setup === 'Copy · AlphaFX', 'executed copy trade is tagged in journal');

    // journal-only mirror: leader logs a closed trade later; followers get scaled copy
    const t0 = new Date().toISOString();
    r = await L.call('POST', '/api/trades', { account_id: lacc.id, symbol: 'XAUUSD', side: 'sell', volume: 1, open_time: t0, close_time: t0, profit: 200, commission: -4 }); ok(r.status === 200, 'leader logs trade');
    r = await F2.call('GET', '/api/trades?limit=50'); const c2 = r.body.trades.filter((t) => t.source === 'copy');
    const gold = c2.find((t) => t.symbol === 'XAUUSD'), eur = c2.find((t) => t.symbol === 'EURUSD');
    ok(c2.length === 2 && gold && gold.volume === 0.5 && gold.net === 98 && gold.side === 'short' && gold.setup === 'Copy · AlphaFX', 'fixed 0.5x journal copy of leader trade scaled (net 98): ' + JSON.stringify(gold && [gold.volume, gold.net]));
    ok(eur && eur.volume === 0.5 && eur.net === 48, 'earlier leader trade also mirrored for the non-EA follower (net 48)');
    r = await F2.call('GET', '/api/copy/follows'); ok(r.body.follows[0].copied === 2 && r.body.follows[0].net === 146 && r.body.follows[0].alias === 'AlphaFX', 'follow stats count copied trades (2, net 146): ' + JSON.stringify(r.body.follows[0]));
    const fid = r.body.follows[0].id; r = await F2.call('PATCH', `/api/copy/follows/${fid}`, { status: 'paused' }); ok(r.body.follow.status === 'paused', 'pause follow');
    await sleep(30); const t1 = new Date().toISOString();
    await L.call('POST', '/api/trades', { account_id: lacc.id, symbol: 'GBPUSD', side: 'buy', volume: 1, open_time: t1, close_time: t1, profit: 10 });
    r = await F2.call('GET', '/api/trades?limit=50'); ok(r.body.trades.filter((t) => t.source === 'copy').length === 2, 'paused follower receives no new copies');
    r = await F.call('GET', '/api/trades?limit=50'); const c1 = r.body.trades.filter((t) => t.source === 'copy');
    ok(c1.length >= 1 && c1.every((x) => x.volume > 0 && x.volume < 1), 'ratio follower journal gets copies scaled by balance ratio (vol ' + (c1[0] && c1[0].volume) + ')');
    // paused follows do not copy
    // leader detail
    r = await F.call('GET', `/api/copy/leaders/${leaderId}`); ok(r.body.leader.followers >= 1 && r.body.recent.length >= 3 && r.body.follow, 'leader detail with recent trades + follow state');
    // user isolation
    r = await F3.call('GET', '/api/copy/follows'); ok(r.body.follows.length === 0, 'follows are private');
    r = await F3.call('PATCH', `/api/copy/follows/${fid}`, { status: 'active' }); ok(r.status === 404, 'cannot edit others follows');

    // plan gating
    r = await A.call('PATCH', `/api/admin/users/${f3.id}/plan`, { plan: 'free' }); ok(r.status === 200, 'admin sets plan');
    r = await F3.call('GET', '/api/me'); ok(r.body.user.plan.key === 'free', 'plan applied');
    r = await F3.call('POST', '/api/accounts', { name: 'one' }); ok(r.status === 200, 'free: first account ok');
    r = await F3.call('POST', '/api/accounts', { name: 'two' }); ok(r.status === 402, 'free: second account blocked (402)');
    r = await F3.call('POST', '/api/copy/follows', { leader_id: leaderId, account_id: r.body.account && r.body.account.id || 1 }); ok(r.status === 402, 'free: cannot follow (402)');
    r = await F3.call('GET', '/api/analytics'); ok(r.body.locked === true && r.body.summary, 'free: advanced analytics locked, summary available');
    r = await F3.call('PUT', '/api/copy/profile', { alias: 'FreeGuy', account_id: 1, accept: true }); ok(r.status === 402, 'free: cannot publish strategy');
    await A.call('PATCH', `/api/admin/users/${f3.id}/plan`, { plan: 'starter' });
    r = await F3.call('GET', '/api/accounts'); const f3acc = r.body.accounts[0];
    r = await F3.call('POST', '/api/copy/follows', { leader_id: leaderId, account_id: (await F3.call('POST', '/api/accounts', { name: 'starter2' })).body.account.id }); ok(r.status === 200, 'starter: can follow 1');
    // elite-only strategy
    r = await L.call('PUT', '/api/copy/profile', { alias: 'AlphaFX', account_id: lacc.id, elite_only: true }); ok(r.body.profile.elite_only === 0, 'non-elite cannot set elite_only');
    await A.call('PATCH', `/api/admin/users/${leader.id}/plan`, { plan: 'elite', account_manager: 'Mia (mia@jpx.test)' });
    r = await L.call('PUT', '/api/copy/profile', { alias: 'AlphaFX', account_id: lacc.id, elite_only: true }); ok(r.body.profile.elite_only === 1, 'elite leader can publish exclusive strategy');
    r = await F2.call('PATCH', `/api/copy/follows/${fid}`, { status: 'active' }); ok(r.status === 402, 'pro cannot resume following an elite-only strategy');
    r = await F2.call('GET', '/api/copy/leaders'); ok(r.body.leaders[0].locked === true, 'elite strategy shown as locked to pro');
    r = await L.call('GET', '/api/billing'); ok(r.body.plan.key === 'elite' && r.body.plan.account_manager.startsWith('Mia') && r.body.usage.accounts === 1, 'elite billing shows account manager + usage');

    // billing: checkout unconfigured; webhook signed
    r = await F.call('POST', '/api/billing/checkout', { plan: 'pro', interval: 'month' }); ok(r.status === 503, 'checkout reports payments not configured');
    const event = JSON.stringify({ type: 'checkout.session.completed', data: { object: { client_reference_id: String(f1.id), customer: 'cus_1', subscription: 'sub_1', metadata: { user_id: String(f1.id), plan: 'elite', interval: 'year' } } } });
    const sign = (raw, secret, t) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
    const t = Math.floor(Date.now() / 1000);
    r = await anon.call('POST', '/api/stripe/webhook', JSON.parse(event), { 'Stripe-Signature': sign(event, 'wrong', t) }); ok(r.status === 400, 'webhook rejects bad signature');
    r = await fetch(base + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sign(event, 'whsec_test_secret', t) }, body: event }); ok(r.status === 200, 'webhook accepts valid signature');
    r = await F.call('GET', '/api/me'); ok(r.body.user.plan.key === 'elite' && r.body.user.plan.source === 'stripe', 'webhook upgrades the plan');
    const del = JSON.stringify({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } } });
    r = await fetch(base + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sign(del, 'whsec_test_secret', t) }, body: del });
    r = await F.call('GET', '/api/me'); ok(r.body.user.plan.key === 'free', 'cancelled subscription downgrades to free');
    r = await fetch(base + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sign(event, 'whsec_test_secret', t - 1000) }, body: event }); ok(r.status === 400, 'webhook rejects stale timestamp');

    // API access (Elite)
    r = await F.call('POST', '/api/me/api-token'); ok(r.status === 402, 'free cannot create API token');
    r = await L.call('POST', '/api/me/api-token'); const tok = r.body.token; ok(/^jpxk_[0-9a-f]{48}$/.test(tok), 'elite creates API token');
    r = await anon.call('GET', '/api/v1/trades?limit=2', null, { Authorization: 'Bearer ' + tok }); ok(r.status === 200 && r.body.trades.length === 2 && r.body.total >= 5, 'API v1 returns own trades');
    r = await anon.call('GET', '/api/v1/analytics', null, { Authorization: 'Bearer ' + tok }); ok(r.body.summary.trades >= 5, 'API v1 analytics');
    r = await anon.call('GET', '/api/v1/trades', null, { Authorization: 'Bearer jpxk_' + '0'.repeat(48) }); ok(r.status === 401, 'bad API token rejected');
    r = await L.call('DELETE', '/api/me/api-token'); r = await anon.call('GET', '/api/v1/me', null, { Authorization: 'Bearer ' + tok }); ok(r.status === 401, 'revoked token stops working');

    // support tickets
    r = await F.call('POST', '/api/support/tickets', { subject: 'Copy not opening', message: 'My EA is not opening trades.', category: 'copy-trading' }); const tid = r.body.ticket.id; ok(r.status === 200, 'ticket created');
    r = await F3.call('GET', `/api/support/tickets/${tid}`); ok(r.status === 404, 'tickets are private');
    r = await A.call('GET', '/api/admin/tickets'); ok(r.body.tickets.length === 1 && r.body.tickets[0].user_email === 'fi@x.com', 'admin sees tickets');
    r = await A.call('POST', `/api/support/tickets/${tid}/messages`, { message: 'Please check that WebRequest is allowed.' }); ok(r.body.messages.length === 2 && r.body.messages[1].is_staff === 1, 'admin replies as staff');
    r = await F.call('GET', `/api/support/tickets/${tid}`); ok(r.body.ticket.status === 'answered', 'ticket marked answered');
    r = await F.call('POST', `/api/support/tickets/${tid}/messages`, { message: 'Fixed, thanks!' }); r = await F.call('PATCH', `/api/support/tickets/${tid}`, { status: 'closed' }); ok(r.status === 200, 'user closes ticket');

    // reviews
    r = await anon.call('GET', '/api/public/reviews'); ok(r.body.reviews.length === 0, 'no public reviews before approval');
    r = await F.call('POST', '/api/reviews', { rating: 5, quote: 'Copying a leader into my journal account is seamless.', role: 'Forex trader' }); ok(r.status === 200, 'review submitted');
    r = await anon.call('GET', '/api/public/reviews'); ok(r.body.reviews.length === 0, 'pending review not public');
    r = await A.call('GET', '/api/admin/reviews'); const rid = r.body.reviews[0].id; r = await A.call('PATCH', `/api/admin/reviews/${rid}`, { status: 'approved' }); ok(r.status === 200, 'admin approves review');
    r = await anon.call('GET', '/api/public/reviews'); ok(r.body.reviews.length === 1 && r.body.reviews[0].name === 'Fiona F.' && r.body.reviews[0].role === 'Forex trader', 'approved review is public with short name');

    // editable website settings + admin email
    r = await anon.call('GET', '/api/public/site'); ok(r.body.site.stat_number === '10,000+' && r.body.site.stat_label === 'Active Traders Worldwide' && r.body.site.reviews_intro === 'Join thousands of traders who are already growing with JPX.' && r.body.site.social_x === '', 'site defaults match the design');
    r = await F.call('PUT', '/api/admin/site', { social_x: 'https://x.com/jpx' }); ok(r.status === 403, 'non-admin cannot edit site settings');
    r = await A.call('PUT', '/api/admin/site', { social_x: 'javascript:alert(1)' }); ok(r.status === 400, 'unsafe social link rejected');
    r = await A.call('PUT', '/api/admin/site', { social_x: 'https://x.com/jpx', social_telegram: 'https://t.me/jpx', stat_number: '12,500+' }); ok(r.status === 200 && r.body.site.social_x === 'https://x.com/jpx', 'admin saves site settings');
    r = await anon.call('GET', '/api/public/site'); ok(r.body.site.social_telegram === 'https://t.me/jpx' && r.body.site.stat_number === '12,500+', 'public site shows saved settings');
    r = await A.call('PUT', '/api/admin/site', { social_x: '' }); r = await anon.call('GET', '/api/public/site'); ok(r.body.site.social_x === '', 'link can be removed');
    // the very first user is NOT admin unless it is the owner email; the owner email is admin whenever it registers
    const G = new Client(base), O = new Client(base);
    r = await G.call('POST', '/api/auth/register', { name: 'Random Person', email: 'random@x.com', password: 'password1' }); ok(r.body.user.role === 'user', 'ordinary sign-up is never admin');
    r = await O.call('POST', '/api/auth/register', { name: 'Owner', email: 'ADMIN@x.com'.toLowerCase() + '.au', password: 'password1' }); ok(r.body.user.role === 'user', 'similar email does not get admin');

    // cleanup paths
    r = await L.call('DELETE', '/api/copy/profile'); ok(r.status === 200, 'leader can stop publishing');
    r = await anon.call('GET', '/api/public/leaders'); ok(r.body.leaders.length === 0, 'leader removed from leaderboard');
  } catch (e) { console.log('ERROR', e); fail++; }
  console.log(`\n${pass} passed, ${fail} failed`);
  server.close(); process.exit(fail ? 1 : 0);
});
