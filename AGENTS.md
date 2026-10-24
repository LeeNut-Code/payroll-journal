# Repository Guidelines

## Project Overview

**工资手账 / Payroll Journal** — a hand-journal-styled (手账贴纸风) visualizer for a monthly salary,
shipped as an installable, offline-capable **PWA hosted on Cloudflare Workers** (static assets +
one small KV-backed share API).

The user edits salary line items, insurance rates and deductions; the page recomputes take-home pay
live and renders the result as a paper journal page: washi tape, stamps, sticker chips, a 12-month
sticker wall, a savings-jar bar, a mood sticker and a handwritten note. Any configuration can be
published as a short link (`/s/K7F2QX`) so a friend opens the same journal page.

All UI copy is **Chinese**. Origin: a 1-hour Trae hackathon prompt
「用手账贴纸风的方式，做一个关于工资的（可自定义）」. Optimize for a demo that survives a phone on a
flaky hotspot — hence PWA install + offline shell are load-bearing, not decoration.

## Product Scope

| Tier | Included |
|---|---|
| Must | Line-item editing → gross; 五险一金 + 个税 → take-home; four sticker chips; composition bar; 12-month sticker wall; 4 palettes; `localStorage` persistence; installable PWA; offline shell |
| Should | Share link via KV (`POST /api/share` → `/s/<code>`); savings-jar goal; mood sticker + note; copy-summary; print-to-PDF stylesheet |
| Cut (do not build) | Accounts, login, server-side rendering, analytics, PNG-export libraries, push notifications, background sync, image uploads, i18n framework |

## Architecture & Data Flow

```
              ┌─────────────────────────── Cloudflare Worker (src/index.js) ───────────────┐
 Browser      │  /api/*        → JSON API → env.JOURNAL_KV  (key share:<CODE>, TTL 7d)     │
 ───────      │  everything else → env.ASSETS.fetch(request)  (public/, SPA fallback)     │
 public/      └────────────────────────────────────────────────────────────────────────────┘
 index.html ──▶ app.js: state ──▶ paint() ──▶ DOM
 styles.css      │  ├─▶ save() ──▶ localStorage["payroll-journal-v1"]
                 │  ├─▶ POST /api/share          (publish snapshot)
                 │  └─▶ GET  /api/share/<code>   (import snapshot)
 sw.js ──────────┘   shell precache · network-first navigation · network-only /api/*
```

- **Client** is dependency-free ES modules: `index.html` (markup + design tokens) → `styles.css`
  → `app.js` (`state`, `calcMonthly()`, `paint()`, `render*()`, persistence, share calls).
- **`state`** is the single source of truth; never read values back out of the DOM to recompute.
- **`paint()`** is the only writer of derived values. Every input handler ends `paint(); save();`.
- **`render*()`** (`renderItems`, `renderMoods`, `renderYear`) rebuild container HTML on structural
  change only; `paint()` never rebuilds DOM.
- **Worker** is a single module with a hand-rolled router in `fetch()`: `/api/share` (POST),
  `/api/share/:code` (GET), `/s/:code` and everything else → `env.ASSETS.fetch()`. No router
  library, no framework.
- **PWA** caches the shell only. `/api/*` is never cached — a stale share read is a worse bug than
  an offline share failure.

> Design change vs. the original single-file prototype: the app is now **four static files**
> (`index.html`, `styles.css`, `app.js`, `sw.js`) so the service worker can precache an explicit,
> cache-bustable list. Do not collapse them back into one inline `index.html` — SW precaching of an
> inline shell cannot be versioned independently of the HTML that registers it.

## Repository Layout

| Path | Purpose |
|---|---|
| `wrangler.jsonc` | Worker name, `main`, static-assets binding, KV binding, dev port |
| `package.json` | Scripts + `wrangler` devDependency only (no runtime deps) |
| `src/index.js` | Worker entry: `/api/share` API + asset delegation |
| `public/index.html` | App shell: markup, `<style>` tokens, manifest/SW registration |
| `public/styles.css` | All styling (design tokens, sticker primitives, print rules) |
| `public/app.js` | State, tax math, rendering, localStorage, share publish/import |
| `public/sw.js` | Service worker: shell precache + cache versioning |
| `public/manifest.webmanifest` | PWA manifest (**already authored — do not restyle icons**) |
| `public/icons/` | `icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (generated) |
| `public/_headers` | CSP, cache policy for shell/SW/icons |

## Runtime & Config

- **Node 26 + `wrangler` 4.129.0** (also installed globally). No other toolchain.
- `wrangler.jsonc` keys that matter:
  - `assets.run_worker_first: ["/api/*"]` — API hits the Worker before asset routing; everything
    else falls through to static assets with SPA fallback.
  - `assets.not_found_handling: "single-page-application"` — makes `/s/<code>` serve the shell.
  - `kv_namespaces[].binding: JOURNAL_KV` — **the `id` is a placeholder**; create it with
    `npm run kv:create` and paste the returned id.
  - `compatibility_date: 2026-10-01`, `observability.enabled: true` (use `wrangler tail` in demos).
- **Secrets**: none required. If one ever appears, use `wrangler secret put`; `.dev.vars` is
  gitignored and must never be committed.

## API Contract

`POST /api/share` — body `{"state": {...}}` (the exact client `state` object, ≤ 4 KB).

- Validates: JSON parses, `state` is a plain object, size ≤ 4 KB, keys whitelisted
  (`items fundRate special cost goal mood notes theme`), numbers clamped
  (`fundRate` 5–12, `special/cost/goal` ≥ 0 and ≤ 1e7, `items` 1–12 rows), `notes` ≤ 500 chars,
  `theme` ∈ 4 palettes.
- Returns `200 {"code":"K7F2QX","path":"/s/K7F2QX"}`.
- Errors: `400 {"error":"invalid_state"}` / `413 {"error":"too_large"}` /
  `500 {"error":"kv_unavailable"}`. All JSON via one `json(data, status)` helper.
- KV write: key **`share:<CODE>`**, value = stringified `{"v":1,"state":{...}}`,
  `expirationTtl: 604800` (7 days). `CODE` = 8 chars from Crockford base32
  (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`, ~2^40 space), generated from `crypto.randomUUID()`;
  retry up to 3× on collision.
- No auth by design (demo); an 8-char code is the capability. Never log the payload.

`GET /api/share/:code` — `200 {"state":{...}}` · `404 {"error":"not_found"}` (unknown *or* expired,
undifferentiated) · `Cache-Control: no-store` on every response.

`GET /s/:code` — not an API route: the SPA fallback returns `index.html`; `app.js` parses
`location.pathname`, fetches `/api/share/<code>`, then merges over defaults and enters read-only
"shared" banner state (user may "fork" it into their own localStorage).

## Calculation Contract (do not "improve" silently)

```
gross  = Σ items[].amount
fee    = gross × (8% 养老 + 2% 医疗 + 0.5% 失业 + fundRate%) + 3      # 3 = 大病医疗, fixed
taxable= max(0, gross − fee − 5000 − special)                          # 5000 = 起征点
tax    = 月度换算税率表(taxable)
net    = gross − fee − tax
```

| ≤ taxable | rate | quick deduction |
|---|---|---|
| 3,000 | 3% | 0 |
| 12,000 | 10% | 210 |
| 25,000 | 20% | 1,410 |
| 35,000 | 25% | 2,660 |
| 55,000 | 30% | 4,410 |
| 80,000 | 35% | 7,160 |
| ∞ | 45% | 15,160 |

**Reference case (must reproduce exactly):** gross 15,500, `fundRate` 12, `special` 0 →
fee 3,491, tax 491, net **11,519**, 税负率 3.2%. A refactor that changes these numbers is a bug.

Deliberate simplifications, and the UI must keep saying so
(`按月度换算表估算，五险一金基数取税前工资，年终奖与调薪未计入`):
single-month estimate rather than 累计预扣; insurance base = pre-tax salary (no 社平 cap/floor);
no 年终奖 separate taxation.

## Data & Persistence

Local key **`payroll-journal-v1`** (JSON of `state`):

```js
{
  items:   [{name: "底薪", amount: 12000}, …],  // 1–12 rows, user-editable
  fundRate: 12,        // 公积金 individual rate 5–12 (%)
  special:  0,         // 专项附加扣除, CNY/month
  cost:     4000,      // 生活开销, CNY/month
  goal:     3000,      // 储蓄目标, CNY/month
  mood:     0,         // index into MOODS
  notes:    "",        // free text, ≤500 chars
  theme:    "cream"    // cream | sakura | retro | mint
}
```

- `load()` merges stored keys over defaults so new keys never break old payloads.
- `?new=1` resets to defaults without touching storage until the user types.
- Share payload is the same object — one schema, two transports.
- Never put state in query strings (too long, breaks caching); only `/s/<code>`.

## PWA Requirements

- **Manifest** is already final (`public/manifest.webmanifest`): `display: standalone`,
  `theme_color #e8956b`, `background_color #fdf7ec`, 192/512 PNG + maskable 512 + SVG,
  one shortcut `/?new=1`. `index.html` must link it plus `theme-color`, `apple-touch-icon`,
  `apple-mobile-web-app-capable`.
- **`sw.js` rules**: `CACHE_VERSION` constant (bump on every deploy that changes the shell);
  `install` → precache `["/", "/index.html", "/styles.css", "/app.js", "/manifest.webmanifest",
  "/icons/icon-192.png", "/icons/icon-512.png"]` then `skipWaiting()`; `activate` → delete other
  cache names + `clients.claim()`; `fetch` → **network-first for navigations** (fallback to cached
  shell), **cache-first for same-origin static assets**, **`return` without `respondWith` for
  `/api/*`** (never cache API responses). Offline share/create must degrade to a toast, not a crash.
- Update flow: page listens for `controllerchange` → show "有新版本，点击刷新" sticker; never
  force-reload mid-edit.
- Registration: `navigator.serviceWorker.register("/sw.js")` guarded by `'serviceWorker' in
  navigator`, `type: "module"` not required.
- Out of scope: push, background sync, periodic sync, offline writes queue.

## Design System (sticker style)

Eight primitives carry the look; add no others:

| Primitive | Implementation |
|---|---|
| Ruled paper | `repeating-linear-gradient` 28px lines + fainter vertical grid on `--paper` |
| Washi tape | absolute strip + `mask-image` dashed gradient, `rotate(±6deg)` |
| Journal holes | two circles with `inset` box-shadow on the top edge |
| Card tilt | `nth-child(odd) rotate(-.5deg)` / `even rotate(.45deg)` |
| Highlighter | `linear-gradient(transparent 62%, var(--hl) 62% 94%, transparent)` |
| Stamp | dashed border, `rotate(4deg)`, uppercase Latin label + date |
| Sticker chip | white fill, 1.5px border, **hard** `box-shadow: 2px 2px 0` |
| Handwriting type | `"LXGW WenKai","Kaiti SC",KaiTi,"Comic Sans MS",sans-serif` (system only) |

Palettes via `html[data-theme]` overriding `--paper --ink --ink-soft --accent --accent2 --tape
--line --hl`: cream `#e8956b`, sakura `#e88ba6`, retro `#c05a3e`, mint `#4fa88a`.
Responsive: single column below `820px`, sticker wall 6 columns; safe-area insets for standalone.
Print stylesheet: hide buttons/themes/SW banner, keep the paper page, `@page { margin: 12mm }`.

## Code Conventions

- **Vanilla ES2020 modules**, no bundler, no framework, no TypeScript, no runtime npm deps.
- `app.js`: `$` DOM helper, `num()` coercion, `money()` → `¥11,519`, `calcMonthly()` pure,
  listeners attached once at boot (no inline `onclick` — CSP forbids them).
- `src/index.js`: `export default { async fetch(request, env) }`; hand-rolled path matching;
  every response through `json()`; never echo stack traces or KV errors to clients; keep the
  Worker under ~150 lines.
- **No external assets**: no CDN fonts, image files, or icon packs. Stickers are emoji or CSS
  shapes; textures are gradients or inline SVG data URIs. Offline demo is the reason.
- Chinese UI text, English identifiers/comments.

## Dev Commands

```bash
npm install                              # wrangler only
npm run kv:create                        # → paste the id into wrangler.jsonc
npm run dev                              # http://localhost:8787 (Worker + assets + KV local)
npm run deploy                           # → https://payroll-journal.<subdomain>.workers.dev
npm run tail                             # live logs during a demo

# verify the API without a browser
curl -sX POST localhost:8787/api/share -H 'content-type: application/json' \
     -d '{"state":{"items":[{"name":"底薪","amount":15500}],"fundRate":12,"special":0,"cost":4000,"goal":3000,"mood":0,"notes":"","theme":"cream"}}'
```

Deploy early: run `npm run deploy` once before writing UI so a live URL exists as a fallback.

## Testing & QA

No framework, no CI, no linter. Manual smoke pass (90 seconds, in this order):

1. `npm run dev` → take-home, 4 chips, 12 month cells, 8 mood buttons render.
2. Default data shows **gross ¥15,500 → net ¥11,519, tax ¥491, 税负率 3.2%**.
3. Drag 公积金 to 5% → fee/net/chips/bar update; label follows.
4. Add an item (加班费 2000) → gross/net rise; ✕ removes it (last row cannot be removed).
5. Theme switch → paper/accent/tape change, no layout shift.
6. Note + reload → note, items, theme, mood restored (DevTools → Application → Local Storage).
7. **Share round-trip**: 分享 → copy code → open `/s/<code>` in a private window → identical numbers.
8. **Offline**: DevTools → Network → Offline → reload → shell loads from cache; share shows a toast,
   never a white screen.
9. **Install**: manifest parses (Application → Manifest, no icon warnings), install prompt appears,
   standalone window keeps the journal layout.
10. `wrangler tail` while hitting `/api/share` → one request, no KV error; expired key returns 404.
11. 390px width → no horizontal scroll; print preview → only the paper page.

Highest-risk areas for regressions: tax bracket loop ordering (`taxable <= cap`), the
`paint()` / `render*()` split (stale DOM after structural edits), SW cache version drift
(users stuck on an old shell), and KV validation drift between client and Worker.

## Do Not

- Add frameworks, bundlers, TypeScript, or any npm **runtime** dependency.
- Add external network requests, CDN links, web fonts, or image files.
- Cache `/api/*` responses in the service worker, or precache a share payload.
- Store state or share codes in query strings, or log payloads server-side.
- Commit KV ids, `.dev.vars`, or account ids.
- Add auth/accounts/analytics during a demo build, or swap the tax model to 累计预扣 mid-event.
- Recolor or regenerate `public/icons/*` (manifest sizes/purposes are already verified).
