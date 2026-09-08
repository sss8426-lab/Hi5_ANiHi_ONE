import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const DATA_CORE_DATABASE_NAME = "site-creator-d1";
const DATA_CORE_DATABASE_ID = "7a25ebae-c784-40a3-bd71-496f3623bf29";
const DATA_CORE_R2_BUCKET_NAME = "anihi-admissions-images";
const FAMILY_DATABASE_NAME = "hi5-anihi-family";
const FAMILY_DATABASE_ID = "72137d46-50d1-4dd7-8caa-0e31bab003c3";
const FAMILY_R2_BUCKET_NAME = "hi5-anihi-family-files";

const { d1, r2 } = hostingConfig;

const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/family-shell-router.ts",
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: DATA_CORE_DATABASE_NAME,
          database_id: DATA_CORE_DATABASE_ID,
        },
        {
          binding: "FAMILY_DB",
          database_name: FAMILY_DATABASE_NAME,
          database_id: FAMILY_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: DATA_CORE_R2_BUCKET_NAME,
        },
        {
          binding: "FAMILY_FILES",
          bucket_name: FAMILY_R2_BUCKET_NAME,
        },
      ]
    : [],
};

export default defineConfig(async () => {
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
