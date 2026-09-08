import { DEFAULT_ORGANIZATION_ID } from './data-core';
import { createHash } from 'node:crypto';
import { DataCoreAccessError, requireAuthenticatedAccess, resolveDataCoreAccess } from './data-core-access';
import { readAdmissionsState } from './data-core-admissions-knowledge-sync';
import { careerMajorKeywords, decodePublicGuidelines, explainUniversityMatch, guidelineIdentity, indexUniversities, matchUniversity, matchesCareer, preserveKnownValues, projectUniversity, projectGuideline, selectGuidelines } from '../public/data-core/admissions-model.js';

interface Env { DB?: D1Database; FILES?: R2Bucket; DATA_CORE_SUPER_ADMIN_EMAILS?: string }
type Row = Record<string, any>;
const sourceUrls = {
  susi: 'https://grinalda.net/wp-content/uploads/grinalda/grinalda-susi-2027-data.json',
  jungsi: 'https://grinalda.net/wp-content/uploads/grinalda/grinalda-jeongsi-2027-data.json',
};
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const privateJson = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'private, no-store' } });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function universities(db: D1Database, files?: R2Bucket): Promise<Row[]> {
  const state = await readAdmissionsState(db, files);
  if (!Array.isArray(state.universities)) throw new DataCoreAccessError(503, '기존 대학 데이터를 확인할 수 없습니다. 원본을 변경하지 않았습니다.');
  return state.universities.filter((u: unknown) => u && typeof u === 'object' && !Array.isArray(u));
}
async function savedRows(db: D1Database, ids?: string[]) {
  const sql = `SELECT id, metadata_json, deleted_at FROM data_records WHERE organization_id = ? AND campus_id IS NULL
    AND source_app = 'admissions' AND record_type IN ('university-admission-susi','university-admission-jungsi')`;
  type Saved = {id:string;metadata_json:string;deleted_at:string|null};
  let records: Saved[];
  if (ids) {
    const statements = [];
    for (let i=0;i<ids.length;i+=50) {
      const chunk=ids.slice(i,i+50);
      statements.push(db.prepare(`${sql} AND id IN (${chunk.map(()=>'?').join(',')})`).bind(DEFAULT_ORGANIZATION_ID,...chunk));
    }
    records=statements.length ? (await db.batch<Saved>(statements)).flatMap((r)=>r.results || []) : [];
  } else records=(await db.prepare(`${sql} ORDER BY id`).bind(DEFAULT_ORGANIZATION_ID).all<Saved>()).results || [];
  return records.map((r) => ({id:r.id, raw:r.metadata_json, deleted:r.deleted_at, data:JSON.parse(r.metadata_json) as Row}));
}
async function fetchSource(season: keyof typeof sourceUrls) {
  // Fixed public endpoints only. No auth headers, cookies, redirects or caller-supplied URLs.
  const response = await fetch(sourceUrls[season], { redirect:'manual', signal:AbortSignal.timeout(20000), headers:{accept:'application/json'} });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new DataCoreAccessError(502, '공개 입시요강 원본을 가져오지 못했습니다. 기존 데이터는 보존됩니다.');
  if (Number(response.headers.get('content-length')) > MAX_SOURCE_BYTES) throw new DataCoreAccessError(502,'공개 원본 크기를 확인해야 합니다.');
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const {value,done} = await reader.read(); if (done) break; size += value.length; if (size > MAX_SOURCE_BYTES) { await reader.cancel(); throw new DataCoreAccessError(502,'공개 원본 크기를 확인해야 합니다.'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset=0; for (const c of chunks) { bytes.set(c,offset); offset+=c.length; }
  const modified = response.headers.get('last-modified');
  return decodePublicGuidelines(JSON.parse(new TextDecoder().decode(bytes)),season,{
    sourceName:'그리날다', sourceUrl:`https://grinalda.net/univ-info-${season}/`,
    sourceDataUrl:sourceUrls[season], sourceUpdatedAt:modified && Number.isFinite(Date.parse(modified)) ? new Date(modified).toISOString() : null,
    fetchedAt:new Date().toISOString(), verificationStatus:'public-source-unverified',
  }) as Row[];
}
const fingerprintFields = (row: Row) => Object.fromEntries(Object.keys(row).filter((key) => !['fetchedAt','sourceFingerprint'].includes(key)).sort().map((key)=>[key,row[key]]));
function classifyRow(r: Row, old?: Awaited<ReturnType<typeof savedRows>>[number]): Row {
  const blocked=r.review || Boolean(old?.deleted) || Number(old?.data.sourcePriority || 0)>50;
  return {...r,previous:old,blocked,merged:preserveKnownValues(old?.data || {},r.data),kind:blocked?'review':!old?'new':old.data.sourceFingerprint===r.data.sourceFingerprint?'unchanged':'changed'};
}
const snapshotKey = (origin: string, token: string) => new Request(`${origin}/api/data-core/admin/admissions/guidelines/sync?preview-cache=${token}`);
function syncCache() {
  const cache=typeof caches === 'undefined' ? undefined : (caches as CacheStorage & {default?:Cache}).default;
  if (!cache) throw new DataCoreAccessError(503,'미리보기 임시 보관 기능을 사용할 수 없습니다. 기존 자료는 보존됩니다.');
  return cache;
}
async function plan(db: D1Database, files?: R2Bucket, stage: (name: string) => void = () => {}) {
  stage('read-universities');
  const schools = indexUniversities(await universities(db,files));
  stage('fetch-susi');
  const source = await fetchSource('susi');
  stage('fetch-jungsi');
  source.push(...await fetchSource('jungsi'));
  stage('normalize-source');
  const identities = new Map<string, Row>(); const conflicts = new Set<string>();
  for (const r of source) {
    const identity = guidelineIdentity(r);
    if (identities.has(identity) && JSON.stringify(fingerprintFields(identities.get(identity)!)) !== JSON.stringify(fingerprintFields(r))) conflicts.add(identity);
    identities.set(identity,r);
  }
  const rows: Row[] = [];
  for (const [identity,r] of identities) {
    const mapping = matchUniversity(r,schools);
    const data: Row = {...r,...mapping};
    data.sourceFingerprint = digest(fingerprintFields(data));
    rows.push({id:`admission-guideline:${digest(identity)}`, data, review:conflicts.has(identity)});
  }
  rows.sort((a,b)=>a.id.localeCompare(b.id));
  const token = digest(rows.map((r)=>[r.id,r.data.sourceFingerprint,r.review]));
  stage('read-catalog');
  const saved = new Map((await savedRows(db)).map((r)=>[r.id,r]));
  const counts: Record<string, Record<string,number>> = {susi:{new:0,changed:0,unchanged:0,review:0,mappingReview:0},jungsi:{new:0,changed:0,unchanged:0,review:0,mappingReview:0}};
  for (const r of rows) {
    Object.assign(r,classifyRow(r,saved.get(r.id)));
    counts[r.data.admissionSeason][r.kind]++;
    if (r.data.mappingStatus === 'review') counts[r.data.admissionSeason].mappingReview++;
  }
  return {token,rows,counts};
}

export async function handleAdmissionsCatalog(request: Request, env: Env): Promise<Response|null> {
  const url = new URL(request.url);
  const programs = url.pathname === '/api/data-core/roadmap/programs';
  const guidelines = url.pathname === '/api/data-core/admissions/guidelines';
  const sync = url.pathname === '/api/data-core/admin/admissions/guidelines/sync';
  if (!programs && !guidelines && !sync) return null;
  let stage = 'authorize';
  try {
    if (!env.DB) throw new DataCoreAccessError(503,'DATA CORE DB 연결이 필요합니다.');
    const context = await resolveDataCoreAccess(request,env.DB,env.DATA_CORE_SUPER_ADMIN_EMAILS);
    requireAuthenticatedAccess(context);
    if (!context.isSuperAdmin && !context.memberships.some((m)=>m.organizationId===DEFAULT_ORGANIZATION_ID && ['STAFF','TEACHER','CAMPUS_DIRECTOR'].includes(m.role))) throw new DataCoreAccessError(403,'교직원 권한이 필요합니다.');
    if (sync) {
      if (!context.isSuperAdmin) throw new DataCoreAccessError(403,'마스터 관리자만 입시요강을 동기화할 수 있습니다.');
      if (request.method !== 'POST') return privateJson({error:'POST 요청이 필요합니다.'},405);
      if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new DataCoreAccessError(403,'동일 사이트에서만 동기화할 수 있습니다.');
      if (Number(request.headers.get('content-length')) > 2048) throw new DataCoreAccessError(413,'요청이 너무 큽니다.');
      const input = await request.json() as {mode?:string;token?:string;offset?:number};
      if (!['preview','apply'].includes(input.mode || '')) throw new DataCoreAccessError(400,'미리보기 또는 적용을 선택하세요.');
      if (input.mode === 'preview') {
        const p = await plan(env.DB,env.FILES,(value) => { stage = value; });
        stage='cache-preview';
        // Cache only approved public-source fields, never legacy state or existing row metadata.
        const rows=p.rows.map((r)=>({id:r.id,data:r.data,review:r.review}));
        await syncCache().put(snapshotKey(url.origin,p.token),new Response(JSON.stringify({rows,expiresAt:Date.now()+600000}),{headers:{'content-type':'application/json','cache-control':'max-age=600'}}));
        return privateJson({token:p.token,total:rows.length,counts:p.counts,batchSize:100});
      }
      stage='read-preview';
      if (!/^[a-f0-9]{64}$/.test(input.token || '')) throw new DataCoreAccessError(409,'유효한 미리보기가 필요합니다. 다시 미리보기 해주세요.');
      const cached=await syncCache().match(snapshotKey(url.origin,input.token!));
      if (!cached) throw new DataCoreAccessError(409,'미리보기가 만료됐습니다. 다시 미리보기 해주세요. 저장된 자료는 유지됩니다.');
      const snapshot=await cached.json() as {rows:Row[];expiresAt:number};
      if (!Array.isArray(snapshot.rows) || snapshot.rows.length>10000 || !(snapshot.expiresAt>Date.now()) || digest(snapshot.rows.map((r)=>[r.id,r.data.sourceFingerprint,r.review]))!==input.token) throw new DataCoreAccessError(409,'미리보기 확인이 필요합니다. 다시 미리보기 해주세요.');
      const p={token:input.token,rows:snapshot.rows};
      const offset = input.offset;
      if (!Number.isInteger(offset) || offset! < 0 || offset! >= p.rows.length || offset! % 100 !== 0) throw new DataCoreAccessError(400,'적용 위치가 올바르지 않습니다.');
      const selected=p.rows.slice(offset,offset!+100);
      stage='validate-batch';
      const schools=indexUniversities(await universities(env.DB,env.FILES));
      for (const r of selected) {
        const mapping=matchUniversity(r.data,schools);
        if (r.id!==`admission-guideline:${digest(guidelineIdentity(r.data))}` || r.data.sourceFingerprint!==digest(fingerprintFields(r.data)) || mapping.universityId!==r.data.universityId || mapping.mappingStatus!==r.data.mappingStatus) throw new DataCoreAccessError(409,'대학 연결이나 미리보기가 변경됐습니다. 다시 미리보기 해주세요.');
      }
      const saved=new Map((await savedRows(env.DB,selected.map((r)=>r.id))).map((r)=>[r.id,r]));
      const batch=selected.map((r)=>classifyRow(r,saved.get(r.id))).filter((r)=>['new','changed'].includes(r.kind));
      const now = new Date().toISOString();
      const statements = batch.map((r) => env.DB!.prepare(`INSERT INTO data_records
        (id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at)
        VALUES (?,?,NULL,?,?,'admissions',?,'organization','active',?,?,?)
        ON CONFLICT(id) DO UPDATE SET metadata_json=excluded.metadata_json,title=excluded.title,updated_at=excluded.updated_at
        WHERE data_records.organization_id=excluded.organization_id AND data_records.campus_id IS NULL
        AND data_records.source_app='admissions' AND data_records.record_type=excluded.record_type
        AND data_records.deleted_at IS NULL AND data_records.metadata_json=?`)
        .bind(r.id,DEFAULT_ORGANIZATION_ID,context.user!.internalUserId,`university-admission-${r.data.admissionSeason}`,
          `${r.data.universityName} · ${r.data.department} · ${r.data.academicYear}`,JSON.stringify(r.merged),now,now,r.previous?.raw || '__new__'));
      statements.push(env.DB.prepare(`INSERT INTO audit_logs (id,organization_id,campus_id,actor_user_id,action,resource_type,resource_id,metadata_json,created_at)
        VALUES (?,?,NULL,?,'sync','admission_guidelines','grinalda',?,?)`).bind(crypto.randomUUID(),DEFAULT_ORGANIZATION_ID,context.user!.internalUserId,JSON.stringify({offset,attempted:batch.length,token:p.token}),now));
      stage = 'apply-batch';
      const results = await env.DB.batch(statements);
      const applied = results.slice(0,-1).reduce((sum,r)=>sum+Number(r.meta?.changes || 0),0);
      if (applied !== batch.length) throw new DataCoreAccessError(409,'일부 자료가 동시에 변경되어 건너뛰었습니다. 기존 값을 보존했으니 다시 미리보기 해주세요.');
      return privateJson({applied,nextOffset:Math.min(offset!+100,p.rows.length),total:p.rows.length,done:offset!+100>=p.rows.length});
    }
    if (request.method !== 'GET') return privateJson({error:'조회 전용 API입니다.'},405);
    if (guidelines) {
      stage = 'read-catalog';
      const records: Row[] = (await savedRows(env.DB)).filter((r)=>!r.deleted).map((r)=>({id:r.id,...projectGuideline(r.data)}));
      try {
        const schools=indexUniversities(await universities(env.DB,env.FILES));
        for (const r of records) {
          const current=explainUniversityMatch(r,schools);
          // Explain current candidates, but never silently persist or advertise an unapplied link.
          r.mappingReason=current.mappingStatus==='matched' && (r.mappingStatus!=='matched' || r.universityId!==current.universityId) ? 'pending-sync' : current.mappingReason;
        }
      } catch {
        // A legacy source outage must not take the already stored public catalog offline.
        for (const r of records) r.mappingReason='source-unavailable';
      }
      const filters = Object.fromEntries(url.searchParams);
      const filtered = selectGuidelines(records,filters);
      const page = Math.floor(Math.max(1,Math.min(1000,Number(url.searchParams.get('page')) || 1)));
      const facet = (key:string) => [...new Set(records.filter((r)=>!filters.season || r.admissionSeason===filters.season).map((r)=>r[key]).filter(Boolean))].sort();
      return privateJson({rows:filtered.slice((page-1)*40,page*40),total:filtered.length,page,canSync:context.isSuperAdmin,
        facets:{year:facet('academicYear'),region:facet('region'),university:facet('universityName'),group:facet('admissionGroup'),category:facet('admissionCategory'),practical:facet('practicalType'),csatSubjects:facet('csatSubjects')}});
    }
    const careerId = url.searchParams.get('careerId') || '';
    if (!(careerId in careerMajorKeywords)) throw new DataCoreAccessError(400,'등록된 직업을 선택하세요.');
    stage = 'read-universities';
    const source = await universities(env.DB,env.FILES);
    const rows: Row[] = source.filter((u)=>!u.hiddenDuplicate && matchesCareer(u.major || u.department,careerId)).map(projectUniversity);
    for (const saved of await savedRows(env.DB)) {
      const r = projectGuideline(saved.data) as Row;
      if (saved.deleted || !matchesCareer(r.department,careerId)) continue;
      rows.push({id:saved.id,name:r.department,metadata:{universityName:r.universityName,major:r.department,campus:r.campus,region:r.region,
        year:r.academicYear,admission:`${r.admissionSeason==='susi'?'수시':'정시'} · ${r.admissionType}`,practicalType:r.practicalType,
        gradeRatio:r.gradeRatio,skillRatio:r.practicalRatio,sourceUrl:r.sourceUrl,sourceName:r.sourceName,
        verificationStatus:'public-source-unverified',guidelineId:saved.id,admissionSeason:r.admissionSeason}});
    }
    return privateJson({programs:rows,source:'admissions-universities',matchBasis:'department-name',readOnly:true});
  } catch (error) {
    if (error instanceof DataCoreAccessError) return privateJson({error:error.message,stage},error.status);
    // Raw source records, response bodies and request credentials never enter logs.
    const kind = error instanceof Error && ['TimeoutError','AbortError','TypeError','SyntaxError','RangeError'].includes(error.name) ? error.name : 'InternalError';
    return privateJson({error:`대학 자료를 확인하지 못했습니다. 기존 원본은 변경하지 않았습니다. (${stage}/${kind})`,stage,kind},502);
  }
}
