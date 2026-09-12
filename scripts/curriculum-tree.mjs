import { readdir, readFile, lstat, realpath, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, extname, join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const ORG = 'org-hi5-anihi';
export const hash = data => createHash('sha256').update(data).digest('hex');
export const stableId = (kind, ...parts) => `cur-${kind}-${hash(JSON.stringify(parts)).slice(0,40)}`;
const collator = new Intl.Collator('ko', { numeric:true, sensitivity:'variant' });
export const natural = (a,b) => collator.compare(a,b) || (a<b?-1:a>b?1:0);
const imageTypes = {'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif'};
export function outsideSource(source, output) {
  const r=relative(resolve(source),resolve(output));
  if(!r || (!r.startsWith('..')&&!isAbsolute(r)))throw Error('출력 경로는 원본 폴더 밖이어야 합니다.');
}
export async function inventoryTree(source, family, stage) {
  if(family!=='content'||!['basic','advanced'].includes(stage))throw Error('이번 importer는 content/basic 또는 content/advanced만 지원합니다.');
  const root=await realpath(source), folders=[],files=[],blockers=[];
  async function walk(path,parent=null,depth=0){
    if(depth>32){blockers.push({path:relative(root,path),reason:'depth-limit'});return;}
    const entries=(await readdir(path,{withFileTypes:true})).sort((a,b)=>natural(a.name,b.name));
    for(const e of entries){
      const full=join(path,e.name), rel=relative(root,full).split('\\').join('/'), stat=await lstat(full);
      if(stat.isSymbolicLink()){blockers.push({path:rel,reason:'symlink'});continue;}
      if(e.isDirectory()){
        const folder={id:stableId('folder',family,stage,rel),title:e.name,relativePath:rel,parentFolderId:parent,order:folders.length+1};
        folders.push(folder);await walk(full,folder.id,depth+1);
      }else if(e.isFile()){
        const ext=extname(e.name).toLowerCase();
        if(!parent){blockers.push({path:rel,reason:'root-file-needs-lesson'});continue;}
        if(!imageTypes[ext]){blockers.push({path:rel,reason:ext==='.pdf'?'pdf-converter-required':['.ppt','.pptx','.doc','.docx'].includes(ext)?'office-converter-required':'unsupported'});continue;}
        try{
          const bytes=await readFile(full), m=await sharp(bytes,{limitInputPixels:100_000_000}).metadata();
          if(!['jpeg','png','webp','gif'].includes(m.format)||`image/${m.format==='jpeg'?'jpeg':m.format}`!==imageTypes[ext])throw Error('format mismatch');
          // Decode during preview, before any production write or accepting a fingerprint.
          await sharp(bytes,{limitInputPixels:100_000_000}).resize(2,2).raw().toBuffer();
          const sha256=hash(bytes), order=files.filter(f=>f.folderId===parent).length+1;
          files.push({id:stableId('page',family,stage,rel,sha256,bytes.length),folderId:parent,sourcePath:full,relativePath:rel,sourceFileName:e.name,
            sha256,size:bytes.length,mime:imageTypes[ext],order,width:m.autoOrient?.width||m.width,height:m.autoOrient?.height||m.height});
        }catch{blockers.push({path:rel,reason:'invalid-image'});}
      }
    }
  }
  await walk(root);
  const titlePriority=f=>/대표|표지|cover|thumbnail/i.test(f.sourceFileName)?0:1;
  for(const folder of folders){
    const own=files.filter(f=>f.folderId===folder.id).sort((a,b)=>titlePriority(a)-titlePriority(b)||a.order-b.order);
    folder.representativePageId=own[0]?.id||null;
  }
  return {schemaVersion:1,family,stage,sourceRoot:root,folders,files,blockers,sourceBytes:files.reduce((sum,f)=>sum+f.size,0)};
}
export function diffInventory(tree, records) {
  tree=planInventory(tree,records);
  const folders=records.filter(r=>r.record_type==='curriculum-folder'), pages=records.filter(r=>r.record_type==='curriculum-page');
  const current=pages.filter(r=>!r.metadata.supersededByPageId);
  const live=records.filter(r=>!r.metadata.supersededByPageId&&(r.deleted_at||!['active','draft'].includes(r.status)||(r.status==='active'&&r.metadata.active===false))&&
    (r.record_type==='curriculum-folder'?tree.folders.some(f=>f.id===r.id):tree.files.some(f=>f.relativePath===r.metadata.relativePath)));
  const changed=tree.files.filter(f=>f.previousPageId&&!pages.some(p=>p.id===f.id&&p.status==='active'));
  const conflicts=tree.folders.filter(f=>folders.some(p=>p.id===f.id&&(p.title!==f.title||p.metadata.parentFolderId!==f.parentFolderId||p.metadata.relativePath!==f.relativePath)));
  const pageConflicts=tree.files.filter(f=>pages.some(p=>p.id===f.id&&(p.metadata.curriculumFolderId!==f.folderId||p.metadata.fingerprint!==f.sha256||p.metadata.relativePath!==f.relativePath)));
  const duplicates=current.filter((r,i)=>r.status==='active'&&current.slice(0,i).some(p=>p.status==='active'&&p.metadata.relativePath===r.metadata.relativePath));
  const missingSource=records.filter(r=>r.status==='active'&&!r.deleted_at&&!r.metadata.supersededByPageId&&(r.record_type==='curriculum-folder'?!tree.folders.some(f=>f.id===r.id):!tree.files.some(f=>f.relativePath===r.metadata.relativePath)));
  return {folders:tree.folders.length,sourceFiles:tree.files.length,newFolders:tree.folders.filter(f=>!folders.some(r=>r.id===f.id)).length,
    newPages:tree.files.filter(f=>!pages.some(r=>r.id===f.id&&r.status==='active')).length,unchanged:tree.files.filter(f=>pages.some(r=>r.id===f.id&&r.status==='active')).length,
    changed:changed.length,conflicts:conflicts.length+pageConflicts.length+duplicates.length,deletedConflicts:live.length,reviewNeeded:missingSource.length,unsupported:tree.blockers.length,
    canApply:tree.files.length>0&&!tree.blockers.length&&!conflicts.length&&!pageConflicts.length&&!duplicates.length&&!live.length};
}
export function planInventory(tree,records) {
  const pages=records.filter(r=>r.record_type==='curriculum-page');
  const files=tree.files.map(f=>{
    const versions=pages.filter(r=>r.metadata.relativePath===f.relativePath);
    const current=versions.find(r=>r.status==='active'&&!r.metadata.supersededByPageId);
    const baseId=stableId('page',tree.family,tree.stage,f.relativePath,f.sha256,f.size);
    const id=current?.metadata.fingerprint===f.sha256?current.id:versions.some(r=>r.id===baseId&&r.metadata.supersededByPageId)?stableId('revision',baseId,current?.id):baseId;
    const saved=versions.find(r=>r.id===id);
    return {...f,id,version:saved?.metadata.version||((current?.metadata.version||1)+(current&&current.id!==id?1:0)),
      previousPageId:saved?.metadata.previousPageId||(current&&current.id!==id?current.id:null)};
  });
  // Keep missing-source records in the same natural ordering instead of hiding or deleting them.
  const folderPaths=[...new Set([...tree.folders.map(f=>f.relativePath),...records.filter(r=>r.record_type==='curriculum-folder'&&!r.deleted_at).map(r=>r.metadata.relativePath)])].sort(natural);
  for(const f of files){
    const paths=[...new Set([...files.filter(p=>p.folderId===f.folderId).map(p=>p.relativePath),...pages.filter(p=>p.metadata.curriculumFolderId===f.folderId&&!p.deleted_at&&!p.metadata.supersededByPageId).map(p=>p.metadata.relativePath)])].sort(natural);
    f.order=paths.indexOf(f.relativePath)+1;
  }
  const ids=new Map(tree.files.map((f,i)=>[f.id,files[i].id]));
  return {...tree,files,folders:tree.folders.map(f=>({...f,order:folderPaths.indexOf(f.relativePath)+1,representativePageId:ids.get(f.representativePageId)||null}))};
}
export async function prepareAssets(tree, output, records=[]) {
  outsideSource(tree.sourceRoot,output);await mkdir(output,{recursive:true});
  const canonicalOutput=await realpath(output);outsideSource(tree.sourceRoot,canonicalOutput);
  for(const f of tree.files){
    if(records.some(r=>r.id===f.id&&r.status==='active'&&r.metadata.fingerprint===f.sha256))continue;
    const bytes=await readFile(f.sourcePath);
    if(hash(bytes)!==f.sha256||bytes.length!==f.size)throw Error('Preview 이후 원본이 변경되었습니다. 다시 preview 하세요.');
    const make=async(kind,width,format,quality)=>{
      const path=join(canonicalOutput,`${f.id}-${kind}.${format}`);
      const {data,info}=await sharp(bytes,{limitInputPixels:100_000_000}).rotate().resize({width,height:width,fit:'inside',withoutEnlargement:true})[format]({quality}).toBuffer({resolveWithObject:true});
      await writeFile(path,data);return {id:stableId('file',f.id,kind),kind,path,size:data.length,sha256:hash(data),mime:format==='webp'?'image/webp':'image/jpeg',width:info.width,height:info.height};
    };
    f.assets=[{id:stableId('file',f.id,'original'),kind:'original',path:f.sourcePath,size:f.size,sha256:f.sha256,mime:f.mime,width:f.width,height:f.height},
      await make('preview',2200,'webp',88),await make('thumbnail',640,'webp',82),await make('print',3200,'jpeg',93)];
    for(const a of f.assets)a.key=`data-core/documents-private/${ORG}/organization/curriculum/${tree.family}/${tree.stage}/${f.id}/${a.kind}-${a.sha256}${extname(a.path).toLowerCase()}`;
  }
  for(const f of tree.folders)f.representativeFileId=f.representativePageId?stableId('file',f.representativePageId,'thumbnail'):null;
  return tree;
}
export function folderMetadata(tree,f){return {schemaVersion:1,family:tree.family,stage:tree.stage,order:f.order,relativePath:f.relativePath,parentFolderId:f.parentFolderId,representativeFileId:f.representativeFileId||null,active:true};}
export function pageMetadata(tree,f){return {schemaVersion:1,family:tree.family,stage:tree.stage,curriculumFolderId:f.folderId,order:f.order,
  version:f.version||1,previousPageId:f.previousPageId||null,
  relativePath:f.relativePath,sourceFileName:f.sourceFileName,fingerprint:f.sha256,sourceSize:f.size,width:f.width,height:f.height,
  ...Object.fromEntries(f.assets.map(a=>[`${a.kind}FileId`,a.id])),assets:f.assets.map(({id,kind,sha256,size,width,height})=>({id,kind,sha256,size,width,height})),active:true};}
