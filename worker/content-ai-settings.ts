import { DEFAULT_ORGANIZATION_ID as ORG } from './data-core';
import { DataCoreAccessContext, DataCoreAccessError, requireWriteAccess, requireCampusAccess } from './data-core-access';

export const AI_JOB_TYPE = 'content-ai-request';
export const CONTENT_DEFAULTS_TYPE = 'content-defaults';
export function contentScope(context: DataCoreAccessContext, input: { sourceApp?: unknown; campusId?: unknown }) {
  requireWriteAccess(context);
  const sourceApp = String(input.sourceApp || '');
  if (!['blog','instagram'].includes(sourceApp)) throw new DataCoreAccessError(400, '콘텐츠 종류를 확인하세요.');
  const campusId = typeof input.campusId === 'string' && input.campusId ? input.campusId : null;
  if (!context.isSuperAdmin || campusId) requireCampusAccess(context, campusId);
  return { sourceApp, campusId };
}

export async function contentDefaults(db: D1Database, context: DataCoreAccessContext, input: { sourceApp?: unknown; campusId?: unknown; hashtags?: unknown; footer?: unknown }, save = false) {
  const { sourceApp, campusId } = contentScope(context, input);
  const id = `content-defaults:${sourceApp}:${campusId || 'organization'}`;
  if (save) {
    if (typeof input.hashtags !== 'string' || input.hashtags.length > 2000 || typeof input.footer !== 'string' || input.footer.length > 3000) throw new DataCoreAccessError(400, '기본 문구 길이를 확인하세요.');
    const metadata = JSON.stringify({ schemaVersion: 1, hashtags: input.hashtags.trim(), footer: input.footer.trim() });
    const now = new Date().toISOString();
    await db.prepare(`INSERT INTO data_records (id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'콘텐츠 기본 문구',?,'active',?,?,?) ON CONFLICT(id) DO UPDATE SET metadata_json=excluded.metadata_json,updated_at=excluded.updated_at
      WHERE data_records.organization_id=excluded.organization_id AND data_records.record_type=excluded.record_type AND data_records.campus_id IS excluded.campus_id AND data_records.deleted_at IS NULL`)
      .bind(id, ORG, campusId, context.user!.internalUserId, CONTENT_DEFAULTS_TYPE, sourceApp, campusId ? 'campus' : 'organization', metadata, now, now).run();
  }
  const row = await db.prepare('SELECT metadata_json FROM data_records WHERE id=? AND organization_id=? AND record_type=? AND campus_id IS ? AND deleted_at IS NULL')
    .bind(id, ORG, CONTENT_DEFAULTS_TYPE, campusId).first<{ metadata_json: string }>();
  let stored; try { stored = JSON.parse(row?.metadata_json || '{}'); } catch { stored = {}; }
  return { hashtags: typeof stored.hashtags === 'string' ? stored.hashtags : '', footer: typeof stored.footer === 'string' ? stored.footer : '' };
}

// A single conditional INSERT serializes the per-user lease across Worker isolates.
// No prompt, photo, credential or provider response is retained in this cost guard.
export async function withAiRequest<T>(db: D1Database, context: DataCoreAccessContext, requestId: unknown, campusId: string | null, operation: () => Promise<T>): Promise<T> {
  if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(requestId)) throw new DataCoreAccessError(400, '새 AI 요청으로 다시 시도해주세요.');
  const owner = context.user!.internalUserId, id = `ai:${owner}:${requestId}`, now = new Date().toISOString();
  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const result = await db.prepare(`INSERT INTO data_records (id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at)
    SELECT ?,?,?,?,?,'data-core','AI 요청','private','processing','{}',?,? WHERE NOT EXISTS
      (SELECT 1 FROM data_records WHERE organization_id=? AND record_type=? AND created_by_user_id=? AND status='processing' AND created_at>?)
    ON CONFLICT(id) DO NOTHING`).bind(id,ORG,campusId,owner,AI_JOB_TYPE,now,now,ORG,AI_JOB_TYPE,owner,since).run();
  if (Number(result.meta?.changes) !== 1) throw new DataCoreAccessError(409, '진행 중이거나 이미 처리한 AI 요청입니다. 잠시 후 다시 시도해주세요.');
  try {
    const output = await operation();
    const finished = new Date().toISOString();
    await db.prepare("UPDATE data_records SET status='complete',updated_at=?,deleted_at=? WHERE id=? AND organization_id=?").bind(finished,finished,id,ORG).run();
    return output;
  } catch (error) {
    const finished = new Date().toISOString();
    await db.prepare("UPDATE data_records SET status='failed',updated_at=?,deleted_at=? WHERE id=? AND organization_id=?").bind(finished,finished,id,ORG).run();
    throw error;
  }
}
