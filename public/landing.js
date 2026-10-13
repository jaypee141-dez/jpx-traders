(function () {
  'use strict';
  var P = window.JPXCalc.PRESETS, $ = function (id) { return document.getElementById(id); };
  var sel = $('k-preset');
  sel.innerHTML = Object.keys(P).map(function (k) { return '<option value="' + k + '">' + P[k].label + '</option>'; }).join('');
  var SAMPLES = { fx_usd: [1.085, 1.082, 1.091], fx_jpy: [150, 149.5, 151], gold: [2900, 2890, 2925], index: [18000, 17950, 18120], custom: [100, 95, 110] };
  var ids = ['k-bal', 'k-risk', 'k-entry', 'k-stop', 'k-target', 'k-cs'];
  var esc = function (s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); };
  var fm = function (n) { return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }); };
  function run() {
    var v = {}; ids.forEach(function (i) { v[i] = $(i).value; });
    $('k-cs-wrap').hidden = sel.value !== 'custom';
    var r = window.JPXCalc.size({ preset: sel.value, balance: v['k-bal'], riskPct: v['k-risk'], entry: v['k-entry'], stop: v['k-stop'], target: v['k-target'], contract: v['k-cs'] });
    var out = $('k-out');
    if (!r.ok) { out.innerHTML = '<div class="muted" style="grid-column:1/-1;padding:16px;background:var(--surface-2);border-radius:12px">' + esc(r.error) + '</div>'; return; }
    out.innerHTML = '<div class="big-out"><div class="k">Position size</div><div class="v num">' + (Math.round(r.lots * 100) / 100).toLocaleString('en-US') + ' lots</div></div>' +
      '<div><div class="k">Amount at risk</div><div class="v2 num neg">' + fm(r.riskAmount) + '</div></div><div><div class="k">Direction</div><div class="v2">' + (r.direction === 'long' ? 'Long' : 'Short') + '</div></div>' +
      (r.reward != null ? '<div><div class="k">Potential reward</div><div class="v2 num pos">' + fm(r.reward) + '</div></div><div><div class="k">Reward to risk</div><div class="v2 num">' + r.rr.toFixed(2) + ' : 1</div></div>' : '');
  }
  sel.addEventListener('change', function () { var s = SAMPLES[sel.value]; $('k-entry').value = s[0]; $('k-stop').value = s[1]; $('k-target').value = s[2]; run(); });
  ids.forEach(function (i) { $(i).addEventListener('input', run); });
  run();
})();
