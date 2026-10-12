import { DEFAULT_ORGANIZATION_ID as ORG } from './data-core';
import { DataCoreAccessError, type DataCoreAccessContext } from './data-core-access';
import { AWARD_FOLDER, awardAudit, awardMetadata, requireAwardMember } from './data-core-awards';

// User-supplied folder names, not an admissions eligibility or campus directory.
export const UNIVERSITY_WORK_FOLDERS = [
  '건국대학교 (글로컬캠퍼스)', '경기대학교 (서울캠퍼스)', '경남대학교', '경운대학교',
  '경성대학교', '경일대학교', '계명대학교 (대명캠퍼스)', '공주대학교', '극동대학교',
  '남서울대학교', '대구가톨릭대학교', '대구대학교', '대구예술대학교', '대전대학교',
  '대진대학교', '동국대학교 (WISE캠퍼스)', '동명대학교', '동서대학교', '동아대학교',
  '동양대학교', '명지대학교 (용인캠퍼스)', '목원대학교', '목포대학교', '배재대학교',
  '백석대학교', '부산대학교', '상명대학교 (천안캠퍼스)', '상지대학교', '서경대학교',
  '서원대학교', '세명대학교', '세한대학교', '순천대학교', '순천향대학교', '신경주대학교',
  '영남대학교', '영산대학교', '예원예술대학교 (전북·경기캠퍼스)', '용인대학교',
  '인제대학교', '전북대학교', '전주대학교', '조선대학교', '중부대학교',
  '중앙대학교 (다빈치캠퍼스)', '중원대학교', '창원대학교', '청주대학교', '한남대학교',
  '한밭대학교', '한서대학교', '한성대학교', '호서대학교', '경국대학교 (구 안동대학교)',
  '백석문화대학교', '백석예술대학교', '서일대학교', '연성대학교', '용인예술과학대학교',
  '인덕대학교', '청강문화산업대학교', '한국영상대학교', '한양여자대학교', '울산대학교',
  '한국예술종합학교', 'SWA 서울웹툰아카데미', '서강대학교 미래교육원', '서울종합예술실용학교',
] as const;
const aliases: Record<string, string[]> = {
  '계명대학교 (대명캠퍼스)': ['계명대', '계명대학교'],
  '경국대학교 (구 안동대학교)': ['경국대학교', '안동대학교', '안동대'],
  '영남대학교': ['영남대'], '울산대학교': ['울산대'], '신경주대학교': ['신경주대'],
  '대구대학교': ['대구대'], '대구가톨릭대학교': ['대구가톨릭대'], '대구예술대학교': ['대구예술대'],
  '영산대학교': ['영산대'], '동아대학교': ['동아대'], '동명대학교': ['동명대'],
  '경성대학교': ['경성대'], '동서대학교': ['동서대'],
};
const normalize = (value: unknown) => String(value || '').replace(/\s+/g, '').toLowerCase();
export function universityFolderTitles(title: string) { return [title, ...(aliases[title] || [])].map(normalize); }

export async function seedUniversityWorkFolders(db: D1Database, context: DataCoreAccessContext) {
  requireAwardMember(context);
  if (!context.isSuperAdmin) throw new DataCoreAccessError(403, '기본 대학 폴더 생성은 마스터 관리자만 가능합니다.');
  const rows = (await db.prepare(`SELECT * FROM data_records WHERE organization_id=? AND record_type=?
    AND source_app='competition' AND visibility='organization'`)
    .bind(ORG, AWARD_FOLDER).all<Record<string, unknown>>()).results || [];
  const existing = new Set(rows.filter(row => !awardMetadata(row).parentFolderId)
    .map(row => `${awardMetadata(row).collectionType}:${normalize(row.title)}`));
  const now = new Date().toISOString();
  let created = 0;
  let statements: D1PreparedStatement[] = [];
  async function flush() {
    if (!statements.length) return;
    const results = await db.batch(statements);
    for (let i=0; i<results.length; i+=2) created += Number(results[i].meta?.changes || 0);
    statements = [];
  }
  for (const type of ['admitted', 'university']) for (const title of UNIVERSITY_WORK_FOLDERS) {
    if (universityFolderTitles(title).some(name => existing.has(`${type}:${name}`))) continue;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(title));
    const hash = [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
    const id = `university-works:${type}:${hash}`;
    const metadata = JSON.stringify({schemaVersion:1,collectionType:type,parentFolderId:null,seedVersion:'university-works-v1'});
    const row = {id,title,metadata_json:metadata,visibility:'organization'};
    statements.push(db.prepare(`INSERT OR IGNORE INTO data_records
      (id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at)
      VALUES (?, ?, NULL, ?, ?, 'competition', ?, 'organization', 'active', ?, ?, ?)`)
      .bind(id,ORG,context.user!.internalUserId,AWARD_FOLDER,title,metadata,now,now),
      awardAudit(db,context,'folder.create',row,row,now,true));
    if (statements.length >= 80) await flush();
  }
  await flush();
  return {created, universityCount:UNIVERSITY_WORK_FOLDERS.length};
}
