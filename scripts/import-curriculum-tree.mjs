import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inventoryTree, diffInventory, prepareAssets, folderMetadata, pageMetadata, ORG, hash, outsideSource } from './curriculum-tree.mjs';
import { cloudflare } from './curriculum-cloudflare.mjs';

export async function applyTree(tree, remote, previewHash) {
  const before=await remote.records(tree.family,tree.stage),diff=diffInventory(tree,before);
  if(!diff.canApply||hash(JSON.stringify(before))!==previewHash)throw Error('중앙 preview 상태가 변경되었거나 충돌이 있습니다. 다시 preview 하세요.');
  const now=new Date().toISOString(), existing=new Map(before.map(r=>[r.id,r]));let uploaded=0,created=0;
  async function record(id,type,title,metadata,status='active'){
    if(existing.has(id))return;
    await remote.query(`INSERT INTO data_records (id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at)
      VALUES (?,?,NULL,NULL,?,'curriculum',?,'organization',?,?,?,?) ON CONFLICT(id) DO NOTHING`,[id,ORG,type,title,status,JSON.stringify(metadata),now,now]);
    const row=(await remote.query('SELECT organization_id,source_app,record_type,campus_id,metadata_json FROM data_records WHERE id=?',[id])).results[0];
    if(!row||row.organization_id!==ORG||row.source_app!=='curriculum'||row.record_type!==type||row.campus_id!==null||JSON.stringify(JSON.parse(row.metadata_json))!==JSON.stringify(metadata))throw Error('기존 record identity 충돌. 덮어쓰기 없이 중단했습니다.');
  }
  for(const f of tree.folders)await record(f.id,'curriculum-folder',f.title,folderMetadata(tree,f));
  for(const f of tree.files){
    if(existing.get(f.id)?.status==='active')continue;
    for(const asset of f.assets){if(await remote.put(asset))uploaded++;}
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
    await remote.query("UPDATE data_records SET status='active',metadata_json=?,updated_at=? WHERE id=? AND organization_id=? AND source_app='curriculum' AND status='draft' AND deleted_at IS NULL",[JSON.stringify(m),now,f.id,ORG]);
    created++;if(created%10===0)console.log(JSON.stringify({stage:tree.stage,completedPages:created,totalNewPages:diff.newPages}));
  }
  const after=await remote.records(tree.family,tree.stage),verified=diffInventory(tree,after);
  if(verified.newFolders||verified.newPages||!verified.canApply)throw Error('Import 후 중앙 count/fingerprint 확인 실패. 자동 삭제/덮어쓰기 없음.');
  const count=(await remote.query("SELECT count(*) AS n FROM file_objects WHERE organization_id=? AND source_app='curriculum' AND data_record_id IN (SELECT id FROM data_records WHERE source_app='curriculum' AND json_extract(metadata_json,'$.family')=? AND json_extract(metadata_json,'$.stage')=?) AND deleted_at IS NULL",[ORG,tree.family,tree.stage])).results[0].n;
  if(count!==tree.files.length*4)throw Error('파일 등록 count 불일치. 재실행 전 점검이 필요합니다.');
  await remote.query("INSERT INTO audit_logs (id,organization_id,action,resource_type,resource_id,metadata_json,created_at) VALUES (?,?,'curriculum.import','curriculum',?,?,?)",
    [crypto.randomUUID(),ORG,`${tree.family}/${tree.stage}`,JSON.stringify({folders:tree.folders.length,pages:tree.files.length,newPages:created,newObjects:uploaded,operator:'cloudflare-oauth-cli'}),now]);
  return {...verified,uploaded,created,registeredFiles:count};
}
async function main(){
  const {values:a}=parseArgs({options:{family:{type:'string'},stage:{type:'string'},source:{type:'string'},output:{type:'string'},config:{type:'string',default:'dist/server/wrangler.json'},preview:{type:'boolean'},apply:{type:'boolean'},remote:{type:'boolean'},verify:{type:'boolean'}}});
  if(!a.source||!a.family||!a.stage||(!a.preview&&!a.apply&&!a.verify)||[a.preview,a.apply,a.verify].filter(Boolean).length!==1)throw Error('--family --stage --source와 --preview / --apply / --verify 중 하나가 필요합니다.');
  const output=resolve(a.output||`outputs/curriculum-import/${a.stage}`);outsideSource(a.source,output);await mkdir(output,{recursive:true});
  const remote=a.remote?await cloudflare(a.config):null;
  const tree=await inventoryTree(a.source,a.family,a.stage),records=remote?await remote.records(a.family,a.stage):[],diff=diffInventory(tree,records);
  const summary={stage:a.stage,remote:Boolean(remote),...diff,sourceBytes:tree.sourceBytes,lessonNames:tree.folders.map(f=>f.title),blockers:tree.blockers,withoutRepresentative:tree.folders.filter(f=>!f.representativePageId).map(f=>f.title)};
  console.log(JSON.stringify(summary,null,2));
  if(a.preview){await writeFile(join(output,'preview.json'),JSON.stringify({sourceHash:hash(JSON.stringify(tree)),remoteHash:hash(JSON.stringify(records)),remote:Boolean(remote),summary},null,2));return;}
  if(!remote)throw Error('실제 중앙 import/verify는 --remote가 필요합니다.');
  if(a.verify){
    if(diff.newFolders||diff.newPages||!diff.canApply)throw Error('중앙 내용과 원본 count/fingerprint 불일치.');
    const entries=(await remote.query("SELECT f.r2_key,m.metadata_json FROM file_objects f JOIN data_records m ON m.id=f.data_record_id WHERE f.organization_id=? AND f.source_app='curriculum' AND f.category='curriculum-original' AND json_extract(m.metadata_json,'$.family')=? AND json_extract(m.metadata_json,'$.stage')=? AND f.deleted_at IS NULL",[ORG,a.family,a.stage])).results;
    let verified=0;
    for(const e of entries){if(await remote.objectHash(e.r2_key)!==JSON.parse(e.metadata_json).fingerprint)throw Error('R2 original fingerprint 불일치.');verified++;}
    if(verified!==tree.files.length)throw Error('R2 original count 불일치.');console.log(JSON.stringify({originalsVerified:verified,sourceWrites:0}));return;
  }
  const preview=JSON.parse(await readFile(join(output,'preview.json'),'utf8'));
  if(!preview.remote||preview.sourceHash!==hash(JSON.stringify(tree))||preview.remoteHash!==hash(JSON.stringify(records))||!diff.canApply)throw Error('정상 remote preview가 먼저 필요합니다. source/count/충돌을 확인하세요.');
  await prepareAssets(tree,join(output,'derivatives'));
  const result=await applyTree(tree,remote,preview.remoteHash);
  // Re-read originals after upload; no source writes, renames, deletes or moves.
  for(const f of tree.files)if(hash(await readFile(f.sourcePath))!==f.sha256)throw Error('Import 도중 원본 변경이 감지되었습니다.');
  await writeFile(join(output,'result.json'),JSON.stringify({...summary,...result,sourceWrites:0,completedAt:new Date().toISOString()},null,2));
  console.log(JSON.stringify({...result,sourceWrites:0}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
