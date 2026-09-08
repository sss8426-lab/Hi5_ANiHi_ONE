import dataCoreWorker from "./admissions-knowledge-router";
import { DataCoreAccessError } from "./data-core-access";
import {
  changeKkumeumGuardianPassword,
  kkumeumGuardianSessionIdentity,
  loginKkumeumGuardian,
  logoutKkumeumGuardian,
} from "./kkumeum-guardian-auth";
import {
  getGuardianChild,
  listGuardianChildArtworks,
  listGuardianChildReports,
  listGuardianChildren,
  readGuardianFamilyFile,
} from "./kkumeum-guardian-feed";
import {
  listGuardianNotices,
  markGuardianNoticeRead,
} from "./kkumeum-announcements";
import {
  guardianPushStatus,
  subscribeGuardianPush,
  unsubscribeGuardianPush,
} from "./kkumeum-push";

interface Env {
  ASSETS?: Fetcher;
  DB?: D1Database;
  FILES?: R2Bucket;
  FAMILY_DB?: D1Database;
  FAMILY_FILES?: R2Bucket;
  DATA_CORE_SUPER_ADMIN_EMAILS?: string;
  PUSH_VAPID_PUBLIC_KEY?: string;
  PUSH_VAPID_PRIVATE_JWK?: string;
  PUSH_VAPID_SUBJECT?: string;
  PUSH_SUBSCRIPTION_ENCRYPTION_KEY?: string;
}

function privateJsonResponse(value: unknown, init: ResponseInit = {}) {
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

async function handleFamilyGuardianAuthApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const prefix = "/api/family/auth/";
  if (!url.pathname.startsWith(prefix)) return null;
  if (!env.FAMILY_DB) {
    throw new DataCoreAccessError(
      503,
      "꿈이음 보호자 전용 FAMILY_DB 연결이 필요합니다.",
    );
  }

  if (url.pathname === "/api/family/auth/login" && request.method === "POST") {
    const result = await loginKkumeumGuardian(
      env.FAMILY_DB,
      request,
      await readJson<{ loginId?: unknown; password?: unknown }>(request),
    );
    return privateJsonResponse(
      {
        authenticated: true,
        guardianId: result.guardian.guardianId,
        displayName: result.guardian.displayName,
        mustChangePassword: result.guardian.mustChangePassword,
        expiresAt: result.expiresAt,
      },
      { headers: { "set-cookie": result.setCookie } },
    );
  }

  if (url.pathname === "/api/family/auth/change-password" && request.method === "POST") {
    const result = await changeKkumeumGuardianPassword(
      env.FAMILY_DB,
      request,
      await readJson<{ currentPassword?: unknown; newPassword?: unknown }>(request),
    );
    return privateJsonResponse(
      { ok: true, authenticated: true, mustChangePassword: false },
      { headers: { "set-cookie": result.setCookie } },
    );
  }

  if (url.pathname === "/api/family/auth/logout" && request.method === "POST") {
    const result = await logoutKkumeumGuardian(env.FAMILY_DB, request);
    return privateJsonResponse(
      { ok: true },
      { headers: { "set-cookie": result.setCookie } },
    );
  }

  if (url.pathname === "/api/family/auth/session" && request.method === "GET") {
    const identity = await kkumeumGuardianSessionIdentity(env.FAMILY_DB, request);
    if (!identity) return privateJsonResponse({ authenticated: false });
    return privateJsonResponse({
      authenticated: true,
      guardianId: identity.guardianId,
      displayName: identity.displayName,
      mustChangePassword: identity.mustChangePassword,
    });
  }

  return privateJsonResponse(
    { error: "지원하지 않는 꿈이음 보호자 인증 API 요청입니다." },
    { status: 405 },
  );
}

async function handleFamilyGuardianFeedApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/family/")) return null;
  if (url.pathname.startsWith("/api/family/auth/")) return null;
  if (!env.FAMILY_DB) {
    throw new DataCoreAccessError(503, "꿈이음 보호자 전용 FAMILY_DB 연결이 필요합니다.");
  }

  if (url.pathname === "/api/family/push/status" && request.method === "GET") {
    return privateJsonResponse(await guardianPushStatus(env.FAMILY_DB, request, env));
  }

  if (url.pathname === "/api/family/push/subscribe" && request.method === "POST") {
    return privateJsonResponse(await subscribeGuardianPush(env.FAMILY_DB, request, env, await readJson(request)));
  }

  if (url.pathname === "/api/family/push/unsubscribe" && request.method === "DELETE") {
    return privateJsonResponse(await unsubscribeGuardianPush(env.FAMILY_DB, request, await readJson(request)));
  }

  if (url.pathname === "/api/family/notices" && request.method === "GET") {
    return privateJsonResponse(await listGuardianNotices(env.FAMILY_DB, request));
  }

  const noticeReadMatch = url.pathname.match(/^\/api\/family\/notices\/([^/]+)\/read$/);
  if (noticeReadMatch && request.method === "POST") {
    return privateJsonResponse(await markGuardianNoticeRead(
      env.FAMILY_DB,
      request,
      decodeURIComponent(noticeReadMatch[1]),
    ));
  }

  if (url.pathname === "/api/family/children" && request.method === "GET") {
    return privateJsonResponse({ children: await listGuardianChildren(env.FAMILY_DB, request) });
  }

  const childReportsMatch = url.pathname.match(/^\/api\/family\/children\/([^/]+)\/reports$/);
  if (childReportsMatch && request.method === "GET") {
    const studentId = decodeURIComponent(childReportsMatch[1]);
    return privateJsonResponse({
      reports: await listGuardianChildReports(env.FAMILY_DB, request, studentId),
    });
  }

  const childArtworksMatch = url.pathname.match(/^\/api\/family\/children\/([^/]+)\/artworks$/);
  if (childArtworksMatch && request.method === "GET") {
    const studentId = decodeURIComponent(childArtworksMatch[1]);
    return privateJsonResponse({
      artworks: await listGuardianChildArtworks(env.FAMILY_DB, request, studentId),
    });
  }

  const childMatch = url.pathname.match(/^\/api\/family\/children\/([^/]+)$/);
  if (childMatch && request.method === "GET") {
    const studentId = decodeURIComponent(childMatch[1]);
    return privateJsonResponse({
      child: await getGuardianChild(env.FAMILY_DB, request, studentId),
    });
  }

  const fileMatch = url.pathname.match(/^\/api\/family\/files\/([^/]+)$/);
  if (fileMatch && request.method === "GET") {
    if (!env.FAMILY_FILES) {
      throw new DataCoreAccessError(503, "꿈이음 보호자 전용 FAMILY_FILES 연결이 필요합니다.");
    }
    return readGuardianFamilyFile(
      env.FAMILY_DB,
      env.FAMILY_FILES,
      request,
      decodeURIComponent(fileMatch[1]),
    );
  }

  return privateJsonResponse(
    { error: "지원하지 않는 꿈이음 보호자 조회 API 요청입니다." },
    { status: 405 },
  );
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const familyAuthResponse = await handleFamilyGuardianAuthApi(request, env);
      if (familyAuthResponse) return familyAuthResponse;

      const familyFeedResponse = await handleFamilyGuardianFeedApi(request, env);
      if (familyFeedResponse) return familyFeedResponse;
    } catch (error) {
      if (error instanceof DataCoreAccessError) {
        return privateJsonResponse({ error: error.message }, { status: error.status });
      }
      console.error("Kkumeum guardian router error", error);
      return privateJsonResponse(
        { error: "꿈이음 보호자 요청을 처리하는 중 오류가 발생했습니다." },
        { status: 500 },
      );
    }

    if (request.method === "GET") {
      const url = new URL(request.url);
      if (
        url.pathname === "/data-core/readiness" ||
        url.pathname === "/data-core/readiness/"
      ) {
        url.pathname = "/data-core/readiness.html";
        return dataCoreWorker.fetch(
          new Request(url.toString(), { headers: request.headers }),
          env,
        );
      }
    }
    return dataCoreWorker.fetch(request, env);
  },
};

export default worker;
