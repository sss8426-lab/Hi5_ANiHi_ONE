import { DataCoreAccessError, resolveDataCoreAccess } from "./data-core-access";
import { createKkumeumFamilyBackupManifest, listKkumeumFamilyBackupManifests } from "./kkumeum-family-backups";
export interface KkumeumFamilyBackupRouterEnv { DB?: D1Database; FAMILY_DB?: D1Database; FAMILY_FILES?: R2Bucket; DATA_CORE_SUPER_ADMIN_EMAILS?: string; }
function json(value: unknown, init: ResponseInit = {}) { const headers = new Headers(init.headers); headers.set("content-type", "application/json; charset=utf-8"); headers.set("cache-control", "private, no-store"); return new Response(JSON.stringify(value), { ...init, headers }); }
function sameOrigin(request: Request) { const origin = request.headers.get("origin"); if (origin && origin !== new URL(request.url).origin) throw new DataCoreAccessError(403, "허용되지 않은 요청 출처입니다."); }
export async function handleKkumeumFamilyBackupApi(request: Request, env: KkumeumFamilyBackupRouterEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const isCollection = path === "/api/kkumeum/admin/family-backups";
  const isManifest = path === "/api/kkumeum/admin/family-backups/manifest";
  if (!isCollection && !isManifest) return null;
  try {
    if (!env.DB || !env.FAMILY_DB || !env.FAMILY_FILES) throw new DataCoreAccessError(503, "꿈이음 전용 FAMILY_DB/FAMILY_FILES 연결이 필요합니다.");
    const context = await resolveDataCoreAccess(request, env.DB, env.DATA_CORE_SUPER_ADMIN_EMAILS);
    if (isCollection && request.method === "GET") return json({ manifests: await listKkumeumFamilyBackupManifests(env.FAMILY_DB, context) });
    if (isManifest && request.method === "POST") { sameOrigin(request); return json({ manifest: await createKkumeumFamilyBackupManifest(env.FAMILY_DB, env.FAMILY_FILES, context) }, { status: 201 }); }
    return json({ error: "지원하지 않는 FAMILY 백업 요청입니다." }, { status: 405 });
  } catch (error) { if (error instanceof DataCoreAccessError) return json({ error: error.message }, { status: error.status }); console.error("FAMILY 백업 API 처리 중 오류", error); return json({ error: "FAMILY 백업 요청 처리 중 오류가 발생했습니다." }, { status: 500 }); }
}
