/* JPX bootstrap: auth, app shell, router */
(function () {
  'use strict';
  var JPX = window.JPX, S = JPX.state, esc = JPX.esc, $ = JPX.$, $$ = JPX.$$;
  var app = document.getElementById('app');

  var NAV = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' }, { id: 'trades', label: 'Trades', icon: 'trades' }, { id: 'copy', label: 'Copy trading', icon: 'copytrade' }, { id: 'calendar', label: 'Calendar', icon: 'calendar' },
    { id: 'journal', label: 'Journal', icon: 'journal' }, { id: 'analytics', label: 'Analytics', icon: 'analytics' }, { id: 'risk', label: 'Risk', icon: 'risk' },
  ];
  var MANAGE = [{ id: 'brokers', label: 'Brokers', icon: 'brokers' }, { id: 'billing', label: 'Billing', icon: 'billing' }, { id: 'support', label: 'Support', icon: 'support' }, { id: 'settings', label: 'Settings', icon: 'settings' }];
  var TITLES = { dashboard: 'Dashboard', trades: 'Trades', copy: 'Copy trading', billing: 'Billing', support: 'Support', calendar: 'Calendar', journal: 'Journal', analytics: 'Analytics', risk: 'Risk', brokers: 'Brokers', settings: 'Settings', admin: 'Admin' };

  /* ---------- auth ---------- */
  function showAuth(mode) {
    mode = mode || (location.pathname === '/register' ? 'register' : 'login');
    document.title = (mode === 'login' ? 'Sign in' : 'Create account') + ' · JPX Traders';
    var reg = mode === 'register';
    app.innerHTML = '<div class="auth"><aside class="auth-aside"><a class="brand" href="/">' + JPX.logo() + 'JPX Traders</a><div><h2>See what your trading is really made of.</h2><p>Log every trade, tag the setup, and let the numbers show which habits pay and which cost you.</p></div><span style="color:var(--rail-ink);font-size:13px">Your journal is private to your account.</span></aside>' +
      '<main class="auth-main"><form class="auth-card" id="auth-form" novalidate><a class="brand show-sm" href="/" style="color:var(--ink)">' + JPX.logo() + 'JPX Traders</a><div><h1>' + (reg ? 'Create your account' : 'Welcome back') + '</h1><p class="muted" style="margin-top:6px">' + (reg ? 'Start journaling in a couple of minutes.' : 'Sign in to your trading journal.') + '</p></div>' +
      (reg ? '<div class="field"><label for="au-name">Name</label><input class="input" id="au-name" name="name" autocomplete="name" maxlength="80" required></div>' : '') +
      '<div class="field"><label for="au-email">Email</label><input class="input" id="au-email" name="email" type="email" autocomplete="email" inputmode="email" required></div>' +
      '<div class="field"><label for="au-pw">Password</label><input class="input" id="au-pw" name="password" type="password" autocomplete="' + (reg ? 'new-password' : 'current-password') + '" required' + (reg ? ' minlength="8"' : '') + '>' + (reg ? '<span class="hint">At least 8 characters.</span>' : '') + '</div>' +
      '<div class="form-error" id="au-err" hidden role="alert"></div><button class="btn primary" type="submit" style="min-height:46px">' + (reg ? 'Create account' : 'Sign in') + '</button>' +
      '<p class="auth-switch">' + (reg ? 'Already have an account? <a href="/login" id="sw">Sign in</a>' : 'New to JPX Traders? <a href="/register" id="sw">Create an account</a>') + '</p></form></main></div>';
    $('#sw').addEventListener('click', function (e) { e.preventDefault(); history.pushState({}, '', reg ? '/login' : '/register'); showAuth(reg ? 'login' : 'register'); });
    $('#au-' + (reg ? 'name' : 'email')).focus();
    $('#auth-form').addEventListener('submit', function (e) {
      e.preventDefault(); var f = e.target, err = $('#au-err'), btn = $('button[type=submit]', f); err.hidden = true;
      var data = {}; Array.prototype.forEach.call(f.elements, function (el) { if (el.name) data[el.name] = el.value; });
      if (reg) { data.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; if (!data.name.trim()) return fail('Enter your name'); }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email.trim())) return fail('Enter a valid email address');
      if (!data.password) return fail('Enter your password');
      if (reg && data.password.length < 8) return fail('Password must be at least 8 characters');
      function fail(m) { err.textContent = m; err.hidden = false; }
      JPX.busy(btn, true, reg ? 'Creating account…' : 'Signing in…');
      JPX.api('POST', reg ? '/api/auth/register' : '/api/auth/login', data).then(function (r) {
        S.user = r.user; history.replaceState({}, '', '/app'); location.hash = location.hash && location.hash !== '#/' ? location.hash : '#/dashboard'; boot2();
      }, function (er) { JPX.busy(btn, false); fail(er.message); });
    });
  }
  JPX.onSignedOut = function () { S.accounts = []; history.replaceState({}, '', '/login'); showAuth('login'); };
  window.addEventListener('popstate', function () { if (!S.user) showAuth(); });

  /* ---------- shell ---------- */
  JPX.renderShell = function () {
    var u = S.user, cur = currentName(), items = NAV.concat(MANAGE).concat(u.role === 'admin' ? [{ id: 'admin', label: 'Admin', icon: 'admin' }] : []);
    var link = function (n) { return '<a class="nav" href="#/' + n.id + '" data-nav="' + n.id + '"' + (n.id === cur ? ' aria-current="page"' : '') + '>' + JPX.icon(n.icon) + n.label + '</a>'; };
    app.innerHTML = '<div class="shell"><aside class="rail"><a class="brand" href="#/dashboard">' + JPX.logo() + 'JPX Traders</a><nav aria-label="Main">' + NAV.map(link).join('') + '<div class="group">Manage</div>' + MANAGE.map(link).join('') + (u.role === 'admin' ? link({ id: 'admin', label: 'Admin', icon: 'admin' }) : '') + '</nav><div class="spacer"></div>' +
      '<div class="me"><div class="avatar" aria-hidden="true">' + esc(u.name.trim().charAt(0).toUpperCase()) + '</div><div class="who"><b>' + esc(u.name) + '</b><span>' + esc(u.email) + '</span></div><button class="btn ghost icon sm" id="sign-out" aria-label="Sign out" style="color:#fff;margin-left:auto">' + JPX.icon('logout') + '</button></div></aside>' +
      '<main class="main" id="view" tabindex="-1"></main></div>' +
      '<nav class="tabbar" aria-label="Primary">' + ['dashboard', 'trades', 'copy', 'analytics'].map(function (id) { var n = items.filter(function (i) { return i.id === id; })[0]; return '<a href="#/' + id + '" data-nav="' + id + '"' + (id === cur ? ' aria-current="page"' : '') + '>' + JPX.icon(n.icon) + (id === 'copy' ? 'Copy' : n.label) + '</a>'; }).join('') + '<button id="more-btn" aria-haspopup="dialog">' + JPX.icon('more') + 'More</button></nav>';
    $('#sign-out').addEventListener('click', signOut);
    $('#more-btn').addEventListener('click', function () {
      var rest = items.filter(function (i) { return ['dashboard', 'trades', 'copy', 'analytics'].indexOf(i.id) < 0; });
      var dark = document.documentElement.dataset.theme === 'dark';
      JPX.modal({ title: 'More', sheet: true, body: '<div class="sheet-list" style="margin:-12px -12px -12px">' + rest.map(function (i) { return '<a href="#/' + i.id + '">' + JPX.icon(i.icon) + i.label + '</a>'; }).join('') + '<a href="#" id="m-theme">' + JPX.icon(dark ? 'sun' : 'moon') + (dark ? 'Light mode' : 'Dark mode') + '</a><a href="#" id="m-out">' + JPX.icon('logout') + 'Sign out</a></div>',
        onMount: function (d) { $$('a[href^="#/"]', d).forEach(function (a) { a.addEventListener('click', function () { d.close2(); }); }); $('#m-theme', d).addEventListener('click', function (e) { e.preventDefault(); window.JPXTheme.set(dark ? 'light' : 'dark'); d.close2(); }); $('#m-out', d).addEventListener('click', function (e) { e.preventDefault(); d.close2(); signOut(); }); } });
    });
  };
  function signOut() { JPX.leaveJournal && JPX.leaveJournal(); JPX.api('POST', '/api/auth/logout').then(function () { S.user = null; JPX.onSignedOut(); }, function (e) { JPX.toast(e.message, 'err'); }); }

  /* ---------- router ---------- */
  function parseHash() { var h = location.hash.replace(/^#\/?/, '').split('/'); return { name: h[0] || 'dashboard', arg: h[1] }; }
  function currentName() { var n = parseHash().name; return TITLES[n] ? n : 'dashboard'; }
  var token = 0, lastName = null;
  JPX.route = function () {
    if (!S.user) return;
    var p = parseHash(), name = TITLES[p.name] ? p.name : 'dashboard', view = $('#view');
    if (!view) { JPX.renderShell(); view = $('#view'); }
    if (lastName === 'journal' && name !== 'journal') JPX.leaveJournal();
    $$('[data-nav]').forEach(function (a) { if (a.dataset.nav === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    document.title = TITLES[name] + ' · JPX Traders';
    var my = ++token, same = lastName === name && view.querySelector('.page');
    lastName = name;
    if (window._jpxKeys) { document.removeEventListener('keydown', window._jpxKeys); window._jpxKeys = null; }
    // Each render gets its own host so a slow, stale render can never overwrite a newer page.
    // The host is laid out immediately (charts need real widths) but stays hidden until it is current.
    var old = Array.prototype.slice.call(view.children);
    var host = document.createElement('div'); host.className = 'page';
    view.style.position = 'relative';
    if (same) { host.style.cssText = 'position:absolute;left:0;right:0;top:0;visibility:hidden'; }
    else { old.forEach(function (n) { n.remove(); }); old = []; host.innerHTML = '<div class="spin" role="status" aria-label="Loading"></div>'; }
    view.appendChild(host);
    var reveal = function () { old.forEach(function (n) { n.remove(); }); host.style.cssText = ''; };
    if (!same) { var spin = host.firstChild; host.view$ = spin; }
    Promise.resolve(JPX.views[name](host, p.arg)).then(function () {
      if (my !== token) { host.remove(); return; }
      reveal();
      if (host._keys) { window._jpxKeys = host._keys; document.addEventListener('keydown', window._jpxKeys); }
    }, function (e) {
      if (my !== token) { host.remove(); return; }
      reveal(); host.innerHTML = '<div class="empty"><h3>Something went wrong</h3><p>' + esc(e.message) + '</p><button class="btn" id="retry">Try again</button></div>'; $('#retry', host).addEventListener('click', JPX.route);
    });
  };
  window.addEventListener('hashchange', function () { if (S.user) { window.scrollTo({ top: 0 }); JPX.route(); } });
  window.addEventListener('jpx-theme', function () { if (S.user) JPX.route(); });

  /* ---------- boot ---------- */
  function boot2() { JPX.refreshAccounts().then(function () {}, function () {}).then(function () { JPX.renderShell(); lastName = null; JPX.route(); }); }
  JPX.get('/api/me').then(function (r) {
    if (r.user) { S.user = r.user; if (!location.hash) location.hash = '#/dashboard'; boot2(); } else showAuth();
  }, function (e) { app.innerHTML = '<div class="empty" style="min-height:100vh;align-content:center"><h3>Cannot reach JPX Traders</h3><p>' + esc(e.message) + '</p><button class="btn primary" onclick="location.reload()">Reload</button></div>'; });
})();
