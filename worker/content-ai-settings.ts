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

const BRAND_KEYS = ['hi5', 'anihi'] as const;
const TEXT_KINDS: Record<string, number> = { greeting: 3000, hashtags: 2000, closing: 3000 };
const CONTACT_LIMITS: Record<string, number> = { phone: 60, address: 300, trialLink: 500, homeLink: 500, instaLink: 500 };
const unresolved = /\{\{[^}]*\}\}|\b(?:undefined|null)\b/;
// 메인 화면 문구 설정: each of 인사말 / 고정 해시태그 / 고정 마지막 문구 keeps its chosen brand and one text
// per brand, plus 상담전화·주소·세 링크. Links are only ever the https address the user typed.
function cleanTextSettings(value: unknown) {
  type Settings = { brands?: Record<string, unknown>; values?: Record<string, Record<string, unknown>>; contact?: Record<string, unknown> };
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Settings : null;
  if (!input) throw new DataCoreAccessError(400, '문구 설정을 확인하세요.');
  const brands: Record<string, string> = {}, values: Record<string, Record<string, string>> = {}, contact: Record<string, string> = {};
  for (const [kind, max] of Object.entries(TEXT_KINDS)) {
    const brand = input.brands?.[kind];
    if (typeof brand !== 'string' || !(BRAND_KEYS as readonly string[]).includes(brand)) throw new DataCoreAccessError(400, '문구 브랜드를 확인하세요.');
    brands[kind] = brand; values[kind] = {};
    for (const key of BRAND_KEYS) {
      const text = input.values?.[kind]?.[key] ?? '';
      if (typeof text !== 'string' || text.length > max || unresolved.test(text)) throw new DataCoreAccessError(400, '문구 길이와 내용을 확인하세요.');
      values[kind][key] = text;
    }
  }
  for (const [key, max] of Object.entries(CONTACT_LIMITS)) {
    const text = input.contact?.[key] ?? '';
    if (typeof text !== 'string' || text.length > max || /[\r\n<>]/.test(text) || unresolved.test(text)) throw new DataCoreAccessError(400, '연락처·링크 설정을 확인하세요.');
    const clean = text.trim();
    if (clean && key.endsWith('Link')) {
      let url: URL | null = null; try { url = new URL(clean); } catch { /* reported below */ }
      if (!url || url.protocol !== 'https:' || url.username || url.password) throw new DataCoreAccessError(400, '링크는 https:// 로 시작하는 주소만 저장할 수 있습니다.');
    }
    contact[key] = clean;
  }
  return { schemaVersion: 1, brands, values, contact };
}

export async function contentDefaults(db: D1Database, context: DataCoreAccessContext, input: { sourceApp?: unknown; campusId?: unknown; hashtags?: unknown; footer?: unknown; blogSettings?: any; instagramSettings?: { logoType?: unknown; mode?: unknown }; textSettings?: unknown }, save = false) {
  const { sourceApp, campusId } = contentScope(context, input);
  const id = `content-defaults:${sourceApp}:${campusId || 'organization'}`;
  if (save) {
    // Fixed 해시태그/마지막 문구 are only written when this request is about them; a 양식-only save leaves
    // them exactly as stored instead of overwriting them with whatever the (maybe unsaved/unloaded) fields hold.
    const saveText = input.hashtags !== undefined || input.footer !== undefined;
    if (saveText && (typeof input.hashtags !== 'string' || input.hashtags.length > 2000 || typeof input.footer !== 'string' || input.footer.length > 3000)) throw new DataCoreAccessError(400, '기본 문구 길이를 확인하세요.');
    if (!saveText && input.blogSettings === undefined && input.instagramSettings === undefined && input.textSettings === undefined) throw new DataCoreAccessError(400, '저장할 기본값을 확인하세요.');
    const textSettings = input.textSettings === undefined ? undefined : cleanTextSettings(input.textSettings);
    let blogSettings;
    if(input.blogSettings!==undefined){
      if(sourceApp!=='blog'||!['balanced','search','homefeed'].includes(input.blogSettings?.strategyMode))throw new DataCoreAccessError(400,'블로그 기본 글 방향을 확인하세요.');
      const t=input.blogSettings.template;
      if(!t||!['class','student','teacher','award','admission','career','recruit','space'].includes(t.templateId)||typeof t.greeting!=='string'||t.greeting.length>2000)throw new DataCoreAccessError(400,'블로그 양식을 확인하세요.');
      const {canReadRegisteredFile}=await import('./data-core-derivative-policy');
      for(const id of [t.topFileId,t.bottomFileId].filter(Boolean)){
        if(typeof id!=='string'||id.length>120)throw new DataCoreAccessError(400,'양식 이미지 참조를 확인하세요.');
        const row=await db.prepare('SELECT * FROM file_objects WHERE id=? AND organization_id=? AND deleted_at IS NULL').bind(id,ORG).first<Record<string,any>>();
        if(!row||row.campus_id!==campusId||!await canReadRegisteredFile(db,context,row))throw new DataCoreAccessError(403,'양식 이미지 접근 권한을 확인하세요.');
      }
      const {LOGOS}=await import('../public/data-core/instagram-brand-policy.js');
      const normalized={templateId:t.templateId,templateVersion:1,topFileId:t.topFileId||'',bottomFileId:t.bottomFileId||'',greeting:t.greeting,logoType:Object.hasOwn(LOGOS,t.logoType)?t.logoType:'none',align:t.align==='center'?'center':'left',spacing:[16,24,32].includes(t.spacing)?t.spacing:24,font:t.font==='serif'?'serif':'sans-serif',coverWidth:1200,coverHeight:900,contactMode:t.contactMode==='none'?'none':'verified'};
      blogSettings={strategyMode:input.blogSettings.strategyMode,template:normalized,templates:{[t.templateId]:normalized}};
    }
    let instagramSettings;
    if(input.instagramSettings!==undefined){
      if(sourceApp!=='instagram')throw new DataCoreAccessError(400,'인스타 기본 양식을 확인하세요.');
      const {LOGOS,CUSTOM_LOGO_PATTERN}=await import('../public/data-core/instagram-brand-policy.js');
      const s=input.instagramSettings;
      if(!s||typeof s.logoType!=='string'||typeof s.mode!=='string'||!['original','photo-layout','photo'].includes(s.mode))throw new DataCoreAccessError(400,'인스타 기본 양식을 확인하세요.');
      if(CUSTOM_LOGO_PATTERN.test(s.logoType)){
        const {resolveCustomLogo}=await import('./instagram-custom-logos');
        if(!await resolveCustomLogo(db,context,s.logoType.slice('custom:'.length)))throw new DataCoreAccessError(400,'선택한 로고를 확인하세요.');
      } else if(!Object.hasOwn(LOGOS,s.logoType))throw new DataCoreAccessError(400,'인스타 기본 양식을 확인하세요.');
      instagramSettings={logoType:s.logoType,mode:s.mode};
    }
    const metadata = JSON.stringify({ schemaVersion: 1,...(saveText?{ hashtags: (input.hashtags as string).trim(), footer: input.footer }:{}),...(blogSettings?{blogSettings}:{}),...(instagramSettings?{instagramSettings}:{}),...(textSettings?{textSettings}:{}) });
    const now = new Date().toISOString();
    await db.prepare(`INSERT INTO data_records (id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'콘텐츠 기본 문구',?,'active',?,?,?) ON CONFLICT(id) DO UPDATE SET metadata_json=json_patch(CASE WHEN json_valid(data_records.metadata_json) THEN data_records.metadata_json ELSE '{}' END,excluded.metadata_json),updated_at=excluded.updated_at
      WHERE data_records.organization_id=excluded.organization_id AND data_records.record_type=excluded.record_type AND data_records.campus_id IS excluded.campus_id AND data_records.deleted_at IS NULL`)
      .bind(id, ORG, campusId, context.user!.internalUserId, CONTENT_DEFAULTS_TYPE, sourceApp, campusId ? 'campus' : 'organization', metadata, now, now).run();
  }
  const row = await db.prepare('SELECT metadata_json FROM data_records WHERE id=? AND organization_id=? AND record_type=? AND campus_id IS ? AND deleted_at IS NULL')
    .bind(id, ORG, CONTENT_DEFAULTS_TYPE, campusId).first<{ metadata_json: string }>();
  let stored; try { stored = JSON.parse(row?.metadata_json || '{}'); } catch { stored = {}; }
  return { hashtags: typeof stored.hashtags === 'string' ? stored.hashtags : '', footer: typeof stored.footer === 'string' ? stored.footer : '',...(sourceApp==='blog'&&stored.blogSettings?{blogSettings:stored.blogSettings}:{}),...(sourceApp==='instagram'&&stored.instagramSettings?{instagramSettings:stored.instagramSettings}:{}),...(stored.textSettings&&typeof stored.textSettings==='object'?{textSettings:stored.textSettings}:{}) };
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
