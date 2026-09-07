import { DEFAULT_ORGANIZATION_ID } from "./data-core";
import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireAuthenticatedAccess,
} from "./data-core-access";
import { ensureKnowledgeSchema } from "./data-core-knowledge";
import { ensureDataCoreMigrations } from "./data-core-migrations";

const PAGE_SIZE = 500;

type BackupSection = {
  name: string;
  fetchPage: (db: D1Database, offset: number) => Promise<Record<string, unknown>[]>;
};

function requireSuperAdmin(context: DataCoreAccessContext) {
  requireAuthenticatedAccess(context);
  if (!context.isSuperAdmin || !context.user) {
    throw new DataCoreAccessError(403, "운영 데이터 백업은 마스터 관리자만 실행할 수 있습니다.");
  }
}

async function fetchOrganizations(db: D1Database, offset: number) {
  const result = await db
    .prepare(
      `SELECT id, slug, name, status, created_at, updated_at
       FROM organizations
       WHERE id = ?
       ORDER BY id LIMIT ? OFFSET ?`,
    )
    .bind(DEFAULT_ORGANIZATION_ID, PAGE_SIZE, offset)
    .all<Record<string, unknown>>();
  return result.results || [];
}

async function fetchCampuses(db: D1Database, offset: number) {
  const result = await db
    .prepare(
      `SELECT id, organization_id, code, name, status, created_at, updated_at
       FROM campuses
       WHERE organization_id = ?
       ORDER BY id LIMIT ? OFFSET ?`,
    )
    .bind(DEFAULT_ORGANIZATION_ID, PAGE_SIZE, offset)
    .all<Record<string, unknown>>();
  return result.results || [];
}

async function fetchDataRecords(db: D1Database, offset: number) {
  const result = await db
    .prepare(
      `SELECT id, organization_id, campus_id, record_type, source_app,
              title, summary, visibility, status, metadata_json, content_text,
              created_at, updated_at, deleted_at
       FROM data_records
       WHERE organization_id = ?
       ORDER BY id LIMIT ? OFFSET ?`,
    )
    .bind(DEFAULT_ORGANIZATION_ID, PAGE_SIZE, offset)
    .all<Record<string, unknown>>();
  return result.results || [];
}

async function fetchFileObjects(db: D1Database, offset: number) {
  const result = await db
    .prepare(
      `SELECT id, organization_id, campus_id, data_record_id, area, category,
              source_app, r2_key, original_file_name, mime_type, size_bytes, visibility,
              created_at, deleted_at
       FROM file_objects
       WHERE organization_id = ?
       ORDER BY id LIMIT ? OFFSET ?`,
    )
    .bind(DEFAULT_ORGANIZATION_ID, PAGE_SIZE, offset)
    .all<Record<string, unknown>>();
  return result.results || [];
}

async function fetchTags(db: D1Database, offset: number) {
  const result = await db
    .prepare(
      `SELECT id, organization_id, name, tag_type, created_at
       FROM tags
       WHERE organization_id = ?
       ORDER BY id LIMIT ? OFFSET ?`,
    )
    .bind(DEFAULT_ORGANIZATION_ID, PAGE_SIZE, offset)
    .all<Record<string, unknown>>();
  return result.results || [];
}

async function fetchRecordTags(db: D1Database, offset: number) {
  const result = await db
    .prepare(
      `SELECT drt.id, drt.data_record_id, drt.tag_id, drt.created_at
       FROM data_record_tags drt
       INNER JOIN data_records dr ON dr.id = drt.data_record_id
       WHERE dr.organization_id = ?
       ORDER BY drt.id LIMIT ? OFFSET ?`,
    )
    .bind(DEFAULT_ORGANIZATION_ID, PAGE_SIZE, offset)
    .all<Record<string, unknown>>();
  return result.results || [];
}

async function fetchKnowledgeNodes(db: D1Database, offset: number) {
  const result = await db
    .prepare(
      `SELECT id, organization_id, campus_id, node_type, name, summary,
              content_text, metadata_json, visibility, status,
              created_at, updated_at, deleted_at
       FROM knowledge_nodes
       WHERE organization_id = ?
       ORDER BY id LIMIT ? OFFSET ?`,
    )
    .bind(DEFAULT_ORGANIZATION_ID, PAGE_SIZE, offset)
    .all<Record<string, unknown>>();
  return result.results || [];
}

async function fetchKnowledgeEdges(db: D1Database, offset: number) {
  const result = await db
    .prepare(
      `SELECT id, organization_id, campus_id, from_node_id, to_node_id,
              relation_type, weight, metadata_json,
              created_at, updated_at, deleted_at
       FROM knowledge_edges
       WHERE organization_id = ?
       ORDER BY id LIMIT ? OFFSET ?`,
    )
    .bind(DEFAULT_ORGANIZATION_ID, PAGE_SIZE, offset)
    .all<Record<string, unknown>>();
  return result.results || [];
}

const SECTIONS: BackupSection[] = [
  { name: "organizations", fetchPage: fetchOrganizations },
  { name: "campuses", fetchPage: fetchCampuses },
  { name: "data_records", fetchPage: fetchDataRecords },
  { name: "file_objects", fetchPage: fetchFileObjects },
  { name: "tags", fetchPage: fetchTags },
  { name: "data_record_tags", fetchPage: fetchRecordTags },
  { name: "knowledge_nodes", fetchPage: fetchKnowledgeNodes },
  { name: "knowledge_edges", fetchPage: fetchKnowledgeEdges },
];

async function snapshotSection(
  db: D1Database,
  files: R2Bucket,
  section: BackupSection,
  prefix: string,
) {
  const pageKeys: string[] = [];
  let offset = 0;
  let page = 0;
  let count = 0;

  while (true) {
    const rows = await section.fetchPage(db, offset);
    if (!rows.length) break;
    const key = `${prefix}/sections/${section.name}/page-${String(page).padStart(5, "0")}.json`;
    await files.put(
      key,
      JSON.stringify({ section: section.name, page, count: rows.length, rows }),
      { httpMetadata: { contentType: "application/json; charset=utf-8" } },
    );
    pageKeys.push(key);
    count += rows.length;
    offset += rows.length;
    page += 1;
    if (rows.length < PAGE_SIZE) break;
  }

  return { count, pageKeys };
}

export async function createDataCoreBackup(
  db: D1Database,
  files: R2Bucket,
  context: DataCoreAccessContext,
) {
  requireSuperAdmin(context);
  await ensureDataCoreMigrations(db);
  await ensureKnowledgeSchema(db);

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[:.]/g, "-");
  const prefix = `data-core/backups/${DEFAULT_ORGANIZATION_ID}/${stamp}-${id}`;

  await db
    .prepare(
      `INSERT INTO data_backups (
         id, organization_id, created_by_user_id, status, backup_type,
         r2_prefix, total_rows, table_counts_json, created_at
       ) VALUES (?, ?, ?, 'creating', 'operational-metadata', ?, 0, '{}', ?)`,
    )
    .bind(id, DEFAULT_ORGANIZATION_ID, context.user!.internalUserId, prefix, createdAt)
    .run();

  try {
    const sections: Record<string, { count: number; pageKeys: string[] }> = {};
    let totalRows = 0;
    for (const section of SECTIONS) {
      const snapshot = await snapshotSection(db, files, section, prefix);
      sections[section.name] = snapshot;
      totalRows += snapshot.count;
    }

    const completedAt = new Date().toISOString();
    const manifestKey = `${prefix}/manifest.json`;
    const manifest = {
      schema: "hi5-anihi-data-core-operational-backup",
      version: 2,
      backupId: id,
      organizationId: DEFAULT_ORGANIZATION_ID,
      createdAt,
      completedAt,
      totalRows,
      sections,
      exclusions: [
        "users",
        "memberships",
        "audit_logs",
        "R2 file bytes (original file objects remain in their existing keys)",
      ],
    };
    await files.put(manifestKey, JSON.stringify(manifest), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
    });

    const counts = Object.fromEntries(
      Object.entries(sections).map(([name, value]) => [name, value.count]),
    );
    await db
      .prepare(
        `UPDATE data_backups
         SET status = 'completed', manifest_key = ?, total_rows = ?,
             table_counts_json = ?, completed_at = ?
         WHERE id = ?`,
      )
      .bind(manifestKey, totalRows, JSON.stringify(counts), completedAt, id)
      .run();

    return {
      id,
      status: "completed",
      createdAt,
      completedAt,
      totalRows,
      sectionCounts: counts,
      manifestUrl: `/api/data-core/admin/backups/${encodeURIComponent(id)}/manifest`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Backup failed";
    await db
      .prepare(
        `UPDATE data_backups
         SET status = 'failed', error_message = ?, completed_at = ?
         WHERE id = ?`,
      )
      .bind(message, new Date().toISOString(), id)
      .run();
    throw error;
  }
}

export async function listDataCoreBackups(
  db: D1Database,
  context: DataCoreAccessContext,
) {
  requireSuperAdmin(context);
  await ensureDataCoreMigrations(db);
  const result = await db
    .prepare(
      `SELECT id, status, backup_type, total_rows, table_counts_json,
              created_at, completed_at, verified_at, error_message, manifest_key
       FROM data_backups
       WHERE organization_id = ?
       ORDER BY created_at DESC LIMIT 100`,
    )
    .bind(DEFAULT_ORGANIZATION_ID)
    .all<Record<string, unknown>>();

  return (result.results || []).map((row) => ({
    id: row.id,
    status: row.status,
    backupType: row.backup_type,
    totalRows: row.total_rows,
    sectionCounts: parseJson(row.table_counts_json),
    createdAt: row.created_at,
    completedAt: row.completed_at,
    verifiedAt: row.verified_at,
    error: row.error_message,
    manifestUrl: row.manifest_key
      ? `/api/data-core/admin/backups/${encodeURIComponent(String(row.id))}/manifest`
      : null,
  }));
}

function parseJson(value: unknown) {
  if (typeof value !== "string") return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export async function readBackupManifest(
  db: D1Database,
  files: R2Bucket,
  context: DataCoreAccessContext,
  backupId: string,
) {
  requireSuperAdmin(context);
  await ensureDataCoreMigrations(db);
  const row = await db
    .prepare(
      `SELECT manifest_key FROM data_backups
       WHERE id = ? AND organization_id = ? AND status = 'completed'`,
    )
    .bind(backupId, DEFAULT_ORGANIZATION_ID)
    .first<{ manifest_key: string | null }>();
  if (!row?.manifest_key) throw new DataCoreAccessError(404, "완료된 백업을 찾을 수 없습니다.");

  const object = await files.get(row.manifest_key);
  if (!object) throw new DataCoreAccessError(404, "백업 manifest 파일을 찾을 수 없습니다.");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", "private, no-store");
  headers.set(
    "content-disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(`data-core-backup-${backupId}.json`)}`,
  );
  return new Response(object.body, { headers });
}
