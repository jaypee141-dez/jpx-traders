# JPX Traders

Trading journal SaaS: landing page, auth, dashboard, trades, journal, calendar, analytics, risk tools,
broker/MT5 sync, and an admin panel. Zero npm dependencies (Node 22.5+, built-in SQLite).

## Run
    node --no-warnings server.js          # http://localhost:3000
    PORT=8080 ADMIN_EMAIL=you@x.com node --no-warnings server.js

The admin is jpee49275@gmail.com: register with that email and the account is admin automatically (override with ADMIN_EMAIL). Website text, the hero traders number and the social links are edited in Admin > Website settings.

| Env var | Purpose |
|---|---|
| PORT / HOST | listen address (default 3000 / 0.0.0.0) |
| JPX_DATA_DIR / JPX_DB | where the SQLite file lives (back this up) |
| REGISTRATION=closed | disable public sign-up |
| COOKIE_SECURE=1 | force Secure cookies (also auto when X-Forwarded-Proto=https) |
| TRUST_PROXY=1 | use X-Forwarded-For for rate limiting behind a reverse proxy |

**Deploy behind HTTPS** (Caddy/nginx/Cloudflare). Run on a host with a persistent disk.

## MT5 live sync
Brokers page > Connect MT5 > generate key, install `public/jpx-sync.mq5`, allow the server URL in
MetaTrader (Tools > Options > Expert Advisors), attach to a chart. Endpoint: `POST /api/ingest`
with `X-API-Key`, body `{ "trades": [{ external_id, symbol, side, volume, open_time, close_time, profit, commission, swap, ... }] }`
(times: epoch seconds UTC or ISO). Upserts by `external_id`.

## Plans, billing and copy trading
Plans (Starter $19, Pro $49, Elite $99 per month; 14-day Pro trial for new users) live in `lib/plans.js` and are enforced by the API.
Online payments use Stripe and are off until you set:

| Env var | Purpose |
|---|---|
| STRIPE_SECRET_KEY | Stripe secret key |
| STRIPE_PRICES | JSON, e.g. `{"starter":{"month":"price_..","year":"price_.."},"pro":{...},"elite":{...}}` |
| STRIPE_WEBHOOK_SECRET | signing secret for `POST /api/stripe/webhook` (events: checkout.session.completed, customer.subscription.updated/deleted) |
| PUBLIC_URL | your site origin, used for checkout return links |

Until then admins can assign plans in Admin > user. Copy trading: leaders publish from Copy trading > My strategy; followers
mirror trades into their journal (ratio or fixed multiplier). For real execution at the broker run `public/jpx-copy.mq5`
(practice mode by default). Landing page content (sample reviews, social links) is in `public/content.json`.

## Landing page
Light, glassy design with smooth scrolling (eased anchor scrolling, scroll progress bar, reveal-on-scroll, parallax).
Product screenshots live in `public/img/` and show sample data.

## Landing page content
Edit `public/content.json` to change pricing plans and testimonials. Testimonials marked `"sample": true`
show a "Sample" tag; replace them with real reviews and remove that flag. Contact form messages are
stored in the database and appear in the Admin page. Payments are not implemented: plan limits are not enforced.

## Tests
    node --no-warnings tools/test-api.js                 # 68 API/security/analytics checks
    node --no-warnings tools/test-extra.js               # 74 copy-trading / plans / billing / support / API checks
    BASE=http://127.0.0.1:PORT python3 tools/ui-test.py  # Playwright, needs a running server + /tmp/seed.csv
