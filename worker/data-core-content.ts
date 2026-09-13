import { DEFAULT_ORGANIZATION_ID } from "./data-core";
import { canReadRegisteredFile, DERIVATIVE_CATEGORY } from './data-core-derivative-policy';
import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireAuthenticatedAccess,
  requireCampusAccess,
  requireWriteAccess,
  isCampusAdmin, managesCampus,
} from "./data-core-access";
import { ensureDataCoreMigrations } from "./data-core-migrations";
import {
  createDataRecord,
  deleteDataRecord,
  getDataRecord,
  updateDataRecord,
  type DataRecordVisibility,
} from "./data-core-records";
import {
  getDataRecordContent,
  setDataRecordContent,
} from "./data-core-search";

export type ContentSourceApp = "blog" | "instagram";
export type ContentDraftStatus = "draft" | "review" | "ready" | "published" | "archived";

export type ContentDraftInput = {
  campusId?: string | null;
  sourceApp?: ContentSourceApp;
  title?: string;
  summary?: string | null;
  content?: string | null;
  visibility?: DataRecordVisibility;
  publishStatus?: ContentDraftStatus;
  contentPurpose?: string | null;
  tags?: string[];
  relatedFileIds?: string[];
  derivedFileIds?: string[];
  metadata?: Record<string, unknown>;
};

const CONTENT_SOURCE_APPS = new Set(["blog", "instagram"]);
const CONTENT_STATUSES = new Set(["draft", "review", "ready", "published", "archived"]);

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeSourceApp(value: unknown): ContentSourceApp {
  const sourceApp = cleanText(value, 40);
  if (CONTENT_SOURCE_APPS.has(sourceApp)) return sourceApp as ContentSourceApp;
  throw new DataCoreAccessError(400, "sourceApp은 blog 또는 instagram이어야 합니다.");
}

function normalizeStatus(value: unknown): ContentDraftStatus {
  const status = cleanText(value || "draft", 40);
  if (CONTENT_STATUSES.has(status)) return status as ContentDraftStatus;
  throw new DataCoreAccessError(400, "publishStatus 값이 올바르지 않습니다.");
}

function recordTypeForSource(sourceApp: ContentSourceApp) {
  return sourceApp === "blog" ? "blog-draft" : "instagram-draft";
}

function normalizeFileIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map((item) => cleanText(item, 120)).filter(Boolean)),
  ).slice(0, 30);
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map((item) => cleanText(item, 80)).filter(Boolean)),
  ).slice(0, 30);
}

function safeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return safeObject(parsed);
  } catch {
    return {};
  }
}

async function assertFilesCanBeLinked(
  db: D1Database,
  context: DataCoreAccessContext,
  contentCampusId: string | null,
  fileIds: string[],
  derivativesOnly = false,
) {
  if (!fileIds.length) return;
  const placeholders = fileIds.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT *
       FROM file_objects
       WHERE organization_id = ? AND id IN (${placeholders})`,
    )
    .bind(DEFAULT_ORGANIZATION_ID, ...fileIds)
    .all<Record<string, unknown>>();
  const rows = result.results || [];
  const rowMap = new Map(rows.map((row) => [String(row.id), row]));

  for (const fileId of fileIds) {
    const row = rowMap.get(fileId);
    if (!row || row.deleted_at) {
      throw new DataCoreAccessError(400, "연결할 DATA CORE 파일을 찾을 수 없습니다.");
    }
    if (!await canReadRegisteredFile(db, context, row)) {
      throw new DataCoreAccessError(403, "볼 수 있는 DATA CORE 파일만 콘텐츠에 연결할 수 있습니다.");
    }
    const fileCampusId = typeof row.campus_id === "string" ? row.campus_id : null;
    if (derivativesOnly && row.category !== DERIVATIVE_CATEGORY) throw new DataCoreAccessError(400, '파생 출력 파일을 선택하세요.');
    if (contentCampusId && fileCampusId && contentCampusId !== fileCampusId) {
      throw new DataCoreAccessError(400, "콘텐츠와 다른 캠퍼스의 파일은 연결할 수 없습니다.");
    }
  }
}

function buildMetadata(input: ContentDraftInput, sourceApp: ContentSourceApp, relatedFileIds: string[], derivedFileIds: string[]) {
  const metadata = safeObject(input.metadata);
  metadata.contentPurpose = cleanText(
    input.contentPurpose ?? metadata.contentPurpose ?? "class-story",
    80,
  );
  metadata.publishStatus = normalizeStatus(input.publishStatus ?? metadata.publishStatus);
  metadata.publishedAt = metadata.publishStatus === "published"
    ? metadata.publishedAt || new Date().toISOString()
    : metadata.publishedAt || null;
  metadata.channelPostId = cleanText(metadata.channelPostId, 160) || null;
  metadata.relatedFileIds = relatedFileIds;
  metadata.derivedFileIds = derivedFileIds;
  if (sourceApp === "instagram") {
    metadata.imageSpec = {
      ...(safeObject(metadata.imageSpec)),
      width: 2160,
      height: 2700,
      aspectRatio: "4:5",
    };
  }
  return metadata;
}

function canMutateRow(context: DataCoreAccessContext, row: Record<string, unknown>) {
  if (context.isSuperAdmin) return true;
  if (isCampusAdmin(context)) return managesCampus(context,row.campus_id);
  return context.user?.internalUserId === row.created_by_user_id;
}

async function auditContent(
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
       ) VALUES (?, ?, ?, ?, ?, 'content_draft', ?, ?, ?)`,
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

async function contentDraftResponse(
  db: D1Database,
  context: DataCoreAccessContext,
  recordId: string,
) {
  const record = await getDataRecord(db, context, recordId);
  const content = await getDataRecordContent(db, context, recordId);
  return { ...record, content: content.content };
}

export async function listContentDrafts(
  db: D1Database,
  context: DataCoreAccessContext,
  url: URL,
) {
  requireAuthenticatedAccess(context);
  await ensureDataCoreMigrations(db);

  const sourceApp = cleanText(url.searchParams.get("sourceApp"), 40);
  if (sourceApp && !CONTENT_SOURCE_APPS.has(sourceApp)) {
    throw new DataCoreAccessError(400, "sourceApp은 blog 또는 instagram이어야 합니다.");
  }
  const q = cleanText(url.searchParams.get("q"), 160);
  const campusId = cleanText(url.searchParams.get("campusId"), 120);
  const status = cleanText(url.searchParams.get("status"), 40);
  if (status && !CONTENT_STATUSES.has(status)) {
    throw new DataCoreAccessError(400, "status 값이 올바르지 않습니다.");
  }
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 100);

  const conditions = [
    "organization_id = ?",
    "deleted_at IS NULL",
    "record_type IN ('blog-draft', 'instagram-draft')",
  ];
  const bindings: unknown[] = [DEFAULT_ORGANIZATION_ID];
  if (sourceApp) {
    conditions.push("source_app = ?");
    bindings.push(sourceApp);
  }
  if (campusId) {
    conditions.push("campus_id = ?");
    bindings.push(campusId);
  }
  if (status) {
    conditions.push("metadata_json LIKE ?");
    bindings.push(`%"publishStatus":"${status.replace(/[%_"]/g, "")}"%`);
  }
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    conditions.push("(title LIKE ? OR summary LIKE ? OR content_text LIKE ? OR metadata_json LIKE ?)");
    bindings.push(like, like, like, like);
  }

  const rows = await db
    .prepare(
      `SELECT id
       FROM data_records
       WHERE ${conditions.join(" AND ")}
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .bind(...bindings, limit * 3)
    .all<{ id: string }>();

  const drafts = [];
  for (const row of rows.results || []) {
    if (drafts.length >= limit) break;
    try {
      drafts.push(await contentDraftResponse(db, context, row.id));
    } catch (error) {
      if (error instanceof DataCoreAccessError && error.status === 403) continue;
      throw error;
    }
  }
  return drafts;
}

export async function createContentDraft(
  db: D1Database,
  context: DataCoreAccessContext,
  input: ContentDraftInput,
) {
  requireWriteAccess(context);
  await ensureDataCoreMigrations(db);
  const sourceApp = normalizeSourceApp(input.sourceApp);
  const relatedFileIds = normalizeFileIds(input.relatedFileIds);
  const derivedFileIds = normalizeFileIds(input.derivedFileIds ?? input.metadata?.derivedFileIds);
  const campusId = cleanText(input.campusId, 120) || null;
  if (!context.isSuperAdmin) requireCampusAccess(context, campusId);
  else if (campusId) requireCampusAccess(context, campusId);
  await assertFilesCanBeLinked(db, context, campusId, relatedFileIds);
  await assertFilesCanBeLinked(db, context, campusId, derivedFileIds, true);

  const metadata = buildMetadata(input, sourceApp, relatedFileIds, derivedFileIds);
  const record = await createDataRecord(db, context, {
    campusId,
    recordType: recordTypeForSource(sourceApp),
    sourceApp,
    title: input.title,
    summary: input.summary,
    visibility: input.visibility || "campus",
    metadata,
    tags: normalizeTags(input.tags),
  });
  await setDataRecordContent(db, context, String(record.id), input.content || "");
  await auditContent(db, context, "create_content_draft", String(record.id), campusId, {
    sourceApp,
    relatedFileCount: relatedFileIds.length,
  });
  return contentDraftResponse(db, context, String(record.id));
}

export async function getContentDraft(
  db: D1Database,
  context: DataCoreAccessContext,
  recordId: string,
) {
  const draft = await contentDraftResponse(db, context, recordId);
  if (!["blog-draft", "instagram-draft"].includes(String(draft.recordType))) {
    throw new DataCoreAccessError(404, "콘텐츠 초안을 찾을 수 없습니다.");
  }
  return draft;
}

export async function updateContentDraft(
  db: D1Database,
  context: DataCoreAccessContext,
  recordId: string,
  input: ContentDraftInput,
) {
  requireWriteAccess(context);
  await ensureDataCoreMigrations(db);
  const existing = await db
    .prepare(
      `SELECT *
       FROM data_records
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
    )
    .bind(recordId, DEFAULT_ORGANIZATION_ID)
    .first<Record<string, unknown>>();
  if (!existing || !["blog-draft", "instagram-draft"].includes(String(existing.record_type))) {
    throw new DataCoreAccessError(404, "콘텐츠 초안을 찾을 수 없습니다.");
  }
  if (!canMutateRow(context, existing)) {
    throw new DataCoreAccessError(403, "본인이 만든 콘텐츠 초안만 수정할 수 있습니다.");
  }

  const sourceApp = normalizeSourceApp(input.sourceApp || existing.source_app);
  if (sourceApp !== existing.source_app) {
    throw new DataCoreAccessError(400, "콘텐츠 종류는 변경할 수 없습니다.");
  }
  const nextCampusId =
    input.campusId === undefined
      ? (existing.campus_id as string | null) || null
      : cleanText(input.campusId, 120) || null;
  if (!context.isSuperAdmin) requireCampusAccess(context, nextCampusId);
  else if (nextCampusId) requireCampusAccess(context, nextCampusId);

  const existingMetadata = parseMetadata(existing.metadata_json);
  const relatedFileIds = input.relatedFileIds === undefined
    ? normalizeFileIds(existingMetadata.relatedFileIds)
    : normalizeFileIds(input.relatedFileIds);
  await assertFilesCanBeLinked(db, context, nextCampusId, relatedFileIds);
  const derivedFileIds = normalizeFileIds(input.derivedFileIds ?? input.metadata?.derivedFileIds ?? existingMetadata.derivedFileIds);
  await assertFilesCanBeLinked(db, context, nextCampusId, derivedFileIds, true);

  const metadata = buildMetadata(
    {
      ...input,
      metadata: {
        ...existingMetadata,
        ...safeObject(input.metadata),
      },
    },
    sourceApp,
    relatedFileIds,
    derivedFileIds,
  );
  const record = await updateDataRecord(db, context, recordId, {
    campusId: nextCampusId,
    recordType: recordTypeForSource(sourceApp),
    sourceApp,
    title: input.title,
    summary: input.summary,
    visibility: input.visibility,
    metadata,
    tags: input.tags === undefined ? undefined : normalizeTags(input.tags),
  });
  if (input.content !== undefined) {
    await setDataRecordContent(db, context, String(record.id), input.content || "");
  }
  await auditContent(db, context, "update_content_draft", recordId, nextCampusId, {
    sourceApp,
    relatedFileCount: relatedFileIds.length,
  });
  return contentDraftResponse(db, context, recordId);
}

export async function deleteContentDraft(
  db: D1Database,
  context: DataCoreAccessContext,
  recordId: string,
) {
  await getContentDraft(db, context, recordId);
  return deleteDataRecord(db, context, recordId);
}
