import { DEFAULT_ORGANIZATION_ID as ORG } from './data-core';
import { DataCoreAccessContext, DataCoreAccessError } from './data-core-access';
import { LibraryTree, LibraryFolder, requireLibraryWrite } from './data-core-library-policy';

// Acquire before any asynchronous object write. Folder moves check these rows in
// their atomic batch, so an upload cannot commit under a changed folder policy.
export async function acquireLibraryWrite(db:D1Database,context:DataCoreAccessContext,expected:LibraryFolder){
  const tree=await new LibraryTree(db,context).init(),folder=await tree.resolve(expected.id);
  requireLibraryWrite(context,folder);
  if(folder.category!==expected.category||folder.campusId!==expected.campusId||folder.shareMode!==expected.shareMode)throw new DataCoreAccessError(409,'폴더 위치가 변경되었습니다. 다시 선택하세요.');
  const snapshots=(await tree.breadcrumbs(folder)).map(p=>tree.rows.get(p.id)).filter(Boolean);
  const id=crypto.randomUUID(),now=new Date().toISOString();
  const result=await db.prepare(`INSERT INTO data_records(id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at)
    SELECT ?,?,?,?,'library-write-lease','data-core-library','upload','private','uploading',?,?,?
    WHERE NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN data_records r ON r.id=json_extract(j.value,'$.id') WHERE r.id IS NULL OR r.deleted_at IS NOT NULL OR r.metadata_json IS NOT json_extract(j.value,'$.metadata_json') OR r.updated_at IS NOT json_extract(j.value,'$.updated_at'))`)
    .bind(id,ORG,folder.campusId,context.user!.internalUserId,JSON.stringify({folderId:folder.id}),now,now,JSON.stringify(snapshots)).run();
  if(!result.meta?.changes)throw new DataCoreAccessError(409,'폴더가 변경되었습니다. 업로드를 다시 시도하세요.');
  return async()=>{await db.prepare('DELETE FROM data_records WHERE id=? AND organization_id=? AND record_type=?').bind(id,ORG,'library-write-lease').run();};
}
