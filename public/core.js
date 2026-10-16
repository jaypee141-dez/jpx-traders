/* JPX core: shared state, API client, formatting, UI primitives. */
(function () {
  'use strict';
  var JPX = (window.JPX = { state: { user: null, accounts: [], acct: 'all', range: 'all', from: '', to: '' }, views: {} });
  var S = JPX.state;

  /* ---------- helpers ---------- */
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  JPX.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); };
  var esc = JPX.esc;
  JPX.$ = function (sel, root) { return (root || document).querySelector(sel); };
  JPX.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var ICONS = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    trades: '<path d="M3 17l5-5 4 4 8-9"/><path d="M15 7h5v5"/>',
    journal: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    analytics: '<path d="M5 20V11M12 20V4M19 20v-6"/>',
    risk: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    brokers: '<path d="M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1"/><path d="M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1"/>',
    settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    admin: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>', download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', left: '<path d="m15 5-7 7 7 7"/>', right: '<path d="m9 5 7 7-7 7"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>', logout: '<path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M16 8l4 4-4 4M20 12H9"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>', copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
    copytrade: '<circle cx="7" cy="7" r="3"/><circle cx="17" cy="17" r="3"/><path d="M10 7h5a3 3 0 0 1 3 3v4M14 17H9a3 3 0 0 1-3-3v-4"/>', billing: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18M7 15h4"/>', support: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="m5.6 5.6 3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9"/>', lock: '<rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', check: '<path d="m5 12 5 5 9-10"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3"/>',
  };
  JPX.icon = function (n, cls) { return '<svg class="ico ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[n] || '') + '</svg>'; };
  JPX.logo = function () { return '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#3446d6"/><path d="M7 21l5-6 4 3 7-9" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="23" cy="9" r="2.4" fill="#2dd4a7"/></svg>'; };

  /* ---------- formatting ---------- */
  var nfCache = {};
  JPX.money = function (n, o) {
    o = o || {}; var cur = o.cur || (S.user && S.user.currency) || 'USD', key = cur + (o.dec == null ? '' : o.dec);
    if (!nfCache[key]) {
      try { nfCache[key] = new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, minimumFractionDigits: o.dec == null ? 2 : o.dec, maximumFractionDigits: o.dec == null ? 2 : o.dec }); }
      catch (e) { nfCache[key] = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    }
    var v = Number(n) || 0, s = nfCache[key].format(Math.abs(v));
    return (v < 0 ? '-' : (o.sign && v > 0 ? '+' : '')) + s;
  };
  JPX.num = function (n, d) { return n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d == null ? 2 : d, minimumFractionDigits: 0 }); };
  JPX.cls = function (n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : ''; };
  JPX.tz = function () { return (S.user && S.user.timezone) || 'UTC'; };
  JPX.todayStr = function () { return new Intl.DateTimeFormat('en-CA', { timeZone: JPX.tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); };
  JPX.fmtDate = function (iso, o) { return new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: JPX.tz(), month: 'short', day: 'numeric', year: 'numeric' }, o || {})).format(new Date(iso)); };
  JPX.fmtDateTime = function (iso) { return new Intl.DateTimeFormat('en-US', { timeZone: JPX.tz(), month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)); };
  JPX.fmtDay = function (ymd, o) { return new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }, o || {})).format(new Date(ymd + 'T00:00:00Z')); };
  JPX.toLocalInput = function (iso) {
    if (!iso) return '';
    var p = {}; new Intl.DateTimeFormat('en-CA', { timeZone: JPX.tz(), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(iso)).forEach(function (x) { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute;
  };
  JPX.fmtMin = function (m) {
    m = Math.max(0, Math.round(m));
    if (m < 60) return m + 'm'; if (m < 1440) return Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; return Math.floor(m / 1440) + 'd ' + Math.floor((m % 1440) / 60) + 'h';
  };
  JPX.duration = function (a, b) { return JPX.fmtMin((Date.parse(b) - Date.parse(a)) / 60000); };
  JPX.addDays = function (ymd, n) { var d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  JPX.greeting = function () {
    var h = Number(new Intl.DateTimeFormat('en-US', { timeZone: JPX.tz(), hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
    return h < 5 ? 'Late session' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  };

  /* ---------- API ---------- */
  JPX.api = function (method, url, body) {
    return fetch(url, {
      method: method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'jpx' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(function (r) {
      var ct = r.headers.get('content-type') || '';
      return (ct.indexOf('json') > -1 ? r.json() : r.text()).then(function (data) {
        if (!r.ok) {
          var err = new Error((data && data.error) || 'Request failed (' + r.status + ')'); err.status = r.status;
          if (r.status === 402) { err.upgrade = true; JPX.upgradePrompt(err.message); }
          if (r.status === 401 && url.indexOf('/api/auth/') !== 0 && S.user) { S.user = null; if (JPX.onSignedOut) JPX.onSignedOut(); }
          throw err;
        }
        return data;
      });
    }, function () { throw new Error('Cannot reach the server. Check your connection and try again.'); });
  };
  JPX.get = function (u) { return JPX.api('GET', u); };
  JPX.qs = function (o) {
    var p = new URLSearchParams();
    Object.keys(o).forEach(function (k) { if (o[k] !== '' && o[k] != null && o[k] !== 'all') p.set(k, o[k]); });
    var s = p.toString(); return s ? '?' + s : '';
  };

  /* ---------- upgrade prompt (plan limits) ---------- */
  var lastUp = '';
  JPX.upgradePrompt = function (msg) {
    lastUp = msg;
    JPX.modal({ title: 'Upgrade your plan', size: 'narrow', body: '<p class="muted">' + esc(msg) + '</p>', foot: '<button class="btn" data-close>Not now</button><button class="btn primary" id="up-go">View plans</button>',
      onMount: function (d) { JPX.$('#up-go', d).addEventListener('click', function () { d.close2(); location.hash = '#/billing'; }); } });
  };

  /* ---------- toast ---------- */
  JPX.toast = function (msg, kind) {
    if (kind === 'err' && msg === lastUp) return;
    var box = JPX.$('.toasts'); if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    var t = document.createElement('div'); t.className = 'toast' + (kind === 'err' ? ' err' : ''); t.textContent = msg; box.appendChild(t);
    setTimeout(function () { t.remove(); }, kind === 'err' ? 6000 : 3200);
  };

  /* ---------- modal ---------- */
  JPX.modal = function (o) {
    var dlg = document.createElement('dialog');
    if (o.sheet) dlg.className = 'sheet';
    dlg.innerHTML = '<div class="modal ' + (o.size || '') + '"><div class="modal-head"><h2>' + esc(o.title || '') + '</h2><button class="btn ghost icon sm" data-close aria-label="Close">' + JPX.icon('x') + '</button></div><div class="modal-body">' + (o.body || '') + '</div>' + (o.foot ? '<div class="modal-foot">' + o.foot + '</div>' : '') + '</div>';
    document.body.appendChild(dlg);
    var close = function (v) { if (dlg.open) dlg.close(); dlg._result = v; };
    dlg.close2 = close;
    dlg.addEventListener('click', function (e) { if (e.target === dlg || (e.target.closest && e.target.closest('[data-close]'))) close(); });
    dlg.addEventListener('close', function () { if (o.onClose) o.onClose(dlg._result); dlg.remove(); });
    dlg.showModal();
    if (o.onMount) o.onMount(dlg);
    return dlg;
  };
  JPX.confirm = function (o) {
    return new Promise(function (resolve) {
      var done = false;
      var dlg = JPX.modal({
        title: o.title, size: 'narrow', body: '<p class="muted">' + esc(o.message || '') + '</p>',
        foot: '<button class="btn" data-close>Cancel</button><button class="btn ' + (o.danger ? 'solid-danger' : 'primary') + '" data-ok>' + esc(o.confirm || 'Confirm') + '</button>',
        onClose: function () { if (!done) resolve(false); },
      });
      JPX.$('[data-ok]', dlg).addEventListener('click', function () { done = true; resolve(true); dlg.close2(); });
    });
  };
  JPX.busy = function (btn, on, label) {
    if (!btn) return;
    if (on) { btn._label = btn.innerHTML; btn.disabled = true; btn.textContent = label || 'Saving…'; } else { btn.disabled = false; if (btn._label) btn.innerHTML = btn._label; }
  };

  /* ---------- date range + account filters ---------- */
  var RANGES = [['all', 'All time'], ['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days'], ['month', 'This month'], ['year', 'This year']];
  try { var saved = JSON.parse(localStorage.getItem('jpx_filters') || '{}'); if (saved.acct) S.acct = saved.acct; if (saved.range) S.range = saved.range; } catch (e) { /* ignore */ }
  JPX.rangeDates = function () {
    var t = JPX.todayStr(), r = S.range;
    if (r === 'today') return { from: t, to: t };
    if (r === '7d') return { from: JPX.addDays(t, -6), to: t };
    if (r === '30d') return { from: JPX.addDays(t, -29), to: t };
    if (r === '90d') return { from: JPX.addDays(t, -89), to: t };
    if (r === 'month') return { from: t.slice(0, 8) + '01', to: t };
    if (r === 'year') return { from: t.slice(0, 4) + '-01-01', to: t };
    return { from: '', to: '' };
  };
  JPX.query = function (extra) { var d = JPX.rangeDates(); return JPX.qs(Object.assign({ account_id: S.acct, from: d.from, to: d.to }, extra || {})); };
  JPX.filterHTML = function (opts) {
    opts = opts || {};
    var accts = S.accounts.length > 1 || opts.always ? '<select class="input sm" data-f="acct" aria-label="Account"><option value="all">All accounts</option>' + S.accounts.map(function (a) { return '<option value="' + a.id + '"' + (String(S.acct) === String(a.id) ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') + '</select>' : '';
    var range = opts.noRange ? '' : '<select class="input sm" data-f="range" aria-label="Date range">' + RANGES.map(function (r) { return '<option value="' + r[0] + '"' + (S.range === r[0] ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select>';
    return '<div class="filters">' + accts + range + '</div>';
  };
  JPX.bindFilters = function (root, cb) {
    JPX.$$('[data-f]', root).forEach(function (el) {
      el.addEventListener('change', function () {
        S[el.dataset.f] = el.value;
        localStorage.setItem('jpx_filters', JSON.stringify({ acct: S.acct, range: S.range }));
        cb();
      });
    });
  };
  JPX.refreshAccounts = function () {
    return JPX.get('/api/accounts').then(function (r) {
      S.accounts = r.accounts;
      if (S.acct !== 'all' && !S.accounts.some(function (a) { return String(a.id) === String(S.acct); })) S.acct = 'all';
      return r.accounts;
    });
  };

  JPX.copy = function (text) {
    var done = function () { JPX.toast('Copied to clipboard'); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, function () { JPX.toast('Copy failed. Select the text and copy manually.', 'err'); });
    else { var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { JPX.toast('Copy failed. Select the text and copy manually.', 'err'); } ta.remove(); }
  };
  JPX.emptyChart = function (msg) { return '<div class="chart-empty">' + esc(msg) + '</div>'; };
})();
