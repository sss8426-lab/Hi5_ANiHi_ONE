import { DataCoreAccessError, resolveDataCoreAccess } from "./data-core-access";
import {
  computeKkumeumAnalyticsPreview,
  syncKkumeumAnalyticsToDataCore,
} from "./kkumeum-analytics";
import { computeKkumeumAnalyticsTrend } from "./kkumeum-analytics-trend";
import { getKkumeumPilotSettings, updateKkumeumPilotSettings } from "./kkumeum-pilot";

export interface KkumeumPilotRouterEnv {
  DB?: D1Database;
  FAMILY_DB?: D1Database;
  FAMILY_FILES?: R2Bucket;
  DATA_CORE_SUPER_ADMIN_EMAILS?: string;
  KKUMEUM_ANALYTICS_SYNC_ENABLED?: string;
}

function json(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "private, no-store");
  return new Response(JSON.stringify(value), { ...init, headers });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new DataCoreAccessError(403, "허용되지 않은 요청 출처입니다.");
  }
}

function bindings(env: KkumeumPilotRouterEnv) {
  if (!env.DB || !env.FAMILY_DB || !env.FAMILY_FILES) {
    throw new DataCoreAccessError(503, "꿈이음 전용 FAMILY_DB/FAMILY_FILES 연결이 필요합니다.");
  }
  return { db: env.DB, familyDb: env.FAMILY_DB };
}

export async function handleKkumeumPilotApi(
  request: Request,
  env: KkumeumPilotRouterEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const pilotPath = url.pathname === "/api/kkumeum/admin/pilot-settings";
  const previewPath = url.pathname === "/api/kkumeum/analytics/preview";
  const trendPath = url.pathname === "/api/kkumeum/analytics/trend";
  const syncPath = url.pathname === "/api/kkumeum/analytics/sync";
  if (!pilotPath && !previewPath && !trendPath && !syncPath) return null;

  try {
    const ready = bindings(env);
    const context = await resolveDataCoreAccess(
      request,
      ready.db,
      env.DATA_CORE_SUPER_ADMIN_EMAILS,
    );

    if (pilotPath) {
      if (!context.isSuperAdmin) {
        throw new DataCoreAccessError(403, "파일럿 설정은 최고관리자만 확인할 수 있습니다.");
      }
      if (request.method === "GET") {
        return json({ settings: await getKkumeumPilotSettings(ready.familyDb) });
      }
      if (request.method === "PUT") {
        sameOrigin(request);
        return json({
          settings: await updateKkumeumPilotSettings(
            ready.familyDb,
            context,
            await request.json() as Record<string, unknown>,
          ),
        });
      }
      return json({ error: "지원하지 않는 파일럿 설정 요청입니다." }, { status: 405 });
    }

    if (previewPath) {
      if (request.method !== "GET") {
        return json({ error: "지원하지 않는 성장 통계 미리보기 요청입니다." }, { status: 405 });
      }
      return json({
        analytics: await computeKkumeumAnalyticsPreview(
          ready.familyDb,
          context,
          url.searchParams.get("campusId"),
          url.searchParams.get("yearMonth"),
        ),
        syncEnabled: ["1", "true", "yes", "on"].includes(
          String(env.KKUMEUM_ANALYTICS_SYNC_ENABLED || "").trim().toLowerCase(),
        ),
      });
    }

    if (trendPath) {
      if (request.method !== "GET") {
        return json({ error: "지원하지 않는 성장 흐름 요청입니다." }, { status: 405 });
      }
      return json({
        trend: await computeKkumeumAnalyticsTrend(
          ready.familyDb,
          context,
          url.searchParams.get("campusId"),
          url.searchParams.get("fromYearMonth"),
          url.searchParams.get("toYearMonth"),
        ),
      });
    }

    if (request.method !== "POST") {
      return json({ error: "지원하지 않는 성장 통계 저장 요청입니다." }, { status: 405 });
    }
    sameOrigin(request);
    const body = await request.json() as Record<string, unknown>;
    return json(await syncKkumeumAnalyticsToDataCore(
      ready.db,
      ready.familyDb,
      context,
      body.campusId,
      body.yearMonth,
      env.KKUMEUM_ANALYTICS_SYNC_ENABLED,
    ));
  } catch (error) {
    if (error instanceof DataCoreAccessError) {
      return json({ error: error.message }, { status: error.status });
    }
    console.error("꿈이음 안전설정/성장통계 API 처리 중 오류", error);
    return json({ error: "꿈이음 요청 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
