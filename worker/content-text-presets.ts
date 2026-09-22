import { DEFAULT_ORGANIZATION_ID as ORG } from './data-core';
import { DataCoreAccessContext, DataCoreAccessError, managesCampus } from './data-core-access';
import { contentScope } from './content-ai-settings';
import { campusDisplayName } from './campus-directory';
import { BRANDS, COURSES, REGIONS, recommendedPresets, normalizeTags } from '../public/data-core/content-preset-catalog.js';

export const TEXT_PRESETS_TYPE = 'content-text-presets';
type Item = {id:string;kind:string;name:string;content:string;category?:string;brandScope?:string;ownerUserId:string|null;createdAt?:string;updatedAt?:string;revision:number;deletedAt:string|null;builtInKey:string|null;createRequest?:string;unavailable?:string};
type Profile = {brands:string[];names:Record<string,string>;courses:string[];phone?:string;address?:string;link?:string};
type PresetData = {revision:number;items:Record<string,Item>;preferences:Record<string,Record<string,boolean>>;profile:Profile};
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const nameKey=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('ko-KR');
const fail=(status:number,message:string):never=>{throw new DataCoreAccessError(status,message);};
const text=(value:unknown,max:number)=>{
 if(typeof value!=='string'||!value.trim()||value.length>max)fail(400,'이름과 내용을 확인하세요.');
 return (value as string).normalize('NFC').trim();
};
function initialProfile(campusId:string) {
 const brand=campusId==='campus-anihi-admission'?'anihi':campusId==='campus-design-admission'?'hi5':null;
 return {brands:brand?[brand]:[],names:brand?{[brand]:campusDisplayName(campusId)}:{},courses:[],phone:'',address:'',link:''};
}
function cleanProfile(value:unknown):Profile {
 const input=object(value);
 if(!Array.isArray(input.brands)||input.brands.some(b=>typeof b!=='string'||!Object.hasOwn(BRANDS,b)))fail(400,'확인된 브랜드를 선택하세요.');
 const brands=input.brands as string[];
 const names:Record<string,string>={};
 for(const b of brands)names[b]=text(object(input.names)[b],100);
 const courses=Array.isArray(input.courses)?input.courses:[];
 if(courses.some(c=>typeof c!=='string'||!Object.hasOwn(COURSES,c)))fail(400,'과정 설정을 확인하세요.');
 const profile={brands:[...new Set(brands)],names,courses:[...new Set(courses as string[])],phone:String(input.phone||'').trim(),address:String(input.address||'').trim(),link:String(input.link||'').trim()};
 if(profile.phone.length>60||profile.address.length>300||profile.link.length>500||/[\r\n<>]/.test(profile.phone+profile.address+profile.link)||/\{\{|undefined|\bnull\b/.test(JSON.stringify(profile)))fail(400,'연락처 설정을 확인하세요.');
 if(profile.link){let url;try{url=new URL(profile.link);}catch{fail(400,'상담 링크는 https 주소여야 합니다.');}if(url!.protocol!=='https:'||url!.username||url!.password)fail(400,'상담 링크는 https 주소여야 합니다.');}
 return profile;
}
function contacts(profile:Profile,sourceApp:string) {
 return [profile.phone?'전화: '+profile.phone:'',sourceApp==='blog'&&profile.address?'주소: '+profile.address:'',sourceApp==='blog'?profile.link:''].filter(Boolean).join('\n');
}

// One protected record per campus/channel serializes duplicate-name checks and mutations.
// GET projects the versioned catalog without seeding/writing any preset records.
export async function textPresets(db:D1Database,context:DataCoreAccessContext,input:Record<string,unknown>,mutate=false) {
 const {sourceApp,campusId}=contentScope(context,input);
 if(!campusId)fail(400,'캠퍼스를 선택하세요.');
 const campus=await db.prepare('SELECT id FROM campuses WHERE id=? AND organization_id=? AND status=\'active\'').bind(campusId,ORG).first();
 if(!campus)fail(404,'캠퍼스를 찾을 수 없습니다.');
 const id=`text-presets:${ORG}:${sourceApp}:${campusId}`,owner=context.user!.internalUserId;
 const manager=context.isSuperAdmin||managesCampus(context,campusId);
 const row=await db.prepare('SELECT metadata_json FROM data_records WHERE id=? AND organization_id=? AND record_type=? AND deleted_at IS NULL').bind(id,ORG,TEXT_PRESETS_TYPE).first<{metadata_json:string}>();
 const data:PresetData=row?JSON.parse(row.metadata_json):{revision:0,items:{},preferences:{},profile:initialProfile(campusId!)};
 const catalog=()=>recommendedPresets(campusId!,sourceApp,data.profile) as Item[];
 const visible=(item:Item)=>!item.ownerUserId||item.ownerUserId===owner||manager;
 const merged=()=>{
  const built=catalog().map(item=>({...item,...data.items[item.id]}));
  // Keep overrides even if the catalog/confirmed brands change; never resurrect or discard them.
  const keys=new Set(built.map(i=>i.id));
  return [...built,...Object.values(data.items).filter(i=>!keys.has(i.id))].filter(visible);
 };
 if(mutate){
  const now=new Date().toISOString(),action=String(input.action);
  if(action==='profile'){
   if(!manager)fail(403,'캠퍼스 관리 권한이 필요합니다.');
   if(input.revision!==data.revision)fail(409,'설정이 변경되었습니다. 새로 불러온 뒤 다시 저장하세요.');
   data.profile=cleanProfile(input.profile);
  }else{
   let item:Item;
   if(action==='create'){
    if(typeof input.requestId!=='string'||!/^[a-f0-9-]{36}$/i.test(input.requestId))fail(400,'저장 요청을 확인하세요.');
    const newId=`user:${owner}:${input.requestId}`;
    const prior=data.items[newId];
    const payload=JSON.stringify([input.kind,input.name,input.content,input.category||'',input.brandScope||'common',Boolean(input.shared)]);
    if(prior){if(prior.createRequest!==payload)fail(409,'이미 사용한 저장 요청입니다.');return present();}
    if(Object.keys(data.items).length>=500)fail(409,'저장 가능한 세트 수를 초과했습니다.');
    if(input.shared&&!manager)fail(403,'공유 세트는 캠퍼스 관리자가 저장할 수 있습니다.');
    item={id:newId,kind:String(input.kind),name:'',content:'',ownerUserId:input.shared?null:owner,createdAt:now,revision:0,deletedAt:null,builtInKey:null,createRequest:payload};
   }else{
    item=merged().find(item=>item.id===input.presetId)!;
    if(!item)fail(404,'세트를 찾을 수 없습니다.');
    if(input.revision!==item.revision)fail(409,'다른 수정이 먼저 저장됐습니다. 새로 불러온 뒤 다시 수정하세요.');
    if(action!=='favorite'&&!manager&&item.ownerUserId!==owner)fail(403,'본인 세트만 수정할 수 있습니다. 공유 추천은 캠퍼스 관리자가 관리합니다.');
   }
   if(['create','update'].includes(action)){
    if(!['hashtags','closing'].includes(item.kind))fail(400,'세트 종류를 확인하세요.');
    if(item.deletedAt)fail(409,'복원 후 수정하세요.');
    const name=text(input.name,60),content=text(input.content,item.kind==='hashtags'?2000:3000);
    if(/\{\{[^}]*\}\}|\b(?:undefined|null)\b/.test(content))fail(400,'확인되지 않은 치환값을 제거하세요.');
    if(item.kind==='hashtags'&&normalizeTags(content).length>30)fail(400,'현재 콘텐츠 저장 계약은 태그 30개까지입니다. 직접 정리해주세요.');
    if(item.kind==='hashtags'&&normalizeTags(content).some(tag=>tag.length>80))fail(400,'태그는 각각 80자까지 저장할 수 있습니다.');
    const brandScope=String(input.brandScope||item.brandScope||'common');
    if(!['common','anihi','hi5','unconfirmed'].includes(brandScope))fail(400,'브랜드를 확인하세요.');
    if(merged().some(other=>other.id!==item.id&&!other.deletedAt&&other.kind===item.kind&&other.brandScope===brandScope&&nameKey(other.name)===nameKey(name)))fail(409,'같은 이름의 세트가 있습니다. 기존 세트를 수정하거나 다른 이름으로 저장하세요.');
    Object.assign(item,{name,content,category:String(input.category||'').trim().slice(0,40),brandScope,unavailable:''});
   }else if(action==='delete')item.deletedAt=now;
   else if(action==='restore'){
    if(merged().some(other=>other.id!==item.id&&!other.deletedAt&&other.kind===item.kind&&other.brandScope===item.brandScope&&nameKey(other.name)===nameKey(item.name)))fail(409,'같은 이름의 세트가 있어 복원할 수 없습니다.');
    item.deletedAt=null;
   }else if(action!=='favorite')fail(400,'지원하지 않는 작업입니다.');
   if(action==='favorite'||action==='create'){
    data.preferences[owner]??={};data.preferences[owner][item.id]=Boolean(input.favorite);
   }
   if(action!=='favorite'){item.revision++;item.updatedAt=now;data.items[item.id]=item;}
  }
  data.revision++;
  const metadata=JSON.stringify(data);
  if(metadata.length>1_000_000)fail(413,'세트 저장 공간을 초과했습니다.');
  const result=row?await db.prepare('UPDATE data_records SET metadata_json=?,updated_at=? WHERE id=? AND organization_id=? AND record_type=? AND metadata_json=? AND deleted_at IS NULL').bind(metadata,now,id,ORG,TEXT_PRESETS_TYPE,row.metadata_json).run():
   await db.prepare(`INSERT INTO data_records (id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,'콘텐츠 문구 세트','private','active',?,?,?) ON CONFLICT(id) DO NOTHING`).bind(id,ORG,campusId,owner,TEXT_PRESETS_TYPE,sourceApp,metadata,now,now).run();
  if(result.meta?.changes!==1)fail(409,'동시에 다른 변경이 저장됐습니다. 새로 불러온 뒤 다시 저장하세요.');
 }
 return present();
 function present(){
  return {organizationId:ORG,campusId,sourceApp,revision:data.revision,canManageShared:manager,profile:data.profile,region:REGIONS[campusId! as keyof typeof REGIONS]||null,contactBlock:contacts(data.profile,sourceApp),
   presets:merged().map(item=>{const result={...item,favorite:Boolean(data.preferences[owner]?.[item.id]),canEdit:manager||item.ownerUserId===owner};delete result.createRequest;return result;})};
 }
}
