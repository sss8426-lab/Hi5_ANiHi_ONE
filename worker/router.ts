import baseWorker from "./index";
import {
  DataCoreAccessError,
  resolveDataCoreAccess,
} from "./data-core-access";
import {
  createDataCoreBackup,
  listDataCoreBackups,
  readBackupManifest,
} from "./data-core-backup";
import {
  createCompetition,
  createCompetitionResult,
  deleteCompetition,
  getCompetition,
  listCompetitionResults,
  listCompetitions,
  updateCompetition,
  type CompetitionInput,
  type CompetitionResultInput,
} from "./data-core-competitions";
import {
  createContentDraft,
  deleteContentDraft,
  getContentDraft,
  listContentDrafts,
  updateContentDraft,
  type ContentDraftInput,
} from "./data-core-content";
import { runDataCoreDiagnostics } from "./data-core-diagnostics";
import {
  listDataCoreFiles,
  listDeletedDataCoreFiles,
  purgeDataCoreFile,
  restoreDataCoreFile,
  uploadDataCoreFile,
} from "./data-core-files";
import { ensureDataCoreMigrations } from "./data-core-migrations";

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

async function handleFileMetadataApi(request: Request, env: Env) {
  const url = new URL(request.url);
  const isListPath = url.pathname === "/api/data-core/files";
  const isUploadPath =
    url.pathname === "/api/data-core/upload" ||
    (url.pathname === "/api/data-core/files" && request.method === "POST");
  if (!isListPath && !isUploadPath) return null;
  if (!env.DB) {
    throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");
  }

  const context = await resolveDataCoreAccess(
    request,
    env.DB,
    env.DATA_CORE_SUPER_ADMIN_EMAILS,
  );
  await ensureDataCoreMigrations(env.DB);

  if (isUploadPath && request.method === "POST") {
    if (!env.FILES) {
      throw new DataCoreAccessError(503, "DATA CORE R2 저장소가 연결되지 않았습니다.");
    }
    const uploaded = await uploadDataCoreFile(request, env.DB, env.FILES, context);
    const sourceApp = String(uploaded.sourceApp || "data-core").trim().slice(0, 80) || "data-core";
    await env.DB
      .prepare("UPDATE file_objects SET source_app = ? WHERE id = ?")
      .bind(sourceApp, uploaded.id)
      .run();
    return jsonResponse({ file: { ...uploaded, sourceApp } }, { status: 201 });
  }

  if (isListPath && request.method === "GET") {
    const files = await listDataCoreFiles(env.DB, context, url);
    return jsonResponse({ files });
  }

  return null;
}

async function handleDiagnosticsApi(request: Request, env: Env) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/data-core/admin/diagnostics/run") return null;
  if (request.method !== "POST") {
    return jsonResponse({ error: "지원하지 않는 진단 API 요청입니다." }, { status: 405 });
  }
  if (!env.DB || !env.FILES) {
    throw new DataCoreAccessError(503, "DATA CORE의 D1과 R2가 모두 연결되어야 합니다.");
  }

  const context = await resolveDataCoreAccess(
    request,
    env.DB,
    env.DATA_CORE_SUPER_ADMIN_EMAILS,
  );
  return jsonResponse({ diagnostics: await runDataCoreDiagnostics(env.DB, env.FILES, context) });
}

async function handleBackupApi(request: Request, env: Env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/data-core/admin/backups")) return null;
  if (!env.DB || !env.FILES) {
    throw new DataCoreAccessError(503, "DATA CORE의 D1과 R2가 모두 연결되어야 합니다.");
  }

  const context = await resolveDataCoreAccess(
    request,
    env.DB,
    env.DATA_CORE_SUPER_ADMIN_EMAILS,
  );

  if (url.pathname === "/api/data-core/admin/backups") {
    if (request.method === "GET") {
      return jsonResponse({ backups: await listDataCoreBackups(env.DB, context) });
    }
    if (request.method === "POST") {
      return jsonResponse(
        { backup: await createDataCoreBackup(env.DB, env.FILES, context) },
        { status: 201 },
      );
    }
  }

  const manifestMatch = url.pathname.match(
    /^\/api\/data-core\/admin\/backups\/([^/]+)\/manifest$/,
  );
  if (manifestMatch && request.method === "GET") {
    return readBackupManifest(
      env.DB,
      env.FILES,
      context,
      decodeURIComponent(manifestMatch[1]),
    );
  }

  return jsonResponse({ error: "지원하지 않는 백업 API 요청입니다." }, { status: 405 });
}

async function handleTrashApi(request: Request, env: Env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/data-core/trash/files")) return null;
  if (!env.DB || !env.FILES) {
    throw new DataCoreAccessError(503, "DATA CORE의 D1과 R2가 모두 연결되어야 합니다.");
  }

  const context = await resolveDataCoreAccess(
    request,
    env.DB,
    env.DATA_CORE_SUPER_ADMIN_EMAILS,
  );

  if (url.pathname === "/api/data-core/trash/files" && request.method === "GET") {
    return jsonResponse({ files: await listDeletedDataCoreFiles(env.DB, context, url) });
  }

  const restoreMatch = url.pathname.match(/^\/api\/data-core\/trash\/files\/([^/]+)\/restore$/);
  if (restoreMatch && request.method === "POST") {
    return jsonResponse(
      await restoreDataCoreFile(
        env.DB,
        env.FILES,
        context,
        decodeURIComponent(restoreMatch[1]),
      ),
    );
  }

  const purgeMatch = url.pathname.match(/^\/api\/data-core\/trash\/files\/([^/]+)$/);
  if (purgeMatch && request.method === "DELETE") {
    return jsonResponse(
      await purgeDataCoreFile(
        env.DB,
        env.FILES,
        context,
        decodeURIComponent(purgeMatch[1]),
      ),
    );
  }

  return jsonResponse({ error: "지원하지 않는 휴지통 API 요청입니다." }, { status: 405 });
}

async function handleCompetitionApi(request: Request, env: Env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/data-core/competitions")) return null;
  if (!env.DB) {
    throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");
  }

  const context = await resolveDataCoreAccess(
    request,
    env.DB,
    env.DATA_CORE_SUPER_ADMIN_EMAILS,
  );

  if (url.pathname === "/api/data-core/competitions") {
    if (request.method === "GET") {
      return jsonResponse({ competitions: await listCompetitions(env.DB, context, url) });
    }
    if (request.method === "POST") {
      return jsonResponse(
        {
          competition: await createCompetition(
            env.DB,
            context,
            await readJson<CompetitionInput>(request),
          ),
        },
        { status: 201 },
      );
    }
  }

  const resultsMatch = url.pathname.match(
    /^\/api\/data-core\/competitions\/([^/]+)\/results$/,
  );
  if (resultsMatch) {
    const competitionId = decodeURIComponent(resultsMatch[1]);
    if (request.method === "GET") {
      return jsonResponse({
        results: await listCompetitionResults(env.DB, context, competitionId, url),
      });
    }
    if (request.method === "POST") {
      return jsonResponse(
        {
          result: await createCompetitionResult(
            env.DB,
            context,
            competitionId,
            await readJson<CompetitionResultInput>(request),
          ),
        },
        { status: 201 },
      );
    }
  }

  const competitionMatch = url.pathname.match(/^\/api\/data-core\/competitions\/([^/]+)$/);
  if (competitionMatch) {
    const competitionId = decodeURIComponent(competitionMatch[1]);
    if (request.method === "GET") {
      return jsonResponse({
        competition: await getCompetition(env.DB, context, competitionId),
      });
    }
    if (request.method === "PATCH") {
      return jsonResponse({
        competition: await updateCompetition(
          env.DB,
          context,
          competitionId,
          await readJson<CompetitionInput>(request),
        ),
      });
    }
    if (request.method === "DELETE") {
      return jsonResponse(await deleteCompetition(env.DB, context, competitionId));
    }
  }

  return jsonResponse({ error: "지원하지 않는 공모전 API 요청입니다." }, { status: 405 });
}

async function handleContentApi(request: Request, env: Env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/data-core/content")) return null;
  if (!env.DB) {
    throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");
  }

  const context = await resolveDataCoreAccess(
    request,
    env.DB,
    env.DATA_CORE_SUPER_ADMIN_EMAILS,
  );

  if (url.pathname === "/api/data-core/content") {
    if (request.method === "GET") {
      return jsonResponse({ drafts: await listContentDrafts(env.DB, context, url) });
    }
    if (request.method === "POST") {
      return jsonResponse(
        {
          draft: await createContentDraft(
            env.DB,
            context,
            await readJson<ContentDraftInput>(request),
          ),
        },
        { status: 201 },
      );
    }
  }

  const draftMatch = url.pathname.match(/^\/api\/data-core\/content\/([^/]+)$/);
  if (draftMatch) {
    const draftId = decodeURIComponent(draftMatch[1]);
    if (request.method === "GET") {
      return jsonResponse({ draft: await getContentDraft(env.DB, context, draftId) });
    }
    if (request.method === "PATCH") {
      return jsonResponse({
        draft: await updateContentDraft(
          env.DB,
          context,
          draftId,
          await readJson<ContentDraftInput>(request),
        ),
      });
    }
    if (request.method === "DELETE") {
      return jsonResponse(await deleteContentDraft(env.DB, context, draftId));
    }
  }

  return jsonResponse({ error: "지원하지 않는 콘텐츠 API 요청입니다." }, { status: 405 });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET") {
      if (
        url.pathname === "/data-core" ||
        url.pathname === "/data-core/" ||
        url.pathname === "/data-core/counseling" ||
        url.pathname === "/data-core/counseling/" ||
        url.pathname === "/data-core/counseling/competitions" ||
        url.pathname === "/data-core/counseling/competitions/" ||
        url.pathname === "/data-core/work" ||
        url.pathname === "/data-core/work/" ||
        url.pathname === "/data-core/work/library" ||
        url.pathname === "/data-core/work/library/"
      ) {
        url.pathname = "/data-core/index.html";
        return baseWorker.fetch(
          new Request(url.toString(), { headers: request.headers }),
          env,
        );
      }
      if (
        url.pathname === "/data-core/operations" ||
        url.pathname === "/data-core/operations/"
      ) {
        url.pathname = "/data-core/operations.html";
        return baseWorker.fetch(
          new Request(url.toString(), { headers: request.headers }),
          env,
        );
      }
      if (
        url.pathname === "/data-core/content" ||
        url.pathname === "/data-core/content/" ||
        url.pathname === "/data-core/content/blog" ||
        url.pathname === "/data-core/content/instagram"
      ) {
        url.pathname = "/data-core/content.html";
        return baseWorker.fetch(
          new Request(url.toString(), { headers: request.headers }),
          env,
        );
      }
    }

    try {
      const fileMetadataResponse = await handleFileMetadataApi(request, env);
      if (fileMetadataResponse) return fileMetadataResponse;

      const diagnosticsResponse = await handleDiagnosticsApi(request, env);
      if (diagnosticsResponse) return diagnosticsResponse;

      const backupResponse = await handleBackupApi(request, env);
      if (backupResponse) return backupResponse;

      const trashResponse = await handleTrashApi(request, env);
      if (trashResponse) return trashResponse;

      const competitionResponse = await handleCompetitionApi(request, env);
      if (competitionResponse) return competitionResponse;

      const contentResponse = await handleContentApi(request, env);
      if (contentResponse) return contentResponse;
    } catch (error) {
      if (error instanceof DataCoreAccessError) {
        return jsonResponse({ error: error.message }, { status: error.status });
      }
      console.error("DATA CORE domain router error", error);
      return jsonResponse(
        { error: "DATA CORE 요청을 처리하는 중 오류가 발생했습니다." },
        { status: 500 },
      );
    }

    return baseWorker.fetch(request, env);
  },
};

export default worker;
