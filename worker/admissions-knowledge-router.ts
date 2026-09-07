import baseWorker from "./knowledge-router";
import {
  DataCoreAccessError,
  resolveDataCoreAccess,
} from "./data-core-access";
import { syncAdmissionsKnowledge } from "./data-core-admissions-knowledge-sync";
import { ensureKnowledgeSchema } from "./data-core-knowledge";

interface Env {
  ASSETS?: Fetcher;
  DB?: D1Database;
  FILES?: R2Bucket;
  DATA_CORE_SUPER_ADMIN_EMAILS?: string;
}

function jsonResponse(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { ...init, headers });
}

function requireSuperAdmin(context: Awaited<ReturnType<typeof resolveDataCoreAccess>>) {
  if (!context.authenticated) throw new DataCoreAccessError(401, "로그인이 필요합니다.");
  if (!context.isSuperAdmin) {
    throw new DataCoreAccessError(403, "입시 지식 동기화는 마스터 관리자만 사용할 수 있습니다.");
  }
}

async function admissionsKnowledgeStatus(
  db: D1Database,
  context: Awaited<ReturnType<typeof resolveDataCoreAccess>>,
) {
  requireSuperAdmin(context);
  await ensureKnowledgeSchema(db);
  const result = await db
    .prepare(
      `SELECT node_type, COUNT(*) AS count, MAX(updated_at) AS last_updated_at
       FROM knowledge_nodes
       WHERE organization_id = ?
         AND deleted_at IS NULL
         AND metadata_json LIKE '%"sourceApp":"admissions"%'
       GROUP BY node_type
       ORDER BY node_type`,
    )
    .bind("org-hi5-anihi")
    .all<{ node_type: string; count: number; last_updated_at: string | null }>();
  const rows = result.results || [];
  return {
    counts: Object.fromEntries(rows.map((row) => [row.node_type, Number(row.count) || 0])),
    lastSyncedAt: rows
      .map((row) => row.last_updated_at)
      .filter(Boolean)
      .sort()
      .pop() || null,
  };
}

async function handleAdmissionsKnowledgeApi(request: Request, env: Env) {
  const url = new URL(request.url);
  const prefix = "/api/data-core/admin/knowledge/admissions";
  if (!url.pathname.startsWith(prefix)) return null;
  if (!env.DB) throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");

  const context = await resolveDataCoreAccess(
    request,
    env.DB,
    env.DATA_CORE_SUPER_ADMIN_EMAILS,
  );
  requireSuperAdmin(context);

  if (url.pathname === `${prefix}/status` && request.method === "GET") {
    return jsonResponse({ status: await admissionsKnowledgeStatus(env.DB, context) });
  }

  if (url.pathname === `${prefix}/sync` && request.method === "POST") {
    const summary = await syncAdmissionsKnowledge(env.DB, env.FILES, context);
    return jsonResponse({ sync: summary });
  }

  return jsonResponse({ error: "지원하지 않는 입시 지식 동기화 API 요청입니다." }, { status: 405 });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const response = await handleAdmissionsKnowledgeApi(request, env);
      if (response) return response;
    } catch (error) {
      if (error instanceof DataCoreAccessError) {
        return jsonResponse({ error: error.message }, { status: error.status });
      }
      console.error("Admissions knowledge sync error", error);
      return jsonResponse(
        { error: "입시 데이터를 로드맵 지식으로 동기화하는 중 오류가 발생했습니다." },
        { status: 500 },
      );
    }
    return baseWorker.fetch(request, env);
  },
};

export default worker;
