'use strict';
// Minimal Stripe integration over HTTPS (no SDK). Active only when env vars are set.
const crypto = require('node:crypto');
const configured = () => !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICES);
function priceId(plan, interval) { try { return JSON.parse(process.env.STRIPE_PRICES)[plan][interval]; } catch { return null; } }
function planFromPrice(id) {
  try { const m = JSON.parse(process.env.STRIPE_PRICES); for (const p of Object.keys(m)) for (const i of Object.keys(m[p])) if (m[p][i] === id) return { plan: p, interval: i }; } catch { /* not configured */ }
  return null;
}
async function api(path, params) {
  const body = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v != null) body.append(k, v);
  const r = await fetch('https://api.stripe.com/v1/' + path, { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || 'Stripe request failed');
  return j;
}
/** Verify a Stripe-Signature header (v1 HMAC-SHA256 of `${t}.${rawBody}`) with a 5 minute tolerance. */
function verifySignature(raw, header, secret, now = Date.now()) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(String(header).split(',').map((p) => p.split('=')));
  const t = Number(parts.t); if (!t || Math.abs(now / 1000 - t) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return String(header).split(',').filter((p) => p.startsWith('v1=')).some((p) => { const v = p.slice(3); return v.length === expected.length && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(expected)); });
}
module.exports = { configured, priceId, planFromPrice, api, verifySignature };
