import { DEFAULT_ORGANIZATION_ID, ensureDataCoreDatabase } from "./data-core";
import { assertMutableRecordType, DERIVATIVE_RECORD_TYPE, THUMBNAIL_RECORD_TYPE } from './data-core-derivative-policy';
import { LIBRARY_FOLDER, HQ_FOLDER } from './data-core-library-policy';
import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireAuthenticatedAccess,
  requireCampusAccess,
  requireWriteAccess,
} from "./data-core-access";

export type DataRecordVisibility = "private" | "campus" | "organization" | "public";

export type DataRecordCreateInput = {
  campusId?: string | null;
  recordType?: string;
  sourceApp?: string;
  title?: string;
  summary?: string | null;
  visibility?: DataRecordVisibility;
  metadata?: unknown;
  tags?: string[];
};

export type DataRecordUpdateInput = Partial<DataRecordCreateInput>;

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeVisibility(value: unknown): DataRecordVisibility {
  const normalized = cleanText(value, 32);
  if (["private", "campus", "organization", "public"].includes(normalized)) {
    return normalized as DataRecordVisibility;
  }
  return "organization";
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => cleanText(item, 80))
        .filter(Boolean),
    ),
  ).slice(0, 30);
}

function safeMetadata(value: unknown): string {
  if (value === undefined) return "{}";
  try {
    const serialized = JSON.stringify(value ?? {});
    if (serialized.length > 200_000) {
      throw new DataCoreAccessError(413, "메타데이터가 너무 큽니다.");
    }
    return serialized;
  } catch (error) {
    if (error instanceof DataCoreAccessError) throw error;
    throw new DataCoreAccessError(400, "metadata는 JSON으로 저장 가능한 값이어야 합니다.");
  }
}

function parseMetadata(value: unknown) {
  if (typeof value !== "string" || !value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

async function audit(
  db: D1Database,
  context: DataCoreAccessContext,
  action: string,
  resourceType: string,
  resourceId: string | null,
  campusId: string | null,
  metadata: unknown = {},
) {
  if (!context.user) return;
  await db
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, campus_id, actor_user_id,
         action, resource_type, resource_id, metadata_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      DEFAULT_ORGANIZATION_ID,
      campusId,
      context.user.internalUserId,
      action,
      resourceType,
      resourceId,
      safeMetadata(metadata),
      new Date().toISOString(),
    )
    .run();
}

async function replaceTags(db: D1Database, recordId: string, tagNames: string[]) {
  await db.prepare("DELETE FROM data_record_tags WHERE data_record_id = ?").bind(recordId).run();
  const names = normalizeTags(tagNames);
  if (!names.length) return;
  const now = new Date().toISOString();

  for (const name of names) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO tags (id, organization_id, name, tag_type, created_at)
         VALUES (?, ?, ?, 'general', ?)`,
      )
      .bind(crypto.randomUUID(), DEFAULT_ORGANIZATION_ID, name, now)
      .run();
    const tag = await db
      .prepare(
        `SELECT id FROM tags
         WHERE organization_id = ? AND tag_type = 'general' AND name = ?`,
      )
      .bind(DEFAULT_ORGANIZATION_ID, name)
      .first<{ id: string }>();
    if (!tag?.id) continue;
    await db
      .prepare(
        `INSERT OR IGNORE INTO data_record_tags (id, data_record_id, tag_id, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), recordId, tag.id, now)
      .run();
  }
}

async function tagsForRecords(db: D1Database, recordIds: string[]) {
  const map = new Map<string, string[]>();
  if (!recordIds.length) return map;
  const placeholders = recordIds.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT drt.data_record_id, t.name
       FROM data_record_tags drt
       INNER JOIN tags t ON t.id = drt.tag_id
       WHERE drt.data_record_id IN (${placeholders})
       ORDER BY t.name`,
    )
    .bind(...recordIds)
    .all<{ data_record_id: string; name: string }>();
  for (const row of result.results || []) {
    const list = map.get(row.data_record_id) || [];
    list.push(row.name);
    map.set(row.data_record_id, list);
  }
  return map;
}

function rowToRecord(row: Record<string, unknown>, tags: string[] = []) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    campusId: row.campus_id,
    campusName: row.campus_name ?? null,
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name ?? null,
    recordType: row.record_type,
    sourceApp: row.source_app,
    title: row.title,
    summary: row.summary,
    visibility: row.visibility,
    status: row.status,
    metadata: parseMetadata(row.metadata_json),
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function hasMembership(context: DataCoreAccessContext) {
  return context.isSuperAdmin || context.memberships.length > 0;
}

function canReadRow(context: DataCoreAccessContext, row: Record<string, unknown>) {
  if (row.record_type === LIBRARY_FOLDER) return false;
  if ([DERIVATIVE_RECORD_TYPE,THUMBNAIL_RECORD_TYPE].includes(String(row.record_type))) return false;
  if (context.isSuperAdmin) return true;
  if (row.visibility === "public") return true;
  if (!hasMembership(context)) return false;
  if (row.visibility === "organization") return true;
  if (row.visibility === "campus") {
    return typeof row.campus_id === "string" && context.campusIds.includes(row.campus_id);
  }
  if (row.visibility === "private") {
    return context.user?.internalUserId === row.created_by_user_id;
  }
  return false;
}

function canMutateRow(context: DataCoreAccessContext, row: Record<string, unknown>) {
  if (context.isSuperAdmin) return true;
  return context.user?.internalUserId === row.created_by_user_id;
}

export async function listDataRecords(
  db: D1Database,
  context: DataCoreAccessContext,
  url: URL,
) {
  requireAuthenticatedAccess(context);
  await ensureDataCoreDatabase(db);

  const q = cleanText(url.searchParams.get("q"), 120);
  const recordType = cleanText(url.searchParams.get("recordType"), 80);
  const sourceApp = cleanText(url.searchParams.get("sourceApp"), 80);
  const campusId = cleanText(url.searchParams.get("campusId"), 120);
  const tag = cleanText(url.searchParams.get("tag"), 80);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 100);

  const conditions = ["dr.organization_id = ?", "dr.deleted_at IS NULL"];
  const bindings: unknown[] = [DEFAULT_ORGANIZATION_ID];

  if (recordType) {
    conditions.push("dr.record_type = ?");
    bindings.push(recordType);
  }
  if (sourceApp) {
    conditions.push("dr.source_app = ?");
    bindings.push(sourceApp);
  }
  if (campusId) {
    conditions.push("dr.campus_id = ?");
    bindings.push(campusId);
  }
  if (q) {
    conditions.push("(dr.title LIKE ? OR dr.summary LIKE ? OR dr.metadata_json LIKE ?)");
    const like = `%${q.replace(/[%_]/g, "")} %`.replace(" %", "%");
    bindings.push(like, like, like);
  }
  if (tag) {
    conditions.push(
      `EXISTS (
         SELECT 1
         FROM data_record_tags drt
         INNER JOIN tags t ON t.id = drt.tag_id
         WHERE drt.data_record_id = dr.id AND t.name = ?
       )`,
    );
    bindings.push(tag);
  }

  const result = await db
    .prepare(
      `SELECT
         dr.*,
         c.name AS campus_name,
         u.display_name AS created_by_name
       FROM data_records dr
       LEFT JOIN campuses c ON c.id = dr.campus_id
       LEFT JOIN users u ON u.id = dr.created_by_user_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY dr.updated_at DESC
       LIMIT ?`,
    )
    .bind(...bindings, limit)
    .all<Record<string, unknown>>();

  const visibleRows = (result.results || []).filter((row) => canReadRow(context, row));
  const tagMap = await tagsForRecords(
    db,
    visibleRows.map((row) => String(row.id)),
  );
  return visibleRows.map((row) => rowToRecord(row, tagMap.get(String(row.id)) || []));
}

export async function getDataRecord(
  db: D1Database,
  context: DataCoreAccessContext,
  recordId: string,
) {
  requireAuthenticatedAccess(context);
  const row = await db
    .prepare(
      `SELECT dr.*, c.name AS campus_name, u.display_name AS created_by_name
       FROM data_records dr
       LEFT JOIN campuses c ON c.id = dr.campus_id
       LEFT JOIN users u ON u.id = dr.created_by_user_id
       WHERE dr.id = ? AND dr.organization_id = ? AND dr.deleted_at IS NULL`,
    )
    .bind(recordId, DEFAULT_ORGANIZATION_ID)
    .first<Record<string, unknown>>();
  if (!row) throw new DataCoreAccessError(404, "데이터를 찾을 수 없습니다.");
  if (!canReadRow(context, row)) throw new DataCoreAccessError(403, "이 데이터를 볼 권한이 없습니다.");
  const tagMap = await tagsForRecords(db, [recordId]);
  return rowToRecord(row, tagMap.get(recordId) || []);
}

export async function createDataRecord(
  db: D1Database,
  context: DataCoreAccessContext,
  input: DataRecordCreateInput,
) {
  requireWriteAccess(context);
  if (!context.user) throw new DataCoreAccessError(401, "로그인이 필요합니다.");

  const title = cleanText(input.title, 240);
  const recordType = cleanText(input.recordType, 80);
  assertMutableRecordType(recordType);
  const sourceApp = cleanText(input.sourceApp, 80);
  const campusId = cleanText(input.campusId, 120) || null;
  if (recordType === LIBRARY_FOLDER || (recordType === HQ_FOLDER && (!context.isSuperAdmin || campusId ||
    (input.metadata && typeof input.metadata === 'object' && 'parentFolderId' in input.metadata)))) {
    throw new DataCoreAccessError(403, '자료보관함 폴더 기능을 사용하세요.');
  }
  if (!title) throw new DataCoreAccessError(400, "title이 필요합니다.");
  if (!recordType) throw new DataCoreAccessError(400, "recordType이 필요합니다.");
  if (!sourceApp) throw new DataCoreAccessError(400, "sourceApp이 필요합니다.");

  if (!context.isSuperAdmin) {
    if (!campusId) throw new DataCoreAccessError(400, "캠퍼스 사용자는 campusId가 필요합니다.");
    requireCampusAccess(context, campusId);
  } else if (campusId) {
    requireCampusAccess(context, campusId);
  }

  const visibility = normalizeVisibility(input.visibility);
  if (!context.isSuperAdmin && visibility === "organization") {
    // 캠퍼스 사용자가 생성한 자료는 기본적으로 캠퍼스 공유 범위로 제한한다.
    input.visibility = "campus";
  }
  const finalVisibility = normalizeVisibility(input.visibility);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO data_records (
         id, organization_id, campus_id, created_by_user_id,
         record_type, source_app, title, summary, visibility,
         status, metadata_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    )
    .bind(
      id,
      DEFAULT_ORGANIZATION_ID,
      campusId,
      context.user.internalUserId,
      recordType,
      sourceApp,
      title,
      cleanText(input.summary, 10_000) || null,
      finalVisibility,
      safeMetadata(input.metadata),
      now,
      now,
    )
    .run();

  await replaceTags(db, id, normalizeTags(input.tags));
  await audit(db, context, "create", "data_record", id, campusId, { recordType, sourceApp });
  return getDataRecord(db, context, id);
}

export async function updateDataRecord(
  db: D1Database,
  context: DataCoreAccessContext,
  recordId: string,
  input: DataRecordUpdateInput,
) {
  requireWriteAccess(context);
  const existing = await db
    .prepare(
      `SELECT * FROM data_records
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
    )
    .bind(recordId, DEFAULT_ORGANIZATION_ID)
    .first<Record<string, unknown>>();
  if (!existing) throw new DataCoreAccessError(404, "데이터를 찾을 수 없습니다.");
  if ([LIBRARY_FOLDER, HQ_FOLDER].includes(String(existing.record_type)) || [LIBRARY_FOLDER, HQ_FOLDER].includes(cleanText(input.recordType, 80))) {
    throw new DataCoreAccessError(403, '자료보관함 폴더 구조는 직접 변경할 수 없습니다.');
  }
  assertMutableRecordType(existing.record_type);
  assertMutableRecordType(cleanText(input.recordType, 80));
  if (!canMutateRow(context, existing)) {
    throw new DataCoreAccessError(403, "본인이 등록한 데이터만 수정할 수 있습니다.");
  }

  const nextCampusId =
    input.campusId === undefined ? (existing.campus_id as string | null) : cleanText(input.campusId, 120) || null;
  if (!context.isSuperAdmin) requireCampusAccess(context, nextCampusId);
  else if (nextCampusId) requireCampusAccess(context, nextCampusId);

  const nextTitle = input.title === undefined ? String(existing.title) : cleanText(input.title, 240);
  if (!nextTitle) throw new DataCoreAccessError(400, "title은 비워둘 수 없습니다.");
  const nextRecordType =
    input.recordType === undefined ? String(existing.record_type) : cleanText(input.recordType, 80);
  const nextSourceApp =
    input.sourceApp === undefined ? String(existing.source_app) : cleanText(input.sourceApp, 80);
  let nextVisibility =
    input.visibility === undefined
      ? (existing.visibility as DataRecordVisibility)
      : normalizeVisibility(input.visibility);
  if (!context.isSuperAdmin && nextVisibility === "organization") nextVisibility = "campus";
  const nextSummary =
    input.summary === undefined ? (existing.summary as string | null) : cleanText(input.summary, 10_000) || null;
  const nextMetadata =
    input.metadata === undefined ? String(existing.metadata_json || "{}") : safeMetadata(input.metadata);
  const now = new Date().toISOString();

  await db
    .prepare(
      `UPDATE data_records SET
         campus_id = ?, record_type = ?, source_app = ?, title = ?, summary = ?,
         visibility = ?, metadata_json = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      nextCampusId,
      nextRecordType,
      nextSourceApp,
      nextTitle,
      nextSummary,
      nextVisibility,
      nextMetadata,
      now,
      recordId,
    )
    .run();

  if (input.tags !== undefined) await replaceTags(db, recordId, normalizeTags(input.tags));
  await audit(db, context, "update", "data_record", recordId, nextCampusId);
  return getDataRecord(db, context, recordId);
}

export async function deleteDataRecord(
  db: D1Database,
  context: DataCoreAccessContext,
  recordId: string,
) {
  requireWriteAccess(context);
  const existing = await db
    .prepare(
      `SELECT * FROM data_records
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
    )
    .bind(recordId, DEFAULT_ORGANIZATION_ID)
    .first<Record<string, unknown>>();
  if (!existing) throw new DataCoreAccessError(404, "데이터를 찾을 수 없습니다.");
  if ([LIBRARY_FOLDER, HQ_FOLDER].includes(String(existing.record_type))) {
    throw new DataCoreAccessError(403, '자료보관함의 빈 폴더 삭제 기능을 사용하세요.');
  }
  assertMutableRecordType(existing.record_type);
  if (!canMutateRow(context, existing)) {
    throw new DataCoreAccessError(403, "본인이 등록한 데이터만 삭제할 수 있습니다.");
  }
  if (existing.record_type === 'competition-award-folder') {
    const linked = await db.prepare('SELECT id FROM file_objects WHERE data_record_id = ? LIMIT 1').bind(recordId).first();
    if (linked) throw new DataCoreAccessError(409, '폴더 안에 수상작이 있습니다. 먼저 수상작을 삭제하세요.');
  }

  const now = new Date().toISOString();
  const result = await db
    .prepare(`UPDATE data_records SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ?
      AND (record_type <> 'competition-award-folder' OR NOT EXISTS (SELECT 1 FROM file_objects WHERE data_record_id = ?))`)
    .bind(now, now, recordId, recordId)
    .run();
  if (Number(result.meta?.changes) !== 1) throw new DataCoreAccessError(409, '폴더 안에 수상작이 있습니다. 먼저 수상작을 삭제하세요.');
  await audit(
    db,
    context,
    "delete",
    "data_record",
    recordId,
    (existing.campus_id as string | null) || null,
  );
  return { ok: true, id: recordId, deletedAt: now };
}
