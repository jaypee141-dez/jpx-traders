/* Position size calculator. Assumes the account currency is the quote currency of the
   instrument unless noted. Pure functions so they can be unit-tested in Node. */
(function (root) {
  'use strict';
  var PRESETS = {
    fx_usd: { label: 'Forex, USD quote (EURUSD, GBPUSD)', contract: 100000, jpy: false },
    fx_jpy: { label: 'Forex, JPY quote (USDJPY, EURJPY)', contract: 100000, jpy: true },
    gold: { label: 'Gold (XAUUSD), 100 oz per lot', contract: 100, jpy: false },
    index: { label: 'Index / CFD, $1 per point per lot', contract: 1, jpy: false },
    custom: { label: 'Custom contract size', contract: null, jpy: false },
  };

  /**
   * input: { balance, riskPct, entry, stop, target?, preset, contract? }
   * returns { ok, error } or { ok, riskAmount, distance, lots, units, reward?, rr?, perPointPerLot }
   */
  function size(input) {
    var p = PRESETS[input.preset] || PRESETS.fx_usd;
    var balance = Number(input.balance), riskPct = Number(input.riskPct);
    var entry = Number(input.entry), stop = Number(input.stop);
    var contract = p.contract == null ? Number(input.contract) : p.contract;
    if (!(balance > 0)) return { ok: false, error: 'Enter your account balance' };
    if (!(riskPct > 0) || riskPct > 100) return { ok: false, error: 'Risk must be between 0 and 100%' };
    if (!(entry > 0) || !(stop > 0)) return { ok: false, error: 'Enter entry and stop prices' };
    if (entry === stop) return { ok: false, error: 'Stop must differ from entry' };
    if (!(contract > 0)) return { ok: false, error: 'Enter a contract size' };
    var riskAmount = balance * riskPct / 100;
    var distance = Math.abs(entry - stop);
    // Value of a 1.0 price move for one lot, in account currency
    var perPointPerLot = contract * (p.jpy ? 1 / entry : 1);
    var lots = riskAmount / (distance * perPointPerLot);
    var out = { ok: true, riskAmount: riskAmount, distance: distance, lots: lots, units: lots * contract, perPointPerLot: perPointPerLot, direction: stop < entry ? 'long' : 'short' };
    var target = Number(input.target);
    if (target > 0) {
      var good = out.direction === 'long' ? target > entry : target < entry;
      if (!good) return { ok: false, error: 'Target must be on the profit side of your entry' };
      var tdist = Math.abs(target - entry);
      out.reward = lots * tdist * perPointPerLot;
      out.rr = tdist / distance;
    }
    return out;
  }
  var api = { PRESETS: PRESETS, size: size };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.JPXCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
