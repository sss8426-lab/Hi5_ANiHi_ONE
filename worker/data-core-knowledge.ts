import { DEFAULT_ORGANIZATION_ID } from "./data-core";
import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireAuthenticatedAccess,
  requireCampusAccess,
  requireWriteAccess,
} from "./data-core-access";
import { ensureDataCoreMigrations } from "./data-core-migrations";

export const KNOWLEDGE_NODE_TYPES = [
  "career",
  "major",
  "university",
  "university_program",
  "admission_method",
  "skill",
  "curriculum_module",
] as const;

export type KnowledgeNodeType = (typeof KNOWLEDGE_NODE_TYPES)[number];

export const KNOWLEDGE_RELATIONS = [
  "RELATED_MAJOR",
  "LEADS_TO_PROGRAM",
  "OFFERED_BY",
  "USES_ADMISSION_METHOD",
  "REQUIRES_SKILL",
  "LEARNED_THROUGH",
  "PREREQUISITE_OF",
  "RELATED_TO",
] as const;

export type KnowledgeRelationType = (typeof KNOWLEDGE_RELATIONS)[number];

export type KnowledgeNodeInput = {
  campusId?: string | null;
  nodeType?: string;
  name?: string;
  summary?: string | null;
  content?: string | null;
  visibility?: "private" | "campus" | "organization" | "public";
  metadata?: unknown;
};

export type KnowledgeEdgeInput = {
  campusId?: string | null;
  fromNodeId?: string;
  toNodeId?: string;
  relationType?: string;
  weight?: number;
  metadata?: unknown;
};

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function safeJson(value: unknown, maxLength = 200_000) {
  try {
    const serialized = JSON.stringify(value ?? {});
    if (serialized.length > maxLength) {
      throw new DataCoreAccessError(413, "메타데이터가 너무 큽니다.");
    }
    return serialized;
  } catch (error) {
    if (error instanceof DataCoreAccessError) throw error;
    throw new DataCoreAccessError(400, "JSON으로 저장 가능한 metadata가 필요합니다.");
  }
}

function parseJson(value: unknown) {
  if (typeof value !== "string" || !value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function normalizeNodeType(value: unknown): KnowledgeNodeType {
  const type = cleanText(value, 60) as KnowledgeNodeType;
  if (!KNOWLEDGE_NODE_TYPES.includes(type)) {
    throw new DataCoreAccessError(400, `지원하지 않는 지식 노드 유형입니다: ${type || "빈 값"}`);
  }
  return type;
}

function normalizeRelation(value: unknown): KnowledgeRelationType {
  const relation = cleanText(value, 80) as KnowledgeRelationType;
  if (!KNOWLEDGE_RELATIONS.includes(relation)) {
    throw new DataCoreAccessError(400, `지원하지 않는 지식 관계입니다: ${relation || "빈 값"}`);
  }
  return relation;
}

function normalizeVisibility(
  value: unknown,
): "private" | "campus" | "organization" | "public" {
  const visibility = cleanText(value, 30);
  if (["private", "campus", "organization", "public"].includes(visibility)) {
    return visibility as "private" | "campus" | "organization" | "public";
  }
  return "organization";
}

function rowToNode(row: Record<string, unknown>) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    campusId: row.campus_id,
    campusName: row.campus_name ?? null,
    nodeType: row.node_type,
    name: row.name,
    summary: row.summary ?? null,
    content: row.content_text ?? null,
    visibility: row.visibility,
    status: row.status,
    metadata: parseJson(row.metadata_json),
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEdge(row: Record<string, unknown>) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    campusId: row.campus_id,
    relationType: row.relation_type,
    fromNodeId: row.from_node_id,
    fromNodeName: row.from_name ?? null,
    fromNodeType: row.from_type ?? null,
    toNodeId: row.to_node_id,
    toNodeName: row.to_name ?? null,
    toNodeType: row.to_type ?? null,
    weight: Number(row.weight ?? 1),
    metadata: parseJson(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function canReadNode(context: DataCoreAccessContext, row: Record<string, unknown>) {
  if (context.isSuperAdmin) return true;
  if (row.visibility === "public") return true;
  if (!context.user || !context.memberships.length) return false;
  if (row.visibility === "organization") return true;
  if (row.visibility === "campus") {
    return typeof row.campus_id === "string" && context.campusIds.includes(row.campus_id);
  }
  return row.created_by_user_id === context.user.internalUserId;
}

function canMutateNode(context: DataCoreAccessContext, row: Record<string, unknown>) {
  if (context.isSuperAdmin) return true;
  return context.user?.internalUserId === row.created_by_user_id;
}

async function audit(
  db: D1Database,
  context: DataCoreAccessContext,
  action: string,
  resourceType: string,
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
      safeJson(metadata),
      new Date().toISOString(),
    )
    .run();
}

export async function ensureKnowledgeSchema(db: D1Database) {
  await ensureDataCoreMigrations(db);
  await db.exec(`CREATE TABLE IF NOT EXISTS knowledge_nodes (
    id TEXT PRIMARY KEY NOT NULL,
    organization_id TEXT NOT NULL,
    campus_id TEXT,
    node_type TEXT NOT NULL,
    name TEXT NOT NULL,
    summary TEXT,
    content_text TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    visibility TEXT NOT NULL DEFAULT 'organization',
    status TEXT NOT NULL DEFAULT 'active',
    created_by_user_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  )`);
  await db.exec(
    "CREATE INDEX IF NOT EXISTS knowledge_nodes_type_idx ON knowledge_nodes(node_type)",
  );
  await db.exec(
    "CREATE INDEX IF NOT EXISTS knowledge_nodes_name_idx ON knowledge_nodes(name)",
  );
  await db.exec(
    "CREATE INDEX IF NOT EXISTS knowledge_nodes_campus_idx ON knowledge_nodes(campus_id)",
  );

  await db.exec(`CREATE TABLE IF NOT EXISTS knowledge_edges (
    id TEXT PRIMARY KEY NOT NULL,
    organization_id TEXT NOT NULL,
    campus_id TEXT,
    from_node_id TEXT NOT NULL,
    to_node_id TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 1,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_by_user_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE SET NULL,
    FOREIGN KEY (from_node_id) REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (to_node_id) REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  )`);
  await db.exec(
    "CREATE INDEX IF NOT EXISTS knowledge_edges_from_idx ON knowledge_edges(from_node_id, relation_type)",
  );
  await db.exec(
    "CREATE INDEX IF NOT EXISTS knowledge_edges_to_idx ON knowledge_edges(to_node_id, relation_type)",
  );
}

export async function listKnowledgeNodes(
  db: D1Database,
  context: DataCoreAccessContext,
  url: URL,
) {
  requireAuthenticatedAccess(context);
  await ensureKnowledgeSchema(db);
  const q = cleanText(url.searchParams.get("q"), 160);
  const nodeType = cleanText(url.searchParams.get("nodeType"), 60);
  const campusId = cleanText(url.searchParams.get("campusId"), 120);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 100);

  const conditions = ["kn.organization_id = ?", "kn.deleted_at IS NULL"];
  const bindings: unknown[] = [DEFAULT_ORGANIZATION_ID];
  if (nodeType) {
    normalizeNodeType(nodeType);
    conditions.push("kn.node_type = ?");
    bindings.push(nodeType);
  }
  if (campusId) {
    conditions.push("kn.campus_id = ?");
    bindings.push(campusId);
  }
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    conditions.push("(kn.name LIKE ? OR kn.summary LIKE ? OR kn.content_text LIKE ? OR kn.metadata_json LIKE ?)");
    bindings.push(like, like, like, like);
  }

  const result = await db
    .prepare(
      `SELECT kn.*, c.name AS campus_name, u.display_name AS created_by_name
       FROM knowledge_nodes kn
       LEFT JOIN campuses c ON c.id = kn.campus_id
       LEFT JOIN users u ON u.id = kn.created_by_user_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY kn.node_type, kn.name
       LIMIT ?`,
    )
    .bind(...bindings, limit)
    .all<Record<string, unknown>>();

  return (result.results || []).filter((row) => canReadNode(context, row)).map(rowToNode);
}

export async function getKnowledgeNode(
  db: D1Database,
  context: DataCoreAccessContext,
  id: string,
) {
  requireAuthenticatedAccess(context);
  await ensureKnowledgeSchema(db);
  const row = await db
    .prepare(
      `SELECT kn.*, c.name AS campus_name, u.display_name AS created_by_name
       FROM knowledge_nodes kn
       LEFT JOIN campuses c ON c.id = kn.campus_id
       LEFT JOIN users u ON u.id = kn.created_by_user_id
       WHERE kn.id = ? AND kn.organization_id = ? AND kn.deleted_at IS NULL`,
    )
    .bind(id, DEFAULT_ORGANIZATION_ID)
    .first<Record<string, unknown>>();
  if (!row) throw new DataCoreAccessError(404, "지식 노드를 찾을 수 없습니다.");
  if (!canReadNode(context, row)) {
    throw new DataCoreAccessError(403, "이 지식 정보를 볼 권한이 없습니다.");
  }
  return rowToNode(row);
}

export async function createKnowledgeNode(
  db: D1Database,
  context: DataCoreAccessContext,
  input: KnowledgeNodeInput,
) {
  requireWriteAccess(context);
  if (!context.user) throw new DataCoreAccessError(401, "로그인이 필요합니다.");
  await ensureKnowledgeSchema(db);

  const nodeType = normalizeNodeType(input.nodeType);
  const name = cleanText(input.name, 240);
  if (!name) throw new DataCoreAccessError(400, "name이 필요합니다.");
  const campusId = cleanText(input.campusId, 120) || null;
  if (!context.isSuperAdmin) {
    if (!campusId) throw new DataCoreAccessError(400, "캠퍼스 사용자는 campusId가 필요합니다.");
    requireCampusAccess(context, campusId);
  } else if (campusId) {
    requireCampusAccess(context, campusId);
  }

  let visibility = normalizeVisibility(input.visibility);
  if (!context.isSuperAdmin && visibility === "organization") visibility = "campus";
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO knowledge_nodes (
         id, organization_id, campus_id, node_type, name, summary, content_text,
         metadata_json, visibility, status, created_by_user_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    )
    .bind(
      id,
      DEFAULT_ORGANIZATION_ID,
      campusId,
      nodeType,
      name,
      cleanText(input.summary, 10_000) || null,
      cleanText(input.content, 100_000) || null,
      safeJson(input.metadata),
      visibility,
      context.user.internalUserId,
      now,
      now,
    )
    .run();
  await audit(db, context, "create", "knowledge_node", id, campusId, { nodeType, name });
  return getKnowledgeNode(db, context, id);
}

export async function updateKnowledgeNode(
  db: D1Database,
  context: DataCoreAccessContext,
  id: string,
  input: KnowledgeNodeInput,
) {
  requireWriteAccess(context);
  await ensureKnowledgeSchema(db);
  const existing = await db
    .prepare(
      `SELECT * FROM knowledge_nodes
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
    )
    .bind(id, DEFAULT_ORGANIZATION_ID)
    .first<Record<string, unknown>>();
  if (!existing) throw new DataCoreAccessError(404, "지식 노드를 찾을 수 없습니다.");
  if (!canMutateNode(context, existing)) {
    throw new DataCoreAccessError(403, "본인이 만든 지식 정보만 수정할 수 있습니다.");
  }

  const campusId =
    input.campusId === undefined
      ? ((existing.campus_id as string | null) || null)
      : cleanText(input.campusId, 120) || null;
  if (!context.isSuperAdmin) requireCampusAccess(context, campusId);
  else if (campusId) requireCampusAccess(context, campusId);

  const nodeType = input.nodeType === undefined
    ? (existing.node_type as KnowledgeNodeType)
    : normalizeNodeType(input.nodeType);
  const name = input.name === undefined ? String(existing.name) : cleanText(input.name, 240);
  if (!name) throw new DataCoreAccessError(400, "name은 비워둘 수 없습니다.");
  let visibility = input.visibility === undefined
    ? normalizeVisibility(existing.visibility)
    : normalizeVisibility(input.visibility);
  if (!context.isSuperAdmin && visibility === "organization") visibility = "campus";

  await db
    .prepare(
      `UPDATE knowledge_nodes SET
         campus_id = ?, node_type = ?, name = ?, summary = ?, content_text = ?,
         metadata_json = ?, visibility = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      campusId,
      nodeType,
      name,
      input.summary === undefined ? existing.summary : cleanText(input.summary, 10_000) || null,
      input.content === undefined ? existing.content_text : cleanText(input.content, 100_000) || null,
      input.metadata === undefined ? String(existing.metadata_json || "{}") : safeJson(input.metadata),
      visibility,
      new Date().toISOString(),
      id,
    )
    .run();
  await audit(db, context, "update", "knowledge_node", id, campusId, { nodeType, name });
  return getKnowledgeNode(db, context, id);
}

export async function deleteKnowledgeNode(
  db: D1Database,
  context: DataCoreAccessContext,
  id: string,
) {
  requireWriteAccess(context);
  const existing = await db
    .prepare(
      `SELECT * FROM knowledge_nodes
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
    )
    .bind(id, DEFAULT_ORGANIZATION_ID)
    .first<Record<string, unknown>>();
  if (!existing) throw new DataCoreAccessError(404, "지식 노드를 찾을 수 없습니다.");
  if (!canMutateNode(context, existing)) {
    throw new DataCoreAccessError(403, "본인이 만든 지식 정보만 삭제할 수 있습니다.");
  }
  const deletedAt = new Date().toISOString();
  await db.prepare("UPDATE knowledge_nodes SET deleted_at = ? WHERE id = ?").bind(deletedAt, id).run();
  await db
    .prepare("UPDATE knowledge_edges SET deleted_at = ? WHERE (from_node_id = ? OR to_node_id = ?) AND deleted_at IS NULL")
    .bind(deletedAt, id, id)
    .run();
  await audit(
    db,
    context,
    "delete",
    "knowledge_node",
    id,
    (existing.campus_id as string | null) || null,
    { nodeType: existing.node_type, name: existing.name },
  );
  return { ok: true, id, deletedAt };
}

async function readableNodeIds(db: D1Database, context: DataCoreAccessContext, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const placeholders = ids.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT * FROM knowledge_nodes
       WHERE id IN (${placeholders}) AND organization_id = ? AND deleted_at IS NULL`,
    )
    .bind(...ids, DEFAULT_ORGANIZATION_ID)
    .all<Record<string, unknown>>();
  return new Set(
    (result.results || []).filter((row) => canReadNode(context, row)).map((row) => String(row.id)),
  );
}

export async function listKnowledgeEdges(
  db: D1Database,
  context: DataCoreAccessContext,
  url: URL,
) {
  requireAuthenticatedAccess(context);
  await ensureKnowledgeSchema(db);
  const fromNodeId = cleanText(url.searchParams.get("fromNodeId"), 120);
  const toNodeId = cleanText(url.searchParams.get("toNodeId"), 120);
  const relationType = cleanText(url.searchParams.get("relationType"), 80);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 300);
  const conditions = ["ke.organization_id = ?", "ke.deleted_at IS NULL"];
  const bindings: unknown[] = [DEFAULT_ORGANIZATION_ID];
  if (fromNodeId) {
    conditions.push("ke.from_node_id = ?");
    bindings.push(fromNodeId);
  }
  if (toNodeId) {
    conditions.push("ke.to_node_id = ?");
    bindings.push(toNodeId);
  }
  if (relationType) {
    normalizeRelation(relationType);
    conditions.push("ke.relation_type = ?");
    bindings.push(relationType);
  }

  const result = await db
    .prepare(
      `SELECT ke.*,
              fn.name AS from_name, fn.node_type AS from_type,
              tn.name AS to_name, tn.node_type AS to_type
       FROM knowledge_edges ke
       INNER JOIN knowledge_nodes fn ON fn.id = ke.from_node_id AND fn.deleted_at IS NULL
       INNER JOIN knowledge_nodes tn ON tn.id = ke.to_node_id AND tn.deleted_at IS NULL
       WHERE ${conditions.join(" AND ")}
       ORDER BY ke.weight DESC, ke.created_at
       LIMIT ?`,
    )
    .bind(...bindings, limit)
    .all<Record<string, unknown>>();
  const rows = result.results || [];
  const ids = Array.from(new Set(rows.flatMap((row) => [String(row.from_node_id), String(row.to_node_id)])));
  const readable = await readableNodeIds(db, context, ids);
  return rows
    .filter((row) => readable.has(String(row.from_node_id)) && readable.has(String(row.to_node_id)))
    .map(rowToEdge);
}

export async function createKnowledgeEdge(
  db: D1Database,
  context: DataCoreAccessContext,
  input: KnowledgeEdgeInput,
) {
  requireWriteAccess(context);
  if (!context.user) throw new DataCoreAccessError(401, "로그인이 필요합니다.");
  await ensureKnowledgeSchema(db);
  const fromNodeId = cleanText(input.fromNodeId, 120);
  const toNodeId = cleanText(input.toNodeId, 120);
  if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) {
    throw new DataCoreAccessError(400, "서로 다른 fromNodeId와 toNodeId가 필요합니다.");
  }
  const relationType = normalizeRelation(input.relationType);
  const readable = await readableNodeIds(db, context, [fromNodeId, toNodeId]);
  if (readable.size !== 2) {
    throw new DataCoreAccessError(403, "연결하려는 지식 노드에 접근할 권한이 없습니다.");
  }
  const campusId = cleanText(input.campusId, 120) || null;
  if (!context.isSuperAdmin && campusId) requireCampusAccess(context, campusId);
  const weight = Number.isFinite(Number(input.weight)) ? Math.max(0, Math.min(Number(input.weight), 100)) : 1;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO knowledge_edges (
         id, organization_id, campus_id, from_node_id, to_node_id,
         relation_type, weight, metadata_json, created_by_user_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      DEFAULT_ORGANIZATION_ID,
      campusId,
      fromNodeId,
      toNodeId,
      relationType,
      weight,
      safeJson(input.metadata),
      context.user.internalUserId,
      now,
      now,
    )
    .run();
  await audit(db, context, "create", "knowledge_edge", id, campusId, {
    fromNodeId,
    toNodeId,
    relationType,
  });

  const url = new URL("https://local/api");
  url.searchParams.set("fromNodeId", fromNodeId);
  const edges = await listKnowledgeEdges(db, context, url);
  return edges.find((edge) => edge.id === id) || { id };
}

export async function deleteKnowledgeEdge(
  db: D1Database,
  context: DataCoreAccessContext,
  id: string,
) {
  requireWriteAccess(context);
  const row = await db
    .prepare(
      `SELECT * FROM knowledge_edges
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
    )
    .bind(id, DEFAULT_ORGANIZATION_ID)
    .first<Record<string, unknown>>();
  if (!row) throw new DataCoreAccessError(404, "지식 관계를 찾을 수 없습니다.");
  if (!context.isSuperAdmin && row.created_by_user_id !== context.user?.internalUserId) {
    throw new DataCoreAccessError(403, "본인이 만든 지식 관계만 삭제할 수 있습니다.");
  }
  const deletedAt = new Date().toISOString();
  await db.prepare("UPDATE knowledge_edges SET deleted_at = ? WHERE id = ?").bind(deletedAt, id).run();
  await audit(
    db,
    context,
    "delete",
    "knowledge_edge",
    id,
    (row.campus_id as string | null) || null,
  );
  return { ok: true, id, deletedAt };
}
