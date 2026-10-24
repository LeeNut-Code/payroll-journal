# Payroll Journal · 工资手账

A hand-journal-styled visualizer for a monthly salary. Edit your pay items, watch the take-home
number update live, and see the result printed as a ruled-paper journal page with washi tape,
stamps, sticker chips, a savings jar and a mood sticker.

**English** · [简体中文](README.zh-CN.md)

Built as an installable, offline-capable PWA on **Cloudflare Workers** (static assets plus a small
KV-backed share API). No framework, no bundler, no runtime dependencies.

> **Live demo:** https://payroll-journal.leenut.dpdns.org

## Features

- **Editable pay items** — 1–12 line items, live gross total, add/remove at will.
- **Take-home math** — 五险一金 (pension, medical, unemployment, housing fund) and monthly
  tax-table estimate, with quick-deduction brackets. Reference case: gross ¥15,500 at a 12%
  housing-fund rate → take-home **¥11,519**, tax ¥491, effective tax burden 3.2%.
- **Journal page rendering** — four sticker chips, a composition bar, a savings jar, a mood
  sticker and a handwritten note, laid out as ruled paper with washi tape and a date stamp.
- **Four paper palettes** — cream, sakura, retro, mint; switching never shifts the layout.
- **CSV import / export** — `类型,名称,值` columns, UTF-8 BOM + CRLF, so the data opens cleanly in
  Excel / Numbers / LibreOffice. Import is clamped and capped at 12 items.
- **Download as PDF** — the page is drawn to an A4 canvas and wrapped in a minimal, self-contained
  PDF, then downloaded by the browser. No print dialog, no PDF library.
- **Share link** — publish the current configuration to KV and get a short `/s/K7F2QX` link
  (valid for 7 days, read-only view with a "copy into my journal" fork button).
- **Installable PWA** — manifest + service worker, offline shell, network-first navigation,
  and the API is never cached.
- **Local-first** — state lives in `localStorage`; no accounts, no analytics, no tracking.

## Tech stack

| Layer | Choice |
|---|---|
| Client | Vanilla ES modules (`index.html` → `styles.css` → `app.js`), CSS design tokens |
| Worker | Single module `src/index.js`, hand-rolled router, no framework |
| Storage | Cloudflare KV (`JOURNAL_KV`), 7-day TTL per share code |
| PWA | `public/sw.js` shell precache, offline fallback |
| Tooling | Node 26 + `wrangler` 4.x, no runtime npm dependencies |

## Quick start

```bash
git clone https://github.com/LeeNut-Code/payroll-journal.git
cd payroll-journal
npm install

# 1. create the KV namespace and paste the returned id into wrangler.jsonc
cf kv namespaces create --title JOURNAL_KV

# 2. run locally: Worker + assets + local KV
npm run dev            # http://localhost:8787
```

`?new=1` opens a fresh journal without touching stored data.

If your installed `wrangler` predates the configured `compatibility_date`, pass an older date for
local runs only, e.g. `npx wrangler dev --compatibility-date 2026-09-10`.

### Verify the API without a browser

```bash
curl -sX POST localhost:8787/api/share -H 'content-type: application/json' \
  -d '{"state":{"items":[{"name":"底薪","amount":15500}],"fundRate":12,"special":0,"cost":4000,"goal":3000,"mood":0,"notes":"","theme":"cream"}}'
```

## Deploy

The project is deployed with the **Cloudflare CLI (`cf`)** and wired to **Cloudflare Workers
Builds**, so every push to `main` is built and deployed from GitHub.

```bash
cf auth login --device        # headless-friendly device authorization
npm run deploy                # cf deploy (local build → Workers)
```

`cloudflare.config.ts` declares the Worker entrypoint, the SPA asset routing and the
`JOURNAL_KV` binding; `wrangler.config.ts` keeps the `public/` assets directory for the build.
The GitHub build trigger is already registered for the `main` branch — check runs with:

```bash
cf builds create <trigger-uuid> --branch main   # optional manual build
cf builds get <build-uuid>
cf builds logs get <build-uuid>
```

The Worker serves the shell from `public/` and routes `/api/*` to the KV-backed API. Production is
published on the custom domain `payroll-journal.leenut.dpdns.org` (declared under `worker.domains`);
the default `workers.dev` route is disabled.

## API

`POST /api/share` — body `{"state": {...}}` (≤ 4 KB, whitelisted keys, clamped values).

```json
200 {"code":"K7F2QX","path":"/s/K7F2QX"}
400 {"error":"invalid_state"}   413 {"error":"too_large"}   500 {"error":"kv_unavailable"}
```

`GET /api/share/:code` → `200 {"state":{...}}` · `404 {"error":"not_found"}` (unknown or expired,
undifferentiated). All API responses carry `Cache-Control: no-store`.

`GET /s/:code` is not an API route: the SPA fallback returns `index.html`, and `app.js` fetches
`/api/share/<code>` and enters read-only mode.

Share codes are 8 characters of Crockford base32, stored as KV key `share:<CODE>`, value
`{"v":1,"state":{...}}`, TTL 604800 s.

## Calculation

```
gross   = Σ items[].amount
fee     = gross × (8% pension + 2% medical + 0.5% unemployment + fundRate%) + 3
taxable = max(0, gross − fee − 5000 − special)
tax     = monthly bracket table(taxable)
net     = gross − fee − tax
```

| Taxable income ≤ | Rate | Quick deduction |
|---|---|---|
| 3,000 | 3% | 0 |
| 12,000 | 10% | 210 |
| 25,000 | 20% | 1,410 |
| 35,000 | 25% | 2,660 |
| 55,000 | 30% | 4,410 |
| 80,000 | 35% | 7,160 |
| ∞ | 45% | 15,160 |

This is a **single-month estimate**, not the cumulative withholding model: the insurance base is
the pre-tax salary (no social-average cap/floor), and bonuses or mid-year raises are not modelled.
The UI says so in the footer.

## Project layout

| Path | Purpose |
|---|---|
| `wrangler.jsonc` | Worker name, static-assets binding, KV binding |
| `src/index.js` | Worker entry: share API + asset delegation |
| `public/index.html` | App shell and markup |
| `public/styles.css` | Sticker-style design system and print rules |
| `public/app.js` | State, tax math, rendering, PDF, CSV, persistence, share |
| `public/sw.js` | Service worker: shell precache and cache versioning |
| `public/manifest.webmanifest` | PWA manifest |
| `public/icons/` | App icons (192 / 512 / maskable) |
| `public/_headers` | CSP and cache policy |
| `AGENTS.md` | Contributor and architecture guidelines |

`state` is the single source of truth; `paint()` is the only writer of derived values, and
`render*()` rebuilds DOM only on structural changes.

## Data & privacy

All inputs stay in `localStorage["payroll-journal-v1"]` on your device. Sharing is opt-in and
creates one KV entry containing the same state object; it expires after 7 days. No accounts, no
analytics, no server-side logging of payloads.

## License

Released under the [GNU General Public License v3.0](LICENSE) (`GPL-3.0-only`).
