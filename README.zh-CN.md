# 工资手账 · Payroll Journal

把手账贴纸风用在工资上：逐项填写工资条目，实时看到到手金额，并把结果排成一页带横线纸、
和纸胶带、日期印章、贴纸 chip、储蓄罐和心情贴纸的手账。

[English](README.md) · **简体中文**

这是一个可安装、可离线的 PWA，部署在 **Cloudflare Workers**（静态资源 + 一个很小的 KV 分享
API）。没有框架、没有打包器、没有运行时依赖。

> **在线演示：** https://payroll-journal.leenut.workers.dev

## 功能

- **可编辑工资条目** — 1–12 条，实时合计税前工资，可增删。
- **到手计算** — 五险一金（养老、医疗、失业、公积金）+ 月度个税换算表与速算扣除数。
  参考用例：税前 ¥15,500、公积金 12% → 到手 **¥11,519**，个税 ¥491，税负率 3.2%。
- **手账页渲染** — 四张贴纸 chip、构成条、储蓄罐、心情贴纸和手写备注，横线纸 + 和纸胶带 +
  日期印章的版式。
- **四套纸张配色** — 奶油、樱花、复古、薄荷；切换不产生布局跳动。
- **CSV 导入 / 导出** — `类型,名称,值` 三列，UTF-8 BOM + CRLF，Excel / Numbers / LibreOffice
  都能直接打开。导入时会做取值钳制，最多 12 条。
- **下载 PDF** — 把整页手账画到 A4 canvas，再封装成不依赖任何库的单页 PDF，由浏览器直接下载；
  不弹系统打印框。
- **分享链接** — 把当前配置写入 KV，得到 `/s/K7F2QX` 短链（7 天有效，只读浏览，可「抄进我的
  手账」）。
- **可安装 PWA** — manifest + Service Worker，离线壳，导航 network-first，API 永不缓存。
- **本地优先** — 数据存在 `localStorage`，没有账号、没有统计、没有埋点。

## 技术栈

| 层 | 选型 |
|---|---|
| 客户端 | 原生 ES 模块（`index.html` → `styles.css` → `app.js`），CSS 设计变量 |
| Worker | 单文件 `src/index.js`，手写路由，无框架 |
| 存储 | Cloudflare KV（`JOURNAL_KV`），每个分享码 7 天 TTL |
| PWA | `public/sw.js` 预缓存壳，离线回退 |
| 工具链 | Node 26 + `wrangler` 4.x，无运行时 npm 依赖 |

## 快速开始

```bash
git clone https://github.com/LeeNut-Code/payroll-journal.git
cd payroll-journal
npm install

# 1. 创建 KV namespace，把返回的 id 填进 wrangler.jsonc
cf kv namespaces create --title JOURNAL_KV

# 2. 本地运行：Worker + 静态资源 + 本地 KV
npm run dev            # http://localhost:8787
```

`?new=1` 会打开一页全新手账，且不会立刻覆盖已存数据。

如果本机 `wrangler` 的 workerd 不认识配置里的 `compatibility_date`，本地运行时临时传一个更早的
日期即可（不要改配置文件）：`npx wrangler dev --compatibility-date 2026-09-10`。

### 不开浏览器验证 API

```bash
curl -sX POST localhost:8787/api/share -H 'content-type: application/json' \
  -d '{"state":{"items":[{"name":"底薪","amount":15500}],"fundRate":12,"special":0,"cost":4000,"goal":3000,"mood":0,"notes":"","theme":"cream"}}'
```

## 部署

项目使用 **Cloudflare CLI（`cf`）** 部署，并接入了 **Cloudflare Workers Builds**：每次推送到
`main` 都会从 GitHub 自动构建并部署。

```bash
cf auth login --device        # 无头环境用设备授权登录
npm run deploy                # cf deploy（本地构建后发布到 Workers）
```

`cloudflare.config.ts` 声明 Worker 入口、SPA 资源路由和 `JOURNAL_KV` 绑定；
`wrangler.config.ts` 保留 `public/` 静态资源目录供构建使用。GitHub 构建触发器已绑定 `main`
分支，排查构建时可以：

```bash
cf builds create <trigger-uuid> --branch main   # 可选：手动触发一次构建
cf builds get <build-uuid>
cf builds logs get <build-uuid>
```

Worker 从 `public/` 提供页面外壳，并把 `/api/*` 交给 KV 支撑的分享 API。

## API

`POST /api/share` — 请求体 `{"state": {...}}`（≤ 4 KB，字段白名单，数值钳制）。

```json
200 {"code":"K7F2QX","path":"/s/K7F2QX"}
400 {"error":"invalid_state"}   413 {"error":"too_large"}   500 {"error":"kv_unavailable"}
```

`GET /api/share/:code` → `200 {"state":{...}}` · `404 {"error":"not_found"}`（不存在与过期不区分）。
所有 API 响应都带 `Cache-Control: no-store`。

`GET /s/:code` 不是 API 路由：SPA fallback 返回 `index.html`，由 `app.js` 再请求
`/api/share/<code>` 并进入只读模式。

分享码为 8 位 Crockford base32，KV key 为 `share:<CODE>`，值为 `{"v":1,"state":{...}}`，
TTL 604800 秒。

## 计算规则

```
税前   = Σ items[].amount
五险一金 = 税前 × (8% 养老 + 2% 医疗 + 0.5% 失业 + 公积金比例%) + 3
应纳税 = max(0, 税前 − 五险一金 − 5000 − 专项附加扣除)
个税   = 月度换算税率表(应纳税)
到手   = 税前 − 五险一金 − 个税
```

| 应纳税所得额 ≤ | 税率 | 速算扣除数 |
|---|---|---|
| 3,000 | 3% | 0 |
| 12,000 | 10% | 210 |
| 25,000 | 20% | 1,410 |
| 35,000 | 25% | 2,660 |
| 55,000 | 30% | 4,410 |
| 80,000 | 35% | 7,160 |
| ∞ | 45% | 15,160 |

这是**单月估算**，不是累计预扣：五险一金基数取税前工资（不做社平上下限），年终奖和年中调薪
都不计入。页脚也写了同样的说明。

## 目录结构

| 路径 | 作用 |
|---|---|
| `wrangler.jsonc` | Worker 名称、静态资源绑定、KV 绑定 |
| `src/index.js` | Worker 入口：分享 API + 静态资源委派 |
| `public/index.html` | 页面外壳与结构 |
| `public/styles.css` | 贴纸风设计系统与打印规则 |
| `public/app.js` | 状态、个税计算、渲染、PDF、CSV、持久化、分享 |
| `public/sw.js` | Service Worker：壳预缓存与缓存版本 |
| `public/manifest.webmanifest` | PWA manifest |
| `public/icons/` | 应用图标（192 / 512 / maskable） |
| `public/_headers` | CSP 与缓存策略 |
| `AGENTS.md` | 开发与架构约定 |

`state` 是唯一数据源；`paint()` 只写派生值，`render*()` 只在结构变化时重建 DOM。

## 数据与隐私

所有输入只保存在本机 `localStorage["payroll-journal-v1"]`。分享是主动行为，会在 KV 写入一条
包含同样 state 的记录，7 天后自动过期。没有账号、没有统计，服务端不记录请求内容。

## 许可证

以 [GNU General Public License v3.0](LICENSE)（`GPL-3.0-only`）发布。
