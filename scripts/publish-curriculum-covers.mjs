import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import sharp from 'sharp';
import {hash,stableId,ORG} from './curriculum-tree.mjs';
import {cloudflare} from './curriculum-cloudflare.mjs';

export const COVER_SPEC={width:640,height:480,quality:84,maxBytes:120*1024};
export async function prepareCovers(plan,directory) {
  if(!plan.length||plan.length>100||new Set(plan.map(p=>p.folderId)).size!==plan.length)throw Error('Invalid cover inventory');
  const assets=[];
  for(const p of plan) {
    if(!/^(basic|advanced|admission)-\d{2}$/.test(p.key)||p.family!=='content'||!p.key.startsWith(`${p.stage}-`))throw Error('Invalid cover key');
    const source=join(directory,`${p.key}.png`),path=join(directory,`${p.key}.webp`);
    const input=await readFile(source);let bytes,quality=COVER_SPEC.quality;
    for(const candidate of [COVER_SPEC.quality,80,76]) {
      quality=candidate;
      bytes=await sharp(input).rotate().resize(COVER_SPEC.width,COVER_SPEC.height,{fit:'cover'}).webp({quality,effort:6}).toBuffer();
      if(bytes.length<=COVER_SPEC.maxBytes)break;
    }
    if(bytes.length>COVER_SPEC.maxBytes)throw Error('Cover exceeds download budget');
    await writeFile(path,bytes);
    const sha256=hash(bytes),id=stableId('cover',p.folderId,sha256);
    assets.push({...p,references:p.references.map(({pageId,originalFileId,fingerprint})=>({pageId,originalFileId,fingerprint})),
      id,path,sha256,size:bytes.length,mime:'image/webp',width:COVER_SPEC.width,height:COVER_SPEC.height,quality,
      key:`data-core/documents-private/${ORG}/organization/curriculum/${p.family}/${p.stage}/${p.folderId}/covers/${sha256}.webp`,
      alt:`${p.title} 수업 주제를 표현한 일러스트`});
  }
  return assets;
}
const folderSql="SELECT * FROM data_records WHERE id=? AND organization_id=? AND source_app='curriculum' AND record_type='curriculum-folder' AND campus_id IS NULL AND visibility='organization' AND status='active' AND deleted_at IS NULL";
async function validateSource(remote,a) {
  const row=(await remote.query(folderSql,[a.folderId,ORG])).results[0];
  const m=row&&JSON.parse(row.metadata_json);
  if(!m||m.schemaVersion!==1||!m.active||m.family!==a.family||m.stage!==a.stage||row.title!==a.title)throw Error('Central folder changed');
  if(!a.references.length||hash(JSON.stringify(a.references.map(r=>[r.pageId,r.fingerprint])))!==a.sourceFingerprint)throw Error('Invalid source fingerprint');
  for(const ref of a.references) {
    const p=(await remote.query("SELECT metadata_json FROM data_records WHERE id=? AND organization_id=? AND source_app='curriculum' AND record_type='curriculum-page' AND status='active' AND deleted_at IS NULL AND campus_id IS NULL AND visibility='organization'",[ref.pageId,ORG])).results[0];
    const pm=p&&JSON.parse(p.metadata_json);
    if(!pm?.active||pm.supersededByPageId||pm.curriculumFolderId!==a.folderId||pm.fingerprint!==ref.fingerprint||pm.originalFileId!==ref.originalFileId)throw Error('Central reference changed');
  }
  return row;
}
export async function previewCovers(assets,remote) {
  const folders=[];
  for(const a of assets) {
    if(hash(await readFile(a.path))!==a.sha256)throw Error('Cover bytes changed');
    const row=await validateSource(remote,a);
    folders.push({id:row.id,metadata:row.metadata_json,asset:a.sha256});
  }
  return {folders:assets.length,stateHash:hash(JSON.stringify(folders)),bytes:assets.reduce((n,a)=>n+a.size,0)};
}
export async function publishCovers(assets,remote,expectedHash) {
  if((await previewCovers(assets,remote)).stateHash!==expectedHash)throw Error('Central preview changed');
  let uploaded=0,published=0,skipped=0;
  for(const a of assets) {
    const row=await validateSource(remote,a),m=JSON.parse(row.metadata_json);
    if(m.coverFileId===a.id) {await verifyCover(a,remote);skipped++;continue;}
    if(await remote.put(a))uploaded++;
    const now=new Date().toISOString();
    await remote.query(`INSERT INTO file_objects (id,organization_id,campus_id,data_record_id,owner_user_id,area,category,source_app,r2_key,original_file_name,mime_type,size_bytes,visibility,created_at)
      VALUES (?,?,NULL,?,NULL,'documents-private','curriculum-cover','curriculum',?,?,'image/webp',?,'organization',?) ON CONFLICT(id) DO NOTHING`,
      [a.id,ORG,a.folderId,a.key,`${a.id}.webp`,a.size,now]);
    await verifyFile(a,remote);
    const next={...m,coverFileId:a.id,cover:{schemaVersion:1,alt:a.alt,width:a.width,height:a.height,sha256:a.sha256,
      sourceFingerprint:a.sourceFingerprint,references:a.references,provider:'openai-imagegen',aiGenerated:true,generatedAt:now,
      ...(m.coverFileId?{previousCoverFileId:m.coverFileId}:{})}};
    // CAS preserves concurrent lesson edits. No page, original, print or prior cover is overwritten.
    const result=await remote.query(`UPDATE data_records SET metadata_json=?,updated_at=? WHERE id=? AND organization_id=? AND source_app='curriculum'
      AND record_type='curriculum-folder' AND campus_id IS NULL AND visibility='organization' AND status='active' AND deleted_at IS NULL AND metadata_json=?`,
      [JSON.stringify(next),now,a.folderId,ORG,row.metadata_json]);
    if(result.meta?.changes!==1)throw Error('Concurrent folder edit; cover not linked');
    published++;
  }
  if(published)await remote.query("INSERT INTO audit_logs (id,organization_id,action,resource_type,resource_id,metadata_json,created_at) VALUES (?,?,'curriculum.covers','curriculum','content',?,?)",
    [crypto.randomUUID(),ORG,JSON.stringify({published,uploaded,originalWrites:0}),new Date().toISOString()]);
  return {published,uploaded,skipped,originalWrites:0};
}
async function verifyFile(a,remote) {
  const f=(await remote.query('SELECT * FROM file_objects WHERE id=?',[a.id])).results[0];
  if(!f||f.organization_id!==ORG||f.campus_id!==null||f.data_record_id!==a.folderId||f.area!=='documents-private'||f.category!=='curriculum-cover'||f.source_app!=='curriculum'||f.r2_key!==a.key||f.mime_type!==a.mime||f.size_bytes!==a.size||f.visibility!=='organization'||f.deleted_at)throw Error('Cover file identity conflict');
}
export async function verifyCover(a,remote) {
  await verifyFile(a,remote);
  const row=await validateSource(remote,a),m=JSON.parse(row.metadata_json);
  if(m.coverFileId!==a.id||m.cover?.sha256!==a.sha256||await remote.objectHash(a.key)!==a.sha256)throw Error('Cover verification failed');
}
export async function curriculumPreservation(remote) {
  const pages=(await remote.query("SELECT * FROM data_records WHERE organization_id=? AND source_app='curriculum' AND record_type='curriculum-page' ORDER BY id",[ORG])).results;
  const files=(await remote.query("SELECT * FROM file_objects WHERE organization_id=? AND source_app='curriculum' AND category!='curriculum-cover' ORDER BY id",[ORG])).results;
  return {pages:pages.length,files:files.length,digest:hash(JSON.stringify({pages,files}))};
}
async function main() {
  const {values:a}=parseArgs({options:{directory:{type:'string',default:'outputs/curriculum-covers'},config:{type:'string',default:'dist/server/wrangler.json'},prepare:{type:'boolean'},preview:{type:'boolean'},apply:{type:'boolean'},verify:{type:'boolean'}}});
  if([a.prepare,a.preview,a.apply,a.verify].filter(Boolean).length!==1)throw Error('Select prepare, preview, apply or verify');
  const dir=resolve(a.directory),manifest=join(dir,'assets.json');
  if(a.prepare) {
    const assets=await prepareCovers(JSON.parse(await readFile(join(dir,'plan.json'),'utf8')),dir);
    await writeFile(manifest,JSON.stringify(assets,null,2));
    console.log(JSON.stringify({prepared:assets.length,bytes:assets.reduce((n,p)=>n+p.size,0)}));return;
  }
  const assets=JSON.parse(await readFile(manifest,'utf8')),remote=await cloudflare(a.config),previewPath=join(dir,'publish-preview.json');
  if(a.preview) {
    const preview={...await previewCovers(assets,remote),preservation:await curriculumPreservation(remote)};
    await writeFile(previewPath,JSON.stringify(preview,null,2));console.log(JSON.stringify(preview));return;
  }
  const preview=JSON.parse(await readFile(previewPath,'utf8'));
  if((await curriculumPreservation(remote)).digest!==preview.preservation.digest)throw Error('Curriculum page/file state changed');
  if(a.apply)console.log(JSON.stringify(await publishCovers(assets,remote,preview.stateHash)));
  for(const asset of assets)await verifyCover(asset,remote);
  const after=await curriculumPreservation(remote);
  if(after.digest!==preview.preservation.digest)throw Error('Page/file preservation check failed');
  const result={verified:assets.length,preservation:after,originalWrites:0};
  await writeFile(join(dir,'publish-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{
  // Only our controlled error messages, never HTTP payloads or credentials.
  console.error(error.message?.startsWith('Central')||error.message?.startsWith('Cover')||error.message?.startsWith('Curriculum')?error.message:'Curriculum cover operation failed; originals were not modified.');process.exitCode=1;
});
