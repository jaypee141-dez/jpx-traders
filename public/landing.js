(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- smooth scrolling (eased, header-aware, cancellable) ---------- */
  var anim = null;
  function ease(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function scrollToY(y, done) {
    if (anim) cancelAnimationFrame(anim);
    var start = window.scrollY, max = document.documentElement.scrollHeight - window.innerHeight;
    y = Math.max(0, Math.min(y, max));
    var dist = y - start;
    if (reduce || Math.abs(dist) < 4) { window.scrollTo(0, y); if (done) done(); return; }
    var dur = Math.min(1100, 450 + Math.abs(dist) * 0.32), t0 = null;
    var cancel = function () { cancelAnimationFrame(anim); anim = null; };
    ['wheel', 'touchstart', 'keydown'].forEach(function (ev) { window.addEventListener(ev, cancel, { once: true, passive: true }); });
    (function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      window.scrollTo(0, start + dist * ease(p));
      if (p < 1) anim = requestAnimationFrame(step); else { anim = null; if (done) done(); }
    })(performance.now());
  }
  var headH = function () { return ($('lp-head') || {}).offsetHeight || 76; };
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href').slice(1), target = id === 'top' || id === '' ? null : document.getElementById(id);
    if (id !== 'top' && !target) return;
    e.preventDefault();
    var y = target ? target.getBoundingClientRect().top + window.scrollY - headH() + 4 : 0;
    scrollToY(y, function () { if (history.pushState) history.pushState(null, '', '#' + id); });
  });

  /* ---------- nav, header, progress, scroll-spy, parallax ---------- */
  var burger = $('lp-burger'), links = $('lp-links'), head = $('lp-head'), bar = $('lp-progress');
  burger.addEventListener('click', function () { var o = links.classList.toggle('open'); burger.setAttribute('aria-expanded', String(o)); burger.setAttribute('aria-label', o ? 'Close menu' : 'Open menu'); });
  links.addEventListener('click', function (e) { if (e.target.tagName === 'A') { links.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); } });
  var anchors = Array.prototype.slice.call(links.querySelectorAll('a'));
  var secs = anchors.map(function (a) { var h = a.getAttribute('href'); return h === '#top' ? null : document.querySelector(h); });
  var pars = Array.prototype.slice.call(document.querySelectorAll('[data-par]'));
  var ticking = false;
  function frame() {
    ticking = false;
    var y = window.scrollY, max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.transform = 'scaleX(' + (max > 0 ? y / max : 0) + ')';
    head.classList.toggle('scrolled', y > 8);
    var cur = 0, probe = y + headH() + 80;
    secs.forEach(function (s, i) { if (s && s.getBoundingClientRect().top + y <= probe) cur = i; });
    anchors.forEach(function (a, i) { a.classList.toggle('on', i === cur); });
    if (!reduce && y < 1400) pars.forEach(function (el) { el.style.transform = 'translate3d(0,' + (y * parseFloat(el.dataset.par)).toFixed(1) + 'px,0)'; });
  }
  window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }, { passive: true });
  window.addEventListener('resize', frame); frame();

  /* ---------- reveal on scroll ---------- */
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (ents) {
    ents.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }) : null;
  function observe(root) {
    Array.prototype.slice.call((root || document).querySelectorAll('[data-reveal]:not(.in)')).forEach(function (el) { if (io) io.observe(el); else el.classList.add('in'); });
  }
  observe();

  /* ---------- calculator ---------- */
  var P = window.JPXCalc.PRESETS, sel = $('k-preset');
  sel.innerHTML = Object.keys(P).map(function (k) { return '<option value="' + k + '">' + esc(P[k].label) + '</option>'; }).join('');
  var SAMPLES = { fx_usd: [1.085, 1.082, 1.091], fx_jpy: [150, 149.5, 151], gold: [2900, 2890, 2925], index: [18000, 17950, 18120], custom: [100, 95, 110] };
  var ids = ['k-bal', 'k-risk', 'k-entry', 'k-stop', 'k-target', 'k-cs'];
  var fm = function (n) { return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }); };
  function run() {
    var v = {}; ids.forEach(function (i) { v[i] = $(i).value; });
    $('k-cs-wrap').hidden = sel.value !== 'custom';
    var r = window.JPXCalc.size({ preset: sel.value, balance: v['k-bal'], riskPct: v['k-risk'], entry: v['k-entry'], stop: v['k-stop'], target: v['k-target'], contract: v['k-cs'] });
    var out = $('k-out');
    if (!r.ok) { out.innerHTML = '<div style="grid-column:1/-1;padding:16px;border-radius:12px;background:#eef3ff;color:#5b6785">' + esc(r.error) + '</div>'; return; }
    out.innerHTML = '<div class="big-out"><div class="k">Position size</div><div class="v num">' + (Math.round(r.lots * 100) / 100).toLocaleString('en-US') + ' lots</div></div>' +
      '<div><div class="k">Amount at risk</div><div class="v2 num neg">' + fm(r.riskAmount) + '</div></div><div><div class="k">Direction</div><div class="v2">' + (r.direction === 'long' ? 'Long' : 'Short') + '</div></div>' +
      (r.reward != null ? '<div><div class="k">Potential reward</div><div class="v2 num pos">' + fm(r.reward) + '</div></div><div><div class="k">Reward to risk</div><div class="v2 num">' + r.rr.toFixed(2) + ' : 1</div></div>' : '');
  }
  sel.addEventListener('change', function () { var s = SAMPLES[sel.value]; $('k-entry').value = s[0]; $('k-stop').value = s[1]; $('k-target').value = s[2]; run(); });
  ids.forEach(function (i) { $(i).addEventListener('input', run); });
  run();

  /* ---------- live data: plans, reviews, leaderboard, stats ---------- */
  var yearly = false, plans = [], content = { social: {}, sample_reviews: [] };
  var fetchJson = function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u); return r.json(); }); };
  function renderPlans() {
    $('plans').innerHTML = plans.map(function (p, i) {
      var price = yearly ? p.price.year : p.price.month;
      return '<article class="plan glass' + (p.featured ? ' featured' : '') + '" data-reveal style="--i:' + i + '">' + (p.featured ? '<span class="tag">Most Popular</span>' : '') +
        '<h3>' + esc(p.name) + '</h3><p class="blurb">' + esc(p.blurb) + '</p><div class="price num">$' + price + '<small>/' + (yearly ? 'year' : 'month') + '</small></div>' +
        '<ul>' + p.features.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>' +
        '<a class="btn pill ' + (p.featured ? 'grad' : 'outline') + '" href="/register">Get Started</a></article>';
    }).join('');
    observe($('plans'));
  }
  [['bill-m', false], ['bill-y', true]].forEach(function (b) {
    $(b[0]).addEventListener('click', function () { yearly = b[1]; $('bill-m').setAttribute('aria-pressed', String(!yearly)); $('bill-y').setAttribute('aria-pressed', String(yearly)); renderPlans(); });
  });
  fetchJson('/api/public/plans').then(function (r) { plans = r.plans; $('trial-note').textContent = 'Every new account starts with a ' + r.trial_days + '-day Pro trial. No credit card required.'; renderPlans(); }, function () { $('plans').innerHTML = '<p>Pricing could not be loaded. Please refresh.</p>'; });

  var track = $('quotes');
  function updateCar() { $('car-prev').disabled = track.scrollLeft < 4; $('car-next').disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4; }
  function slide(dir) { var card = track.querySelector('.quote'); if (!card) return; track.scrollBy({ left: dir * (card.offsetWidth + 16), behavior: reduce ? 'auto' : 'smooth' }); }
  $('car-prev').addEventListener('click', function () { slide(-1); }); $('car-next').addEventListener('click', function () { slide(1); });
  track.addEventListener('scroll', function () { requestAnimationFrame(updateCar); }, { passive: true });
  track.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') slide(1); if (e.key === 'ArrowLeft') slide(-1); });
  function renderReviews(real) {
    var list = real.map(function (r) { return { quote: r.quote, name: r.name, role: r.role || 'Trader', rating: r.rating, sample: false }; });
    var samples = (content.sample_reviews || []).map(function (r) { return { quote: r.quote, name: r.name, role: r.role, rating: 5, sample: true }; });
    list = list.concat(samples).slice(0, Math.max(4, real.length));
    track.innerHTML = list.map(function (t) {
      return '<figure class="quote glass"><div class="stars" aria-label="' + t.rating + ' out of 5 stars">' + '★'.repeat(t.rating) + '<span style="opacity:.25">' + '★'.repeat(5 - t.rating) + '</span></div><blockquote>' + esc(t.quote) + '</blockquote><figcaption><span class="av" aria-hidden="true">' + esc((t.name || '?').charAt(0).toUpperCase()) + '</span><span class="who"><b>' + esc(t.name) + '</b><span>' + esc(t.role) + '</span></span>' + (t.sample ? '<span class="sample">Sample</span>' : '') + '</figcaption></figure>';
    }).join('');
    updateCar();
  }
  var pct = function (v) { return v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'; };
  function spark(pts, w, h) {
    if (!pts || pts.length < 2) return '';
    var lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts), sp = hi - lo || 1;
    var d = pts.map(function (v, i) { return (i ? 'L' : 'M') + (i / (pts.length - 1) * w).toFixed(1) + ' ' + (h - 2 - ((v - lo) / sp) * (h - 4)).toFixed(1); }).join('');
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><path d="' + d + '" fill="none" stroke="' + (pts[pts.length - 1] >= pts[0] ? '#0b9a78' : '#d9482b') + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  var hue = function (n) { var h = 0; for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360; return h; };
  var av = function (n, s) { return '<span class="lav" style="width:' + s + 'px;height:' + s + 'px;background:linear-gradient(135deg,hsl(' + hue(n) + ',70%,48%),hsl(' + ((hue(n) + 50) % 360) + ',70%,55%))">' + esc(n.charAt(0).toUpperCase()) + '</span>'; };
  function renderBoard(ls) {
    if (!ls.length) { $('board').innerHTML = '<div class="board-empty"><b>No public traders yet</b><p>Be the first to share a strategy. Create an account, connect your trades and publish from Copy trading.</p><a class="btn pill outline" href="/register">Share my strategy</a></div>'; return; }
    $('board').innerHTML = '<div class="board-rows">' + ls.map(function (x) {
      return '<div class="board-row"><span class="rk num">' + x.rank + '</span>' + av(x.alias, 40) + '<div class="nm"><b>' + esc(x.alias) + (x.elite_only ? ' <i class="el">Elite</i>' : '') + '</b><span>' + esc(x.bio || '') + '</span></div><div class="mt hide-sm"><small>Win rate</small><b class="num">' + x.win_rate + '%</b></div><div class="mt hide-sm"><small>Trades</small><b class="num">' + x.trades + '</b></div><div class="mt hide-sm"><small>Followers</small><b class="num">' + x.followers + '</b></div><div class="tr hide-sm">' + spark(x.spark, 96, 30) + '</div><div class="gn num ' + (x.gain >= 0 ? 'pos' : 'neg') + '">' + pct(x.gain) + '<small>30 days</small></div><a class="btn pill grad sm" href="/register">Copy</a></div>';
    }).join('') + '</div>';
  }
  Promise.all([fetchJson('/content.json').catch(function () { return content; }), fetchJson('/api/public/reviews').catch(function () { return { reviews: [] }; })]).then(function (res) { content = res[0]; renderReviews(res[1].reviews); });
  fetchJson('/api/public/leaders').then(function (r) {
    renderBoard(r.leaders);
    $('people-stack').innerHTML = r.leaders.slice(0, 4).map(function (x) { return av(x.alias, 34); }).join('');
  }, function () { $('board').innerHTML = '<p class="board-empty">Leaderboard could not be loaded. Please refresh.</p>'; });
  var site = null;
  fetchJson('/api/public/site').then(function (r) {
    site = r.site;
    $('people-count').textContent = site.stat_number; $('people-label').textContent = site.stat_label; $('reviews-intro').textContent = site.reviews_intro;
    renderSocial();
  }, function () { /* built-in defaults stay */ });
  $('yr').textContent = new Date().getFullYear();
  var SOC = {
    telegram: { label: 'Telegram', svg: '<path d="M21.5 3.5 2.8 10.7l5.4 2 2 6.1 3.2-3.6 5.1 3.9z"/>' },
    x: { label: 'X', svg: '<path d="M4.5 4l15 16M19.5 4l-15 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' },
    youtube: { label: 'YouTube', svg: '<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10 9v6l5-3z" fill="#fff"/>' },
    discord: { label: 'Discord', svg: '<path d="M7 6.5c3-1.3 7-1.3 10 0l2.3 9.4c-2 2-4.300 3.100-7.300 3.100s-5.300-1.100-7.300-3.100z"/><circle cx="9.500" cy="12.500" r="1.400" fill="#fff"/><circle cx="14.500" cy="12.500" r="1.400" fill="#fff"/>' }
  };
  function renderSocial() {
    var out = '';
    Object.keys(SOC).forEach(function (k) {
      var url = site && site['social_' + k], ico = '<svg viewBox="0 0 24 24" aria-hidden="true">' + SOC[k].svg + '</svg>';
      out += url && /^https?:\/\//i.test(url) ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" aria-label="' + SOC[k].label + '">' + ico + '</a>' : '<span class="off" role="img" aria-label="' + SOC[k].label + ' (link not set)">' + ico + '</span>';
    });
    $('social').innerHTML = out;
  }
  renderSocial();

  /* ---------- product tour (Watch Demo) ---------- */
  var SLIDES = [
    { img: '/img/demo-dash.jpg', t: 'Your dashboard', c: 'Net P&L, equity curve, win rate, profit factor and drawdown, calculated from your trades.' },
    { img: '/img/demo-copy.jpg', t: 'Top traders leaderboard', c: 'Rank traders by return, win rate and drawdown, then copy them with one tap.' },
    { img: '/img/demo-follow.jpg', t: 'Copy trading control', c: 'Choose your account and position size, pause anytime, and see what each leader has earned you.' },
    { img: '/img/demo-analytics.jpg', t: 'Advanced analytics', c: 'See which hours, symbols and setups make money and which cost you.' },
    { img: '/img/demo-cal.jpg', t: 'Performance calendar', c: 'Every trading day and week at a glance, with a journal entry for each day.' },
    { img: '/img/demo-risk.jpg', t: 'Risk management', c: 'Size every trade before you take it and set daily limits you agree to in advance.' }
  ];
  var demo = $('demo'), di = 0, timer = null, prog = $('demo-prog'), lastFocus = null, STEP = 4500;
  $('demo-dots').innerHTML = SLIDES.map(function (_, i) { return '<button aria-label="Slide ' + (i + 1) + '" data-i="' + i + '"></button>'; }).join('');
  function show(i) {
    di = (i + SLIDES.length) % SLIDES.length; var s = SLIDES[di];
    $('demo-img').src = s.img; $('demo-img').alt = s.t; $('demo-title').textContent = s.t; $('demo-cap').textContent = s.c;
    Array.prototype.forEach.call($('demo-dots').children, function (d, k) { d.classList.toggle('on', k === di); });
    prog.style.transition = 'none'; prog.style.width = '0'; void prog.offsetWidth;
    clearTimeout(timer);
    if (!reduce) { prog.style.transition = 'width ' + STEP + 'ms linear'; prog.style.width = '100%'; timer = setTimeout(function () { show(di + 1); }, STEP); }
  }
  function openDemo() { lastFocus = document.activeElement; demo.hidden = false; document.body.style.overflow = 'hidden'; show(0); $('demo-x').focus(); }
  function closeDemo() { demo.hidden = true; clearTimeout(timer); document.body.style.overflow = ''; if (lastFocus) lastFocus.focus(); }
  $('demo-open').addEventListener('click', openDemo); $('demo-open2').addEventListener('click', openDemo);
  $('demo-x').addEventListener('click', closeDemo);
  demo.addEventListener('click', function (e) { if (e.target === demo) closeDemo(); });
  $('demo-prev').addEventListener('click', function () { show(di - 1); }); $('demo-next').addEventListener('click', function () { show(di + 1); });
  $('demo-dots').addEventListener('click', function (e) { var i = e.target.dataset && e.target.dataset.i; if (i != null) show(Number(i)); });
  document.addEventListener('keydown', function (e) { if (demo.hidden) return; if (e.key === 'Escape') closeDemo(); if (e.key === 'ArrowRight') show(di + 1); if (e.key === 'ArrowLeft') show(di - 1); });

  /* ---------- contact form ---------- */
  $('contact-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, err = $('c-err'), btn = $('c-send'), data = {};
    Array.prototype.forEach.call(f.elements, function (el) { if (el.name) data[el.name] = el.value; });
    err.hidden = true;
    var fail = function (m) { err.textContent = m; err.hidden = false; };
    if (!data.name.trim()) return fail('Enter your name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email.trim())) return fail('Enter a valid email address');
    if (data.message.trim().length < 10) return fail('Please write a little more so we can help');
    btn.disabled = true; btn.textContent = 'Sending…';
    fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'jpx' }, body: JSON.stringify(data) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Could not send your message'); }); })
      .then(function () { f.innerHTML = '<div class="ok"><h3>Message sent</h3><p>Thanks, we will reply to ' + esc(data.email) + ' soon.</p></div>'; })
      .catch(function (er) { btn.disabled = false; btn.textContent = 'Send message'; fail(er.message === 'Failed to fetch' ? 'Cannot reach the server. Check your connection and try again.' : er.message); });
  });
})();
