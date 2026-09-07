import { DEFAULT_ORGANIZATION_ID } from "./data-core";
import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireAuthenticatedAccess,
} from "./data-core-access";
import { ensureKnowledgeSchema } from "./data-core-knowledge";
import { seedKnowledgeFoundation } from "./data-core-knowledge-seed";

const ADMISSIONS_STATE_KEY = "state/admissions-data.json";

function requireSuperAdmin(context: DataCoreAccessContext) {
  requireAuthenticatedAccess(context);
  if (!context.isSuperAdmin) {
    throw new DataCoreAccessError(403, "입시데이터 지식 동기화는 마스터 관리자만 실행할 수 있습니다.");
  }
}

function cleanText(value: unknown, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function hashText(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableId(prefix: string, value: string) {
  return `knowledge:${prefix}:admissions:${hashText(value.toLowerCase().replace(/\s+/g, " ").trim())}`;
}

async function readAdmissionsState(db: D1Database, files?: R2Bucket) {
  if (files) {
    const object = await files.get(ADMISSIONS_STATE_KEY);
    if (object) {
      try {
        return await new Response(object.body).json() as Record<string, unknown>;
      } catch {
        throw new DataCoreAccessError(500, "R2의 입시컨설팅 데이터를 JSON으로 읽지 못했습니다.");
      }
    }
  }

  const row = await db
    .prepare("SELECT json FROM app_state WHERE id = 'main'")
    .first<{ json: string }>();
  if (!row?.json || row.json.startsWith("r2:")) {
    throw new DataCoreAccessError(404, "동기화할 입시컨설팅 운영 데이터를 찾지 못했습니다.");
  }
  try {
    return JSON.parse(row.json) as Record<string, unknown>;
  } catch {
    throw new DataCoreAccessError(500, "D1의 입시컨설팅 데이터를 JSON으로 읽지 못했습니다.");
  }
}

function universityName(row: Record<string, unknown>) {
  return cleanText(row.name || row.universityName || row.university, 240);
}

function majorName(row: Record<string, unknown>) {
  return cleanText(row.major || row.department || row.detectedDepartment, 240);
}

function admissionName(row: Record<string, unknown>) {
  return cleanText(row.admission || row.admissionType || row.detectedAdmissionType, 240);
}

function practicalText(row: Record<string, unknown>) {
  return cleanText(
    row.practicalType || row.practiceType || row.examType || row.skillType || row.practical || "",
    1000,
  );
}

function admissionText(row: Record<string, unknown>) {
  return [
    universityName(row),
    majorName(row),
    admissionName(row),
    practicalText(row),
    cleanText(row.subjects, 500),
    cleanText(row.notes, 1000),
  ].join(" ").toLowerCase();
}

function relatedMajorIds(row: Record<string, unknown>) {
  const text = admissionText(row);
  const ids: string[] = [];
  if (/웹툰|webtoon|comic|cartoon|카툰/.test(text)) ids.push("knowledge:major:webtoon-content");
  if (/애니|animation|anime/.test(text)) ids.push("knowledge:major:animation");
  if (/게임|game|게임그래픽|게임아트/.test(text)) ids.push("knowledge:major:game-art");
  if (/디자인|design|시각|산업|패션|제품|공간|실내|커뮤니케이션|공예|조형|회화|조소/.test(text)) {
    ids.push("knowledge:major:visual-design");
  }
  if (!ids.length && /만화/.test(text)) ids.push("knowledge:major:webtoon-content");
  return Array.from(new Set(ids));
}

function skillIdsForPractical(row: Record<string, unknown>) {
  const text = admissionText(row);
  const ids = new Set<string>();
  const add = (...keys: string[]) => keys.forEach((key) => ids.add(`knowledge:skill:${key}`));

  if (/상황표현|상황묘사|칸만화|웹툰|스토리보드|세로/.test(text)) {
    add("drawing", "figure", "perspective", "background", "story-direction");
  }
  if (/캐릭터|게임|일러스트|포스터/.test(text)) {
    add("drawing", "figure", "character", "color", "digital");
  }
  if (/기초디자인|사고의\s*전환|디자인/.test(text)) {
    add("drawing", "color", "design-form", "perspective");
  }
  if (/이미지보드|이미지\s*보드/.test(text)) {
    add("story-direction", "perspective", "background", "color", "design-form");
  }
  if (!ids.size) add("drawing");
  return Array.from(ids);
}

function metadataForUniversity(row: Record<string, unknown>) {
  return {
    sourceApp: "admissions",
    sourceUniversityId: row.id ?? null,
    sourceUpdatedAt: row.updatedAt ?? null,
    syncedFrom: "admissions-data",
  };
}

function metadataForProgram(row: Record<string, unknown>) {
  const conversionRule = safeObject(row.conversionRule);
  return {
    sourceApp: "admissions",
    sourceUniversityId: row.id ?? null,
    year: numberOrNull(row.year),
    universityName: universityName(row),
    major: majorName(row),
    admission: admissionName(row),
    practicalType: practicalText(row),
    gradeRatio: numberOrNull(row.gradeRatio ?? row.gradeWeight),
    skillRatio: numberOrNull(row.skillRatio ?? row.skillWeight),
    subjects: row.subjects ?? null,
    rateCurrent: numberOrNull(row.rateCurrent),
    requiredScores: row.requiredScores ?? null,
    conversionRule: Object.keys(conversionRule).length ? conversionRule : null,
    notes: row.notes ?? null,
    syncedFrom: "admissions-data",
  };
}

async function upsertNode(
  db: D1Database,
  id: string,
  nodeType: string,
  name: string,
  summary: string,
  metadata: Record<string, unknown>,
  now: string,
) {
  await db
    .prepare(
      `INSERT INTO knowledge_nodes (
         id, organization_id, campus_id, node_type, name, summary, content_text,
         metadata_json, visibility, status, created_by_user_id, created_at, updated_at, deleted_at
       ) VALUES (?, ?, NULL, ?, ?, ?, NULL, ?, 'organization', 'active', NULL, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET
         node_type = excluded.node_type,
         name = excluded.name,
         summary = excluded.summary,
         metadata_json = excluded.metadata_json,
         visibility = 'organization',
         status = 'active',
         updated_at = excluded.updated_at,
         deleted_at = NULL`,
    )
    .bind(id, DEFAULT_ORGANIZATION_ID, nodeType, name, summary || null, JSON.stringify(metadata), now, now)
    .run();
}

async function upsertEdge(
  db: D1Database,
  id: string,
  fromNodeId: string,
  toNodeId: string,
  relationType: string,
  weight: number,
  metadata: Record<string, unknown>,
  now: string,
) {
  await db
    .prepare(
      `INSERT INTO knowledge_edges (
         id, organization_id, campus_id, from_node_id, to_node_id,
         relation_type, weight, metadata_json, created_by_user_id, created_at, updated_at, deleted_at
       ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET
         from_node_id = excluded.from_node_id,
         to_node_id = excluded.to_node_id,
         relation_type = excluded.relation_type,
         weight = excluded.weight,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at,
         deleted_at = NULL`,
    )
    .bind(
      id,
      DEFAULT_ORGANIZATION_ID,
      fromNodeId,
      toNodeId,
      relationType,
      weight,
      JSON.stringify(metadata),
      now,
      now,
    )
    .run();
}

async function audit(
  db: D1Database,
  context: DataCoreAccessContext,
  metadata: Record<string, unknown>,
) {
  if (!context.user) return;
  await db
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, campus_id, actor_user_id,
         action, resource_type, resource_id, metadata_json, created_at
       ) VALUES (?, ?, NULL, ?, 'sync', 'knowledge_graph', 'admissions', ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      DEFAULT_ORGANIZATION_ID,
      context.user.internalUserId,
      JSON.stringify(metadata),
      new Date().toISOString(),
    )
    .run();
}

export async function syncAdmissionsKnowledge(
  db: D1Database,
  files: R2Bucket | undefined,
  context: DataCoreAccessContext,
) {
  requireSuperAdmin(context);
  await seedKnowledgeFoundation(db);
  await ensureKnowledgeSchema(db);
  const state = await readAdmissionsState(db, files);
  const universities = safeArray(state.universities)
    .map(safeObject)
    .filter((row) => universityName(row));

  const now = new Date().toISOString();
  let universityNodes = 0;
  let programNodes = 0;
  let admissionNodes = 0;
  let edges = 0;
  let skipped = 0;

  for (const row of universities) {
    const school = universityName(row);
    const major = majorName(row);
    const admission = admissionName(row);
    const year = cleanText(row.year, 20);
    if (!school) {
      skipped += 1;
      continue;
    }

    const universityId = stableId("university", school);
    const programKey = `${row.id ?? ""}|${school}|${major}|${admission}|${year}`;
    const programId = stableId("program", programKey);
    const admissionId = stableId("admission", `${school}|${admission || "미지정"}|${year}|${practicalText(row)}`);

    await upsertNode(
      db,
      universityId,
      "university",
      school,
      "입시컨설팅 DATA CORE에서 동기화된 대학",
      metadataForUniversity(row),
      now,
    );
    universityNodes += 1;

    const programName = major || `${school} 전공 정보`;
    await upsertNode(
      db,
      programId,
      "university_program",
      programName,
      [school, major, admission].filter(Boolean).join(" · "),
      metadataForProgram(row),
      now,
    );
    programNodes += 1;

    await upsertEdge(
      db,
      stableId("edge", `${programId}|OFFERED_BY|${universityId}`),
      programId,
      universityId,
      "OFFERED_BY",
      10,
      { sourceApp: "admissions", sourceUniversityId: row.id ?? null },
      now,
    );
    edges += 1;

    if (admission || practicalText(row)) {
      const admissionDisplay = [admission || "입시전형", practicalText(row)].filter(Boolean).join(" · ");
      await upsertNode(
        db,
        admissionId,
        "admission_method",
        admissionDisplay,
        `${school} ${major || ""} 입시 준비 방식`.trim(),
        metadataForProgram(row),
        now,
      );
      admissionNodes += 1;
      await upsertEdge(
        db,
        stableId("edge", `${programId}|USES_ADMISSION_METHOD|${admissionId}`),
        programId,
        admissionId,
        "USES_ADMISSION_METHOD",
        10,
        { sourceApp: "admissions", sourceUniversityId: row.id ?? null },
        now,
      );
      edges += 1;

      for (const skillId of skillIdsForPractical(row)) {
        await upsertEdge(
          db,
          stableId("edge", `${admissionId}|REQUIRES_SKILL|${skillId}`),
          admissionId,
          skillId,
          "REQUIRES_SKILL",
          8,
          { sourceApp: "admissions", inferredFrom: practicalText(row) || admissionText(row) },
          now,
        );
        edges += 1;
      }
    }

    const majorIds = relatedMajorIds(row);
    if (!majorIds.length) skipped += 1;
    for (const majorId of majorIds) {
      await upsertEdge(
        db,
        stableId("edge", `${majorId}|LEADS_TO_PROGRAM|${programId}`),
        majorId,
        programId,
        "LEADS_TO_PROGRAM",
        10,
        { sourceApp: "admissions", sourceUniversityId: row.id ?? null },
        now,
      );
      edges += 1;
    }
  }

  const summary = {
    sourceRows: universities.length,
    universityNodes,
    programNodes,
    admissionNodes,
    edges,
    skipped,
    syncedAt: now,
  };
  await audit(db, context, summary);
  return summary;
}
