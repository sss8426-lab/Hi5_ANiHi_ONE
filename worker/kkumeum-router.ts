import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireAuthenticatedAccess,
} from "./data-core-access";
import {
  KkumeumBindings,
  kkumeumBindingStatus,
  requireFamilyDatabase,
  requireFamilyFiles,
} from "./kkumeum-core";
import {
  getKkumeumArtwork,
  listKkumeumArtworks,
  readKkumeumFamilyFile,
  restoreKkumeumArtwork,
  trashKkumeumArtwork,
  updateKkumeumArtwork,
  uploadKkumeumArtwork,
} from "./kkumeum-artworks";
import { requireKkumeumReportEditAccess } from "./kkumeum-report-access";
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
import {
  createStaffAnnouncementDraft,
  listStaffAnnouncements,
  publishStaffAnnouncement,
  updateStaffAnnouncementDraft,
} from "./kkumeum-staff-announcements";
import { getKkumeumDashboard } from "./kkumeum-dashboard";
import {
  createKkumeumGuardian,
  listKkumeumGuardians,
  revokeKkumeumGuardianSessions,
  resetKkumeumGuardianPassword,
  unlinkKkumeumGuardian,
  updateKkumeumGuardianLink,
} from "./kkumeum-guardian-admin";
import { assertKkumeumPilotCampus } from "./kkumeum-pilot";
import { dispatchGuardianAnnouncementPush, type KkumeumPushEnv } from "./kkumeum-push";

export type KkumeumRouterEnv = KkumeumBindings & KkumeumPushEnv;

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

function requiredBodyId(value: unknown, field: "campusId" | "studentId"): string {
  const id = String(value || "").trim().slice(0, 120);
  if (!id) throw new DataCoreAccessError(400, `${field}가 필요합니다.`);
  return id;
}

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new DataCoreAccessError(403, "허용되지 않은 요청 출처입니다.");
  }
}

function requireNonSuperAnnouncementCampus(
  context: DataCoreAccessContext,
  input: Record<string, unknown>,
  requireField: boolean,
): void {
  if (context.isSuperAdmin) return;
  const hasField = Object.prototype.hasOwnProperty.call(input, "campusId");
  if (requireField && !hasField) {
    throw new DataCoreAccessError(400, "캠퍼스 권한 사용자는 소식 campusId가 필요합니다.");
  }
  if (hasField && !String(input.campusId || "").trim()) {
    throw new DataCoreAccessError(400, "캠퍼스 권한 사용자는 소식 campusId를 비울 수 없습니다.");
  }
}

function privateJsonResponder(base: JsonResponder): JsonResponder {
  return (value: unknown, init: ResponseInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("cache-control", "private, no-store");
    return base(value, { ...init, headers });
  };
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
  const respond = privateJsonResponder(jsonResponse);
  requireAuthenticatedAccess(context);

  if (url.pathname === "/api/kkumeum/health") {
    if (request.method !== "GET") {
      return respond({ error: "지원하지 않는 꿈이음 health 요청입니다." }, { status: 405 });
    }
    const status = kkumeumBindingStatus(context, env);
    return respond({ status }, { status: status.ok ? 200 : 503 });
  }

  if (url.pathname === "/api/kkumeum/announcements") {
    const familyDb = requireFamilyDatabase(context, env.FAMILY_DB);
    if (request.method === "GET") {
      const campusId = String(url.searchParams.get("campusId") || "").trim().slice(0, 120) || null;
      return respond({ announcements: await listStaffAnnouncements(familyDb, context, campusId) });
    }
    if (request.method === "POST") {
      assertSameOrigin(request);
      const input = await readJson(request);
      requireNonSuperAnnouncementCampus(context, input, true);
      return respond(
        { announcement: await createStaffAnnouncementDraft(familyDb, context, input) },
        { status: 201 },
      );
    }
    return respond({ error: "지원하지 않는 꿈이음 소식 요청입니다." }, { status: 405 });
  }

  const announcementPublishMatch = url.pathname.match(/^\/api\/kkumeum\/announcements\/([^/]+)\/publish$/);
  if (announcementPublishMatch) {
    if (request.method !== "POST") {
      return respond({ error: "지원하지 않는 꿈이음 소식 발행 요청입니다." }, { status: 405 });
    }
    assertSameOrigin(request);
    const familyDb = requireFamilyDatabase(context, env.FAMILY_DB);
    const announcement = await publishStaffAnnouncement(
      familyDb,
      context,
      decodeURIComponent(announcementPublishMatch[1]),
    );
    const push = await dispatchGuardianAnnouncementPush(familyDb, env, announcement.id);
    return respond({ announcement, push });
  }

  const announcementMatch = url.pathname.match(/^\/api\/kkumeum\/announcements\/([^/]+)$/);
  if (announcementMatch) {
    if (request.method !== "PATCH") {
      return respond({ error: "지원하지 않는 꿈이음 소식 요청입니다." }, { status: 405 });
    }
    assertSameOrigin(request);
    const input = await readJson(request);
    requireNonSuperAnnouncementCampus(context, input, false);
    const familyDb = requireFamilyDatabase(context, env.FAMILY_DB);
    return respond({
      announcement: await updateStaffAnnouncementDraft(
        familyDb,
        context,
        decodeURIComponent(announcementMatch[1]),
        input,
      ),
    });
  }

  requireKkumeumBindingsReady(context, env);
  const familyDb = requireFamilyDatabase(context, env.FAMILY_DB);

  if (url.pathname === "/api/kkumeum/dashboard") {
    if (request.method !== "GET") return respond({ error: "지원하지 않는 꿈이음 현황 요청입니다." }, { status: 405 });
    const campusId = requiredCampusId(url);
    await assertKkumeumPilotCampus(familyDb, campusId);
    return respond({ dashboard: await getKkumeumDashboard(familyDb, context, campusId, url.searchParams.get("yearMonth")) });
  }

  if (url.pathname === "/api/kkumeum/guardians") {
    if (request.method === "GET") { const campusId = requiredCampusId(url); await assertKkumeumPilotCampus(familyDb, campusId); return respond({ guardians: await listKkumeumGuardians(familyDb, context, campusId, requiredStudentId(url)) }); }
    if (request.method === "POST") {
      assertSameOrigin(request);
      const input = await readJson(request);
      await assertKkumeumPilotCampus(familyDb, requiredBodyId(input.campusId, "campusId"));
      return respond(await createKkumeumGuardian(familyDb, context, input), { status: 201 });
    }
    return respond({ error: "지원하지 않는 보호자 관리 요청입니다." }, { status: 405 });
  }

  const guardianPasswordMatch = url.pathname.match(/^\/api\/kkumeum\/guardians\/([^/]+)\/reset-password$/);
  if (guardianPasswordMatch) {
    if (request.method !== "POST") return respond({ error: "지원하지 않는 보호자 비밀번호 요청입니다." }, { status: 405 });
    assertSameOrigin(request);
    return respond(await resetKkumeumGuardianPassword(familyDb, context, decodeURIComponent(guardianPasswordMatch[1]), await readJson(request)));
  }

  const guardianSessionsMatch = url.pathname.match(/^\/api\/kkumeum\/guardians\/([^/]+)\/revoke-sessions$/);
  if (guardianSessionsMatch) {
    if (request.method !== "POST") return respond({ error: "지원하지 않는 보호자 세션 요청입니다." }, { status: 405 });
    assertSameOrigin(request);
    return respond(await revokeKkumeumGuardianSessions(familyDb, context, decodeURIComponent(guardianSessionsMatch[1]), await readJson(request)));
  }

  const guardianUnlinkMatch = url.pathname.match(/^\/api\/kkumeum\/guardians\/([^/]+)\/unlink$/);
  if (guardianUnlinkMatch) {
    if (request.method !== "POST") return respond({ error: "지원하지 않는 보호자 연결 해제 요청입니다." }, { status: 405 });
    assertSameOrigin(request);
    const input = await readJson(request);
    return respond(await unlinkKkumeumGuardian(familyDb, context, decodeURIComponent(guardianUnlinkMatch[1]), requiredBodyId(input.campusId, "campusId"), requiredBodyId(input.studentId, "studentId")));
  }

  const guardianMatch = url.pathname.match(/^\/api\/kkumeum\/guardians\/([^/]+)$/);
  if (guardianMatch) {
    if (request.method !== "PATCH") return respond({ error: "지원하지 않는 보호자 관리 요청입니다." }, { status: 405 });
    assertSameOrigin(request);
    return respond(await updateKkumeumGuardianLink(familyDb, context, decodeURIComponent(guardianMatch[1]), await readJson(request)));
  }

  const familyFileMatch = url.pathname.match(/^\/api\/kkumeum\/files\/([^/]+)$/);
  if (familyFileMatch) {
    if (request.method !== "GET") {
      return respond({ error: "지원하지 않는 꿈이음 파일 요청입니다." }, { status: 405 });
    }
    return readKkumeumFamilyFile(
      familyDb,
      requireFamilyFiles(context, env.FAMILY_FILES),
      context,
      decodeURIComponent(familyFileMatch[1]),
    );
  }

  if (url.pathname === "/api/kkumeum/artworks") {
    if (request.method === "GET") {
      return respond({
        artworks: await listKkumeumArtworks(
          familyDb,
          context,
          requiredCampusId(url),
          requiredStudentId(url),
        ),
      });
    }
    if (request.method === "POST") {
      return respond(
        {
          artwork: await uploadKkumeumArtwork(
            request,
            familyDb,
            requireFamilyFiles(context, env.FAMILY_FILES),
            context,
          ),
        },
        { status: 201 },
      );
    }
    return respond({ error: "지원하지 않는 꿈이음 작품 요청입니다." }, { status: 405 });
  }

  const artworkRestoreMatch = url.pathname.match(/^\/api\/kkumeum\/artworks\/([^/]+)\/restore$/);
  if (artworkRestoreMatch) {
    if (request.method !== "POST") {
      return respond({ error: "지원하지 않는 꿈이음 작품 복원 요청입니다." }, { status: 405 });
    }
    return respond(
      await restoreKkumeumArtwork(
        familyDb,
        context,
        decodeURIComponent(artworkRestoreMatch[1]),
      ),
    );
  }

  const artworkMatch = url.pathname.match(/^\/api\/kkumeum\/artworks\/([^/]+)$/);
  if (artworkMatch) {
    const artworkId = decodeURIComponent(artworkMatch[1]);
    if (request.method === "GET") {
      return respond({ artwork: await getKkumeumArtwork(familyDb, context, artworkId) });
    }
    if (request.method === "PATCH") {
      return respond({
        artwork: await updateKkumeumArtwork(
          familyDb,
          context,
          artworkId,
          await readJson(request),
        ),
      });
    }
    if (request.method === "DELETE") {
      return respond(await trashKkumeumArtwork(familyDb, context, artworkId));
    }
    return respond({ error: "지원하지 않는 꿈이음 작품 요청입니다." }, { status: 405 });
  }

  if (url.pathname === "/api/kkumeum/reports/generate") {
    if (request.method !== "POST") {
      return respond({ error: "지원하지 않는 월간평가 AI 초안 요청입니다." }, { status: 405 });
    }
    const input = await readJson(request);
    await requireKkumeumReportEditAccess(
      familyDb,
      context,
      requiredBodyId(input.campusId, "campusId"),
      requiredBodyId(input.studentId, "studentId"),
    );
    const generation = await generateMonthlyReportDraft(familyDb, context, input);
    return respond(generation, { status: generation.available ? 200 : 503 });
  }

  if (url.pathname === "/api/kkumeum/reports") {
    if (request.method === "GET") {
      return respond({
        reports: await listMonthlyReports(
          familyDb,
          context,
          requiredCampusId(url),
          requiredStudentId(url),
        ),
      });
    }
    if (request.method === "POST") {
      const input = await readJson(request);
      await requireKkumeumReportEditAccess(
        familyDb,
        context,
        requiredBodyId(input.campusId, "campusId"),
        requiredBodyId(input.studentId, "studentId"),
      );
      return respond(
        { report: await createMonthlyReport(familyDb, context, input) },
        { status: 201 },
      );
    }
    return respond({ error: "지원하지 않는 월간평가 요청입니다." }, { status: 405 });
  }

  const reportActionMatch = url.pathname.match(
    /^\/api\/kkumeum\/reports\/([^/]+)\/(ready|draft|send|revise|revisions)$/,
  );
  if (reportActionMatch) {
    const reportId = decodeURIComponent(reportActionMatch[1]);
    const action = reportActionMatch[2];
    if (action === "revisions" && request.method === "GET") {
      return respond({ revisions: await listMonthlyReportRevisions(familyDb, context, reportId) });
    }
    if (action === "revise" && request.method === "POST") {
      const report = await getMonthlyReport(familyDb, context, reportId);
      await requireKkumeumReportEditAccess(familyDb, context, report.campusId, report.studentId);
      return respond(await reviseSentMonthlyReport(familyDb, context, reportId, await readJson(request)));
    }
    if ((action === "ready" || action === "draft" || action === "send") && request.method === "POST") {
      const report = await getMonthlyReport(familyDb, context, reportId);
      await requireKkumeumReportEditAccess(familyDb, context, report.campusId, report.studentId);
      const target = action === "send" ? "sent" : action;
      return respond({ report: await transitionMonthlyReport(familyDb, context, reportId, target) });
    }
    return respond({ error: "지원하지 않는 월간평가 상태 요청입니다." }, { status: 405 });
  }

  const reportMatch = url.pathname.match(/^\/api\/kkumeum\/reports\/([^/]+)$/);
  if (reportMatch) {
    const reportId = decodeURIComponent(reportMatch[1]);
    if (request.method === "GET") {
      return respond({ report: await getMonthlyReport(familyDb, context, reportId) });
    }
    if (request.method === "PATCH") {
      const report = await getMonthlyReport(familyDb, context, reportId);
      await requireKkumeumReportEditAccess(familyDb, context, report.campusId, report.studentId);
      return respond({ report: await updateMonthlyReport(familyDb, context, reportId, await readJson(request)) });
    }
    return respond({ error: "지원하지 않는 월간평가 요청입니다." }, { status: 405 });
  }

  if (url.pathname === "/api/kkumeum/classes") {
    if (request.method === "GET") {
      const campusId = requiredCampusId(url);
      await assertKkumeumPilotCampus(familyDb, campusId);
      return respond({ classes: await listKkumeumClasses(familyDb, context, campusId) });
    }
    if (request.method === "POST") {
      const input = await readJson(request);
      await assertKkumeumPilotCampus(familyDb, requiredBodyId(input.campusId, "campusId"));
      return respond(
        { class: await createKkumeumClass(familyDb, context, input) },
        { status: 201 },
      );
    }
    return respond({ error: "지원하지 않는 꿈이음 반 요청입니다." }, { status: 405 });
  }

  const classMatch = url.pathname.match(/^\/api\/kkumeum\/classes\/([^/]+)$/);
  if (classMatch) {
    if (request.method !== "PATCH") {
      return respond({ error: "지원하지 않는 꿈이음 반 요청입니다." }, { status: 405 });
    }
    return respond({
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
      await assertKkumeumPilotCampus(familyDb, campusId);
      return respond({
        students: await listKkumeumStudents(familyDb, context, campusId, {
          classId: url.searchParams.get("classId") || undefined,
          status: url.searchParams.get("status") || undefined,
          q: url.searchParams.get("q") || undefined,
        }),
      });
    }
    if (request.method === "POST") {
      const input = await readJson(request);
      await assertKkumeumPilotCampus(familyDb, requiredBodyId(input.campusId, "campusId"));
      return respond(
        { student: await createKkumeumStudent(familyDb, context, input) },
        { status: 201 },
      );
    }
    return respond({ error: "지원하지 않는 꿈이음 학생 요청입니다." }, { status: 405 });
  }

  const moveMatch = url.pathname.match(/^\/api\/kkumeum\/students\/([^/]+)\/move-class$/);
  if (moveMatch) {
    if (request.method !== "POST") {
      return respond({ error: "지원하지 않는 꿈이음 반 이동 요청입니다." }, { status: 405 });
    }
    const input = await readJson(request);
    return respond({
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
      return respond({ student: await getKkumeumStudent(familyDb, context, requiredCampusId(url), studentId) });
    }
    if (request.method === "PATCH") {
      return respond({
        student: await updateKkumeumStudent(familyDb, context, studentId, await readJson(request)),
      });
    }
    return respond({ error: "지원하지 않는 꿈이음 학생 요청입니다." }, { status: 405 });
  }

  return respond({ error: "지원하지 않는 꿈이음 API 요청입니다." }, { status: 405 });
}
