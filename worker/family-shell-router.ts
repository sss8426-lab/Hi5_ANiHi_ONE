import appWorker from "./readiness-router";
import { handleKkumeumConsentApi } from "./kkumeum-consent-router";
import { handleKkumeumRetentionApi } from "./kkumeum-retention-router";
import { handleKkumeumFamilyBackupApi } from "./kkumeum-family-backup-router";
import { handleKkumeumPilotApi } from "./kkumeum-pilot-router";
import { syncPublicHolidays } from "./data-core-public-holidays";
import { runAutoBillReminders } from "./kkumeum-payments";
import { handleMarketingApi } from "./data-core-marketing";
import { DataCoreAccessError } from "./data-core-access";
import { syncCampusBlogs } from "./blog-publications";
import { forgetSessionAccess } from "./data-core-auth";
import { forgetLibraryTotals } from "./data-core-library";
import { timedDb, withDbTiming } from "./db-timing";

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
  // 꿈이음 Android 앱(TWA): Play Console의 패키지 이름과 SHA-256 인증서 지문(쉼표로 여러 개). 공개 정보.
  ANDROID_TWA_PACKAGE?: string;
  ANDROID_TWA_SHA256?: string;
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

// Digital Asset Links: lets the Play Store 꿈이음 app open /family/ full screen (no address bar).
// Answers only when both values are set in Cloudflare; otherwise 404 so nothing half-configured is published.
function androidAssetLinks(request: Request, env: Env): Response | null {
  if (request.method !== "GET" || new URL(request.url).pathname !== "/.well-known/assetlinks.json") return null;
  const pkg = String(env.ANDROID_TWA_PACKAGE || "").trim();
  const prints = String(env.ANDROID_TWA_SHA256 || "").split(",").map(v => v.trim().toUpperCase()).filter(v => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(v));
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(pkg) || !prints.length) return new Response("Not found", { status: 404 });
  const body = [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: prints } }];
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    // 속도 측정: D1 calls are counted per request and reported in Server-Timing (worker/db-timing.ts).
    if (env.DB || env.FAMILY_DB) env = { ...env, DB: timedDb(env.DB), FAMILY_DB: timedDb(env.FAMILY_DB) };
    const response = await withDbTiming(request, () => worker.route(request, env));
    // Account, membership and session changes clear the short login memory right away (see standaloneSessionAccess).
    const path = new URL(request.url).pathname;
    if (!['GET', 'HEAD'].includes(request.method) && (path.startsWith('/api/auth/') || path.startsWith('/api/data-core/admin/'))) forgetSessionAccess(env.DB);
    // Any file or folder change clears the 60-second 자료보관함 counts kept in this worker.
    if (!['GET', 'HEAD'].includes(request.method) && /^\/api\/(data-core\/(library|files|trash|awards|records|content)|upload|admissions\/)/.test(path)) forgetLibraryTotals(env.DB);
    return response;
  },
  async route(request: Request, env: Env): Promise<Response> {
    const links = androidAssetLinks(request, env);
    if (links) return links;
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
    // 블로그 발행 소식: 캠퍼스 블로그 새 글도 매일 한 번 가져온다(화면을 열 때도 30분마다 갱신).
    ctx.waitUntil(syncCampusBlogs(env.DB, 0).then(result => console.log("campus blogs synced", JSON.stringify(result))).catch(error => console.warn("campus blogs", error)));
  },
};

export default worker;
