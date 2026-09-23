import {LOGOS,normalizeDesign} from './instagram-brand-policy.js?v=20260923-logoup';
import {composeInstagram,drawLogo} from './instagram-layout.js?v=20260923-logoup';
import {assembleCaption,captionTail,replaceManagedTail,assertResolvedText} from './content-caption.js?v=20260922-presets';
import {normalizeTags} from './content-preset-catalog.js';
import {optimizeImageForAi} from './image-ai-optimize.js?v=20260923-imgfix';
import {Zip,ZipPassThrough} from './vendor/fflate-0.8.3.js';

const btnHtml=(id,label)=>`<button type="button" class="ghost-btn" id="${id}">${label}</button>`;

export function mountInstagramProduction({state,api,$,toast,canWrite,contact=()=>'',renderSelection=()=>{}}) {
  document.body.classList.add('instagram-carousel-mode');
  const command=$('aiCommand').closest('.workflow-section'),section=document.createElement('section');
  section.className='workflow-section ig-carousel';section.id='instagramProduction';
  section.innerHTML=`<div class="workflow-status-row"><span id="igTemplateSummary" role="status"></span>${btnHtml('igOpenTemplate','양식 수정')}</div>
    <div class="workflow-status-row"><span id="igPresetsSummary" role="status"></span>${btnHtml('igOpenPresets','마무리 수정')}</div>
    <dialog id="igTemplateDialog" class="workflow-dialog" aria-labelledby="igTemplateDialogTitle">
      <div class="workflow-heading"><h2 id="igTemplateDialogTitle">양식 수정</h2>${btnHtml('igCloseTemplate','닫기')}</div>
      <h3>로고 선택</h3><div id="igLogos" class="ig-logo-options" role="group" aria-label="공식 로고"></div>
      <h3>나만의 로고 선택</h3>
      <div id="igCustomLogos" class="ig-logo-options" role="group" aria-label="나만의 로고"></div>
      <div class="blog-actions">
        <input type="file" id="igLogoFile" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" hidden>
        ${btnHtml('igUploadLogo','로고 올리기')}
        <button type="button" class="ghost-btn hidden" id="igMoreLogos">더 보기</button>
      </div>
      <p id="igCustomLogoStatus" role="status"></p>
      <div class="ig-options"><label>제작 방식<select id="igMode"><option value="original">작품 전체 보존</option><option value="photo-layout">공간·학원 사진 크게 배치</option><option value="photo">사진 보정 · AI</option></select></label><span id="igCampusLabel" role="status"></span></div>
      <div class="blog-actions">${btnHtml('igApplyTemplate','이번 글에 적용')}${btnHtml('igSaveTemplate','캠퍼스 기본값으로 저장')}${btnHtml('igCancelTemplate','취소')}</div>
      <span id="igTemplateStatus" role="status"></span>
    </dialog>
    <p id="igSourceNotice" role="status" hidden></p>
    <div id="igResume" class="ig-resume" role="status" hidden><span id="igResumeText"></span><button type="button" id="igResumeGo" class="secondary-btn">이어서 하기</button><button type="button" id="igResumeDismiss" class="ghost-btn">닫기</button></div>
    <div class="form-actions"><button type="button" id="igGenerate" class="primary-btn" disabled>이미지 만들기</button><button type="button" id="igCancel" class="ghost-btn" hidden>중단</button><button type="button" id="igRetryFailed" class="ghost-btn" hidden>실패한 항목만 다시 시도</button></div>
    <div id="igProgressWrap" class="ig-progress" hidden><label for="igProgress">전체 단계 진행률 <output id="igPercent">0%</output></label><progress id="igProgress" max="100" value="0"></progress></div>
    <div id="igItemStatuses" class="ig-item-statuses" role="status" hidden></div>
    <p id="igStatus" role="status" aria-live="polite"></p>`;
  command.after(section);
  const result=document.createElement('section');result.className='workflow-section ig-carousel';result.id='igResult';result.hidden=true;
  result.innerHTML=`<h2>결과 미리보기</h2><div id="igSlides" class="ig-slide-tabs" aria-label="이미지 순서"></div><figure class="ig-preview"><img id="igPreview" alt="인스타 최종 이미지 미리보기" width="2160" height="2700"></figure>
    <div class="ig-result-actions"><button id="igComplete" type="button" class="primary-btn" disabled>완료 및 저장</button><span id="igSaved" role="status">저장 전</span></div>
    <div id="igDownloads" class="ig-download-actions"></div>
    <section id="igCaptionSection" hidden><h2>인스타 홍보용 글</h2><textarea id="igCaptionText" rows="8" maxlength="12000" aria-label="인스타 홍보용 글"></textarea><div class="form-actions"><button id="igCopy" type="button" class="secondary-btn">문구 복사</button><button id="igCaptionSave" type="button" class="ghost-btn">문구 저장</button><button id="igCaptionRetry" type="button" class="ghost-btn" hidden>홍보글 다시 작성</button></div><p id="igCaptionStatus" role="status"></p></section>`;
  section.after(result);
  const history=document.createElement('details');history.className='workflow-details';history.innerHTML='<summary>저장한 이미지 세트</summary><div id="igHistory"></div>';result.after(history);
  $('defaultHashtags').closest('label').querySelector('span').textContent='고정 해시태그';
  $('defaultFooter').closest('label').querySelector('span').textContent='고정 마지막 문구';
  $('defaultHashtags').placeholder='#학원소식 #수업기록';$('defaultFooter').placeholder='문의 안내 등 마지막에 넣을 문구';
  let logoType='anihi',policy=null,policyEpoch=0,generation=0,busy=false,items=[],currentSet=null,controller=null,selected='',signature='',requestId='',activeIndex=0;
  // ids: the full selection this batch was started for, in original order — slide/download numbering
  // and retry-only-failed both key off this fixed order, independent of completion order.
  let ids=[],failures=[],itemStatus=new Map();
  // batchInfo is written onto every draft of the batch (see processOne) so it can be resumed later.
  let batchInfo=null,restoredBatch=false;
  let campusDefaultLogoType='anihi',campusDefaultMode='original',templateSnapshot=null;
  let localPreview=null;
  let imageState='new',hasSaved=false;
  let captionBusy=false,captionEpoch=0,captionController=null;
  let managedTail=null;
  function captionLock(value){captionBusy=value;for(const id of ['igCaptionText','igCaptionSave','igCaptionRetry'])$(id).disabled=value;}
  const backgrounds=new Map();
  const previewUrl=item=>localPreview?.fileId===item.masterFileId?localPreview.url:'/api/data-core/files/'+encodeURIComponent(item.masterFileId);
  // After a partial failure `items` has gaps (1,3 done, 2 failed); label by the photo's original
  // selection number so buttons/slides/ZIP names match the 1번/2번/3번 status chips. Sets loaded from
  // history have no `ids`, and are always complete, so their array position is already correct.
  const slotNumber=(item,index)=>{const n=ids.indexOf(item.sourceId);return n>=0?n+1:index+1;};
  function releasePreview(){if(localPreview)URL.revokeObjectURL(localPreview.url);localPreview=null;}
  const originalMode=()=>$('igMode').value!=='photo';
  const sourceReason=id=>state.knownFiles?.get(String(id))?.instagramPreserveReason;
  // Old/incomplete metadata fails closed: preserve pixels until a fresh listing is available.
  const preserveSource=id=>sourceReason(id)!=='';
  const hasPreserved=()=>state.selectedFileIds.some(preserveSource);
  function progress(value,message){const percent=Math.max(0,Math.min(100,Math.floor(value)));$('igProgressWrap').hidden=false;$('igProgress').value=percent;$('igPercent').textContent=percent+'%';$('igStatus').textContent=message;}
  const read=()=>normalizeDesign({workflow:'carousel-v2',logoType,templateId:'academy',materialKind:$('igMode').value==='original'?'student-artwork':'real-photo',usePermission:'allowed',externalAiConsent:!originalMode()});
  const snapshot=()=>JSON.stringify([state.selectedFileIds,$('draftCampus').value,$('aiCommand').value,logoType,$('igMode').value]);
  const post=(path,body,signal)=>api('/api/data-core/content'+(path?'/'+path:''),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:signal||AbortSignal.timeout(150000)});
  // Sends the already browser-optimized working copy alongside the request body — same
  // multipart/form-data shape as blog's photo upload — instead of asking the server to re-read (and
  // hard-cap) the R2 original.
  const postWithPhoto=(path,body,photoId,blob,signal)=>{const form=new FormData();form.set('input',JSON.stringify(body));form.set('photo:'+photoId,blob,photoId+'.jpg');return api('/api/data-core/content'+(path?'/'+path:''),{method:'POST',body:form,signal:signal||AbortSignal.timeout(150000)});};
  function buttons(){ $('igGenerate').disabled=busy||!canWrite()||!state.selectedFileIds.length||!$('draftCampus').value;
    $('igComplete').disabled=busy||!items.length||items.length!==state.selectedFileIds.length||signature!==snapshot()||Boolean(currentSet);
    const saved=Boolean(currentSet);$('igComplete').innerHTML=saved?'<svg aria-hidden="true"><use href="/data-core/assets/core-icons.svg#Check"></use></svg>완료':imageState==='saving'?'저장 중…':imageState==='failed'?'다시 저장':hasSaved?'변경사항 저장':'완료 및 저장';
    $('igComplete').setAttribute('aria-busy',String(imageState==='saving'));
    const preserved=state.selectedFileIds.filter(preserveSource).length;
    $('igSourceNotice').hidden=!preserved;
    $('igSourceNotice').textContent=`선택 ${preserved}장은 학생작품·문서 등 원본 보존 대상으로, 외부 AI 전송 없이 제작합니다.`;
    $('igGenerate').textContent=originalMode()||preserved===state.selectedFileIds.length?'이미지 만들기':'AI로 이미지 만들기';$('igCancel').hidden=!busy||!controller;
    $('igRetryFailed').hidden=!failures.length;$('igRetryFailed').disabled=busy; }
  function lock(value){busy=value;state.busy=value;$('photoHeading').closest('.workflow-section').inert=value;command.inert=value;$('igLogos').inert=value;$('igMode').disabled=value;history.inert=value;result.querySelectorAll('button,textarea').forEach(el=>el.disabled=value);buttons();}
  function clear(keepBackgrounds=false){managedTail=null;captionEpoch++;captionController?.abort();captionLock(false);if(keepBackgrounds!==true)backgrounds.clear();releasePreview();generation++;items=[];currentSet=null;signature='';requestId='';imageState='new';ids=[];failures=[];itemStatus=new Map();batchInfo=null;restoredBatch=false;result.hidden=true;$('igProgressWrap').hidden=true;$('igProgress').value=0;$('igPercent').textContent='0%';$('igItemStatuses').hidden=true;$('igItemStatuses').replaceChildren();$('igPreview').removeAttribute('src');$('igSlides').replaceChildren();$('igDownloads').replaceChildren();$('igCaptionSection').hidden=true;$('igCaptionText').value='';$('igCaptionStatus').textContent='';$('igStatus').textContent=hasSaved?'변경사항 미저장':'';$('igSaved').textContent=hasSaved?'변경사항 미저장':'저장 전';$('igCaptionRetry').hidden=true;buttons();}
  async function logos(){
    const campusId=$('draftCampus').value;
    if(policy?.campusId===campusId&&$('igLogos').children.length===Object.keys(LOGOS).length)return;
    const epoch=++policyEpoch;policy=null;$('igLogos').replaceChildren();
    $('igCampusLabel').textContent=campusId?'로고를 불러오는 중...':'캠퍼스를 선택하세요.';
    if(!campusId){buttons();return;}
    try{
      const value=await api('/api/data-core/content/instagram-policy?campusId='+encodeURIComponent(campusId));if(epoch!==policyEpoch)return;policy=value;$('igCampusLabel').textContent=value.campusLogoLabel;
      for(const [id,spec]of Object.entries(LOGOS)){
        const button=document.createElement('button');button.type='button';button.className='ig-logo-choice';button.dataset.logo=id;button.setAttribute('aria-pressed',String(id===logoType));
        const canvas=document.createElement('canvas'),label=document.createElement('span');label.textContent=spec.label;button.append(canvas,label);$('igLogos').append(button);
        button.onclick=()=>{if(busy||logoType===id)return;logoType=id;clear(true);$('igLogos').querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.logo===id)));updateTemplateSummary();};
        if(id==='none'){canvas.replaceWith(Object.assign(document.createElement('span'),{className:'ig-no-logo',innerHTML:'<svg aria-hidden="true"><use href="/data-core/assets/core-icons.svg#Image"></use></svg>'}));button.title='로고 없이 이미지만 제작';continue;}
        void drawLogo(canvas,id,value.campusLogoLabel).catch(()=>{if(epoch===policyEpoch){canvas.replaceWith(Object.assign(document.createElement('img'),{src:spec.src,alt:spec.label}));button.title='로고 미리보기를 다시 불러오려면 캠퍼스를 다시 선택하세요.';}});
      }
      void loadCustomLogos(true);
    }catch(error){if(epoch===policyEpoch)$('igCampusLabel').textContent=error.message;}
    buttons();
  }
  // 나만의 로고: uploaded once per campus, selectable alongside the official marks above. Deleting one
  // only hides this row — it never touches an already-composited image (a separate, independent file).
  let customLogos=[],customLogosCursor=null,customLogosCampus='';
  function renderCustomLogo(item){
    const value='custom:'+item.id;
    const button=document.createElement('button');button.type='button';button.className='ig-logo-choice';button.dataset.logo=value;button.setAttribute('aria-pressed',String(value===logoType));
    const img=document.createElement('img');img.src='/api/data-core/files/'+encodeURIComponent(item.id);img.alt=item.name;img.loading='lazy';
    const label=document.createElement('span');label.textContent=item.name;
    const remove=document.createElement('span');remove.className='ig-logo-remove';remove.setAttribute('role','button');remove.tabIndex=0;remove.setAttribute('aria-label',item.name+' 삭제');
    remove.innerHTML='<svg aria-hidden="true"><use href="/data-core/assets/core-icons.svg#Trash2"></use></svg>';
    button.append(img,label,remove);
    const removeLogo=async(event)=>{
      event.stopPropagation();
      if(busy||!confirm(`'${item.name}' 로고를 삭제할까요? 이미 완성한 이미지에는 영향이 없습니다.`))return;
      try{
        await api('/api/data-core/content/instagram-logos/'+encodeURIComponent(item.id),{method:'DELETE'});
        customLogos=customLogos.filter(v=>v.id!==item.id);
        if(logoType===value){logoType=campusDefaultLogoType;clear(true);$('igLogos').querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.logo===logoType)));}
        renderCustomLogos();updateTemplateSummary();
      }catch(error){$('igCustomLogoStatus').textContent=error.message;}
    };
    remove.onclick=removeLogo;remove.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();removeLogo(event);}};
    button.onclick=event=>{
      if(event.target.closest('.ig-logo-remove')||busy||logoType===value)return;
      logoType=value;clear(true);
      $('igCustomLogos').querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.logo===value)));
      $('igLogos').querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed','false'));
      updateTemplateSummary();
    };
    return button;
  }
  function renderCustomLogos(){$('igCustomLogos').replaceChildren(...customLogos.map(renderCustomLogo));}
  async function loadCustomLogos(reset=false){
    const campusId=$('draftCampus').value;
    if(!campusId){customLogos=[];customLogosCursor=null;customLogosCampus='';renderCustomLogos();$('igMoreLogos').classList.add('hidden');return;}
    if(reset){customLogos=[];customLogosCursor=null;customLogosCampus=campusId;}
    else if(customLogosCampus!==campusId)return;
    try{
      const params=new URLSearchParams({campusId});if(customLogosCursor)params.set('cursor',customLogosCursor);
      const value=await api('/api/data-core/content/instagram-logos?'+params);
      if(customLogosCampus!==campusId)return;
      customLogos=reset?value.logos:[...customLogos,...value.logos];customLogosCursor=value.nextCursor;
      renderCustomLogos();$('igMoreLogos').classList.toggle('hidden',!customLogosCursor);
    }catch(error){$('igCustomLogoStatus').textContent=error.message;}
  }
  $('igMoreLogos').onclick=()=>void loadCustomLogos(false);
  $('igUploadLogo').onclick=()=>{if(!$('draftCampus').value){$('igCustomLogoStatus').textContent='캠퍼스를 먼저 선택하세요.';return;}$('igLogoFile').click();};
  // SVG never reaches the server: it is rendered by an <img> (no scripts, no external loads) onto a
  // transparent canvas here and uploaded as PNG, so storage and compositing only ever see raster pixels.
  async function rasterizeSvgLogo(file){
    if(file.size>1024*1024)throw Error('SVG 로고는 1MB 이하로 올려주세요.');
    const svg=new DOMParser().parseFromString(await file.text(),'image/svg+xml').documentElement;
    if(svg.nodeName!=='svg')throw Error('SVG 로고를 읽을 수 없습니다.');
    const box=(svg.getAttribute('viewBox')||'').trim().split(/[\s,]+/).map(Number);
    const size=name=>{const v=parseFloat(svg.getAttribute(name)||'');return /%/.test(svg.getAttribute(name)||'')?NaN:v;};
    let width=size('width'),height=size('height');
    if(!(width>0&&height>0)&&box.length===4&&box[2]>0&&box[3]>0){const ratio=box[2]/box[3];width=width>0?width:height>0?height*ratio:box[2];height=height>0?height:width/ratio;}
    if(!(width>0&&height>0))throw Error('SVG 로고에 크기(width·height 또는 viewBox)가 필요합니다.');
    const scale=2000/Math.max(width,height),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
    const url=URL.createObjectURL(new Blob([await file.arrayBuffer()],{type:'image/svg+xml'}));
    try{
      const image=new Image();
      await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('SVG 로고를 그릴 수 없습니다.'));image.src=url;});
      canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
      const blob=await new Promise((resolve,reject)=>{try{canvas.toBlob(b=>b?resolve(b):reject(Error('SVG 로고를 변환하지 못했습니다.')),'image/png');}catch{reject(Error('이 SVG는 안전하게 변환할 수 없습니다. PNG로 올려주세요.'));}});
      if(blob.size>5*1024*1024)throw Error('변환된 로고가 5MB를 넘습니다. 더 단순한 SVG나 PNG로 올려주세요.');
      return new File([blob],file.name.replace(/\.svg$/i,'')+'.png',{type:'image/png'});
    }finally{URL.revokeObjectURL(url);canvas.width=canvas.height=1;}
  }
  $('igLogoFile').onchange=async()=>{
    let file=$('igLogoFile').files[0];$('igLogoFile').value='';
    if(!file)return;
    const campusId=$('draftCampus').value;if(!campusId){$('igCustomLogoStatus').textContent='캠퍼스를 먼저 선택하세요.';return;}
    const isSvg=file.type==='image/svg+xml'||/\.svg$/i.test(file.name);
    if(!isSvg&&file.size>5*1024*1024){$('igCustomLogoStatus').textContent='로고 이미지는 5MB 이하로 올려주세요.';return;}
    const name=file.name.replace(/\.[^.]+$/,'');
    $('igUploadLogo').disabled=true;$('igCustomLogoStatus').textContent=isSvg?'SVG를 PNG로 변환하는 중...':'업로드 중...';
    try{
      if(isSvg){file=await rasterizeSvgLogo(file);$('igCustomLogoStatus').textContent='업로드 중...';}
      const form=new FormData();form.set('campusId',campusId);form.set('file',file);form.set('name',name);
      const value=await api('/api/data-core/content/instagram-logos',{method:'POST',body:form});
      customLogos=[value.logo,...customLogos];renderCustomLogos();$('igCustomLogoStatus').textContent='업로드 완료';
    }catch(error){$('igCustomLogoStatus').textContent=error.message;}
    finally{$('igUploadLogo').disabled=false;}
  };
  function preview(index=0){activeIndex=index;$('igPreview').src=previewUrl(items[index]);$('igSlides').replaceChildren(...items.map((item,i)=>{
    const button=document.createElement('button');button.type='button';button.setAttribute('aria-pressed',String(i===index));button.textContent=String(slotNumber(item,i));button.onclick=()=>preview(i);return button;
  }));result.hidden=false;}
  $('igPreview').onclick=()=>window.DataCoreImageGallery.open({scope:'instagram-set',title:'인스타 이미지',anchor:$('igPreview'),index:activeIndex,items:items.map((item,i)=>({src:previewUrl(item),title:`${slotNumber(item,i)} / ${ids.length||items.length}`}))});
  $('igMode').onchange=()=>{clear();updateTemplateSummary();};$('aiCommand').addEventListener('input',clear);
  $('igCancel').onclick=()=>controller?.abort();
  const currentDirection=()=>$('aiCommand').value.trim()||'선택한 원본을 인스타그램 4:5 규격으로 배치';
  function renderItemStatuses(){
    $('igItemStatuses').hidden=!ids.length;
    $('igItemStatuses').replaceChildren(...ids.map((id,i)=>{
      const st=itemStatus.get(id)||{status:'pending'};
      const span=document.createElement('span');span.className='ig-item-status ig-item-status-'+st.status;
      const label=st.status==='pending'?'대기':st.status==='processing'?(st.message||'처리 중'):st.status==='done'?'완료':`실패 · ${st.message||''}`;
      span.textContent=`${i+1}번 ${label}`;return span;
    }));
  }
  function updateOverallProgress(){
    const total=ids.length||1,settled=items.length+failures.length;
    progress(settled/total*100,`${settled}/${ids.length} 처리 · 완료 ${items.length}${failures.length?` · 실패 ${failures.length}`:''}`);
  }
  function renderSummary(){
    const total=ids.length,done=items.length,failed=failures.length;
    $('igStatus').textContent=failed===0?`${done}장 제작 완료`:`${total}장 중 ${done}장 완료 · ${failed}장 실패 — 실패한 항목만 다시 시도할 수 있습니다.`;
    $('igSaved').textContent=hasSaved?'변경사항 미저장':done?`${done}장 완료 · 완료된 사진은 아래에서 개별/일괄로 받을 수 있습니다.${failed?' 실패 항목은 다시 시도해주세요.':''}`:'저장 전';
    buttons();
  }
  // Lookups for 이어서 하기 / draft reuse: a missing or revoked item there just means 'not resumable',
  // so they must not go through api(), whose 401/403 handling wipes the whole page's private state.
  const quiet=async(url,signal)=>{const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal});if(!response.ok){const error=Error('HTTP '+response.status);error.status=response.status;throw error;}return response.json();};
  const designMatches=(a,b)=>Boolean(a&&b)&&a.workflow===b.workflow&&a.logoType===b.logoType&&a.materialKind===b.materialKind&&a.externalAiConsent===b.externalAiConsent;
  // One image's full pipeline (파일읽기→전처리→AI요청→합성→저장). Anything a failed attempt already paid
  // for — its draft, its AI-edited background — is attached to the thrown error as `partial` and handed
  // back through `prior` on retry, so a retry neither re-bills the AI nor leaves a second draft behind.
  async function processOne(id,{design,campusId,direction,policyValue,backgroundKeyFor,signal,aiLock,decodeLock,prior}){
    const preserve=preserveSource(id);
    const itemDesign=preserve?normalizeDesign({...design,materialKind:'student-artwork',externalAiConsent:false}):design;
    const step=message=>{itemStatus.set(id,{status:'processing',message});renderItemStatuses();};
    const partial={draftId:null,backgroundId:null};
    try{
      let reuse=null;
      if(prior?.draftId){
        try{
          const report=await quiet(`/api/data-core/content/instagram/${encodeURIComponent(prior.draftId)}/review`,signal);
          if(designMatches(report.design,itemDesign)){
            if(report.approved&&report.renderId&&report.masterFileId)return {blob:null,item:{sourceId:id,draftId:prior.draftId,renderId:report.renderId,fingerprint:report.fingerprint,masterFileId:report.masterFileId}};
            reuse={draftId:prior.draftId,fingerprint:report.fingerprint};partial.draftId=prior.draftId;
          }
        }catch(error){if(signal.aborted)throw error;}
      }
      let backgroundId=id;
      if(itemDesign.externalAiConsent){
        const key=backgroundKeyFor(id);
        if(!backgrounds.has(key)&&prior?.backgroundId)backgrounds.set(key,prior.backgroundId);
        if(backgrounds.has(key))backgroundId=backgrounds.get(key);
        else{
          const photoFile=state.knownFiles.get(String(id));
          if(!photoFile)throw Error('선택한 사진 정보를 확인할 수 없습니다. 사진을 다시 선택해주세요.');
          step('AI 사진 보정 · 사진 준비 대기');
          const optimized=await decodeLock(()=>{signal.throwIfAborted();step('AI 사진 보정 · 사진 준비 중');return optimizeImageForAi(photoFile);});
          step('AI 사진 보정 · 순서 대기');
          backgroundId=await aiLock(async()=>{
            signal.throwIfAborted();step('AI 사진 보정 · 응답 대기');
            // A slow photo times out on its own and becomes a failed item; only 중단 stops the batch.
            const itemController=new AbortController(),stop=()=>itemController.abort();
            signal.addEventListener('abort',stop,{once:true});const timer=setTimeout(stop,290000);
            try{return (await postWithPhoto('image-edit',{sourceApp:'instagram',campusId,sourceFileId:id,direction,material:itemDesign,requestId:crypto.randomUUID()},id,optimized,itemController.signal)).file.id;}
            catch(error){if(!signal.aborted&&itemController.signal.aborted)throw Error('AI 응답이 290초 안에 오지 않았습니다.');throw error;}
            finally{clearTimeout(timer);signal.removeEventListener('abort',stop);}
          });
          backgrounds.set(key,backgroundId);
        }
        partial.backgroundId=backgroundId;
      }
      step(preserve?'원본 보존·로고 합성 대기':'로고 합성 대기');
      const composing=decodeLock(()=>{signal.throwIfAborted();step(preserve?'원본 보존·로고 합성 중':'로고 합성 중');return composeInstagram('/api/data-core/files/'+encodeURIComponent(backgroundId),itemDesign,policyValue.campusLogoLabel,signal);});
      const drafting=reuse?Promise.resolve(reuse):(async()=>{
        const draft=(await post('',{sourceApp:'instagram',campusId,title:`인스타 이미지 ${ids.indexOf(id)+1}`,summary:direction,relatedFileIds:[id],
          metadata:{instagramDesign:itemDesign,instagramBatch:{...batchInfo,slot:ids.indexOf(id),backgroundFileId:backgroundId!==id?backgroundId:null}}},signal)).draft;
        partial.draftId=draft.id;
        return {draftId:draft.id,fingerprint:(await api(`/api/data-core/content/instagram/${draft.id}/review`,{signal})).fingerprint};
      })();
      // allSettled, not all: if composing fails, still learn the draft id so the retry can reuse it.
      const [composed,drafted]=await Promise.allSettled([composing,drafting]);
      if(composed.status==='rejected')throw composed.reason;
      if(drafted.status==='rejected')throw drafted.reason;
      signal.throwIfAborted();step('이미지 저장 중');
      const blob=composed.value,{draftId,fingerprint}=drafted.value;
      const form=new FormData();form.set('file',blob,'instagram-master.png');form.set('fingerprint',fingerprint);form.set('backgroundFileId',backgroundId);
      const saved=await api(`/api/data-core/content/instagram/${draftId}/render`,{method:'POST',body:form,signal});
      return {blob,item:{sourceId:id,draftId,renderId:saved.renderId,fingerprint:saved.fingerprint,masterFileId:saved.file.id}};
    }catch(error){
      if(error&&typeof error==='object')error.partial=partial;
      throw error;
    }
  }
  function recordFailure(id,message,partial,prior){
    const entry={id,message,draftId:partial?.draftId||prior?.draftId||null,backgroundId:partial?.backgroundId||prior?.backgroundId||null};
    itemStatus.set(id,{status:'failed',message});failures=[...failures.filter(f=>f.id!==id),entry];
    renderItemStatuses();updateOverallProgress();buttons();
  }
  // The server allows one in-flight AI request per user (withAiRequest answers 409 otherwise), and a
  // full-size decode plus a 2160×2700 canvas is what a low-memory tablet can afford at once. So two
  // photos move through the pipeline together — one waiting on the AI while the other composes or
  // uploads — but never two AI calls, and never two decodes, at the same time.
  const IG_CONCURRENCY=2;
  const serial=()=>{let tail=Promise.resolve();return task=>{const run=tail.then(task);tail=run.then(()=>{},()=>{});return run;};};
  async function runBatch(targetIds,context,epoch){
    const {signal}=context,queue=[...targetIds],job={...context,aiLock:serial(),decodeLock:serial()};
    const worker=async()=>{
      while(queue.length&&!signal.aborted&&epoch===generation){
        const id=queue.shift(),prior=failures.find(f=>f.id===id);
        itemStatus.set(id,{status:'processing',message:'준비 중'});renderItemStatuses();
        let outcome;
        try{outcome=await processOne(id,{...job,prior});}
        catch(error){
          if(epoch!==generation)return;
          if(signal.aborted){recordFailure(id,'중단됨',error?.partial,prior);return;}
          const stage=(itemStatus.get(id)?.message||'').replace(/ (중|대기)$/,'');
          recordFailure(id,stage?`${stage} 단계 오류 · ${error.message}`:error.message,error?.partial,prior);
          continue;
        }
        if(epoch!==generation)return;
        const {blob,item}=outcome;
        if(blob){releasePreview();localPreview={fileId:item.masterFileId,url:URL.createObjectURL(blob)};}
        items=[...items.filter(v=>v.sourceId!==id),item].sort((a,b)=>ids.indexOf(a.sourceId)-ids.indexOf(b.sourceId));
        itemStatus.set(id,{status:'done'});failures=failures.filter(f=>f.id!==id);
        renderItemStatuses();preview(items.findIndex(v=>v.sourceId===id));void downloads();updateOverallProgress();
      }
    };
    // Wait for every worker to actually stop before returning, so nothing lands after the UI unlocks.
    await Promise.allSettled(Array.from({length:Math.min(IG_CONCURRENCY,queue.length)},worker));
    if(epoch!==generation||!signal.aborted)return;
    for(const id of targetIds)if(!items.some(v=>v.sourceId===id)&&!failures.some(f=>f.id===id))recordFailure(id,'중단됨');
    throw new DOMException('작업을 중단했습니다.','AbortError');
  }
  $('igGenerate').onclick=async()=>{
    if(busy||!canWrite()||state.selectedFileIds.length<1||state.selectedFileIds.length>10)return;
    if(!originalMode()&&state.selectedFileIds.some(id=>!preserveSource(id))&&!$('aiCommand').value.trim())return toast('원하는 느낌을 입력해주세요.','error');
    const campusId=$('draftCampus').value,design=read(),direction=currentDirection(),selectionIds=[...state.selectedFileIds];
    const backgroundKeyFor=id=>JSON.stringify([campusId,id,direction,$('igMode').value]);
    const pending=selectionIds.filter(id=>!preserveSource(id)&&!backgrounds.has(backgroundKeyFor(id)));
    if(!originalMode()&&pending.length&&!confirm(`선택한 ${pending.length}장의 사진만 외부 AI에 전송합니다. 학생 작품·로고·성적 자료가 아니며 홍보 사용과 AI 처리 동의가 확인된 사진인가요?`))return;
    if((originalMode()||selectionIds.every(preserveSource))&&!confirm(`선택한 ${selectionIds.length}장의 홍보 사용 권한을 확인했나요? 원본을 보존하며, 홍보글 작성에는 사진 없이 입력한 방향만 AI에 전송합니다.`))return;
    clear(true);hideResume();ids=selectionIds;
    batchInfo={id:crypto.randomUUID(),sources:ids.map(id=>({id:String(id),folderId:state.knownFiles.get(String(id))?.folderId||null})),command:$('aiCommand').value,mode:$('igMode').value,logoType};
    requestId=batchInfo.id;signature=snapshot();const epoch=generation;controller=new AbortController();lock(true);
    progress(0,'준비 중...');renderItemStatuses();
    let stage='캠퍼스 확인';
    try{
      await logos();if(!policy||policy.campusId!==campusId)throw Error('캠퍼스 정보를 확인하세요.');
      stage='이미지 제작';
      await runBatch(ids,{design,campusId,direction,policyValue:policy,backgroundKeyFor,signal:controller.signal},epoch);
      if(epoch!==generation)return;
      renderSummary();
    }catch(error){
      if(epoch!==generation)return;
      $('igStatus').textContent=error.name==='AbortError'?'작업을 중단했습니다. 완료된 사진은 그대로 두고, 나머지는 "실패한 항목만 다시 시도"로 이어서 만들 수 있습니다.':`${stage}: ${error.message}`;
      if(items.length){$('igSaved').textContent=`${items.length}장 완료 · 완료된 사진은 아래에서 개별/일괄로 받을 수 있습니다. 나머지는 다시 시도해주세요.`;void downloads();}
      buttons();
    }finally{controller=null;lock(false);}
  };
  $('igRetryFailed').onclick=async()=>{
    if(busy||!failures.length)return;
    const retryIds=failures.map(f=>f.id),campusId=$('draftCampus').value,design=read(),direction=currentDirection();
    const backgroundKeyFor=id=>JSON.stringify([campusId,id,direction,$('igMode').value]);
    if(!campusId){$('igStatus').textContent='캠퍼스를 선택하세요.';return;}
    // A batch resumed after reloading was consented to in an earlier visit; ask again before any photo
    // that still has no AI result is sent out.
    const pending=retryIds.filter(id=>!preserveSource(id)&&!backgrounds.has(backgroundKeyFor(id))&&!failures.find(f=>f.id===id)?.backgroundId);
    if(restoredBatch&&!originalMode()&&pending.length&&!confirm(`다시 시도하는 ${pending.length}장의 사진을 외부 AI에 전송합니다. 학생 작품·로고·성적 자료가 아니며 홍보 사용과 AI 처리 동의가 확인된 사진인가요?`))return;
    const epoch=generation;controller=new AbortController();lock(true);updateOverallProgress();
    try{
      await logos();if(!policy||policy.campusId!==campusId)throw Error('캠퍼스 정보를 확인하세요.');
      await runBatch(retryIds,{design,campusId,direction,policyValue:policy,backgroundKeyFor,signal:controller.signal},epoch);
      if(epoch!==generation)return;
      renderSummary();
    }catch(error){
      if(epoch!==generation)return;
      $('igStatus').textContent=error.name==='AbortError'?'작업을 중단했습니다. 완료된 사진은 그대로 두고, 나머지는 "실패한 항목만 다시 시도"로 이어서 만들 수 있습니다.':`재시도 실패: ${error.message}`;
      buttons();
    }finally{controller=null;lock(false);}
  };
  // 이어서 하기: every photo's draft carries its batch (id, slot, sources, settings), so a batch left
  // unsaved — by a reload, a closed tab, or another device — can be picked up again from the server:
  // finished photos come back as-is and only the rest need to be made.
  let resumeCandidate=null,resumeEpoch=0;
  const dismissKey=()=>'hi5:ig-batch-dismissed:'+(state.context?.user?.internalUserId||'');
  function dismissedBatches(){try{const v=JSON.parse(localStorage.getItem(dismissKey())||'[]');return Array.isArray(v)?v:[];}catch{return [];}}
  function hideResume(){resumeEpoch++;resumeCandidate=null;$('igResume').hidden=true;}
  async function findResumable(){
    hideResume();const epoch=resumeEpoch,campusId=$('draftCampus').value,me=state.context?.user?.internalUserId;
    if(!campusId||!me||!canWrite()||busy||items.length||currentSet)return;
    try{
      const listing=async query=>((await quiet('/api/data-core/content?'+new URLSearchParams({sourceApp:'instagram',campusId,...query}))).drafts||[]).filter(d=>d.createdByUserId===me&&d.metadata?.instagramBatch?.id);
      const latest=(await listing({limit:'20'})).find(d=>Date.parse(d.createdAt)>Date.now()-7*864e5);
      if(!latest||epoch!==resumeEpoch)return;
      const batch=latest.metadata.instagramBatch;
      if(typeof batch.id!=='string'||!/^[0-9a-f-]{36}$/i.test(batch.id)||dismissedBatches().includes(batch.id))return;
      try{await quiet('/api/data-core/content/instagram-sets/'+encodeURIComponent(`instagram-set:${me}:${batch.id}`));return;}
      catch(error){if(error.status!==404)return;}
      const sources=(Array.isArray(batch.sources)?batch.sources:[]).filter(s=>s&&typeof s.id==='string').slice(0,10);
      if(!sources.length||epoch!==resumeEpoch)return;
      const slots=sources.map(()=>null);
      const drafts=(await listing({limit:'40',q:batch.id})).filter(d=>d.metadata.instagramBatch.id===batch.id).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
      for(const draft of drafts){
        const slot=draft.metadata.instagramBatch.slot;
        if(!Number.isInteger(slot)||slot<0||slot>=sources.length||String(draft.metadata.relatedFileIds?.[0])!==sources[slot].id||slots[slot]?.item)continue;
        let report;try{report=await quiet(`/api/data-core/content/instagram/${encodeURIComponent(draft.id)}/review`);}catch{continue;}
        if(report.approved&&report.renderId&&report.masterFileId)slots[slot]={item:{sourceId:sources[slot].id,draftId:draft.id,renderId:report.renderId,fingerprint:report.fingerprint,masterFileId:report.masterFileId}};
        else if(!slots[slot])slots[slot]={draftId:draft.id,backgroundId:draft.metadata.instagramBatch.backgroundFileId||null};
      }
      const done=slots.filter(s=>s?.item).length;
      if(!done||epoch!==resumeEpoch||busy||items.length||currentSet||campusId!==$('draftCampus').value)return;
      resumeCandidate={batch,sources,slots,campusId};
      const when=new Date(latest.createdAt).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
      $('igResumeText').textContent=`${when}에 만들던 이미지 세트가 저장되지 않았습니다 · ${sources.length}장 중 ${done}장 완료`;
      $('igResume').hidden=false;
    }catch{/* 이어서 하기 is a convenience; a failed lookup just means no banner */}
  }
  $('igResumeDismiss').onclick=()=>{
    const id=resumeCandidate?.batch.id;
    if(id){try{localStorage.setItem(dismissKey(),JSON.stringify([id,...dismissedBatches().filter(v=>v!==id)].slice(0,30)));}catch{/* per-browser convenience only */}}
    hideResume();
  };
  $('igResumeGo').onclick=async()=>{
    const candidate=resumeCandidate;
    if(!candidate||busy)return;
    if(candidate.campusId!==$('draftCampus').value)return hideResume();
    lock(true);$('igResumeText').textContent='이전 작업을 불러오는 중...';
    try{
      // Photo details come from the same library listing the picker uses (folder protection included),
      // never from stored draft data, so 원본 보존 / AI eligibility is decided exactly as for a fresh pick.
      const unavailable=new Set();
      for(const source of candidate.sources){
        if(state.knownFiles.has(source.id))continue;
        if(!source.folderId){unavailable.add(source.id);continue;}
        try{
          const view=await quiet('/api/data-core/library/files?'+new URLSearchParams({folderId:source.folderId,focusId:source.id,page:'1'}));
          const file=(view.files||[]).find(f=>String(f.id)===source.id);
          if(file)state.knownFiles.set(source.id,file);else unavailable.add(source.id);
        }catch{unavailable.add(source.id);}
      }
      const b=candidate.batch;
      clear(true);
      if(typeof b.logoType==='string')logoType=normalizeDesign({workflow:'carousel-v2',logoType:b.logoType}).logoType;
      if(['original','photo-layout','photo'].includes(b.mode))$('igMode').value=b.mode;
      if(typeof b.command==='string')$('aiCommand').value=b.command;
      for(const grid of [$('igLogos'),$('igCustomLogos')])grid.querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.logo===logoType)));
      updateTemplateSummary();
      state.selectedFileIds=candidate.sources.map(s=>s.id);selected=JSON.stringify(state.selectedFileIds);renderSelection();
      ids=[...state.selectedFileIds];restoredBatch=true;
      batchInfo={id:b.id,sources:candidate.sources,command:$('aiCommand').value,mode:$('igMode').value,logoType};
      requestId=b.id;signature=snapshot();
      items=candidate.slots.map(s=>s?.item).filter(Boolean);
      failures=candidate.sources.flatMap((s,i)=>candidate.slots[i]?.item?[]:[{id:s.id,
        message:unavailable.has(s.id)?'원본 사진을 다시 찾을 수 없습니다(이동·삭제·권한 변경). 선택에서 빼고 다시 만들어주세요.':'이전 작업에서 완료되지 않았습니다.',
        draftId:candidate.slots[i]?.draftId||null,backgroundId:candidate.slots[i]?.backgroundId||null}]);
      itemStatus=new Map([...items.map(v=>[v.sourceId,{status:'done'}]),...failures.map(f=>[f.id,{status:'failed',message:f.message}])]);
      renderItemStatuses();updateOverallProgress();if(items.length)preview(0);await downloads();renderSummary();
      hideResume();
    }catch(error){$('igResumeText').textContent=error.message;}
    finally{lock(false);}
  };
  async function exportItemBlob(item,slot){
    const response=await fetch(`/api/data-core/content/instagram/${item.draftId}/export`,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({renderId:item.renderId,fingerprint:item.fingerprint})});
    if(!response.ok)throw Error(`${slot}번: ${(await response.json()).error||'다운로드하지 못했습니다.'}`);
    return response.blob();
  }
  async function downloadZip(button){
    if(!items.length)return;
    const originalText=button.textContent;button.disabled=true;
    const snapshotItems=[...items],slots=snapshotItems.map(slotNumber);
    const chunks=[];let zipError;
    const zip=new Zip((error,data)=>{if(error)zipError=error;else chunks.push(data);});
    try{
      for(let i=0;i<snapshotItems.length;i++){
        button.textContent=`압축 준비 중 ${i+1}/${snapshotItems.length}`;
        const blob=await exportItemBlob(snapshotItems[i],slots[i]);
        const entry=new ZipPassThrough(`instagram-${slots[i]}-1080x1350.png`);zip.add(entry);entry.push(new Uint8Array(await blob.arrayBuffer()),true);
        if(zipError)throw zipError;
      }
      zip.end();if(zipError)throw zipError;
      const blob=new Blob(chunks,{type:'application/zip'}),url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download=`instagram-완료이미지-${snapshotItems.length}장.zip`;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
    }catch(error){toast(error.message,'error');}
    finally{zip.terminate();chunks.length=0;button.disabled=false;button.textContent=originalText;}
  }
  async function downloads(){
    const children=[];
    if(items.length>1){
      const incomplete=ids.length>items.length?ids.length-items.length:0;
      const zipBtn=document.createElement('button');zipBtn.type='button';zipBtn.className='secondary-btn';
      zipBtn.innerHTML=`<svg aria-hidden="true"><use href="/data-core/assets/core-icons.svg#Download"></use></svg>완료된 이미지 ${items.length}장 ZIP 다운로드${incomplete>0?` (미완료 ${incomplete}장 제외)`:''}`;
      zipBtn.onclick=()=>downloadZip(zipBtn);
      children.push(zipBtn);
    }
    children.push(...items.map((item,index)=>{
      const slot=slotNumber(item,index);
      const button=document.createElement('button');let downloading=false;button.className='secondary-btn';button.type='button';button.innerHTML=`<svg aria-hidden="true"><use href="/data-core/assets/core-icons.svg#Download"></use></svg>${slot}번 이미지 다운로드`;
      button.onclick=async()=>{if(downloading)return;downloading=true;button.disabled=true;try{
        const response=await fetch(`/api/data-core/content/instagram/${item.draftId}/export`,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({renderId:item.renderId,fingerprint:item.fingerprint})});
        if(!response.ok)throw Error((await response.json()).error||'다운로드하지 못했습니다.');
        const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=`instagram-${slot}-1080x1350.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
      }catch(error){toast(error.message,'error');}finally{downloading=false;button.disabled=false;}};return button;
    }));
    $('igDownloads').replaceChildren(...children);
  }
  async function caption(){
    if(!currentSet||busy||captionBusy)return;
    const target=currentSet,epoch=++captionEpoch,design=read(),textOnly=originalMode()||hasPreserved(),ids=[...state.selectedFileIds],direction=$('aiCommand').value.trim(),label=policy.campusLogoLabel,footer=$('defaultFooter').value,hashtags=$('defaultHashtags').value,contactBlock=contact();
    const valid=()=>epoch===captionEpoch&&currentSet?.id===target.id;
    const abort=new AbortController();captionController=abort;captionLock(true);
    $('igCaptionSection').hidden=false;$('igCaptionRetry').hidden=true;$('igCaptionStatus').textContent='홍보글을 작성하고 있습니다...';
    try{
      let body='',title='',tags=[];
      const batches=textOnly?[ids]:[ids.slice(0,5),ids.slice(5)].filter(ids=>ids.length);
      for(const ids of batches){
          const payload={sourceApp:'instagram',campusId:target.campusId,selectedFileIds:ids,textOnly,notes:`${direction}\n${label}. ${textOnly?'사진은 제공하지 않았습니다. 사용자가 명시한 내용만 사용하세요.':'사진에서 확인 가능한 내용만 사용하세요.'} 제목형 도입과 본문 ${batches.length>1?'3':'3~6'}문장으로 작성하고 전화번호·날짜·실적은 만들지 마세요.`,material:design,requestId:crypto.randomUUID()};
          let generated;
          if(textOnly)generated=(await post('generate',payload,abort.signal)).generated;
          else{
            // Like the image edit: send browser-optimized copies, so an oversized original can't 413 the caption.
            const form=new FormData();form.set('input',JSON.stringify(body));
            for(const id of ids){const blob=await optimizeImageForAi(state.knownFiles.get(String(id))||{id});if(!valid())return;form.set('photo:'+id,blob,id+'.jpg');}
            generated=(await api('/api/data-core/content/generate',{method:'POST',body:form,signal:abort.signal})).generated;
          }
          if(!valid())return;
          title ||= generated.title;body += (body?'\n':'')+(generated.body||generated.content||'');tags.push(...(generated.hashtags||generated.keywords||[]));
      }
      if(!valid())return;
      managedTail=captionTail(footer,hashtags,tags,contactBlock);
      $('igCaptionText').value=assembleCaption([title,body].filter(Boolean).join('\n\n'),footer,hashtags,tags,contactBlock);
      $('igCaptionStatus').textContent='홍보글 저장 중…';
      await saveCaption(target.id,$('igCaptionText').value,abort.signal);
      if(valid())target.caption=$('igCaptionText').value;
      if(valid())$('igCaptionStatus').textContent=textOnly?'사진 전송 없이 작성 완료 · 게시 전에 내용을 확인하세요.':'홍보글 작성 완료 · 게시 전에 내용을 확인하세요.';
    }catch{if(valid()){$('igCaptionStatus').textContent='이미지 저장은 완료되었습니다. 홍보글은 작성하지 못했습니다. 다시 작성하거나 직접 입력할 수 있습니다.';$('igCaptionRetry').hidden=false;}}
    finally{if(valid()){captionController=null;captionLock(false);}}
  }
  async function saveCaption(id,text,signal){assertResolvedText(text);await api('/api/data-core/content/instagram-sets/'+encodeURIComponent(id),{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({caption:text,managedTail}),signal});}
  $('igComplete').onclick=async()=>{
    if(busy||currentSet||signature!==snapshot()||items.length!==state.selectedFileIds.length)return;
    imageState='saving';lock(true);$('igSaved').textContent='저장 중…';let completed=false;
    try{currentSet=await post('instagram-sets',{requestId,items:items.map(({draftId,renderId,fingerprint})=>({draftId,renderId,fingerprint}))});hasSaved=true;imageState='saved';$('igSaved').textContent='저장 완료';await downloads();completed=true;}
    catch(error){imageState='failed';$('igSaved').textContent='저장 실패 · '+error.message;}finally{lock(false);}
    if(completed)await caption();
  };
  $('igCopy').onclick=async()=>{try{assertResolvedText($('igCaptionText').value);}catch(error){toast(error.message,'error');return;}try{await navigator.clipboard.writeText($('igCaptionText').value);toast('복사했습니다.');}catch{toast('클립보드 권한을 확인해주세요.','error');}};
  $('igCaptionText').addEventListener('input',()=>{$('igCaptionStatus').textContent='문구 변경사항 미저장';});
  $('igCaptionSave').onclick=async()=>{if(busy||captionBusy||!currentSet)return;const target=currentSet.id,epoch=captionEpoch,text=$('igCaptionText').value;captionLock(true);try{await saveCaption(target,text);if(epoch===captionEpoch){$('igCaptionStatus').textContent='문구 저장 완료';currentSet.caption=text;}}catch(error){if(epoch===captionEpoch)$('igCaptionStatus').textContent=error.message;}finally{if(epoch===captionEpoch)captionLock(false);}};
  $('igCaptionRetry').onclick=caption;
  async function loadHistory(){
    if(!history.open||!$('draftCampus').value)return;
    const campusId=$('draftCampus').value;$('igHistory').textContent='불러오는 중...';
    try{const data=await api('/api/data-core/content/instagram-sets?campusId='+encodeURIComponent(campusId));if(campusId!==$('draftCampus').value||!history.open)return;$('igHistory').replaceChildren(...data.sets.map(item=>{
      const button=document.createElement('button');button.type='button';button.className='ghost-btn';button.textContent=`${item.title} · ${item.createdAt.slice(0,10)}`;
      button.onclick=async()=>{if(busy)return;lock(true);try{const saved=await api('/api/data-core/content/instagram-sets/'+encodeURIComponent(item.id));clear();hideResume();currentSet=saved;managedTail=saved.managedTail??null;items=saved.items;preview();await downloads();$('igSaved').textContent='저장된 최종본';$('igCaptionText').value=saved.caption;$('igCaptionSection').hidden=false;}catch(error){toast(error.message,'error');}finally{lock(false);}};return button;
    }));if(!data.sets.length)$('igHistory').textContent='저장된 이미지 세트가 없습니다.';}catch(error){if(campusId===$('draftCampus').value)$('igHistory').textContent=error.message;}
  }
  history.ontoggle=loadHistory;
  function refresh(){void logos();void loadHistory();buttons();void findResumable();}
  function applyText({footer,hashtags,contact}){
    if(captionBusy||busy)throw Error('진행 중 작업이 끝난 후 적용하세요.');
    if($('igCaptionSection').hidden)throw Error('저장된 이미지 세트의 홍보글을 먼저 열어주세요.');
    const tail=captionTail(footer,hashtags,[],contact);
    if(managedTail===null&&!confirm('기존 글의 문구 경계를 확인할 수 없습니다. 현재 본문을 유지하고 마지막에 새 문구·태그를 추가할까요?'))throw Error('현재 결과를 유지했습니다.');
    $('igCaptionText').value=replaceManagedTail($('igCaptionText').value,managedTail,tail);managedTail=tail;$('igCaptionStatus').textContent='문구 변경사항 미저장';
  }
  // 양식 수정 dialog: logo/제작방식 already apply live via the click/change handlers above (that is
  // what "이번 글에 적용" means here — nothing further to do but close). 취소 restores the snapshot
  // taken when the dialog opened, so a change made and abandoned mid-dialog never lingers.
  function readTemplate(){return {logoType,mode:$('igMode').value};}
  function updateTemplateSummary(){$('igTemplateSummary').textContent=logoType===campusDefaultLogoType&&$('igMode').value===campusDefaultMode?'캠퍼스 기본 양식 적용 중':'양식 적용됨';}
  $('igOpenTemplate').onclick=()=>{templateSnapshot=readTemplate();$('igTemplateStatus').textContent='';$('igTemplateDialog').showModal();};
  $('igApplyTemplate').onclick=()=>{updateTemplateSummary();templateSnapshot=null;$('igTemplateDialog').close();};
  $('igCloseTemplate').onclick=$('igCancelTemplate').onclick=()=>{
    if(templateSnapshot&&(templateSnapshot.logoType!==logoType||templateSnapshot.mode!==$('igMode').value)){
      logoType=templateSnapshot.logoType;$('igLogos').querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.logo===logoType)));
      $('igMode').value=templateSnapshot.mode;clear(true);updateTemplateSummary();
    }
    templateSnapshot=null;$('igTemplateDialog').close();
  };
  $('igSaveTemplate').onclick=async()=>{
    const campusId=$('draftCampus').value;
    if(!campusId){$('igTemplateStatus').textContent='캠퍼스를 먼저 선택하세요.';return;}
    $('igSaveTemplate').disabled=true;
    try{
      await api('/api/data-core/content/defaults',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({sourceApp:'instagram',campusId,hashtags:$('defaultHashtags').value,footer:$('defaultFooter').value,instagramSettings:{logoType,mode:$('igMode').value}})});
      campusDefaultLogoType=logoType;campusDefaultMode=$('igMode').value;updateTemplateSummary();
      $('igTemplateStatus').textContent='캠퍼스 기본 양식 저장 완료';
    }catch(error){$('igTemplateStatus').textContent=error.message;}
    finally{$('igSaveTemplate').disabled=false;}
  };
  // 마무리 수정 dialog: the hashtag/closing preset picker (mountTextPresets) is mounted separately in
  // content.js and exposes its own dialog; this button only needs to open it.
  $('igOpenPresets').onclick=()=>window.dispatchEvent(new CustomEvent('open-text-presets'));
  function updatePresetsSummary(){
    const count=normalizeTags($('defaultHashtags').value).length,footer=$('defaultFooter').value.trim();
    $('igPresetsSummary').textContent=`해시태그 ${count}개 · 마지막 문구 ${footer?'적용':'미설정'} · 상담 정보 ${contact()?'포함':'미포함'}`;
  }
  for(const id of ['defaultHashtags','defaultFooter'])$(id).addEventListener('input',updatePresetsSummary);
  window.addEventListener('text-presets-changed',updatePresetsSummary);
  updateTemplateSummary();updatePresetsSummary();
  return {read,refresh,applyText,hasUnsaved:()=>Boolean(busy||(!currentSet&&(items.length||$('aiCommand').value.trim()))||(currentSet&&$('igCaptionText').value!==(currentSet.caption||''))),invalidated:clear,load:()=>{if(!busy)clear();},selectionChanged(){const key=JSON.stringify(state.selectedFileIds);if(key!==selected){selected=key;clear();}buttons();},restore:async()=>{toast('이전 단일 초안입니다. 사진을 선택해 새 이미지 세트로 제작하세요.');},
    applyDefaults(settings){if(!settings)return;campusDefaultLogoType=settings.logoType;campusDefaultMode=settings.mode;if(templateSnapshot)return;logoType=settings.logoType;$('igMode').value=settings.mode;for(const grid of [$('igLogos'),$('igCustomLogos')])grid.querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.logo===logoType)));updateTemplateSummary();}};
}
