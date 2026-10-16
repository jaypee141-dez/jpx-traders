'use strict';
const { q } = require('./db');
const { analyze } = require('./analytics');

const r2 = (n) => Math.round(n * 100) / 100;

function accountBalance(accountId) {
  const a = q.get('SELECT starting_balance AS s, (SELECT COALESCE(SUM(net),0) FROM trades WHERE account_id = accounts.id) AS n FROM accounts WHERE id = ?', accountId);
  return a ? a.s + a.n : 0;
}

/** Volume a follower should trade for a leader's signal. */
function followerVolume(follow, signal) {
  let f = 1;
  if (follow.mode === 'fixed') f = follow.multiplier;
  else {
    const lb = accountBalance(signal.leader_account_id), fb = accountBalance(follow.follower_account_id);
    f = lb > 0 && fb > 0 ? fb / lb : 1;
  }
  return Math.max(0.01, r2(signal.volume * f));
}

function ensureMirror(follow, signal) {
  const ex = q.get('SELECT * FROM mirrors WHERE follow_id = ? AND signal_id = ?', follow.id, signal.id);
  if (ex) return ex;
  q.run('INSERT INTO mirrors (follow_id, signal_id, follower_volume) VALUES (?,?,?)', follow.id, signal.id, followerVolume(follow, signal));
  return q.get('SELECT * FROM mirrors WHERE follow_id = ? AND signal_id = ?', follow.id, signal.id);
}

const activeFollows = (leaderUserId) => q.all("SELECT * FROM follows WHERE leader_user_id = ? AND status = 'active'", leaderUserId);

/** Leader's open positions snapshot -> open signals (+ mirrors so follower EAs can act). */
function upsertOpenSignals(leaderUserId, accountId, positions) {
  let n = 0;
  for (const p of positions) {
    if (!p || !p.ref) continue;
    const ex = q.get('SELECT * FROM signals WHERE leader_account_id = ? AND ref = ?', accountId, String(p.ref));
    if (ex) continue; // already known (open or closed)
    q.run('INSERT INTO signals (leader_user_id, leader_account_id, ref, symbol, side, volume, entry_price, stop_loss, take_profit, opened_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      leaderUserId, accountId, String(p.ref), p.symbol, p.side, p.volume, p.entry_price, p.stop_loss, p.take_profit, p.opened_at);
    const sig = q.get('SELECT * FROM signals WHERE leader_account_id = ? AND ref = ?', accountId, String(p.ref));
    for (const f of activeFollows(leaderUserId)) if (sig.opened_at >= f.created_at) ensureMirror(f, sig);
    n++;
  }
  return n;
}

/** A leader trade closed (any source): mark/insert its signal as closed and mirror it to followers' journals. */
function publishClosedTrade(trade, insertTrade) {
  const prof = q.get('SELECT * FROM leader_profiles WHERE user_id = ? AND account_id = ?', trade.user_id, trade.account_id);
  if (!prof || trade.source === 'copy') return;
  const ref = trade.external_id || `t${trade.id}`;
  const vals = [trade.symbol, trade.side, trade.volume, trade.entry_price, trade.stop_loss, trade.take_profit, trade.open_time, trade.close_time, trade.exit_price, trade.profit, trade.commission, trade.swap];
  const ex = q.get('SELECT * FROM signals WHERE leader_account_id = ? AND ref = ?', trade.account_id, ref);
  if (ex) {
    q.run("UPDATE signals SET symbol=?, side=?, volume=?, entry_price=?, stop_loss=?, take_profit=?, opened_at=?, closed_at=?, exit_price=?, profit=?, commission=?, swap=?, status='closed' WHERE id=?", ...vals, ex.id);
  } else {
    q.run("INSERT INTO signals (leader_user_id, leader_account_id, ref, symbol, side, volume, entry_price, stop_loss, take_profit, opened_at, closed_at, exit_price, profit, commission, swap, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'closed')",
      trade.user_id, trade.account_id, ref, ...vals);
  }
  const sig = q.get('SELECT * FROM signals WHERE leader_account_id = ? AND ref = ?', trade.account_id, ref);
  for (const f of activeFollows(trade.user_id)) {
    if (sig.opened_at < f.created_at) continue; // only trades opened after following began
    const m = ensureMirror(f, sig);
    if (m.close_done) continue;
    if (m.open_ack) { q.run('UPDATE mirrors SET close_done = 1 WHERE id = ?', m.id); continue; } // real trade executed by EA; it syncs back via MT5
    const k = m.follower_volume / sig.volume, alias = (prof.alias || 'leader');
    const t = {
      external_id: `copy:${sig.id}`, symbol: sig.symbol, side: sig.side, volume: m.follower_volume, entry_price: sig.entry_price, exit_price: sig.exit_price,
      stop_loss: sig.stop_loss, take_profit: sig.take_profit, open_time: sig.opened_at, close_time: sig.closed_at,
      profit: r2(sig.profit * k), commission: r2(sig.commission * k), swap: r2(sig.swap * k), net: r2((sig.profit + sig.commission + sig.swap) * k),
      risk_amount: null, setup: `Copy · ${alias}`, tags: 'copy-trade', emotion: '', mistakes: '', rating: null, notes: `Copied from ${alias} (${sig.symbol} ${sig.side}, ${m.follower_volume} lots)`,
    };
    try {
      const r = insertTrade(f.follower_id, f.follower_account_id, t, 'copy');
      q.run('UPDATE mirrors SET close_done = 1, follower_trade_id = ? WHERE id = ?', Number(r.lastInsertRowid), m.id);
    } catch (e) { if (!/UNIQUE/.test(e.message)) throw e; q.run('UPDATE mirrors SET close_done = 1 WHERE id = ?', m.id); }
  }
}

/** Actions a follower's EA should perform (authenticated by the follower account's API key). */
function pendingActions(accountId) {
  const rows = q.all(`SELECT m.id AS mirror_id, m.follower_volume, m.open_ack, m.close_ack, m.open_ticket, s.id AS signal_id, s.ref, s.symbol, s.side, s.stop_loss, s.take_profit, s.status
    FROM mirrors m JOIN follows f ON f.id = m.follow_id JOIN signals s ON s.id = m.signal_id
    WHERE f.follower_account_id = ? AND f.status = 'active' AND ((s.status = 'open' AND m.open_ack = 0) OR (s.status = 'closed' AND m.open_ack = 1 AND m.close_ack = 0))
    ORDER BY m.id LIMIT 100`, accountId);
  return rows.map((r) => (r.status === 'open'
    ? { mirror_id: r.mirror_id, action: 'open', symbol: r.symbol, side: r.side, volume: r.follower_volume, stop_loss: r.stop_loss, take_profit: r.take_profit, leader_ref: r.ref }
    : { mirror_id: r.mirror_id, action: 'close', ticket: r.open_ticket, symbol: r.symbol, leader_ref: r.ref }));
}

const PERIODS = { '30d': 30, '90d': 90, all: null };
function profileStats(prof, period) {
  const acct = q.get('SELECT * FROM accounts WHERE id = ?', prof.account_id);
  if (!acct) return null;
  const days = PERIODS[period] === undefined ? 30 : PERIODS[period];
  const cutoff = days ? new Date(Date.now() - days * 86400000).toISOString() : '0000';
  const prior = q.get('SELECT COALESCE(SUM(net),0) AS n FROM trades WHERE account_id = ? AND close_time < ?', acct.id, cutoff).n;
  const trades = q.all('SELECT * FROM trades WHERE account_id = ? AND close_time >= ?', acct.id, cutoff);
  const base = acct.starting_balance + prior;
  const an = analyze(trades, { tz: 'UTC', startingBalance: Math.max(base, 0) });
  const s = an.summary, step = Math.max(1, Math.ceil(an.equity.length / 60));
  const spark = an.equity.filter((_, i) => i % step === 0 || i === an.equity.length - 1).map((p) => (base > 0 ? r2((p.equity / base - 1) * 100) : r2(p.equity - base)));
  return {
    user_id: prof.user_id, alias: prof.alias, bio: prof.bio, elite_only: !!prof.elite_only, since: prof.created_at,
    gain: base > 0 && s.trades ? r2((s.net / base) * 100) : null, trades: s.trades, win_rate: s.winRate, profit_factor: s.profitFactor,
    max_drawdown_pct: s.maxDrawdownPct, avg_hold_min: s.avgHoldMinutes, spark,
    followers: q.get("SELECT COUNT(*) AS n FROM follows WHERE leader_user_id = ? AND status = 'active'", prof.user_id).n,
  };
}

function leaderboard(period = '30d', limit = 50) {
  const profiles = q.all("SELECT lp.* FROM leader_profiles lp JOIN users u ON u.id = lp.user_id WHERE lp.is_public = 1 AND u.status = 'active'");
  const list = profiles.map((p) => profileStats(p, period)).filter((x) => x && x.trades >= 3);
  list.sort((a, b) => (b.gain ?? -1e9) - (a.gain ?? -1e9) || b.followers - a.followers);
  return list.slice(0, limit).map((x, i) => ({ ...x, rank: i + 1 }));
}

module.exports = { upsertOpenSignals, publishClosedTrade, pendingActions, profileStats, leaderboard, followerVolume, PERIODS };
