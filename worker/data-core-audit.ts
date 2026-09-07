import { DEFAULT_ORGANIZATION_ID } from "./data-core";
import {
  DataCoreAccessContext,
  requireAuthenticatedAccess,
} from "./data-core-access";

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function parseMetadata(value: unknown) {
  if (typeof value !== "string" || !value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export async function listAuditLogs(
  db: D1Database,
  context: DataCoreAccessContext,
  url: URL,
) {
  requireAuthenticatedAccess(context);
  const action = cleanText(url.searchParams.get("action"), 80);
  const resourceType = cleanText(url.searchParams.get("resourceType"), 80);
  const campusId = cleanText(url.searchParams.get("campusId"), 120);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 200);

  const conditions = ["a.organization_id = ?"];
  const bindings: unknown[] = [DEFAULT_ORGANIZATION_ID];

  if (!context.isSuperAdmin) {
    if (!context.user) return [];
    conditions.push("a.actor_user_id = ?");
    bindings.push(context.user.internalUserId);
  }
  if (action) {
    conditions.push("a.action = ?");
    bindings.push(action);
  }
  if (resourceType) {
    conditions.push("a.resource_type = ?");
    bindings.push(resourceType);
  }
  if (campusId) {
    conditions.push("a.campus_id = ?");
    bindings.push(campusId);
  }

  const result = await db
    .prepare(
      `SELECT
         a.id,
         a.campus_id,
         a.actor_user_id,
         a.action,
         a.resource_type,
         a.resource_id,
         a.metadata_json,
         a.created_at,
         c.name AS campus_name,
         u.display_name AS actor_name,
         u.email AS actor_email
       FROM audit_logs a
       LEFT JOIN campuses c ON c.id = a.campus_id
       LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY a.created_at DESC
       LIMIT ?`,
    )
    .bind(...bindings, limit)
    .all<Record<string, unknown>>();

  return (result.results || []).map((row) => ({
    id: row.id,
    campusId: row.campus_id,
    campusName: row.campus_name,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    actorEmail: context.isSuperAdmin ? row.actor_email : undefined,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
  }));
}
