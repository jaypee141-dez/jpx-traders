'use strict';
const crypto = require('node:crypto');
const stripe = require('./stripe');
const copy = require('./copy');
const { PLANS, TRIAL_DAYS, effectivePlan, planInfo, publicPlans } = require('./plans');

module.exports = function register(h) {
  const { route, q, HttpError, bad, requireUser, requireAdmin, str, rateLimit, sha, EMAIL_RE, audit, limits, needPlan, loadTrades, analyze, publicUser } = h;
  const owned = (u, id) => { const a = q.get('SELECT * FROM accounts WHERE id = ? AND user_id = ?', Number(id), u.id); if (!a) throw new HttpError(404, 'Account not found'); return a; };
  const bool = (v) => v === true || v === 1 || v === '1' || v === 'true';
  const origin = (ctx) => process.env.PUBLIC_URL || `${ctx.req.headers['x-forwarded-proto'] || 'http'}://${ctx.req.headers.host}`;
  const shortName = (n) => { const p = String(n).trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0].toUpperCase()}.` : p[0]; };
  const leaderUsable = (userId) => { const u = q.get("SELECT * FROM users WHERE id = ? AND status = 'active'", userId); return u && limits(u).publish; };
  const board = (period, limit) => copy.leaderboard(period, limit).filter((x) => leaderUsable(x.user_id)).map((x, i) => ({ ...x, rank: i + 1 }));

  /* ------------------------------------------------ public */
  route('GET', '/api/public/plans', () => ({ plans: publicPlans(), trial_days: TRIAL_DAYS, payments_enabled: stripe.configured() }), { public: true });
  route('GET', '/api/public/stats', () => {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    return {
      active_traders: q.get("SELECT COUNT(*) AS n FROM users WHERE status = 'active' AND (last_login >= ? OR created_at >= ?)", since, since).n,
      traders: q.get("SELECT COUNT(*) AS n FROM users WHERE status = 'active'").n,
      leaders: q.get('SELECT COUNT(*) AS n FROM leader_profiles WHERE is_public = 1').n,
    };
  }, { public: true });
  const featuredRows = () => q.all('SELECT * FROM featured_traders ORDER BY gain DESC, id').map((f) => ({ alias: f.alias, bio: f.bio, avatar: f.avatar, gain: f.gain, win_rate: f.win_rate, profit_factor: f.profit_factor, trades: f.trades, followers: f.followers, max_drawdown_pct: f.max_dd, spark: JSON.parse(f.spark || '[]'), elite_only: false, featured: true }));
  route('GET', '/api/public/leaders', () => {
    const real = board('30d', 20).filter((x) => q.get('SELECT site_approved FROM leader_profiles WHERE user_id = ?', x.user_id).site_approved).map(({ user_id, ...x }) => x);
    const all = featuredRows().concat(real).sort((a, b) => (b.gain ?? -1e9) - (a.gain ?? -1e9)).slice(0, 10).map((x, i) => ({ ...x, rank: i + 1 }));
    return { leaders: all };
  }, { public: true });
  route('GET', '/api/public/reviews', () => {
    const own = q.all('SELECT name, role, quote, rating, avatar FROM testimonials ORDER BY sort, id').map((t) => ({ rating: t.rating, quote: t.quote, role: t.role, name: t.name, avatar: t.avatar }));
    const users = q.all("SELECT r.rating, r.quote, r.role, u.name, u.avatar FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.status = 'approved' ORDER BY r.id DESC LIMIT 12").map((r) => ({ rating: r.rating, quote: r.quote, role: r.role, name: shortName(r.name), avatar: r.avatar || '' }));
    return { reviews: own.concat(users) };
  }, { public: true });

  /* ------------------------------------------------ automatic broker import (MetaApi) */
  const meta = require('./metaapi');
  const metaErr = (e) => new HttpError(e.status === 401 || e.status === 403 ? 502 : (e.status >= 400 && e.status < 500 ? 400 : 502), e.status === 401 || e.status === 403 ? 'The site\'s MetaApi token was rejected. Ask the site owner to check METAAPI_TOKEN.' : e.message);
  route('GET', '/api/metaapi/config', (ctx) => { requireUser(ctx); return { enabled: meta.configured() }; });
  route('POST', '/api/accounts/:id/metaapi', async (ctx) => {
    const u = requireUser(ctx); const a = owned(u, ctx.params.id); const b = ctx.body;
    needPlan(u, limits(u).mt5, 'Automatic broker import is included in Starter and above. Upgrade to connect your broker.');
    if (!meta.configured()) throw new HttpError(503, 'Automatic import is not switched on for this site yet. The site owner needs to add the METAAPI_TOKEN setting.');
    rateLimit(`meta:${u.id}`, 6, 3600000);
    if (a.metaapi_id) throw bad('This account is already connected. Disconnect it first to use different details.');
    const login = str(b.login, 40, 'Login', true), server = str(b.server, 80, 'Broker server', true), password = String(b.password || '');
    if (!/^\d{3,15}$/.test(login)) throw bad('Login is your MetaTrader account number (digits only)');
    if (password.length < 1 || password.length > 100) throw bad('Enter your trading account password');
    const platform = b.platform === 'mt4' ? 'mt4' : 'mt5';
    let acc;
    try { acc = await meta.createAccount({ name: `jpx-${u.id}-${a.id}`, login, password, server, platform }); }
    catch (e) { throw metaErr(e); }
    q.run("UPDATE accounts SET metaapi_id = ?, metaapi_region = NULL, metaapi_status = 'connecting', metaapi_error = NULL, metaapi_login = ?, metaapi_server = ?, metaapi_since = ?, last_poll = NULL, platform = ? WHERE id = ?", acc.id, login, server, new Date().toISOString(), platform, a.id);
    meta.tick().catch(() => {});
    return { account: h.publicAccount(q.get('SELECT * FROM accounts WHERE id = ?', a.id)) };
  });
  route('POST', '/api/accounts/:id/metaapi/sync', async (ctx) => {
    const u = requireUser(ctx); const a = owned(u, ctx.params.id);
    if (!a.metaapi_id) throw bad('This account is not connected to a broker');
    rateLimit(`metasync:${a.id}`, 6, 60000);
    try {
      let info = null;
      if (a.metaapi_status !== 'connected') { info = await meta.getAccount(a.metaapi_id); if (info.region) q.run('UPDATE accounts SET metaapi_region = ? WHERE id = ?', info.region, a.id); if (info.connectionStatus !== 'CONNECTED') return { status: 'connecting', message: 'Still connecting to your broker. This can take a minute.' }; q.run("UPDATE accounts SET metaapi_status = 'connected', metaapi_error = NULL WHERE id = ?", a.id); }
      const res = await meta.syncAccount(q.get('SELECT * FROM accounts WHERE id = ?', a.id));
      return { status: 'connected', inserted: res.inserted || 0, updated: res.updated || 0 };
    } catch (e) { if (e instanceof meta.MetaApiError) { if (e.retry) return { status: 'connecting', message: e.message }; throw metaErr(e); } throw e; }
  });
  route('DELETE', '/api/accounts/:id/metaapi', async (ctx) => {
    const u = requireUser(ctx); const a = owned(u, ctx.params.id);
    if (a.metaapi_id) await meta.removeAccount(a.metaapi_id);
    q.run("UPDATE accounts SET metaapi_id = NULL, metaapi_region = NULL, metaapi_status = NULL, metaapi_error = NULL, metaapi_login = NULL, metaapi_server = NULL, metaapi_since = NULL, last_poll = NULL WHERE id = ?", a.id);
    return { ok: true };
  });

  /* ------------------------------------------------ admin: leaderboard + testimonials */
  const avatarOk = (v) => { v = String(v || ''); if (!v) return ''; if (/^\/img\/[A-Za-z0-9_\/.-]+$/.test(v) || (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= 140000)) return v; throw bad('Photo must be a JPEG, PNG or WebP image under 100 KB'); };
  const numIn = (v, name, lo, hi) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw bad(`${name} must be between ${lo} and ${hi}`); return n; };
  const makeSpark = (alias, gain) => { // smooth, deterministic equity trend ending at the stated return
    let seed = 0; for (const c of alias) seed = (seed * 31 + c.charCodeAt(0)) >>> 0; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const n = 30, pts = []; let walk = 0; const noise = [];
    for (let i = 0; i < n; i++) { walk += (rnd() - 0.4); noise.push(walk); }
    const last = noise[n - 1] || 1; for (let i = 0; i < n; i++) { const t = i / (n - 1); pts.push(Math.round((gain * t * 0.85 + (noise[i] / Math.abs(last || 1)) * Math.abs(gain) * 0.15 * (1 - t) ) * 100) / 100); }
    pts[0] = 0; pts[n - 1] = gain; return pts;
  };
  const featuredIn = (b) => {
    const alias = str(b.alias, 40, 'Name', true);
    return { alias, bio: str(b.bio, 120, 'Bio'), avatar: avatarOk(b.avatar), gain: numIn(b.gain, 'Return', -100, 1000), win_rate: numIn(b.win_rate, 'Win rate', 0, 100), profit_factor: numIn(b.profit_factor, 'Profit factor', 0, 100), trades: Math.round(numIn(b.trades, 'Trades', 0, 1e6)), followers: Math.round(numIn(b.followers, 'Followers', 0, 1e8)), max_dd: numIn(b.max_dd ?? 0, 'Max drawdown', 0, 100) };
  };
  route('GET', '/api/admin/featured', (ctx) => {
    requireAdmin(ctx);
    return { featured: q.all('SELECT * FROM featured_traders ORDER BY gain DESC, id').map((f) => ({ ...f, spark: undefined })),
      real: q.all('SELECT lp.user_id, lp.alias, lp.site_approved, lp.is_public, u.name FROM leader_profiles lp JOIN users u ON u.id = lp.user_id').map((r) => ({ ...r, stats: copy.profileStats(q.get('SELECT * FROM leader_profiles WHERE user_id = ?', r.user_id), '30d') })).map((r) => ({ user_id: r.user_id, alias: r.alias, name: r.name, approved: !!r.site_approved, is_public: !!r.is_public, avatar: r.stats ? r.stats.avatar : '', gain: r.stats ? r.stats.gain : null, win_rate: r.stats ? r.stats.win_rate : 0, followers: r.stats ? r.stats.followers : 0, trades: r.stats ? r.stats.trades : 0 })).sort((a, b) => (b.gain ?? -1e9) - (a.gain ?? -1e9)) };
  });
  route('POST', '/api/admin/featured', (ctx) => {
    requireAdmin(ctx); const f = featuredIn(ctx.body);
    const r = q.run('INSERT INTO featured_traders (alias, bio, avatar, gain, win_rate, profit_factor, trades, followers, max_dd, spark) VALUES (?,?,?,?,?,?,?,?,?,?)', f.alias, f.bio, f.avatar, f.gain, f.win_rate, f.profit_factor, f.trades, f.followers, f.max_dd, JSON.stringify(makeSpark(f.alias, f.gain)));
    return { id: Number(r.lastInsertRowid) };
  });
  route('PUT', '/api/admin/featured/:id', (ctx) => {
    requireAdmin(ctx); const id = Number(ctx.params.id); const old = q.get('SELECT * FROM featured_traders WHERE id = ?', id); if (!old) throw new HttpError(404, 'Not found');
    const f = featuredIn({ ...old, ...ctx.body });
    q.run('UPDATE featured_traders SET alias=?, bio=?, avatar=?, gain=?, win_rate=?, profit_factor=?, trades=?, followers=?, max_dd=?, spark=? WHERE id=?', f.alias, f.bio, f.avatar, f.gain, f.win_rate, f.profit_factor, f.trades, f.followers, f.max_dd, f.gain === old.gain && f.alias === old.alias ? old.spark : JSON.stringify(makeSpark(f.alias, f.gain)), id);
    return { ok: true };
  });
  route('DELETE', '/api/admin/featured/:id', (ctx) => { requireAdmin(ctx); q.run('DELETE FROM featured_traders WHERE id = ?', Number(ctx.params.id)); return { ok: true }; });
  route('PATCH', '/api/admin/leaders/:userId/approval', (ctx) => { const a = requireAdmin(ctx); q.run('UPDATE leader_profiles SET site_approved = ? WHERE user_id = ?', ctx.body.approved ? 1 : 0, Number(ctx.params.userId)); audit(a.id, ctx.body.approved ? 'approved strategy for website' : 'removed strategy from website', ctx.params.userId); return { ok: true }; });

  const testimonialIn = (b) => ({ name: str(b.name, 60, 'Name', true), role: str(b.role, 60, 'Role'), quote: str(b.quote, 400, 'Quote', true), rating: Math.round(numIn(b.rating ?? 5, 'Rating', 1, 5)), avatar: avatarOk(b.avatar) });
  route('GET', '/api/admin/testimonials', (ctx) => { requireAdmin(ctx); return { testimonials: q.all('SELECT * FROM testimonials ORDER BY sort, id') }; });
  route('GET', '/api/admin/user-reviews', (ctx) => { requireAdmin(ctx); return { reviews: q.all('SELECT r.id, r.rating, r.quote, r.role, r.status, u.name, u.email, u.avatar FROM reviews r JOIN users u ON u.id = r.user_id ORDER BY r.id DESC LIMIT 300') }; });
  route('POST', '/api/admin/testimonials', (ctx) => { requireAdmin(ctx); const t = testimonialIn(ctx.body); const r = q.run('INSERT INTO testimonials (name, role, quote, rating, avatar) VALUES (?,?,?,?,?)', t.name, t.role, t.quote, t.rating, t.avatar); return { id: Number(r.lastInsertRowid) }; });
  route('PUT', '/api/admin/testimonials/:id', (ctx) => { requireAdmin(ctx); const old = q.get('SELECT * FROM testimonials WHERE id = ?', Number(ctx.params.id)); if (!old) throw new HttpError(404, 'Not found'); const t = testimonialIn({ ...old, ...ctx.body }); q.run('UPDATE testimonials SET name=?, role=?, quote=?, rating=?, avatar=? WHERE id=?', t.name, t.role, t.quote, t.rating, t.avatar, old.id); return { ok: true }; });
  route('DELETE', '/api/admin/testimonials/:id', (ctx) => { requireAdmin(ctx); q.run('DELETE FROM testimonials WHERE id = ?', Number(ctx.params.id)); return { ok: true }; });

  // First run only: demo testimonials so the section is populated. Delete them in Admin when real ones arrive.
  if (!q.get("SELECT 1 FROM site_settings WHERE key = 'testimonials_seeded'")) {
    [['David K.', 'Forex Trader', 'JPX Traders has completely changed my trading journey. The copy trading feature is amazing and super easy to use!', 'p1'],
      ['Sarah M.', 'Crypto Trader', 'The platform is smooth and reliable, and the support team is always there when I need help. Highly recommended!', 'p2'],
      ['Alex R.', 'Day Trader', "I've been using JPX for 6 months and my results have been incredible. The analytics tools are top-notch!", 'p3'],
      ['Linda T.', 'Swing Trader', 'Simple, powerful and effective. JPX Traders makes trading accessible for everyone.', 'p4']]
      .forEach((t, i) => q.run('INSERT INTO testimonials (name, role, quote, rating, avatar, sort, demo) VALUES (?,?,?,?,?,?,1)', t[0], t[1], t[2], 5, `/img/traders/${t[3]}.svg`, i));
    q.run("INSERT INTO site_settings (key, value) VALUES ('testimonials_seeded', '1')");
  }

  // First run only: show five top traders on the landing page leaderboard. Deleting them in Admin is permanent.
  if (!q.get("SELECT 1 FROM site_settings WHERE key = 'featured_seeded'")) {
    const demo = [
      ['Marcus Lee', 'London session breakouts on majors', 24.8, 71.4, 3.1, 86, 1240, 2.1], ['Sofia Reyes', 'Gold and indices, strict 1% risk', 19.3, 68.2, 2.7, 72, 986, 3.4],
      ['Daniel Kim', 'Swing trades on JPY pairs', 16.1, 64.9, 2.4, 64, 742, 4.0], ['Aisha Bello', 'Pullback entries, 1:2 reward to risk', 12.7, 66.0, 2.2, 58, 615, 3.1],
      ['Kenji Mori', 'New York open scalps on EURUSD', 9.4, 61.5, 1.9, 47, 408, 5.2],
    ];
    demo.forEach((d, i) => q.run('INSERT INTO featured_traders (alias, bio, avatar, gain, win_rate, profit_factor, trades, followers, max_dd, spark) VALUES (?,?,?,?,?,?,?,?,?,?)', d[0], d[1], `/img/traders/t${i + 1}.svg`, d[2], d[3], d[4], d[5], d[6], d[7], JSON.stringify(makeSpark(d[0], d[2]))));
    q.run("INSERT INTO site_settings (key, value) VALUES ('featured_seeded', '1')");
  }

  /* ------------------------------------------------ health + backups */
  route('GET', '/api/health', () => { q.get('SELECT 1 AS ok'); return { ok: true }; }, { public: true });
  route('GET', '/api/admin/backup', (ctx) => {
    const a = requireAdmin(ctx);
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
    const tmp = path.join(os.tmpdir(), `jpx-backup-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
    require('./db').db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const buf = fs.readFileSync(tmp); fs.rmSync(tmp, { force: true });
    audit(a.id, 'downloaded database backup', '');
    return { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="jpx-backup-${new Date().toISOString().slice(0, 10)}.db"` }, raw: buf };
  });
  route('GET', '/api/admin/system', (ctx) => {
    requireAdmin(ctx); const path = require('node:path');
    return { data_dir: path.resolve(process.env.JPX_DATA_DIR || path.join(__dirname, '..', 'data')), persistent_hint: !!process.env.JPX_DATA_DIR, metaapi: meta.configured(), stripe: stripe.configured(), node: process.version };
  });

  /* ------------------------------------------------ editable website settings */
  const SITE_DEFAULTS = {
    stat_number: '10,000+', stat_label: 'Active Traders Worldwide',
    reviews_intro: 'Join thousands of traders who are already growing with JPX.',
    social_telegram: '', social_x: '', social_youtube: '', social_discord: '',
  };
  const siteSettings = () => { const out = { ...SITE_DEFAULTS }; for (const r of q.all('SELECT key, value FROM site_settings')) if (r.key in out) out[r.key] = r.value; return out; };
  route('GET', '/api/public/site', () => ({ site: siteSettings() }), { public: true });
  route('GET', '/api/admin/site', (ctx) => { requireAdmin(ctx); return { site: siteSettings(), defaults: SITE_DEFAULTS }; });
  route('PUT', '/api/admin/site', (ctx) => {
    const a = requireAdmin(ctx); const b = ctx.body;
    const lim = { stat_number: 20, stat_label: 60, reviews_intro: 140, social_telegram: 300, social_x: 300, social_youtube: 300, social_discord: 300 };
    for (const k of Object.keys(lim)) {
      if (b[k] === undefined) continue;
      const v = str(b[k], lim[k], k.replace(/_/g, ' '));
      if (k.startsWith('social_') && v && !/^https?:\/\/[^\s<>"']+$/i.test(v)) throw bad('Links must start with https://');
      q.run('INSERT INTO site_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, v);
    }
    audit(a.id, 'updated website settings', '');
    return { site: siteSettings() };
  });

  /* ------------------------------------------------ leaderboard + leader profile */
  route('GET', '/api/copy/leaders', (ctx) => {
    const u = requireUser(ctx);
    const period = copy.PERIODS[ctx.query.period] !== undefined ? ctx.query.period : '30d';
    const mine = new Set(q.all('SELECT leader_user_id AS id FROM follows WHERE follower_id = ?', u.id).map((r) => r.id));
    const elite = limits(u).eliteStrategies;
    return { period, leaders: board(period, 100).map((x) => ({ ...x, following: mine.has(x.user_id), locked: x.elite_only && !elite, me: x.user_id === u.id })) };
  });
  route('GET', '/api/copy/leaders/:id', (ctx) => {
    const u = requireUser(ctx);
    const prof = q.get('SELECT * FROM leader_profiles WHERE user_id = ? AND is_public = 1', Number(ctx.params.id));
    if (!prof || !leaderUsable(prof.user_id)) throw new HttpError(404, 'Trader not found');
    const period = copy.PERIODS[ctx.query.period] !== undefined ? ctx.query.period : '90d';
    const stats = copy.profileStats(prof, period);
    const locked = !!prof.elite_only && !limits(u).eliteStrategies && prof.user_id !== u.id;
    const recent = locked ? [] : q.all("SELECT symbol, side, volume, entry_price, exit_price, opened_at, closed_at, status, profit + commission + swap AS net FROM signals WHERE leader_user_id = ? ORDER BY COALESCE(closed_at, opened_at) DESC LIMIT 20", prof.user_id);
    const f = q.get('SELECT * FROM follows WHERE follower_id = ? AND leader_user_id = ?', u.id, prof.user_id);
    return { leader: stats, locked, recent, follow: f || null };
  });

  route('GET', '/api/copy/profile', (ctx) => {
    const u = requireUser(ctx);
    const p = q.get('SELECT * FROM leader_profiles WHERE user_id = ?', u.id);
    return { profile: p || null, can_publish: limits(u).publish, can_elite: limits(u).eliteStrategies, followers: p ? q.get("SELECT COUNT(*) AS n FROM follows WHERE leader_user_id = ? AND status = 'active'", u.id).n : 0 };
  });
  route('PUT', '/api/copy/profile', (ctx) => {
    const u = requireUser(ctx); const b = ctx.body;
    needPlan(u, limits(u).publish, 'Publishing a strategy is included in Pro and Elite. Upgrade to become a leader.');
    const alias = str(b.alias, 24, 'Display name', true);
    if (alias.length < 3 || !/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(alias)) throw bad('Display name must be 3 to 24 characters: letters, numbers, spaces, dot, dash or underscore');
    const bio = str(b.bio, 300, 'Bio');
    const acct = owned(u, b.account_id);
    const existing = q.get('SELECT * FROM leader_profiles WHERE user_id = ?', u.id);
    if (!existing && !bool(b.accept)) throw bad('Please confirm you understand your trades will be visible to followers');
    const taken = q.get('SELECT user_id FROM leader_profiles WHERE alias = ? AND user_id != ?', alias, u.id);
    if (taken) throw bad('That display name is already taken');
    const elite = limits(u).eliteStrategies && bool(b.elite_only) ? 1 : 0;
    const pub = b.is_public === undefined ? 1 : (bool(b.is_public) ? 1 : 0);
    q.run(`INSERT INTO leader_profiles (user_id, alias, bio, account_id, is_public, elite_only) VALUES (?,?,?,?,?,?)
           ON CONFLICT(user_id) DO UPDATE SET alias=excluded.alias, bio=excluded.bio, account_id=excluded.account_id, is_public=excluded.is_public, elite_only=excluded.elite_only`, u.id, alias, bio, acct.id, pub, elite);
    return { profile: q.get('SELECT * FROM leader_profiles WHERE user_id = ?', u.id) };
  });
  route('DELETE', '/api/copy/profile', (ctx) => {
    const u = requireUser(ctx);
    q.run('DELETE FROM leader_profiles WHERE user_id = ?', u.id);
    q.run('DELETE FROM follows WHERE leader_user_id = ?', u.id);
    return { ok: true };
  });

  /* ------------------------------------------------ following */
  const followOut = (f) => {
    const st = q.get('SELECT COUNT(m.follower_trade_id) AS copied, COALESCE(SUM(t.net),0) AS net FROM mirrors m LEFT JOIN trades t ON t.id = m.follower_trade_id WHERE m.follow_id = ?', f.id);
    const open = q.get("SELECT COUNT(*) AS n FROM mirrors m JOIN signals s ON s.id = m.signal_id WHERE m.follow_id = ? AND s.status = 'open'", f.id).n;
    const lp = q.get('SELECT alias FROM leader_profiles WHERE user_id = ?', f.leader_user_id);
    const acc = q.get('SELECT name, platform, api_key_hash IS NOT NULL AS has_key FROM accounts WHERE id = ?', f.follower_account_id);
    return { ...f, alias: lp ? lp.alias : '(removed)', account_name: acc ? acc.name : '', account_has_key: acc ? !!acc.has_key : false, copied: st.copied, net: Math.round(st.net * 100) / 100, open };
  };
  const followFields = (b, existing) => {
    const mode = b.mode === undefined ? (existing ? existing.mode : 'ratio') : b.mode;
    if (!['ratio', 'fixed'].includes(mode)) throw bad('Mode must be ratio or fixed');
    let mult = b.multiplier === undefined ? (existing ? existing.multiplier : 1) : Number(b.multiplier);
    if (!Number.isFinite(mult) || mult < 0.01 || mult > 100) throw bad('Multiplier must be between 0.01 and 100');
    return { mode, mult };
  };
  route('GET', '/api/copy/follows', (ctx) => ({ follows: q.all('SELECT * FROM follows WHERE follower_id = ? ORDER BY id DESC', requireUser(ctx).id).map(followOut), limit: limits(requireUser(ctx)).follow }));
  route('POST', '/api/copy/follows', (ctx) => {
    const u = requireUser(ctx); const b = ctx.body;
    const lim = limits(u);
    needPlan(u, lim.follow > 0, 'Copy trading is included in Starter and above. Upgrade to follow traders.');
    const lp = q.get('SELECT * FROM leader_profiles WHERE user_id = ? AND is_public = 1', Number(b.leader_id));
    if (!lp || !leaderUsable(lp.user_id)) throw new HttpError(404, 'Trader not found');
    if (lp.user_id === u.id) throw bad('You cannot copy yourself');
    if (lp.elite_only) needPlan(u, lim.eliteStrategies, 'This is an exclusive strategy for Elite members.');
    const acct = owned(u, b.account_id);
    if (acct.id === lp.account_id) throw bad('Choose a different account to copy into');
    const n = q.get('SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?', u.id).n;
    needPlan(u, n < lim.follow, `Your ${planInfo(u).name} plan lets you follow ${lim.follow} trader${lim.follow === 1 ? '' : 's'}. Upgrade to follow more.`);
    if (q.get('SELECT id FROM follows WHERE follower_id = ? AND leader_user_id = ?', u.id, lp.user_id)) throw bad('You already follow this trader');
    const { mode, mult } = followFields(b);
    const r = q.run('INSERT INTO follows (follower_id, leader_user_id, follower_account_id, mode, multiplier) VALUES (?,?,?,?,?)', u.id, lp.user_id, acct.id, mode, mult);
    return { follow: followOut(q.get('SELECT * FROM follows WHERE id = ?', Number(r.lastInsertRowid))) };
  });
  const ownedFollow = (u, id) => { const f = q.get('SELECT * FROM follows WHERE id = ? AND follower_id = ?', Number(id), u.id); if (!f) throw new HttpError(404, 'Not found'); return f; };
  route('PATCH', '/api/copy/follows/:id', (ctx) => {
    const u = requireUser(ctx); const f = ownedFollow(u, ctx.params.id); const b = ctx.body;
    const status = b.status === undefined ? f.status : b.status;
    if (!['active', 'paused'].includes(status)) throw bad('Status must be active or paused');
    const { mode, mult } = followFields(b, f);
    const acct = b.account_id === undefined ? { id: f.follower_account_id } : owned(u, b.account_id);
    if (status === 'active' && f.status === 'paused') {
      const lp = q.get('SELECT elite_only FROM leader_profiles WHERE user_id = ?', f.leader_user_id);
      if (!lp) throw bad('This trader is no longer available');
      if (lp.elite_only) needPlan(u, limits(u).eliteStrategies, 'This is an exclusive strategy for Elite members.');
    }
    q.run('UPDATE follows SET status=?, mode=?, multiplier=?, follower_account_id=? WHERE id=?', status, mode, mult, acct.id, f.id);
    return { follow: followOut(q.get('SELECT * FROM follows WHERE id = ?', f.id)) };
  });
  route('DELETE', '/api/copy/follows/:id', (ctx) => { q.run('DELETE FROM follows WHERE id = ?', ownedFollow(requireUser(ctx), ctx.params.id).id); return { ok: true }; });

  /* ------------------------------------------------ follower EA endpoints (API-key auth) */
  const keyAccount = (ctx) => {
    const key = String(ctx.req.headers['x-api-key'] || '');
    if (!/^jpx_[0-9a-f]{48}$/.test(key)) throw new HttpError(401, 'Missing or malformed X-API-Key header');
    rateLimit(`copyea:${sha(key)}`, 240, 60000);
    const a = q.get('SELECT * FROM accounts WHERE api_key_hash = ?', sha(key));
    if (!a) throw new HttpError(401, 'Invalid API key');
    const o = q.get('SELECT * FROM users WHERE id = ?', a.user_id);
    if (!o || o.status !== 'active') throw new HttpError(403, 'Account owner is suspended');
    needPlan(o, limits(o).follow > 0, 'Copy trading is not included in the current plan');
    return a;
  };
  route('GET', '/api/copy/pending', (ctx) => ({ actions: copy.pendingActions(keyAccount(ctx).id) }), { public: true, noCsrf: true });
  route('POST', '/api/copy/ack', (ctx) => {
    const a = keyAccount(ctx); const b = ctx.body;
    const m = q.get('SELECT m.* FROM mirrors m JOIN follows f ON f.id = m.follow_id WHERE m.id = ? AND f.follower_account_id = ?', Number(b.mirror_id), a.id);
    if (!m) throw new HttpError(404, 'Unknown mirror');
    if (b.action === 'open') {
      if (!b.ok) { q.run('UPDATE mirrors SET open_ack = 0 WHERE id = ?', m.id); return { ok: true }; }
      if (!b.ticket) throw bad('ticket is required when ok is true');
      q.run('UPDATE mirrors SET open_ack = 1, open_ticket = ? WHERE id = ?', String(b.ticket).slice(0, 64), m.id);
    } else if (b.action === 'close') q.run('UPDATE mirrors SET close_ack = 1 WHERE id = ?', m.id);
    else throw bad('action must be open or close');
    return { ok: true };
  }, { public: true, noCsrf: true });

  /* ------------------------------------------------ billing */
  const usage = (u) => ({
    accounts: q.get('SELECT COUNT(*) AS n FROM accounts WHERE user_id = ?', u.id).n,
    follows: q.get('SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?', u.id).n,
  });
  route('GET', '/api/billing', (ctx) => {
    const u = requireUser(ctx);
    return { plan: planInfo(u), usage: usage(u), plans: publicPlans(), payments_enabled: stripe.configured(), has_subscription: !!u.stripe_subscription_id, trial_days: TRIAL_DAYS };
  });
  route('POST', '/api/billing/checkout', async (ctx) => {
    const u = requireUser(ctx);
    if (!stripe.configured()) throw new HttpError(503, 'Online payments are not set up yet. Contact support to change your plan.');
    const plan = ctx.body.plan, interval = ctx.body.interval === 'year' ? 'year' : 'month';
    if (!PLANS[plan] || plan === 'free') throw bad('Choose a paid plan');
    const price = stripe.priceId(plan, interval);
    if (!price) throw new HttpError(503, 'That plan is not available for purchase yet');
    const base = origin(ctx);
    try {
      const s = await stripe.api('checkout/sessions', {
        mode: 'subscription', 'line_items[0][price]': price, 'line_items[0][quantity]': 1,
        customer: u.stripe_customer_id || undefined, customer_email: u.stripe_customer_id ? undefined : u.email,
        client_reference_id: String(u.id), 'metadata[user_id]': String(u.id), 'metadata[plan]': plan, 'metadata[interval]': interval,
        'subscription_data[metadata][user_id]': String(u.id), 'subscription_data[metadata][plan]': plan, 'subscription_data[metadata][interval]': interval,
        success_url: `${base}/app#/billing`, cancel_url: `${base}/app#/billing`,
      });
      return { url: s.url };
    } catch (e) { throw new HttpError(502, 'Payment provider error: ' + e.message); }
  });
  route('POST', '/api/billing/portal', async (ctx) => {
    const u = requireUser(ctx);
    if (!stripe.configured() || !u.stripe_customer_id) throw bad('No active subscription to manage');
    try { const s = await stripe.api('billing_portal/sessions', { customer: u.stripe_customer_id, return_url: `${origin(ctx)}/app#/billing` }); return { url: s.url }; }
    catch (e) { throw new HttpError(502, 'Payment provider error: ' + e.message); }
  });
  const setPlan = (userId, plan, interval, customer, sub) => {
    q.run("UPDATE users SET plan = ?, plan_source = 'stripe', plan_interval = ?, stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_subscription_id = ? WHERE id = ?", plan, interval || 'month', customer || null, sub || null, userId);
  };
  route('POST', '/api/stripe/webhook', (ctx) => {
    if (!process.env.STRIPE_WEBHOOK_SECRET) throw new HttpError(503, 'Webhook not configured');
    if (!stripe.verifySignature(ctx.raw || '', ctx.req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)) throw new HttpError(400, 'Invalid signature');
    const ev = ctx.body, obj = ev.data && ev.data.object || {};
    if (ev.type === 'checkout.session.completed') {
      const uid = Number(obj.metadata && obj.metadata.user_id || obj.client_reference_id);
      const plan = obj.metadata && obj.metadata.plan;
      if (uid && PLANS[plan]) setPlan(uid, plan, obj.metadata.interval, obj.customer, obj.subscription);
    } else if (ev.type === 'customer.subscription.updated' || ev.type === 'customer.subscription.created') {
      const u = q.get('SELECT * FROM users WHERE stripe_subscription_id = ? OR id = ?', obj.id, Number(obj.metadata && obj.metadata.user_id) || -1);
      if (u) {
        const price = obj.items && obj.items.data && obj.items.data[0] && obj.items.data[0].price && obj.items.data[0].price.id;
        const m = stripe.planFromPrice(price) || (obj.metadata && PLANS[obj.metadata.plan] ? { plan: obj.metadata.plan, interval: obj.metadata.interval } : null);
        if (['active', 'trialing'].includes(obj.status) && m) setPlan(u.id, m.plan, m.interval, obj.customer, obj.id);
        else if (['canceled', 'unpaid', 'incomplete_expired'].includes(obj.status)) q.run("UPDATE users SET plan = 'free', plan_source = 'stripe', stripe_subscription_id = NULL WHERE id = ?", u.id);
      }
    } else if (ev.type === 'customer.subscription.deleted') {
      q.run("UPDATE users SET plan = 'free', plan_source = 'stripe', stripe_subscription_id = NULL WHERE stripe_subscription_id = ?", obj.id);
    }
    return { received: true };
  }, { public: true, noCsrf: true });

  route('PATCH', '/api/admin/users/:id/plan', (ctx) => {
    const admin = requireAdmin(ctx); const t = q.get('SELECT * FROM users WHERE id = ?', Number(ctx.params.id));
    if (!t) throw new HttpError(404, 'User not found');
    const plan = ctx.body.plan; if (!PLANS[plan]) throw bad('Unknown plan');
    const mgr = ctx.body.account_manager === undefined ? t.account_manager : str(ctx.body.account_manager, 120, 'Account manager');
    q.run("UPDATE users SET plan = ?, plan_source = 'admin', account_manager = ? WHERE id = ?", plan, mgr, t.id);
    audit(admin.id, `set plan=${plan}`, t.email);
    return { ok: true };
  });

  /* ------------------------------------------------ support tickets (24/7 inbox) */
  const ticketFor = (u, id) => {
    const t = q.get('SELECT t.*, us.name AS user_name, us.email AS user_email FROM tickets t JOIN users us ON us.id = t.user_id WHERE t.id = ?', Number(id));
    if (!t || (t.user_id !== u.id && u.role !== 'admin')) throw new HttpError(404, 'Ticket not found');
    return t;
  };
  const thread = (id) => q.all("SELECT m.id, m.body, m.is_staff, m.created_at, COALESCE(u.name, 'Support') AS author FROM ticket_messages m LEFT JOIN users u ON u.id = m.author_id WHERE m.ticket_id = ? ORDER BY m.id", id);
  route('GET', '/api/support/tickets', (ctx) => ({ tickets: q.all('SELECT * FROM tickets WHERE user_id = ? ORDER BY updated_at DESC', requireUser(ctx).id) }));
  route('POST', '/api/support/tickets', (ctx) => {
    const u = requireUser(ctx); rateLimit(`tk:${u.id}`, 20, 3600000);
    const subject = str(ctx.body.subject, 120, 'Subject', true), body = str(ctx.body.message, 5000, 'Message', true);
    const category = ['general', 'billing', 'copy-trading', 'mt5-sync', 'bug'].includes(ctx.body.category) ? ctx.body.category : 'general';
    const r = q.tx(() => {
      const t = q.run('INSERT INTO tickets (user_id, subject, category, priority) VALUES (?,?,?,?)', u.id, subject, category, limits(u).priority ? 1 : 0);
      q.run('INSERT INTO ticket_messages (ticket_id, author_id, body) VALUES (?,?,?)', Number(t.lastInsertRowid), u.id, body);
      return t;
    });
    return { ticket: q.get('SELECT * FROM tickets WHERE id = ?', Number(r.lastInsertRowid)) };
  });
  route('GET', '/api/support/tickets/:id', (ctx) => { const u = requireUser(ctx); const t = ticketFor(u, ctx.params.id); return { ticket: t, messages: thread(t.id) }; });
  route('POST', '/api/support/tickets/:id/messages', (ctx) => {
    const u = requireUser(ctx); const t = ticketFor(u, ctx.params.id);
    const body = str(ctx.body.message, 5000, 'Message', true), staff = u.role === 'admin' && u.id !== t.user_id ? 1 : 0;
    q.run('INSERT INTO ticket_messages (ticket_id, author_id, is_staff, body) VALUES (?,?,?,?)', t.id, u.id, staff, body);
    q.run("UPDATE tickets SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", staff ? 'answered' : 'open', t.id);
    return { messages: thread(t.id) };
  });
  route('PATCH', '/api/support/tickets/:id', (ctx) => {
    const u = requireUser(ctx); const t = ticketFor(u, ctx.params.id);
    if (!['open', 'closed'].includes(ctx.body.status)) throw bad('Status must be open or closed');
    q.run('UPDATE tickets SET status = ? WHERE id = ?', ctx.body.status, t.id);
    return { ok: true };
  });
  route('GET', '/api/admin/tickets', (ctx) => {
    requireAdmin(ctx);
    const where = ctx.query.status && ['open', 'answered', 'closed'].includes(ctx.query.status) ? 'WHERE t.status = ?' : '';
    return { tickets: q.all(`SELECT t.*, u.name AS user_name, u.email AS user_email FROM tickets t JOIN users u ON u.id = t.user_id ${where} ORDER BY (t.status = 'closed'), t.priority DESC, t.updated_at DESC LIMIT 300`, ...(where ? [ctx.query.status] : [])) };
  });

  /* ------------------------------------------------ reviews (moderated, shown on the landing page) */
  route('GET', '/api/reviews/mine', (ctx) => ({ review: q.get('SELECT rating, quote, role, status FROM reviews WHERE user_id = ?', requireUser(ctx).id) || null }));
  route('POST', '/api/reviews', (ctx) => {
    const u = requireUser(ctx); const b = ctx.body;
    const rating = Math.round(Number(b.rating)); if (!(rating >= 1 && rating <= 5)) throw bad('Choose a rating from 1 to 5');
    const quote = str(b.quote, 400, 'Review', true); if (quote.length < 15) throw bad('Please write at least a sentence');
    const role = str(b.role, 40, 'Role');
    q.run(`INSERT INTO reviews (user_id, rating, quote, role, status) VALUES (?,?,?,?, 'pending')
           ON CONFLICT(user_id) DO UPDATE SET rating=excluded.rating, quote=excluded.quote, role=excluded.role, status='pending'`, u.id, rating, quote, role);
    return { ok: true };
  });
  route('GET', '/api/admin/reviews', (ctx) => { requireAdmin(ctx); return { reviews: q.all('SELECT r.*, u.name, u.email FROM reviews r JOIN users u ON u.id = r.user_id ORDER BY (r.status = \'pending\') DESC, r.id DESC LIMIT 200') }; });
  route('PATCH', '/api/admin/reviews/:id', (ctx) => {
    const a = requireAdmin(ctx); if (!['approved', 'rejected', 'pending'].includes(ctx.body.status)) throw bad('Invalid status');
    q.run('UPDATE reviews SET status = ? WHERE id = ?', ctx.body.status, Number(ctx.params.id)); audit(a.id, `review ${ctx.body.status}`, ctx.params.id); return { ok: true };
  });
  route('DELETE', '/api/admin/reviews/:id', (ctx) => { requireAdmin(ctx); q.run('DELETE FROM reviews WHERE id = ?', Number(ctx.params.id)); return { ok: true }; });

  /* ------------------------------------------------ personal API token (Elite) + read-only API */
  route('GET', '/api/me/api-token', (ctx) => { const u = requireUser(ctx); const t = q.get('SELECT prefix, created_at FROM api_tokens WHERE user_id = ?', u.id); return { token: t || null, allowed: limits(u).api }; });
  route('POST', '/api/me/api-token', (ctx) => {
    const u = requireUser(ctx); needPlan(u, limits(u).api, 'API access is included in the Elite plan.');
    const tok = `jpxk_${crypto.randomBytes(24).toString('hex')}`;
    q.run('INSERT INTO api_tokens (user_id, token_hash, prefix) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash, prefix=excluded.prefix, created_at=strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\')', u.id, sha(tok), tok.slice(0, 9));
    return { token: tok, note: 'Copy this token now. It is shown only once.' };
  });
  route('DELETE', '/api/me/api-token', (ctx) => { q.run('DELETE FROM api_tokens WHERE user_id = ?', requireUser(ctx).id); return { ok: true }; });
  const bearer = (ctx) => {
    const m = /^Bearer (jpxk_[0-9a-f]{48})$/.exec(String(ctx.req.headers.authorization || ''));
    if (!m) throw new HttpError(401, 'Send an Authorization: Bearer <token> header');
    rateLimit(`v1:${sha(m[1])}`, 120, 60000);
    const row = q.get('SELECT user_id FROM api_tokens WHERE token_hash = ?', sha(m[1]));
    const u = row && q.get("SELECT * FROM users WHERE id = ? AND status = 'active'", row.user_id);
    if (!u) throw new HttpError(401, 'Invalid token');
    needPlan(u, limits(u).api, 'API access requires the Elite plan');
    return u;
  };
  route('GET', '/api/v1/me', (ctx) => ({ user: publicUser(bearer(ctx)) }), { public: true });
  route('GET', '/api/v1/trades', (ctx) => {
    const u = bearer(ctx); const rows = loadTrades(u, ctx.query);
    const limit = Math.min(500, Math.max(1, parseInt(ctx.query.limit, 10) || 100)), page = Math.max(1, parseInt(ctx.query.page, 10) || 1);
    return { total: rows.length, page, limit, trades: rows.slice((page - 1) * limit, page * limit) };
  }, { public: true });
  route('GET', '/api/v1/analytics', (ctx) => { const u = bearer(ctx); return analyze(loadTrades(u, ctx.query), { tz: u.timezone, startingBalance: 0 }); }, { public: true });
};
