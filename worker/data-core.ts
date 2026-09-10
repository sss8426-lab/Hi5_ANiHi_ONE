export const DEFAULT_ORGANIZATION_ID = "org-hi5-anihi";
export const DEFAULT_ORGANIZATION_SLUG = "hi5-anihi";
export const DEFAULT_ORGANIZATION_NAME = "HI5·ANiHi";

export const DATA_CORE_VERSION = "foundation-v1.3";

export type DataCoreFileArea =
  | "student-private"
  | "documents-private"
  | "academy-public"
  | "exports-temporary";

export interface FileObjectInput {
  id: string;
  organizationId?: string | null;
  campusId?: string | null;
  dataRecordId?: string | null;
  ownerUserId?: string | null;
  sourceApp?: string | null;
  area: DataCoreFileArea;
  category: string;
  r2Key: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  visibility: "private" | "campus" | "organization" | "public";
  createdAt: string;
}

let schemaReady: Promise<void> | null = null;

export function fileAreaForPurpose(purpose: string): DataCoreFileArea {
  if (purpose === "student-artwork") return "student-private";
  if (purpose === "admission-images" || purpose === "award-images") return "academy-public";
  return "documents-private";
}

export function visibilityForArea(area: DataCoreFileArea): FileObjectInput["visibility"] {
  return area === "academy-public" ? "public" : "private";
}

export async function ensureDataCoreDatabase(db: D1Database): Promise<void> {
  if (!schemaReady) {
    schemaReady = initializeSchema(db).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function ensureFileObjectSourceAppColumn(db: D1Database) {
  const result = await db
    .prepare("PRAGMA table_info(file_objects)")
    .all<{ name: string }>();
  const exists = (result.results || []).some((column) => column.name === "source_app");
  if (!exists) {
    await db.exec("ALTER TABLE file_objects ADD COLUMN source_app TEXT NOT NULL DEFAULT 'legacy'");
  }
  await db.exec(
    "CREATE INDEX IF NOT EXISTS file_objects_source_app_idx ON file_objects(source_app)",
  );
}

async function initializeSchema(db: D1Database): Promise<void> {
  const now = new Date().toISOString();
  const statements = [
    `CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS campuses (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      UNIQUE (organization_id, code)
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      auth_subject TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email) WHERE email IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS memberships (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL,
      campus_id TEXT,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships(user_id)`,
    `CREATE INDEX IF NOT EXISTS memberships_campus_idx ON memberships(campus_id)`,
    `CREATE TABLE IF NOT EXISTS data_records (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL,
      campus_id TEXT,
      created_by_user_id TEXT,
      record_type TEXT NOT NULL,
      source_app TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      visibility TEXT NOT NULL DEFAULT 'organization',
      status TEXT NOT NULL DEFAULT 'active',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE INDEX IF NOT EXISTS data_records_type_idx ON data_records(record_type)`,
    `CREATE INDEX IF NOT EXISTS data_records_campus_idx ON data_records(campus_id)`,
    `CREATE INDEX IF NOT EXISTS data_records_source_app_idx ON data_records(source_app)`,
    `CREATE TABLE IF NOT EXISTS file_objects (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL,
      campus_id TEXT,
      data_record_id TEXT,
      owner_user_id TEXT,
      area TEXT NOT NULL,
      category TEXT NOT NULL,
      source_app TEXT NOT NULL DEFAULT 'legacy',
      r2_key TEXT NOT NULL UNIQUE,
      original_file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      visibility TEXT NOT NULL DEFAULT 'private',
      created_at TEXT NOT NULL,
      deleted_at TEXT,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE SET NULL,
      FOREIGN KEY (data_record_id) REFERENCES data_records(id) ON DELETE SET NULL,
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE INDEX IF NOT EXISTS file_objects_campus_idx ON file_objects(campus_id)`,
    `CREATE INDEX IF NOT EXISTS file_objects_category_idx ON file_objects(category)`,
    `CREATE INDEX IF NOT EXISTS file_objects_record_idx ON file_objects(data_record_id)`,
    `CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      tag_type TEXT NOT NULL DEFAULT 'general',
      created_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      UNIQUE (organization_id, tag_type, name)
    )`,
    `CREATE TABLE IF NOT EXISTS data_record_tags (
      id TEXT PRIMARY KEY NOT NULL,
      data_record_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (data_record_id) REFERENCES data_records(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
      UNIQUE (data_record_id, tag_id)
    )`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL,
      campus_id TEXT,
      actor_user_id TEXT,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE SET NULL,
      FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at)`,
    `CREATE INDEX IF NOT EXISTS audit_logs_resource_idx ON audit_logs(resource_type, resource_id)`,
  ].map((sql) => db.prepare(sql));

  await db.batch(statements);
  await ensureFileObjectSourceAppColumn(db);
  await db
    .prepare(
      `INSERT OR IGNORE INTO organizations (id, slug, name, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)`,
    )
    .bind(
      DEFAULT_ORGANIZATION_ID,
      DEFAULT_ORGANIZATION_SLUG,
      DEFAULT_ORGANIZATION_NAME,
      now,
      now,
    )
    .run();
}

export async function recordFileObject(db: D1Database, input: FileObjectInput): Promise<void> {
  await ensureDataCoreDatabase(db);
  const result = await db
    .prepare(
      `INSERT INTO file_objects (
        id, organization_id, campus_id, data_record_id, owner_user_id,
        area, category, source_app, r2_key, original_file_name, mime_type,
        size_bytes, visibility, created_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE ? IS NULL OR EXISTS (SELECT 1 FROM data_records WHERE id = ? AND deleted_at IS NULL)`,
    )
    .bind(
      input.id,
      input.organizationId || DEFAULT_ORGANIZATION_ID,
      input.campusId || null,
      input.dataRecordId || null,
      input.ownerUserId || null,
      input.area,
      input.category,
      input.sourceApp || "legacy",
      input.r2Key,
      input.originalFileName,
      input.mimeType || "application/octet-stream",
      input.sizeBytes || 0,
      input.visibility,
      input.createdAt,
      input.dataRecordId || null,
      input.dataRecordId || null,
    )
    .run();
  if (Number(result.meta?.changes) !== 1) throw new Error('연결 폴더 상태가 변경되어 파일을 저장하지 않았습니다.');
}

export async function dataCoreHealth(db?: D1Database, files?: R2Bucket) {
  if (db) await ensureDataCoreDatabase(db);
  return {
    ok: Boolean(db && files),
    version: DATA_CORE_VERSION,
    bindings: {
      database: Boolean(db),
      files: Boolean(files),
    },
    mode: db && files ? "central" : "degraded",
  };
}

export type DataCoreRequestIdentity = {
  userId: string;
  email: string;
  displayName: string;
};

const AUTH_USER_ID_HEADER = "oai-authenticated-user-id";
const AUTH_USER_EMAIL_HEADER = "oai-authenticated-user-email";
const AUTH_USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const AUTH_USER_FULL_NAME_ENCODING_HEADER = "oai-authenticated-user-full-name-encoding";

function safeDecodeHeader(value: string | null, encoding: string | null): string | null {
  if (!value) return null;
  if (encoding !== "percent-encoded-utf-8") return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function requestIdentity(request: Request): DataCoreRequestIdentity | null {
  const userId = request.headers.get(AUTH_USER_ID_HEADER);
  const email = request.headers.get(AUTH_USER_EMAIL_HEADER);
  if (!userId || !email) return null;
  const fullName = safeDecodeHeader(
    request.headers.get(AUTH_USER_FULL_NAME_HEADER),
    request.headers.get(AUTH_USER_FULL_NAME_ENCODING_HEADER),
  );
  return { userId, email, displayName: fullName || email };
}

export async function syncRequestUser(db: D1Database, identity: DataCoreRequestIdentity): Promise<string> {
  await ensureDataCoreDatabase(db);
  const now = new Date().toISOString();
  const id = `oai:${identity.userId}`;
  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, status, auth_subject, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         email = excluded.email,
         display_name = excluded.display_name,
         auth_subject = excluded.auth_subject,
         updated_at = excluded.updated_at`,
    )
    .bind(id, identity.email, identity.displayName, identity.userId, now, now)
    .run();
  return id;
}

export async function dataCoreContext(request: Request, db?: D1Database) {
  const identity = requestIdentity(request);
  if (!identity) return { authenticated: false, database: Boolean(db), memberships: [] };
  if (!db) {
    return {
      authenticated: true,
      database: false,
      user: identity,
      memberships: [],
    };
  }

  const internalUserId = await syncRequestUser(db, identity);
  const result = await db
    .prepare(
      `SELECT m.id, m.organization_id, m.campus_id, m.role, c.name AS campus_name
       FROM memberships m
       LEFT JOIN campuses c ON c.id = m.campus_id
       WHERE m.user_id = ?
       ORDER BY m.role, c.name`,
    )
    .bind(internalUserId)
    .all();

  return {
    authenticated: true,
    database: true,
    user: { ...identity, internalUserId },
    memberships: result.results || [],
  };
}
