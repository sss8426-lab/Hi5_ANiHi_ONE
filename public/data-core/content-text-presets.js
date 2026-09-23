import {contactLines,assertResolvedText,hashtagLine} from './content-caption.js?v=20260924-order';

// Main-screen 문구 설정 (blog and Instagram alike): 인사말 · 고정 해시태그 · 고정 마지막 문구, each with
// its own [Hi5] [ANiHi] choice, its brand's own text and saved sets, then 상담전화·주소 and three links.
// Nothing here calls the AI; [설정 저장] stores it per organization + campus + channel.
const KINDS=[['greeting','인사말','defaultGreeting',3000],['hashtags','고정 해시태그','defaultHashtags',2000],['closing','고정 마지막 문구','defaultFooter',3000]];
const BRAND_KEYS=[['hi5','Hi5'],['anihi','ANiHi']];
const SET_TITLES={greeting:'인사말',hashtags:'해시태그',closing:'마지막 문구'};
const CONTACT_INPUTS=[['phone','상담전화','settingPhone',60,'contact'],['address','주소','settingAddress',300,'contact'],
  ['trialLink','체험수업 링크 (https)','settingTrialLink',500,'link'],['homeLink','홈페이지 링크 (https)','settingHomeLink',500,'link'],['instaLink','인스타 링크 (https)','settingInstaLink',500,'link']];
export const defaultBrand=campusId=>campusId==='campus-design-admission'?'hi5':'anihi';
export function emptySettings(brand='anihi'){
  return {brands:{greeting:brand,hashtags:brand,closing:brand},values:Object.fromEntries(KINDS.map(([kind])=>[kind,{hi5:'',anihi:''}])),contact:{phone:'',address:'',trialLink:'',homeLink:'',instaLink:''}};
}
export function validLink(value){if(!value)return true;try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}}
// Whatever a stored (or older) value holds, the screen works with exactly this shape.
export function normalizeSettings(value,brand='anihi'){
  const base=emptySettings(brand),input=value&&typeof value==='object'?value:{};
  for(const [kind] of KINDS){
    if(['hi5','anihi'].includes(input.brands?.[kind]))base.brands[kind]=input.brands[kind];
    for(const [key] of BRAND_KEYS){const text=input.values?.[kind]?.[key];if(typeof text==='string')base.values[kind][key]=text;}
  }
  for(const [key] of CONTACT_INPUTS){const text=input.contact?.[key];if(typeof text==='string')base.contact[key]=text;}
  return base;
}
const element=(tag,text,attrs={})=>Object.assign(document.createElement(tag),{textContent:text,...attrs});
const button=(text,run,className='')=>{const el=element('button',text,{type:'button',className});el.onclick=run;return el;};
const icon=(name,label,run)=>{
  const el=button('',run,'preset-icon');el.title=label;el.setAttribute('aria-label',label);
  el.innerHTML=`<svg aria-hidden="true"><use href="/data-core/assets/core-icons.svg#${name}"></use></svg>`;return el;
};
export function mountTextPresets({api,state,$,mount,extraSettings=()=>({}),onSaved=()=>{}}) {
  let scope='',epoch=0,controller,data=null,dialog=null,busy=false,saving=false;
  let settings=emptySettings(),savedSnapshot=JSON.stringify(settings),storedSettings=false;
  // What the user changed since the current settings request started ("values.hashtags.hi5", "brands.closing", "contact.phone").
  const touched=new Set();
  const chosen=Object.fromEntries(KINDS.map(([kind])=>[kind,null])),columns={},contactInputs={};
  const root=element('div','',{className:'text-settings'});
  const grid=element('div','',{className:'text-columns'});
  for(const [kind,title,id,max] of KINDS){
    const column=element('div','',{className:'text-column'});column.dataset.kind=kind;
    const head=element('div','',{className:'text-column-head'}),label=element('label',title,{htmlFor:id,className:'text-column-title'});
    const toggle=element('div','',{className:'brand-toggle'});toggle.setAttribute('role','group');toggle.setAttribute('aria-label',title+' 브랜드');
    for(const [brand,name] of BRAND_KEYS){const chip=button(name,()=>pickBrand(kind,brand),'brand-chip');chip.dataset.brand=brand;toggle.append(chip);}
    head.append(label,toggle);
    const input=element('textarea','',{id,rows:3,maxLength:max});
    input.addEventListener('input',()=>{settings.values[kind][settings.brands[kind]]=input.value;touched.add(`values.${kind}.${settings.brands[kind]}`);edited();selection(kind);});
    const list=element('div','',{className:'preset-buttons'}),actions=element('div','',{className:'preset-actions'});
    const add=button('+ 새 저장',()=>edit(kind)),all=button('전체 보기',()=>browse(kind)),trash=button('삭제한 세트',()=>browse(kind,true));
    actions.append(add,all,trash);
    const note=element('p','',{className:'preset-status'});note.setAttribute('role','status');
    column.append(head,input,list,actions,note);grid.append(column);
    columns[kind]={column,input,toggle,list,add,all,trash,note};
  }
  const contactRow=element('div','',{className:'settings-row settings-contact'}),linkRow=element('div','',{className:'settings-row settings-links'});
  for(const [key,title,id,max,group] of CONTACT_INPUTS){
    const label=element('label','',{className:'settings-field'}),span=element('span',title),input=element('input','',{id,maxLength:max,type:group==='link'?'url':key==='phone'?'tel':'text'});
    if(group==='link')input.placeholder='https://';
    input.addEventListener('input',()=>{settings.contact[key]=input.value.trim();touched.add('contact.'+key);edited();linkNote();});
    label.append(span,input);(group==='link'?linkRow:contactRow).append(label);contactInputs[key]=input;
  }
  const actions=element('div','',{className:'settings-actions'}),status=element('span','',{id:'defaultsStatus'});status.setAttribute('role','status');
  const saveButton=button('설정 저장',()=>void save(),'secondary-btn');saveButton.id='saveDefaults';
  actions.append(status,saveButton);root.append(grid,contactRow,linkRow,actions);mount.append(root);

  function edited(){status.textContent=dirty()?'설정 변경사항 미저장':'';window.dispatchEvent(new CustomEvent('text-presets-changed'));}
  function dirty(){return JSON.stringify(settings)!==savedSnapshot;}
  function badLinks(){return CONTACT_INPUTS.filter(([key,,,,group])=>group==='link'&&!validLink(settings.contact[key])).map(([,title])=>title.replace(' (https)',''));}
  function linkNote(){const bad=badLinks();for(const [key,,,,group] of CONTACT_INPUTS)if(group==='link')contactInputs[key].setAttribute('aria-invalid',String(!validLink(settings.contact[key])));if(bad.length)status.textContent=`${bad.join('·')}는 https:// 로 시작하는 주소만 사용할 수 있습니다.`;}
  function pickBrand(kind,brand){
    if(settings.brands[kind]===brand)return;
    // The other brand's text (saved or still being typed) stays in memory; nothing is copied across.
    settings.brands[kind]=brand;touched.add('brands.'+kind);chosen[kind]=null;edited();show(kind);
  }
  function show(kind){
    const c=columns[kind],brand=settings.brands[kind],name=BRAND_KEYS.find(([key])=>key===brand)[1];
    c.input.value=settings.values[kind][brand];c.input.setAttribute('aria-label',`${KINDS.find(([k])=>k===kind)[1]} (${name})`);
    c.toggle.querySelectorAll('[data-brand]').forEach(chip=>chip.setAttribute('aria-pressed',String(chip.dataset.brand===brand)));
    renderSets(kind);
  }
  function showAll(){for(const [kind] of KINDS)show(kind);for(const [key] of CONTACT_INPUTS)contactInputs[key].value=settings.contact[key];linkNote();}
  // ── saved sets ──
  function close(){if(dialog){dialog.close();dialog.remove();dialog=null;}}
  function modal(title){close();const opened=element('dialog','',{className:'preset-dialog'});dialog=opened;const h=element('h2',title),content=element('div','');opened.append(h,content,button('닫기',close));document.body.append(opened);opened.addEventListener('close',()=>{opened.remove();if(dialog===opened)dialog=null;},{once:true});opened.showModal();return content;}
  function scopeInput(){return {campusId:$('draftCampus').value,sourceApp:state.sourceApp};}
  function usageKey(){return 'hi5:preset-use:'+state.context?.user?.internalUserId+':'+scope;}
  function counts(){try{return JSON.parse(localStorage.getItem(usageKey())||'{}');}catch{return {};}}
  // A set belongs to one brand; sets saved before brands were per-area (no brand) show under both.
  const forBrand=(item,brand)=>item.brandScope===brand||!['hi5','anihi'].includes(item.brandScope);
  function options(kind,deleted=false,brand=settings.brands[kind]){
    const used=counts();return (data?.presets||[]).filter(i=>i.kind===kind&&Boolean(i.deletedAt)===deleted&&forBrand(i,brand))
      .sort((a,b)=>Number(b.favorite)-Number(a.favorite)||(used[b.id]||0)-(used[a.id]||0)||a.name.localeCompare(b.name,'ko-KR',{numeric:true}));
  }
  function selection(kind){
    const c=columns[kind],item=data?.presets.find(i=>i.id===chosen[kind]);
    c.list.querySelectorAll('[data-preset]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.preset===chosen[kind]&&item&&c.input.value===item.content)));
  }
  function use(item){
    // Loading a set changes only its own box — never the other two, the body, photos or logos.
    if(item.notice&&!confirm(item.notice+'\n이 게시물에 해당하는 내용인가요?'))return;
    const kind=item.kind,c=columns[kind];c.input.value=item.content;settings.values[kind][settings.brands[kind]]=item.content;touched.add(`values.${kind}.${settings.brands[kind]}`);chosen[kind]=item.id;
    const used=counts();used[item.id]=(used[item.id]||0)+1;try{localStorage.setItem(usageKey(),JSON.stringify(used));}catch{/* optional local ordering */}
    close();edited();renderSets(kind);
  }
  function row(item,deleted=false){
    const group=element('div','',{className:'preset-item'}),load=button((item.favorite?'★ ':'')+item.name,()=>use(item));
    load.dataset.preset=item.id;load.disabled=deleted;load.title=item.notice||item.content;load.setAttribute('aria-label',item.name);
    group.append(load,icon('Menu',item.name+' 메뉴',()=>menu(item)));return group;
  }
  function renderSets(kind){
    const c=columns[kind];
    c.list.replaceChildren(...options(kind).slice(0,2).map(item=>row(item)));
    if(data&&!c.list.childElementCount)c.list.append(element('p','저장한 세트가 없습니다.',{className:'preset-empty'}));
    for(const b of [c.add,c.all,c.trash])b.disabled=!data||busy;
    selection(kind);
  }
  function receive(value){data=value;for(const [kind] of KINDS)if(data.presets.find(i=>i.id===chosen[kind])?.deletedAt)chosen[kind]=null;for(const [kind] of KINDS){columns[kind].note.textContent='';renderSets(kind);}}
  async function send(payload,kind){
    if(busy)throw Error('저장 중입니다.');const token=epoch,origin=scopeInput();busy=true;for(const [k] of KINDS)renderSets(k);
    try{const value=await api('/api/data-core/content/text-presets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...origin,...payload})});if(token!==epoch)return false;receive(value);if(kind)columns[kind].note.textContent='세트를 저장했습니다.';return true;}
    catch(error){if(token===epoch&&kind)columns[kind].note.textContent=error.message;throw error;}
    finally{if(token===epoch){busy=false;for(const [k] of KINDS)renderSets(k);}}
  }
  function menu(item){
    const box=modal(item.name),info=element('p',item.notice||'');box.append(info);
    const run=async(action,extra={})=>{try{if(await send({action,presetId:item.id,revision:item.revision,...extra},item.kind))close();}catch(error){info.textContent=error.message;}};
    if(item.deletedAt){const restore=button('복원',()=>run('restore'));restore.disabled=!item.canEdit;box.append(restore);return;}
    const editButton=button('이름·내용 수정',()=>edit(item.kind,item));editButton.disabled=!item.canEdit;
    const duplicate=button('복제',()=>edit(item.kind,{...item,name:item.name+' 복사본'},true));
    box.append(editButton,duplicate,button(item.favorite?'즐겨찾기 해제':'즐겨찾기',()=>run('favorite',{favorite:!item.favorite})));
    const remove=button('삭제',()=>{if(confirm(`‘${item.name}’ ${SET_TITLES[item.kind]} 세트를 삭제할까요?\n현재 입력 내용과 이미 저장한 게시물은 유지됩니다.`))void run('delete');});remove.disabled=!item.canEdit;box.append(remove);
  }
  function field(box,label,value,area=false){const wrap=element('label',label),input=element(area?'textarea':'input','',{value:value||''});if(area)input.rows=5;wrap.append(input);box.append(wrap);return input;}
  function edit(kind,item=null,duplicate=false){
    const brand=item&&!duplicate?item.brandScope:settings.brands[kind],brandName=BRAND_KEYS.find(([key])=>key===brand)?.[1];
    const box=modal((item&&!duplicate?'세트 수정':'새 '+SET_TITLES[kind]+' 세트')+(brandName?` · ${brandName}`:'')),form=element('form','');box.append(form);
    const name=field(form,'이름',item?.name),content=field(form,'내용',item?.content??columns[kind].input.value,true),category=field(form,'분류',item?.category);
    name.maxLength=60;name.required=true;content.required=true;content.maxLength=kind==='hashtags'?2000:3000;
    const fav=element('input','',{type:'checkbox',checked:Boolean(item?.favorite)}),favLabel=element('label','즐겨찾기');favLabel.prepend(fav);form.append(favLabel);
    const shared=element('input','',{type:'checkbox',checked:!duplicate&&Boolean(item&&!item.ownerUserId)}),sharedLabel=element('label','캠퍼스 공유');sharedLabel.prepend(shared);sharedLabel.hidden=!data.canManageShared;shared.disabled=Boolean(item&&!duplicate);form.append(sharedLabel);
    const message=element('p','');message.setAttribute('role','status');const save=element('button','저장',{type:'submit'});form.append(message,save);
    const requestId=crypto.randomUUID(),token=epoch;
    form.onsubmit=async(event)=>{event.preventDefault();if(token!==epoch)return;save.disabled=true;
      try{const ok=await send({action:item&&!duplicate?'update':'create',presetId:item?.id,revision:item?.revision,requestId,kind,name:name.value,content:content.value,category:category.value,favorite:fav.checked,shared:shared.checked,brandScope:brand},kind);
        if(ok)close();
      }catch(error){message.textContent=error.message;if(error.status===409){const refresh=button('최신 세트 다시 불러오기',()=>{close();void load(true);});message.append(refresh);}}finally{save.disabled=false;}
    };
  }
  function browse(kind,deleted=false){
    const brandName=BRAND_KEYS.find(([key])=>key===settings.brands[kind])[1];
    const box=modal((deleted?'삭제한 '+SET_TITLES[kind]+' 세트':SET_TITLES[kind]+' 전체 보기')+` · ${brandName}`),search=element('input','',{type:'search',placeholder:'이름 검색'});search.setAttribute('aria-label','세트 이름 검색');
    const category=element('select','');category.setAttribute('aria-label','세트 분류');for(const v of ['',...new Set(options(kind,deleted).map(i=>i.category).filter(Boolean))])category.append(element('option',v||'전체 분류',{value:v}));
    const list=element('div','',{className:'preset-all'});box.append(search,category,list);
    const refresh=()=>{list.replaceChildren(...options(kind,deleted).filter(i=>i.name.includes(search.value)&&(!category.value||category.value===i.category)).map(i=>row(i,deleted)));if(!list.childElementCount)list.textContent='세트가 없습니다.';};search.oninput=refresh;category.onchange=refresh;refresh();
  }
  async function load(force=false){
    const next=JSON.stringify(scopeInput());if(next===scope&&!force)return;
    scope=next;const token=++epoch;controller?.abort();controller=new AbortController();close();data=null;busy=false;for(const [kind] of KINDS){chosen[kind]=null;columns[kind].note.textContent='';renderSets(kind);}
    if(!$('draftCampus').value){for(const [kind] of KINDS)columns[kind].note.textContent='캠퍼스를 고르면 저장한 세트를 쓸 수 있습니다. 직접 입력은 지금도 됩니다.';return;}
    try{const value=await api('/api/data-core/content/text-presets?'+new URLSearchParams(scopeInput()),{signal:controller.signal});if(token!==epoch)return;receive(value);}
    catch(error){if(token===epoch&&error.name!=='AbortError')for(const [kind] of KINDS){columns[kind].note.replaceChildren(error.message+' 직접 입력은 가능합니다. ');columns[kind].note.append(button('세트 다시 불러오기',()=>void load(true)));}}
  }
  // ── settings (per organization + campus + channel) ──
  let loadToken=0;
  function beginDefaults(){touched.clear();return ++loadToken;}
  // A late response never replaces what was typed (or which brand was picked) after it was requested:
  // those fields keep the typed value and simply show as unsaved; every other field takes the stored one.
  function applyDefaults(defaults,token){
    if(token!==undefined&&token!==loadToken)return;
    const campusId=$('draftCampus').value,brand=defaultBrand(campusId);
    storedSettings=Boolean(defaults?.textSettings);
    let loaded;
    if(storedSettings)loaded=normalizeSettings(defaults.textSettings,brand);
    else{
      // First time on the new screen: the previously saved fixed text becomes the default brand's text.
      loaded=emptySettings(brand);
      loaded.values.hashtags[brand]=String(defaults?.hashtags||'');loaded.values.closing[brand]=String(defaults?.footer||'');
      loaded.values.greeting[brand]=String(defaults?.blogSettings?.template?.greeting||'');
    }
    const snapshot=JSON.stringify(loaded);
    for(const key of touched){const [group,a,b]=key.split('.');if(group==='values')loaded.values[a][b]=settings.values[a][b];else loaded[group][a]=settings[group][a];}
    settings=loaded;savedSnapshot=snapshot;status.textContent=dirty()?'설정 변경사항 미저장':'';showAll();window.dispatchEvent(new CustomEvent('text-presets-changed'));
  }
  function values(){
    const pick=kind=>settings.values[kind][settings.brands[kind]];
    return {greeting:pick('greeting'),hashtags:pick('hashtags'),closing:pick('closing'),contact:{...settings.contact},contactText:contactLines(settings.contact),brand:settings.brands.greeting,brands:{...settings.brands}};
  }
  async function save(){
    if(saving)return false;
    const bad=badLinks();if(bad.length){linkNote();return false;}
    const current=values();
    try{assertResolvedText(current.greeting,current.closing,current.hashtags,current.contactText);hashtagLine(current.hashtags);}catch(error){status.textContent=error.message;return false;}
    const submitted=JSON.stringify(settings),token=epoch;saving=true;saveButton.disabled=true;status.textContent='저장 중…';
    try{
      await api('/api/data-core/content/defaults',{method:'PUT',headers:{'content-type':'application/json'},
        body:JSON.stringify({sourceApp:state.sourceApp,campusId:$('draftCampus').value||null,hashtags:current.hashtags,footer:current.closing,textSettings:JSON.parse(submitted),...extraSettings()})});
      if(token!==epoch)return false;
      savedSnapshot=submitted;storedSettings=true;status.textContent=dirty()?'저장했습니다 · 이후 변경사항 미저장':'설정을 저장했습니다.';
      onSaved(values());return true;
    }catch(error){if(token===epoch)status.textContent='저장하지 못했습니다 · '+error.message+' 입력한 내용은 그대로 있습니다.';return false;}
    finally{saving=false;saveButton.disabled=false;}
  }
  function clear(){epoch++;controller?.abort();data=null;scope='';busy=false;close();settings=emptySettings(defaultBrand($('draftCampus').value));savedSnapshot=JSON.stringify(settings);touched.clear();loadToken++;for(const [kind] of KINDS)chosen[kind]=null;status.textContent='';showAll();}
  showAll();
  return {load,clear,beginDefaults,applyDefaults,values,save,dirty,
    contact:()=>contactLines(settings.contact)};
}
