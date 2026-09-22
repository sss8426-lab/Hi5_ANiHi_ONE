import { DEFAULT_ORGANIZATION_ID as ORG } from './data-core';
import { DataCoreAccessError } from './data-core-access';
import { LibraryTree, LibraryFolder, LIBRARY_FOLDER, libraryCanDeleteFolder, libraryDefaultFolder, libraryMetadata, libraryFileReadable, libraryCanDelete, requireLibraryWrite, libraryFolderScope } from './data-core-library-policy';
import { materialize, fileRow } from './data-core-library';
import { instagramPreserveReason } from '../public/data-core/instagram-source-policy.js';

type Row=Record<string,unknown>;
const fail=(status:number,message:string):never=>{throw new DataCoreAccessError(status,message);};
const idsJson=(rows:Row[])=>JSON.stringify(rows.map(r=>r.id));
const general=(f:LibraryFolder)=>!f.protected&&!!f.category&&!['student-artwork','counseling-material'].includes(f.category)&&f.shareMode==='organization';
function compatible(a:LibraryFolder,b:LibraryFolder){return a.campusId===b.campusId&&Boolean(a.protected)===Boolean(b.protected)&&a.shareMode===b.shareMode&&(a.category===b.category||general(a)&&general(b))&&(!instagramPreserveReason({category:a.category})||Boolean(instagramPreserveReason({category:b.category})));}

/** Bounded, atomic metadata relocation. No R2 operation is involved. */
export async function moveLibraryItems(tree:LibraryTree,input:Record<string,unknown>){
  if(!input||!Array.isArray(input.items)||!input.items.length||input.items.length>100||typeof input.requestId!=='string'||!/^[a-f0-9-]{36}$/i.test(input.requestId))fail(400,'이동 항목과 요청을 확인하세요.');
  const owner=tree.context.user!.internalUserId;
  const requestKey=`library-move:${owner}:${input.requestId}`;
  const fingerprint=JSON.stringify({items:input.items,targetId:input.targetId});
  const previous=await tree.db.prepare('SELECT metadata_json FROM audit_logs WHERE id=? AND organization_id=?').bind(requestKey,ORG).first<{metadata_json:string}>();
  if(previous){const prior=JSON.parse(previous.metadata_json);if(prior.fingerprint!==fingerprint)fail(409,'이미 사용한 이동 요청입니다.');return prior.result;}
  let target=await tree.resolve(String(input.targetId||''));requireLibraryWrite(tree.context,target);
  if(!target.category||target.navigationHidden)fail(400,'자료를 담을 수 있는 폴더를 선택하세요.');
  const selectedFolders:LibraryFolder[]=[],selectedFiles:Row[]=[];
  const sources=new Map<string,LibraryFolder>();
  for(const value of input.items as unknown[]){
    if(!value||typeof value!=='object')fail(400,'이동 항목을 확인하세요.');
    const item=value as Record<string,unknown>;
    if(item.kind==='folder'){
      const f=await tree.resolve(String(item.id));requireLibraryWrite(tree.context,f);
      if(f.virtual||f.systemManaged||libraryDefaultFolder(f)||!libraryCanDeleteFolder(tree.context,f))fail(403,'시스템·기본 분류 폴더는 이동할 수 없습니다.');
      if(item.revision!==f.row?.updated_at)fail(409,'폴더가 변경되었습니다. 다시 불러오세요.');
      selectedFolders.push(f);
    }else if(item.kind==='file'){
      const {row,source,folder}=await fileRow(tree,String(item.id));requireLibraryWrite(tree.context,folder);
      if(row.id!==source.id||!libraryCanDelete(tree.context,folder,row.owner_user_id))fail(403,'이 파일은 이동할 수 없습니다.');
      if(item.revision!==undefined&&item.revision!==row.data_record_id)fail(409,'파일 위치가 변경되었습니다.');
      if(!compatible(folder,target))fail(400,'같은 캠퍼스와 보호 범위의 폴더를 선택하세요.');
      selectedFiles.push(row);
      sources.set(String(row.id),folder);
    }else fail(400,'이동 종류를 확인하세요.');
  }
  const roots:LibraryFolder[]=[];
  const selectedIds=new Set(selectedFolders.map(f=>f.id));
  for(const f of selectedFolders){const path=await tree.breadcrumbs(f);if(!path.slice(0,-1).some(p=>selectedIds.has(p.id))&&!roots.some(r=>r.id===f.id))roots.push(f);}
  const folderRows:Row[]=[],moves:Row[]=[],paths:unknown[]=[];
  for(const root of roots){
    if(!compatible(root,target))fail(400,'같은 캠퍼스와 보호 범위의 폴더를 선택하세요.');
    if(root.parentId===target.id)fail(409,'이미 같은 폴더에 있습니다.');
    const rows=(await tree.db.prepare(`WITH RECURSIVE subtree(id) AS (SELECT ? UNION SELECT r.id FROM data_records r JOIN subtree s
      ON json_valid(r.metadata_json) AND json_extract(r.metadata_json,'$.parentFolderId')=s.id WHERE r.organization_id=? AND r.record_type=? AND r.deleted_at IS NULL)
      SELECT r.* FROM data_records r JOIN subtree s ON r.id=s.id LIMIT 251`).bind(root.id,ORG,LIBRARY_FOLDER).all<Row>()).results||[];
    if(rows.length>250||folderRows.length+rows.length>250)fail(413,'한 번에 250개 이하의 하위 폴더를 이동할 수 있습니다. 변경된 항목은 없습니다.');
    if(rows.some(r=>r.id===target.id))fail(409,'자신이나 하위 폴더로 이동할 수 없습니다.');
    for(const row of rows)tree.rows.set(String(row.id),row);
    for(const row of rows){const f=await tree.resolve(String(row.id));requireLibraryWrite(tree.context,f);
      if(!compatible(f,target)||!libraryCanDeleteFolder(tree.context,f))fail(403,'하위 폴더의 관리 권한을 확인하세요.');
      if(target.depth+1+f.depth-root.depth>14)fail(400,'폴더 최대 깊이 14단계를 초과합니다.');
      const m=libraryMetadata(row);moves.push({id:row.id,metadata:JSON.stringify({...m,parentFolderId:row.id===root.id?target.id:m.parentFolderId,category:target.category,libraryScope:libraryFolderScope(target),libraryShareMode:target.shareMode})});
    }
    folderRows.push(...rows);paths.push({id:root.id,before:await tree.breadcrumbs(root),after:[...await tree.breadcrumbs(target),{id:root.id,title:root.title}]});
  }
  const inside=folderRows.length?(await tree.db.prepare('SELECT * FROM file_objects WHERE organization_id=? AND data_record_id IN (SELECT value FROM json_each(?)) LIMIT 2001').bind(ORG,idsJson(folderRows)).all<Row>()).results||[]:[];
  if(inside.length>2000)fail(413,'한 번에 2,000개 이하 파일이 포함된 폴더를 이동할 수 있습니다. 원본과 위치는 변경되지 않았습니다.');
  for(const row of inside){const folder=await tree.resolve(String(row.data_record_id));if(!libraryFileReadable(tree.context,folder,{...row,deleted_at:null})||!libraryCanDelete(tree.context,folder,row.owner_user_id))fail(403,'관리할 수 없는 하위 자료가 포함되어 있습니다.');}
  const allFiles=[...new Map([...inside,...selectedFiles].map(r=>[r.id,r])).values()];
  const nested=new Set(folderRows.map(r=>r.id));
  const standalone=selectedFiles.filter((f,i)=>!nested.has(f.data_record_id)&&selectedFiles.findIndex(v=>v.id===f.id)===i);
  if(standalone.some(f=>f.data_record_id===target.id))fail(409,'이미 같은 폴더에 있는 파일이 포함되어 있습니다.');
  const fileNames=standalone.map(f=>String(f.original_file_name).normalize('NFC'));
  if(new Set(fileNames).size!==fileNames.length)fail(409,'같은 이름의 파일이 선택되었습니다. 이름을 구분한 뒤 이동하세요.');
  if(standalone.length){
    const existing=(await tree.db.prepare('SELECT original_file_name FROM file_objects WHERE organization_id=? AND data_record_id=? AND deleted_at IS NULL').bind(ORG,target.id).all<{original_file_name:string}>()).results||[];
    if(existing.some(f=>fileNames.includes(f.original_file_name.normalize('NFC'))))fail(409,'대상 위치에 같은 이름의 파일이 있습니다. 원본은 변경되지 않았습니다.');
  }
  const names=roots.map(f=>f.title.normalize('NFC'));
  if(new Set(names).size!==names.length)fail(409,'같은 이름의 폴더가 선택되었습니다.');
  const siblings=(await tree.db.prepare(`SELECT title FROM data_records WHERE organization_id=? AND record_type=? AND deleted_at IS NULL AND json_valid(metadata_json) AND json_extract(metadata_json,'$.parentFolderId')=?`).bind(ORG,LIBRARY_FOLDER,target.id).all<{title:string}>()).results||[];
  if(siblings.some(s=>names.includes(s.title.normalize('NFC'))))fail(409,'대상 위치에 같은 이름의 폴더가 있습니다.');
  target=await materialize(tree,target);
  const sourceFolders=[...roots,...standalone.map(f=>sources.get(String(f.id))!)];
  const ancestorIds=[...new Set([...await tree.breadcrumbs(target),...(await Promise.all(sourceFolders.map(r=>tree.breadcrumbs(r)))).flat()].map(p=>p.id))];
  await tree.prefetch(ancestorIds);
  const snapshots=[...new Map([...folderRows,...ancestorIds.map(id=>tree.rows.get(id)).filter(Boolean)].map(r=>[r!.id,r!])).values()];
  const folderIds=idsJson(folderRows),now=new Date().toISOString();
  const result={ok:true,moved:roots.length+standalone.length,folders:folderRows.length,files:allFiles.length,folderId:target.id};
  const guard=(condition:string,values:(string|number|null)[])=>tree.db.prepare(`SELECT json(CASE WHEN (${condition}) THEN '{}' ELSE 'library-conflict' END)`).bind(...values);
  const statements=[
    guard(`NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN data_records r ON r.id=json_extract(j.value,'$.id') WHERE r.id IS NULL OR r.deleted_at IS NOT NULL OR r.metadata_json IS NOT json_extract(j.value,'$.metadata_json') OR r.updated_at IS NOT json_extract(j.value,'$.updated_at'))`,[JSON.stringify(snapshots)]),
    guard(`NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN file_objects f ON f.id=json_extract(j.value,'$.id') WHERE f.id IS NULL OR ${['data_record_id','deleted_at','visibility','category','organization_id','campus_id','owner_user_id','source_app','area','r2_key'].map(k=>`f.${k} IS NOT json_extract(j.value,'$.${k}')`).join(' OR ')})`,[JSON.stringify(allFiles)]),
    guard(`(SELECT COUNT(*) FROM file_objects WHERE organization_id=? AND data_record_id IN (SELECT value FROM json_each(?)))=?`,[ORG,folderIds,inside.length]),
    guard(`NOT EXISTS(SELECT 1 FROM data_records WHERE organization_id=? AND record_type=? AND deleted_at IS NULL AND json_valid(metadata_json) AND json_extract(metadata_json,'$.parentFolderId') IN (SELECT value FROM json_each(?)) AND id NOT IN(SELECT value FROM json_each(?)))`,[ORG,LIBRARY_FOLDER,folderIds,folderIds]),
    guard(`NOT EXISTS(SELECT 1 FROM data_records WHERE organization_id=? AND record_type IN ('library-upload-session','library-write-lease') AND deleted_at IS NULL AND status IN ('pending','uploading','failed') AND json_valid(metadata_json) AND json_extract(metadata_json,'$.folderId') IN (SELECT value FROM json_each(?)))`,[ORG,JSON.stringify([...nested,target.id])]),
    guard(`NOT EXISTS(SELECT 1 FROM data_records WHERE organization_id=? AND record_type=? AND deleted_at IS NULL AND json_valid(metadata_json) AND json_extract(metadata_json,'$.parentFolderId')=? AND title IN(SELECT value FROM json_each(?)))`,[ORG,LIBRARY_FOLDER,target.id,JSON.stringify(roots.map(f=>f.title))]),
    guard(`NOT EXISTS(SELECT 1 FROM file_objects WHERE organization_id=? AND data_record_id=? AND deleted_at IS NULL AND original_file_name IN(SELECT value FROM json_each(?)))`,[ORG,target.id,JSON.stringify(standalone.map(f=>f.original_file_name))]),
  ];
  if(moves.length)statements.push(tree.db.prepare(`UPDATE data_records SET metadata_json=(SELECT json_extract(value,'$.metadata') FROM json_each(?) WHERE json_extract(value,'$.id')=data_records.id),updated_at=? WHERE organization_id=? AND id IN(SELECT value FROM json_each(?))`).bind(JSON.stringify(moves),now,ORG,folderIds),guard('changes()=?',[moves.length]));
  if(inside.length)statements.push(tree.db.prepare('UPDATE file_objects SET category=? WHERE organization_id=? AND data_record_id IN(SELECT value FROM json_each(?))').bind(target.category,ORG,folderIds),guard('changes()=?',[inside.length]));
  if(standalone.length)statements.push(tree.db.prepare('UPDATE file_objects SET data_record_id=?,category=? WHERE organization_id=? AND id IN(SELECT value FROM json_each(?))').bind(target.id,target.category,ORG,idsJson(standalone)),guard('changes()=?',[standalone.length]));
  for(const f of standalone){const folder=sources.get(String(f.id))!;paths.push({id:f.id,before:await tree.breadcrumbs(folder),after:await tree.breadcrumbs(target)});}
  statements.push(tree.db.prepare(`INSERT INTO audit_logs(id,organization_id,campus_id,actor_user_id,action,resource_type,resource_id,metadata_json,created_at) VALUES(?,?,?,?,'library.move','data_record',?,?,?)`).bind(requestKey,ORG,target.campusId,owner,target.id,JSON.stringify({fingerprint,result,paths}),now));
  try{await tree.db.batch(statements);}catch{fail(409,'동시에 폴더·파일·업로드 상태가 변경되었습니다. 이동되지 않았습니다. 새로 불러와 다시 시도하세요.');}
  return result;
}
