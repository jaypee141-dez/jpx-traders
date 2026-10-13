'use strict';

const fmtCache = new Map();
function tzParts(tz) {
  if (!fmtCache.has(tz)) {
    let f;
    try {
      f = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', hourCycle: 'h23', weekday: 'short',
      });
    } catch { return tzParts('UTC'); }
    fmtCache.set(tz, f);
  }
  return fmtCache.get(tz);
}
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function localParts(iso, tz) {
  const parts = {};
  for (const p of tzParts(tz).formatToParts(new Date(iso))) parts[p.type] = p.value;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday: parts.weekday };
}

function round(n, d = 2) {
  if (!Number.isFinite(n)) return 0;
  const m = 10 ** d; return Math.round(n * m) / m;
}

function bucket(map, key, t) {
  if (!key) key = 'Unlabeled';
  const b = map.get(key) || { key, trades: 0, wins: 0, net: 0 };
  b.trades++; b.net += t.net; if (t.net > 0) b.wins++;
  map.set(key, b);
}
function finishBuckets(map, sortBy = 'net') {
  return [...map.values()].map((b) => ({
    key: b.key, trades: b.trades, wins: b.wins, net: round(b.net),
    winRate: b.trades ? round((b.wins / b.trades) * 100, 1) : 0,
    avg: b.trades ? round(b.net / b.trades) : 0,
  })).sort((a, b) => (sortBy === 'key' ? String(a.key).localeCompare(String(b.key)) : b.net - a.net));
}

/**
 * trades: closed trades with { net, close_time, open_time, symbol, side, setup, tags, risk_amount, commission, swap }
 * opts: { tz, startingBalance }
 */
function analyze(trades, { tz = 'UTC', startingBalance = 0 } = {}) {
  const list = [...trades].sort((a, b) => (a.close_time < b.close_time ? -1 : a.close_time > b.close_time ? 1 : a.id - b.id));
  const out = {
    summary: null, equity: [], daily: [], byHour: [], byWeekday: [], bySymbol: [], bySetup: [],
    bySide: [], byMonth: [], byTag: [], rBuckets: [], streaks: {},
  };
  if (!list.length) {
    out.summary = { trades: 0, net: 0, wins: 0, losses: 0, breakeven: 0, winRate: 0, profitFactor: 0, expectancy: 0,
      avgWin: 0, avgLoss: 0, payoff: 0, largestWin: 0, largestLoss: 0, fees: 0, avgR: null, avgHoldMinutes: 0,
      maxDrawdown: 0, maxDrawdownPct: 0, grossProfit: 0, grossLoss: 0, bestDay: null, worstDay: null,
      winningDays: 0, losingDays: 0, startingBalance, balance: startingBalance };
    return out;
  }

  let wins = 0, losses = 0, be = 0, gp = 0, gl = 0, fees = 0, holdSum = 0, holdN = 0;
  let largestWin = 0, largestLoss = 0, rSum = 0, rN = 0;
  let equity = startingBalance, peak = startingBalance, maxDD = 0, maxDDPct = 0;
  let curW = 0, curL = 0, maxW = 0, maxL = 0;
  const daily = new Map(), hour = new Map(), wd = new Map(), sym = new Map(), setup = new Map(),
    side = new Map(), month = new Map(), tag = new Map();
  const rb = new Map();

  for (const t of list) {
    const net = t.net;
    fees += (t.commission || 0) + (t.swap || 0);
    if (net > 0) { wins++; gp += net; curW++; curL = 0; if (net > largestWin) largestWin = net; }
    else if (net < 0) { losses++; gl += -net; curL++; curW = 0; if (net < largestLoss) largestLoss = net; }
    else { be++; curW = 0; curL = 0; }
    if (curW > maxW) maxW = curW;
    if (curL > maxL) maxL = curL;

    equity += net;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) { maxDD = dd; maxDDPct = peak > 0 ? (dd / peak) * 100 : 0; }
    out.equity.push({ t: t.close_time, equity: round(equity), net: round(net), dd: round(-dd) });

    const o = Date.parse(t.open_time), c = Date.parse(t.close_time);
    if (Number.isFinite(o) && Number.isFinite(c) && c >= o) { holdSum += (c - o) / 60000; holdN++; }

    if (t.risk_amount > 0) {
      const r = net / t.risk_amount; rSum += r; rN++;
      const k = Math.max(-5, Math.min(5, Math.round(r)));
      rb.set(k, (rb.get(k) || 0) + 1);
    }

    const cp = localParts(t.close_time, tz);
    const d = daily.get(cp.date) || { date: cp.date, net: 0, trades: 0, wins: 0, losses: 0 };
    d.net += net; d.trades++; if (net > 0) d.wins++; else if (net < 0) d.losses++;
    daily.set(cp.date, d);

    const op = localParts(t.open_time, tz);
    bucket(hour, String(op.hour).padStart(2, '0'), t);
    bucket(wd, op.weekday, t);
    bucket(sym, t.symbol, t);
    bucket(setup, t.setup, t);
    bucket(side, t.side, t);
    bucket(month, cp.date.slice(0, 7), t);
    const tags = (t.tags || '').split(',').map((s) => s.trim()).filter(Boolean);
    for (const g of tags) bucket(tag, g, t);
  }

  const n = list.length;
  const days = [...daily.values()].map((d) => ({ ...d, net: round(d.net) })).sort((a, b) => (a.date < b.date ? -1 : 1));
  out.daily = days;
  const best = days.reduce((a, b) => (!a || b.net > a.net ? b : a), null);
  const worst = days.reduce((a, b) => (!a || b.net < a.net ? b : a), null);
  const avgWin = wins ? gp / wins : 0, avgLoss = losses ? gl / losses : 0;

  out.summary = {
    trades: n, net: round(equity - startingBalance), wins, losses, breakeven: be,
    winRate: round((wins / n) * 100, 1),
    profitFactor: gl > 0 ? round(gp / gl) : (gp > 0 ? null : 0), // null => infinite
    expectancy: round((equity - startingBalance) / n),
    avgWin: round(avgWin), avgLoss: round(-avgLoss),
    payoff: avgLoss > 0 ? round(avgWin / avgLoss) : null,
    largestWin: round(largestWin), largestLoss: round(largestLoss), fees: round(fees),
    avgR: rN ? round(rSum / rN) : null, rTrades: rN,
    avgHoldMinutes: holdN ? Math.round(holdSum / holdN) : 0,
    maxDrawdown: round(maxDD), maxDrawdownPct: round(maxDDPct, 1),
    grossProfit: round(gp), grossLoss: round(-gl),
    bestDay: best, worstDay: worst,
    winningDays: days.filter((d) => d.net > 0).length, losingDays: days.filter((d) => d.net < 0).length,
    startingBalance, balance: round(equity),
  };
  out.streaks = { maxWin: maxW, maxLoss: maxL, currentWin: curW, currentLoss: curL };
  out.byHour = finishBuckets(hour, 'key');
  const wdOrder = Object.fromEntries(WEEKDAYS.map((d, i) => [d, i]));
  out.byWeekday = finishBuckets(wd, 'key').sort((a, b) => wdOrder[a.key] - wdOrder[b.key]);
  out.bySymbol = finishBuckets(sym);
  out.bySetup = finishBuckets(setup);
  out.bySide = finishBuckets(side);
  out.byMonth = finishBuckets(month, 'key');
  out.byTag = finishBuckets(tag);
  out.rBuckets = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5].map((k) => ({ r: k, count: rb.get(k) || 0 }));
  return out;
}

module.exports = { analyze, localParts, round };
