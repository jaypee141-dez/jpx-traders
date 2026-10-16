/* Risk, Brokers, Settings, Admin */
(function () {
  'use strict';
  var JPX = window.JPX, S = JPX.state, esc = JPX.esc, $ = JPX.$, $$ = JPX.$$, money = JPX.money, C = window.JPXCharts;

  /* ---------------- Risk ---------------- */
  JPX.views.risk = function (root) {
    return Promise.all([JPX.refreshAccounts(), JPX.get('/api/risk/rules'), JPX.get('/api/risk/status')]).then(function (res) {
      var rules = res[1].rules, status = res[2];
      var acc = S.accounts.filter(function (a) { return S.acct === 'all' || String(a.id) === String(S.acct); });
      var bal = acc.reduce(function (s, a) { return s + a.starting_balance + a.net; }, 0);
      var P = window.JPXCalc.PRESETS;
      var inp = function (id, label, attrs, val, hint) { return '<div class="field"><label for="' + id + '">' + label + '</label><input class="input" id="' + id + '" type="number" step="any" inputmode="decimal" ' + (attrs || '') + ' value="' + (val == null ? '' : val) + '">' + (hint ? '<span class="hint">' + hint + '</span>' : '') + '</div>'; };
      root.innerHTML = '<div class="topbar"><div><h1>Risk</h1><div class="sub">Size every trade before you take it, and set limits you agree to in advance</div></div>' + JPX.filterHTML({ noRange: true }) + '</div>' +
        '<div class="cols-2"><section><div class="sec-head"><h2>Position size calculator</h2></div><div class="calc">' +
        '<div class="field"><label for="k-preset">Instrument type</label><select class="input" id="k-preset">' + Object.keys(P).map(function (k) { return '<option value="' + k + '">' + esc(P[k].label) + '</option>'; }).join('') + '</select></div>' +
        '<div class="form-grid">' + inp('k-bal', 'Account balance', 'min="0"', bal > 0 ? Math.round(bal * 100) / 100 : '') + inp('k-risk', 'Risk per trade (%)', 'min="0" max="100"', 1) + inp('k-entry', 'Entry price', 'min="0"') + inp('k-stop', 'Stop-loss price', 'min="0"') + inp('k-target', 'Target price (optional)', 'min="0"') + '<div class="field" id="k-cs-wrap" hidden><label for="k-cs">Units per lot</label><input class="input" id="k-cs" type="number" step="any" min="0" value="100000"></div></div>' +
        '<div id="k-out" class="calc-out"></div><p class="hint">Assumes your account currency is the instrument\'s quote currency (JPY pairs are converted at the entry price). Always confirm pip value with your broker for crosses and exotics.</p></div></section>' +
        '<section><div class="sec-head"><h2>Your limits</h2></div><form id="rules-form" class="form-grid" novalidate>' +
        '<div class="field"><label for="r-dl">Max daily loss</label><input class="input" id="r-dl" name="max_daily_loss" type="number" step="any" min="0" inputmode="decimal" value="' + (rules.max_daily_loss == null ? '' : rules.max_daily_loss) + '" placeholder="e.g. 300"></div>' +
        '<div class="field"><label for="r-mt">Max trades per day</label><input class="input" id="r-mt" name="max_trades_per_day" type="number" step="1" min="1" inputmode="numeric" value="' + (rules.max_trades_per_day == null ? '' : rules.max_trades_per_day) + '" placeholder="e.g. 5"></div>' +
        '<div class="field"><label for="r-cl">Max losses in a row</label><input class="input" id="r-cl" name="max_consecutive_losses" type="number" step="1" min="1" inputmode="numeric" value="' + (rules.max_consecutive_losses == null ? '' : rules.max_consecutive_losses) + '" placeholder="e.g. 3"></div>' +
        '<div class="field"><label for="r-rt">Max risk per trade</label><input class="input" id="r-rt" name="max_risk_per_trade" type="number" step="any" min="0" inputmode="decimal" value="' + (rules.max_risk_per_trade == null ? '' : rules.max_risk_per_trade) + '" placeholder="e.g. 100"></div>' +
        '<div class="full hint">Leave a field empty for no limit. Limits are checked against trades closed today (' + esc(JPX.tz()) + '). Risk per trade uses the “amount risked” you record on each trade.</div><div class="form-error full" id="rules-err" hidden></div><div class="full"><button class="btn primary" type="submit">Save limits</button></div></form>' +
        '<div class="sec-head" style="margin-top:34px"><h2>Today</h2><span class="sub">' + JPX.fmtDay(status.date) + '</span></div><div id="risk-status"></div></section></div>';
      JPX.bindFilters(root, function () { JPX.route(); });
      // calculator
      var out = $('#k-out', root), ids = ['k-preset', 'k-bal', 'k-risk', 'k-entry', 'k-stop', 'k-target', 'k-cs'];
      var calc = function () {
        var v = {}; ids.forEach(function (i) { v[i] = $('#' + i, root).value; });
        $('#k-cs-wrap', root).hidden = v['k-preset'] !== 'custom';
        var r = window.JPXCalc.size({ preset: v['k-preset'], balance: v['k-bal'], riskPct: v['k-risk'], entry: v['k-entry'], stop: v['k-stop'], target: v['k-target'], contract: v['k-cs'] });
        if (!r.ok) { out.innerHTML = '<div class="muted big-out" style="grid-column:1/-1;padding:16px;background:var(--surface-2);border-radius:12px">' + esc(r.error) + '</div>'; return; }
        out.innerHTML = '<div class="big-out"><div class="k">Position size</div><div class="v num">' + JPX.num(Math.round(r.lots * 100) / 100, 2) + ' lots</div></div>' +
          '<div><div class="k">Amount at risk</div><div class="v2 num neg">' + money(-r.riskAmount) + '</div></div><div><div class="k">Direction</div><div class="v2">' + (r.direction === 'long' ? 'Long' : 'Short') + '</div></div>' +
          '<div><div class="k">Stop distance</div><div class="v2 num">' + JPX.num(r.distance, 5) + '</div></div><div><div class="k">Units</div><div class="v2 num">' + JPX.num(Math.round(r.units), 0) + '</div></div>' +
          (r.reward != null ? '<div><div class="k">Potential reward</div><div class="v2 num pos">' + money(r.reward) + '</div></div><div><div class="k">Reward to risk</div><div class="v2 num">' + r.rr.toFixed(2) + ' : 1</div></div>' : '');
      };
      ids.forEach(function (i) { $('#' + i, root).addEventListener('input', calc); }); calc();
      // rules
      $('#rules-form', root).addEventListener('submit', function (e) {
        e.preventDefault(); var data = {}, err = $('#rules-err', root); err.hidden = true;
        Array.prototype.forEach.call(e.target.elements, function (el) { if (el.name) data[el.name] = el.value; });
        var btn = $('button[type=submit]', e.target); JPX.busy(btn, true);
        JPX.api('PUT', '/api/risk/rules', data).then(function () { JPX.toast('Limits saved'); JPX.route(); }, function (er) { JPX.busy(btn, false); err.textContent = er.message; err.hidden = false; });
      });
      var rs = $('#risk-status', root), active = status.checks.filter(function (c) { return c.limit != null; });
      rs.innerHTML = '<div class="num" style="font-size:28px;font-weight:800;letter-spacing:-.03em"><span class="' + JPX.cls(status.net) + '">' + money(status.net, { sign: true }) + '</span> <span class="muted" style="font-size:14px;font-weight:600;letter-spacing:0">· ' + status.trades + ' trade' + (status.trades === 1 ? '' : 's') + '</span></div>' +
        (active.length ? active.map(function (c) {
          var pct = Math.min(100, (c.value / c.limit) * 100), mo = c.key === 'max_daily_loss' || c.key === 'max_risk_per_trade';
          return '<div class="rule-row"><div class="rule-top"><span>' + c.label + '</span><span class="num ' + (c.breached ? 'neg' : '') + '">' + (mo ? money(c.value, { dec: 0 }) + ' of ' + money(c.limit, { dec: 0 }) : c.value + ' of ' + c.limit) + '</span></div><div class="meter ' + (c.breached ? 'bad' : pct >= 75 ? 'warn' : '') + '"><i style="width:' + pct + '%"></i></div>' + (c.breached ? '<span class="neg" style="font-size:13px;font-weight:600">Limit reached</span>' : '') + '</div>';
        }).join('') : '<p class="muted" style="margin-top:10px">No limits set yet. Add at least a daily loss limit above.</p>');
    });
  };

  /* ---------------- Brokers / Accounts ---------------- */
  var PLAT = { manual: 'Manual', mt5: 'MetaTrader 5', mt4: 'MetaTrader 4', csv: 'CSV imports', other: 'Other' };
  JPX.views.brokers = function (root) {
    return JPX.refreshAccounts().then(function (accts) {
      root.innerHTML = '<div class="topbar"><div><h1>Brokers</h1><div class="sub">Trading accounts and how their trades get in</div></div><button class="btn primary" id="add-acct">' + JPX.icon('plus') + 'Add account</button></div>' +
        (accts.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Account</th><th class="hide-sm">Platform</th><th class="r">Trades</th><th class="r hide-sm">Net P&amp;L</th><th class="hide-sm">Live sync</th><th></th></tr></thead><tbody>' + accts.map(function (a) {
          return '<tr style="cursor:default"><td><span class="sym">' + esc(a.name) + '</span><span class="sub">' + esc(a.broker || 'No broker set') + ' · ' + esc(a.currency) + (a.starting_balance ? ' · starts ' + money(a.starting_balance, { cur: a.currency, dec: 0 }) : '') + '</span></td><td class="hide-sm">' + esc(PLAT[a.platform] || a.platform) + '</td><td class="r num">' + a.trades + '</td><td class="r num hide-sm ' + JPX.cls(a.net) + '">' + money(a.net, { sign: true, cur: a.currency }) + '</td><td class="hide-sm">' + (a.has_api_key ? '<span class="chip ' + (a.last_sync ? 'pos' : 'warn') + '">' + (a.last_sync ? 'Synced ' + JPX.fmtDateTime(a.last_sync) : 'Key issued, waiting for first sync') + '</span>' : '<span class="muted">Not connected</span>') + '</td><td class="r" style="white-space:nowrap"><button class="btn sm" data-connect="' + a.id + '">' + JPX.icon('brokers') + 'Connect MT5</button> <button class="btn sm" data-import="' + a.id + '" title="Import CSV">' + JPX.icon('upload') + '<span class="hide-sm">Import</span></button> <button class="btn sm icon" data-edit="' + a.id + '" aria-label="Edit ' + esc(a.name) + '">' + JPX.icon('edit') + '</button></td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty"><h3>No accounts yet</h3><p>An account holds a set of trades: a live account, a prop-firm challenge, a demo. Create one to start.</p><div class="acts"><button class="btn primary" data-add>Add account</button></div></div>') +
        '<section class="sec" style="margin-top:28px"><div class="sec-head"><h2>Ways to get trades in</h2></div><div class="cols-3"><div><b>MetaTrader 5, live</b><p class="muted" style="margin-top:6px">Install the JPX Sync Expert Advisor. Every position you close is sent to your journal within seconds. Needs an API key per account.</p></div><div><b>CSV from MT4 / MT5</b><p class="muted" style="margin-top:6px">Export your account history as CSV and import it. Duplicates are skipped, so you can re-import any time.</p></div><div><b>Manual</b><p class="muted" style="margin-top:6px">Log trades by hand from any broker or market. Works for futures, stocks and crypto too.</p></div></div></section>';
      var add = $('#add-acct', root); add.addEventListener('click', function () { acctForm(null); });
      var a2 = $('[data-add]', root); if (a2) a2.addEventListener('click', function () { acctForm(null); });
      $$('[data-edit]', root).forEach(function (b) { b.addEventListener('click', function () { acctForm(accts.filter(function (a) { return a.id === Number(b.dataset.edit); })[0]); }); });
      $$('[data-import]', root).forEach(function (b) { b.addEventListener('click', function () { JPX.openImport(function () { JPX.route(); }, Number(b.dataset.import)); }); });
      $$('[data-connect]', root).forEach(function (b) { b.addEventListener('click', function () { connectModal(accts.filter(function (a) { return a.id === Number(b.dataset.connect); })[0]); }); });
    });
  };

  function acctForm(a) {
    var edit = !!a; a = a || { name: '', broker: '', platform: 'mt5', currency: S.user.currency, starting_balance: '', utc_offset: 0 };
    JPX.modal({
      title: edit ? 'Edit account' : 'Add account',
      body: '<form id="af" class="form-grid" novalidate><div class="field full"><label for="a-name">Account name</label><input class="input" id="a-name" name="name" maxlength="60" required value="' + esc(a.name) + '" placeholder="Live – IC Markets"></div>' +
        '<div class="field"><label for="a-broker">Broker</label><input class="input" id="a-broker" name="broker" maxlength="60" value="' + esc(a.broker) + '"></div>' +
        '<div class="field"><label for="a-plat">Platform</label><select class="input" id="a-plat" name="platform">' + Object.keys(PLAT).map(function (k) { return '<option value="' + k + '"' + (a.platform === k ? ' selected' : '') + '>' + PLAT[k] + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label for="a-bal">Starting balance</label><input class="input" id="a-bal" name="starting_balance" type="number" step="any" min="0" inputmode="decimal" value="' + esc(a.starting_balance) + '" placeholder="10000"></div>' +
        '<div class="field"><label for="a-cur">Currency</label><input class="input" id="a-cur" name="currency" maxlength="8" value="' + esc(a.currency) + '" style="text-transform:uppercase"></div>' +
        '<div class="field full"><label for="a-off">Broker server time (UTC offset in hours)</label><input class="input" id="a-off" name="utc_offset" type="number" step="0.5" min="-14" max="14" value="' + esc(a.utc_offset) + '"><span class="hint">Used when importing CSV files, which carry the broker\'s server time. Many brokers use UTC+2 (UTC+3 in summer). Live MT5 sync sends exact UTC and ignores this.</span></div>' +
        '<div class="form-error full" id="af-err" hidden></div></form>',
      foot: (edit ? '<button class="btn danger" id="af-del" style="margin-right:auto">' + JPX.icon('trash') + 'Delete</button>' : '') + '<button class="btn" data-close>Cancel</button><button class="btn primary" id="af-save">' + (edit ? 'Save changes' : 'Create account') + '</button>',
      onMount: function (d) {
        var form = $('#af', d), save = function () {
          var data = {}, err = $('#af-err', d); err.hidden = true; Array.prototype.forEach.call(form.elements, function (el) { if (el.name) data[el.name] = el.value; });
          if (!data.name.trim()) { err.textContent = 'Enter an account name'; err.hidden = false; return; }
          if (data.starting_balance === '') data.starting_balance = 0;
          var btn = $('#af-save', d); JPX.busy(btn, true);
          JPX.api(edit ? 'PATCH' : 'POST', edit ? '/api/accounts/' + a.id : '/api/accounts', data).then(function () { JPX.toast(edit ? 'Account updated' : 'Account created'); d.close2(); JPX.route(); }, function (e) { JPX.busy(btn, false); err.textContent = e.message; err.hidden = false; });
        };
        $('#af-save', d).addEventListener('click', save); form.addEventListener('submit', function (e) { e.preventDefault(); save(); });
        var del = $('#af-del', d); if (del) del.addEventListener('click', function () {
          JPX.confirm({ title: 'Delete “' + a.name + '”?', message: 'This also deletes its ' + a.trades + ' trade' + (a.trades === 1 ? '' : 's') + ' and revokes its API key. This cannot be undone.', confirm: 'Delete account', danger: true }).then(function (ok) {
            if (ok) JPX.api('DELETE', '/api/accounts/' + a.id).then(function () { JPX.toast('Account deleted'); d.close2(); JPX.route(); }, function (e) { JPX.toast(e.message, 'err'); });
          });
        });
      },
    });
  }

  function connectModal(a) {
    var url = location.origin + '/api/ingest';
    JPX.modal({
      title: 'Connect ' + a.name + ' to MetaTrader 5', size: 'wide',
      body: '<div class="field"><span class="lbl">1. Create an API key for this account</span><div id="key-box">' + (a.has_api_key ? '<p class="muted">A key starting with <span class="code-inline">' + esc(a.api_key_prefix) + '…</span> is active. Keys are shown only once; generate a new one to replace it.</p>' : '') + '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn primary sm" id="gen-key">' + JPX.icon('key') + (a.has_api_key ? 'Generate a new key' : 'Generate API key') + '</button>' + (a.has_api_key ? '<button class="btn danger sm" id="rev-key">Revoke key</button>' : '') + '</div></div></div>' +
        '<div class="field"><span class="lbl">2. Install the Expert Advisor</span><p class="muted">Download <a href="/jpx-sync.mq5" download>jpx-sync.mq5</a>, save it in MetaTrader\'s <span class="code-inline">MQL5/Experts</span> folder (File → Open Data Folder), then compile it in MetaEditor.</p></div>' +
        '<div class="field"><span class="lbl">3. Allow the server in MetaTrader</span><p class="muted">Tools → Options → Expert Advisors → tick “Allow WebRequest for listed URL” and add:</p><div class="copy-row"><pre class="code">' + esc(location.origin) + '</pre><button class="btn sm icon" data-copy="' + esc(location.origin) + '" aria-label="Copy URL">' + JPX.icon('copy') + '</button></div></div>' +
        '<div class="field"><span class="lbl">4. Attach it to any chart</span><p class="muted">Enable Algo Trading, drag <b>jpx-sync</b> onto a chart, and set these inputs:</p><div class="copy-row"><pre class="code">ServerUrl = ' + esc(url) + '\nApiKey   = (the key from step 1)</pre><button class="btn sm icon" data-copy="' + esc(url) + '" aria-label="Copy server URL">' + JPX.icon('copy') + '</button></div><p class="hint">On first run it uploads your recent history (default 90 days), then sends each position as it closes. Trades show up here and are de-duplicated by ticket.</p></div>',
      foot: '<button class="btn" data-close>Done</button>',
      onMount: function (d) {
        $$('[data-copy]', d).forEach(function (b) { b.addEventListener('click', function () { JPX.copy(b.dataset.copy); }); });
        $('#gen-key', d).addEventListener('click', function () {
          var go = function () {
            JPX.api('POST', '/api/accounts/' + a.id + '/api-key').then(function (r) {
              $('#key-box', d).innerHTML = '<p class="pos" style="font-weight:600">Key created. Copy it now; it will not be shown again.</p><div class="copy-row"><pre class="code">' + esc(r.api_key) + '</pre><button class="btn sm icon" id="cp-key" aria-label="Copy key">' + JPX.icon('copy') + '</button></div>';
              $('#cp-key', d).addEventListener('click', function () { JPX.copy(r.api_key); }); JPX.refreshAccounts();
            }, function (e) { JPX.toast(e.message, 'err'); });
          };
          if (a.has_api_key) JPX.confirm({ title: 'Replace the API key?', message: 'The EA using the current key will stop syncing until you update it.', confirm: 'Generate new key' }).then(function (ok) { if (ok) go(); }); else go();
        });
        var rev = $('#rev-key', d); if (rev) rev.addEventListener('click', function () {
          JPX.confirm({ title: 'Revoke the API key?', message: 'Live sync stops immediately. Existing trades are kept.', confirm: 'Revoke', danger: true }).then(function (ok) { if (ok) JPX.api('DELETE', '/api/accounts/' + a.id + '/api-key').then(function () { JPX.toast('API key revoked'); d.close2(); JPX.route(); }, function (e) { JPX.toast(e.message, 'err'); }); });
        });
      },
      onClose: function () { JPX.route(); },
    });
  }

  /* ---------------- Settings ---------------- */
  JPX.views.settings = function (root) {
    var u = S.user, zones = []; try { zones = Intl.supportedValuesOf('timeZone'); } catch (e) { zones = [u.timezone, 'UTC']; }
    if (zones.indexOf('UTC') < 0) zones.unshift('UTC'); if (zones.indexOf(u.timezone) < 0) zones.unshift(u.timezone);
    var th = window.JPXTheme.get();
    root.innerHTML = '<div class="topbar"><div><h1>Settings</h1><div class="sub">' + esc(u.email) + '</div></div></div>' +
      '<section class="sec"><div class="sec-head"><h2>Profile</h2></div><form id="pf" class="form-grid" style="max-width:640px" novalidate><div class="field full"><label for="s-name">Name</label><input class="input" id="s-name" name="name" maxlength="80" value="' + esc(u.name) + '"></div>' +
      '<div class="field"><label for="s-tz">Timezone</label><select class="input" id="s-tz" name="timezone">' + zones.map(function (z) { return '<option' + (z === u.timezone ? ' selected' : '') + '>' + esc(z) + '</option>'; }).join('') + '</select><span class="hint">Decides which day a trade belongs to in the calendar and analytics.</span></div>' +
      '<div class="field"><label for="s-cur">Display currency</label><input class="input" id="s-cur" name="currency" maxlength="8" value="' + esc(u.currency) + '" style="text-transform:uppercase"><span class="hint">Three-letter code such as USD, EUR, JPY.</span></div><div class="form-error full" id="pf-err" hidden></div><div class="full"><button class="btn primary" type="submit">Save profile</button></div></form></section>' +
      '<section class="sec"><div class="sec-head"><h2>Appearance</h2></div><div class="seg" id="theme-seg">' + [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(function (t) { return '<button data-v="' + t[0] + '" aria-pressed="' + (th === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div></section>' +
      '<section class="sec"><div class="sec-head"><h2>Password</h2></div><form id="pw" class="form-grid" style="max-width:640px" novalidate><div class="field full"><label for="p-cur">Current password</label><input class="input" id="p-cur" name="current" type="password" autocomplete="current-password"></div><div class="field full"><label for="p-new">New password</label><input class="input" id="p-new" name="next" type="password" autocomplete="new-password" minlength="8"><span class="hint">At least 8 characters. Other devices are signed out when you change it.</span></div><div class="form-error full" id="pw-err" hidden></div><div class="full"><button class="btn" type="submit">Change password</button></div></form></section>' +
      '<section class="sec"><div class="sec-head"><h2>Your data</h2></div><p class="muted" style="margin-bottom:14px;max-width:60ch">Download every trade you have recorded as a CSV file, or permanently delete your account and everything in it.</p><div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn" href="/api/export/trades.csv">' + JPX.icon('download') + 'Export all trades</a><button class="btn danger" id="del-me">' + JPX.icon('trash') + 'Delete my account</button></div></section>';
    var showErr = function (id, m) { var e = $(id, root); e.textContent = m; e.hidden = !m; };
    $('#pf', root).addEventListener('submit', function (e) {
      e.preventDefault(); showErr('#pf-err', ''); var data = {}; Array.prototype.forEach.call(e.target.elements, function (el) { if (el.name) data[el.name] = el.value; });
      var b = $('button[type=submit]', e.target); JPX.busy(b, true);
      JPX.api('PATCH', '/api/me', data).then(function (r) { S.user = r.user; JPX.busy(b, false); JPX.toast('Profile saved'); JPX.renderShell(); }, function (er) { JPX.busy(b, false); showErr('#pf-err', er.message); });
    });
    $$('#theme-seg button', root).forEach(function (b) { b.addEventListener('click', function () { window.JPXTheme.set(b.dataset.v); $$('#theme-seg button', root).forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); }); });
    $('#pw', root).addEventListener('submit', function (e) {
      e.preventDefault(); showErr('#pw-err', ''); var data = {}; Array.prototype.forEach.call(e.target.elements, function (el) { if (el.name) data[el.name] = el.value; });
      var b = $('button[type=submit]', e.target); JPX.busy(b, true);
      JPX.api('POST', '/api/me/password', data).then(function () { JPX.busy(b, false); e.target.reset(); JPX.toast('Password changed'); }, function (er) { JPX.busy(b, false); showErr('#pw-err', er.message); });
    });
    $('#del-me', root).addEventListener('click', function () {
      JPX.modal({
        title: 'Delete your account', size: 'narrow', body: '<p class="muted">This permanently deletes your profile, accounts, trades and journal. Export your trades first if you want a copy.</p><div class="field"><label for="d-pw">Confirm with your password</label><input class="input" id="d-pw" type="password" autocomplete="current-password"></div><div class="form-error" id="d-err" hidden></div>',
        foot: '<button class="btn" data-close>Cancel</button><button class="btn solid-danger" id="d-go">Delete everything</button>',
        onMount: function (d) { $('#d-go', d).addEventListener('click', function () { JPX.api('DELETE', '/api/me', { password: $('#d-pw', d).value }).then(function () { d.close2(); S.user = null; JPX.onSignedOut(); }, function (e) { var er = $('#d-err', d); er.textContent = e.message; er.hidden = false; }); }); },
      });
    });
  };

  /* ---------------- Admin ---------------- */
  var adminQ = '';
  JPX.views.admin = function (root) {
    if (S.user.role !== 'admin') { root.innerHTML = '<div class="empty"><h3>Admins only</h3><p>You do not have access to this page.</p></div>'; return; }
    return Promise.all([JPX.get('/api/admin/stats'), JPX.get('/api/admin/users' + JPX.qs({ q: adminQ })), JPX.get('/api/admin/messages')]).then(function (res) {
      var st = res[0], users = res[1].users, msgs = res[2].messages, kpi = function (k, v, s) { return '<div class="kpi"><div class="k">' + k + '</div><div class="v num">' + v + '</div><div class="s">' + s + '</div></div>'; };
      root.innerHTML = '<div class="topbar"><div><h1>Admin</h1><div class="sub">Platform overview and user management</div></div></div>' +
        '<section class="sec" style="padding-top:0"><div class="kpis">' + kpi('Users', st.users, st.admins + ' admin' + (st.admins === 1 ? '' : 's')) + kpi('Active (24h)', st.active_day, 'signed in') + kpi('New (7 days)', st.new_week, 'sign-ups') + kpi('Accounts', st.accounts, st.synced_accounts + ' with MT5 keys') + kpi('Trades', JPX.num(st.trades, 0), st.trades_by_source.map(function (s) { return esc(s.key) + ' ' + s.count; }).join(' · ') || 'none yet') + kpi('Suspended', st.suspended, 'users') + '</div></section>' +
        '<section class="sec cols-main"><div><div class="sec-head"><h2>Users</h2><input class="input sm" id="adm-q" type="search" placeholder="Search name or email" value="' + esc(adminQ) + '" style="max-width:240px" aria-label="Search users"></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>User</th><th class="hide-sm">Role</th><th class="r hide-sm">Trades</th><th class="hide-sm">Last sign-in</th><th>Status</th></tr></thead><tbody>' + (users.length ? users.map(function (u) {
          return '<tr tabindex="0" data-u="' + u.id + '"><td><span class="sym">' + esc(u.name) + '</span><span class="sub">' + esc(u.email) + '</span></td><td class="hide-sm">' + (u.role === 'admin' ? '<span class="chip accent">Admin</span> ' : '') + '<span class="chip">' + esc(u.plan ? u.plan.name : '') + '</span></td><td class="r num hide-sm">' + u.trades + '</td><td class="hide-sm num">' + (u.last_login ? JPX.fmtDate(u.last_login) : 'Never') + '</td><td>' + (u.status === 'active' ? '<span class="chip pos">Active</span>' : '<span class="chip neg">Suspended</span>') + '</td></tr>';
        }).join('') : '<tr style="cursor:default"><td colspan="5" class="muted">No users match.</td></tr>') + '</tbody></table></div></div>' +
        '<div><div class="sec-head"><h2>Sign-ups</h2><span class="sub">Last 30 days</span></div><div id="adm-su" class="chart-sm"></div><div class="sec-head" style="margin-top:30px"><h2>Admin activity</h2></div>' + (st.audit.length ? st.audit.map(function (a) { return '<div class="stat-row" style="font-size:13.5px"><span style="color:var(--ink)">' + esc(a.actor || 'Unknown') + ' ' + esc(a.action) + '<br><span class="muted">' + esc(a.target || '') + '</span></span><span class="muted num" style="white-space:nowrap">' + JPX.fmtDate(a.created_at, { year: undefined }) + '</span></div>'; }).join('') : '<p class="muted">No admin actions yet.</p>') + '</div></section>' +
        '<section class="sec"><div class="sec-head"><h2>Contact messages</h2><span class="sub">' + msgs.length + ' from the landing page form</span></div>' + (msgs.length ? msgs.map(function (m) {
          return '<div class="stat-row" style="align-items:flex-start"><div style="min-width:0"><b>' + esc(m.name) + '</b> <a href="mailto:' + esc(m.email) + '">' + esc(m.email) + '</a><div class="muted" style="white-space:pre-wrap;margin-top:4px;color:var(--ink)">' + esc(m.message) + '</div><div class="muted" style="font-size:12.5px;margin-top:4px">' + JPX.fmtDateTime(m.created_at) + '</div></div><button class="btn danger sm" data-msg-del="' + m.id + '" aria-label="Delete message">' + JPX.icon('trash') + '</button></div>';
        }).join('') : '<p class="muted">No messages yet. They appear here when someone uses the contact form.</p>') + '</section>';
      $$('[data-msg-del]', root).forEach(function (b) { b.addEventListener('click', function () { JPX.confirm({ title: 'Delete this message?', message: 'It is removed permanently.', confirm: 'Delete', danger: true }).then(function (ok) { if (ok) JPX.api('DELETE', '/api/admin/messages/' + b.dataset.msgDel).then(function () { JPX.toast('Message deleted'); JPX.views.admin(root); }, function (e) { JPX.toast(e.message, 'err'); }); }); }); });
      var qt; $('#adm-q', root).addEventListener('input', function (e) { clearTimeout(qt); qt = setTimeout(function () { adminQ = e.target.value.trim(); JPX.views.admin(root).then(function () { var el = $('#adm-q', root); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }); }, 300); });
      $$('[data-u]', root).forEach(function (tr) { var open = function () { manageUser(users.filter(function (u) { return u.id === Number(tr.dataset.u); })[0], root); }; tr.addEventListener('click', open); tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(); }); });
      var byDay = {}; st.signups.forEach(function (s) { byDay[s.date] = s.count; });
      var t = JPX.todayStr(), days = []; for (var i = 29; i >= 0; i--) { var d = JPX.addDays(t, -i); days.push({ label: d.slice(5), value: byDay[d] || 0, tip: String(byDay[d] || 0), sub: d + ' sign-ups' }); }
      C.bars($('#adm-su', root), days, { format: function (v) { return v; } });
    });
  };
  function manageUser(u, root) {
    var self = u.id === S.user.id;
    JPX.modal({
      title: u.name, size: 'narrow',
      body: '<p class="muted" style="margin-top:-6px">' + esc(u.email) + ' · joined ' + JPX.fmtDate(u.created_at) + ' · ' + u.accounts + ' account' + (u.accounts === 1 ? '' : 's') + ', ' + u.trades + ' trades</p>' +
        '<div class="field"><label for="m-role">Role</label><select class="input" id="m-role"><option value="user"' + (u.role === 'user' ? ' selected' : '') + '>User</option><option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>Admin</option></select></div>' +
        '<div class="field"><label for="m-status">Status</label><select class="input" id="m-status"><option value="active"' + (u.status === 'active' ? ' selected' : '') + '>Active</option><option value="suspended"' + (u.status === 'suspended' ? ' selected' : '') + '>Suspended (cannot sign in)</option></select></div>' +
        '<div class="field"><label for="m-plan">Plan</label><select class="input" id="m-plan">' + ['free', 'starter', 'pro', 'elite'].map(function (k) { return '<option value="' + k + '"' + (u.plan && u.plan.key === k ? ' selected' : '') + '>' + k.charAt(0).toUpperCase() + k.slice(1) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label for="m-mgr">Dedicated account manager (Elite)</label><input class="input" id="m-mgr" maxlength="120" value="' + esc((u.plan && u.plan.account_manager) || '') + '" placeholder="Name and contact"></div>' +
        '<div id="m-out"></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" id="m-reset">Reset password</button>' + (self ? '' : '<button class="btn danger sm" id="m-del">' + JPX.icon('trash') + 'Delete user</button>') + '</div>',
      foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="m-save">Save changes</button>',
      onMount: function (d) {
        $('#m-save', d).addEventListener('click', function () { JPX.api('PATCH', '/api/admin/users/' + u.id, { role: $('#m-role', d).value, status: $('#m-status', d).value }).then(function () { var np = $('#m-plan', d).value, nm = $('#m-mgr', d).value; return (np !== (u.plan && u.plan.key) || nm !== ((u.plan && u.plan.account_manager) || '')) ? JPX.api('PATCH', '/api/admin/users/' + u.id + '/plan', { plan: np, account_manager: nm }) : null; }).then(function () { JPX.toast('User updated'); d.close2(); JPX.views.admin(root); }, function (e) { JPX.toast(e.message, 'err'); }); });
        $('#m-reset', d).addEventListener('click', function () { JPX.confirm({ title: 'Reset password?', message: 'Generates a temporary password and signs this user out everywhere.', confirm: 'Reset' }).then(function (ok) { if (ok) JPX.api('POST', '/api/admin/users/' + u.id + '/reset-password').then(function (r) { $('#m-out', d).innerHTML = '<p class="muted">Share this temporary password securely. It is shown once.</p><div class="copy-row"><pre class="code">' + esc(r.temporary_password) + '</pre><button class="btn sm icon" id="m-cp" aria-label="Copy">' + JPX.icon('copy') + '</button></div>'; $('#m-cp', d).addEventListener('click', function () { JPX.copy(r.temporary_password); }); }, function (e) { JPX.toast(e.message, 'err'); }); }); });
        var del = $('#m-del', d); if (del) del.addEventListener('click', function () { JPX.confirm({ title: 'Delete ' + u.email + '?', message: 'Their accounts, trades and journal are permanently deleted.', confirm: 'Delete user', danger: true }).then(function (ok) { if (ok) JPX.api('DELETE', '/api/admin/users/' + u.id).then(function () { JPX.toast('User deleted'); d.close2(); JPX.views.admin(root); }, function (e) { JPX.toast(e.message, 'err'); }); }); });
      },
    });
  }
})();
