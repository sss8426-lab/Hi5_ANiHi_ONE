import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inventoryTree, planInventory, diffInventory, prepareAssets, folderMetadata, pageMetadata, ORG, hash, stableId, natural, outsideSource } from './curriculum-tree.mjs';
import { cloudflare } from './curriculum-cloudflare.mjs';

export async function applyTree(tree, remote, previewHash, {signal,onProgress,operator='cloudflare-oauth-cli'}={}) {
  signal?.throwIfAborted();
  const before=await remote.records(tree.family,tree.stage),diff=diffInventory(tree,before);
  if(!diff.canApply||hash(JSON.stringify(before))!==previewHash)throw Error('중앙 preview 상태가 변경되었거나 충돌이 있습니다. 다시 preview 하세요.');
  if(planInventory(tree,before).files.some((f,i)=>f.id!==tree.files[i].id))throw Error('현재 버전 계획이 변경되었습니다. 다시 preview 하세요.');
  const now=new Date().toISOString(), existing=new Map(before.map(r=>[r.id,r]));let uploaded=0,created=0;
  async function record(id,type,title,metadata,status='active'){
    if(existing.has(id))return;
    await remote.query(`INSERT INTO data_records (id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at)
      VALUES (?,?,NULL,NULL,?,'curriculum',?,'organization',?,?,?,?) ON CONFLICT(id) DO NOTHING`,[id,ORG,type,title,status,JSON.stringify(metadata),now,now]);
    const row=(await remote.query('SELECT organization_id,source_app,record_type,campus_id,metadata_json FROM data_records WHERE id=?',[id])).results[0];
    if(!row||row.organization_id!==ORG||row.source_app!=='curriculum'||row.record_type!==type||row.campus_id!==null||JSON.stringify(JSON.parse(row.metadata_json))!==JSON.stringify(metadata))throw Error('기존 record identity 충돌. 덮어쓰기 없이 중단했습니다.');
  }
  const totalBytes=tree.files.flatMap(f=>f.assets||[]).reduce((n,a)=>n+a.size,0);
  let processedBytes=0,uploadedBytes=0,processedAssets=0;
  for(const f of tree.folders){signal?.throwIfAborted();await record(f.id,'curriculum-folder',f.title,folderMetadata(tree,f));}
  for(const f of tree.files){
    signal?.throwIfAborted();
    if(existing.get(f.id)?.status==='active')continue;
    if(!f.assets||f.assets.length!==4||f.assets.some(a=>a.id!==stableId('file',f.id,a.kind)))throw Error('새 버전의 파생 파일 준비를 확인하세요.');
    for(const asset of f.assets){
      signal?.throwIfAborted();
      if(await remote.put(asset)){uploaded++;uploadedBytes+=asset.size;}
      processedBytes+=asset.size;processedAssets++;
      onProgress?.({phase:'upload',completed:created,total:diff.newPages,path:f.relativePath,processedAssets,processedBytes,uploadedBytes,totalBytes,uploaded});
    }
    // A page is invisible until every immutable asset was uploaded successfully.
    const m=pageMetadata(tree,f);
    await record(f.id,'curriculum-page',f.sourceFileName,{...m,active:false},'draft');
    for(const a of f.assets){
      await remote.query(`INSERT INTO file_objects (id,organization_id,campus_id,data_record_id,owner_user_id,area,category,source_app,r2_key,original_file_name,mime_type,size_bytes,visibility,created_at)
        VALUES (?,?,NULL,?,NULL,'documents-private',?,'curriculum',?,?,?,?, 'organization',?) ON CONFLICT(id) DO NOTHING`,
      [a.id,ORG,f.id,`curriculum-${a.kind}`,a.key,f.sourceFileName,a.mime,a.size,now]);
      const registered=(await remote.query('SELECT organization_id,source_app,data_record_id,r2_key,deleted_at FROM file_objects WHERE id=?',[a.id])).results[0];
      if(!registered||registered.organization_id!==ORG||registered.source_app!=='curriculum'||registered.data_record_id!==f.id||registered.r2_key!==a.key||registered.deleted_at)throw Error('File identity 충돌. 기존 파일을 변경하지 않았습니다.');
    }
    const previous=f.previousPageId?existing.get(f.previousPageId):null;
    const draft=JSON.stringify({...m,active:false});
    if(f.previousPageId&&!previous)throw Error('이전 버전 확인 실패. 새 버전은 공개하지 않았습니다.');
    if(previous){
      // Publish the replacement and retire the old list entry atomically. Its files remain readable.
      const prior=JSON.stringify({...previous.metadata,supersededByPageId:f.id,supersededAt:now});
      const result=await remote.query(`WITH expected AS MATERIALIZED (
        SELECT count(*) AS n FROM data_records WHERE organization_id=? AND source_app='curriculum' AND deleted_at IS NULL
        AND ((id=? AND status='draft' AND metadata_json=?) OR (id=? AND status='active' AND metadata_json=?)))
        UPDATE data_records SET status='active',metadata_json=CASE id WHEN ? THEN ? ELSE ? END,updated_at=?
        WHERE organization_id=? AND source_app='curriculum' AND id IN (?,?) AND (SELECT n FROM expected)=2`,
        [ORG,f.id,draft,previous.id,previous.metadata_json,f.id,JSON.stringify(m),prior,now,ORG,f.id,previous.id]);
      if(result.meta?.changes!==2)throw Error('버전 공개 중 중앙 상태 변경 감지. 기존 원본을 보존하고 중단했습니다.');
    }else{
      const result=await remote.query("UPDATE data_records SET status='active',metadata_json=?,updated_at=? WHERE id=? AND organization_id=? AND source_app='curriculum' AND status='draft' AND deleted_at IS NULL AND metadata_json=?",[JSON.stringify(m),now,f.id,ORG,draft]);
      if(result.meta?.changes!==1)throw Error('페이지 공개 중 중앙 상태 변경 감지. 다시 preview 하세요.');
    }
    created++;
    if(onProgress)onProgress({phase:'upload',completed:created,total:diff.newPages,path:f.relativePath,processedAssets,processedBytes,uploadedBytes,totalBytes,uploaded});
    else if(created%10===0)console.log(JSON.stringify({stage:tree.stage,completedPages:created,totalNewPages:diff.newPages}));
  }
  signal?.throwIfAborted();
  const published=await remote.records(tree.family,tree.stage);
  const live=published.filter(r=>r.status==='active'&&!r.deleted_at&&!r.metadata.supersededByPageId);
  const folderPaths=live.filter(r=>r.record_type==='curriculum-folder').map(r=>r.metadata.relativePath).sort(natural);
  for(const row of live){
    signal?.throwIfAborted();
    const folder=row.record_type==='curriculum-folder',source=folder?tree.folders.find(f=>f.id===row.id):tree.files.find(f=>f.id===row.id);
    const m={...row.metadata};
    if(folder){
      m.order=folderPaths.indexOf(m.relativePath)+1;
      if(source?.representativeFileId)m.representativeFileId=source.representativeFileId;
    }else{
      const paths=live.filter(r=>r.record_type==='curriculum-page'&&r.metadata.curriculumFolderId===m.curriculumFolderId).map(r=>r.metadata.relativePath).sort(natural);
      m.order=paths.indexOf(m.relativePath)+1;
    }
    if(source)delete m.sourceReview;
    else m.sourceReview||={status:'needs_review',reason:'source-missing',detectedAt:now};
    const json=JSON.stringify(m);
    if(json===row.metadata_json)continue;
    const result=await remote.query("UPDATE data_records SET metadata_json=?,updated_at=? WHERE id=? AND organization_id=? AND source_app='curriculum' AND status='active' AND deleted_at IS NULL AND metadata_json=?",[json,now,row.id,ORG,row.metadata_json]);
    if(result.meta?.changes!==1)throw Error('폴더/검토 상태 변경 감지. 기존 파일을 보존하고 중단했습니다.');
  }
  const after=await remote.records(tree.family,tree.stage),verified=diffInventory(tree,after);
  if(verified.newFolders||verified.newPages||!verified.canApply)throw Error('Import 후 중앙 count/fingerprint 확인 실패. 자동 삭제/덮어쓰기 없음.');
  const count=(await remote.query("SELECT count(*) AS n FROM file_objects WHERE organization_id=? AND source_app='curriculum' AND data_record_id IN (SELECT id FROM data_records WHERE source_app='curriculum' AND status='active' AND deleted_at IS NULL AND json_extract(metadata_json,'$.family')=? AND json_extract(metadata_json,'$.stage')=?) AND deleted_at IS NULL",[ORG,tree.family,tree.stage])).results[0].n;
  if(count!==after.filter(r=>r.record_type==='curriculum-page'&&r.status==='active'&&!r.deleted_at).length*4)throw Error('파일 등록 count 불일치. 재실행 전 점검이 필요합니다.');
  await remote.query("INSERT INTO audit_logs (id,organization_id,action,resource_type,resource_id,metadata_json,created_at) VALUES (?,?,'curriculum.import','curriculum',?,?,?)",
    [crypto.randomUUID(),ORG,`${tree.family}/${tree.stage}`,JSON.stringify({folders:tree.folders.length,pages:tree.files.length,newPages:created,newObjects:uploaded,operator:operator==='hi5-anihi-sync'?operator:'cloudflare-oauth-cli'}),now]);
  return {...verified,uploaded,created,registeredFiles:count};
}
export async function verifyTree(tree,remote,{signal,onProgress}={}){
  const records=await remote.records(tree.family,tree.stage),diff=diffInventory(tree,records);
  if(diff.newFolders||diff.newPages||!diff.canApply)throw Error('중앙 내용과 원본 count/fingerprint 불일치.');
  const entries=(await remote.query("SELECT f.r2_key,m.metadata_json FROM file_objects f JOIN data_records m ON m.id=f.data_record_id WHERE f.organization_id=? AND f.source_app='curriculum' AND f.category='curriculum-original' AND m.status='active' AND m.deleted_at IS NULL AND json_extract(m.metadata_json,'$.family')=? AND json_extract(m.metadata_json,'$.stage')=? AND f.deleted_at IS NULL",[ORG,tree.family,tree.stage])).results;
  let verified=0;
  for(const e of entries){
    signal?.throwIfAborted();
    if(await remote.objectHash(e.r2_key)!==JSON.parse(e.metadata_json).fingerprint)throw Error('R2 original fingerprint 불일치.');
    onProgress?.({phase:'verify',completed:++verified,total:entries.length});
  }
  if(verified!==records.filter(r=>r.record_type==='curriculum-page'&&r.status==='active'&&!r.deleted_at).length)throw Error('R2 original count 불일치.');
  const count=(await remote.query("SELECT count(*) AS n FROM file_objects WHERE organization_id=? AND source_app='curriculum' AND data_record_id IN (SELECT id FROM data_records WHERE source_app='curriculum' AND status='active' AND deleted_at IS NULL AND json_extract(metadata_json,'$.family')=? AND json_extract(metadata_json,'$.stage')=?) AND deleted_at IS NULL",[ORG,tree.family,tree.stage])).results[0].n;
  if(count!==verified*4)throw Error('파일 등록 count 불일치.');
  return {originalsVerified:verified,registeredFiles:count,sourceWrites:0};
}
export async function main(args=process.argv.slice(2)){
  const {values:a}=parseArgs({args,options:{family:{type:'string'},stage:{type:'string'},source:{type:'string'},output:{type:'string'},config:{type:'string',default:'dist/server/wrangler.json'},preview:{type:'boolean'},apply:{type:'boolean'},remote:{type:'boolean'},verify:{type:'boolean'}}});
  if(!a.source||!a.family||!a.stage||(!a.preview&&!a.apply&&!a.verify)||[a.preview,a.apply,a.verify].filter(Boolean).length!==1)throw Error('--family --stage --source와 --preview / --apply / --verify 중 하나가 필요합니다.');
  const output=resolve(a.output||`outputs/curriculum-import/${a.stage}`);outsideSource(a.source,output);await mkdir(output,{recursive:true});
  const remote=a.remote?await cloudflare(a.config):null;
  const source=await inventoryTree(a.source,a.family,a.stage),records=remote?await remote.records(a.family,a.stage):[],tree=planInventory(source,records),diff=diffInventory(tree,records);
  const summary={stage:a.stage,remote:Boolean(remote),...diff,sourceBytes:tree.sourceBytes,lessonNames:tree.folders.map(f=>f.title),blockers:tree.blockers,withoutRepresentative:tree.folders.filter(f=>!f.representativePageId).map(f=>f.title)};
  console.log(JSON.stringify(summary,null,2));
  if(a.preview){await writeFile(join(output,'preview.json'),JSON.stringify({sourceHash:hash(JSON.stringify(tree)),remoteHash:hash(JSON.stringify(records)),remote:Boolean(remote),summary},null,2));return;}
  if(!remote)throw Error('실제 중앙 import/verify는 --remote가 필요합니다.');
  if(a.verify){
    console.log(JSON.stringify(await verifyTree(tree,remote)));return;
  }
  const preview=JSON.parse(await readFile(join(output,'preview.json'),'utf8'));
  if(!preview.remote||preview.sourceHash!==hash(JSON.stringify(tree))||preview.remoteHash!==hash(JSON.stringify(records))||!diff.canApply)throw Error('정상 remote preview가 먼저 필요합니다. source/count/충돌을 확인하세요.');
  await prepareAssets(tree,join(output,'derivatives'),records);
  const result=await applyTree(tree,remote,preview.remoteHash);
  // Re-read originals after upload; no source writes, renames, deletes or moves.
  for(const f of tree.files)if(hash(await readFile(f.sourcePath))!==f.sha256)throw Error('Import 도중 원본 변경이 감지되었습니다.');
  await writeFile(join(output,'result.json'),JSON.stringify({...summary,...result,sourceWrites:0,completedAt:new Date().toISOString()},null,2));
  console.log(JSON.stringify({...result,sourceWrites:0}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
