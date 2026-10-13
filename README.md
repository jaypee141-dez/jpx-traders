# JPX Traders

Trading journal SaaS: landing page, auth, dashboard, trades, journal, calendar, analytics, risk tools,
broker/MT5 sync, and an admin panel. Zero npm dependencies (Node 22.5+, built-in SQLite).

## Run
    node --no-warnings server.js          # http://localhost:3000
    PORT=8080 ADMIN_EMAIL=you@x.com node --no-warnings server.js

The first account to register becomes admin (or the email in ADMIN_EMAIL).

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

## Tests
    node --no-warnings tools/test-api.js                 # 62 API/security/analytics checks
    BASE=http://127.0.0.1:PORT python3 tools/ui-test.py  # Playwright, needs a running server + /tmp/seed.csv
