import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireAuthenticatedAccess,
} from "./data-core-access";
import {
  KkumeumBindings,
  kkumeumBindingStatus,
  requireFamilyDatabase,
} from "./kkumeum-core";
import {
  createKkumeumClass,
  createKkumeumStudent,
  getKkumeumStudent,
  listKkumeumClasses,
  listKkumeumStudents,
  updateKkumeumClass,
  updateKkumeumStudent,
} from "./kkumeum-staff";

export type KkumeumRouterEnv = KkumeumBindings;

type JsonResponder = (value: unknown, init?: ResponseInit) => Response;

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    throw new DataCoreAccessError(400, "JSON 요청 형식이 올바르지 않습니다.");
  }
}

function requiredCampusId(url: URL): string {
  const campusId = String(url.searchParams.get("campusId") || "").trim().slice(0, 120);
  if (!campusId) throw new DataCoreAccessError(400, "campusId가 필요합니다.");
  return campusId;
}

export async function handleKkumeumApi(
  request: Request,
  env: KkumeumRouterEnv,
  context: DataCoreAccessContext,
  jsonResponse: JsonResponder,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/kkumeum")) return null;
  requireAuthenticatedAccess(context);

  if (url.pathname === "/api/kkumeum/health") {
    if (request.method !== "GET") {
      return jsonResponse({ error: "지원하지 않는 꿈이음 health 요청입니다." }, { status: 405 });
    }
    const status = kkumeumBindingStatus(context, env);
    return jsonResponse({ status }, { status: status.ok ? 200 : 503 });
  }

  const familyDb = requireFamilyDatabase(context, env.FAMILY_DB);

  if (url.pathname === "/api/kkumeum/classes") {
    if (request.method === "GET") {
      const campusId = requiredCampusId(url);
      return jsonResponse({ classes: await listKkumeumClasses(familyDb, context, campusId) });
    }
    if (request.method === "POST") {
      return jsonResponse(
        { class: await createKkumeumClass(familyDb, context, await readJson(request)) },
        { status: 201 },
      );
    }
    return jsonResponse({ error: "지원하지 않는 꿈이음 반 요청입니다." }, { status: 405 });
  }

  const classMatch = url.pathname.match(/^\/api\/kkumeum\/classes\/([^/]+)$/);
  if (classMatch) {
    if (request.method !== "PATCH") {
      return jsonResponse({ error: "지원하지 않는 꿈이음 반 요청입니다." }, { status: 405 });
    }
    return jsonResponse({
      class: await updateKkumeumClass(
        familyDb,
        context,
        decodeURIComponent(classMatch[1]),
        await readJson(request),
      ),
    });
  }

  if (url.pathname === "/api/kkumeum/students") {
    if (request.method === "GET") {
      const campusId = requiredCampusId(url);
      return jsonResponse({
        students: await listKkumeumStudents(familyDb, context, campusId, {
          classId: url.searchParams.get("classId") || undefined,
          status: url.searchParams.get("status") || undefined,
          q: url.searchParams.get("q") || undefined,
        }),
      });
    }
    if (request.method === "POST") {
      return jsonResponse(
        { student: await createKkumeumStudent(familyDb, context, await readJson(request)) },
        { status: 201 },
      );
    }
    return jsonResponse({ error: "지원하지 않는 꿈이음 학생 요청입니다." }, { status: 405 });
  }

  const moveMatch = url.pathname.match(/^\/api\/kkumeum\/students\/([^/]+)\/move-class$/);
  if (moveMatch) {
    if (request.method !== "POST") {
      return jsonResponse({ error: "지원하지 않는 꿈이음 반 이동 요청입니다." }, { status: 405 });
    }
    const input = await readJson(request);
    return jsonResponse({
      student: await updateKkumeumStudent(
        familyDb,
        context,
        decodeURIComponent(moveMatch[1]),
        { classId: input.classId ?? null },
      ),
    });
  }

  const studentMatch = url.pathname.match(/^\/api\/kkumeum\/students\/([^/]+)$/);
  if (studentMatch) {
    const studentId = decodeURIComponent(studentMatch[1]);
    if (request.method === "GET") {
      return jsonResponse({ student: await getKkumeumStudent(familyDb, context, requiredCampusId(url), studentId) });
    }
    if (request.method === "PATCH") {
      return jsonResponse({
        student: await updateKkumeumStudent(familyDb, context, studentId, await readJson(request)),
      });
    }
    return jsonResponse({ error: "지원하지 않는 꿈이음 학생 요청입니다." }, { status: 405 });
  }

  return jsonResponse({ error: "지원하지 않는 꿈이음 API 요청입니다." }, { status: 405 });
}
