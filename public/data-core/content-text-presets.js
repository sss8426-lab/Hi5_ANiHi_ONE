import {BRANDS,COURSES} from './content-preset-catalog.js';
import {captionTail} from './content-caption.js?v=20260922-presets';

const titles={hashtags:'해시태그',closing:'마지막 문구'};
const element=(tag,text,attrs={})=>Object.assign(document.createElement(tag),{textContent:text,...attrs});
const button=(text,run)=>{const el=element('button',text,{type:'button'});el.onclick=run;return el;};
const icon=(name,label,run)=>{
 const el=button('',run);el.className='preset-icon';el.title=label;el.setAttribute('aria-label',label);
 el.innerHTML=`<svg aria-hidden="true"><use href="/data-core/assets/core-icons.svg#${name}"></use></svg>`;return el;
};
export function mountTextPresets({api,state,$,applyResult}) {
 let scope='',epoch=0,controller,data=null,dialog=null,busy=false;
 const chosen={hashtags:null,closing:null},inputs={hashtags:$('defaultHashtags'),closing:$('defaultFooter')},mounts={};
 const status=element('p','',{className:'preset-status'});status.setAttribute('role','status');
 const toolbar=element('div','',{className:'preset-toolbar'}),brand=element('select','');brand.setAttribute('aria-label','게시물 대상 브랜드');
 // Post-level brand choice is independent of the campus's official operating-brand profile (which
 // starts empty for most campuses) — these three options must always be selectable, never derived
 // from data.profile.brands, or the dropdown is empty until a campus admin fills in 캠퍼스 추천 설정.
 const POST_BRANDS=[['hi5','Hi5'],['anihi','ANiHi'],['combined','Hi5·ANiHi']];
 let statusOwnedByBlock=false;
 const contact=element('input','',{type:'checkbox'}),contactLabel=element('label','확인된 연락처 포함 ');contactLabel.prepend(contact);
 const profileButton=button('캠퍼스 추천 설정',()=>editProfile());
 const apply=button('현재 결과에 적용',()=>{
  try{captionTail(inputs.closing.value,inputs.hashtags.value);
   applyResult({footer:inputs.closing.value,hashtags:inputs.hashtags.value,contact:contact.checked?data?.contactBlock||'':''});
   status.textContent='현재 결과에 적용했습니다. 게시물 저장은 별도입니다.';
  }catch(error){status.textContent=error.message;}
 });
 toolbar.append(brand,contactLabel,profileButton,apply);
 $('saveDefaults').textContent='현재 값을 기본값으로 저장';
 for(const kind of Object.keys(inputs)){
  const input=inputs[kind],label=input.closest('label'),column=element('div','',{className:'preset-column'});
  label.before(column);column.append(label);
  label.querySelector('span').textContent=kind==='hashtags'?'고정 해시태그':'고정 마지막 문구';
  const selected=element('small','',{className:'preset-selected'}),list=element('div','',{className:'preset-buttons'}),actions=element('div','',{className:'preset-actions'});
  const add=button('+ 새 저장',()=>edit(kind)),all=button('전체 보기',()=>browse(kind)),trash=button('삭제한 세트',()=>browse(kind,true));
  actions.append(add,all,trash);column.append(selected,list,actions);mounts[kind]={selected,list,add,all,trash};
  input.addEventListener('input',()=>selection(kind));
 }
 // Both apps move the whole picker into a "마무리 수정" dialog, opened by a status-row button that
 // each app-specific module (blog-workflow.js / instagram-carousel.js) places in its own layout via
 // a window event, since the two modules mount independently of this one.
 const grid=document.querySelector('.defaults-grid'),actionsBar=grid.nextElementSibling;
 const presetsDialog=element('dialog','',{className:'workflow-dialog'});presetsDialog.setAttribute('aria-labelledby','textPresetsDialogTitle');
 const heading=element('div','',{className:'workflow-heading'});heading.append(element('h2','마무리 수정',{id:'textPresetsDialogTitle'}),button('닫기',()=>presetsDialog.close()));
 presetsDialog.append(heading,grid,actionsBar,toolbar,status);document.body.append(presetsDialog);
 window.addEventListener('open-text-presets',()=>presetsDialog.showModal());
 brand.onchange=()=>{for(const k of Object.keys(chosen))chosen[k]=null;render();};
 contact.onchange=()=>{status.textContent=contact.checked?(data?.contactBlock||'등록된 연락처가 없습니다.') :'';window.dispatchEvent(new CustomEvent('text-presets-changed'));};
 function close(){if(dialog){dialog.close();dialog.remove();dialog=null;}}
 function modal(title){close();const opened=element('dialog','',{className:'preset-dialog'});dialog=opened;const h=element('h2',title),content=element('div','');opened.append(h,content,button('닫기',close));document.body.append(opened);opened.addEventListener('close',()=>{opened.remove();if(dialog===opened)dialog=null;},{once:true});opened.showModal();return content;}
 function scopeInput(){return {campusId:$('draftCampus').value,sourceApp:state.sourceApp};}
 function usageKey(){return 'hi5:preset-use:'+state.context?.user?.internalUserId+':'+scope;}
 function counts(){try{return JSON.parse(localStorage.getItem(usageKey())||'{}');}catch{return {};}}
 function selection(kind){
  const item=data?.presets.find(i=>i.id===chosen[kind]);mounts[kind].selected.textContent=item?item.name+(inputs[kind].value!==item.content?' · 수정됨':' · 선택됨'):'';
  mounts[kind].list.querySelectorAll('[data-preset]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.preset===chosen[kind])));
 }
 function options(kind,deleted=false){
  const used=counts();return (data?.presets||[]).filter(i=>i.kind===kind&&Boolean(i.deletedAt)===deleted&&(!brand.value||['common','unconfirmed',brand.value].includes(i.brandScope)))
   .sort((a,b)=>Number(b.favorite)-Number(a.favorite)||(used[b.id]||0)-(used[a.id]||0)||Number(Boolean(a.unavailable))-Number(Boolean(b.unavailable))||a.name.localeCompare(b.name,'ko-KR',{numeric:true}));
 }
 function use(item){
  if(!brand.value&&data.profile.brands.length>1&&item.brandScope!=='common'){status.textContent='게시물 대상 브랜드를 먼저 선택하세요.';return;}
  if(item.unavailable){status.textContent=item.unavailable;return;}
  if(item.notice&&!confirm(item.notice+'\n이 게시물에 해당하는 내용인가요?'))return;
  inputs[item.kind].value=item.content;chosen[item.kind]=item.id;inputs[item.kind].dispatchEvent(new Event('input',{bubbles:true}));
  const used=counts();used[item.id]=(used[item.id]||0)+1;try{localStorage.setItem(usageKey(),JSON.stringify(used));}catch{ /* optional local ordering */ }
  close();render();
 }
 function row(item,deleted=false){
  const group=element('div','',{className:'preset-item'}),load=button((item.favorite?'★ ':'')+item.name,()=>use(item));load.dataset.preset=item.id;load.setAttribute('aria-pressed',String(chosen[item.kind]===item.id));load.disabled=Boolean(item.unavailable)||deleted;load.title=item.unavailable||item.notice||item.content;group.append(load);
  load.setAttribute('aria-label',item.name);group.append(icon('Menu',item.name+' 메뉴',()=>menu(item)));return group;
 }
 function render(){
  // The sort in options() always puts any usable item before unavailable ones, so every item in the
  // default two-slot view being unavailable means there is truly nothing usable to load yet — never
  // just an unlucky top-2 pick. Surface that once, in the shared status line below, instead of a
  // duplicate per-column banner (previously repeated above both 해시태그 and 마지막 문구).
  let blockedReason='';
  for(const kind of Object.keys(inputs)){
   const top=options(kind).slice(0,2);
   mounts[kind].list.replaceChildren(...top.map(item=>row(item)));selection(kind);
   mounts[kind].add.disabled=!data||busy;mounts[kind].all.disabled=!data;mounts[kind].trash.disabled=!data;
   if(!blockedReason&&top.length>0&&top.every(item=>item.unavailable))blockedReason=top[0].unavailable;
  }
  profileButton.hidden=!data?.canManageShared;apply.disabled=!data;contact.disabled=!data?.contactBlock;
  if(blockedReason){
   status.replaceChildren(blockedReason+'. ');
   status.append(data?.canManageShared?button('캠퍼스 추천 설정',()=>editProfile()):document.createTextNode('캠퍼스 관리자에게 브랜드·과정 설정을 요청해주세요.'));
   statusOwnedByBlock=true;
  } else if(statusOwnedByBlock){
   status.textContent='';statusOwnedByBlock=false;
  }
  // Loading/clearing can flip the contact checkbox without a change event; keep summaries in step.
  window.dispatchEvent(new CustomEvent('text-presets-changed'));
 }
 function receive(value){data=value;for(const k of Object.keys(chosen))if(data.presets.find(i=>i.id===chosen[k])?.deletedAt)chosen[k]=null;render();}
 async function send(payload){
  if(busy)throw Error('저장 중입니다.');const token=epoch,origin=scopeInput();busy=true;render();
  try{const value=await api('/api/data-core/content/text-presets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...origin,...payload})});if(token!==epoch)return false;receive(value);status.textContent='저장했습니다.';return true;}
  catch(error){if(token===epoch)status.textContent=error.message;throw error;}
  finally{if(token===epoch){busy=false;render();}}
 }
 function menu(item){
  const box=modal(item.name),info=element('p',item.unavailable||item.notice||'');box.append(info);
  const run=async(action,extra={})=>{try{if(await send({action,presetId:item.id,revision:item.revision,...extra}))close();}catch(error){info.textContent=error.message;}};
  if(item.deletedAt){const restore=button('복원',()=>run('restore'));restore.disabled=!item.canEdit;box.append(restore);return;}
  const editButton=button('이름·내용 수정',()=>edit(item.kind,item));editButton.disabled=!item.canEdit;
  const duplicate=button('복제',()=>edit(item.kind,{...item,name:item.name+' 복사본'},true));duplicate.disabled=Boolean(item.unavailable);
  box.append(editButton,duplicate,button(item.favorite?'즐겨찾기 해제':'즐겨찾기',()=>run('favorite',{favorite:!item.favorite})));
  const remove=button('삭제',()=>{if(confirm(`‘${item.name}’ ${titles[item.kind]} 세트를 삭제할까요?\n현재 입력 내용과 이미 저장한 게시물은 유지됩니다.`))void run('delete');});remove.disabled=!item.canEdit;box.append(remove);
 }
 function field(box,label,value,area=false){const wrap=element('label',label),input=element(area?'textarea':'input','',{value:value||''});if(area)input.rows=5;wrap.append(input);box.append(wrap);return input;}
 function edit(kind,item=null,duplicate=false){
  const box=modal(item&&!duplicate?'세트 수정':'새 '+titles[kind]+' 세트'),form=element('form','');box.append(form);
  const name=field(form,'이름',item?.name),content=field(form,'내용',item?.content??inputs[kind].value,true),category=field(form,'분류',item?.category);
  name.maxLength=60;name.required=true;content.required=true;content.maxLength=kind==='hashtags'?2000:3000;
  const fav=element('input','',{type:'checkbox',checked:Boolean(item?.favorite)}),favLabel=element('label','즐겨찾기');favLabel.prepend(fav);form.append(favLabel);
  const shared=element('input','',{type:'checkbox',checked:!duplicate&&Boolean(item&&!item.ownerUserId)}),sharedLabel=element('label','캠퍼스 공유');sharedLabel.prepend(shared);sharedLabel.hidden=!data.canManageShared;shared.disabled=Boolean(item&&!duplicate);form.append(sharedLabel);
  const message=element('p','');message.setAttribute('role','status');const save=element('button','저장',{type:'submit'});form.append(message,save);
  const requestId=crypto.randomUUID(),token=epoch;
  form.onsubmit=async(event)=>{event.preventDefault();if(token!==epoch)return;save.disabled=true;
   try{const ok=await send({action:item&&!duplicate?'update':'create',presetId:item?.id,revision:item?.revision,requestId,kind,name:name.value,content:content.value,category:category.value,favorite:fav.checked,shared:shared.checked,brandScope:item?.brandScope||brand.value||'common'});
    if(ok)close();
   }catch(error){message.textContent=error.message;if(error.status===409){const refresh=button('최신 세트 다시 불러오기',()=>{close();void load(true);});message.append(refresh);}}finally{save.disabled=false;}
  };
 }
 function browse(kind,deleted=false){
  const box=modal(deleted?'삭제한 '+titles[kind]+' 세트':titles[kind]+' 전체 보기'),search=element('input','',{type:'search',placeholder:'이름 검색'});search.setAttribute('aria-label','세트 이름 검색');
  const category=element('select','');category.setAttribute('aria-label','세트 분류');for(const v of ['',...new Set(options(kind,deleted).map(i=>i.category).filter(Boolean))])category.append(element('option',v||'전체 분류',{value:v}));
  const list=element('div','',{className:'preset-all'});box.append(search,category,list);
  const refresh=()=>{list.replaceChildren(...options(kind,deleted).filter(i=>i.name.includes(search.value)&&(!category.value||category.value===i.category)).map(i=>row(i,deleted)));if(!list.childElementCount)list.textContent='세트가 없습니다.';};search.oninput=refresh;category.onchange=refresh;refresh();
 }
 function editProfile(){
  const box=modal('캠퍼스 추천 설정'),form=element('form',''),profile=data.profile,checks={},names={},courseChecks={};box.append(form);
  form.append(element('p','실제 운영하는 브랜드·과정과 확인된 연락처만 저장하세요. 지역: '+(data.region||'확인 필요')));
  for(const [key,value]of Object.entries(BRANDS)){
   const check=element('input','',{type:'checkbox',checked:profile.brands.includes(key)}),label=element('label',value.label);label.prepend(check);form.append(label);checks[key]=check;names[key]=field(form,value.label+' 실제 학원명',profile.names[key]);
  }
  for(const [key,value]of Object.entries(COURSES)){const check=element('input','',{type:'checkbox',checked:profile.courses.includes(key)}),label=element('label',value);label.prepend(check);form.append(label);courseChecks[key]=check;}
  const phone=field(form,'확인된 상담전화',profile.phone),address=field(form,'확인된 주소',profile.address),link=field(form,'확인된 상담 링크 (https)',profile.link),message=element('p',''),save=element('button','설정 저장',{type:'submit'});
  const revision=data.revision;form.append(message,save);form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{if(await send({action:'profile',revision,profile:{brands:Object.keys(checks).filter(k=>checks[k].checked),names:Object.fromEntries(Object.keys(names).map(k=>[k,names[k].value])),courses:Object.keys(courseChecks).filter(k=>courseChecks[k].checked),phone:phone.value,address:address.value,link:link.value}})){close();brandOptions();}}catch(error){message.textContent=error.message;}finally{save.disabled=false;}};
 }
 function brandOptions(){const previous=brand.value;brand.replaceChildren(element('option','게시물 브랜드 선택',{value:''}),...POST_BRANDS.map(([key,label])=>element('option',label,{value:key})));brand.value=POST_BRANDS.some(([key])=>key===previous)?previous:'';render();}
 async function load(force=false){
  const next=JSON.stringify(scopeInput());if(next===scope&&!force)return;
  scope=next;const token=++epoch;controller?.abort();controller=new AbortController();close();data=null;busy=false;chosen.hashtags=null;chosen.closing=null;contact.checked=false;status.replaceChildren();render();
  if(!$('draftCampus').value)return;
  try{const value=await api('/api/data-core/content/text-presets?'+new URLSearchParams(scopeInput()),{signal:controller.signal});if(token!==epoch)return;receive(value);brandOptions();}
  catch(error){if(token===epoch&&error.name!=='AbortError'){status.textContent=error.message;status.append(button('세트 다시 불러오기',()=>void load(true)));}}
 }
 return {load,contact:()=>contact.checked?data?.contactBlock||'':'',clear(){epoch++;controller?.abort();data=null;scope='';busy=false;close();for(const k of Object.keys(chosen))chosen[k]=null;brand.replaceChildren();contact.checked=false;status.textContent='';render();}};
}
