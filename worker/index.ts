/** Cloudflare Worker entry point for the admissions consulting web app. */
import {
  dataCoreHealth,
  fileAreaForPurpose,
  recordFileObject,
  visibilityForArea,
} from "./data-core";
import {
  DataCoreAccessError,
  listAccessibleCampuses,
  resolveDataCoreAccess,
} from "./data-core-access";
import {
  deleteDataCoreMembership,
  listDataCoreMemberships,
  listDataCoreUsers,
  upsertDataCoreMembership,
} from "./data-core-admin";
import { listAuditLogs } from "./data-core-audit";
import { createInstagramDerivative } from './data-core-derivatives';
import { handleAdmissionsArtworks } from './admissions-artworks';
import {
  deleteDataCoreFile,
  listDataCoreFiles,
  readDataCoreFile,
  uploadDataCoreFile,
} from "./data-core-files";
import {
  createDataRecord,
  deleteDataRecord,
  getDataRecord,
  listDataRecords,
  updateDataRecord,
} from "./data-core-records";
import {
  createAcademyCalendarEvent,
  deleteAcademyCalendarEvent,
  listAcademyCalendar,
  updateAcademyCalendarEvent,
} from "./data-core-calendar";
import {
  getDataRecordContent,
  searchDataCore,
  setDataRecordContent,
} from "./data-core-search";

const STATE_ID = "main";
const STATE_OBJECT_KEY = "state/admissions-data.json";

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

function appShell() {
  return new Response(
    `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>대학 합격 로드맵</title>
    <style>
      html, body, iframe {
        border: 0;
        height: 100%;
        margin: 0;
        width: 100%;
      }
      body {
        overflow: hidden;
      }
    </style>
  </head>
  <body>
    <iframe src="/admissions-web/renderer/index.html" title="대학 합격 로드맵"></iframe>
  </body>
</html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

async function ensureDatabase(env: Env) {
  if (!env.DB) return;
  await env.DB
    .prepare(
      "CREATE TABLE IF NOT EXISTS app_state (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL)",
    )
    .run();
}

async function fetchAsset(request: Request, env: Env, pathname?: string) {
  if (!env.ASSETS) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  if (pathname) url.pathname = pathname;
  return env.ASSETS.fetch(new Request(url, request));
}

async function defaultData(request: Request, env: Env) {
  const response = await fetchAsset(request, env, "/admissions-web/data/default-data.json");
  if (!response.ok) throw new Error("초기 데이터를 불러오지 못했습니다.");
  return response.json();
}

async function readAppData(request: Request, env: Env) {
  await ensureDatabase(env);
  if (env.FILES) {
    const object = await env.FILES.get(STATE_OBJECT_KEY);
    if (object) return object.json();
  }

  if (env.DB) {
    const row = await env.DB
      .prepare("SELECT json FROM app_state WHERE id = ?")
      .bind(STATE_ID)
      .first<{ json: string }>();
    if (row?.json && !row.json.startsWith("r2:")) {
      try {
        return JSON.parse(row.json);
      } catch {
        // Fall through to bundled defaults when old state is malformed.
      }
    }
  }

  const initial = await defaultData(request, env);
  await saveAppData(env, initial);
  return initial;
}

async function saveAppData(env: Env, data: unknown) {
  await ensureDatabase(env);
  const now = new Date().toISOString();
  const serialized = JSON.stringify(data);

  if (env.FILES) {
    await env.FILES.put(STATE_OBJECT_KEY, serialized, {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
    });
    if (env.DB) {
      await env.DB
        .prepare(
          "INSERT INTO app_state (id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at",
        )
        .bind(STATE_ID, `r2:${STATE_OBJECT_KEY}`, now)
        .run();
    }
    return;
  }

  if (env.DB) {
    await env.DB
      .prepare(
        "INSERT INTO app_state (id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at",
      )
      .bind(STATE_ID, serialized, now)
      .run();
  }
}

function safeFileName(value: FormDataEntryValue | null) {
  const name = value instanceof File ? value.name : String(value || "image");
  return name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").slice(0, 120) || "image";
}

async function handleUpload(request: Request, env: Env) {
  if (!env.FILES) {
    return jsonResponse({ error: "이미지 보관소가 아직 연결되지 않았습니다." }, { status: 503 });
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return jsonResponse({ error: "이미지 파일을 찾을 수 없습니다." }, { status: 400 });
  }

  const purpose = String(form.get("purpose") || "image").replace(/[^a-z0-9_-]/gi, "_");
  const ownerId = String(form.get("ownerId") || "common").replace(/[^a-z0-9_-]/gi, "_");
  const year = String(form.get("year") || "").replace(/[^0-9]/g, "");
  const folder = year ? `${purpose}/${ownerId}/${year}` : `${purpose}/${ownerId}`;
  const key = `${folder}/${Date.now()}-${crypto.randomUUID()}-${safeFileName(file)}`;
  const createdAt = new Date().toISOString();
  const dataCoreFileId = crypto.randomUUID();
  const area = fileAreaForPurpose(purpose);

  await env.FILES.put(key, file.stream(), {
    httpMetadata: {
      contentType: file.type || "application/octet-stream",
    },
  });

  let metadataStored = false;
  if (env.DB) {
    await recordFileObject(env.DB, {
      id: dataCoreFileId,
      area,
      category: purpose,
      r2Key: key,
      originalFileName: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      visibility: visibilityForArea(area),
      createdAt,
    });
    metadataStored = true;
  }

  return jsonResponse({
    id: Date.now(),
    dataCoreFileId,
    metadataStored,
    area,
    key,
    url: `/api/files/${encodeURIComponent(key)}`,
    imageUrl: `/api/files/${encodeURIComponent(key)}`,
    filePath: `/api/files/${encodeURIComponent(key)}`,
    path: `/api/files/${encodeURIComponent(key)}`,
    fileName: file.name,
    name: file.name,
    contentType: file.type,
    createdAt,
  });
}

async function handleFile(request: Request, env: Env) {
  if (!env.FILES) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const encodedKey = url.pathname.replace(/^\/api\/files\//, "");
  const key = decodeURIComponent(encodedKey);
  if (key.startsWith("data-core/") || key.startsWith("artworks/")) return new Response("Not found", { status: 404 });
  const object = await env.FILES.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=3600");
  return new Response(object.body, { headers });
}

async function readJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new DataCoreAccessError(400, "JSON 요청 형식이 올바르지 않습니다.");
  }
}

async function handleDataCoreApi(request: Request, env: Env) {
  const url = new URL(request.url);

  if (url.pathname === "/api/data-core/health" && request.method === "GET") {
    return jsonResponse(await dataCoreHealth(env.DB, env.FILES));
  }

  const context = await resolveDataCoreAccess(
    request,
    env.DB,
    env.DATA_CORE_SUPER_ADMIN_EMAILS,
  );

  if (url.pathname === '/api/data-core/instagram/derivatives' && request.method === 'POST') {
    if (!env.DB || !env.FILES) throw new DataCoreAccessError(503, 'DATA CORE 저장소가 연결되지 않았습니다.');
    return jsonResponse({file:await createInstagramDerivative(request, env.DB, env.FILES, context)}, {status:201});
  }

  if (url.pathname === "/api/data-core/context" && request.method === "GET") {
    return jsonResponse(context);
  }

  if (url.pathname === "/api/data-core/campuses" && request.method === "GET") {
    if (!env.DB) throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");
    return jsonResponse({ campuses: await listAccessibleCampuses(env.DB, context) });
  }

  if (url.pathname === "/api/data-core/search" && request.method === "GET") {
    if (!env.DB) throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");
    return jsonResponse(await searchDataCore(env.DB, context, url));
  }

  if (url.pathname === "/api/data-core/audit" && request.method === "GET") {
    if (!env.DB) throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");
    return jsonResponse({ logs: await listAuditLogs(env.DB, context, url) });
  }

  if (url.pathname === "/api/data-core/calendar" && request.method === "GET") {
    if (!env.DB) throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");
    return jsonResponse({ events: await listAcademyCalendar(env.DB, context, url) });
  }

  if (url.pathname === "/api/data-core/calendar" && request.method === "POST") {
    if (!env.DB) throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");
    return jsonResponse(
      { event: await createAcademyCalendarEvent(env.DB, context, await readJsonBody(request)) },
      { status: 201 },
    );
  }

  const calendarMatch = url.pathname.match(/^\/api\/data-core\/calendar\/([^/]+)$/);
  if (calendarMatch) {
    if (!env.DB) throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");
    const recordId = decodeURIComponent(calendarMatch[1]);
    if (request.method === "PATCH") {
      return jsonResponse({
        event: await updateAcademyCalendarEvent(env.DB, context, recordId, await readJsonBody(request)),
      });
    }
    if (request.method === "DELETE") {
      return jsonResponse(await deleteAcademyCalendarEvent(env.DB, context, recordId));
    }
  }

  if (url.pathname === "/api/data-core/records" && request.method === "GET") {
    if (!env.DB) throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");
    return jsonResponse({ records: await listDataRecords(env.DB, context, url) });
  }

  if (url.pathname === "/api/data-core/records" && request.method === "POST") {
    if (!env.DB) throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");
    return jsonResponse(
      { record: await createDataRecord(env.DB, context, await readJsonBody(request)) },
      { status: 201 },
    );
  }

  const contentMatch = url.pathname.match(/^\/api\/data-core\/records\/([^/]+)\/content$/);
  if (contentMatch) {
    const recordId = decodeURIComponent(contentMatch[1]);
    if (!env.DB) throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");
    if (request.method === "GET") {
      return jsonResponse({ content: await getDataRecordContent(env.DB, context, recordId) });
    }
    if (request.method === "PUT" || request.method === "PATCH") {
      const body = (await readJsonBody(request)) as { content?: unknown };
      return jsonResponse({
        content: await setDataRecordContent(env.DB, context, recordId, body.content),
      });
    }
  }

  const recordMatch = url.pathname.match(/^\/api\/data-core\/records\/([^/]+)$/);
  if (recordMatch) {
    const recordId = decodeURIComponent(recordMatch[1]);
    if (!env.DB) throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");

    if (request.method === "GET") {
      return jsonResponse({ record: await getDataRecord(env.DB, context, recordId) });
    }
    if (request.method === "PATCH") {
      return jsonResponse({
        record: await updateDataRecord(env.DB, context, recordId, await readJsonBody(request)),
      });
    }
    if (request.method === "DELETE") {
      return jsonResponse(await deleteDataRecord(env.DB, context, recordId));
    }
  }

  if (url.pathname === "/api/data-core/files" && request.method === "GET") {
    if (!env.DB) throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");
    return jsonResponse({ files: await listDataCoreFiles(env.DB, context, url) });
  }

  if (
    (url.pathname === "/api/data-core/files" || url.pathname === "/api/data-core/upload") &&
    request.method === "POST"
  ) {
    if (!env.DB || !env.FILES) {
      throw new DataCoreAccessError(503, "DATA CORE의 D1과 R2가 모두 연결되어야 합니다.");
    }
    return jsonResponse(
      { file: await uploadDataCoreFile(request, env.DB, env.FILES, context) },
      { status: 201 },
    );
  }

  const fileMatch = url.pathname.match(/^\/api\/data-core\/files\/([^/]+)$/);
  if (fileMatch) {
    const fileId = decodeURIComponent(fileMatch[1]);
    if (!env.DB || !env.FILES) {
      throw new DataCoreAccessError(503, "DATA CORE의 D1과 R2가 모두 연결되어야 합니다.");
    }
    if (request.method === "GET") {
      return readDataCoreFile(env.DB, env.FILES, context, fileId);
    }
    if (request.method === "DELETE") {
      if (url.searchParams.has('awardFolderId') && request.headers.get('origin') !== url.origin) {
        throw new DataCoreAccessError(403, '동일 출처 요청만 허용됩니다.');
      }
      return jsonResponse(await deleteDataCoreFile(env.DB, env.FILES, context, fileId,
        url.searchParams.has('awardFolderId') ? url.searchParams.get('awardFolderId') || '' : undefined));
    }
  }

  if (url.pathname === "/api/data-core/admin/users" && request.method === "GET") {
    if (!env.DB) throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");
    return jsonResponse({ users: await listDataCoreUsers(env.DB, context) });
  }

  if (url.pathname === "/api/data-core/admin/memberships" && request.method === "GET") {
    if (!env.DB) throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");
    return jsonResponse({ memberships: await listDataCoreMemberships(env.DB, context) });
  }

  if (url.pathname === "/api/data-core/admin/memberships" && request.method === "POST") {
    if (!env.DB) throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");
    return jsonResponse(
      { membership: await upsertDataCoreMembership(env.DB, context, await readJsonBody(request)) },
      { status: 201 },
    );
  }

  const membershipMatch = url.pathname.match(/^\/api\/data-core\/admin\/memberships\/([^/]+)$/);
  if (membershipMatch && request.method === "DELETE") {
    if (!env.DB) throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");
    return jsonResponse(
      await deleteDataCoreMembership(
        env.DB,
        context,
        decodeURIComponent(membershipMatch[1]),
      ),
    );
  }

  return null;
}

async function handleApi(request: Request, env: Env) {
  const url = new URL(request.url);
  const artworkResponse = await handleAdmissionsArtworks(request, env);
  if (artworkResponse) return artworkResponse;

  if (url.pathname.startsWith("/api/data-core/")) {
    try {
      return await handleDataCoreApi(request, env);
    } catch (error) {
      if (error instanceof DataCoreAccessError) {
        return jsonResponse({ error: error.message }, { status: error.status });
      }
      console.error("DATA CORE API error", error);
      return jsonResponse({ error: "DATA CORE 처리 중 오류가 발생했습니다." }, { status: 500 });
    }
  }

  if (url.pathname === "/api/data" && request.method === "GET") {
    return jsonResponse(await readAppData(request, env));
  }

  if (url.pathname === "/api/data" && request.method === "PUT") {
    const data = await request.json();
    await saveAppData(env, data);
    return jsonResponse({ ok: true });
  }

  if (url.pathname === "/api/upload" && request.method === "POST") {
    return handleUpload(request, env);
  }

  if (url.pathname.startsWith("/api/files/") && request.method === "GET") {
    return handleFile(request, env);
  }

  return null;
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const apiResponse = await handleApi(request, env);
    if (apiResponse) return apiResponse;

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return appShell();
    }

    return fetchAsset(request, env);
  },
};

export default worker;
