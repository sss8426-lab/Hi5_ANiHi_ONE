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
  importCompetitionSource,
  previewCompetitionSource,
} from "./data-core-competition-sources";
import {
  createContentDraft,
  deleteContentDraft,
  getContentDraft,
  listContentDrafts,
  updateContentDraft,
  type ContentDraftInput,
} from "./data-core-content";
import {
  generateContentDraft as generateContentWithProvider,
  type ContentGenerationInput,
} from "./data-core-content-generation";
import { runDataCoreDiagnostics } from "./data-core-diagnostics";
import {
  listDataCoreFiles,
  listDeletedDataCoreFiles,
  purgeDataCoreFile,
  restoreDataCoreFile,
  uploadDataCoreFile,
} from "./data-core-files";
import { ensureDataCoreMigrations } from "./data-core-migrations";
import {
  AUTH_COOKIE_NAME,
  changeStandalonePassword,
  createStandaloneAccount,
  listStandaloneAccounts,
  loginStandalone,
  logoutStandalone,
  updateStandaloneAccount,
  recordStandaloneActivity,
} from "./data-core-auth";
import { campusPresence } from './campus-presence';
import { handleKkumeumApi } from "./kkumeum-router";
import { aiModels, boundedJson, ContentAiError, editInstagramImage, openAiContentProvider, unavailable, type OpenAiEnv } from './content-openai-provider';
import { contentDefaults, contentScope, withAiRequest } from './content-ai-settings';
import { AI_PHOTO_LIMIT } from './content-ai-images';

interface Env extends OpenAiEnv {
  ASSETS?: Fetcher;
  DB?: D1Database;
  FILES?: R2Bucket;
  FAMILY_DB?: D1Database;
  FAMILY_FILES?: R2Bucket;
  DATA_CORE_SUPER_ADMIN_EMAILS?: string;
}

function jsonResponse(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "private, no-store");
  return new Response(JSON.stringify(value), { ...init, headers });
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new DataCoreAccessError(400, "JSON 요청 형식이 올바르지 않습니다.");
  }
}

function loginPageResponse(request: Request, env: Env, nextPath: string) {
  const loginUrl = new URL(request.url);
  loginUrl.pathname = "/data-core/login.html";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", nextPath);
  return baseWorker.fetch(new Request(loginUrl.toString(), { headers: request.headers }), env);
}

function isProtectedDataCoreUiPath(pathname: string) {
  return (
    pathname === "/data-core/work" ||
    pathname.startsWith("/data-core/work/") ||
    pathname === "/data-core/kkumeum" ||
    pathname === "/data-core/kkumeum/" ||
    pathname === "/data-core/accounts" ||
    pathname === "/data-core/accounts/" ||
    pathname === "/data-core/accounts.html" ||
    pathname === "/data-core/operations" ||
    pathname === "/data-core/operations/" ||
    pathname === "/data-core/operations.html" ||
    pathname === "/data-core/content" ||
    pathname === "/data-core/content/" ||
    pathname.startsWith("/data-core/content/") ||
    pathname === "/data-core/content.html" ||
    pathname === "/data-core/roadmap" ||
    pathname === "/data-core/roadmap/" ||
    pathname === "/data-core/roadmap.html" ||
    pathname === "/data-core/readiness" ||
    pathname === "/data-core/readiness/" ||
    pathname === "/data-core/readiness.html"
  );
}

async function dataCoreIndexResponse(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = "/data-core/index.html";
  const response = await baseWorker.fetch(new Request(url.toString(), { headers: request.headers }), env);
  if (!response.ok) return response;
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html")) return response;
  const html = await response.text();
  const scriptTag = '<script src="/data-core/work/kkumeum-nav.js?v=20260908-mode-home"></script>';
  const body = html.includes("/data-core/work/kkumeum-nav.js")
    ? html
    : html.replace("</body>", `${scriptTag}\n</body>`);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("cache-control", "no-store");
  return new Response(body, { status: response.status, headers });
}

async function handleStandaloneAuthApi(request: Request, env: Env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/auth/")) return null;
  if (!env.DB) throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");
  await ensureDataCoreMigrations(env.DB);
  const context = await resolveDataCoreAccess(request, env.DB, env.DATA_CORE_SUPER_ADMIN_EMAILS);
  const passwordChangeRoute =
    (url.pathname === "/api/auth/session" && request.method === "GET") ||
    (url.pathname === "/api/auth/password" && request.method === "PUT") ||
    (url.pathname === "/api/auth/logout" && request.method === "POST");
  if (context.mustChangePassword && !passwordChangeRoute) {
    throw new DataCoreAccessError(403, "첫 로그인 비밀번호를 먼저 변경하세요.");
  }
  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    const result = await loginStandalone(env.DB, request, await readJson<{ loginId?: unknown; password?: unknown }>(request));
    return jsonResponse(
      { authenticated: true, mustChangePassword: result.mustChangePassword, expiresAt: result.session.expiresAt },
      { headers: { "set-cookie": `${AUTH_COOKIE_NAME}=${result.session.rawToken}; Max-Age=28800; Path=/; Secure; HttpOnly; SameSite=Lax` } },
    );
  }
  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    const result = await logoutStandalone(env.DB, request);
    return jsonResponse({ ok: true }, { headers: result.headers });
  }
  if (url.pathname === "/api/auth/session" && request.method === "GET") return jsonResponse(context);
  if (url.pathname === '/api/auth/activity' && request.method === 'POST') return jsonResponse(await recordStandaloneActivity(env.DB, request, context));
  if (url.pathname === '/api/auth/campuses' && request.method === 'GET') return jsonResponse(await campusPresence(env.DB, context));
  if (url.pathname === "/api/auth/password" && request.method === "PUT") {
    const result = await changeStandalonePassword(env.DB, request, context, await readJson(request));
    return jsonResponse({ ok: true }, { headers: { "set-cookie": `${AUTH_COOKIE_NAME}=${result.session.rawToken}; Max-Age=28800; Path=/; Secure; HttpOnly; SameSite=Lax` } });
  }
  if (url.pathname === "/api/auth/accounts" && request.method === "GET") {
    return jsonResponse({ accounts: await listStandaloneAccounts(env.DB, context) });
  }
  if (url.pathname === "/api/auth/accounts" && request.method === "POST") {
    return jsonResponse({ account: await createStandaloneAccount(env.DB, request, context, await readJson(request)) }, { status: 201 });
  }
  const accountMatch = url.pathname.match(/^\/api\/auth\/accounts\/([^/]+)$/);
  if (accountMatch && request.method === "PATCH") {
    return jsonResponse(await updateStandaloneAccount(env.DB, request, context, decodeURIComponent(accountMatch[1]), await readJson(request)));
  }
  return jsonResponse({ error: "지원하지 않는 인증 API 요청입니다." }, { status: 405 });
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
    return jsonResponse({ file: uploaded }, { status: 201 });
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

async function handleCompetitionSourceApi(request: Request, env: Env) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/data-core\/competition-sources\/(artmd|mgood)\/(preview|import)$/);
  if (!match) return null;
  if (!env.DB) throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");
  if (request.method !== "POST") return jsonResponse({ error: "지원하지 않는 외부 소식 요청입니다." }, { status: 405 });
  const context = await resolveDataCoreAccess(request, env.DB, env.DATA_CORE_SUPER_ADMIN_EMAILS);
  const body = match[2] === "preview"
    ? await previewCompetitionSource(env.DB, context, match[1])
    : await importCompetitionSource(request, env.DB, context, match[1]);
  return jsonResponse(body, { headers: { "cache-control": "private, no-store" } });
}

async function contentJson(request: Request) {
  try {
    const value = await boundedJson(new Response(request.body), 16384);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new DataCoreAccessError(400, 'AI 요청 형식과 길이를 확인해주세요.'); }
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
  if (!['GET','HEAD'].includes(request.method) && (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site')) {
    throw new DataCoreAccessError(context.authenticated ? 403 : 401, '같은 사이트에서만 요청할 수 있습니다.');
  }
  if (url.pathname === '/api/data-core/content/ai-status' && request.method === 'GET') {
    if (!context.authenticated) throw new DataCoreAccessError(401, '로그인이 필요합니다.');
    if (!context.isSuperAdmin) throw new DataCoreAccessError(403, '마스터 관리자만 확인할 수 있습니다.');
    return jsonResponse({ configured: Boolean(env.OPENAI_API_KEY), models: aiModels(env), photoLimit: AI_PHOTO_LIMIT });
  }
  if (url.pathname === '/api/data-core/content/defaults') {
    if (request.method === 'GET') return jsonResponse({ defaults: await contentDefaults(env.DB, context, Object.fromEntries(url.searchParams)) });
    if (request.method === 'PUT') return jsonResponse({ defaults: await contentDefaults(env.DB, context, await contentJson(request), true) });
  }

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

  if (url.pathname === "/api/data-core/content/generate") {
    if (request.method !== "POST") {
      return jsonResponse({ error: "지원하지 않는 콘텐츠 생성 API 요청입니다." }, { status: 405 });
    }
    const input = await contentJson(request) as ContentGenerationInput;
    const scope = contentScope(context, input);
    const provider = env.FILES ? openAiContentProvider(env, env.DB, env.FILES, context, request.signal) : undefined;
    try {
      const run = () => generateContentWithProvider(env.DB!, context, input, provider);
      const generation = provider ? await withAiRequest(env.DB, context, input.requestId, scope.campusId, run) : await run();
      return jsonResponse(generation, { status: generation.available ? 200 : 503 });
    } catch (error) {
      if (error instanceof ContentAiError) return jsonResponse({ error: error.message, code: error.code }, { status: error.status });
      throw error;
    }
  }
  if (url.pathname === '/api/data-core/content/image-edit' && request.method === 'POST') {
    const input = await contentJson(request);
    const { campusId, sourceApp } = contentScope(context, input);
    if (sourceApp !== 'instagram' || typeof input.sourceFileId !== 'string' || input.sourceFileId.length > 120 || typeof input.direction !== 'string' || !input.direction.trim() || input.direction.length > 4000) throw new DataCoreAccessError(400, '대표 사진 1장과 홍보 방향을 입력하세요.');
    try {
      if (!env.FILES || !env.OPENAI_API_KEY) throw unavailable();
      const file = await withAiRequest(env.DB, context, input.requestId, campusId, () => editInstagramImage(env, env.DB!, env.FILES!, context, input.sourceFileId, campusId, input.direction, request.signal));
      return jsonResponse({ file }, { status: 201 });
    } catch (error) {
      if (error instanceof ContentAiError) return jsonResponse({ error: error.message, code: error.code }, { status: error.status });
      throw error;
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
      if (url.pathname === "/login" || url.pathname === "/data-core/login") {
        url.pathname = "/data-core/login.html";
        return baseWorker.fetch(new Request(url.toString(), { headers: request.headers }), env);
      }
      if (
        env.DB &&
        isProtectedDataCoreUiPath(url.pathname)
      ) {
        const context = await resolveDataCoreAccess(request, env.DB, env.DATA_CORE_SUPER_ADMIN_EMAILS);
        if (!context.authenticated || context.mustChangePassword) {
          return loginPageResponse(request, env, (url.pathname.replace(/\/$/, "") || "/data-core/work") + url.search);
        }
        if (/^\/data-core\/(accounts|operations|readiness)(?:\/|\.html)?$/.test(url.pathname) && !context.isSuperAdmin) {
          return new Response('마스터 관리자만 접근할 수 있습니다.', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
        }
      }
      if (url.pathname === "/data-core/kkumeum" || url.pathname === "/data-core/kkumeum/") {
        url.pathname = "/data-core/work/kkumeum.html";
        return baseWorker.fetch(new Request(url.toString(), { headers: request.headers }), env);
      }
      if (
        url.pathname === "/data-core" ||
        url.pathname === "/data-core/" ||
        url.pathname === "/data-core/counseling" ||
        url.pathname === "/data-core/counseling/" ||
        url.pathname === "/data-core/counseling/competitions" ||
        url.pathname === "/data-core/counseling/competitions/" ||
        /^\/data-core\/curriculum(?:\/(content|design)(?:\/(basic|advanced|admission))?)?\/?$/.test(url.pathname) ||
        url.pathname === "/data-core/work" ||
        url.pathname === "/data-core/work/" ||
        url.pathname === "/data-core/work/library" ||
        url.pathname === "/data-core/work/library/"
      ) {
        return dataCoreIndexResponse(request, env);
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
      if (url.pathname === "/data-core/accounts" || url.pathname === "/data-core/accounts/") {
        url.pathname = "/data-core/accounts.html";
        return baseWorker.fetch(new Request(url.toString(), { headers: request.headers }), env);
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
      const authResponse = await handleStandaloneAuthApi(request, env);
      if (authResponse) return authResponse;

      if (url.pathname.startsWith("/api/kkumeum")) {
        if (!env.DB) {
          throw new DataCoreAccessError(503, "CORE 인증 데이터베이스가 연결되지 않았습니다.");
        }
        const context = await resolveDataCoreAccess(request, env.DB, env.DATA_CORE_SUPER_ADMIN_EMAILS);
        const kkumeumResponse = await handleKkumeumApi(request, env, context, jsonResponse);
        if (kkumeumResponse) return kkumeumResponse;
      }

      if (env.DB && url.pathname.startsWith("/api/data-core/") && url.pathname !== "/api/data-core/health") {
        const context = await resolveDataCoreAccess(request, env.DB, env.DATA_CORE_SUPER_ADMIN_EMAILS);
        if (context.mustChangePassword) {
          throw new DataCoreAccessError(403, "첫 로그인 비밀번호를 먼저 변경하세요.");
        }
      }

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

      const competitionSourceResponse = await handleCompetitionSourceApi(request, env);
      if (competitionSourceResponse) return competitionSourceResponse;

      const contentResponse = await handleContentApi(request, env);
      if (contentResponse) return contentResponse;
    } catch (error) {
      if (error instanceof DataCoreAccessError) {
        return jsonResponse({ error: error.message }, { status: error.status });
      }
      if (url.pathname.startsWith('/api/data-core/content')) console.error('DATA CORE content error', { code: 'internal_error' });
      else console.error("DATA CORE domain router error", error);
      return jsonResponse(
        { error: "DATA CORE 요청을 처리하는 중 오류가 발생했습니다." },
        { status: 500 },
      );
    }

    return baseWorker.fetch(request, env);
  },
};

export default worker;
