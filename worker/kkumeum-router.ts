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
  createMonthlyReport,
  generateMonthlyReportDraft,
  getMonthlyReport,
  listMonthlyReportRevisions,
  listMonthlyReports,
  reviseSentMonthlyReport,
  transitionMonthlyReport,
  updateMonthlyReport,
} from "./kkumeum-reports";
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

function requiredStudentId(url: URL): string {
  const studentId = String(url.searchParams.get("studentId") || "").trim().slice(0, 120);
  if (!studentId) throw new DataCoreAccessError(400, "studentId가 필요합니다.");
  return studentId;
}

function requireKkumeumBindingsReady(
  context: DataCoreAccessContext,
  env: KkumeumRouterEnv,
): void {
  const status = kkumeumBindingStatus(context, env);
  if (status.ok) return;
  throw new DataCoreAccessError(
    503,
    "꿈이음 전용 FAMILY_DB/FAMILY_FILES 연결이 아직 완료되지 않았습니다. 학생·보호자 데이터는 기존 DATA CORE에 대신 저장하지 않습니다.",
  );
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

  requireKkumeumBindingsReady(context, env);
  const familyDb = requireFamilyDatabase(context, env.FAMILY_DB);

  if (url.pathname === "/api/kkumeum/reports/generate") {
    if (request.method !== "POST") {
      return jsonResponse({ error: "지원하지 않는 월간평가 AI 초안 요청입니다." }, { status: 405 });
    }
    const generation = await generateMonthlyReportDraft(
      familyDb,
      context,
      await readJson(request),
    );
    return jsonResponse(generation, { status: generation.available ? 200 : 503 });
  }

  if (url.pathname === "/api/kkumeum/reports") {
    if (request.method === "GET") {
      return jsonResponse({
        reports: await listMonthlyReports(
          familyDb,
          context,
          requiredCampusId(url),
          requiredStudentId(url),
        ),
      });
    }
    if (request.method === "POST") {
      return jsonResponse(
        { report: await createMonthlyReport(familyDb, context, await readJson(request)) },
        { status: 201 },
      );
    }
    return jsonResponse({ error: "지원하지 않는 월간평가 요청입니다." }, { status: 405 });
  }

  const reportActionMatch = url.pathname.match(
    /^\/api\/kkumeum\/reports\/([^/]+)\/(ready|draft|send|revise|revisions)$/,
  );
  if (reportActionMatch) {
    const reportId = decodeURIComponent(reportActionMatch[1]);
    const action = reportActionMatch[2];
    if (action === "revisions" && request.method === "GET") {
      return jsonResponse({ revisions: await listMonthlyReportRevisions(familyDb, context, reportId) });
    }
    if (action === "revise" && request.method === "POST") {
      return jsonResponse(await reviseSentMonthlyReport(familyDb, context, reportId, await readJson(request)));
    }
    if ((action === "ready" || action === "draft" || action === "send") && request.method === "POST") {
      const target = action === "send" ? "sent" : action;
      return jsonResponse({ report: await transitionMonthlyReport(familyDb, context, reportId, target) });
    }
    return jsonResponse({ error: "지원하지 않는 월간평가 상태 요청입니다." }, { status: 405 });
  }

  const reportMatch = url.pathname.match(/^\/api\/kkumeum\/reports\/([^/]+)$/);
  if (reportMatch) {
    const reportId = decodeURIComponent(reportMatch[1]);
    if (request.method === "GET") {
      return jsonResponse({ report: await getMonthlyReport(familyDb, context, reportId) });
    }
    if (request.method === "PATCH") {
      return jsonResponse({ report: await updateMonthlyReport(familyDb, context, reportId, await readJson(request)) });
    }
    return jsonResponse({ error: "지원하지 않는 월간평가 요청입니다." }, { status: 405 });
  }

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
