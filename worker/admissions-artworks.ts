import {DataCoreAccessError, requireAuthenticatedAccess, requireCampusAccess, resolveDataCoreAccess} from './data-core-access';
import {DEFAULT_ORGANIZATION_ID} from './data-core';
import {readAdmissionsState} from './data-core-admissions-knowledge-sync';
import {legacyArtworkThumbnail,legacyThumbnailIdentity,registeredArtworkThumbnail} from './admissions-thumbnails';

type Env = {DB?:D1Database;FILES?:R2Bucket;DATA_CORE_SUPER_ADMIN_EMAILS?:string};
const types:Record<string,string>={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif'};
export function legacyArtworkKey(value:unknown,storedFileName=false):string|null {
  if(typeof value!=='string'||value.length>3000)return null;
  let path:string;try{path=decodeURIComponent(value).replace(/\\/g,'/');}catch{return null;}
  if(/[\u0000-\u001f\u007f?#]/.test(path)||path.split('/').some(p=>p==='..'||p==='.')||/%[0-9a-f]{2}/i.test(path))return null;
  if(path.startsWith('/api/files/'))path=path.slice(11);
  else if(/^file:\/\/\//i.test(path))path=path.slice(8);
  else if(/^[a-z]+:/i.test(path)&&!/^[a-z]:\//i.test(path))return null;
  if(path.startsWith('/artworks/'))path=path.slice(1);
  if(!path.startsWith('artworks/')) {
    if(!storedFileName&&path.includes('/')&&!path.startsWith('/')&&!/^[a-z]:\//i.test(path))return null;
    path='artworks/'+path.split('/').pop();
  }
  if(!/^artworks\/.+\.(jpg|jpeg|png|webp|gif)$/i.test(path))return null;
  return path;
}

export async function handleAdmissionsArtworks(request:Request,env:Env):Promise<Response|null>{
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/admissions/students/')&&!url.pathname.startsWith('/api/admissions/files/'))return null;
  const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff'};
  try{
    if(!['GET','HEAD','POST'].includes(request.method))return new Response(null,{status:405,headers});
    if(!env.DB||!env.FILES)throw new DataCoreAccessError(503,'그림 저장소를 확인할 수 없습니다.');
    const context=await resolveDataCoreAccess(request,env.DB,env.DATA_CORE_SUPER_ADMIN_EMAILS);
    requireAuthenticatedAccess(context);
    if(!context.isSuperAdmin&&!context.memberships.some(m=>m.organizationId===DEFAULT_ORGANIZATION_ID&&['TEACHER','STAFF','CAMPUS_DIRECTOR','CAMPUS_ADMIN'].includes(m.role)))throw new DataCoreAccessError(403,'학생 그림을 볼 권한이 없습니다.');
    const registered=/^\/api\/admissions\/files\/([^/]+)\/thumbnail$/.exec(url.pathname);
    if(registered)return await registeredArtworkThumbnail(request,env.DB,env.FILES,context,decodeURIComponent(registered[1]));
    const match=url.pathname.match(/^\/api\/admissions\/students\/([^/]+)\/artworks\/(\d+|artworkImage|artwork|image)(\/thumbnail)?$/);
    if(!match)throw new DataCoreAccessError(404,'그림을 찾을 수 없습니다.');
    if(request.method==='POST'&&!match[3])return new Response(null,{status:405,headers});
    const id=decodeURIComponent(match[1]);
    const state=await readAdmissionsState(env.DB,env.FILES);
    const students=Array.isArray(state.students)?state.students:[];
    const matches=students.filter(s=>s&&typeof s==='object'&&String(s.id)===id);
    if(matches.length!==1)throw new DataCoreAccessError(404,'그림을 찾을 수 없습니다.');
    const student=matches[0];
    if(!context.isSuperAdmin){
      if(typeof student.campusId!=='string'||!student.campusId)throw new DataCoreAccessError(403,'학생 캠퍼스 권한 확인이 필요합니다.');
      requireCampusAccess(context,student.campusId);
    }
    const slot=match[2];
    const artwork=/^\d+$/.test(slot)?student.artworks?.[Number(slot)]:student[slot];
    // Legacy migration URLs may be stale. Only exact keys derived from this stored artwork qualify.
    const refs=typeof artwork==='string'?[legacyArtworkKey(artwork)]:['path','filePath','imageUrl','url','downloadUrl','fileName','name'].map(k=>legacyArtworkKey(artwork?.[k],k==='fileName'||k==='name'));
    const candidates=[...new Set(refs.filter((k):k is string=>Boolean(k)))];
    // A single exact stored key needs no existence roundtrip before its authenticated GET.
    const found=candidates.length===1 ? candidates : (await Promise.all(candidates.map(async candidate=>
      await env.FILES!.head(candidate) ? candidate : null))).filter((key):key is string=>key!==null);
    if(found.length!==1)throw new DataCoreAccessError(404,'연결된 그림을 찾을 수 없습니다.');
    const key=found[0];
    const object=await env.FILES.get(key);
    if(!object)throw new DataCoreAccessError(404,'연결된 그림을 찾을 수 없습니다.');
    const fallback=types[key.split('.').pop()!.toLowerCase()];
    const mime=object.httpMetadata?.contentType?.split(';')[0]||fallback;
    if(!Object.values(types).includes(mime)){await object.body.cancel();throw new DataCoreAccessError(415,'이미지 파일이 아닙니다.');}
    if(match[3]) {
      const identity=await legacyThumbnailIdentity(id,slot,student.campusId,key,object.httpEtag);
      const response=await legacyArtworkThumbnail(request,env.DB,env.FILES,context,identity,typeof student.campusId==='string'?student.campusId:null,object,async()=>{
        const fresh=await readAdmissionsState(env.DB!,env.FILES!);
        const rows=(Array.isArray(fresh.students)?fresh.students:[]).filter(s=>s&&typeof s==='object'&&String(s.id)===id);
        const current=rows[0],currentArtwork=/^\d+$/.test(slot)?current?.artworks?.[Number(slot)]:current?.[slot];
        return rows.length===1 && current.campusId===student.campusId && JSON.stringify(currentArtwork)===JSON.stringify(artwork)
          && JSON.stringify((await env.FILES!.head(key))?.etag)===object.httpEtag;
      });
      if(response)return response;
    }
    const responseHeaders=new Headers({...headers,'content-type':mime,'etag':object.httpEtag,'cache-control':'private, no-cache','cross-origin-resource-policy':'same-origin'});
    if(request.headers.get('if-none-match')===object.httpEtag){await object.body.cancel();return new Response(null,{status:304,headers:responseHeaders});}
    if(request.method==='HEAD'){await object.body.cancel();return new Response(null,{headers:responseHeaders});}
    return new Response(object.body,{headers:responseHeaders});
  }catch(error){
    const status=error instanceof DataCoreAccessError?error.status:503;
    return Response.json({error:status===403?'이 학생 그림을 볼 권한이 없습니다.':status===401?'로그인이 필요합니다.':'그림을 확인할 수 없습니다.'},{status,headers});
  }
}
