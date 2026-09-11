import { DEFAULT_ORGANIZATION_ID } from "./data-core";
import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireAuthenticatedAccess,
  requireWriteAccess,
} from "./data-core-access";
import { ensureDataCoreMigrations } from "./data-core-migrations";
import { getDataRecord } from "./data-core-records";

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function canMutate(
  context: DataCoreAccessContext,
  row: { created_by_user_id: string | null },
) {
  if (context.isSuperAdmin) return true;
  return Boolean(context.user && context.user.internalUserId === row.created_by_user_id);
}

async function audit(
  db: D1Database,
  context: DataCoreAccessContext,
  action: string,
  recordId: string,
  campusId: string | null,
  metadata: unknown,
) {
  if (!context.user) return;
  await db
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, campus_id, actor_user_id,
         action, resource_type, resource_id, metadata_json, created_at
       ) VALUES (?, ?, ?, ?, ?, 'data_record', ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      DEFAULT_ORGANIZATION_ID,
      campusId,
      context.user.internalUserId,
      action,
      recordId,
      JSON.stringify(metadata ?? {}),
      new Date().toISOString(),
    )
    .run();
}

export async function getDataRecordContent(
  db: D1Database,
  context: DataCoreAccessContext,
  recordId: string,
) {
  requireAuthenticatedAccess(context);
  await ensureDataCoreMigrations(db);
  await getDataRecord(db, context, recordId);

  const row = await db
    .prepare(
      `SELECT content_text
       FROM data_records
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
    )
    .bind(recordId, DEFAULT_ORGANIZATION_ID)
    .first<{ content_text: string | null }>();

  if (!row) throw new DataCoreAccessError(404, "데이터를 찾을 수 없습니다.");
  return { id: recordId, content: row.content_text || "" };
}

export async function setDataRecordContent(
  db: D1Database,
  context: DataCoreAccessContext,
  recordId: string,
  contentValue: unknown,
) {
  requireWriteAccess(context);
  await ensureDataCoreMigrations(db);
  await getDataRecord(db, context, recordId);

  const existing = await db
    .prepare(
      `SELECT id, campus_id, created_by_user_id
       FROM data_records
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
    )
    .bind(recordId, DEFAULT_ORGANIZATION_ID)
    .first<{
      id: string;
      campus_id: string | null;
      created_by_user_id: string | null;
    }>();

  if (!existing) throw new DataCoreAccessError(404, "데이터를 찾을 수 없습니다.");
  if (!canMutate(context, existing)) {
    throw new DataCoreAccessError(403, "본인이 등록한 데이터의 본문만 수정할 수 있습니다.");
  }

  const content = cleanText(contentValue, 1_000_000);
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE data_records
       SET content_text = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(content || null, now, recordId)
    .run();

  await audit(db, context, "update_content", recordId, existing.campus_id, {
    contentLength: content.length,
  });

  return { id: recordId, content, updatedAt: now };
}

export async function searchDataCore(
  db: D1Database,
  context: DataCoreAccessContext,
  url: URL,
) {
  requireAuthenticatedAccess(context);
  await ensureDataCoreMigrations(db);

  const q = cleanText(url.searchParams.get("q"), 160);
  if (!q) return { query: "", results: [] };

  const recordType = cleanText(url.searchParams.get("recordType"), 80);
  const sourceApp = cleanText(url.searchParams.get("sourceApp"), 80);
  const campusId = cleanText(url.searchParams.get("campusId"), 120);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 30, 1), 50);

  const conditions = [
    "dr.organization_id = ?",
    "dr.deleted_at IS NULL",
    "dr.record_type <> 'image-thumbnail'",
    `(dr.title LIKE ?
      OR dr.summary LIKE ?
      OR dr.content_text LIKE ?
      OR dr.metadata_json LIKE ?
      OR EXISTS (
        SELECT 1
        FROM data_record_tags drt
        INNER JOIN tags t ON t.id = drt.tag_id
        WHERE drt.data_record_id = dr.id AND t.name LIKE ?
      ))`,
  ];
  const safeQuery = q.replace(/[%_]/g, "");
  const like = `%${safeQuery}%`;
  const bindings: unknown[] = [
    DEFAULT_ORGANIZATION_ID,
    like,
    like,
    like,
    like,
    like,
  ];

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

  const rows = await db
    .prepare(
      `SELECT
         dr.id,
         dr.title,
         dr.summary,
         dr.content_text,
         dr.record_type,
         dr.source_app,
         dr.updated_at
       FROM data_records dr
       WHERE ${conditions.join(" AND ")}
       ORDER BY dr.updated_at DESC
       LIMIT ?`,
    )
    .bind(...bindings, limit * 3)
    .all<{
      id: string;
      title: string;
      summary: string | null;
      content_text: string | null;
      record_type: string;
      source_app: string;
      updated_at: string;
    }>();

  const results = [];
  for (const row of rows.results || []) {
    if (results.length >= limit) break;
    try {
      const record = await getDataRecord(db, context, row.id);
      const source = row.content_text || row.summary || "";
      const lowerSource = source.toLowerCase();
      const lowerQuery = safeQuery.toLowerCase();
      const index = lowerSource.indexOf(lowerQuery);
      const start = index >= 0 ? Math.max(0, index - 80) : 0;
      const snippet = source.slice(start, start + 260);
      results.push({
        ...record,
        contentSnippet: snippet,
      });
    } catch (error) {
      if (error instanceof DataCoreAccessError && error.status === 403) continue;
      throw error;
    }
  }

  return { query: q, results };
}
