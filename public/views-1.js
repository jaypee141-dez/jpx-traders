/* Dashboard + Trades */
(function () {
  'use strict';
  var JPX = window.JPX, S = JPX.state, esc = JPX.esc, $ = JPX.$, $$ = JPX.$$, money = JPX.money, C = window.JPXCharts;

  var EMOTIONS = ['', 'Calm', 'Confident', 'Focused', 'Anxious', 'FOMO', 'Greedy', 'Revenge', 'Bored', 'Tired'];
  var RANGE_LABEL = { all: 'All time', today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', month: 'This month', year: 'This year' };

  JPX.rMultiple = function (t) { return t.risk_amount > 0 ? t.net / t.risk_amount : null; };
  JPX.fmtR = function (r) { return r == null ? '—' : (r > 0 ? '+' : '') + r.toFixed(2) + 'R'; };
  JPX.equityPoints = function (an) {
    return an.equity.map(function (p) { return { y: p.equity, tick: JPX.fmtDate(p.t, { year: undefined }), label: JPX.fmtDateTime(p.t) + ' · trade ' + money(p.net, { sign: true }) }; });
  };

  function totalTradeCount() { return S.accounts.reduce(function (s, a) { return s + a.trades; }, 0); }

  function onboarding(root) {
    var hasAcct = S.accounts.length > 0;
    root.innerHTML = '<div class="topbar"><div><h1>' + JPX.greeting() + ', ' + esc(S.user.name.split(' ')[0]) + '</h1><div class="sub">Your dashboard fills in as soon as you have trades.</div></div></div>' +
      '<div class="empty"><h3>Add your first trades</h3><p>JPX Traders computes every statistic from your real trade history. Pick a way to get trades in.</p>' +
      '<div class="steps">' +
      '<div class="step' + (hasAcct ? ' done' : '') + '"><div class="n">' + (hasAcct ? JPX.icon('check') : '1') + '</div><div><b>Create a trading account</b><span>Name it, set your starting balance and broker.</span></div>' + (hasAcct ? '' : '<button class="btn primary sm" data-go="#/brokers">Add account</button>') + '</div>' +
      '<div class="step"><div class="n">2</div><div><b>Bring in trades</b><span>Import a CSV from MT4/MT5, sync live from MT5, or log a trade by hand.</span></div><button class="btn sm" data-act="import">Import CSV</button></div>' +
      '<div class="step"><div class="n">3</div><div><b>Review and journal</b><span>Tag setups, rate execution and note what you would change.</span></div><button class="btn sm" data-act="add">Log a trade</button></div>' +
      '</div></div>';
    bindActions(root);
  }

  function bindActions(root) {
    $$('[data-go]', root).forEach(function (b) { b.addEventListener('click', function () { location.hash = b.dataset.go; }); });
    $$('[data-act="import"]', root).forEach(function (b) { b.addEventListener('click', function () { JPX.openImport(function () { JPX.route(); }); }); });
    $$('[data-act="add"]', root).forEach(function (b) { b.addEventListener('click', function () { JPX.openTradeForm(null, function () { JPX.route(); }); }); });
  }

  function tradeRow(t) {
    var r = JPX.rMultiple(t);
    return '<button class="trade-row" data-trade="' + t.id + '"><div class="dir ' + t.side + '">' + (t.side === 'long' ? 'L' : 'S') + '</div><div class="mid"><b>' + esc(t.symbol) + '</b><span>' + JPX.fmtDateTime(t.close_time) + (t.setup ? ' · ' + esc(t.setup) : '') + '</span></div><div style="text-align:right"><div class="amt num ' + JPX.cls(t.net) + '">' + money(t.net, { sign: true }) + '</div>' + (r != null ? '<span class="muted num" style="font-size:12.5px">' + JPX.fmtR(r) + '</span>' : '') + '</div></button>';
  }
  function bindTradeRows(root, reload) {
    $$('[data-trade]', root).forEach(function (b) { b.addEventListener('click', function () { JPX.openTrade(Number(b.dataset.trade), reload); }); });
  }

  /* ---------------- Dashboard ---------------- */
  JPX.views.dashboard = function (root) {
    return JPX.refreshAccounts().then(function () {
      if (!totalTradeCount()) return onboarding(root);
      return Promise.all([JPX.get('/api/analytics' + JPX.query()), JPX.get('/api/risk/status'), JPX.get('/api/trades' + JPX.query({ limit: 7 })), JPX.get('/api/risk/rules')]).then(function (res) {
        var an = res[0], risk = res[1], recent = res[2], rules = res[3].rules, s = an.summary;
        var hasRules = risk.checks.some(function (c) { return c.limit != null; });
        root.innerHTML =
          '<div class="topbar"><div><h1>' + JPX.greeting() + ', ' + esc(S.user.name.split(' ')[0]) + '</h1><div class="sub">' + RANGE_LABEL[S.range] + (S.acct !== 'all' ? ' · ' + esc((S.accounts.filter(function (a) { return String(a.id) === String(S.acct); })[0] || {}).name || '') : '') + '</div></div>' + JPX.filterHTML() + '<button class="btn primary" data-act="add">' + JPX.icon('plus') + 'Log trade</button></div>' +
          '<section class="sec"><div class="hero-metric"><div><div class="cap">Net P&amp;L</div><div class="big num ' + JPX.cls(s.net) + '">' + money(s.net, { sign: true }) + '</div></div>' +
          (s.startingBalance > 0 ? '<div class="hm-right"><div class="cap">Balance</div><div class="num" style="font-size:24px;font-weight:800;letter-spacing:-.03em">' + money(s.balance) + '</div></div>' : '') + '</div>' +
          '<div id="eq" class="chart-lg"></div>' +
          (s.trades ? '<div class="kpis">' +
            '<div class="kpi"><div class="k">Win rate</div><div class="kpi-ring"><div class="v num">' + s.winRate + '%</div><div id="ring"></div></div><div class="s num">' + s.wins + ' wins · ' + s.losses + ' losses' + (s.breakeven ? ' · ' + s.breakeven + ' even' : '') + '</div></div>' +
            '<div class="kpi"><div class="k">Profit factor</div><div class="v num">' + (s.profitFactor == null ? '∞' : s.profitFactor.toFixed(2)) + '</div><div class="s num">' + money(s.grossProfit, { dec: 0 }) + ' won, ' + money(-s.grossLoss, { dec: 0 }) + ' lost</div></div>' +
            '<div class="kpi"><div class="k">Expectancy</div><div class="v num ' + JPX.cls(s.expectancy) + '">' + money(s.expectancy, { sign: true }) + '</div><div class="s">per trade' + (s.avgR != null ? ' · avg ' + JPX.fmtR(s.avgR) : '') + '</div></div>' +
            '<div class="kpi"><div class="k">Avg win / loss</div><div class="v num"><span class="pos">' + money(s.avgWin, { dec: 0 }) + '</span> <span class="faint">/</span> <span class="neg">' + money(Math.abs(s.avgLoss), { dec: 0 }) + '</span></div><div class="s num">' + (s.payoff == null ? 'No losing trades' : s.payoff.toFixed(2) + ' payoff ratio') + '</div></div>' +
            '<div class="kpi"><div class="k">Max drawdown</div><div class="v num neg">' + money(-s.maxDrawdown, { dec: 0 }) + '</div><div class="s num">' + s.maxDrawdownPct + '% of peak equity</div></div>' +
            '<div class="kpi"><div class="k">Trades</div><div class="v num">' + s.trades + '</div><div class="s">avg hold ' + (s.avgHoldMinutes ? JPX.fmtMin(s.avgHoldMinutes) : '—') + '</div></div></div>' : '') + '</section>' +
          (!s.trades ? '<div class="empty"><h3>No trades in this range</h3><p>Try a wider date range or a different account.</p></div>' :
            '<div class="sec cols-main"><section><div class="sec-head"><h2>Recent trades</h2><a href="#/trades">View all trades</a></div><div>' + recent.trades.map(tradeRow).join('') + '</div></section>' +
            '<section><div class="sec-head"><h2>Today</h2><a href="#/risk">' + (hasRules ? 'Edit rules' : 'Set rules') + '</a></div>' + riskToday(risk, hasRules) + '</section></div>' +
            '<div class="sec cols-2"><section><div class="sec-head"><h2>Daily P&amp;L</h2><span class="sub">Last ' + Math.min(an.daily.length, 30) + ' trading days</span></div><div id="daily" class="chart-md"></div></section>' +
            '<section><div class="sec-head"><h2>Best and worst symbols</h2></div><div id="syms"></div></section></div>') + '';
        bindActions(root); bindTradeRows(root, function () { JPX.route(); });
        JPX.bindFilters(root, function () { JPX.route(); });
        if (!s.trades) return;
        C.area($('#eq', root), JPX.equityPoints(an), { zero: s.startingBalance === 0, label: 'Equity curve', format: function (v) { return C.compact(v); }, tipValue: function (p) { return money(p.y); } });
        C.ring($('#ring', root), s.winRate, { size: 40, stroke: 6, label: 'Win rate' });
        var days = an.daily.slice(-30);
        C.bars($('#daily', root), days.map(function (d) { return { label: d.date.slice(5), value: d.net, tip: money(d.net, { sign: true }), sub: JPX.fmtDay(d.date) + ' · ' + d.trades + ' trade' + (d.trades === 1 ? '' : 's') }; }));
        var syms = an.bySymbol.slice(0, 3).concat(an.bySymbol.length > 5 ? an.bySymbol.slice(-2) : an.bySymbol.slice(3));
        if (an.locked) $('#syms', root).innerHTML = '<p class="muted">Symbol breakdowns are part of Pro. <a href="#/billing">View plans</a></p>'; else C.hbars($('#syms', root), syms.map(function (b) { return { label: b.key, value: b.net, text: money(b.net, { sign: true }), sub: b.trades + ' trades · ' + b.winRate + '% win' }; }));
      });
    });
  };

  function riskToday(risk, hasRules) {
    var head = '<div class="num" style="font-size:30px;font-weight:800;letter-spacing:-.03em" ><span class="' + JPX.cls(risk.net) + '">' + money(risk.net, { sign: true }) + '</span></div><div class="muted" style="font-size:13.5px;margin-bottom:8px">' + risk.trades + ' trade' + (risk.trades === 1 ? '' : 's') + ' closed today</div>';
    if (!hasRules) return head + '<p class="muted" style="margin-top:12px">Set a daily loss limit and trade cap to get a live discipline check here.</p>';
    return head + risk.checks.filter(function (c) { return c.limit != null; }).map(function (c) {
      var pct = Math.min(100, (c.value / c.limit) * 100), money$ = c.key === 'max_daily_loss' || c.key === 'max_risk_per_trade';
      return '<div class="rule-row"><div class="rule-top"><span>' + c.label + '</span><span class="num ' + (c.breached ? 'neg' : '') + '">' + (money$ ? money(c.value, { dec: 0 }) + ' / ' + money(c.limit, { dec: 0 }) : c.value + ' / ' + c.limit) + '</span></div><div class="meter ' + (c.breached ? 'bad' : pct >= 75 ? 'warn' : '') + '"><i style="width:' + pct + '%"></i></div>' + (c.breached ? '<span class="neg" style="font-size:13px;font-weight:600">Limit reached. Step away.</span>' : '') + '</div>';
    }).join('');
  }

  /* ---------------- Trades ---------------- */
  var T = { page: 1, q: '', symbol: '', side: '', result: '', setup: '', sort: 'close_desc', limit: 25, selected: new Set() };
  var facets = { symbols: [], setups: [] };

  JPX.views.trades = function (root) {
    return Promise.all([JPX.refreshAccounts(), JPX.get('/api/trades/facets')]).then(function (r) {
      facets = r[1];
      root.innerHTML =
        '<div class="topbar"><div><h1>Trades</h1><div class="sub" id="t-sub"></div></div>' + JPX.filterHTML() +
        '<button class="btn hide-sm" data-act="import">' + JPX.icon('upload') + 'Import</button><a class="btn hide-sm" id="t-export" href="#">' + JPX.icon('download') + 'Export</a><button class="btn primary" data-act="add">' + JPX.icon('plus') + 'Log trade</button></div>' +
        '<div class="filters" style="margin-bottom:14px"><input class="input sm" id="t-q" type="search" placeholder="Search symbol, notes, tags" value="' + esc(T.q) + '" style="max-width:260px" aria-label="Search trades">' +
        sel('symbol', 'All symbols', facets.symbols) + sel('side', 'Long and short', [['long', 'Long'], ['short', 'Short']]) + sel('result', 'All results', [['win', 'Winners'], ['loss', 'Losers'], ['be', 'Break-even']]) + (facets.setups.length ? sel('setup', 'All setups', facets.setups) : '') +
        sel('sort', null, [['close_desc', 'Newest first'], ['close_asc', 'Oldest first'], ['net_desc', 'Best P&L'], ['net_asc', 'Worst P&L']]) +
        '<button class="btn danger sm" id="t-bulk" hidden>' + JPX.icon('trash') + '<span></span></button></div><div id="t-body"><div class="spin"></div></div>';
      bindActions(root);
      JPX.bindFilters(root, function () { T.page = 1; load(root); });
      var qt; $('#t-q', root).addEventListener('input', function (e) { clearTimeout(qt); qt = setTimeout(function () { T.q = e.target.value.trim(); T.page = 1; load(root); }, 250); });
      ['symbol', 'side', 'result', 'setup', 'sort'].forEach(function (k) { var el = $('[data-t="' + k + '"]', root); if (el) el.addEventListener('change', function () { T[k] = el.value; T.page = 1; load(root); }); });
      $('#t-export', root).addEventListener('click', function (e) { e.preventDefault(); window.location.href = '/api/export/trades.csv' + JPX.query(); });
      $('#t-bulk', root).addEventListener('click', function () {
        var ids = Array.from(T.selected);
        JPX.confirm({ title: 'Delete ' + ids.length + ' trade' + (ids.length === 1 ? '' : 's') + '?', message: 'This permanently removes them and their notes. It cannot be undone.', confirm: 'Delete', danger: true }).then(function (ok) {
          if (!ok) return;
          JPX.api('POST', '/api/trades/bulk-delete', { ids: ids }).then(function (r) { T.selected.clear(); JPX.toast('Deleted ' + r.deleted + ' trade' + (r.deleted === 1 ? '' : 's')); load(root); }, function (e) { JPX.toast(e.message, 'err'); });
        });
      });
      return load(root);
    });
  };
  function sel(key, allLabel, opts) {
    return '<select class="input sm" data-t="' + key + '" aria-label="' + esc(allLabel || 'Sort') + '" style="width:auto;max-width:170px">' + (allLabel ? '<option value="">' + esc(allLabel) + '</option>' : '') + opts.map(function (o) {
      var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(v) + '"' + (T[key] === v ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('') + '</select>';
  }

  function load(root) {
    var body = $('#t-body', root);
    return JPX.get('/api/trades' + JPX.query({ page: T.page, limit: T.limit, q: T.q, symbol: T.symbol, side: T.side, result: T.result, setup: T.setup, sort: T.sort })).then(function (r) {
      var pages = Math.max(1, Math.ceil(r.total / r.limit));
      if (T.page > pages) { T.page = pages; return load(root); }
      $('#t-sub', root).textContent = r.total ? r.total + ' trade' + (r.total === 1 ? '' : 's') + ' · ' + money(r.net, { sign: true }) + ' net · ' + Math.round((r.wins / r.total) * 100) + '% win rate' : '';
      if (!r.total) {
        var filtered = T.q || T.symbol || T.side || T.result || T.setup || S.range !== 'all';
        body.innerHTML = '<div class="empty"><h3>' + (filtered ? 'No trades match these filters' : 'No trades yet') + '</h3><p>' + (filtered ? 'Clear a filter or widen the date range.' : 'Log a trade by hand, import a CSV, or connect MT5 to sync automatically.') + '</p>' + (filtered ? '' : '<div class="acts"><button class="btn primary" data-act="add">Log a trade</button><button class="btn" data-act="import">Import CSV</button><button class="btn" data-go="#/brokers">Connect MT5</button></div>') + '</div>';
        bindActions(body); return;
      }
      var allChecked = r.trades.every(function (t) { return T.selected.has(t.id); });
      body.innerHTML = '<div class="tbl-wrap hide-sm"><table class="tbl"><thead><tr><th style="width:32px"><input type="checkbox" class="check" id="t-all" aria-label="Select all on page"' + (allChecked ? ' checked' : '') + '></th><th>Symbol</th><th>Closed</th><th>Held</th><th class="r">Size</th><th class="r">Entry / Exit</th><th class="r">Net P&amp;L</th><th class="r">R</th><th>Setup</th></tr></thead><tbody>' +
        r.trades.map(function (t) {
          var rr = JPX.rMultiple(t);
          return '<tr tabindex="0" data-trade="' + t.id + '"><td><input type="checkbox" class="check" data-sel="' + t.id + '" aria-label="Select trade"' + (T.selected.has(t.id) ? ' checked' : '') + '></td><td><span class="sym">' + esc(t.symbol) + '</span> <span class="chip ' + (t.side === 'long' ? 'pos' : 'neg') + '">' + t.side + '</span><span class="sub">' + esc(t.account_name) + (t.source !== 'manual' ? ' · ' + esc(t.source) : '') + '</span></td><td class="num">' + JPX.fmtDateTime(t.close_time) + '</td><td class="num">' + JPX.duration(t.open_time, t.close_time) + '</td><td class="r num">' + JPX.num(t.volume, 2) + '</td><td class="r num">' + (t.entry_price != null ? JPX.num(t.entry_price, 5) : '—') + ' <span class="faint">/</span> ' + (t.exit_price != null ? JPX.num(t.exit_price, 5) : '—') + '</td><td class="r num ' + JPX.cls(t.net) + '"><b>' + money(t.net, { sign: true }) + '</b></td><td class="r num ' + JPX.cls(rr) + '">' + JPX.fmtR(rr) + '</td><td>' + (t.setup ? esc(t.setup) : '<span class="faint">—</span>') + (t.rating ? ' <span class="rating" title="Rating">' + '★'.repeat(t.rating) + '</span>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="show-sm">' + r.trades.map(tradeRow).join('') + '</div>' +
        '<div class="pager"><span>Page ' + r.page + ' of ' + pages + '</span><div style="display:flex;gap:8px"><button class="btn sm" id="pg-prev"' + (r.page <= 1 ? ' disabled' : '') + '>' + JPX.icon('left') + 'Previous</button><button class="btn sm" id="pg-next"' + (r.page >= pages ? ' disabled' : '') + '>Next' + JPX.icon('right') + '</button></div></div>';
      bindTradeRows(body, function () { load(root); });
      $$('[data-trade]', body).forEach(function (tr) { tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') tr.click(); }); });
      $$('[data-sel]', body).forEach(function (cb) {
        cb.addEventListener('click', function (e) { e.stopPropagation(); });
        cb.addEventListener('change', function () { var id = Number(cb.dataset.sel); if (cb.checked) T.selected.add(id); else T.selected.delete(id); updBulk(root); });
      });
      var all = $('#t-all', body); if (all) all.addEventListener('change', function () { r.trades.forEach(function (t) { if (all.checked) T.selected.add(t.id); else T.selected.delete(t.id); }); $$('[data-sel]', body).forEach(function (cb) { cb.checked = all.checked; }); updBulk(root); });
      $('#pg-prev', body).addEventListener('click', function () { T.page--; load(root); window.scrollTo({ top: 0 }); });
      $('#pg-next', body).addEventListener('click', function () { T.page++; load(root); window.scrollTo({ top: 0 }); });
      updBulk(root);
    }, function (e) { body.innerHTML = '<div class="empty"><h3>Could not load trades</h3><p>' + esc(e.message) + '</p><button class="btn" id="retry">Try again</button></div>'; $('#retry', body).addEventListener('click', function () { load(root); }); });
  }
  function updBulk(root) { var b = $('#t-bulk', root); if (!b) return; b.hidden = T.selected.size === 0; $('span', b).textContent = 'Delete ' + T.selected.size; }

  /* ---------------- Trade form ---------------- */
  JPX.openTrade = function (id, onDone) {
    JPX.get('/api/trades/' + id).then(function (r) { JPX.openTradeForm(r.trade, onDone); }, function (e) { JPX.toast(e.message, 'err'); });
  };

  JPX.openTradeForm = function (t, onDone) {
    return JPX.get('/api/trades/facets').then(function (f) { facets = f; }, function () { /* datalists are optional */ }).then(function () { return buildTradeForm(t, onDone); });
  };
  function buildTradeForm(t, onDone) {
    if (!S.accounts.length) {
      JPX.modal({ title: 'Create an account first', size: 'narrow', body: '<p class="muted">Trades belong to a trading account, so you need at least one. It takes a few seconds.</p>', foot: '<button class="btn" data-close>Not now</button><button class="btn primary" id="go-acct">Add account</button>', onMount: function (d) { $('#go-acct', d).addEventListener('click', function () { d.close2(); location.hash = '#/brokers'; }); } });
      return;
    }
    var edit = !!t; t = t || { side: 'long', account_id: S.acct !== 'all' ? Number(S.acct) : S.accounts[0].id, open_time: new Date().toISOString(), close_time: new Date().toISOString() };
    var rr = edit ? JPX.rMultiple(t) : null;
    var f = function (name, label, type, extra) { return '<div class="field' + (extra && extra.full ? ' full' : '') + '"><label for="f-' + name + '">' + label + '</label><input class="input" id="f-' + name + '" name="' + name + '" type="' + (type || 'text') + '" ' + ((extra && extra.attrs) || '') + ' value="' + esc(t[name] == null ? '' : t[name]) + '" autocomplete="off"></div>'; };
    var body = (edit ? '<div style="display:flex;gap:24px;flex-wrap:wrap;padding-bottom:4px"><div><div class="lbl">Net P&amp;L</div><div class="num ' + JPX.cls(t.net) + '" style="font-size:26px;font-weight:800;letter-spacing:-.03em">' + money(t.net, { sign: true }) + '</div></div>' + (rr != null ? '<div><div class="lbl">Result</div><div class="num ' + JPX.cls(rr) + '" style="font-size:26px;font-weight:800;letter-spacing:-.03em">' + JPX.fmtR(rr) + '</div></div>' : '') + '<div><div class="lbl">Held</div><div class="num" style="font-size:26px;font-weight:800;letter-spacing:-.03em">' + JPX.duration(t.open_time, t.close_time) + '</div></div></div>' : '') +
      '<form id="tf" class="form-grid" novalidate>' +
      (edit ? '' : '<div class="field full"><label for="f-account_id">Account</label><select class="input" id="f-account_id" name="account_id">' + S.accounts.map(function (a) { return '<option value="' + a.id + '"' + (a.id === t.account_id ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') + '</select></div>') +
      f('symbol', 'Symbol', 'text', { attrs: 'list="dl-sym" required placeholder="EURUSD" maxlength="32" style="text-transform:uppercase"' }) +
      '<div class="field"><span class="lbl">Direction</span><div class="seg side" id="side-seg"><button type="button" data-v="long" aria-pressed="' + (t.side === 'long') + '">Long</button><button type="button" data-v="short" aria-pressed="' + (t.side === 'short') + '">Short</button></div></div>' +
      f('open_time', 'Opened', 'datetime-local', { attrs: 'required step="60"' }).replace('value="' + esc(t.open_time) + '"', 'value="' + JPX.toLocalInput(t.open_time) + '"') +
      f('close_time', 'Closed', 'datetime-local', { attrs: 'required step="60"' }).replace('value="' + esc(t.close_time) + '"', 'value="' + JPX.toLocalInput(t.close_time) + '"') +
      f('volume', 'Size (lots / contracts)', 'number', { attrs: 'step="any" min="0" required inputmode="decimal"' }) + f('profit', 'Gross profit / loss', 'number', { attrs: 'step="any" required inputmode="decimal" placeholder="-125.50"' }) +
      f('commission', 'Commission', 'number', { attrs: 'step="any" inputmode="decimal" placeholder="-3.50"' }) + f('swap', 'Swap', 'number', { attrs: 'step="any" inputmode="decimal"' }) +
      f('entry_price', 'Entry price', 'number', { attrs: 'step="any" inputmode="decimal"' }) + f('exit_price', 'Exit price', 'number', { attrs: 'step="any" inputmode="decimal"' }) +
      f('stop_loss', 'Stop loss', 'number', { attrs: 'step="any" inputmode="decimal"' }) + f('take_profit', 'Take profit', 'number', { attrs: 'step="any" inputmode="decimal"' }) +
      '<div class="field full"><label for="f-risk_amount">Amount risked</label><input class="input" id="f-risk_amount" name="risk_amount" type="number" step="any" min="0" inputmode="decimal" value="' + esc(t.risk_amount == null ? '' : t.risk_amount) + '" placeholder="What you would lose at your stop. Enables R-multiples."></div>' +
      '<div class="field"><label for="f-setup">Setup</label><input class="input" id="f-setup" name="setup" list="dl-setup" maxlength="60" value="' + esc(t.setup || '') + '" placeholder="Breakout, pullback…" autocomplete="off"></div>' +
      '<div class="field"><label for="f-tags">Tags</label><input class="input" id="f-tags" name="tags" maxlength="200" value="' + esc(t.tags || '') + '" placeholder="london, news (comma separated)" autocomplete="off"></div>' +
      '<div class="field"><label for="f-emotion">Emotional state</label><select class="input" id="f-emotion" name="emotion">' + EMOTIONS.map(function (e) { return '<option value="' + e + '"' + (t.emotion === e ? ' selected' : '') + '>' + (e || 'Not recorded') + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><span class="lbl">Execution rating</span><div class="seg" id="rate-seg">' + [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" data-v="' + n + '" aria-pressed="' + (t.rating === n) + '" aria-label="' + n + ' of 5">' + n + '</button>'; }).join('') + '</div></div>' +
      '<div class="field full"><label for="f-mistakes">Mistakes</label><input class="input" id="f-mistakes" name="mistakes" maxlength="200" value="' + esc(t.mistakes || '') + '" placeholder="Moved stop, entered early, oversized…" autocomplete="off"></div>' +
      '<div class="field full"><label for="f-notes">Notes</label><textarea class="input" id="f-notes" name="notes" maxlength="5000" placeholder="Why you took it, what you saw, what you would change.">' + esc(t.notes || '') + '</textarea></div>' +
      '<div class="form-error full" id="tf-err" hidden></div></form>' +
      '<datalist id="dl-sym">' + facets.symbols.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist><datalist id="dl-setup">' + facets.setups.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist>';
    var foot = (edit ? '<button class="btn danger" id="tf-del" aria-label="Delete trade" style="margin-right:auto">' + JPX.icon('trash') + '<span class="hide-sm">Delete</span></button>' : '') + '<button class="btn" data-close>Cancel</button><button class="btn primary" id="tf-save">' + (edit ? 'Save changes' : 'Save trade') + '</button>';
    var dlg = JPX.modal({
      title: edit ? t.symbol + ' · ' + JPX.fmtDate(t.close_time) : 'Log a trade', size: 'wide', body: body, foot: foot, onMount: function (d) {
        var side = t.side, rating = t.rating || null, form = $('#tf', d);
        $$('#side-seg button', d).forEach(function (b) { b.addEventListener('click', function () { side = b.dataset.v; $$('#side-seg button', d).forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); }); });
        $$('#rate-seg button', d).forEach(function (b) { b.addEventListener('click', function () { var v = Number(b.dataset.v); rating = rating === v ? null : v; $$('#rate-seg button', d).forEach(function (x) { x.setAttribute('aria-pressed', Number(x.dataset.v) === rating); }); }); });
        var save = function () {
          var data = { side: side, rating: rating }, err = $('#tf-err', d); err.hidden = true;
          Array.prototype.forEach.call(form.elements, function (el) { if (el.name) data[el.name] = el.value; });
          ['volume', 'profit'].forEach(function (k) { if (data[k] === '') data[k] = null; });
          if (!data.symbol.trim()) { err.textContent = 'Enter a symbol'; err.hidden = false; return; }
          if (data.volume === null || data.profit === null) { err.textContent = 'Size and gross profit / loss are required'; err.hidden = false; return; }
          if (!data.open_time || !data.close_time) { err.textContent = 'Enter open and close times'; err.hidden = false; return; }
          if (data.account_id) data.account_id = Number(data.account_id);
          var btn = $('#tf-save', d); JPX.busy(btn, true);
          JPX.api(edit ? 'PATCH' : 'POST', edit ? '/api/trades/' + t.id : '/api/trades', data).then(function () {
            JPX.toast(edit ? 'Trade updated' : 'Trade saved'); d.close2(); if (onDone) onDone();
          }, function (e) { JPX.busy(btn, false); err.textContent = e.message; err.hidden = false; });
        };
        $('#tf-save', d).addEventListener('click', save);
        form.addEventListener('submit', function (e) { e.preventDefault(); save(); });
        var del = $('#tf-del', d);
        if (del) del.addEventListener('click', function () {
          JPX.confirm({ title: 'Delete this trade?', message: 'The trade and its notes are removed permanently. If it came from MT5 sync it will be re-added the next time that position is sent.', confirm: 'Delete trade', danger: true }).then(function (ok) {
            if (!ok) return;
            JPX.api('DELETE', '/api/trades/' + t.id).then(function () { JPX.toast('Trade deleted'); d.close2(); if (onDone) onDone(); }, function (e) { JPX.toast(e.message, 'err'); });
          });
        });
      },
    });
    return dlg;
  }

  /* ---------------- CSV import ---------------- */
  JPX.openImport = function (onDone, accountId) {
    if (!S.accounts.length) { JPX.openTradeForm(null); return; }
    var text = '', fname = '';
    JPX.modal({
      title: 'Import trades from CSV', size: 'wide',
      body: '<div class="field"><label for="imp-acct">Import into</label><select class="input" id="imp-acct">' + S.accounts.map(function (a) { return '<option value="' + a.id + '"' + (String(accountId || (S.acct !== 'all' ? S.acct : S.accounts[0].id)) === String(a.id) ? ' selected' : '') + '>' + esc(a.name) + (a.utc_offset ? ' (server UTC' + (a.utc_offset > 0 ? '+' : '') + a.utc_offset + ')' : '') + '</option>'; }).join('') + '</select></div>' +
        '<label class="drop" id="imp-drop" for="imp-file">' + JPX.icon('upload') + '<b id="imp-name">Choose a CSV file or drop it here</b><span class="hint">MT5 / MT4 position history, or any CSV with the columns below</span></label><input type="file" id="imp-file" accept=".csv,.txt,text/csv" class="sr">' +
        '<div class="hint">Required columns: <span class="code-inline">Symbol</span> <span class="code-inline">Type</span> (buy/sell) <span class="code-inline">Volume</span> <span class="code-inline">Open time</span> <span class="code-inline">Close time</span> <span class="code-inline">Profit</span>. Optional: Ticket, prices, S/L, T/P, Commission, Swap, Setup, Tags, Notes. Times are read in the account\'s broker server time; set its UTC offset in Brokers. Duplicates are skipped, so re-importing is safe. <a href="#" id="imp-tpl">Download a template</a></div>' +
        '<div id="imp-result"></div>',
      foot: '<button class="btn" data-close>Close</button><button class="btn primary" id="imp-go" disabled>Import trades</button>',
      onMount: function (d) {
        var file = $('#imp-file', d), go = $('#imp-go', d), res = $('#imp-result', d);
        var pick = function (f) {
          if (!f) return; if (f.size > 5 * 1024 * 1024) { JPX.toast('File is over 5 MB. Split it into smaller files.', 'err'); return; }
          var rd = new FileReader();
          rd.onload = function () { text = String(rd.result); fname = f.name; $('#imp-name', d).textContent = f.name + ' · ' + Math.max(0, text.split(/\r?\n/).filter(Boolean).length - 1) + ' rows'; go.disabled = false; res.innerHTML = ''; };
          rd.onerror = function () { JPX.toast('Could not read that file', 'err'); };
          rd.readAsText(f);
        };
        file.addEventListener('change', function () { pick(file.files[0]); });
        var drop = $('#imp-drop', d);
        ['dragover', 'dragenter'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
        ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
        drop.addEventListener('drop', function (e) { pick(e.dataTransfer.files[0]); });
        $('#imp-tpl', d).addEventListener('click', function (e) {
          e.preventDefault();
          var csv = 'Ticket,Symbol,Type,Volume,Open Time,Open Price,Close Time,Close Price,Commission,Swap,Profit,Setup,Notes\n1001,EURUSD,buy,0.50,2025-03-03 09:30:00,1.0850,2025-03-03 11:05:00,1.0875,-3.5,0,125.00,Breakout,Waited for retest\n';
          var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'jpx-import-template.csv'; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        });
        go.addEventListener('click', function () {
          JPX.busy(go, true, 'Importing…');
          JPX.api('POST', '/api/import', { account_id: Number($('#imp-acct', d).value), text: text }).then(function (r) {
            JPX.busy(go, false); go.disabled = true;
            res.innerHTML = '<div class="panel" style="padding:16px"><b class="' + (r.imported ? 'pos' : '') + '">' + r.imported + ' imported</b> · ' + r.skipped + ' duplicates skipped · ' + (r.errorCount || 0) + ' rows with problems' +
              (r.errors && r.errors.length ? '<ul style="margin:10px 0 0;padding-left:18px;font-size:13.5px" class="muted">' + r.errors.map(function (e) { return '<li>Row ' + e.row + ': ' + esc(e.error) + '</li>'; }).join('') + (r.errorCount > r.errors.length ? '<li>…and ' + (r.errorCount - r.errors.length) + ' more</li>' : '') + '</ul>' : '') + '</div>';
            if (r.imported) { JPX.toast('Imported ' + r.imported + ' trades'); JPX.refreshAccounts(); if (onDone) onDone(); }
          }, function (e) { JPX.busy(go, false); res.innerHTML = '<div class="form-error">' + esc(e.message) + '</div>'; });
        });
      },
    });
  };
})();
