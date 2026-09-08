import {
  DataCoreAccessError,
  resolveDataCoreAccess,
} from "./data-core-access";
import {
  getKkumeumRetentionPolicy,
  upsertKkumeumRetentionPolicy,
} from "./kkumeum-retention";

export interface KkumeumRetentionRouterEnv {
  DB?: D1Database;
  FAMILY_DB?: D1Database;
  FAMILY_FILES?: R2Bucket;
  DATA_CORE_SUPER_ADMIN_EMAILS?: string;
}

function privateJson(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "private, no-store");
  return new Response(JSON.stringify(value), { ...init, headers });
}

function required(value: string | null, field: string): string {
  const normalized = String(value || "").trim().slice(0, 120);
  if (!normalized) throw new DataCoreAccessError(400, `${field}가 필요합니다.`);
  return normalized;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    throw new DataCoreAccessError(400, "JSON 요청 형식이 올바르지 않습니다.");
  }
}

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new DataCoreAccessError(403, "허용되지 않은 요청 출처입니다.");
  }
}

function requireIsolatedBindings(env: KkumeumRetentionRouterEnv): D1Database {
  if (!env.FAMILY_DB || !env.FAMILY_FILES) {
    throw new DataCoreAccessError(
      503,
      "꿈이음 전용 FAMILY_DB/FAMILY_FILES 연결이 아직 완료되지 않았습니다. 보존정책은 기존 DATA CORE에 대신 저장하지 않습니다.",
    );
  }
  return env.FAMILY_DB;
}

export async function handleKkumeumRetentionApi(
  request: Request,
  env: KkumeumRetentionRouterEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/kkumeum/retention") return null;

  try {
    if (!env.DB) throw new DataCoreAccessError(503, "CORE 인증 데이터베이스가 연결되지 않았습니다.");
    const context = await resolveDataCoreAccess(request, env.DB, env.DATA_CORE_SUPER_ADMIN_EMAILS);
    const familyDb = requireIsolatedBindings(env);

    if (request.method === "GET") {
      const campusId = required(url.searchParams.get("campusId"), "campusId");
      return privateJson({
        policy: await getKkumeumRetentionPolicy(familyDb, context, campusId),
      });
    }

    if (request.method === "PUT") {
      assertSameOrigin(request);
      return privateJson(await upsertKkumeumRetentionPolicy(
        familyDb,
        context,
        await readJson(request),
      ));
    }

    return privateJson({ error: "지원하지 않는 꿈이음 보존정책 요청입니다." }, { status: 405 });
  } catch (error) {
    if (error instanceof DataCoreAccessError) {
      return privateJson({ error: error.message }, { status: error.status });
    }
    console.error("꿈이음 보존정책 API 처리 중 오류", error);
    return privateJson({ error: "꿈이음 보존정책 요청을 처리하는 중 오류가 발생했습니다." }, { status: 500 });
  }
}
