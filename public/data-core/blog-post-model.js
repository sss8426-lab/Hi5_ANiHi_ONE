export const BLOG_SCHEMA = 1;
export const BLOG_TEMPLATES = {class:'수업 소개',student:'학생 작품',teacher:'선생님 연구작',award:'수상 소식',admission:'합격 소식',career:'입시·진로 정보',recruit:'모집·특강',space:'학원 공간'};
export const PHOTO_KINDS = {unknown:'유형 확인 필요',class:'실제 수업',student:'학생 작품',teacher:'선생님 연구작',space:'학원 공간',event:'행사',fact:'합격·수상 자료',illustration:'설명용 이미지'};
export const templateDefaults = () => ({templateId:'class',templateVersion:1,topFileId:'',bottomFileId:'',logoType:'none',greeting:'',align:'left',spacing:24,font:'sans-serif',coverWidth:1200,coverHeight:900,contactMode:'verified'});
export function safeName(value, fallback='사진', max=110) {
  const clean=String(value||'').normalize('NFC').replace(/[\x00-\x1f<>:"/\\|?*]/g,'_').replace(/[. ]+$/g,'').trim();
  const dot=clean.lastIndexOf('.'),ext=dot>0&&clean.length-dot<12?clean.slice(dot):'';
  const base=(ext?clean.slice(0,-ext.length):clean).slice(0,max-ext.length)||fallback;
  return (/^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/i.test(base)?'_'+base:base)+ext;
}
export function orderedName(name,index){return `${String(index+1).padStart(2,'0')}_${safeName(name)}`;}
export function synchronizePhotos(ids,old=[],known=new Map()) {
  const map=new Map(old.map(p=>[p.fileId,p]));
  return [...new Set(ids)].map((fileId,index)=>map.get(fileId)||({fileId,version:'',order:index,kind:known.get(fileId)?.category==='student-artwork'?'student':'unknown',description:'',facts:'',exclude:'',use:true,cover:false,externalAiConsent:false})).map((p,order)=>({...p,order}));
}
export function assembleBlocks({body='',lead='',photos=[],template=templateDefaults(),cover=null,footer='',contact='',tags=[]},id=()=>crypto.randomUUID()) {
  const blocks=[],text=(type,value)=>{if(value)blocks.push({id:id(),type,text:value});},image=(fileId,role,sourceFileId)=>{if(fileId)blocks.push({id:id(),type:'image',fileId,role,sourceFileId:sourceFileId||fileId});};
  image(template.topFileId,'top');text('greeting',template.greeting);
  if(cover?.fileId)image(cover.fileId,'cover',cover.sourceFileId);
  const paragraphs=String(body).split(/\n\s*\n/).filter(Boolean);
  if(lead&&paragraphs[0]===lead)paragraphs.shift();
  text('lead',lead||paragraphs.shift()||'');
  const used=photos.filter(p=>p.use);
  for(let i=0;i<Math.max(paragraphs.length,used.length);i++){
    if(paragraphs[i])text(paragraphs[i].startsWith('## ')?'heading':'paragraph',paragraphs[i].replace(/^## /,''));
    const photo=used[i];if(photo){image(photo.editedFileId||photo.fileId,'body',photo.fileId);text('caption',photo.description);}
  }
  text('closing',footer);image(template.bottomFileId,'bottom');text('contact',contact);text('hashtags',tags.map(t=>'#'+t.replace(/^#+/,'')).join(' '));
  return blocks;
}
export const publishingImages = post => (post.blocks||[]).filter(b=>b.type==='image').map(b=>({id:b.fileId,sourceFileId:b.sourceFileId,role:b.role,blockId:b.id}));
export const postText = post => [post.title,...(post.blocks||[]).filter(b=>b.type!=='image').map(b=>b.text)].filter(Boolean).join('\n\n');
export function inspectPost(post) {
  const issues=[],add=(status,blockId,message)=>issues.push({status,blockId,message});
  for(const issue of post.fileIssues||[])add('needs_changes',issue.fileId,issue.message);
  if(!post.title?.trim())add('needs_changes','title','제목이 비어 있습니다.');
  const blocks=post.blocks||[],all=[{id:'title',text:post.title},{id:'cover',text:post.cover?.title},...blocks];
  const excluded=[...(post.brief?.exclude||'').split(/\n/),...(post.photos||[]).flatMap(p=>(p.exclude||'').split(/\n/))].map(s=>s.trim()).filter(Boolean);
  for(const b of all){
    if(/\{\{[^}]+\}\}|\bundefined\b|\bnull\b/.test(b.text||''))add('needs_changes',b.id,'미치환 변수 또는 빈 값이 남아 있습니다.');
    for(const phrase of excluded)if((b.text||'').includes(phrase))add('needs_changes',b.id,`제외 표현과 충돌: ${phrase}`);
    if(/합격\s*보장|100\s*%\s*합격|전국\s*1위/.test(b.text||''))add('needs_changes',b.id,'보장·순위 주장의 근거를 확인하세요.');
    if(/\d/.test(b.text||'')&&!['contact','hashtags'].includes(b.type))add('human_required',b.id,'숫자·날짜가 교육 예시인지 확인된 실제 사실인지 대조하세요.');
    if(b.type==='image'&&!b.fileId)add('needs_changes',b.id,'연결된 이미지가 없습니다.');
  }
  if(!blocks.some(b=>['lead','paragraph'].includes(b.type)&&b.text?.trim()))add('needs_changes','body','본문을 입력하세요.');
  for(const p of post.photos||[])if(p.kind==='teacher')add('human_required',p.fileId,'선생님 연구작을 학생 작품·성과로 소개하지 않았는지 확인하세요.');
  if(!post.privacyConfirmed)add('needs_changes','privacy','홍보 사용 권한·개인정보 노출을 확인하세요.');
  add('unchecked','meaning','제목의 약속·도입부의 답·사진 설명 일치는 내용 검토가 필요합니다.');
  return issues;
}
export function exportHtml(post,names=new Map()) {
  const escape=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const font=post.template?.font==='serif'?'serif':'sans-serif',align=post.template?.align==='center'?'center':'left',spacing=[16,24,32].includes(post.template?.spacing)?post.template.spacing:24;
  return '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(post.title)+`</title><style>body{font:17px/1.8 ${font};text-align:${align};max-width:760px;margin:24px auto;padding:16px;overflow-wrap:anywhere}img{max-width:100%;height:auto}figure,p{margin:${spacing}px 0}p{white-space:pre-wrap}</style><article><h1>`+escape(post.title)+'</h1>'+post.blocks.map(b=>b.type==='image'?`<figure><img alt="${escape(b.role)}" src="${escape(names.get(b.id)||'')}"></figure>`:b.type==='heading'?`<h2>${escape(b.text)}</h2>`:`<p>${escape(b.text)}</p>`).join('')+'</article></html>';
}
