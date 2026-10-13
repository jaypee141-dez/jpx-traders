/* Small SVG chart kit: area/line with crosshair, vertical bars, horizontal bars, ring.
   Every chart re-renders on container resize and reads colours from CSS variables. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var css = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  function niceTicks(min, max, count) {
    if (min === max) { max = min + 1; min = min - 1; }
    var span = max - min, step = Math.pow(10, Math.floor(Math.log10(span / count)));
    var err = (count * step) / span;
    if (err <= 0.15) step *= 10; else if (err <= 0.35) step *= 5; else if (err <= 0.75) step *= 2;
    var lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, t = [];
    for (var v = lo; v <= hi + step / 2; v += step) t.push(Math.round(v / step) * step);
    return t;
  }
  function compact(n) {
    var a = Math.abs(n), s = n < 0 ? '-' : '', t = function (x, d) { return String(parseFloat(x.toFixed(d))); };
    if (a >= 1e6) return s + t(a / 1e6, 2) + 'M';
    if (a >= 1e3) return s + t(a / 1e3, 2) + 'k';
    return s + t(a, 2);
  }

  function mount(el, draw) {
    if (el._ro) el._ro.disconnect();
    el.classList.add('chart');
    var render = function () {
      var w = el.clientWidth, h = el.clientHeight;
      if (w < 10 || h < 10) return;
      draw(w, h);
    };
    el._ro = new ResizeObserver(function () { cancelAnimationFrame(el._raf); el._raf = requestAnimationFrame(render); });
    el._ro.observe(el);
    render();
  }

  function tooltip(el) {
    var tip = el.querySelector('.chart-tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; el.appendChild(tip); }
    return tip;
  }
  function placeTip(el, tip, x, y, html) {
    tip.innerHTML = html; tip.style.opacity = 1;
    var tw = tip.offsetWidth, w = el.clientWidth;
    var left = Math.min(Math.max(x - tw / 2, 4), w - tw - 4);
    tip.style.left = left + 'px'; tip.style.top = Math.max(y - tip.offsetHeight - 12, 0) + 'px';
  }

  /** points: [{x: label/Date, y: number, label?: string}] */
  function area(el, points, o) {
    o = o || {};
    var fmt = o.format || compact;
    if (!points.length) { el.innerHTML = '<div class="chart-empty">' + esc(o.empty || 'No data yet') + '</div>'; return; }
    mount(el, function (w, h) {
      var pad = { l: 46, r: 12, t: 10, b: 22 }, iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
      var ys = points.map(function (p) { return p.y; });
      var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys);
      if (o.zero !== false) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
      var ticks = niceTicks(lo, hi, Math.max(2, Math.floor(ih / 44)));
      var y0 = ticks[0], y1 = ticks[ticks.length - 1];
      var X = function (i) { return pad.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw); };
      var Y = function (v) { return pad.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih; };
      var up = points[points.length - 1].y >= points[0].y;
      var col = o.color || (o.neutral ? css('--accent') : (up ? css('--profit') : css('--loss')));
      var d = points.map(function (p, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.y).toFixed(1); }).join('');
      var base = Y(Math.max(y0, Math.min(0, y1)));
      var fillD = d + 'L' + X(points.length - 1).toFixed(1) + ' ' + base + 'L' + X(0).toFixed(1) + ' ' + base + 'Z';
      var id = 'g' + Math.random().toString(36).slice(2, 8);
      var grid = ticks.map(function (t) {
        return '<line x1="' + pad.l + '" x2="' + (w - pad.r) + '" y1="' + Y(t) + '" y2="' + Y(t) + '" class="' + (t === 0 ? 'ax-zero' : 'ax-grid') + '"/><text x="' + (pad.l - 8) + '" y="' + (Y(t) + 4) + '" text-anchor="end" class="ax-text">' + esc(fmt(t)) + '</text>';
      }).join('');
      var nx = Math.min(points.length, Math.max(2, Math.floor(iw / 90))), xl = '';
      for (var k = 0; k < nx; k++) {
        var i = nx === 1 ? 0 : Math.round((k / (nx - 1)) * (points.length - 1));
        xl += '<text x="' + X(i) + '" y="' + (h - 5) + '" text-anchor="' + (k === 0 ? 'start' : k === nx - 1 ? 'end' : 'middle') + '" class="ax-text">' + esc(points[i].tick || points[i].label || '') + '</text>';
      }
      el.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img" aria-label="' + esc(o.label || 'Chart') + '">' +
        '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + col + '" stop-opacity=".22"/><stop offset="1" stop-color="' + col + '" stop-opacity="0"/></linearGradient></defs>' +
        grid + xl + '<path d="' + fillD + '" fill="url(#' + id + ')"/><path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<line class="xhair" y1="' + pad.t + '" y2="' + (h - pad.b) + '" style="opacity:0"/><circle class="dot" r="4.5" fill="' + col + '" stroke="' + css('--surface') + '" stroke-width="2" style="opacity:0"/></svg>';
      var svg = el.querySelector('svg'), xh = svg.querySelector('.xhair'), dot = svg.querySelector('.dot'), tip = tooltip(el);
      var move = function (ev) {
        var r = svg.getBoundingClientRect(), cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
        var i = Math.round(((cx - pad.l) / (iw || 1)) * (points.length - 1));
        i = Math.max(0, Math.min(points.length - 1, i));
        var p = points[i];
        xh.setAttribute('x1', X(i)); xh.setAttribute('x2', X(i)); xh.style.opacity = 1;
        dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(p.y)); dot.style.opacity = 1;
        placeTip(el, tip, X(i), Y(p.y), '<b>' + esc(o.tipValue ? o.tipValue(p) : fmt(p.y)) + '</b><span>' + esc(p.label || '') + '</span>');
      };
      var leave = function () { xh.style.opacity = 0; dot.style.opacity = 0; tip.style.opacity = 0; };
      svg.addEventListener('mousemove', move); svg.addEventListener('touchmove', move, { passive: true }); svg.addEventListener('touchstart', move, { passive: true });
      svg.addEventListener('mouseleave', leave); svg.addEventListener('touchend', leave);
    });
  }

  /** items: [{label, value, sub?}] — positive = profit colour, negative = loss colour */
  function bars(el, items, o) {
    o = o || {};
    var fmt = o.format || compact;
    if (!items.length) { el.innerHTML = '<div class="chart-empty">' + esc(o.empty || 'No data yet') + '</div>'; return; }
    mount(el, function (w, h) {
      var pad = { l: 46, r: 8, t: 10, b: 22 }, iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
      var vals = items.map(function (d) { return d.value; });
      var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(0, Math.max.apply(null, vals));
      var ticks = niceTicks(lo, hi, Math.max(2, Math.floor(ih / 44)));
      var y0 = ticks[0], y1 = ticks[ticks.length - 1];
      var Y = function (v) { return pad.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih; };
      var slot = iw / items.length, bw = Math.max(2, Math.min(36, slot * 0.62));
      var grid = ticks.map(function (t) { return '<line x1="' + pad.l + '" x2="' + (w - pad.r) + '" y1="' + Y(t) + '" y2="' + Y(t) + '" class="' + (t === 0 ? 'ax-zero' : 'ax-grid') + '"/><text x="' + (pad.l - 8) + '" y="' + (Y(t) + 4) + '" text-anchor="end" class="ax-text">' + esc(fmt(t)) + '</text>'; }).join('');
      var every = Math.ceil(items.length / Math.max(1, Math.floor(iw / 38)));
      var rects = '', labels = '';
      items.forEach(function (d, i) {
        var x = pad.l + slot * i + (slot - bw) / 2, yv = Y(d.value), yz = Y(0);
        var top = Math.min(yv, yz), hgt = Math.max(1.5, Math.abs(yv - yz));
        var c = d.value > 0 ? 'var(--profit)' : d.value < 0 ? 'var(--loss)' : 'var(--line-strong)';
        rects += '<rect class="bar" data-i="' + i + '" x="' + x.toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hgt.toFixed(1) + '" rx="3" fill="' + c + '"/>';
        if (i % every === 0) labels += '<text x="' + (x + bw / 2) + '" y="' + (h - 5) + '" text-anchor="middle" class="ax-text">' + esc(d.label) + '</text>';
      });
      el.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img" aria-label="' + esc(o.label || 'Chart') + '">' + grid + rects + labels + '</svg>';
      var tip = tooltip(el);
      el.querySelectorAll('.bar').forEach(function (r) {
        var show = function () { var d = items[+r.dataset.i]; var x = +r.getAttribute('x') + bw / 2; placeTip(el, tip, x, +r.getAttribute('y'), '<b>' + esc(d.tip || fmt(d.value)) + '</b><span>' + esc(d.sub || d.label) + '</span>'); };
        r.addEventListener('mouseenter', show); r.addEventListener('touchstart', show, { passive: true });
        r.addEventListener('mouseleave', function () { tip.style.opacity = 0; });
      });
    });
  }

  /** Horizontal ranked bars rendered as HTML for crisp text: items [{label, value, sub}] */
  function hbars(el, items, o) {
    o = o || {};
    var fmt = o.format || compact;
    if (!items.length) { el.innerHTML = '<div class="chart-empty">' + esc(o.empty || 'No data yet') + '</div>'; return; }
    var max = Math.max.apply(null, items.map(function (d) { return Math.abs(d.value); })) || 1;
    el.classList.remove('chart');
    el.innerHTML = '<ul class="hbars">' + items.map(function (d) {
      var pct = Math.max(2, (Math.abs(d.value) / max) * 100), cls = d.value > 0 ? 'pos' : d.value < 0 ? 'neg' : '';
      return '<li><div class="hb-head"><span class="hb-label">' + esc(d.label) + '</span><span class="hb-val num ' + cls + '">' + esc(d.text || fmt(d.value)) + '</span></div>' +
        '<div class="hb-track"><div class="hb-fill ' + cls + '" style="width:' + pct.toFixed(1) + '%"></div></div>' + (d.sub ? '<div class="hb-sub">' + esc(d.sub) + '</div>' : '') + '</li>';
    }).join('') + '</ul>';
  }

  /** Ring gauge: value 0..100 */
  function ring(el, value, o) {
    o = o || {};
    var size = o.size || 72, sw = o.stroke || 8, r = (size - sw) / 2, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, value));
    el.innerHTML = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="' + esc(o.label || 'Gauge') + '"><circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--loss-soft)" stroke-width="' + sw + '"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--profit)" stroke-width="' + sw + '" stroke-linecap="round" stroke-dasharray="' + (c * v / 100).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/></svg>';
  }

  window.JPXCharts = { area: area, bars: bars, hbars: hbars, ring: ring, compact: compact };
})();
