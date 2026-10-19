/* Copy trading: leaderboard, following, my strategy */
(function () {
  'use strict';
  var JPX = window.JPX, S = JPX.state, esc = JPX.esc, $ = JPX.$, $$ = JPX.$$, money = JPX.money, C = window.JPXCharts;
  var tab = 'leaderboard', period = '30d';

  function avatar(name, size) { var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360; return '<span class="avatar" style="width:' + (size || 36) + 'px;height:' + (size || 36) + 'px;background:linear-gradient(135deg,hsl(' + h + ',70%,48%),hsl(' + ((h + 50) % 360) + ',70%,55%))" aria-hidden="true">' + esc(name.charAt(0).toUpperCase()) + '</span>'; }
  function spark(pts, w, h) {
    if (!pts || pts.length < 2) return '<span class="faint" style="font-size:12px">—</span>';
    var lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts), sp = hi - lo || 1;
    var d = pts.map(function (v, i) { return (i ? 'L' : 'M') + (i / (pts.length - 1) * w).toFixed(1) + ' ' + (h - 2 - ((v - lo) / sp) * (h - 4)).toFixed(1); }).join('');
    var up = pts[pts.length - 1] >= pts[0];
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><path d="' + d + '" fill="none" stroke="' + (up ? 'var(--profit)' : 'var(--loss)') + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  var pct = function (v) { return v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'; };

  JPX.views.copy = function (root) {
    return JPX.refreshAccounts().then(function () {
      root.innerHTML = '<div class="topbar"><div><h1>Copy trading</h1><div class="sub">Follow top traders, or share your own strategy</div></div></div>' +
        '<div class="seg" id="c-tabs" style="margin-bottom:22px">' + [['leaderboard', 'Top traders'], ['following', 'Following'], ['strategy', 'My strategy']].map(function (t) { return '<button data-v="' + t[0] + '" aria-pressed="' + (tab === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div><div id="c-body"><div class="spin"></div></div>' +
        '<p class="hint" style="margin-top:30px;max-width:80ch">Copy trading carries risk. Leaders are independent traders, not advisers, and past results do not predict future results. You are responsible for every trade placed in your accounts.</p>';
      $$('#c-tabs button', root).forEach(function (b) { b.addEventListener('click', function () { tab = b.dataset.v; $$('#c-tabs button', root).forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); load(root); }); });
      return load(root);
    });
  };
  function load(root) { var body = $('#c-body', root); body.innerHTML = '<div class="spin"></div>'; return (tab === 'leaderboard' ? board(body, root) : tab === 'following' ? following(body, root) : strategy(body, root)).catch(function (e) { body.innerHTML = '<div class="empty"><h3>Could not load</h3><p>' + esc(e.message) + '</p></div>'; }); }

  /* ---- leaderboard ---- */
  function board(body, root) {
    return JPX.get('/api/copy/leaders?period=' + period).then(function (r) {
      var rows = r.leaders;
      body.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px"><h2 style="font-size:17px">Top traders</h2><div class="seg" id="p-seg">' + [['30d', '30 days'], ['90d', '90 days'], ['all', 'All time']].map(function (p) { return '<button data-v="' + p[0] + '" aria-pressed="' + (period === p[0]) + '">' + p[1] + '</button>'; }).join('') + '</div></div>' +
        (!rows.length ? '<div class="empty"><h3>No public traders yet</h3><p>Traders appear here once they publish a strategy and have at least 3 closed trades in the period. You can be the first.</p><div class="acts"><button class="btn primary" id="go-strat">Share my strategy</button></div></div>' :
          '<div class="tbl-wrap hide-sm"><table class="tbl"><thead><tr><th>#</th><th>Trader</th><th class="r">Return</th><th>Trend</th><th class="r">Win rate</th><th class="r">Profit factor</th><th class="r">Max DD</th><th class="r">Trades</th><th class="r">Followers</th><th></th></tr></thead><tbody>' + rows.map(function (x) {
            return '<tr data-l="' + x.user_id + '"><td class="num">' + x.rank + '</td><td><div style="display:flex;gap:10px;align-items:center">' + avatar(x.alias, 34) + '<div><span class="sym">' + esc(x.alias) + '</span>' + (x.elite_only ? ' <span class="chip accent">Elite</span>' : '') + '<span class="sub">' + esc((x.bio || '').slice(0, 54)) + '</span></div></div></td><td class="r num ' + JPX.cls(x.gain) + '"><b>' + pct(x.gain) + '</b></td><td>' + spark(x.spark, 90, 28) + '</td><td class="r num">' + x.win_rate + '%</td><td class="r num">' + (x.profit_factor == null ? '∞' : x.profit_factor.toFixed(2)) + '</td><td class="r num neg">' + x.max_drawdown_pct + '%</td><td class="r num">' + x.trades + '</td><td class="r num">' + x.followers + '</td><td class="r">' + btn(x) + '</td></tr>';
          }).join('') + '</tbody></table></div><div class="show-sm">' + rows.map(function (x) {
            return '<div class="trade-row" role="button" tabindex="0" data-l="' + x.user_id + '"><span class="num faint" style="width:20px">' + x.rank + '</span>' + avatar(x.alias, 34) + '<div class="mid"><b>' + esc(x.alias) + (x.elite_only ? ' · Elite' : '') + '</b><span>' + x.win_rate + '% win · ' + x.followers + ' followers</span></div><div style="text-align:right"><div class="amt num ' + JPX.cls(x.gain) + '">' + pct(x.gain) + '</div>' + spark(x.spark, 64, 20) + '</div></div>';
          }).join('') + '</div>');
      $$('#p-seg button', body).forEach(function (b) { b.addEventListener('click', function () { period = b.dataset.v; board(body, root); }); });
      var g = $('#go-strat', body); if (g) g.addEventListener('click', function () { tab = 'strategy'; JPX.route(); });
      $$('[data-l]', body).forEach(function (el) { el.addEventListener('click', function (e) { if (e.target.closest('[data-follow]')) return; openLeader(Number(el.dataset.l), root); }); el.addEventListener('keydown', function (e) { if (e.key === 'Enter') el.click(); }); });
      $$('[data-follow]', body).forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); var x = rows.filter(function (y) { return y.user_id === Number(b.dataset.follow); })[0]; followModal(x, function () { JPX.route(); }); }); });
    });
  }
  function btn(x) {
    if (x.me) return '<span class="chip">You</span>';
    if (x.following) return '<span class="chip pos">Following</span>';
    if (x.locked) return '<button class="btn sm" data-follow="' + x.user_id + '">' + JPX.icon('lock') + 'Elite</button>';
    return '<button class="btn primary sm" data-follow="' + x.user_id + '">Copy</button>';
  }

  function openLeader(id, root) {
    JPX.get('/api/copy/leaders/' + id + '?period=90d').then(function (r) {
      var l = r.leader;
      JPX.modal({
        title: l.alias, size: 'wide',
        body: '<div style="display:flex;gap:12px;align-items:center">' + avatar(l.alias, 44) + '<div><div class="muted">' + esc(l.bio || 'No bio yet') + '</div><div class="faint" style="font-size:12.5px">Sharing since ' + JPX.fmtDate(l.since) + (l.elite_only ? ' · Elite strategy' : '') + '</div></div></div>' +
          '<div class="kpis" style="grid-template-columns:repeat(4,minmax(0,1fr));margin:0"><div class="kpi"><div class="k">90-day return</div><div class="v num ' + JPX.cls(l.gain) + '">' + pct(l.gain) + '</div></div><div class="kpi"><div class="k">Win rate</div><div class="v num">' + l.win_rate + '%</div></div><div class="kpi"><div class="k">Profit factor</div><div class="v num">' + (l.profit_factor == null ? '∞' : l.profit_factor.toFixed(2)) + '</div></div><div class="kpi"><div class="k">Followers</div><div class="v num">' + l.followers + '</div></div></div>' +
          '<div id="l-chart" class="chart-md"></div>' +
          (r.locked ? '<div class="panel" style="text-align:center">' + JPX.icon('lock') + '<p class="muted" style="margin-top:8px">Trade details for this exclusive strategy are visible to Elite members.</p></div>' :
            '<div><div class="sec-head" style="margin-bottom:6px"><h2>Recent trades</h2></div>' + (r.recent.length ? r.recent.map(function (t) { return '<div class="trade-row" style="cursor:default"><div class="dir ' + t.side + '">' + (t.side === 'long' ? 'L' : 'S') + '</div><div class="mid"><b>' + esc(t.symbol) + (t.status === 'open' ? ' <span class="chip accent">Open</span>' : '') + '</b><span>' + JPX.fmtDateTime(t.closed_at || t.opened_at) + ' · ' + JPX.num(t.volume, 2) + ' lots</span></div>' + (t.status === 'open' ? '' : '<div class="amt num ' + JPX.cls(t.net) + '">' + money(t.net, { sign: true }) + '</div>') + '</div>'; }).join('') : '<p class="muted">No published trades yet.</p>') + '</div>'),
        foot: '<button class="btn" data-close>Close</button>' + (r.follow ? '<button class="btn" id="l-manage">Manage copy settings</button>' : (l.user_id === S.user.id ? '' : '<button class="btn primary" id="l-follow">' + (r.locked ? 'Requires Elite' : 'Copy ' + esc(l.alias)) + '</button>')),
        onMount: function (d) {
          if (l.spark.length > 1) C.area($('#l-chart', d), l.spark.map(function (v, i) { return { y: v, label: 'Trade ' + (i + 1) }; }), { label: 'Return', format: function (v) { return v + '%'; }, tipValue: function (p) { return pct(p.y); } });
          else $('#l-chart', d).innerHTML = JPX.emptyChart('Not enough trades for a chart');
          var f = $('#l-follow', d); if (f) f.addEventListener('click', function () { d.close2(); followModal(Object.assign({ user_id: l.user_id, locked: r.locked }, l), function () { JPX.route(); }); });
          var m = $('#l-manage', d); if (m) m.addEventListener('click', function () { d.close2(); tab = 'following'; JPX.route(); });
        },
      });
    }, function (e) { JPX.toast(e.message, 'err'); });
  }

  function followModal(x, done) {
    if (x.locked) { JPX.upgradePrompt('This is an exclusive strategy for Elite members.'); return; }
    if (!S.accounts.length) { JPX.toast('Create a trading account first (Brokers page)', 'err'); location.hash = '#/brokers'; return; }
    JPX.modal({
      title: 'Copy ' + x.alias, size: 'narrow',
      body: '<div class="field"><label for="f-acct">Copy into account</label><select class="input" id="f-acct">' + S.accounts.map(function (a) { return '<option value="' + a.id + '">' + esc(a.name) + (a.has_api_key ? ' (MT5 linked)' : '') + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><span class="lbl">Position size</span><div class="seg" id="f-mode"><button type="button" data-v="ratio" aria-pressed="true">Match my balance</button><button type="button" data-v="fixed" aria-pressed="false">Fixed multiplier</button></div><span class="hint" id="f-hint"></span></div>' +
        '<div class="field" id="f-mult-wrap" hidden><label for="f-mult">Multiplier</label><input class="input" id="f-mult" type="number" step="any" min="0.01" max="100" value="1"></div>' +
        '<p class="hint">Trades this trader opens from now on are mirrored into the chosen account\'s journal. To also place them at your broker, link that account to MT5 and run the JPX Copy EA (see Following).</p><div class="form-error" id="f-err" hidden></div>',
      foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="f-go">Start copying</button>',
      onMount: function (d) {
        var mode = 'ratio', hints = { ratio: 'Lot size is scaled by your balance divided by the trader\'s balance.', fixed: 'Lot size is the trader\'s lot size times your multiplier (0.5 = half size).' };
        var upd = function () { $('#f-hint', d).textContent = hints[mode]; $('#f-mult-wrap', d).hidden = mode !== 'fixed'; $$('#f-mode button', d).forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.v === mode); }); }; upd();
        $$('#f-mode button', d).forEach(function (b) { b.addEventListener('click', function () { mode = b.dataset.v; upd(); }); });
        $('#f-go', d).addEventListener('click', function () {
          var btn = $('#f-go', d), err = $('#f-err', d); err.hidden = true; JPX.busy(btn, true, 'Starting…');
          JPX.api('POST', '/api/copy/follows', { leader_id: x.user_id, account_id: Number($('#f-acct', d).value), mode: mode, multiplier: Number($('#f-mult', d).value) }).then(function () { JPX.toast('Now copying ' + x.alias); d.close2(); done(); }, function (e) { JPX.busy(btn, false); err.textContent = e.message; err.hidden = false; });
        });
      },
    });
  }

  /* ---- following ---- */
  function following(body, root) {
    return JPX.get('/api/copy/follows').then(function (r) {
      if (!r.follows.length) { body.innerHTML = '<div class="empty"><h3>You are not following anyone yet</h3><p>Browse the top traders and tap Copy to mirror their trades into your journal account' + (r.limit ? '' : '. Copy trading starts on the Starter plan') + '.</p><div class="acts"><button class="btn primary" id="to-board">Browse top traders</button></div></div>'; $('#to-board', body).addEventListener('click', function () { tab = 'leaderboard'; JPX.route(); }); return; }
      body.innerHTML = '<div class="sub" style="margin-bottom:6px">' + r.follows.length + ' of ' + r.limit + ' allowed by your plan</div>' + r.follows.map(function (f) {
        return '<div class="rule-row" style="padding:18px 0"><div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">' + avatar(f.alias, 40) + '<div style="flex:1;min-width:180px"><b>' + esc(f.alias) + '</b> <span class="chip ' + (f.status === 'active' ? 'pos' : '') + '">' + (f.status === 'active' ? 'Active' : 'Paused') + '</span><div class="muted" style="font-size:13.5px">Into ' + esc(f.account_name) + ' · ' + (f.mode === 'ratio' ? 'matches your balance' : f.multiplier + 'x fixed') + (f.account_has_key ? ' · MT5 linked' : ' · journal only') + '</div></div>' +
          '<div style="text-align:right"><div class="num ' + JPX.cls(f.net) + '" style="font-weight:800;font-size:18px">' + money(f.net, { sign: true }) + '</div><div class="muted" style="font-size:12.5px">' + f.copied + ' copied · ' + f.open + ' open</div></div>' +
          '<div style="display:flex;gap:6px"><button class="btn sm" data-toggle="' + f.id + '" data-s="' + f.status + '">' + (f.status === 'active' ? 'Pause' : 'Resume') + '</button><button class="btn sm" data-edit="' + f.id + '">Settings</button><button class="btn danger sm icon" data-del="' + f.id + '" aria-label="Stop copying ' + esc(f.alias) + '">' + JPX.icon('trash') + '</button></div></div></div>';
      }).join('') +
        '<div class="panel" style="margin-top:22px"><b>Place copied trades at your broker</b><p class="muted" style="margin:6px 0 12px">Journal mirroring works out of the box. To also open and close the same trades on your MT5 account, link the account on the Brokers page, then install and attach the <a href="/jpx-copy.mq5" download>jpx-copy.mq5</a> Expert Advisor. It starts in practice mode (logs only); you choose when to turn real execution on.</p><a class="btn sm" href="#/brokers">Open Brokers</a></div>';
      $$('[data-toggle]', body).forEach(function (b) { b.addEventListener('click', function () { JPX.api('PATCH', '/api/copy/follows/' + b.dataset.toggle, { status: b.dataset.s === 'active' ? 'paused' : 'active' }).then(function () { JPX.toast(b.dataset.s === 'active' ? 'Paused' : 'Resumed'); following(body, root); }, function (e) { JPX.toast(e.message, 'err'); }); }); });
      $$('[data-del]', body).forEach(function (b) { b.addEventListener('click', function () { JPX.confirm({ title: 'Stop copying?', message: 'No new trades will be copied. Trades already copied stay in your journal.', confirm: 'Stop copying', danger: true }).then(function (ok) { if (ok) JPX.api('DELETE', '/api/copy/follows/' + b.dataset.del).then(function () { JPX.toast('Stopped'); following(body, root); }, function (e) { JPX.toast(e.message, 'err'); }); }); }); });
      $$('[data-edit]', body).forEach(function (b) { b.addEventListener('click', function () { editFollow(r.follows.filter(function (f) { return f.id === Number(b.dataset.edit); })[0], function () { following(body, root); }); }); });
    });
  }
  function editFollow(f, done) {
    JPX.modal({
      title: 'Copy settings · ' + f.alias, size: 'narrow',
      body: '<div class="field"><label for="e-acct">Copy into account</label><select class="input" id="e-acct">' + S.accounts.map(function (a) { return '<option value="' + a.id + '"' + (a.id === f.follower_account_id ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><span class="lbl">Position size</span><div class="seg" id="e-mode"><button type="button" data-v="ratio">Match my balance</button><button type="button" data-v="fixed">Fixed multiplier</button></div></div><div class="field" id="e-mw"><label for="e-mult">Multiplier</label><input class="input" id="e-mult" type="number" step="any" min="0.01" max="100" value="' + f.multiplier + '"></div><div class="form-error" id="e-err" hidden></div>',
      foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="e-go">Save</button>',
      onMount: function (d) {
        var mode = f.mode, upd = function () { $('#e-mw', d).hidden = mode !== 'fixed'; $$('#e-mode button', d).forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.v === mode); }); }; upd();
        $$('#e-mode button', d).forEach(function (b) { b.addEventListener('click', function () { mode = b.dataset.v; upd(); }); });
        $('#e-go', d).addEventListener('click', function () { JPX.api('PATCH', '/api/copy/follows/' + f.id, { account_id: Number($('#e-acct', d).value), mode: mode, multiplier: Number($('#e-mult', d).value) }).then(function () { JPX.toast('Saved'); d.close2(); done(); }, function (e) { var er = $('#e-err', d); er.textContent = e.message; er.hidden = false; }); });
      },
    });
  }

  /* ---- my strategy ---- */
  function strategy(body, root) {
    return JPX.get('/api/copy/profile').then(function (r) {
      var p = r.profile;
      if (!r.can_publish) { body.innerHTML = '<div class="empty"><h3>Share your strategy</h3><p>Pro and Elite members can publish a strategy, appear on the leaderboard and let others copy their trades.</p><div class="acts"><a class="btn primary" href="#/billing">View plans</a></div></div>'; return; }
      if (!S.accounts.length) { body.innerHTML = '<div class="empty"><h3>Add an account first</h3><p>Pick the trading account whose trades you want to share.</p><div class="acts"><a class="btn primary" href="#/brokers">Add account</a></div></div>'; return; }
      body.innerHTML = '<div class="cols-main"><section><form id="sp" class="form-grid" novalidate>' +
        '<div class="field"><label for="s-alias">Public display name</label><input class="input" id="s-alias" name="alias" maxlength="24" value="' + esc(p ? p.alias : '') + '" placeholder="e.g. AlphaFX"></div>' +
        '<div class="field"><label for="s-acct">Account to share</label><select class="input" id="s-acct" name="account_id">' + S.accounts.map(function (a) { return '<option value="' + a.id + '"' + (p && p.account_id === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field full"><label for="s-bio">About your strategy</label><textarea class="input" id="s-bio" name="bio" maxlength="300" placeholder="Markets, timeframes, risk style.">' + esc(p ? p.bio : '') + '</textarea></div>' +
        '<label class="full" style="display:flex;gap:10px;align-items:center"><input type="checkbox" class="check" name="is_public"' + (!p || p.is_public ? ' checked' : '') + '> Show me on the leaderboard</label>' +
        (r.can_elite ? '<label class="full" style="display:flex;gap:10px;align-items:center"><input type="checkbox" class="check" name="elite_only"' + (p && p.elite_only ? ' checked' : '') + '> Make this an exclusive strategy (Elite members only)</label>' : '') +
        (p ? '' : '<label class="full" style="display:flex;gap:10px;align-items:flex-start"><input type="checkbox" class="check" name="accept" style="margin-top:3px"> <span class="muted">I understand my trades (symbols, sizes, prices, results) on this account are visible to followers, and followers\' accounts may copy them.</span></label>') +
        '<div class="form-error full" id="sp-err" hidden></div><div class="full" style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn primary" type="submit">' + (p ? 'Save changes' : 'Publish strategy') + '</button>' + (p ? '<button class="btn danger" type="button" id="sp-stop">Stop sharing</button>' : '') + '</div></form></section>' +
        '<section><div class="sec-head"><h2>' + (p ? 'Your strategy' : 'How it works') + '</h2></div>' + (p ? '<div class="kpi" style="padding:0"><div class="k">Active followers</div><div class="v num">' + r.followers + '</div></div>' : '') +
        '<p class="muted" style="margin-top:10px">Closed trades on the shared account are published automatically, whether they arrive by automatic broker import or manual entry. For live signals that followers can execute, link the account to MT5 with the JPX Sync EA; it publishes open positions as they happen.</p><p class="muted" style="margin-top:10px">The leaderboard shows percentage return, win rate and drawdown, never your balance.</p></section></div>';
      $('#sp', body).addEventListener('submit', function (e) {
        e.preventDefault(); var f = e.target, err = $('#sp-err', body); err.hidden = true;
        var data = { alias: f.alias.value, bio: f.bio.value, account_id: Number(f.account_id.value), is_public: f.is_public.checked, elite_only: f.elite_only ? f.elite_only.checked : false, accept: f.accept ? f.accept.checked : true };
        var b = $('button[type=submit]', f); JPX.busy(b, true);
        JPX.api('PUT', '/api/copy/profile', data).then(function () { JPX.toast(p ? 'Strategy updated' : 'Strategy published'); strategy(body, root); }, function (er) { JPX.busy(b, false); err.textContent = er.message; err.hidden = false; });
      });
      var stop = $('#sp-stop', body); if (stop) stop.addEventListener('click', function () { JPX.confirm({ title: 'Stop sharing?', message: 'You leave the leaderboard and all followers stop copying you. Their existing journal entries stay.', confirm: 'Stop sharing', danger: true }).then(function (ok) { if (ok) JPX.api('DELETE', '/api/copy/profile').then(function () { JPX.toast('You are no longer sharing'); strategy(body, root); }, function (e) { JPX.toast(e.message, 'err'); }); }); });
    });
  }
})();
