import { DEFAULT_ORGANIZATION_ID as ORG } from './data-core';
import { DataCoreAccessContext, DataCoreAccessError } from './data-core-access';
import { LibraryFolder } from './data-core-library-policy';

export async function runLibraryUploadRequest(db:D1Database,context:DataCoreAccessContext,folder:LibraryFolder,form:FormData,upload:(id?:string)=>Promise<unknown>,authorize:(id:string)=>Promise<unknown>){
  const token=form.get('uploadRequestId');if(!token)return upload();
  if(typeof token!=='string'||!/^[0-9a-f-]{36}$/i.test(token))throw new DataCoreAccessError(400,'업로드 요청 식별자를 확인하세요.');
  const file=form.get('file') as File,id=`library-upload:${context.user!.internalUserId}:${token}`,now=new Date().toISOString();
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const fingerprint=JSON.stringify([folder.id,file.name,file.size,file.type,digest]);
  const prior=await db.prepare('SELECT status,metadata_json FROM data_records WHERE id=? AND organization_id=? AND record_type=?').bind(id,ORG,'library-upload-request').first<{status:string;metadata_json:string}>();
  let fileId=crypto.randomUUID();
  if(prior){const m=JSON.parse(prior.metadata_json);fileId=m.fileId||fileId;if(m.fingerprint!==fingerprint)throw new DataCoreAccessError(409,'다른 파일에 사용된 업로드 요청입니다.');
    if(prior.status==='complete'){await authorize(m.result.id);return m.result;}
    if(prior.status==='uploading')throw new DataCoreAccessError(409,'동일 파일 저장이 아직 진행 중입니다. 잠시 후 재시도하세요.');
    const saved=await db.prepare('SELECT * FROM file_objects WHERE id=? AND organization_id=?').bind(fileId,ORG).first<Record<string,unknown>>();
    if(saved){await authorize(fileId);const result={id:fileId,fileName:saved.original_file_name,sizeBytes:saved.size_bytes,mimeType:saved.mime_type,recordId:saved.data_record_id,campusId:saved.campus_id,downloadUrl:`/api/data-core/library/files/${encodeURIComponent(fileId)}/download`};await db.prepare("UPDATE data_records SET status='complete',metadata_json=? WHERE id=?").bind(JSON.stringify({...m,result}),id).run();return result;}
  }
  const metadata=JSON.stringify({folderId:folder.id,fingerprint,fileId});
  const claim=prior?await db.prepare("UPDATE data_records SET status='uploading',metadata_json=?,updated_at=? WHERE id=? AND status='failed'").bind(metadata,now,id).run():await db.prepare(`INSERT INTO data_records(id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at) VALUES(?,?,?,?,'library-upload-request','data-core-library',?,'private','uploading',?,?,?) ON CONFLICT(id) DO NOTHING`).bind(id,ORG,folder.campusId,context.user!.internalUserId,file.name,metadata,now,now).run();
  if(!claim.meta?.changes)throw new DataCoreAccessError(409,'동일 파일 저장이 진행 중입니다.');
  try{const result=await upload(fileId);await db.prepare("UPDATE data_records SET status='complete',metadata_json=?,updated_at=? WHERE id=?").bind(JSON.stringify({folderId:folder.id,fingerprint,fileId,result}),new Date().toISOString(),id).run();return result;}
  catch(e){await db.prepare("UPDATE data_records SET status='failed',updated_at=? WHERE id=?").bind(new Date().toISOString(),id).run();throw e;}
}
