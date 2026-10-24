# Repository Guidelines

## Project Overview

**工资手账 / Payroll Journal** — a single-page, sticker-style (手账贴纸风) visualizer for a monthly
salary. The user edits salary line items, insurance rates and deductions; the page recomputes
take-home pay live and renders the result as a paper journal page: washi tape, stamps, sticker
chips, a 12-month sticker wall, a savings-jar progress bar, a mood sticker and a handwritten note.

All UI copy is **Chinese**. The project has **no backend, no build step, no dependencies, no
network calls** — it is one `index.html` that opens from the filesystem or any static host.

Origin: built for a 1-hour Trae offline hackathon; the prompt was
「用手账贴纸风的方式，做一个关于工资的（可自定义）」. Optimize for a demo that survives being
shown on a phone over a flaky hotspot.

## Architecture & Data Flow

Single file `index.html` with three inline sections: `<style>`, markup, `<script>` holding one
IIFE. Nothing else is loaded.

```
inputs (DOM events) ──▶ state (plain object) ──▶ paint() ──▶ DOM text/styles
                                    │
                                    └──▶ save() ──▶ localStorage["payroll-journal-v1"]
load() ──▶ state ──▶ renderItems()/renderMoods() ──▶ paint()      (boot)
```

- **`state`** is the single source of truth: `{items, fundRate, special, cost, goal, mood, notes, theme}`.
  Never read values back out of the DOM to recompute — read `state`.
- **`paint()`** is the only renderer of derived values. It reads `state`, calls `calcMonthly()`,
  and writes text/progress/`data-theme`. Every input handler ends with `paint(); save();`.
- **`calcMonthly(gross)`** is a pure function returning `{fee, tax, net, taxable}`. It must stay
  dependency-free and side-effect-free so the numbers can be unit-checked by hand.
- **`renderItems()` / `renderMoods()` / `renderYear()`** rebuild their container's innerHTML on
  structural change only (item added/removed, mood picked, month count). They are not called from
  `paint()`; `paint()` only writes values.
- **Persistence** is debounced-free but cheap: `save()` writes the whole state as JSON on every
  input event. `load()` merges saved keys over the defaults, so adding a new state key never
  breaks an existing stored payload.

## Calculation Contract (do not "improve" silently)

```
gross  = Σ items[].amount
fee    = gross × (8% 养老 + 2% 医疗 + 0.5% 失业 + fundRate%) + 3      # 3 = 大病医疗, fixed
taxable= max(0, gross − fee − 5000 − special)                          # 5000 = 起征点
tax    = 月度换算税率表(taxable)
net    = gross − fee − tax
```

Monthly-conversion bracket table (级距上限, 税率, 速算扣除数):

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
fee 3,491, tax 491, net 11,519, 税负率 3.2%. If a refactor changes these numbers, it is a bug.

Known simplifications — they are deliberate and must stay stated in the UI small print
(`按月度换算表估算，五险一金基数取税前工资，年终奖与调薪未计入`):
- single-month estimate, not 累计预扣 (cumulative withholding);
- insurance base = pre-tax salary (no 3× 社平工资 cap / floor);
- no 年终奖 separate taxation, no 专项附加扣除 month-by-month differences.

## Key Files

| Path | Purpose |
|---|---|
| `index.html` | The entire app: markup, design tokens, calculation, rendering, persistence |
| `AGENTS.md` | This file |
| `.gitignore` | Ignores editor/OS noise and local demo artifacts |

There is intentionally no `src/`, `dist/`, `package.json`, `node_modules/`, or test directory.
Do not introduce them: a build step would break the "email one file / drag one folder" deploy story.

## Development Commands

```bash
# Serve locally (any static server works; file:// also works)
python3 -m http.server 8199

# Deploy (pick one, no build output needed — upload the directory as-is)
npx wrangler pages deploy .          # Cloudflare Pages
# or drag this folder onto Netlify Drop
```

Deployment is checked **before** the last 10 minutes of any demo session; always keep one live
URL plus the local server as fallback.

## Code Conventions

- **Vanilla ES2017 in one IIFE** (`(function(){ "use strict"; … })()`). No modules, no bundler,
  no framework, no TypeScript.
- **DOM access through a `$` helper**; event listeners are attached once at boot, never inline
  `onclick` attributes (they break under CSP and are unreviewable).
- **Money formatting** goes through `money(n)` → `¥11,519`; the big take-home number uses
  `toLocaleString("zh-CN")`. Never format numbers ad hoc.
- **Numeric inputs** run through `num()` which coerces anything non-finite to `0`.
- **Themes** are CSS variables only. A new theme = one `html[data-theme="…"]` block overriding
  `--paper --ink --ink-soft --accent --accent2 --tape --line --hl`, plus a `.dot[data-t="…"]`
  swatch. Never branch theme logic in JS.
- **No external assets**: no CDN fonts, no image files, no icon packs. Stickers are emoji or CSS
  shapes; textures are `repeating-linear-gradient` or inline SVG data URIs. This is a hard rule —
  the demo may run offline.
- **Chinese UI text**, English identifiers and code comments.

## Design System (sticker style)

The look is carried by eight primitives; keep them consistent instead of adding new decoration:

| Primitive | Implementation |
|---|---|
| Ruled paper | `repeating-linear-gradient` horizontal lines (28px) + fainter vertical grid on `--paper` |
| Washi tape | absolutely-positioned strip + `mask-image` dashed gradient for torn edges, `rotate(±6deg)` |
| Journal holes | two circles with `inset` box-shadow at the top edge |
| Card tilt | `nth-child(odd) rotate(-.5deg)` / `even rotate(.45deg)` — the 0.5° is what sells "sticker" |
| Highlighter | `linear-gradient(transparent 62%, var(--hl) 62% 94%, transparent)` behind headings/numbers |
| Stamp | dashed border, `rotate(4deg)`, low opacity, uppercase Latin label + date |
| Sticker chip | white background, 1.5px border, **hard** `box-shadow: 2px 2px 0` (never blurred) |
| Handwriting type | `"LXGW WenKai","Kaiti SC",KaiTi,"Comic Sans MS",sans-serif` — system fonts only |

Palettes: cream `#e8956b`, sakura `#e88ba6`, retro `#c05a3e`, mint `#4fa88a`.
Responsive: single column below `820px`, sticker wall drops to 6 columns.

## State & Persistence Schema

`localStorage` key **`payroll-journal-v1`**, value = JSON of `state`:

```js
{
  items:   [{name: "底薪", amount: 12000}, …],  // ≥1 entry, user-editable
  fundRate: 12,        // 公积金 individual rate, 5–12 (%)
  special:  0,         // 专项附加扣除, CNY/month
  cost:     4000,      // 生活开销, CNY/month
  goal:     3000,      // 储蓄目标, CNY/month
  mood:     0,         // index into MOODS
  notes:    "",        // free text
  theme:    "cream"    // cream | sakura | retro | mint
}
```

Bump the key suffix only on an incompatible shape change; otherwise extend `load()` defaults.

## Testing & QA

No framework, no CI, no linter. Verification is a manual smoke pass (60 seconds):

1. Open the page → take-home, four sticker chips, 12 month cells, 8 mood buttons render.
2. Default data shows **gross ¥15,500 → net ¥11,519, tax ¥491, 税负率 3.2%**.
3. Drag 公积金 to 5% → fee/net/chips/bar all change; label updates.
4. Add an item (e.g. 加班费 2000) → gross and net rise; ✕ removes it (last row cannot be removed).
5. Switch theme → paper, accent and tape colors change, no layout shift.
6. Type a note, reload → note, items, theme and mood are restored.
7. 复制分享文案 → clipboard contains gross/net/fee/tax line; 打印 → only the journal page prints.
8. Narrow to 390px → no horizontal scroll, single column, take-home number still legible.

Highest-risk areas if this ever grows: the tax bracket loop (`taxable <= cap` ordering), the
`paint()`/`render*()` split (stale DOM after structural edits), and `load()` merging partial state.

## Do Not

- Add frameworks, bundlers, `package.json`, or any build/transpile step.
- Add external network requests, CDN links, web fonts, or image files.
- Add a backend, login, cloud sync, or analytics.
- Replace the tax table with a "more accurate" cumulative model during a demo build.
- Rename `payroll-journal-v1` or reformat the state shape without updating `load()`.
