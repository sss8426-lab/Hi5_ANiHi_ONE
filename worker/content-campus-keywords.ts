import { DEFAULT_ORGANIZATION_ID as ORG } from './data-core';
import { DataCoreAccessContext, DataCoreAccessError, requireCampusAccess } from './data-core-access';
import { canonicalCampusId } from './campus-directory';
import { KEYWORD_BRANDS, cleanCampusKeywords, defaultCampusKeywords, campusRegions } from '../public/data-core/campus-seo-keywords.js';

// 캠퍼스 고정 키워드: one record per campus, shared by blog and Instagram. Anyone who belongs to the campus
// (and the MASTER / super admin) may edit it; a brand with no saved edit uses the default list.
export const CAMPUS_KEYWORDS_TYPE = 'content-campus-keywords';
type BrandKeywords = { tags: string[]; updatedAt: string; updatedBy: string };
type KeywordData = { revision: number; brands: Record<string, BrandKeywords> };
const BRAND_IDS = Object.keys(KEYWORD_BRANDS);
const fail = (status: number, message: string): never => { throw new DataCoreAccessError(status, message); };
const recordId = (campusId: string) => `campus-keywords:${ORG}:${campusId}`;

async function read(db: D1Database, campusId: string) {
  const row = await db.prepare('SELECT metadata_json FROM data_records WHERE id=? AND organization_id=? AND record_type=? AND deleted_at IS NULL')
    .bind(recordId(campusId), ORG, CAMPUS_KEYWORDS_TYPE).first<{ metadata_json: string }>();
  let data: KeywordData = { revision: 0, brands: {} };
  if (row) try { const parsed = JSON.parse(row.metadata_json); if (parsed && typeof parsed === 'object') data = { revision: Number(parsed.revision) || 0, brands: parsed.brands || {} }; } catch { /* a damaged record falls back to the defaults */ }
  return { row, data };
}
function present(campusId: string, data: KeywordData) {
  const keywords: Record<string, string[]> = {}, customized: Record<string, boolean> = {};
  for (const brand of BRAND_IDS) {
    const saved = data.brands[brand];
    customized[brand] = Array.isArray(saved?.tags) && saved.tags.length > 0;
    keywords[brand] = customized[brand] ? saved.tags : defaultCampusKeywords(campusId, brand);
  }
  return { campusId, revision: data.revision, regions: campusRegions(campusId), keywords, customized };
}
function scope(context: DataCoreAccessContext, value: unknown) {
  const campusId = canonicalCampusId(value);
  if (!campusId) fail(400, '캠퍼스를 선택하세요.');
  requireCampusAccess(context, campusId);
  return campusId!;
}

// The keywords a generation request should use — read on the server, never taken from the request.
export async function loadCampusKeywords(db: D1Database, campusId: string | null, brand: unknown) {
  if (!campusId || !BRAND_IDS.includes(String(brand))) return null;
  const { data } = await read(db, campusId);
  return present(campusId, data).keywords[String(brand)];
}

export async function campusKeywords(db: D1Database, context: DataCoreAccessContext, input: Record<string, unknown>, mutate = false) {
  const campusId = scope(context, input.campusId);
  const campus = await db.prepare("SELECT id FROM campuses WHERE id=? AND organization_id=? AND status='active'").bind(campusId, ORG).first();
  if (!campus) fail(404, '캠퍼스를 찾을 수 없습니다.');
  const { row, data } = await read(db, campusId);
  if (!mutate) return present(campusId, data);
  const brand = String(input.brand);
  if (!BRAND_IDS.includes(brand)) fail(400, '브랜드를 확인하세요.');
  if (input.revision !== data.revision) fail(409, '다른 사람이 먼저 고정 키워드를 바꿨습니다. 새로 불러온 뒤 다시 저장하세요.');
  const now = new Date().toISOString();
  if (input.reset === true) delete data.brands[brand];
  else {
    let tags: string[] = [];
    try { tags = cleanCampusKeywords(input.tags); } catch (error) { fail(400, (error as Error).message); }
    data.brands[brand] = { tags, updatedAt: now, updatedBy: context.user!.internalUserId };
  }
  data.revision++;
  const metadata = JSON.stringify(data);
  const result = row
    ? await db.prepare('UPDATE data_records SET metadata_json=?,updated_at=? WHERE id=? AND organization_id=? AND record_type=? AND metadata_json=? AND deleted_at IS NULL')
      .bind(metadata, now, recordId(campusId), ORG, CAMPUS_KEYWORDS_TYPE, row.metadata_json).run()
    : await db.prepare(`INSERT INTO data_records (id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,'content','캠퍼스 고정 키워드','private','active',?,?,?) ON CONFLICT(id) DO NOTHING`)
      .bind(recordId(campusId), ORG, campusId, context.user!.internalUserId, CAMPUS_KEYWORDS_TYPE, metadata, now, now).run();
  if (result.meta?.changes !== 1) fail(409, '동시에 다른 변경이 저장됐습니다. 새로 불러온 뒤 다시 저장하세요.');
  return present(campusId, data);
}
