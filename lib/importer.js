'use strict';

/* ---------- CSV parsing ---------- */
function detectDelimiter(line) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function parseCSV(text) {
  text = String(text).replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const delim = detectDelimiter(firstLine);
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/* ---------- Header mapping ---------- */
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES = {
  external_id: ['ticket', 'position', 'positionid', 'order', 'id', 'tradeid', 'deal'],
  symbol: ['symbol', 'instrument', 'pair', 'ticker', 'item'],
  side: ['type', 'side', 'direction', 'action'],
  volume: ['volume', 'lots', 'lot', 'size', 'quantity', 'qty'],
  entry_price: ['openprice', 'entryprice', 'entry', 'priceopen', 'buyprice'],
  exit_price: ['closeprice', 'exitprice', 'exit', 'priceclose', 'sellprice'],
  open_time: ['opentime', 'entrytime', 'opendate', 'entrydate', 'timeopen', 'opened'],
  close_time: ['closetime', 'exittime', 'closedate', 'exitdate', 'timeclose', 'closed'],
  stop_loss: ['sl', 'stoploss', 'stop', 's/l'],
  take_profit: ['tp', 'takeprofit', 'target', 't/p'],
  commission: ['commission', 'fee', 'fees', 'comm'],
  swap: ['swap', 'rollover'],
  profit: ['profit', 'pnl', 'pl', 'netpnl', 'realizedpnl', 'result', 'gross'],
  setup: ['setup', 'strategy'],
  tags: ['tags', 'tag'],
  notes: ['notes', 'comment', 'comments', 'note'],
  risk_amount: ['risk', 'riskamount'],
};

/** Map headers to fields. MT5 exports repeat "Time"/"Price": first = open, second = close. */
function mapHeaders(headers) {
  const map = {}; // field -> column index
  const seen = {};
  headers.forEach((h, idx) => {
    const k = norm(h);
    seen[k] = (seen[k] || 0) + 1;
    if (k === 'time' || k === 'date') {
      const f = seen[k] === 1 ? 'open_time' : 'close_time';
      if (!(f in map)) map[f] = idx;
      return;
    }
    if (k === 'price') {
      const f = seen[k] === 1 ? 'entry_price' : 'exit_price';
      if (!(f in map)) map[f] = idx;
      return;
    }
    for (const [field, names] of Object.entries(ALIASES)) {
      if (names.includes(k) && !(field in map)) { map[field] = idx; return; }
    }
  });
  return map;
}

/* ---------- Value parsing ---------- */
function num(v) {
  if (v === undefined || v === null) return null;
  let s = String(v).trim().replace(/\s/g, '').replace(/[$€£]/g, '');
  if (s === '' || s === '-') return null;
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, '');
  if (/,\d{1,2}$/.test(s) && !/\./.test(s)) s = s.replace(',', '.'); // 12,5 -> 12.5
  else s = s.replace(/,/g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** Parse a date/time into an ISO UTC string. offsetHours = broker server offset from UTC. */
function parseDT(v, offsetHours = 0) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const s = String(v).trim();
  let ms = null;
  if (/^\d{9,13}$/.test(s)) {
    const n = Number(s);
    return new Date(n < 1e11 ? n * 1000 : n).toISOString(); // epoch is already UTC
  }
  let m = s.match(/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (m) {
    const [, y, mo, d, h = '0', mi = '0', se = '0', tzs] = m;
    ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
    if (tzs) {
      if (tzs === 'Z') return new Date(ms).toISOString();
      const sign = tzs[0] === '-' ? -1 : 1; const digits = tzs.slice(1).replace(':', '');
      return new Date(ms - sign * (+digits.slice(0, 2) * 60 + +digits.slice(2)) * 60000).toISOString();
    }
  } else {
    m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/); // DD.MM.YYYY
    if (!m) return null;
    const [, d, mo, y, h = '0', mi = '0', se = '0'] = m;
    ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
  }
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms - offsetHours * 3600000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function parseSide(v) {
  const s = String(v || '').trim().toLowerCase();
  if (['buy', 'long', 'b', 'l', 'buy limit', 'buy stop'].includes(s)) return 'long';
  if (['sell', 'short', 's', 'sell limit', 'sell stop'].includes(s)) return 'short';
  return null;
}

const clip = (v, n) => String(v ?? '').trim().slice(0, n);

/**
 * Validate + normalise a raw trade object (from form, CSV or EA) into a DB-ready record.
 * Returns { ok: true, trade } or { ok: false, error }.
 */
function normalizeTrade(raw, { offsetHours = 0, partial = false } = {}) {
  const symbol = clip(raw.symbol, 32).toUpperCase();
  if (!symbol) return { ok: false, error: 'Symbol is required' };
  const side = parseSide(raw.side);
  if (!side) return { ok: false, error: 'Side must be buy/sell or long/short' };
  const open_time = parseDT(raw.open_time, offsetHours);
  const close_time = parseDT(raw.close_time, offsetHours);
  if (!open_time) return { ok: false, error: 'Open time is missing or not a recognised date' };
  if (!close_time) return { ok: false, error: 'Close time is missing or not a recognised date' };
  if (Date.parse(close_time) < Date.parse(open_time)) return { ok: false, error: 'Close time is before open time' };
  const volume = num(raw.volume);
  if (volume === null || volume < 0) return { ok: false, error: 'Volume must be a positive number' };
  const profit = num(raw.profit);
  if (profit === null) return { ok: false, error: 'Profit is required' };
  const commission = num(raw.commission) ?? 0;
  const swap = num(raw.swap) ?? 0;
  const rating = raw.rating === '' || raw.rating == null ? null : Math.round(num(raw.rating));
  if (rating !== null && (rating < 1 || rating > 5)) return { ok: false, error: 'Rating must be between 1 and 5' };
  const risk = num(raw.risk_amount);
  return {
    ok: true,
    trade: {
      external_id: raw.external_id ? clip(raw.external_id, 64) : null,
      symbol, side, volume,
      entry_price: num(raw.entry_price), exit_price: num(raw.exit_price),
      stop_loss: num(raw.stop_loss) || null, take_profit: num(raw.take_profit) || null,
      open_time, close_time, profit, commission, swap,
      net: Math.round((profit + commission + swap) * 100) / 100,
      risk_amount: risk && risk > 0 ? risk : null,
      setup: clip(raw.setup, 60), tags: clip(raw.tags, 200), emotion: clip(raw.emotion, 40),
      mistakes: clip(raw.mistakes, 200), rating, notes: clip(raw.notes, 5000),
    },
  };
}

/** Parse CSV text into normalised trades + row-level errors. */
function parseTradeCSV(text, offsetHours = 0) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { trades: [], errors: [{ row: 0, error: 'The file has no data rows' }], mapped: [] };
  // Skip leading preamble lines until a row that maps to symbol + profit
  let hi = 0;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const m = mapHeaders(rows[i]);
    if (m.symbol !== undefined && m.profit !== undefined) { hi = i; break; }
  }
  const map = mapHeaders(rows[hi]);
  const missing = ['symbol', 'side', 'open_time', 'close_time', 'volume', 'profit'].filter((f) => map[f] === undefined);
  if (missing.length) {
    return { trades: [], errors: [{ row: hi + 1, error: `Could not find column(s): ${missing.join(', ')}. Found headers: ${rows[hi].join(', ')}` }], mapped: Object.keys(map) };
  }
  const trades = [], errors = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    const raw = {};
    for (const [f, idx] of Object.entries(map)) raw[f] = r[idx];
    if (!String(raw.symbol || '').trim()) continue; // totals/blank lines
    const res = normalizeTrade(raw, { offsetHours });
    if (res.ok) trades.push(res.trade); else errors.push({ row: i + 1, error: res.error });
  }
  return { trades, errors, mapped: Object.keys(map) };
}

module.exports = { parseCSV, parseTradeCSV, normalizeTrade, parseDT, num, parseSide };
