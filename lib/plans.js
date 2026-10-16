'use strict';
// Single source of truth for plans. Prices are shown on the landing page and enforced in the API.
const PLANS = {
  free: { key: 'free', name: 'Free', blurb: 'After your trial ends', price: { month: 0, year: 0 },
    limits: { accounts: 1, mt5: false, follow: 0, publish: false, api: false, advancedAnalytics: false, eliteStrategies: false, priority: false } },
  starter: { key: 'starter', name: 'Starter', blurb: 'Perfect for beginners', price: { month: 19, year: 190 },
    limits: { accounts: 2, mt5: true, follow: 1, publish: false, api: false, advancedAnalytics: false, eliteStrategies: false, priority: false },
    features: ['Basic copy trading', 'MT4/MT5 support', '24/7 support'] },
  pro: { key: 'pro', name: 'Pro', blurb: 'For serious traders', price: { month: 49, year: 490 }, featured: true,
    limits: { accounts: 5, mt5: true, follow: 5, publish: true, api: false, advancedAnalytics: true, eliteStrategies: false, priority: true },
    features: ['Advanced copy trading', 'MT4/MT5 full support', 'Trading journal (basic)', 'Advanced analytics', 'Priority support'] },
  elite: { key: 'elite', name: 'Elite', blurb: 'For professionals', price: { month: 99, year: 990 },
    limits: { accounts: 25, mt5: true, follow: 25, publish: true, api: true, advancedAnalytics: true, eliteStrategies: true, priority: true },
    features: ['Everything in Pro', 'Multi-account support', 'API access', 'Dedicated account manager', 'Exclusive strategies'] },
};
const TRIAL_DAYS = 14;

function effectivePlan(u) {
  if (u.plan_source === 'trial') return Date.parse(u.trial_ends_at) > Date.now() ? 'pro' : 'free';
  return PLANS[u.plan] ? u.plan : 'free';
}
function planInfo(u) {
  const key = effectivePlan(u), p = PLANS[key];
  return { key, name: p.name, limits: p.limits, source: u.plan_source, interval: u.plan_interval,
    trial_ends_at: u.plan_source === 'trial' ? u.trial_ends_at : null, trialing: u.plan_source === 'trial' && key === 'pro',
    account_manager: key === 'elite' ? u.account_manager : '' };
}
const publicPlans = () => Object.values(PLANS).filter((p) => p.key !== 'free').map(({ key, name, blurb, price, features, featured }) => ({ key, name, blurb, price, features, featured: !!featured }));
module.exports = { PLANS, TRIAL_DAYS, effectivePlan, planInfo, publicPlans };
