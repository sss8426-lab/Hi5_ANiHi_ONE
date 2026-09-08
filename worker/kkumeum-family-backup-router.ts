import { DataCoreAccessError, resolveDataCoreAccess } from "./data-core-access";
import { createKkumeumFamilyBackupManifest } from "./kkumeum-family-backups";
export interface KkumeumFamilyBackupRouterEnv { DB?: D1Database; FAMILY_DB?: D1Database; FAMILY_FILES?: R2Bucket; DATA_CORE_SUPER_ADMIN_EMAILS?: string; }
function json(value: unknown, init: ResponseInit = {}) { const headers = new Headers(init.headers); headers.set("content-type", "application/json; charset=utf-8"); headers.set("cache-control", "private, no-store"); return new Response(JSON.stringify(value), { ...init, headers }); }
function sameOrigin(request: Request) { const origin = request.headers.get("origin"); if (origin && origin !== new URL(request.url).origin) throw new DataCoreAccessError(403, "허용되지 않은 요청 출처입니다."); }
export async function handleKkumeumFamilyBackupApi(request: Request, env: KkumeumFamilyBackupRouterEnv): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  const isManifestPath = pathname === "/api/kkumeum/admin/family-backups/manifest";
  const isLegacyCreatePath = pathname === "/api/kkumeum/admin/family-backups";
  if (!isManifestPath && !isLegacyCreatePath) return null;
  try {
    if (!env.DB || !env.FAMILY_DB || !env.FAMILY_FILES) throw new DataCoreAccessError(503, "꿈이음 전용 FAMILY_DB/FAMILY_FILES 연결이 필요합니다.");
    const context = await resolveDataCoreAccess(request, env.DB, env.DATA_CORE_SUPER_ADMIN_EMAILS);
    if (request.method === "POST") {
      sameOrigin(request);
      return json({ manifest: await createKkumeumFamilyBackupManifest(env.FAMILY_DB, env.FAMILY_FILES, context) }, { status: 201 });
    }
    return json({ error: "FAMILY 백업 매니페스트는 생성 시점의 private 응답으로만 제공됩니다." }, { status: 405 });
  } catch (error) {
    if (error instanceof DataCoreAccessError) return json({ error: error.message }, { status: error.status });
    console.error("FAMILY 백업 API 처리 중 오류", error);
    return json({ error: "FAMILY 백업 요청 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
