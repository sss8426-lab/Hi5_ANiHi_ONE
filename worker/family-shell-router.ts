import appWorker from "./readiness-router";
import { handleKkumeumConsentApi } from "./kkumeum-consent-router";
import { handleKkumeumRetentionApi } from "./kkumeum-retention-router";
import { handleKkumeumFamilyBackupApi } from "./kkumeum-family-backup-router";
import { handleKkumeumPilotApi } from "./kkumeum-pilot-router";
import { syncPublicHolidays } from "./data-core-public-holidays";
import { runAutoBillReminders } from "./kkumeum-payments";
import { handleMarketingApi } from "./data-core-marketing";
import { DataCoreAccessError } from "./data-core-access";

const BILL_REMINDER_CRON = "0 1 * * *";

interface Env {
  ASSETS?: Fetcher;
  DB?: D1Database;
  FILES?: R2Bucket;
  FAMILY_DB?: D1Database;
  FAMILY_FILES?: R2Bucket;
  DATA_CORE_SUPER_ADMIN_EMAILS?: string;
  MARKETING_INGEST_TOKEN?: string;
  PUSH_VAPID_PUBLIC_KEY?: string;
  PUSH_VAPID_PRIVATE_JWK?: string;
  PUSH_VAPID_SUBJECT?: string;
  PUSH_SUBSCRIPTION_ENCRYPTION_KEY?: string;
}

async function familyShell(request: Request, env: Env): Promise<Response | null> {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  // /kiosk is the 출결기 tablet page; /family the guardian app. Both always load fresh.
  const kiosk = url.pathname === "/kiosk" || url.pathname === "/kiosk/";
  if (url.pathname !== "/family" && url.pathname !== "/family/" && !kiosk) return null;
  if (!env.ASSETS) return new Response("Not found", { status: 404 });
  url.pathname = "/family/index.html";
  if (kiosk) url.pathname = "/kiosk/index.html";
  const response = await env.ASSETS.fetch(new Request(url.toString(), { headers: request.headers }));
  if (!response.ok) return response;
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.delete("content-length");
  return new Response(response.body, { status: response.status, headers });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const shell = await familyShell(request, env);
    if (shell) return shell;
    if (new URL(request.url).pathname.startsWith('/api/data-core/marketing/')) {
      try {
        const marketing = await handleMarketingApi(request, env);
        if (marketing) return marketing;
      } catch (error) {
        return Response.json({ error: error instanceof DataCoreAccessError ? error.message : '마케팅 모니터링 요청을 처리하지 못했습니다.' }, {
          status: error instanceof DataCoreAccessError ? error.status : 503,
          headers: { 'cache-control': 'private, no-store' },
        });
      }
    }
    const backup = await handleKkumeumFamilyBackupApi(request, env);
    if (backup) return backup;
    const pilot = await handleKkumeumPilotApi(request, env);
    if (pilot) return pilot;
    const retention = await handleKkumeumRetentionApi(request, env);
    if (retention) return retention;
    const consent = await handleKkumeumConsentApi(request, env);
    if (consent) return consent;
    return appWorker.fetch(request, env);
  },
  // Daily crons:
  // - "0 1 * * *" (오전 10시 KST): 꿈이음 수납 자동 알림 (낮에 보내려고 따로 돈다).
  // - otherwise (18:00 UTC): keep 대한민국 공휴일 in the CORE calendar (출석부 "휴" uses them).
  async scheduled(controller: { cron?: string } | undefined, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<void> {
    if (controller?.cron === BILL_REMINDER_CRON) {
      if (!env.FAMILY_DB) return;
      ctx.waitUntil(runAutoBillReminders(env.FAMILY_DB, env).then(result => console.log("bill reminders", JSON.stringify(result))));
      return;
    }
    if (!env.DB) return;
    ctx.waitUntil(syncPublicHolidays(env.DB).then(result => console.log("public holidays synced", JSON.stringify(result))));
  },
};

export default worker;
