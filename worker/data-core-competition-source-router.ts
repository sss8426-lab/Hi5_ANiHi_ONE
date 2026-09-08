import {
  DataCoreAccessError,
  resolveDataCoreAccess,
} from "./data-core-access";
import {
  importCompetitionSources,
  previewCompetitionSources,
} from "./data-core-competition-sources";

export type CompetitionSourceRouterEnv = {
  DB?: D1Database;
  DATA_CORE_SUPER_ADMIN_EMAILS?: string;
};

function privateJson(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "private, no-store");
  return new Response(JSON.stringify(value), { ...init, headers });
}

async function readJson(request: Request) {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    throw new DataCoreAccessError(400, "JSON 요청 형식이 올바르지 않습니다.");
  }
}

export async function handleCompetitionSourceApi(
  request: Request,
  env: CompetitionSourceRouterEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/data-core/competitions/sources/")) return null;
  try {
    if (!env.DB) throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");

    const context = await resolveDataCoreAccess(request, env.DB, env.DATA_CORE_SUPER_ADMIN_EMAILS);
    if (context.mustChangePassword) throw new DataCoreAccessError(403, "첫 로그인 비밀번호를 먼저 변경하세요.");

    if (url.pathname === "/api/data-core/competitions/sources/preview" && request.method === "GET") {
      const provider = url.searchParams.get("provider") || "all";
      return privateJson({ preview: await previewCompetitionSources(context, provider) });
    }

    if (url.pathname === "/api/data-core/competitions/sources/import" && request.method === "POST") {
      const input = await readJson(request);
      return privateJson({
        import: await importCompetitionSources(request, env.DB, context, input.provider || "all"),
      });
    }

    return privateJson({ error: "지원하지 않는 공모전 외부 소스 API 요청입니다." }, { status: 405 });
  } catch (error) {
    if (error instanceof DataCoreAccessError) {
      return privateJson({ error: error.message }, { status: error.status });
    }
    console.error("Competition source router error", error);
    return privateJson({ error: "공모전 외부 소스를 처리하는 중 오류가 발생했습니다." }, { status: 500 });
  }
}
