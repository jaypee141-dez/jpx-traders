/* Calendar, Journal, Analytics */
(function () {
  'use strict';
  var JPX = window.JPX, S = JPX.state, esc = JPX.esc, $ = JPX.$, $$ = JPX.$$, money = JPX.money, C = window.JPXCharts;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  /* ---------------- Calendar ---------------- */
  var cal = null;
  JPX.views.calendar = function (root) {
    return JPX.refreshAccounts().then(function () {
      var t = JPX.todayStr(); if (!cal) cal = { y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)) - 1 };
      return drawCal(root);
    });
  };
  function drawCal(root) {
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var from = cal.y + '-' + pad(cal.m + 1) + '-01', last = new Date(Date.UTC(cal.y, cal.m + 1, 0)).getUTCDate(), to = cal.y + '-' + pad(cal.m + 1) + '-' + pad(last);
    return JPX.get('/api/analytics' + JPX.qs({ account_id: S.acct, from: from, to: to })).then(function (an) {
      var map = {}; an.daily.forEach(function (d) { map[d.date] = d; });
      var maxAbs = Math.max.apply(null, an.daily.map(function (d) { return Math.abs(d.net); }).concat([1]));
      var lead = (new Date(Date.UTC(cal.y, cal.m, 1)).getUTCDay() + 6) % 7, today = JPX.todayStr();
      var cells = [], weeks = [];
      for (var i = 0; i < lead; i++) cells.push(null);
      for (var d = 1; d <= last; d++) cells.push(cal.y + '-' + pad(cal.m + 1) + '-' + pad(d));
      while (cells.length % 7) cells.push(null);
      var html = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (n) { return '<div class="cal-dow">' + n + '</div>'; }).join('') + '<div class="cal-dow wk">Week</div>';
      for (var w = 0; w < cells.length; w += 7) {
        var wNet = 0, wTr = 0;
        cells.slice(w, w + 7).forEach(function (ymd) {
          if (!ymd) { html += '<div class="cal-day out"></div>'; return; }
          var dd = map[ymd], day = Number(ymd.slice(8));
          if (!dd) { html += '<div class="cal-day' + (ymd === today ? ' today' : '') + '"><span class="d">' + day + '</span></div>'; return; }
          wNet += dd.net; wTr += dd.trades;
          var a = Math.round(14 + (Math.abs(dd.net) / maxAbs) * 40), c = dd.net > 0 ? 'var(--profit)' : dd.net < 0 ? 'var(--loss)' : 'var(--faint)';
          html += '<button class="cal-day' + (ymd === today ? ' today' : '') + '" data-day="' + ymd + '" style="background:color-mix(in srgb,' + c + ' ' + a + '%,var(--surface))" aria-label="' + JPX.fmtDay(ymd) + ': ' + money(dd.net, { sign: true }) + ', ' + dd.trades + ' trades"><span class="d">' + day + '</span><span><div class="p num ' + JPX.cls(dd.net) + '">' + money(dd.net, { sign: true, dec: Math.abs(dd.net) >= 1000 ? 0 : 2 }) + '</div><div class="t">' + dd.trades + ' trade' + (dd.trades === 1 ? '' : 's') + '</div></span></button>';
        });
        html += '<div class="cal-day week"><span class="d">Week ' + (w / 7 + 1) + '</span>' + (wTr ? '<span><div class="p num ' + JPX.cls(wNet) + '">' + money(wNet, { sign: true, dec: Math.abs(wNet) >= 1000 ? 0 : 2 }) + '</div><div class="t">' + wTr + ' trade' + (wTr === 1 ? '' : 's') + '</div></span>' : '') + '</div>';
      }
      var s = an.summary;
      root.innerHTML = '<div class="topbar"><div><h1>Calendar</h1><div class="sub">Daily P&amp;L by the day each trade closed</div></div>' + JPX.filterHTML({ noRange: true }) + '</div>' +
        '<div class="cal-head"><button class="btn icon" id="c-prev" aria-label="Previous month">' + JPX.icon('left') + '</button><h2>' + MONTHS[cal.m] + ' ' + cal.y + '</h2><button class="btn icon" id="c-next" aria-label="Next month">' + JPX.icon('right') + '</button><button class="btn sm" id="c-today">Today</button>' +
        '<div class="cal-sum"><span>Net <b class="num ' + JPX.cls(s.net) + '">' + money(s.net, { sign: true }) + '</b></span><span>Trading days <b class="num">' + an.daily.length + '</b></span><span>Green days <b class="num">' + s.winningDays + '</b></span><span>Win rate <b class="num">' + s.winRate + '%</b></span></div></div>' +
        '<div class="cal-wrap">' + html + '</div>' + (!an.daily.length ? '<p class="muted" style="margin-top:18px">No trades closed this month.</p>' : '');
      JPX.bindFilters(root, function () { drawCal(root); });
      var step = function (n) { cal.m += n; if (cal.m < 0) { cal.m = 11; cal.y--; } if (cal.m > 11) { cal.m = 0; cal.y++; } drawCal(root); };
      $('#c-prev', root).addEventListener('click', function () { step(-1); }); $('#c-next', root).addEventListener('click', function () { step(1); });
      $('#c-today', root).addEventListener('click', function () { var t = JPX.todayStr(); cal.y = Number(t.slice(0, 4)); cal.m = Number(t.slice(5, 7)) - 1; drawCal(root); });
      $$('[data-day]', root).forEach(function (b) { b.addEventListener('click', function () { openDay(b.dataset.day, map[b.dataset.day]); }); });
    });
  }
  function openDay(ymd, d) {
    JPX.get('/api/trades' + JPX.qs({ account_id: S.acct, from: ymd, to: ymd, limit: 200, sort: 'close_asc' })).then(function (r) {
      JPX.modal({
        title: JPX.fmtDay(ymd), size: 'wide',
        body: '<div style="display:flex;gap:28px;flex-wrap:wrap"><div><div class="lbl">Net P&amp;L</div><div class="num ' + JPX.cls(d.net) + '" style="font-size:28px;font-weight:800;letter-spacing:-.03em">' + money(d.net, { sign: true }) + '</div></div><div><div class="lbl">Trades</div><div class="num" style="font-size:28px;font-weight:800">' + d.trades + '</div></div><div><div class="lbl">Win / loss</div><div class="num" style="font-size:28px;font-weight:800">' + d.wins + ' / ' + d.losses + '</div></div></div><div id="day-list">' + r.trades.map(function (t) {
          var rr = JPX.rMultiple(t);
          return '<button class="trade-row" data-trade="' + t.id + '"><div class="dir ' + t.side + '">' + (t.side === 'long' ? 'L' : 'S') + '</div><div class="mid"><b>' + esc(t.symbol) + '</b><span>' + JPX.fmtDateTime(t.open_time) + ' · held ' + JPX.duration(t.open_time, t.close_time) + (t.setup ? ' · ' + esc(t.setup) : '') + '</span></div><div style="text-align:right"><div class="amt num ' + JPX.cls(t.net) + '">' + money(t.net, { sign: true }) + '</div>' + (rr != null ? '<span class="muted num" style="font-size:12.5px">' + JPX.fmtR(rr) + '</span>' : '') + '</div></button>';
        }).join('') + '</div>',
        foot: '<button class="btn" data-close>Close</button><button class="btn primary" id="day-j">' + JPX.icon('journal') + 'Open journal for this day</button>',
        onMount: function (dlg) {
          $('#day-j', dlg).addEventListener('click', function () { dlg.close2(); location.hash = '#/journal/' + ymd; });
          $$('[data-trade]', dlg).forEach(function (b) { b.addEventListener('click', function () { dlg.close2(); JPX.openTrade(Number(b.dataset.trade), function () { JPX.route(); }); }); });
        },
      });
    }, function (e) { JPX.toast(e.message, 'err'); });
  }

  /* ---------------- Journal ---------------- */
  var MOODS = ['Calm', 'Focused', 'Confident', 'Anxious', 'Frustrated', 'Tired', 'Overexcited'];
  var jr = { dirty: false, date: null };
  function saveJournal(date, root) {
    var get = function (n) { var el = $('[name="' + n + '"]', root); return el ? el.value : ''; };
    var mood = ($('.mood[aria-pressed="true"]', root) || {}).dataset; mood = mood ? mood.v : '';
    return JPX.api('PUT', '/api/journal/' + date, { mood: mood, plan: get('plan'), content: get('content'), lessons: get('lessons') }).then(function () { jr.dirty = false; });
  }
  JPX.views.journal = function (root, arg) {
    var date = /^\d{4}-\d{2}-\d{2}$/.test(arg || '') ? arg : JPX.todayStr(); jr.date = date; jr.dirty = false;
    var from = JPX.addDays(date, -400);
    return Promise.all([JPX.refreshAccounts(), JPX.get('/api/journal' + JPX.qs({ from: from })), JPX.get('/api/analytics' + JPX.qs({ account_id: S.acct, from: date, to: date })), JPX.get('/api/trades' + JPX.qs({ account_id: S.acct, from: date, to: date, limit: 100, sort: 'close_asc' }))]).then(function (res) {
      var entries = res[1].entries, an = res[2], trades = res[3].trades, cur = entries.filter(function (e) { return e.date === date; })[0] || { mood: '', plan: '', content: '', lessons: '' };
      var day = an.daily[0], list = entries.slice();
      if (!list.some(function (e) { return e.date === date; })) list.unshift({ date: date, content: '', plan: '', mood: '', _new: true });
      root.innerHTML = '<div class="topbar"><div><h1>Journal</h1><div class="sub">Plan the session, review it, write down what you learned</div></div></div>' +
        '<div class="journal-grid"><aside><div class="sec-head"><h2>Entries</h2></div><div class="jlist">' + list.map(function (e) {
          var preview = e.content || e.plan || e.lessons || (e._new ? 'New entry' : ''); return '<button class="jitem" data-d="' + e.date + '"' + (e.date === date ? ' aria-current="true"' : '') + '><b>' + JPX.fmtDay(e.date, { year: undefined }) + (e.mood ? ' · ' + esc(e.mood) : '') + '</b><span>' + esc(preview.slice(0, 60)) + '</span></button>';
        }).join('') + '</div></aside>' +
        '<section><div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;flex-wrap:wrap"><button class="btn icon sm" id="j-prev" aria-label="Previous day">' + JPX.icon('left') + '</button><input type="date" class="input sm" id="j-date" value="' + date + '" style="width:auto" aria-label="Entry date"><button class="btn icon sm" id="j-next" aria-label="Next day">' + JPX.icon('right') + '</button><h2 style="margin-left:6px;font-size:20px">' + JPX.fmtDay(date) + '</h2></div>' +
        (day ? '<div style="display:flex;gap:28px;flex-wrap:wrap;margin-bottom:6px"><div><div class="lbl">Day P&amp;L</div><div class="num ' + JPX.cls(day.net) + '" style="font-size:26px;font-weight:800;letter-spacing:-.03em">' + money(day.net, { sign: true }) + '</div></div><div><div class="lbl">Trades</div><div class="num" style="font-size:26px;font-weight:800">' + day.trades + '</div></div><div><div class="lbl">Win / loss</div><div class="num" style="font-size:26px;font-weight:800">' + day.wins + ' / ' + day.losses + '</div></div></div><div style="margin-bottom:18px">' + trades.map(function (t) { return '<button class="chip ' + (t.net > 0 ? 'pos' : t.net < 0 ? 'neg' : '') + '" data-trade="' + t.id + '" style="cursor:pointer;margin:0 6px 6px 0">' + esc(t.symbol) + ' ' + money(t.net, { sign: true }) + '</button>'; }).join('') + '</div>' : '<p class="muted" style="margin-bottom:18px">No trades closed on this day.</p>') +
        '<div style="display:grid;gap:18px"><div class="field"><span class="lbl">How are you feeling</span><div class="mood-row">' + MOODS.map(function (m) { return '<button type="button" class="mood" data-v="' + m + '" aria-pressed="' + (cur.mood === m) + '">' + m + '</button>'; }).join('') + '</div></div>' +
        '<div class="field"><label for="j-plan">Game plan</label><textarea class="input" id="j-plan" name="plan" maxlength="10000" placeholder="Levels, setups you will take, what you will skip, your max loss for the day.">' + esc(cur.plan) + '</textarea></div>' +
        '<div class="field"><label for="j-content">Session review</label><textarea class="input" id="j-content" name="content" maxlength="20000" style="min-height:140px" placeholder="What happened? Did you follow the plan?">' + esc(cur.content) + '</textarea></div>' +
        '<div class="field"><label for="j-lessons">Lessons</label><textarea class="input" id="j-lessons" name="lessons" maxlength="10000" placeholder="One or two things to repeat or change tomorrow.">' + esc(cur.lessons) + '</textarea></div>' +
        '<div style="display:flex;gap:10px;align-items:center"><button class="btn primary" id="j-save">Save entry</button><span class="muted" id="j-state" style="font-size:13.5px"></span></div></div></section></div>';
      var state = $('#j-state', root); 
      var go = function (d) { if (!d) return; var p = jr.dirty ? saveJournal(jr.date, root) : Promise.resolve(); p.then(function () { location.hash = '#/journal/' + d; }, function (e) { JPX.toast(e.message, 'err'); }); };
      $$('.jitem', root).forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.d); }); });
      $('#j-prev', root).addEventListener('click', function () { go(JPX.addDays(date, -1)); }); $('#j-next', root).addEventListener('click', function () { go(JPX.addDays(date, 1)); });
      $('#j-date', root).addEventListener('change', function (e) { go(e.target.value); });
      $$('[data-trade]', root).forEach(function (b) { b.addEventListener('click', function () { JPX.openTrade(Number(b.dataset.trade), function () { JPX.route(); }); }); });
      $$('.mood', root).forEach(function (b) { b.addEventListener('click', function () { var on = b.getAttribute('aria-pressed') === 'true'; $$('.mood', root).forEach(function (x) { x.setAttribute('aria-pressed', 'false'); }); b.setAttribute('aria-pressed', String(!on)); jr.dirty = true; state.textContent = 'Unsaved changes'; }); });
      $$('textarea', root).forEach(function (t) { t.addEventListener('input', function () { jr.dirty = true; state.textContent = 'Unsaved changes'; }); });
      var save = function () { var b = $('#j-save', root); JPX.busy(b, true); saveJournal(date, root).then(function () { JPX.busy(b, false); state.textContent = 'Saved'; JPX.toast('Journal saved'); }, function (e) { JPX.busy(b, false); JPX.toast(e.message, 'err'); }); };
      $('#j-save', root).addEventListener('click', save);
      root._keys = function (e) { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); } };
    });
  };
  JPX.leaveJournal = function () { var root = $('#view'); if (jr.dirty && jr.date && root && $('#j-plan', root)) { saveJournal(jr.date, root).catch(function () { /* surfaced on next save */ }); } };

  /* ---------------- Analytics ---------------- */
  JPX.views.analytics = function (root) {
    return JPX.refreshAccounts().then(function () { return JPX.get('/api/analytics' + JPX.query()); }).then(function (an) {
      var s = an.summary, st = an.streaks, m = function (v, o) { return money(v, o); };
      var row = function (k, v, cls) { return '<div class="stat-row"><span>' + k + '</span><b class="num ' + (cls || '') + '">' + v + '</b></div>'; };
      var head = '<div class="topbar"><div><h1>Analytics</h1><div class="sub">Every figure is calculated from your closed trades</div></div>' + JPX.filterHTML() + '</div>';
      if (!s.trades) { root.innerHTML = head + '<div class="empty"><h3>Nothing to analyse yet</h3><p>Import or log some trades, or widen the date range.</p></div>'; JPX.bindFilters(root, function () { JPX.route(); }); return; }
      var dd = an.equity.map(function (p) { return { y: p.dd, tick: JPX.fmtDate(p.t, { year: undefined }), label: JPX.fmtDateTime(p.t) }; });
      var bucketBars = function (arr, labelFn) { return arr.map(function (b) { return { label: labelFn ? labelFn(b.key) : b.key, value: b.net, tip: m(b.net, { sign: true }), sub: (labelFn ? labelFn(b.key, true) : b.key) + ' · ' + b.trades + ' trades · ' + b.winRate + '% win' }; }); };
      root.innerHTML = head +
        '<section class="sec"><div class="stats">' +
        '<div>' + row('Net P&L', m(s.net, { sign: true }), JPX.cls(s.net)) + row('Gross profit', m(s.grossProfit), 'pos') + row('Gross loss', m(s.grossLoss), 'neg') + row('Fees (commission + swap)', m(s.fees), JPX.cls(s.fees)) + row('Trades', s.trades) + row('Win rate', s.winRate + '%') + row('Winners / losers / even', s.wins + ' / ' + s.losses + ' / ' + s.breakeven) + '</div>' +
        '<div>' + row('Profit factor', s.profitFactor == null ? '∞' : s.profitFactor.toFixed(2)) + row('Expectancy per trade', m(s.expectancy, { sign: true }), JPX.cls(s.expectancy)) + row('Average win', m(s.avgWin), 'pos') + row('Average loss', m(s.avgLoss), 'neg') + row('Payoff ratio', s.payoff == null ? '—' : s.payoff.toFixed(2)) + row('Largest win', m(s.largestWin), 'pos') + row('Largest loss', m(s.largestLoss), 'neg') + '</div>' +
        '<div>' + row('Average R', s.avgR == null ? 'Add risk to trades' : JPX.fmtR(s.avgR)) + row('Max drawdown', m(-s.maxDrawdown) + ' (' + s.maxDrawdownPct + '%)', 'neg') + row('Average hold time', s.avgHoldMinutes ? JPX.fmtMin(s.avgHoldMinutes) : '—') + row('Best day', s.bestDay ? m(s.bestDay.net, { sign: true }) + ' · ' + JPX.fmtDay(s.bestDay.date, { weekday: undefined }) : '—', 'pos') + row('Worst day', s.worstDay ? m(s.worstDay.net, { sign: true }) + ' · ' + JPX.fmtDay(s.worstDay.date, { weekday: undefined }) : '—', 'neg') + row('Green / red days', s.winningDays + ' / ' + s.losingDays) + row('Streaks (best W / worst L)', st.maxWin + ' / ' + st.maxLoss) + '</div></div></section>' +
        (an.locked ? '<section class="sec"><div class="panel" style="display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap"><div><b>Advanced analytics are part of Pro</b><p class="muted">Breakdowns by weekday, hour, symbol, setup, tag, side and R-multiples unlock on Pro and Elite.</p></div><a class="btn primary" href="#/billing">View plans</a></div></section>' : '') +
        '<section class="sec cols-2"><div><div class="sec-head"><h2>Equity curve</h2></div><div id="a-eq" class="chart-md"></div></div><div><div class="sec-head"><h2>Drawdown</h2><span class="sub">Distance below peak equity</span></div><div id="a-dd" class="chart-md"></div></div></section>' +
        '<section class="sec cols-2"><div><div class="sec-head"><h2>By weekday</h2><span class="sub">Net P&amp;L by day the trade opened</span></div><div id="a-wd" class="chart-md"></div></div><div><div class="sec-head"><h2>By hour</h2><span class="sub">Hour opened, ' + esc(JPX.tz()) + '</span></div><div id="a-hr" class="chart-md"></div></div></section>' +
        '<section class="sec cols-2"><div><div class="sec-head"><h2>Symbols</h2></div><div id="a-sym"></div></div><div><div class="sec-head"><h2>Setups</h2>' + (an.bySetup.length === 1 && an.bySetup[0].key === 'Unlabeled' ? '<span class="sub">Tag trades with a setup to compare them</span>' : '') + '</div><div id="a-set"></div></div></section>' +
        '<section class="sec cols-2"><div><div class="sec-head"><h2>Long vs short</h2></div><div id="a-side"></div></div><div><div class="sec-head"><h2>R-multiple distribution</h2><span class="sub">' + (s.rTrades ? s.rTrades + ' trades with risk recorded' : 'Record the amount risked on trades to see this') + '</span></div><div id="a-r" class="chart-md"></div></div></section>' +
        '<section class="sec"><div class="sec-head"><h2>Monthly results</h2></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Month</th><th class="r">Trades</th><th class="r">Win rate</th><th class="r">Avg trade</th><th class="r">Net P&amp;L</th></tr></thead><tbody>' + an.byMonth.slice().reverse().map(function (b) { return '<tr style="cursor:default"><td>' + MONTHS[Number(b.key.slice(5)) - 1] + ' ' + b.key.slice(0, 4) + '</td><td class="r num">' + b.trades + '</td><td class="r num">' + b.winRate + '%</td><td class="r num ' + JPX.cls(b.avg) + '">' + m(b.avg, { sign: true }) + '</td><td class="r num ' + JPX.cls(b.net) + '"><b>' + m(b.net, { sign: true }) + '</b></td></tr>'; }).join('') + '</tbody></table></div></section>' +
        (an.byTag.length ? '<section class="sec"><div class="sec-head"><h2>Tags</h2></div><div id="a-tag" class="cols-2" style="gap:0 40px"></div></section>' : '');
      JPX.bindFilters(root, function () { JPX.route(); });
      C.area($('#a-eq', root), JPX.equityPoints(an), { zero: s.startingBalance === 0, label: 'Equity curve', tipValue: function (p) { return m(p.y); } });
      C.area($('#a-dd', root), dd, { label: 'Drawdown', color: getComputedStyle(document.documentElement).getPropertyValue('--loss').trim(), tipValue: function (p) { return m(p.y); } });
      C.bars($('#a-wd', root), bucketBars(an.byWeekday));
      C.bars($('#a-hr', root), bucketBars(an.byHour, function (k) { return k + ':00'; }));
      var top = function (arr, n) { return arr.length > n ? arr.slice(0, Math.ceil(n / 2)).concat(arr.slice(-Math.floor(n / 2))) : arr; };
      var hb = function (arr) { return arr.map(function (b) { return { label: b.key, value: b.net, text: m(b.net, { sign: true }), sub: b.trades + ' trades · ' + b.winRate + '% win · avg ' + m(b.avg, { sign: true }) }; }); };
      C.hbars($('#a-sym', root), hb(top(an.bySymbol, 8)));
      C.hbars($('#a-set', root), hb(top(an.bySetup, 8)));
      C.hbars($('#a-side', root), hb(an.bySide.map(function (b) { return Object.assign({}, b, { key: b.key === 'long' ? 'Long' : 'Short' }); })));
      C.bars($('#a-r', root), !s.rTrades ? [] : an.rBuckets.map(function (b) { return { label: (b.r > 0 ? '+' : '') + b.r + 'R', value: b.r === 0 ? b.count : (b.r > 0 ? b.count : -b.count), tip: b.count + ' trade' + (b.count === 1 ? '' : 's'), sub: (b.r <= -5 ? '≤ -5R' : b.r >= 5 ? '≥ +5R' : 'about ' + (b.r > 0 ? '+' : '') + b.r + 'R') }; }), { format: function (v) { return Math.abs(v); }, empty: 'Record the amount risked on trades to see R-multiples' });
      var tg = $('#a-tag', root); if (tg) C.hbars(tg, hb(top(an.byTag, 10)));
    });
  };
})();
