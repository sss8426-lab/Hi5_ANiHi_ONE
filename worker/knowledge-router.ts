import baseWorker from "./router";
import {
  DataCoreAccessError,
  resolveDataCoreAccess,
} from "./data-core-access";
import {
  createKnowledgeEdge,
  createKnowledgeNode,
  deleteKnowledgeEdge,
  deleteKnowledgeNode,
  getKnowledgeNode,
  listKnowledgeEdges,
  listKnowledgeNodes,
  updateKnowledgeNode,
  type KnowledgeEdgeInput,
  type KnowledgeNodeInput,
} from "./data-core-knowledge";
import { buildDreamRoadmap, listRoadmapGoals } from "./data-core-roadmap";

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

async function readJson<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new DataCoreAccessError(400, "JSON 요청 형식이 올바르지 않습니다.");
  }
}

function visibleEdges<T extends { campusId?: unknown }>(
  context: Awaited<ReturnType<typeof resolveDataCoreAccess>>,
  edges: T[],
) {
  if (context.isSuperAdmin) return edges;
  return edges.filter((edge) => {
    const campusId = edge.campusId ? String(edge.campusId) : "";
    return !campusId || context.campusIds.includes(campusId);
  });
}

function normalizeEdgeInputForContext(
  context: Awaited<ReturnType<typeof resolveDataCoreAccess>>,
  input: KnowledgeEdgeInput,
): KnowledgeEdgeInput {
  if (context.isSuperAdmin) return input;
  const explicit = String(input.campusId || "").trim();
  if (explicit) return input;
  if (context.campusIds.length === 1) {
    return { ...input, campusId: context.campusIds[0] };
  }
  throw new DataCoreAccessError(
    400,
    "캠퍼스 전용 지식 관계를 만들려면 campusId가 필요합니다.",
  );
}

async function handleRoadmapApi(request: Request, env: Env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/data-core/roadmap")) return null;
  if (!env.DB) throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");
  const context = await resolveDataCoreAccess(
    request,
    env.DB,
    env.DATA_CORE_SUPER_ADMIN_EMAILS,
  );

  if (url.pathname === "/api/data-core/roadmap/goals" && request.method === "GET") {
    return jsonResponse({ goals: await listRoadmapGoals(env.DB, context) });
  }
  if (url.pathname === "/api/data-core/roadmap" && request.method === "GET") {
    return jsonResponse(await buildDreamRoadmap(env.DB, context, url));
  }
  return jsonResponse({ error: "지원하지 않는 로드맵 API 요청입니다." }, { status: 405 });
}

async function handleKnowledgeApi(request: Request, env: Env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/data-core/knowledge/")) return null;
  if (!env.DB) throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");
  const context = await resolveDataCoreAccess(
    request,
    env.DB,
    env.DATA_CORE_SUPER_ADMIN_EMAILS,
  );

  if (url.pathname === "/api/data-core/knowledge/nodes") {
    if (request.method === "GET") {
      return jsonResponse({ nodes: await listKnowledgeNodes(env.DB, context, url) });
    }
    if (request.method === "POST") {
      return jsonResponse(
        { node: await createKnowledgeNode(env.DB, context, await readJson<KnowledgeNodeInput>(request)) },
        { status: 201 },
      );
    }
  }

  const nodeMatch = url.pathname.match(/^\/api\/data-core\/knowledge\/nodes\/([^/]+)$/);
  if (nodeMatch) {
    const nodeId = decodeURIComponent(nodeMatch[1]);
    if (request.method === "GET") {
      return jsonResponse({ node: await getKnowledgeNode(env.DB, context, nodeId) });
    }
    if (request.method === "PATCH") {
      return jsonResponse({
        node: await updateKnowledgeNode(
          env.DB,
          context,
          nodeId,
          await readJson<KnowledgeNodeInput>(request),
        ),
      });
    }
    if (request.method === "DELETE") {
      return jsonResponse(await deleteKnowledgeNode(env.DB, context, nodeId));
    }
  }

  if (url.pathname === "/api/data-core/knowledge/edges") {
    if (request.method === "GET") {
      const edges = await listKnowledgeEdges(env.DB, context, url);
      return jsonResponse({ edges: visibleEdges(context, edges) });
    }
    if (request.method === "POST") {
      const input = normalizeEdgeInputForContext(
        context,
        await readJson<KnowledgeEdgeInput>(request),
      );
      return jsonResponse(
        { edge: await createKnowledgeEdge(env.DB, context, input) },
        { status: 201 },
      );
    }
  }

  const edgeMatch = url.pathname.match(/^\/api\/data-core\/knowledge\/edges\/([^/]+)$/);
  if (edgeMatch && request.method === "DELETE") {
    return jsonResponse(
      await deleteKnowledgeEdge(env.DB, context, decodeURIComponent(edgeMatch[1])),
    );
  }

  return jsonResponse({ error: "지원하지 않는 지식 그래프 API 요청입니다." }, { status: 405 });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.method === "GET" &&
      (url.pathname === "/data-core/roadmap" || url.pathname === "/data-core/roadmap/")
    ) {
      url.pathname = "/data-core/roadmap.html";
      return baseWorker.fetch(
        new Request(url.toString(), { headers: request.headers }),
        env,
      );
    }

    try {
      const roadmapResponse = await handleRoadmapApi(request, env);
      if (roadmapResponse) return roadmapResponse;

      const knowledgeResponse = await handleKnowledgeApi(request, env);
      if (knowledgeResponse) return knowledgeResponse;
    } catch (error) {
      if (error instanceof DataCoreAccessError) {
        return jsonResponse({ error: error.message }, { status: error.status });
      }
      console.error("DATA CORE knowledge router error", error);
      return jsonResponse(
        { error: "꿈·전공 로드맵 데이터를 처리하는 중 오류가 발생했습니다." },
        { status: 500 },
      );
    }

    return baseWorker.fetch(request, env);
  },
};

export default worker;
