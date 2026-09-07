import baseWorker from "./admissions-knowledge-router";
import {
  DataCoreAccessError,
  resolveDataCoreAccess,
} from "./data-core-access";
import {
  createContentRecord,
  deleteContentRecord,
  getContentRecord,
  linkContentMedia,
  listContentRecords,
  unlinkContentMedia,
  updateContentRecord,
  type ContentInput,
  type ContentMediaLinkInput,
} from "./data-core-content";

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

function enforcePlatformContract(input: ContentInput): ContentInput {
  if (String(input.platform || "") !== "instagram") return input;
  const metadata = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
  return {
    ...input,
    metadata: {
      ...metadata,
      imageSpec: {
        width: 2160,
        height: 2700,
        aspectRatio: "4:5",
      },
    },
  };
}

async function handleContentApi(request: Request, env: Env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/data-core/content")) return null;
  if (!env.DB) throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");

  const context = await resolveDataCoreAccess(
    request,
    env.DB,
    env.DATA_CORE_SUPER_ADMIN_EMAILS,
  );

  if (url.pathname === "/api/data-core/content") {
    if (request.method === "GET") {
      return jsonResponse({ content: await listContentRecords(env.DB, context, url) });
    }
    if (request.method === "POST") {
      const input = enforcePlatformContract(await readJson<ContentInput>(request));
      return jsonResponse(
        { content: await createContentRecord(env.DB, context, input) },
        { status: 201 },
      );
    }
  }

  const mediaCollectionMatch = url.pathname.match(
    /^\/api\/data-core\/content\/([^/]+)\/media$/,
  );
  if (mediaCollectionMatch && request.method === "POST") {
    const contentId = decodeURIComponent(mediaCollectionMatch[1]);
    return jsonResponse({
      content: await linkContentMedia(
        env.DB,
        context,
        contentId,
        await readJson<ContentMediaLinkInput>(request),
      ),
    });
  }

  const mediaItemMatch = url.pathname.match(
    /^\/api\/data-core\/content\/([^/]+)\/media\/([^/]+)$/,
  );
  if (mediaItemMatch && request.method === "DELETE") {
    return jsonResponse(
      await unlinkContentMedia(
        env.DB,
        context,
        decodeURIComponent(mediaItemMatch[1]),
        decodeURIComponent(mediaItemMatch[2]),
      ),
    );
  }

  const contentMatch = url.pathname.match(/^\/api\/data-core\/content\/([^/]+)$/);
  if (contentMatch) {
    const contentId = decodeURIComponent(contentMatch[1]);
    if (request.method === "GET") {
      return jsonResponse({ content: await getContentRecord(env.DB, context, contentId) });
    }
    if (request.method === "PATCH") {
      const input = enforcePlatformContract(await readJson<ContentInput>(request));
      return jsonResponse({ content: await updateContentRecord(env.DB, context, contentId, input) });
    }
    if (request.method === "DELETE") {
      return jsonResponse(await deleteContentRecord(env.DB, context, contentId));
    }
  }

  return jsonResponse({ error: "지원하지 않는 콘텐츠 API 요청입니다." }, { status: 405 });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.method === "GET" &&
      (url.pathname === "/data-core/content" || url.pathname === "/data-core/content/")
    ) {
      url.pathname = "/data-core/content.html";
      return baseWorker.fetch(
        new Request(url.toString(), { headers: request.headers }),
        env,
      );
    }

    try {
      const response = await handleContentApi(request, env);
      if (response) return response;
    } catch (error) {
      if (error instanceof DataCoreAccessError) {
        return jsonResponse({ error: error.message }, { status: error.status });
      }
      console.error("DATA CORE content workflow error", error);
      return jsonResponse(
        { error: "블로그·인스타 콘텐츠 데이터를 처리하는 중 오류가 발생했습니다." },
        { status: 500 },
      );
    }
    return baseWorker.fetch(request, env);
  },
};

export default worker;
