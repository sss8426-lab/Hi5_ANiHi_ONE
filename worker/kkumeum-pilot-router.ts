import { DataCoreAccessError, resolveDataCoreAccess } from "./data-core-access";
import { getKkumeumPilotSettings, updateKkumeumPilotSettings } from "./kkumeum-pilot";

export interface KkumeumPilotRouterEnv { DB?: D1Database; FAMILY_DB?: D1Database; FAMILY_FILES?: R2Bucket; DATA_CORE_SUPER_ADMIN_EMAILS?: string; }
function json(value: unknown, init: ResponseInit = {}) { const headers = new Headers(init.headers); headers.set("content-type", "application/json; charset=utf-8"); headers.set("cache-control", "private, no-store"); return new Response(JSON.stringify(value), { ...init, headers }); }
function sameOrigin(request: Request) { const origin = request.headers.get("origin"); if (origin && origin !== new URL(request.url).origin) throw new DataCoreAccessError(403, "허용되지 않은 요청 출처입니다."); }
export async function handleKkumeumPilotApi(request: Request, env: KkumeumPilotRouterEnv): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/api/kkumeum/admin/pilot-settings") return null;
  try {
    if (!env.DB || !env.FAMILY_DB || !env.FAMILY_FILES) throw new DataCoreAccessError(503, "꿈이음 전용 FAMILY_DB/FAMILY_FILES 연결이 필요합니다.");
    const context = await resolveDataCoreAccess(request, env.DB, env.DATA_CORE_SUPER_ADMIN_EMAILS);
    if (!context.isSuperAdmin) throw new DataCoreAccessError(403, "파일럿 설정은 최고관리자만 확인할 수 있습니다.");
    if (request.method === "GET") return json({ settings: await getKkumeumPilotSettings(env.FAMILY_DB) });
    if (request.method === "PUT") { sameOrigin(request); return json({ settings: await updateKkumeumPilotSettings(env.FAMILY_DB, context, await request.json() as Record<string, unknown>) }); }
    return json({ error: "지원하지 않는 파일럿 설정 요청입니다." }, { status: 405 });
  } catch (error) { if (error instanceof DataCoreAccessError) return json({ error: error.message }, { status: error.status }); console.error("꿈이음 파일럿 설정 API 처리 중 오류", error); return json({ error: "파일럿 설정 요청 처리 중 오류가 발생했습니다." }, { status: 500 }); }
}
