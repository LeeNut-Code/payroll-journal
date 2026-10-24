import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "payroll-journal",
    compatibilityDate: "2026-09-25",
    entrypoint: "./src/index.js",
    observability: {
      enabled: true,
    },
    assets: {
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/api/*"],
    },
    domains: ["payroll-journal.leenut.dpdns.org"],
    env: {
      JOURNAL_KV: bindings.kv({ id: "7b4b5abc2e924b4d88a211edfece177a" }),
    },
  },
});
