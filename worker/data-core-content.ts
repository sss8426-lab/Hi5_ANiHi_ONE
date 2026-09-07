import { DEFAULT_ORGANIZATION_ID } from "./data-core";
import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireAuthenticatedAccess,
  requireCampusAccess,
  requireWriteAccess,
} from "./data-core-access";
import { ensureDataCoreMigrations } from "./data-core-migrations";

export const CONTENT_PLATFORMS = ["blog", "instagram"] as const;
export type ContentPlatform = (typeof CONTENT_PLATFORMS)[number];

export const CONTENT_STATUSES = ["draft", "review", "ready", "published", "archived"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const CONTENT_MEDIA_ROLES = ["source", "output", "cover", "gallery"] as const;
export type ContentMediaRole = (typeof CONTENT_MEDIA_ROLES)[number];

export type ContentInput = {
  campusId?: string | null;
  platform?: string;
  title?: string;
  content?: string | null;
  summary?: string | null;
  status?: string;
  contentType?: string | null;
  visibility?: "private" | "campus" | "organization" | "public";
  tags?: string[];
  metadata?: Record<string, unknown> | null;
};

export type ContentMediaLinkInput = {
  fileId?: string;
  role?: string;
  position?: number;
  metadata?: Record<string, unknown> | null;
};

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizePlatform(value: unknown): ContentPlatform {
  const platform = cleanText(value, 30) as ContentPlatform;
  if (!CONTENT_PLATFORMS.includes(platform)) {
    throw new DataCoreAccessError(400, "platform은 blog 또는 instagram이어야 합니다.");
  }
  return platform;
}

function normalizeStatus(value: unknown, fallback: ContentStatus = "draft"): ContentStatus {
  const status = cleanText(value, 30) as ContentStatus;
  return CONTENT_STATUSES.includes(status) ? status : fallback;
}

function normalizeMediaRole(value: unknown): ContentMediaRole {
  const role = cleanText(value, 30) as ContentMediaRole;
  if (!CONTENT_MEDIA_ROLES.includes(role)) {
    throw new DataCoreAccessError(400, "지원하지 않는 media role입니다.");
  }
  return role;
}

function normalizeVisibility(value: unknown) {
  const visibility = cleanText(value, 30);
  if (["private", "campus", "organization", "public"].includes(visibility)) return visibility;
  return "campus";
}

function safeJson(value: unknown, maxLength = 200_000) {
  try {
    const serialized = JSON.stringify(value ?? {});
    if (serialized.length > maxLength) throw new DataCoreAccessError(413, "메타데이터가 너무 큽니다.");
    return serialized;
  } catch (error) {
    if (error instanceof DataCoreAccessError) throw error;
    throw new DataCoreAccessError(400, "JSON으로 저장 가능한 데이터가 필요합니다.");
  }
}

function parseJson(value: unknown) {
  if (typeof value !== "string" || !value) return {};
  try { return JSON.parse(value); } catch { return {}; }
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => cleanText(item, 80)).filter(Boolean))).slice(0, 40);
}

function instagramDefaults(metadata: Record<string, unknown>) {
  return {
    ...metadata,
    imageSpec: {
      width: 2160,
      height: 2700,
      aspectRatio: "4:5",
      ...(metadata.imageSpec && typeof metadata.imageSpec === "object" ? metadata.imageSpec as object : {}),
    },
  };
}

function normalizeMetadata(platform: ContentPlatform, value: unknown) {
  const base = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return platform === "instagram" ? instagramDefaults(base) : base;
}

function canReadContent(context: DataCoreAccessContext, row: Record<string, unknown>) {
  if (context.isSuperAdmin) return true;
  if (row.visibility === "public") return true;
  if (!context.user || !context.memberships.length) return false;
  if (row.visibility === "organization") return true;
  if (row.visibility === "campus") {
    return typeof row.campus_id === "string" && context.campusIds.includes(row.campus_id);
  }
  return row.created_by_user_id === context.user.internalUserId;
}

function canMutateContent(context: DataCoreAccessContext, row: Record<string, unknown>) {
  if (context.isSuperAdmin) return true;
  return row.created_by_user_id === context.user?.internalUserId;
}

function canReadFile(context: DataCoreAccessContext, row: Record<string, unknown>) {
  if (context.isSuperAdmin) return true;
  if (!context.user || !context.memberships.length) return false;
  if (row.visibility === "organization" || row.visibility === "public") return true;
  if (row.visibility === "campus") {
    return typeof row.campus_id === "string" && context.campusIds.includes(row.campus_id);
  }
  return row.owner_user_id === context.user.internalUserId;
}

async function ensureContentSchema(db: D1Database) {
  await ensureDataCoreMigrations(db);
  await db.exec(`CREATE TABLE IF NOT EXISTS content_media_links (
    id TEXT PRIMARY KEY NOT NULL,
    organization_id TEXT NOT NULL,
    content_record_id TEXT NOT NULL,
    file_object_id TEXT NOT NULL,
    role TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_by_user_id TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (content_record_id) REFERENCES data_records(id) ON DELETE CASCADE,
    FOREIGN KEY (file_object_id) REFERENCES file_objects(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (content_record_id, file_object_id, role)
  )`);
  await db.exec(
    "CREATE INDEX IF NOT EXISTS content_media_links_record_idx ON content_media_links(content_record_id, role, position)",
  );
  await db.exec(
    "CREATE INDEX IF NOT EXISTS content_media_links_file_idx ON content_media_links(file_object_id)",
  );
}

async function audit(
  db: D1Database,
  context: DataCoreAccessContext,
  action: string,
  resourceId: string,
  campusId: string | null,
  metadata: unknown = {},
) {
  if (!context.user) return;
  await db
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, campus_id, actor_user_id,
         action, resource_type, resource_id, metadata_json, created_at
       ) VALUES (?, ?, ?, ?, ?, 'content_record', ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(), DEFAULT_ORGANIZATION_ID, campusId,
      context.user.internalUserId, action, resourceId,
      safeJson(metadata), new Date().toISOString(),
    )
    .run();
}

async function replaceTags(db: D1Database, recordId: string, tags: string[]) {
  await db.prepare("DELETE FROM data_record_tags WHERE data_record_id = ?").bind(recordId).run();
  if (!tags.length) return;
  const now = new Date().toISOString();
  for (const name of tags) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO tags (id, organization_id, name, tag_type, created_at)
         VALUES (?, ?, ?, 'content', ?)`,
      )
      .bind(crypto.randomUUID(), DEFAULT_ORGANIZATION_ID, name, now)
      .run();
    const tag = await db
      .prepare("SELECT id FROM tags WHERE organization_id = ? AND tag_type = 'content' AND name = ?")
      .bind(DEFAULT_ORGANIZATION_ID, name)
      .first<{ id: string }>();
    if (tag?.id) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO data_record_tags (id, data_record_id, tag_id, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), recordId, tag.id, now)
        .run();
    }
  }
}

async function tagsForContent(db: D1Database, recordId: string) {
  const result = await db
    .prepare(
      `SELECT t.name FROM data_record_tags drt
       INNER JOIN tags t ON t.id = drt.tag_id
       WHERE drt.data_record_id = ? ORDER BY t.name`,
    )
    .bind(recordId)
    .all<{ name: string }>();
  return (result.results || []).map((row) => row.name);
}

async function mediaForContent(db: D1Database, context: DataCoreAccessContext, recordId: string) {
  const result = await db
    .prepare(
      `SELECT cml.id AS link_id, cml.role, cml.position, cml.metadata_json AS link_metadata,
              fo.*, c.name AS campus_name
       FROM content_media_links cml
       INNER JOIN file_objects fo ON fo.id = cml.file_object_id AND fo.deleted_at IS NULL
       LEFT JOIN campuses c ON c.id = fo.campus_id
       WHERE cml.organization_id = ? AND cml.content_record_id = ?
       ORDER BY cml.role, cml.position, cml.created_at`,
    )
    .bind(DEFAULT_ORGANIZATION_ID, recordId)
    .all<Record<string, unknown>>();
  return (result.results || [])
    .filter((row) => canReadFile(context, row))
    .map((row) => ({
      linkId: row.link_id,
      fileId: row.id,
      role: row.role,
      position: row.position,
      fileName: row.original_file_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      sourceApp: row.source_app || "legacy",
      area: row.area,
      category: row.category,
      campusId: row.campus_id,
      campusName: row.campus_name,
      metadata: parseJson(row.link_metadata),
      downloadUrl: `/api/data-core/files/${encodeURIComponent(String(row.id))}`,
    }));
}

function rowToContent(row: Record<string, unknown>, tags: string[], media: unknown[]) {
  const metadata = parseJson(row.metadata_json) as Record<string, unknown>;
  return {
    id: row.id,
    campusId: row.campus_id,
    campusName: row.campus_name ?? null,
    platform: row.source_app,
    title: row.title,
    summary: row.summary,
    content: row.content_text,
    status: metadata.status || "draft",
    contentType: metadata.contentType || null,
    visibility: row.visibility,
    metadata,
    tags,
    media,
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function contentRow(db: D1Database, id: string) {
  return db
    .prepare(
      `SELECT dr.*, c.name AS campus_name, u.display_name AS created_by_name
       FROM data_records dr
       LEFT JOIN campuses c ON c.id = dr.campus_id
       LEFT JOIN users u ON u.id = dr.created_by_user_id
       WHERE dr.id = ? AND dr.organization_id = ?
         AND dr.record_type = 'content_post' AND dr.deleted_at IS NULL`,
    )
    .bind(id, DEFAULT_ORGANIZATION_ID)
    .first<Record<string, unknown>>();
}

export async function getContentRecord(
  db: D1Database,
  context: DataCoreAccessContext,
  id: string,
) {
  requireAuthenticatedAccess(context);
  await ensureContentSchema(db);
  const row = await contentRow(db, id);
  if (!row) throw new DataCoreAccessError(404, "콘텐츠를 찾을 수 없습니다.");
  if (!canReadContent(context, row)) throw new DataCoreAccessError(403, "이 콘텐츠를 볼 권한이 없습니다.");
  return rowToContent(row, await tagsForContent(db, id), await mediaForContent(db, context, id));
}

export async function listContentRecords(
  db: D1Database,
  context: DataCoreAccessContext,
  url: URL,
) {
  requireAuthenticatedAccess(context);
  await ensureContentSchema(db);
  const platform = cleanText(url.searchParams.get("platform"), 30);
  const status = cleanText(url.searchParams.get("status"), 30);
  const campusId = cleanText(url.searchParams.get("campusId"), 120);
  const q = cleanText(url.searchParams.get("q"), 160);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 100);
  if (platform) normalizePlatform(platform);
  if (status && !CONTENT_STATUSES.includes(status as ContentStatus)) {
    throw new DataCoreAccessError(400, "지원하지 않는 content status입니다.");
  }

  const conditions = ["dr.organization_id = ?", "dr.record_type = 'content_post'", "dr.deleted_at IS NULL"];
  const bindings: unknown[] = [DEFAULT_ORGANIZATION_ID];
  if (platform) { conditions.push("dr.source_app = ?"); bindings.push(platform); }
  if (campusId) { conditions.push("dr.campus_id = ?"); bindings.push(campusId); }
  if (status) { conditions.push("json_extract(dr.metadata_json, '$.status') = ?"); bindings.push(status); }
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    conditions.push("(dr.title LIKE ? OR dr.summary LIKE ? OR dr.content_text LIKE ? OR dr.metadata_json LIKE ?)");
    bindings.push(like, like, like, like);
  }

  const result = await db
    .prepare(
      `SELECT dr.*, c.name AS campus_name, u.display_name AS created_by_name
       FROM data_records dr
       LEFT JOIN campuses c ON c.id = dr.campus_id
       LEFT JOIN users u ON u.id = dr.created_by_user_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY dr.updated_at DESC LIMIT ?`,
    )
    .bind(...bindings, limit)
    .all<Record<string, unknown>>();

  const visible = (result.results || []).filter((row) => canReadContent(context, row));
  const items = [];
  for (const row of visible) {
    const id = String(row.id);
    items.push(rowToContent(row, await tagsForContent(db, id), await mediaForContent(db, context, id)));
  }
  return items;
}

export async function createContentRecord(
  db: D1Database,
  context: DataCoreAccessContext,
  input: ContentInput,
) {
  requireWriteAccess(context);
  if (!context.user) throw new DataCoreAccessError(401, "로그인이 필요합니다.");
  await ensureContentSchema(db);

  const platform = normalizePlatform(input.platform);
  const title = cleanText(input.title, 240);
  if (!title) throw new DataCoreAccessError(400, "title이 필요합니다.");
  const campusId = cleanText(input.campusId, 120) || null;
  if (!context.isSuperAdmin) {
    if (!campusId) throw new DataCoreAccessError(400, "캠퍼스 사용자는 campusId가 필요합니다.");
    requireCampusAccess(context, campusId);
  } else if (campusId) requireCampusAccess(context, campusId);

  const status = normalizeStatus(input.status);
  const metadata = normalizeMetadata(platform, {
    ...normalizeMetadata(platform, input.metadata),
    status,
    contentType: cleanText(input.contentType, 80) || null,
  });
  let visibility = normalizeVisibility(input.visibility);
  if (!context.isSuperAdmin) visibility = "campus";
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO data_records (
         id, organization_id, campus_id, created_by_user_id,
         record_type, source_app, title, summary, content_text,
         visibility, status, metadata_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'content_post', ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    )
    .bind(
      id, DEFAULT_ORGANIZATION_ID, campusId, context.user.internalUserId,
      platform, title, cleanText(input.summary, 10_000) || null,
      cleanText(input.content, 200_000) || null, visibility,
      safeJson(metadata), now, now,
    )
    .run();
  await replaceTags(db, id, normalizeTags(input.tags));
  await audit(db, context, "create", id, campusId, { platform, status });
  return getContentRecord(db, context, id);
}

export async function updateContentRecord(
  db: D1Database,
  context: DataCoreAccessContext,
  id: string,
  input: ContentInput,
) {
  requireWriteAccess(context);
  await ensureContentSchema(db);
  const existing = await contentRow(db, id);
  if (!existing) throw new DataCoreAccessError(404, "콘텐츠를 찾을 수 없습니다.");
  if (!canMutateContent(context, existing)) throw new DataCoreAccessError(403, "본인이 만든 콘텐츠만 수정할 수 있습니다.");

  const platform = input.platform === undefined
    ? normalizePlatform(existing.source_app)
    : normalizePlatform(input.platform);
  const campusId = input.campusId === undefined
    ? (existing.campus_id as string | null)
    : cleanText(input.campusId, 120) || null;
  if (!context.isSuperAdmin) requireCampusAccess(context, campusId);
  else if (campusId) requireCampusAccess(context, campusId);

  const oldMetadata = parseJson(existing.metadata_json) as Record<string, unknown>;
  const nextMetadataBase = input.metadata === undefined
    ? oldMetadata
    : { ...oldMetadata, ...normalizeMetadata(platform, input.metadata) };
  const nextStatus = input.status === undefined
    ? normalizeStatus(oldMetadata.status, "draft")
    : normalizeStatus(input.status);
  const metadata = normalizeMetadata(platform, {
    ...nextMetadataBase,
    status: nextStatus,
    contentType: input.contentType === undefined
      ? oldMetadata.contentType ?? null
      : cleanText(input.contentType, 80) || null,
  });
  const title = input.title === undefined ? String(existing.title) : cleanText(input.title, 240);
  if (!title) throw new DataCoreAccessError(400, "title은 비워둘 수 없습니다.");
  let visibility = input.visibility === undefined
    ? normalizeVisibility(existing.visibility)
    : normalizeVisibility(input.visibility);
  if (!context.isSuperAdmin) visibility = "campus";

  await db
    .prepare(
      `UPDATE data_records SET campus_id = ?, source_app = ?, title = ?, summary = ?,
       content_text = ?, visibility = ?, metadata_json = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(
      campusId, platform, title,
      input.summary === undefined ? existing.summary : cleanText(input.summary, 10_000) || null,
      input.content === undefined ? existing.content_text : cleanText(input.content, 200_000) || null,
      visibility, safeJson(metadata), new Date().toISOString(), id,
    )
    .run();
  if (input.tags !== undefined) await replaceTags(db, id, normalizeTags(input.tags));
  await audit(db, context, "update", id, campusId, { platform, status: nextStatus });
  return getContentRecord(db, context, id);
}

export async function deleteContentRecord(
  db: D1Database,
  context: DataCoreAccessContext,
  id: string,
) {
  requireWriteAccess(context);
  const existing = await contentRow(db, id);
  if (!existing) throw new DataCoreAccessError(404, "콘텐츠를 찾을 수 없습니다.");
  if (!canMutateContent(context, existing)) throw new DataCoreAccessError(403, "본인이 만든 콘텐츠만 삭제할 수 있습니다.");
  const deletedAt = new Date().toISOString();
  await db.prepare("UPDATE data_records SET deleted_at = ?, updated_at = ? WHERE id = ?").bind(deletedAt, deletedAt, id).run();
  await audit(db, context, "delete", id, (existing.campus_id as string | null) || null);
  return { ok: true, id, deletedAt };
}

export async function linkContentMedia(
  db: D1Database,
  context: DataCoreAccessContext,
  contentId: string,
  input: ContentMediaLinkInput,
) {
  requireWriteAccess(context);
  if (!context.user) throw new DataCoreAccessError(401, "로그인이 필요합니다.");
  await ensureContentSchema(db);
  const content = await contentRow(db, contentId);
  if (!content) throw new DataCoreAccessError(404, "콘텐츠를 찾을 수 없습니다.");
  if (!canMutateContent(context, content)) throw new DataCoreAccessError(403, "본인이 만든 콘텐츠에만 파일을 연결할 수 있습니다.");

  const fileId = cleanText(input.fileId, 160);
  if (!fileId) throw new DataCoreAccessError(400, "fileId가 필요합니다.");
  const file = await db
    .prepare("SELECT * FROM file_objects WHERE id = ? AND organization_id = ? AND deleted_at IS NULL")
    .bind(fileId, DEFAULT_ORGANIZATION_ID)
    .first<Record<string, unknown>>();
  if (!file) throw new DataCoreAccessError(404, "연결할 파일을 찾을 수 없습니다.");
  if (!canReadFile(context, file)) throw new DataCoreAccessError(403, "이 파일을 사용할 권한이 없습니다.");

  const role = normalizeMediaRole(input.role);
  const position = Math.max(0, Math.min(Number(input.position) || 0, 10_000));
  const now = new Date().toISOString();
  const linkId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO content_media_links (
         id, organization_id, content_record_id, file_object_id, role,
         position, metadata_json, created_by_user_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(content_record_id, file_object_id, role) DO UPDATE SET
         position = excluded.position,
         metadata_json = excluded.metadata_json`,
    )
    .bind(
      linkId, DEFAULT_ORGANIZATION_ID, contentId, fileId, role, position,
      safeJson(input.metadata), context.user.internalUserId, now,
    )
    .run();
  await audit(db, context, "link_media", contentId, (content.campus_id as string | null) || null, { fileId, role });
  return getContentRecord(db, context, contentId);
}

export async function unlinkContentMedia(
  db: D1Database,
  context: DataCoreAccessContext,
  contentId: string,
  linkId: string,
) {
  requireWriteAccess(context);
  const content = await contentRow(db, contentId);
  if (!content) throw new DataCoreAccessError(404, "콘텐츠를 찾을 수 없습니다.");
  if (!canMutateContent(context, content)) throw new DataCoreAccessError(403, "본인이 만든 콘텐츠만 수정할 수 있습니다.");
  const result = await db
    .prepare("DELETE FROM content_media_links WHERE id = ? AND content_record_id = ? AND organization_id = ?")
    .bind(linkId, contentId, DEFAULT_ORGANIZATION_ID)
    .run();
  await audit(db, context, "unlink_media", contentId, (content.campus_id as string | null) || null, { linkId });
  return { ok: true, contentId, linkId, changed: result.meta.changes };
}
