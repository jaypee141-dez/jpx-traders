/* Billing, Support (tickets + reviews), API token, admin extras */
(function () {
  'use strict';
  var JPX = window.JPX, S = JPX.state, esc = JPX.esc, $ = JPX.$, $$ = JPX.$$, money = JPX.money;
  var interval = 'month';

  /* ---------------- Billing ---------------- */
  JPX.views.billing = function (root) {
    return JPX.get('/api/billing').then(function (b) {
      var p = b.plan, daysLeft = p.trial_ends_at ? Math.max(0, Math.ceil((Date.parse(p.trial_ends_at) - Date.now()) / 86400000)) : 0;
      var lim = p.limits, meter = function (label, used, max) { var pct = Math.min(100, max ? used / max * 100 : 100); return '<div class="rule-row"><div class="rule-top"><span>' + label + '</span><span class="num">' + used + ' of ' + max + '</span></div><div class="meter ' + (used >= max ? 'bad' : pct >= 75 ? 'warn' : '') + '"><i style="width:' + pct + '%"></i></div></div>'; };
      root.innerHTML = '<div class="topbar"><div><h1>Billing</h1><div class="sub">Your plan, usage and upgrades</div></div></div>' +
        '<section class="sec" style="padding-top:0"><div class="cols-main"><div><div class="cap muted" style="font-weight:600;font-size:14px">Current plan</div><div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap"><div class="big num" style="font-size:44px;font-weight:800;letter-spacing:-.04em">' + esc(p.name) + '</div>' + (p.trialing ? '<span class="chip warn">Free trial · ' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's') + ' left</span>' : (p.source === 'stripe' ? '<span class="chip pos">Subscribed · ' + (p.interval === 'year' ? 'yearly' : 'monthly') + '</span>' : (p.source === 'admin' ? '<span class="chip accent">Assigned by admin</span>' : ''))) + '</div>' +
        '<p class="muted" style="margin-top:8px;max-width:56ch">' + (p.trialing ? 'You have full Pro access during your trial. Pick a plan before it ends to keep copy trading, live sync and advanced analytics.' : p.key === 'free' ? 'Your trial has ended. The journal, CSV import and basic analytics remain free; upgrade for copy trading, live MT5 sync and more.' : 'Thanks for being on ' + esc(p.name) + '.') + '</p>' +
        (p.account_manager ? '<div class="panel" style="margin-top:16px"><div class="lbl">Your dedicated account manager</div><b>' + esc(p.account_manager) + '</b></div>' : '') +
        (b.has_subscription ? '<button class="btn" id="b-portal" style="margin-top:16px">Manage subscription and invoices</button>' : '') + '</div>' +
        '<div><div class="sec-head"><h2>Usage</h2></div>' + meter('Trading accounts', b.usage.accounts, lim.accounts) + meter('Traders you copy', b.usage.follows, lim.follow) + '<div class="rule-row"><div class="rule-top"><span>Live MT5 sync</span><span>' + (lim.mt5 ? 'Included' : 'Not included') + '</span></div></div><div class="rule-row"><div class="rule-top"><span>Publish a strategy</span><span>' + (lim.publish ? 'Included' : 'Not included') + '</span></div></div><div class="rule-row"><div class="rule-top"><span>Advanced analytics</span><span>' + (lim.advancedAnalytics ? 'Included' : 'Not included') + '</span></div></div></div></div></section>' +
        '<section class="sec"><div class="sec-head"><h2>Plans</h2><div class="seg" id="b-int"><button data-v="month" aria-pressed="' + (interval === 'month') + '">Monthly</button><button data-v="year" aria-pressed="' + (interval === 'year') + '">Yearly · 2 months free</button></div></div>' +
        (b.payments_enabled ? '' : '<p class="hint" style="margin-bottom:14px">Online checkout is not enabled on this site yet. Choose a plan and we will switch it for you through support.</p>') +
        '<div class="cols-3">' + b.plans.map(function (pl) {
          var cur = pl.key === p.key && !p.trialing, price = pl.price[interval];
          return '<div class="panel" style="display:flex;flex-direction:column;gap:6px;' + (pl.featured ? 'border-color:var(--accent);box-shadow:var(--shadow)' : '') + '"><div style="display:flex;justify-content:space-between"><b style="font-size:18px">' + esc(pl.name) + '</b>' + (pl.featured ? '<span class="chip accent">Most popular</span>' : '') + '</div><div class="muted" style="font-size:13px">' + esc(pl.blurb) + '</div><div class="num" style="font-size:34px;font-weight:800;letter-spacing:-.04em;margin-top:6px">$' + price + '<span class="muted" style="font-size:14px;font-weight:600">/' + (interval === 'year' ? 'yr' : 'mo') + '</span></div><ul style="list-style:none;padding:0;margin:12px 0;display:grid;gap:8px;font-size:14px;flex:1">' + pl.features.map(function (f) { return '<li>' + JPX.icon('check', 'pos') + ' ' + esc(f) + '</li>'; }).join('') + '</ul><button class="btn ' + (cur ? '' : 'primary') + '" data-plan="' + pl.key + '"' + (cur ? ' disabled' : '') + '>' + (cur ? 'Current plan' : 'Choose ' + esc(pl.name)) + '</button></div>';
        }).join('') + '</div></section>';
      $$('#b-int button', root).forEach(function (x) { x.addEventListener('click', function () { interval = x.dataset.v; JPX.views.billing(root); }); });
      $$('[data-plan]', root).forEach(function (x) {
        x.addEventListener('click', function () {
          if (!b.payments_enabled) { JPX.openTicketForm({ category: 'billing', subject: 'Plan change request: ' + x.dataset.plan + ' (' + interval + 'ly)', message: 'Hi, I would like to switch to the ' + x.dataset.plan + ' plan, billed ' + interval + 'ly.' }); return; }
          JPX.busy(x, true, 'Redirecting…');
          JPX.api('POST', '/api/billing/checkout', { plan: x.dataset.plan, interval: interval }).then(function (r) { window.location.href = r.url; }, function (e) { JPX.busy(x, false); JPX.toast(e.message, 'err'); });
        });
      });
      var pt = $('#b-portal', root); if (pt) pt.addEventListener('click', function () { JPX.api('POST', '/api/billing/portal').then(function (r) { window.location.href = r.url; }, function (e) { JPX.toast(e.message, 'err'); }); });
    });
  };

  /* ---------------- Support ---------------- */
  var CATS = [['general', 'General'], ['billing', 'Billing and plans'], ['copy-trading', 'Copy trading'], ['mt5-sync', 'MT5 sync'], ['bug', 'Report a bug']];
  JPX.openTicketForm = function (pre, done) {
    pre = pre || {};
    JPX.modal({
      title: 'Contact support', size: 'wide',
      body: '<div class="field"><label for="t-cat">Topic</label><select class="input" id="t-cat">' + CATS.map(function (c) { return '<option value="' + c[0] + '"' + (pre.category === c[0] ? ' selected' : '') + '>' + c[1] + '</option>'; }).join('') + '</select></div><div class="field"><label for="t-sub">Subject</label><input class="input" id="t-sub" maxlength="120" value="' + esc(pre.subject || '') + '"></div><div class="field"><label for="t-msg">How can we help?</label><textarea class="input" id="t-msg" maxlength="5000" style="min-height:140px">' + esc(pre.message || '') + '</textarea></div><div class="form-error" id="t-err" hidden></div>',
      foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="t-go">Send</button>',
      onMount: function (d) {
        $('#t-go', d).addEventListener('click', function () {
          var b = $('#t-go', d), er = $('#t-err', d); er.hidden = true; JPX.busy(b, true, 'Sending…');
          JPX.api('POST', '/api/support/tickets', { category: $('#t-cat', d).value, subject: $('#t-sub', d).value, message: $('#t-msg', d).value }).then(function () { JPX.toast('Sent. We will reply here.'); d.close2(); if (done) done(); else location.hash = '#/support'; if (location.hash === '#/support') JPX.route(); }, function (e) { JPX.busy(b, false); er.textContent = e.message; er.hidden = false; });
        });
      },
    });
  };
  function openThread(id, admin, done) {
    JPX.get('/api/support/tickets/' + id).then(function (r) {
      var t = r.ticket;
      var render = function (msgs) { return msgs.map(function (m) { return '<div style="display:flex;flex-direction:column;align-items:' + (m.is_staff ? 'flex-start' : 'flex-end') + ';margin-bottom:10px"><div style="max-width:88%;padding:10px 14px;border-radius:14px;background:' + (m.is_staff ? 'var(--accent-soft)' : 'var(--surface-2)') + ';white-space:pre-wrap;word-break:break-word">' + esc(m.body) + '</div><span class="muted" style="font-size:12px;margin-top:3px">' + (m.is_staff ? 'JPX Support' : esc(m.author)) + ' · ' + JPX.fmtDateTime(m.created_at) + '</span></div>'; }).join(''); };
      JPX.modal({
        title: t.subject, size: 'wide',
        body: '<div class="muted" style="font-size:13.5px;margin-top:-8px">' + (admin ? esc(t.user_name) + ' · ' + esc(t.user_email) + ' · ' : '') + esc(t.category) + (t.priority ? ' · <b>Priority</b>' : '') + ' · <span class="chip ' + (t.status === 'closed' ? '' : t.status === 'answered' ? 'pos' : 'warn') + '">' + t.status + '</span></div><div id="th-list" style="max-height:48vh;overflow:auto">' + render(r.messages) + '</div>' +
          '<div class="field"><label for="th-msg">Reply</label><textarea class="input" id="th-msg" maxlength="5000"></textarea></div>',
        foot: '<button class="btn" id="th-close" style="margin-right:auto">' + (t.status === 'closed' ? 'Reopen' : 'Close ticket') + '</button><button class="btn" data-close>Done</button><button class="btn primary" id="th-send">Send reply</button>',
        onClose: function () { if (done) done(); },
        onMount: function (d) {
          var list = $('#th-list', d); list.scrollTop = list.scrollHeight;
          $('#th-send', d).addEventListener('click', function () { var m = $('#th-msg', d); if (!m.value.trim()) return; JPX.api('POST', '/api/support/tickets/' + id + '/messages', { message: m.value }).then(function (x) { m.value = ''; list.innerHTML = render(x.messages); list.scrollTop = list.scrollHeight; }, function (e) { JPX.toast(e.message, 'err'); }); });
          $('#th-close', d).addEventListener('click', function () { JPX.api('PATCH', '/api/support/tickets/' + id, { status: t.status === 'closed' ? 'open' : 'closed' }).then(function () { d.close2(); }, function (e) { JPX.toast(e.message, 'err'); }); });
        },
      });
    }, function (e) { JPX.toast(e.message, 'err'); });
  }
  JPX.views.support = function (root) {
    return Promise.all([JPX.get('/api/support/tickets'), JPX.get('/api/reviews/mine')]).then(function (res) {
      var tickets = res[0].tickets, rv = res[1].review, rating = rv ? rv.rating : 5, pr = S.user.plan.limits.priority;
      root.innerHTML = '<div class="topbar"><div><h1>Support</h1><div class="sub">Message our team any time' + (pr ? ' · your tickets are marked priority' : '') + '</div></div><button class="btn primary" id="new-t">' + JPX.icon('plus') + 'New ticket</button></div>' +
        (tickets.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Subject</th><th class="hide-sm">Topic</th><th>Status</th><th class="hide-sm">Updated</th></tr></thead><tbody>' + tickets.map(function (t) { return '<tr data-t="' + t.id + '" tabindex="0"><td><span class="sym">' + esc(t.subject) + '</span>' + (t.priority ? ' <span class="chip accent">Priority</span>' : '') + '</td><td class="hide-sm">' + esc(t.category) + '</td><td><span class="chip ' + (t.status === 'closed' ? '' : t.status === 'answered' ? 'pos' : 'warn') + '">' + (t.status === 'answered' ? 'Reply received' : t.status) + '</span></td><td class="hide-sm num">' + JPX.fmtDateTime(t.updated_at) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty"><h3>No tickets yet</h3><p>Questions about billing, copy trading or MT5 sync? Send us a message and the reply shows up here.</p></div>') +
        '<section class="sec" style="margin-top:28px"><div class="sec-head"><h2>Leave a review</h2><span class="sub">' + (rv ? 'Status: ' + rv.status : 'Reviews appear on our website after approval') + '</span></div><form id="rv" class="form-grid" style="max-width:680px" novalidate><div class="field full"><span class="lbl">Rating</span><div class="seg" id="rv-r">' + [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" data-v="' + n + '" aria-pressed="' + (n === rating) + '">' + n + ' ★</button>'; }).join('') + '</div></div><div class="field full"><label for="rv-q">Your experience</label><textarea class="input" id="rv-q" maxlength="400" placeholder="What has JPX Traders helped you do?">' + esc(rv ? rv.quote : '') + '</textarea></div><div class="field full"><label for="rv-role">Describe yourself (optional)</label><input class="input" id="rv-role" maxlength="40" value="' + esc(rv ? rv.role : '') + '" placeholder="e.g. Forex trader"></div><div class="form-error full" id="rv-err" hidden></div><div class="full"><button class="btn" type="submit">' + (rv ? 'Update review' : 'Submit review') + '</button></div></form></section>';
      $('#new-t', root).addEventListener('click', function () { JPX.openTicketForm(null, function () { JPX.route(); }); });
      $$('[data-t]', root).forEach(function (tr) { var o = function () { openThread(Number(tr.dataset.t), false, function () { JPX.route(); }); }; tr.addEventListener('click', o); tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') o(); }); });
      $$('#rv-r button', root).forEach(function (b) { b.addEventListener('click', function () { rating = Number(b.dataset.v); $$('#rv-r button', root).forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); }); });
      $('#rv', root).addEventListener('submit', function (e) { e.preventDefault(); var er = $('#rv-err', root); er.hidden = true; JPX.api('POST', '/api/reviews', { rating: rating, quote: $('#rv-q', root).value, role: $('#rv-role', root).value }).then(function () { JPX.toast('Thanks! Your review will appear after approval.'); JPX.route(); }, function (x) { er.textContent = x.message; er.hidden = false; }); });
    });
  };

  /* ---------------- Settings: API token (wraps the existing settings view) ---------------- */
  var baseSettings = JPX.views.settings;
  JPX.views.settings = function (root) {
    baseSettings(root);
    return JPX.get('/api/me/api-token').then(function (r) {
      var sec = document.createElement('section'); sec.className = 'sec';
      sec.innerHTML = '<div class="sec-head"><h2>Developer API</h2></div>' + (r.allowed ? '<p class="muted" style="margin-bottom:14px;max-width:62ch">Read your trades and analytics from your own tools. Send <span class="code-inline">Authorization: Bearer &lt;token&gt;</span> to <span class="code-inline">GET ' + esc(location.origin) + '/api/v1/trades</span>, <span class="code-inline">/api/v1/analytics</span> or <span class="code-inline">/api/v1/me</span>.</p><div id="tok-box">' + (r.token ? '<p class="muted">A token starting <span class="code-inline">' + esc(r.token.prefix) + '…</span> is active.</p>' : '') + '</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn" id="tok-new">' + JPX.icon('key') + (r.token ? 'Replace token' : 'Create API token') + '</button>' + (r.token ? '<button class="btn danger" id="tok-del">Revoke</button>' : '') + '</div>' : '<p class="muted" style="max-width:62ch">API access is included in the Elite plan. <a href="#/billing">View plans</a></p>');
      root.appendChild(sec);
      var nb = $('#tok-new', sec); if (nb) nb.addEventListener('click', function () { JPX.api('POST', '/api/me/api-token').then(function (x) { $('#tok-box', sec).innerHTML = '<p class="pos" style="font-weight:600">Copy it now; it is shown once.</p><div class="copy-row"><pre class="code">' + esc(x.token) + '</pre><button class="btn sm icon" id="tok-cp" aria-label="Copy">' + JPX.icon('copy') + '</button></div>'; $('#tok-cp', sec).addEventListener('click', function () { JPX.copy(x.token); }); }, function (e) { JPX.toast(e.message, 'err'); }); });
      var nd = $('#tok-del', sec); if (nd) nd.addEventListener('click', function () { JPX.api('DELETE', '/api/me/api-token').then(function () { JPX.toast('Token revoked'); JPX.route(); }, function (e) { JPX.toast(e.message, 'err'); }); });
    });
  };

  /* ---------------- Admin extras: tickets + review moderation (wraps the existing admin view) ---------------- */
  var baseAdmin = JPX.views.admin;
  JPX.views.admin = function (root) {
    return Promise.resolve(baseAdmin(root)).then(function () {
      if (S.user.role !== 'admin') return;
      return Promise.all([JPX.get('/api/admin/tickets'), JPX.get('/api/admin/reviews'), JPX.get('/api/admin/site')]).then(function (res) {
        var site = res[2].site, tk = res[0].tickets, rv = res[1].reviews, open = tk.filter(function (t) { return t.status !== 'closed'; }).length;
        var sec = document.createElement('div');
        var fld = function (id, label, val, ph, hint) { return '<div class="field"><label for="' + id + '">' + label + '</label><input class="input" id="' + id + '" name="' + id + '" value="' + esc(val) + '" placeholder="' + esc(ph || '') + '" autocomplete="off">' + (hint ? '<span class="hint">' + hint + '</span>' : '') + '</div>'; };
        sec.innerHTML = '<section class="sec"><div class="sec-head"><h2>Website settings</h2><span class="sub">Shown on your public landing page</span></div><form id="site-form" class="form-grid" style="max-width:760px" novalidate>' +
          fld('stat_number', 'Traders number (hero)', site.stat_number, '10,000+') + fld('stat_label', 'Traders label (hero)', site.stat_label, 'Active Traders Worldwide') +
          '<div class="field full"><label for="reviews_intro">Testimonials intro line</label><input class="input" id="reviews_intro" name="reviews_intro" maxlength="140" value="' + esc(site.reviews_intro) + '"></div>' +
          fld('social_telegram', 'Telegram link', site.social_telegram, 'https://t.me/yourchannel') + fld('social_x', 'X (Twitter) link', site.social_x, 'https://x.com/yourhandle') +
          fld('social_youtube', 'YouTube link', site.social_youtube, 'https://youtube.com/@yourchannel') + fld('social_discord', 'Discord link', site.social_discord, 'https://discord.gg/yourinvite') +
          '<div class="hint full">Social icons always show in the website footer; an icon becomes a clickable link once you add its URL. Leave a field empty to remove the link.</div><div class="form-error full" id="site-err" hidden></div><div class="full"><button class="btn primary" type="submit">Save website settings</button></div></form></section>' +
          '<section class="sec"><div class="sec-head"><h2>Support tickets</h2><span class="sub">' + open + ' open of ' + tk.length + '</span></div>' + (tk.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Ticket</th><th class="hide-sm">User</th><th>Status</th><th class="hide-sm">Updated</th></tr></thead><tbody>' + tk.map(function (t) { return '<tr data-at="' + t.id + '" tabindex="0"><td><span class="sym">' + esc(t.subject) + '</span>' + (t.priority ? ' <span class="chip accent">Priority</span>' : '') + '<span class="sub">' + esc(t.category) + '</span></td><td class="hide-sm">' + esc(t.user_name) + '<span class="sub">' + esc(t.user_email) + '</span></td><td><span class="chip ' + (t.status === 'closed' ? '' : t.status === 'answered' ? 'pos' : 'warn') + '">' + t.status + '</span></td><td class="hide-sm num">' + JPX.fmtDateTime(t.updated_at) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted">No tickets yet.</p>') + '</section>' +
          '<section class="sec"><div class="sec-head"><h2>Reviews</h2><span class="sub">Approved reviews appear on the landing page</span></div>' + (rv.length ? rv.map(function (r) { return '<div class="stat-row" style="align-items:flex-start;gap:16px"><div style="min-width:0"><b>' + esc(r.name) + '</b> <span class="rating">' + '★'.repeat(r.rating) + '</span> <span class="chip ' + (r.status === 'approved' ? 'pos' : r.status === 'rejected' ? 'neg' : 'warn') + '">' + r.status + '</span><div style="margin-top:4px;color:var(--ink);white-space:pre-wrap">' + esc(r.quote) + '</div><div class="muted" style="font-size:12.5px">' + esc(r.role || '') + ' · ' + esc(r.email) + '</div></div><div style="display:flex;gap:6px;flex:none"><button class="btn sm" data-rv="approved" data-id="' + r.id + '">Approve</button><button class="btn sm" data-rv="rejected" data-id="' + r.id + '">Reject</button></div></div>'; }).join('') : '<p class="muted">No reviews submitted yet.</p>') + '</section>';
        root.appendChild(sec);
        $('#site-form', sec).addEventListener('submit', function (e) {
          e.preventDefault(); var er = $('#site-err', sec); er.hidden = true; var data = {};
          Array.prototype.forEach.call(e.target.elements, function (el) { if (el.name) data[el.name] = el.value.trim(); });
          var b = $('button[type=submit]', e.target); JPX.busy(b, true);
          JPX.api('PUT', '/api/admin/site', data).then(function () { JPX.busy(b, false); JPX.toast('Website settings saved'); }, function (x) { JPX.busy(b, false); er.textContent = x.message; er.hidden = false; });
        });
        $$('[data-at]', sec).forEach(function (tr) { var o = function () { openThread(Number(tr.dataset.at), true, function () { JPX.views.admin(root); }); }; tr.addEventListener('click', o); tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') o(); }); });
        $$('[data-rv]', sec).forEach(function (b) { b.addEventListener('click', function () { JPX.api('PATCH', '/api/admin/reviews/' + b.dataset.id, { status: b.dataset.rv }).then(function () { JPX.toast('Review ' + b.dataset.rv); JPX.views.admin(root); }, function (e) { JPX.toast(e.message, 'err'); }); }); });
      });
    });
  };
})();
