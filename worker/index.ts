/** Cloudflare Worker entry point for the admissions consulting web app. */
import {
  dataCoreContext,
  dataCoreHealth,
  fileAreaForPurpose,
  recordFileObject,
  visibilityForArea,
} from "./data-core";

const STATE_ID = "main";
const STATE_OBJECT_KEY = "state/admissions-data.json";

interface Env {
  ASSETS?: Fetcher;
  DB?: D1Database;
  FILES?: R2Bucket;
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
    <title>입시 컨설팅</title>
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
    <iframe src="/admissions-web/renderer/index.html" title="입시 컨설팅"></iframe>
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
  const object = await env.FILES.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=3600");
  return new Response(object.body, { headers });
}

async function handleApi(request: Request, env: Env) {
  const url = new URL(request.url);

  if (url.pathname === "/api/data-core/health" && request.method === "GET") {
    return jsonResponse(await dataCoreHealth(env.DB, env.FILES));
  }

  if (url.pathname === "/api/data-core/context" && request.method === "GET") {
    return jsonResponse(await dataCoreContext(request, env.DB));
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
