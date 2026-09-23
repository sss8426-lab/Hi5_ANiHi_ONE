import {LOGOS,CUSTOM_LOGO_PATTERN,normalizeDesign} from './instagram-brand-policy.js?v=20260923-logoup';
import {composeInstagram,composeBase,drawLayers,loadLayerAssets,defaultLayerBox,drawLogo,MASTER,USER_LAYER_LIMIT} from './instagram-layout.js?v=20260924-layers';
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
      <p class="ig-custom-hint">직접 올린 로고·문구·말풍선 이미지는 위의 공식 로고와 별도로 사진 위에 얹힙니다. 고른 이미지는 이번에 만드는 모든 사진에 들어가고, 결과 미리보기의 "사용자 이미지 편집"에서 위치·크기를 바꿀 수 있습니다.</p>
      <div class="ig-custom-tools">
        <input type="search" id="igCustomSearch" placeholder="이미지 이름 검색" maxlength="60" aria-label="나만의 로고 이름 검색">
        <input type="file" id="igLogoFile" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" hidden>
        ${btnHtml('igUploadLogo','이미지 올리기')}
      </div>
      <div id="igCustomLogos" class="ig-logo-options ig-custom-options" role="group" aria-label="나만의 로고"></div>
      <p id="igCustomEmpty" class="ig-custom-empty" hidden>등록된 이미지가 없습니다.</p>
      <button type="button" class="ghost-btn hidden" id="igMoreLogos">더 보기</button>
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
  result.innerHTML=`<h2>결과 미리보기</h2><div id="igSlides" class="ig-slide-tabs" aria-label="이미지 순서"></div><figure class="ig-preview"><img id="igPreview" alt="인스타 최종 이미지 미리보기" width="2160" height="2700"><canvas id="igLayerCanvas" class="ig-layer-canvas" tabindex="0" aria-label="사용자 이미지 배치 편집. 이미지를 끌어 옮기고, 모서리 점을 끌어 크기를 바꿉니다. 방향키로 선택한 이미지를 옮길 수 있습니다." hidden></canvas></figure>
    <div class="ig-layer-tools"><button id="igLayerEdit" type="button" class="secondary-btn">사용자 이미지 편집</button><span id="igLayerSummary" role="status"></span></div>
    <div id="igLayerEditor" class="ig-layer-editor" hidden>
      <p class="ig-layer-hint">아래에서 이미지를 눌러 현재 사진에 넣고, 사진 위에서 끌어 옮기거나 오른쪽 아래 모서리 점을 끌어 크기를 바꿉니다(비율 유지).</p>
      <div id="igLayerAssets" class="ig-layer-assets" role="group" aria-label="넣을 수 있는 나만의 이미지"></div>
      <p id="igLayerAssetsEmpty" class="ig-custom-empty" hidden>등록된 이미지가 없습니다. <button type="button" id="igLayerManage" class="ghost-btn">양식 수정에서 이미지 올리기</button></p>
      <div id="igLayerSelected" class="ig-layer-selected" hidden><span id="igLayerSelectedName"></span><button type="button" id="igLayerForward" class="ghost-btn">앞으로</button><button type="button" id="igLayerBackward" class="ghost-btn">뒤로</button><button type="button" id="igLayerRemove" class="ghost-btn">이 이미지 빼기</button></div>
      <fieldset class="ig-layer-scope"><legend>적용 범위</legend><label><input type="radio" name="igLayerScope" value="current" checked> 현재 사진만</label><label><input type="radio" name="igLayerScope" value="all"> 완성된 모든 사진</label></fieldset>
      <div class="form-actions"><button type="button" id="igLayerApply" class="primary-btn">적용</button><button type="button" id="igLayerCancel" class="ghost-btn">취소</button></div>
      <p id="igLayerStatus" role="status" aria-live="polite"></p>
    </div>
    <div class="ig-result-actions"><button id="igComplete" type="button" class="primary-btn" disabled>완료 및 저장</button><span id="igSaved" role="status">저장 전</span></div>
    <div id="igDownloads" class="ig-download-actions"></div>
    <section id="igCaptionSection" hidden><h2>인스타 홍보용 글 <span id="igCaptionState" class="ig-caption-state" data-state="none">작성 전</span></h2><textarea id="igCaptionText" rows="8" maxlength="12000" aria-label="인스타 홍보용 글"></textarea><div class="form-actions"><button id="igCopy" type="button" class="secondary-btn">문구 복사</button><button id="igCaptionSave" type="button" class="ghost-btn">문구 저장</button><button id="igCaptionRetry" type="button" class="ghost-btn" hidden>홍보글 작성</button></div><p id="igCaptionStatus" role="status" aria-live="polite"></p></section>`;
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
  let captionBusy=false,captionEpoch=0,captionController=null,captionState='none';
  let managedTail=null;
  // The AI's own tags for the open caption; "현재 결과에 적용" swaps only the campus's fixed tags.
  let generatedTags=[];
  // One automatic caption attempt per saved set; after that only the button writes (no repeat billing).
  const autoCaptioned=new Set();
  // 나만의 로고 chosen in 양식 수정 ({id,name}): placed on every photo of the next batch as user layers.
  let overlayChoices=[];
  function captionLock(value){captionBusy=value;for(const id of ['igCaptionText','igCaptionSave','igCaptionRetry'])$(id).disabled=value;}
  const CAPTION_LABELS={none:'작성 전',writing:'작성 중',done:'작성 완료',failed:'작성 실패',dirty:'변경사항 미저장'};
  function setCaptionState(next,message=''){
    captionState=next;$('igCaptionState').dataset.state=next;$('igCaptionState').textContent=CAPTION_LABELS[next];
    $('igCaptionStatus').textContent=message;
    // [홍보글 작성] while there is no text yet, [홍보글 다시 작성] after a failure or a finished text.
    $('igCaptionRetry').hidden=next==='writing'||!currentSet;
    $('igCaptionRetry').textContent=next==='none'&&!$('igCaptionText').value.trim()?'홍보글 작성':'홍보글 다시 작성';
  }
  const sameItems=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((item,i)=>item.renderId===b[i].renderId);
  const setIsCurrent=()=>Boolean(currentSet)&&sameItems(currentSet.items,items);
  // 사용자 이미지 편집 state (see the layer editor below).
  const editor={open:false,index:0,base:null,artwork:null,layers:[],selected:null,assets:new Map(),missing:new Set(),drag:null,token:0,dirty:false};
  const DEFAULT_DIRECTION='선택한 원본을 인스타그램 4:5 규격으로 배치';
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
  function progress(value,message){const percent=Math.max(0,Math.min(100,Math.floor(value)));$('igProgressWrap').hidden=false;$('igProgress').value=percent;$('igPercent').textContent=percent+'%';$('igStatus').textContent=message;}
  const read=()=>normalizeDesign({workflow:'carousel-v2',logoType,templateId:'academy',materialKind:$('igMode').value==='original'?'student-artwork':'real-photo',usePermission:'allowed',externalAiConsent:!originalMode()});
  const snapshot=()=>JSON.stringify([state.selectedFileIds,$('draftCampus').value,$('aiCommand').value,logoType,$('igMode').value]);
  const post=(path,body,signal)=>api('/api/data-core/content'+(path?'/'+path:''),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:signal||AbortSignal.timeout(150000)});
  // Sends the already browser-optimized working copy alongside the request body — same
  // multipart/form-data shape as blog's photo upload — instead of asking the server to re-read (and
  // hard-cap) the R2 original.
  const postWithPhoto=(path,body,photoId,blob,signal)=>{const form=new FormData();form.set('input',JSON.stringify(body));form.set('photo:'+photoId,blob,photoId+'.jpg');return api('/api/data-core/content'+(path?'/'+path:''),{method:'POST',body:form,signal:signal||AbortSignal.timeout(150000)});};
  function buttons(){ $('igGenerate').disabled=busy||!canWrite()||!state.selectedFileIds.length||!$('draftCampus').value;
    // Completed photos can be saved (and captioned) even when others failed; a saved set is updated in
    // place when retried photos or layer edits change its pictures.
    const saved=setIsCurrent();
    $('igComplete').disabled=busy||!items.length||saved||(!currentSet&&signature!==snapshot());
    $('igComplete').innerHTML=saved?'<svg aria-hidden="true"><use href="/data-core/assets/core-icons.svg#Check"></use></svg>저장됨':imageState==='saving'?'저장 중…':imageState==='failed'?'다시 저장':currentSet?'변경사항 저장':`완료된 ${items.length}장 저장`;
    $('igLayerEdit').disabled=busy||!items.length||!canWrite();
    $('igComplete').setAttribute('aria-busy',String(imageState==='saving'));
    const preserved=state.selectedFileIds.filter(preserveSource).length;
    $('igSourceNotice').hidden=!preserved;
    $('igSourceNotice').textContent=`선택 ${preserved}장은 학생작품·문서 등 원본 보존 대상으로, 외부 AI 전송 없이 제작합니다.`;
    $('igGenerate').textContent=originalMode()||preserved===state.selectedFileIds.length?'이미지 만들기':'AI로 이미지 만들기';$('igCancel').hidden=!busy||!controller;
    $('igRetryFailed').hidden=!failures.length;$('igRetryFailed').disabled=busy; }
  function lock(value){busy=value;state.busy=value;$('photoHeading').closest('.workflow-section').inert=value;command.inert=value;$('igLogos').inert=value;$('igMode').disabled=value;history.inert=value;result.querySelectorAll('button,textarea').forEach(el=>el.disabled=value);if(!value)captionLock(captionBusy);buttons();}
  function clear(keepBackgrounds=false){managedTail=null;generatedTags=[];captionEpoch++;captionController?.abort();captionLock(false);closeLayerEditor();if(keepBackgrounds!==true)backgrounds.clear();releasePreview();generation++;items=[];currentSet=null;signature='';requestId='';imageState='new';ids=[];failures=[];itemStatus=new Map();batchInfo=null;restoredBatch=false;result.hidden=true;$('igProgressWrap').hidden=true;$('igProgress').value=0;$('igPercent').textContent='0%';$('igItemStatuses').hidden=true;$('igItemStatuses').replaceChildren();$('igPreview').removeAttribute('src');$('igSlides').replaceChildren();$('igDownloads').replaceChildren();$('igCaptionSection').hidden=true;$('igCaptionText').value='';setCaptionState('none');$('igStatus').textContent=hasSaved?'변경사항 미저장':'';$('igSaved').textContent=hasSaved?'변경사항 미저장':'저장 전';$('igLayerSummary').textContent='';buttons();}
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
  // 나만의 로고: images uploaded once per campus (로고·문구·말풍선). They are never a replacement for the
  // official logo above — each chosen one becomes a separate layer over the photo. Deleting one only
  // hides this row; an already-composited image is a separate, independent file and keeps it.
  let customLogos=[],customLogosCursor=null,customLogosCampus='',customLogosQuery='',customLogosEpoch=0;
  const iconHtml=name=>`<svg aria-hidden="true"><use href="/data-core/assets/core-icons.svg#${name}"></use></svg>`;
  function syncOverlayChoices(){$('igCustomLogos').querySelectorAll('.ig-logo-choice').forEach(el=>el.setAttribute('aria-pressed',String(overlayChoices.some(v=>v.id===el.dataset.asset))));updateTemplateSummary();}
  function renderCustomLogo(item){
    const card=document.createElement('div');card.className='ig-custom-card';
    const button=document.createElement('button');button.type='button';button.className='ig-logo-choice';button.dataset.asset=item.id;
    button.setAttribute('aria-pressed',String(overlayChoices.some(v=>v.id===item.id)));button.title='누르면 이번에 만드는 모든 사진에 넣기/빼기';
    const img=document.createElement('img');img.src='/api/data-core/files/'+encodeURIComponent(item.id);img.alt='';img.loading='lazy';img.decoding='async';
    const label=document.createElement('span');label.textContent=item.name;
    button.append(img,label);
    button.onclick=()=>{
      if(busy)return;
      overlayChoices=overlayChoices.some(v=>v.id===item.id)?overlayChoices.filter(v=>v.id!==item.id):[...overlayChoices,{id:item.id,name:item.name}].slice(0,USER_LAYER_LIMIT);
      syncOverlayChoices();
    };
    const actions=document.createElement('div');actions.className='ig-custom-actions';
    const rename=document.createElement('button');rename.type='button';rename.className='ig-logo-action';rename.innerHTML=iconHtml('PenLine');rename.setAttribute('aria-label',item.name+' 이름 바꾸기');
    rename.onclick=async()=>{
      const name=prompt('이미지 이름',item.name);if(name===null||!name.trim()||name.trim()===item.name)return;
      try{
        const value=await api('/api/data-core/content/instagram-logos/'+encodeURIComponent(item.id),{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({name})});
        item.name=value.logo.name;for(const v of overlayChoices)if(v.id===item.id)v.name=item.name;
        renderCustomLogos();renderLayerAssets();$('igCustomLogoStatus').textContent='이름을 바꿨습니다.';
      }catch(error){$('igCustomLogoStatus').textContent=error.message;}
    };
    const remove=document.createElement('button');remove.type='button';remove.className='ig-logo-action ig-logo-remove';remove.innerHTML=iconHtml('Trash2');remove.setAttribute('aria-label',item.name+' 목록에서 삭제');
    remove.onclick=async()=>{
      if(busy||!confirm(`'${item.name}' 이미지를 목록에서 삭제할까요? 이미 완성한 이미지에는 그대로 남습니다.`))return;
      try{
        await api('/api/data-core/content/instagram-logos/'+encodeURIComponent(item.id),{method:'DELETE'});
        customLogos=customLogos.filter(v=>v.id!==item.id);overlayChoices=overlayChoices.filter(v=>v.id!==item.id);
        renderCustomLogos();renderLayerAssets();updateTemplateSummary();$('igCustomLogoStatus').textContent='목록에서 삭제했습니다.';
      }catch(error){$('igCustomLogoStatus').textContent=error.message;}
    };
    actions.append(rename,remove);card.append(button,actions);
    return card;
  }
  function renderCustomLogos(){
    $('igCustomLogos').replaceChildren(...customLogos.map(renderCustomLogo));
    $('igCustomEmpty').hidden=customLogos.length>0;
    $('igCustomEmpty').textContent=customLogosQuery?`'${customLogosQuery}' 이름의 이미지가 없습니다.`:'등록된 이미지가 없습니다.';
  }
  async function loadCustomLogos(reset=false){
    const campusId=$('draftCampus').value;
    if(!campusId){customLogos=[];customLogosCursor=null;customLogosCampus='';renderCustomLogos();renderLayerAssets();$('igMoreLogos').classList.add('hidden');return;}
    if(reset){customLogos=[];customLogosCursor=null;customLogosCampus=campusId;customLogosQuery=$('igCustomSearch').value.trim();}
    else if(customLogosCampus!==campusId)return;
    const epoch=++customLogosEpoch;
    try{
      const params=new URLSearchParams({campusId});if(customLogosCursor)params.set('cursor',customLogosCursor);if(customLogosQuery)params.set('q',customLogosQuery);
      const value=await api('/api/data-core/content/instagram-logos?'+params);
      if(customLogosCampus!==campusId||epoch!==customLogosEpoch)return;
      customLogos=reset?value.logos:[...customLogos,...value.logos.filter(v=>!customLogos.some(c=>c.id===v.id))];customLogosCursor=value.nextCursor;
      renderCustomLogos();renderLayerAssets();$('igMoreLogos').classList.toggle('hidden',!customLogosCursor);
    }catch(error){$('igCustomLogoStatus').textContent=error.message;}
  }
  $('igMoreLogos').onclick=()=>void loadCustomLogos(false);
  let searchTimer=0;
  $('igCustomSearch').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>void loadCustomLogos(true),300);});
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
    if(!isSvg&&!['image/png','image/jpeg','image/webp'].includes(file.type)){$('igCustomLogoStatus').textContent='PNG, JPG, WEBP 이미지만 올릴 수 있습니다.';return;}
    if(!isSvg&&file.size>5*1024*1024){$('igCustomLogoStatus').textContent='이미지는 5MB 이하로 올려주세요.';return;}
    const name=file.name.replace(/\.[^.]+$/,'');
    $('igUploadLogo').disabled=true;$('igCustomLogoStatus').textContent=isSvg?'SVG를 PNG로 변환하는 중...':'업로드 중...';
    try{
      if(isSvg){file=await rasterizeSvgLogo(file);$('igCustomLogoStatus').textContent='업로드 중...';}
      const form=new FormData();form.set('campusId',campusId);form.set('file',file);form.set('name',name);
      const value=await api('/api/data-core/content/instagram-logos',{method:'POST',body:form});
      customLogos=[value.logo,...customLogos.filter(v=>v.id!==value.logo.id)];renderCustomLogos();renderLayerAssets();
      $('igCustomLogoStatus').textContent='업로드 완료 · 이미지를 눌러 선택하면 이번에 만드는 사진에 들어갑니다.';
    }catch(error){$('igCustomLogoStatus').textContent=error.message;}
    finally{$('igUploadLogo').disabled=false;}
  };
  function preview(index=0){
    if(editor.open&&index!==editor.index){
      if(editor.dirty&&!confirm('적용하지 않은 사용자 이미지 변경을 버리고 다른 사진으로 갈까요?'))return;
      closeLayerEditor();
    }
    activeIndex=index;if(!items[index])return;$('igPreview').src=previewUrl(items[index]);
    const layers=items[index].layers||[];$('igLayerSummary').textContent=layers.length?`이 사진의 사용자 이미지 ${layers.length}개`:'';
    $('igSlides').replaceChildren(...items.map((item,i)=>{
    const button=document.createElement('button');button.type='button';button.setAttribute('aria-pressed',String(i===index));button.textContent=String(slotNumber(item,i));button.onclick=()=>preview(i);return button;
  }));result.hidden=false;}
  $('igPreview').onclick=()=>window.DataCoreImageGallery.open({scope:'instagram-set',title:'인스타 이미지',anchor:$('igPreview'),index:activeIndex,items:items.map((item,i)=>({src:previewUrl(item),title:`${slotNumber(item,i)} / ${ids.length||items.length}`}))});
  $('igMode').onchange=()=>{clear();updateTemplateSummary();};$('aiCommand').addEventListener('input',clear);
  $('igCancel').onclick=()=>controller?.abort();
  const currentDirection=()=>$('aiCommand').value.trim()||DEFAULT_DIRECTION;
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
  // Every finished photo carries what re-compositing its user layers needs: the background it was drawn
  // from (the original, or its AI-edited copy), its design, and the layers as saved with the render.
  const itemFromReport=(sourceId,draftId,report)=>({sourceId,draftId,renderId:report.renderId,fingerprint:report.fingerprint,masterFileId:report.masterFileId,
    backgroundFileId:report.backgroundFileId||sourceId,design:report.design,layers:Array.isArray(report.layers)?report.layers:[]});
  function saveRender(draftId,fingerprint,backgroundId,blob,layers,signal){
    const form=new FormData();form.set('file',blob,'instagram-master.png');form.set('fingerprint',fingerprint);form.set('backgroundFileId',backgroundId);
    form.set('layers',JSON.stringify(layers.map(({id,assetId,x,y,w,h,z})=>({id,assetId,x,y,w,h,z}))));
    return api(`/api/data-core/content/instagram/${draftId}/render`,{method:'POST',body:form,signal});
  }
  // One image's full pipeline (파일읽기→전처리→AI요청→합성→저장). Anything a failed attempt already paid
  // for — its draft, its AI-edited background — is attached to the thrown error as `partial` and handed
  // back through `prior` on retry, so a retry neither re-bills the AI nor leaves a second draft behind.
  async function processOne(id,{design,campusId,direction,policyValue,backgroundKeyFor,signal,aiLock,decodeLock,prior,overlays=[]}){
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
            if(report.approved&&report.renderId&&report.masterFileId)return {blob:null,item:itemFromReport(id,prior.draftId,report)};
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
      const composing=decodeLock(()=>{signal.throwIfAborted();step(preserve?'원본 보존·로고 합성 중':'로고 합성 중');return composeInstagram('/api/data-core/files/'+encodeURIComponent(backgroundId),itemDesign,policyValue.campusLogoLabel,signal,{place:overlays});});
      const drafting=reuse?Promise.resolve(reuse):(async()=>{
        // Not tied to 중단: an aborted create can still land server-side, leaving a draft the retry never
        // learns about. Letting this quick call finish means its id is always recorded and reused.
        const draft=(await post('',{sourceApp:'instagram',campusId,title:`인스타 이미지 ${ids.indexOf(id)+1}`,summary:direction,relatedFileIds:[id],
          metadata:{instagramDesign:itemDesign,instagramBatch:{...batchInfo,slot:ids.indexOf(id),backgroundFileId:backgroundId!==id?backgroundId:null}}})).draft;
        partial.draftId=draft.id;signal.throwIfAborted();
        return {draftId:draft.id,fingerprint:(await api(`/api/data-core/content/instagram/${draft.id}/review`,{signal})).fingerprint};
      })();
      // allSettled, not all: if composing fails, still learn the draft id so the retry can reuse it.
      const [composed,drafted]=await Promise.allSettled([composing,drafting]);
      if(composed.status==='rejected')throw composed.reason;
      if(drafted.status==='rejected')throw drafted.reason;
      signal.throwIfAborted();step('이미지 저장 중');
      const {blob,layers}=composed.value,{draftId,fingerprint}=drafted.value;
      const saved=await saveRender(draftId,fingerprint,backgroundId,blob,layers,signal);
      return {blob,item:{sourceId:id,draftId,renderId:saved.renderId,fingerprint:saved.fingerprint,masterFileId:saved.file.id,backgroundFileId:backgroundId,design:itemDesign,layers}};
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
    if(busy||!canWrite()||state.selectedFileIds.length<1||state.selectedFileIds.length>100)return;
    if(!originalMode()&&state.selectedFileIds.some(id=>!preserveSource(id))&&!$('aiCommand').value.trim())return toast('원하는 느낌을 입력해주세요.','error');
    const campusId=$('draftCampus').value,design=read(),direction=currentDirection(),selectionIds=[...state.selectedFileIds];
    const backgroundKeyFor=id=>JSON.stringify([campusId,id,direction,$('igMode').value]);
    const pending=selectionIds.filter(id=>!preserveSource(id)&&!backgrounds.has(backgroundKeyFor(id)));
    if(!originalMode()&&pending.length&&!confirm(`선택한 ${pending.length}장의 사진만 외부 AI에 전송합니다. 학생 작품·로고·성적 자료가 아니며 홍보 사용과 AI 처리 동의가 확인된 사진인가요?`))return;
    if((originalMode()||selectionIds.every(preserveSource))&&!confirm(`선택한 ${selectionIds.length}장의 홍보 사용 권한을 확인했나요? 원본을 보존하며, 홍보글 작성에는 사진 없이 입력한 방향만 AI에 전송합니다.`))return;
    clear(true);hideResume();ids=selectionIds;
    batchInfo={id:crypto.randomUUID(),sources:ids.map(id=>({id:String(id),folderId:state.knownFiles.get(String(id))?.folderId||null})),command:$('aiCommand').value,mode:$('igMode').value,logoType,
      overlays:overlayChoices.map(({id,name})=>({id,name}))};
    requestId=batchInfo.id;signature=snapshot();const epoch=generation;controller=new AbortController();lock(true);
    progress(0,'준비 중...');renderItemStatuses();
    let stage='캠퍼스 확인',finished=false;
    try{
      await logos();if(!policy||policy.campusId!==campusId)throw Error('캠퍼스 정보를 확인하세요.');
      stage='이미지 제작';
      await runBatch(ids,{design,campusId,direction,policyValue:policy,backgroundKeyFor,signal:controller.signal,overlays:batchInfo.overlays},epoch);
      if(epoch!==generation)return;
      renderSummary();finished=true;
    }catch(error){
      if(epoch!==generation)return;
      $('igStatus').textContent=error.name==='AbortError'?'작업을 중단했습니다. 완료된 사진은 그대로 두고, 나머지는 "실패한 항목만 다시 시도"로 이어서 만들 수 있습니다.':`${stage}: ${error.message}`;
      if(items.length){$('igSaved').textContent=`${items.length}장 완료 · 완료된 사진은 아래에서 개별/일괄로 받거나 저장할 수 있습니다. 나머지는 다시 시도해주세요.`;void downloads();}
      buttons();
    }finally{controller=null;lock(false);}
    // Not after 중단: stopping means "no more work (or AI cost) for now" — saving stays one click away.
    if(finished)await autoFinish(epoch);
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
    let finished=false;
    try{
      await logos();if(!policy||policy.campusId!==campusId)throw Error('캠퍼스 정보를 확인하세요.');
      // Retried photos get the same user images as the rest of their batch.
      await runBatch(retryIds,{design,campusId,direction,policyValue:policy,backgroundKeyFor,signal:controller.signal,overlays:batchInfo?.overlays||[]},epoch);
      if(epoch!==generation)return;
      renderSummary();finished=true;
    }catch(error){
      if(epoch!==generation)return;
      $('igStatus').textContent=error.name==='AbortError'?'작업을 중단했습니다. 완료된 사진은 그대로 두고, 나머지는 "실패한 항목만 다시 시도"로 이어서 만들 수 있습니다.':`재시도 실패: ${error.message}`;
      buttons();
    }finally{controller=null;lock(false);}
    if(finished)await autoFinish(epoch);
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
      const sources=(Array.isArray(batch.sources)?batch.sources:[]).filter(s=>s&&typeof s.id==='string').slice(0,100);
      if(!sources.length||epoch!==resumeEpoch)return;
      const slots=sources.map(()=>null);
      const drafts=(await listing({limit:'100',q:batch.id})).filter(d=>d.metadata.instagramBatch.id===batch.id).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
      for(const draft of drafts){
        const slot=draft.metadata.instagramBatch.slot;
        if(!Number.isInteger(slot)||slot<0||slot>=sources.length||String(draft.metadata.relatedFileIds?.[0])!==sources[slot].id||slots[slot]?.item)continue;
        let report;try{report=await quiet(`/api/data-core/content/instagram/${encodeURIComponent(draft.id)}/review`);}catch{continue;}
        if(report.approved&&report.renderId&&report.masterFileId)slots[slot]={item:itemFromReport(sources[slot].id,draft.id,report)};
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
      $('igLogos').querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.logo===logoType)));
      const overlays=(Array.isArray(b.overlays)?b.overlays:[]).filter(v=>v&&typeof v.id==='string'&&/^[0-9a-f-]{36}$/i.test(v.id)).slice(0,USER_LAYER_LIMIT).map(v=>({id:v.id,name:String(v.name||'')}));
      overlayChoices=overlays;syncOverlayChoices();
      state.selectedFileIds=candidate.sources.map(s=>s.id);selected=JSON.stringify(state.selectedFileIds);renderSelection();
      ids=[...state.selectedFileIds];restoredBatch=true;
      batchInfo={id:b.id,sources:candidate.sources,command:$('aiCommand').value,mode:$('igMode').value,logoType,overlays};
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
  // Caption requests report their own failure on the caption — never through api(), whose 401/403
  // handling wipes the whole page: a refused caption must not take the finished images with it.
  async function captionFetch(path,init){
    const response=await fetch('/api/data-core/content/'+path,{credentials:'same-origin',cache:'no-store',...init});
    const body=(response.headers.get('content-type')||'').includes('application/json')?await response.json().catch(()=>null):null;
    if(!response.ok){
      const error=Error(response.status===401?'로그인이 만료되었습니다. 다시 로그인한 뒤 시도해주세요.':body?.error||`요청을 완료하지 못했습니다 (HTTP ${response.status}).`);
      error.status=response.status;throw error;
    }
    if(!body)throw Error('서버 응답을 읽지 못했습니다.');
    return body;
  }
  async function campusLabel(campusId,signal){
    if(policy?.campusId===campusId)return policy.campusLogoLabel;
    return (await captionFetch('instagram-policy?campusId='+encodeURIComponent(campusId),{signal})).campusLogoLabel;
  }
  function saveCaptionText(target,text,{sources=target.captionSources??null,previousCaption,signal}={}){
    assertResolvedText(text);
    return captionFetch('instagram-sets/'+encodeURIComponent(target.id),{method:'PATCH',headers:{'content-type':'application/json'},signal,
      body:JSON.stringify({caption:text,managedTail,generatedTags,sources,...(previousCaption!==undefined?{previousCaption}:{})})});
  }
  const setSources=set=>set.items.map(item=>item.sourceId).filter(Boolean);
  // Reopening says so when retried photos joined the set after its text was written.
  function coverageNote(set){
    const now=setSources(set).sort(),was=Array.isArray(set.captionSources)?set.captionSources:null;
    return was&&(was.length!==now.length||was.some((id,i)=>id!==now[i]))?`이미지 구성이 바뀌었습니다(현재 ${now.length}장). 필요하면 [홍보글 다시 작성]을 눌러주세요 — 글만 다시 쓰고 이미지는 그대로 둡니다.`:'';
  }
  // Writes the text for the saved set from its finished photos only — failed photos never block it,
  // and nothing about the images is redone. `auto` is the one automatic attempt after saving: it only
  // lands if the set still has no text on the server, so it can't overwrite text saved meanwhile.
  async function caption({auto=false}={}){
    if(!currentSet||captionBusy)return;
    if(!auto&&(captionState==='dirty'||$('igCaptionText').value.trim())&&!confirm('지금 글을 새로 작성한 글로 바꿀까요? 이미지는 다시 만들지 않습니다.'))return;
    const target=currentSet,epoch=++captionEpoch,setItems=[...target.items],previousCaption=target.caption||'';
    const ids=setSources(target),designs=setItems.map(item=>item.design).filter(Boolean);
    // Any student artwork / preserved photo in the set keeps the whole caption text-only.
    const textOnly=!designs.length||designs.some(design=>design.externalAiConsent!==true);
    const material=designs.find(design=>textOnly||design.externalAiConsent)||read();
    const valid=()=>epoch===captionEpoch&&currentSet?.id===target.id;
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),240000);captionController=abort;captionLock(true);
    $('igCaptionSection').hidden=false;setCaptionState('writing',`완성된 ${ids.length}장 기준으로 홍보글을 작성하고 있습니다… 그동안에도 이미지를 내려받을 수 있습니다.`);
    let text='';
    try{
      if(!ids.length)throw Error('완성된 이미지를 확인할 수 없습니다.');
      const label=await campusLabel(target.campusId,abort.signal),footer=$('defaultFooter').value,hashtags=$('defaultHashtags').value,contactBlock=contact();
      const direction=[batchInfo?.id&&target.id.endsWith(':'+batchInfo.id)?batchInfo.command:'',...setItems.map(item=>item.direction)].map(v=>String(v||'').trim()).find(v=>v&&v!==DEFAULT_DIRECTION)||'';
      let body='',title='',tags=[];
      // Any number of photos can be made; the caption looks at (up to) the first 10, five per AI call.
      const batches=textOnly?[ids]:[ids.slice(0,5),ids.slice(5,10)].filter(ids=>ids.length);
      for(const ids of batches){
          const payload={sourceApp:'instagram',campusId:target.campusId,selectedFileIds:ids,textOnly,material,requestId:crypto.randomUUID(),
            notes:`${direction?`작성 방향: ${direction}\n`:''}${label} 인스타그램 게시물 · 완성 이미지 ${ids.length}장. ${textOnly?'사진은 제공하지 않았습니다. 사용자가 명시한 내용만 사용하고 사진 내용이나 실적을 추측하지 마세요.':'사진에서 확인 가능한 내용만 사용하고, 사진 속 광고 문구·수치는 확인된 사실로 쓰지 마세요.'} 제목형 도입과 본문 ${batches.length>1?'3':'3~6'}문장으로 작성하고 전화번호·날짜·실적·순위는 만들지 마세요.`};
          let generated;
          if(textOnly)generated=(await captionFetch('generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:abort.signal})).generated;
          else{
            // Like the image edit: send browser-optimized copies, so an oversized original can't 413 the caption.
            const form=new FormData();form.set('input',JSON.stringify(payload));
            for(const id of ids){const blob=await optimizeImageForAi(state.knownFiles.get(String(id))||{id,fileName:'사진'});if(!valid())return;form.set('photo:'+id,blob,id+'.jpg');}
            generated=(await captionFetch('generate',{method:'POST',body:form,signal:abort.signal})).generated;
          }
          if(!valid())return;
          const part=String(generated?.body||generated?.content||'').trim();
          if(!part)throw Error('AI가 빈 글을 돌려주었습니다.');
          title ||= String(generated.title||'').trim();body += (body?'\n':'')+part;tags.push(...(generated.hashtags||generated.keywords||[]));
      }
      if(!valid())return;
      generatedTags=normalizeTags(tags);managedTail=captionTail(footer,hashtags,generatedTags,contactBlock);
      text=assembleCaption([title,body].filter(Boolean).join('\n\n'),footer,hashtags,tags,contactBlock);
    }catch(error){
      clearTimeout(timer);
      if(valid()){captionController=null;captionLock(false);setCaptionState('failed',`홍보글을 작성하지 못했습니다 · ${abort.signal.aborted?'응답이 너무 오래 걸려 중단했습니다.':error.message} 이미지 저장·다운로드에는 영향이 없습니다.`);}
      return;
    }
    // The text exists from here on: a failed save leaves it on screen as unsaved, never as "완료".
    $('igCaptionText').value=text;
    try{
      await saveCaptionText(target,text,{sources:[...ids].sort(),previousCaption,signal:abort.signal});
      if(!valid())return;
      target.caption=text;target.captionSources=[...ids].sort();
      setCaptionState('done',textOnly?'사진 전송 없이 작성 완료 · 게시 전에 내용을 확인하세요.':'홍보글 작성 완료 · 게시 전에 내용을 확인하세요.');
    }catch(error){
      if(valid())setCaptionState('dirty',`글은 작성했지만 저장하지 못했습니다 · ${error.message} 내용을 확인하고 [문구 저장]을 눌러주세요.`);
    }finally{clearTimeout(timer);if(valid()){captionController=null;captionLock(false);}}
  }
  // Keeps the set the server returned while leaving any unsaved caption typing on screen untouched.
  function adoptSet(saved){
    currentSet=saved;
    const byRender=new Map(items.map(item=>[item.renderId,item]));
    items=saved.items.map(item=>({...byRender.get(item.renderId),...item}));
  }
  // Saves the finished photos as the set (or updates the saved set when retried photos or layer edits
  // changed its pictures). Failed photos are simply not part of it.
  async function saveSet(){
    if(busy||!items.length)return false;
    if(setIsCurrent())return true;
    if(!currentSet&&signature!==snapshot())return false;
    imageState='saving';lock(true);$('igSaved').textContent='저장 중…';
    try{
      const payload=items.map(({draftId,renderId,fingerprint})=>({draftId,renderId,fingerprint}));
      const saved=currentSet
        ?await api('/api/data-core/content/instagram-sets/'+encodeURIComponent(currentSet.id),{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({items:payload,version:currentSet.version||1})})
        :await post('instagram-sets',{requestId,items:payload});
      adoptSet(saved);hasSaved=true;imageState='saved';
      $('igSaved').textContent=`저장 완료 · ${items.length}장${failures.length?` (실패 ${failures.length}장 제외 · 다시 시도하면 이 세트에 추가됩니다)`:''}`;
      $('igCaptionSection').hidden=false;
      if(captionState!=='writing'&&captionState!=='dirty')setCaptionState(currentSet.caption?'done':captionState==='failed'?'failed':'none',currentSet.caption?coverageNote(currentSet):$('igCaptionStatus').textContent);
      return true;
    }catch(error){imageState='failed';$('igSaved').textContent='저장 실패 · '+error.message;return false;}
    finally{lock(false);void downloads();}
  }
  // After a batch settles: save what finished, then write the caption once for that set.
  async function autoFinish(epoch){
    if(epoch!==generation||!items.length||!await saveSet()||epoch!==generation||!currentSet)return;
    if(!currentSet.caption&&!autoCaptioned.has(currentSet.id)){autoCaptioned.add(currentSet.id);await caption({auto:true});}
  }
  $('igComplete').onclick=()=>autoFinish(generation);
  $('igCopy').onclick=async()=>{try{assertResolvedText($('igCaptionText').value);}catch(error){toast(error.message,'error');return;}try{await navigator.clipboard.writeText($('igCaptionText').value);toast('복사했습니다.');}catch{toast('클립보드 권한을 확인해주세요.','error');}};
  $('igCaptionText').addEventListener('input',()=>{if(currentSet)setCaptionState('dirty','문구 변경사항 미저장 · [문구 저장]을 눌러주세요.');});
  $('igCaptionSave').onclick=async()=>{
    if(captionBusy||!currentSet)return;
    const target=currentSet,epoch=captionEpoch,text=$('igCaptionText').value;captionLock(true);
    try{await saveCaptionText(target,text);if(epoch===captionEpoch){target.caption=text;setCaptionState(text.trim()?'done':'none',text.trim()?'문구 저장 완료':'');}}
    catch(error){if(epoch===captionEpoch)setCaptionState('dirty','저장하지 못했습니다 · '+error.message);}
    finally{if(epoch===captionEpoch)captionLock(false);}
  };
  $('igCaptionRetry').onclick=()=>caption();
  async function loadHistory(){
    if(!history.open||!$('draftCampus').value)return;
    const campusId=$('draftCampus').value;$('igHistory').textContent='불러오는 중...';
    try{const data=await api('/api/data-core/content/instagram-sets?campusId='+encodeURIComponent(campusId));if(campusId!==$('draftCampus').value||!history.open)return;$('igHistory').replaceChildren(...data.sets.map(item=>{
      const button=document.createElement('button');button.type='button';button.className='ghost-btn';button.textContent=`${item.title} · ${item.createdAt.slice(0,10)}`;
      button.onclick=async()=>{if(busy)return;lock(true);try{
        const saved=await api('/api/data-core/content/instagram-sets/'+encodeURIComponent(item.id));clear();hideResume();
        // Opening an old set never writes by itself; an empty one offers [홍보글 작성] instead.
        autoCaptioned.add(saved.id);currentSet=saved;managedTail=saved.managedTail??null;generatedTags=Array.isArray(saved.generatedTags)?saved.generatedTags:[];items=saved.items;
        preview();await downloads();$('igSaved').textContent='저장된 최종본';$('igCaptionText').value=saved.caption;$('igCaptionSection').hidden=false;
        setCaptionState(saved.caption?'done':'none',saved.caption?coverageNote(saved):'아직 홍보글이 없습니다. [홍보글 작성]을 누르면 글만 작성합니다(이미지는 다시 만들지 않습니다).');
      }catch(error){toast(error.message,'error');}finally{lock(false);}};return button;
    }));if(!data.sets.length)$('igHistory').textContent='저장된 이미지 세트가 없습니다.';}catch(error){if(campusId===$('draftCampus').value)$('igHistory').textContent=error.message;}
  }
  history.ontoggle=loadHistory;
  function refresh(){void logos();void loadHistory();buttons();void findResumable();}
  function applyText({footer,hashtags,contact}){
    if(captionBusy||busy)throw Error('진행 중 작업이 끝난 후 적용하세요.');
    if($('igCaptionSection').hidden)throw Error('저장된 이미지 세트의 홍보글을 먼저 열어주세요.');
    const tail=captionTail(footer,hashtags,generatedTags,contact);
    if(managedTail===null&&!confirm('기존 글의 문구 경계를 확인할 수 없습니다. 현재 본문을 유지하고 마지막에 새 문구·태그를 추가할까요?'))throw Error('현재 결과를 유지했습니다.');
    $('igCaptionText').value=replaceManagedTail($('igCaptionText').value,managedTail,tail);managedTail=tail;setCaptionState('dirty','문구 변경사항 미저장 · [문구 저장]을 눌러주세요.');
  }
  // 양식 수정 dialog: logo/제작방식/나만의 로고 already apply live via the click/change handlers above
  // (that is what "이번 글에 적용" means here — nothing further to do but close). 취소 restores the
  // snapshot taken when the dialog opened, so a change made and abandoned mid-dialog never lingers.
  function readTemplate(){return {logoType,mode:$('igMode').value,overlays:overlayChoices.map(v=>({...v}))};}
  function updateTemplateSummary(){$('igTemplateSummary').textContent=(logoType===campusDefaultLogoType&&$('igMode').value===campusDefaultMode?'캠퍼스 기본 양식 적용 중':'양식 적용됨')+(overlayChoices.length?` · 나만의 로고 ${overlayChoices.length}개`:'');}
  $('igOpenTemplate').onclick=()=>{templateSnapshot=readTemplate();$('igTemplateStatus').textContent='';$('igTemplateDialog').showModal();if(customLogosCampus!==$('draftCampus').value)void loadCustomLogos(true);};
  $('igApplyTemplate').onclick=()=>{updateTemplateSummary();templateSnapshot=null;$('igTemplateDialog').close();};
  $('igCloseTemplate').onclick=$('igCancelTemplate').onclick=()=>{
    if(templateSnapshot&&(templateSnapshot.logoType!==logoType||templateSnapshot.mode!==$('igMode').value)){
      logoType=templateSnapshot.logoType;$('igLogos').querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.logo===logoType)));
      $('igMode').value=templateSnapshot.mode;clear(true);updateTemplateSummary();
    }
    if(templateSnapshot){overlayChoices=templateSnapshot.overlays;syncOverlayChoices();}
    templateSnapshot=null;$('igTemplateDialog').close();
  };
  $('igSaveTemplate').onclick=async()=>{
    const campusId=$('draftCampus').value;
    if(!campusId){$('igTemplateStatus').textContent='캠퍼스를 먼저 선택하세요.';return;}
    $('igSaveTemplate').disabled=true;
    try{
      await api('/api/data-core/content/defaults',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({sourceApp:'instagram',campusId,instagramSettings:{logoType,mode:$('igMode').value}})});
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
  // ── 사용자 이미지 편집 ────────────────────────────────────────────────────────────────
  // The canvas shows the photo's base (background + official logo + photo, never its old layers) with
  // the layers drawn on top, at preview size but in master coordinates. 적용 composites at full size
  // from that same base, saves a new render (a new version, so downloads never reuse an old export)
  // and updates the saved set. No AI is involved, and the original photo is never touched.
  const PREVIEW={width:1080,height:1350},MIN_LAYER=40;
  const scopeAll=()=>document.querySelector('input[name="igLayerScope"]:checked')?.value==='all';
  const normalizeZ=layers=>[...layers].sort((a,b)=>a.z-b.z).map((layer,z)=>({...layer,z}));
  function closeLayerEditor(){
    editor.open=false;editor.token++;editor.drag=null;editor.selected=null;editor.layers=[];editor.dirty=false;editor.missing.clear();
    editor.base?.close();editor.base=null;editor.artwork=null;
    for(const image of editor.assets.values())image.close();editor.assets.clear();
    $('igLayerEditor').hidden=true;$('igLayerCanvas').hidden=true;$('igPreview').hidden=false;$('igLayerStatus').textContent='';
    $('igLayerEdit').setAttribute('aria-expanded','false');$('igLayerEdit').textContent='사용자 이미지 편집';$('igLayerSelected').hidden=true;
  }
  async function loadEditorAssets(){
    const missing=[];
    for(const layer of editor.layers){
      if(editor.assets.has(layer.assetId))continue;
      try{await loadLayerAssets([layer],undefined,editor.assets);editor.missing.delete(layer.assetId);}
      catch{editor.missing.add(layer.assetId);missing.push(layer.assetName||'사용자 이미지');}
    }
    return [...new Set(missing)];
  }
  function drawEditor(){
    const canvas=$('igLayerCanvas');if(!editor.base)return;
    if(canvas.width!==PREVIEW.width){canvas.width=PREVIEW.width;canvas.height=PREVIEW.height;}
    const ctx=canvas.getContext('2d'),s=PREVIEW.width/MASTER.width;
    ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(editor.base,0,0,canvas.width,canvas.height);
    for(const layer of [...editor.layers].sort((a,b)=>a.z-b.z)){
      const image=editor.assets.get(layer.assetId),[x,y,w,h]=[layer.x*s,layer.y*s,layer.w*s,layer.h*s];
      if(image){drawLayers(ctx,[layer],editor.assets,s);continue;}
      // A deleted / no-longer-permitted image stays visible as a marked box until the user removes it.
      ctx.save();ctx.fillStyle='rgba(165,43,37,.15)';ctx.strokeStyle='#a52b25';ctx.lineWidth=3;ctx.setLineDash([10,6]);ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);
      ctx.fillStyle='#a52b25';ctx.font='bold 20px sans-serif';ctx.fillText('불러올 수 없는 이미지',x+8,y+28,Math.max(40,w-16));ctx.restore();
    }
    const selected=editor.layers.find(layer=>layer.id===editor.selected);
    if(selected){
      const [x,y,w,h]=[selected.x*s,selected.y*s,selected.w*s,selected.h*s];
      ctx.save();ctx.strokeStyle='#1a73e8';ctx.lineWidth=3;ctx.setLineDash([12,8]);ctx.strokeRect(x,y,w,h);ctx.setLineDash([]);
      ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x+w,y+h,14,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();
    }
  }
  function updateLayerSelection(){
    const layer=editor.layers.find(v=>v.id===editor.selected);
    // Tools appear only while an image is selected.
    $('igLayerSelected').hidden=!layer;
    if(layer)$('igLayerSelectedName').textContent=`선택: ${layer.assetName||'사용자 이미지'}${editor.assets.has(layer.assetId)?'':' (불러올 수 없음)'}`;
    drawEditor();
  }
  function renderLayerAssets(){
    const list=$('igLayerAssets');if(!list)return;
    list.replaceChildren(...customLogos.map(asset=>{
      const button=document.createElement('button');button.type='button';button.className='ig-layer-asset';button.title=asset.name+' 넣기';
      const img=document.createElement('img');img.src='/api/data-core/files/'+encodeURIComponent(asset.id);img.alt='';img.loading='lazy';img.decoding='async';
      const label=document.createElement('span');label.textContent=asset.name;button.append(img,label);
      button.onclick=()=>void addLayer(asset);return button;
    }),...(customLogosCursor?[Object.assign(document.createElement('button'),{type:'button',className:'ghost-btn',textContent:'더 보기',onclick:()=>void loadCustomLogos(false)})]:[]));
    $('igLayerAssetsEmpty').hidden=customLogos.length>0;
  }
  async function addLayer(asset){
    if(!editor.open||!editor.base||busy)return;
    if(editor.layers.length>=USER_LAYER_LIMIT){$('igLayerStatus').textContent=`사진 한 장에 ${USER_LAYER_LIMIT}개까지 넣을 수 있습니다.`;return;}
    const token=editor.token;
    try{await loadLayerAssets([{assetId:asset.id,assetName:asset.name}],undefined,editor.assets);}
    catch(error){if(token===editor.token)$('igLayerStatus').textContent=error.message;return;}
    if(token!==editor.token)return;
    const occupied=editor.layers.length?Math.max(0,...editor.layers.map(layer=>MASTER.width-56-layer.x+24)):0;
    const box=defaultLayerBox(editor.assets.get(asset.id),editor.artwork,editor.layers.length,Math.min(occupied,MASTER.width-400));
    const layer={id:crypto.randomUUID(),assetId:asset.id,assetName:asset.name,...box,z:editor.layers.length};
    editor.layers=[...editor.layers,layer];editor.selected=layer.id;editor.dirty=true;
    $('igLayerStatus').textContent=`'${asset.name}'을(를) 넣었습니다. 끌어서 위치를 정하고 [적용]을 누르세요.`;updateLayerSelection();
  }
  async function openLayerEditor(index){
    const item=items[index];if(!item)return;
    closeLayerEditor();
    const token=editor.token;editor.open=true;editor.index=index;editor.layers=normalizeZ(structuredClone(item.layers||[]));
    $('igLayerEditor').hidden=false;$('igLayerEdit').setAttribute('aria-expanded','true');$('igLayerEdit').textContent='편집 닫기';
    $('igLayerStatus').textContent='사진을 준비하는 중…';renderLayerAssets();
    try{
      if(customLogosCampus!==$('draftCampus').value)await loadCustomLogos(true);
      if(!item.design)throw Error('이 사진의 제작 정보를 확인할 수 없습니다. 세트를 다시 열어주세요.');
      const label=await campusLabel(currentSet?.campusId||$('draftCampus').value);
      const {canvas,artwork}=await composeBase('/api/data-core/files/'+encodeURIComponent(item.backgroundFileId||item.sourceId),item.design,label);
      let bitmap;try{bitmap=await createImageBitmap(canvas,{resizeWidth:PREVIEW.width,resizeHeight:PREVIEW.height,resizeQuality:'high'});}finally{canvas.width=canvas.height=1;}
      if(token!==editor.token){bitmap.close();return;}
      editor.base=bitmap;editor.artwork=artwork;
      const missing=await loadEditorAssets();if(token!==editor.token)return;
      $('igPreview').hidden=true;$('igLayerCanvas').hidden=false;drawEditor();
      $('igLayerStatus').textContent=missing.length?`불러올 수 없는 이미지가 있습니다(${missing.join(', ')}): 삭제되었거나 권한이 바뀌었습니다. 표시된 상자를 눌러 [이 이미지 빼기] 후 적용해주세요.`
        :editor.layers.length?`사용자 이미지 ${editor.layers.length}개 · 사진 위 이미지를 눌러 선택하세요.`:'아래 이미지를 눌러 이 사진에 넣으세요.';
    }catch(error){if(token===editor.token)$('igLayerStatus').textContent=error.message;}
  }
  $('igLayerEdit').onclick=()=>{if(busy||!items.length)return;if(editor.open){if(editor.dirty&&!confirm('적용하지 않은 변경을 버릴까요?'))return;closeLayerEditor();}else void openLayerEditor(activeIndex);};
  $('igLayerCancel').onclick=()=>{closeLayerEditor();};
  $('igLayerManage').onclick=()=>$('igOpenTemplate').click();
  const pointerPoint=event=>{const rect=$('igLayerCanvas').getBoundingClientRect();return {x:(event.clientX-rect.left)/rect.width*MASTER.width,y:(event.clientY-rect.top)/rect.height*MASTER.height,unit:MASTER.width/rect.width};};
  $('igLayerCanvas').addEventListener('pointerdown',event=>{
    if(!editor.open||!editor.base)return;
    const p=pointerPoint(event),selected=editor.layers.find(layer=>layer.id===editor.selected);
    const onHandle=selected&&Math.hypot(p.x-(selected.x+selected.w),p.y-(selected.y+selected.h))<=24*p.unit;
    const hit=onHandle?selected:[...editor.layers].sort((a,b)=>b.z-a.z).find(layer=>p.x>=layer.x&&p.x<=layer.x+layer.w&&p.y>=layer.y&&p.y<=layer.y+layer.h);
    editor.selected=hit?.id||null;
    if(hit){editor.drag={id:hit.id,mode:onHandle?'resize':'move',start:p,box:{x:hit.x,y:hit.y,w:hit.w,h:hit.h}};$('igLayerCanvas').setPointerCapture(event.pointerId);event.preventDefault();}
    updateLayerSelection();
  });
  $('igLayerCanvas').addEventListener('pointermove',event=>{
    const drag=editor.drag;if(!drag)return;
    const p=pointerPoint(event),layer=editor.layers.find(v=>v.id===drag.id);if(!layer)return;
    if(drag.mode==='move'){
      // Keep at least a sliver on the canvas so an image can always be grabbed again.
      layer.x=Math.round(Math.min(MASTER.width-MIN_LAYER,Math.max(MIN_LAYER-drag.box.w,drag.box.x+p.x-drag.start.x)));
      layer.y=Math.round(Math.min(MASTER.height-MIN_LAYER,Math.max(MIN_LAYER-drag.box.h,drag.box.y+p.y-drag.start.y)));
    }else{
      // Aspect ratio stays locked: the uploaded image is only ever scaled, never stretched.
      const scale=Math.max((p.x-drag.box.x)/drag.box.w,(p.y-drag.box.y)/drag.box.h),ratio=drag.box.w/drag.box.h;
      const w=Math.max(MIN_LAYER,Math.min(MASTER.width*2,drag.box.w*scale));
      layer.w=Math.round(w);layer.h=Math.max(8,Math.round(w/ratio));
    }
    editor.dirty=true;drawEditor();
  });
  const endDrag=()=>{editor.drag=null;};
  $('igLayerCanvas').addEventListener('pointerup',endDrag);$('igLayerCanvas').addEventListener('pointercancel',endDrag);
  $('igLayerCanvas').addEventListener('keydown',event=>{
    const layer=editor.layers.find(v=>v.id===editor.selected);if(!layer)return;
    const step=event.shiftKey?50:10,moves={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]};
    if(moves[event.key]){layer.x+=moves[event.key][0];layer.y+=moves[event.key][1];editor.dirty=true;event.preventDefault();drawEditor();}
    else if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();$('igLayerRemove').click();}
  });
  function reorder(delta){
    const layers=normalizeZ(editor.layers),i=layers.findIndex(v=>v.id===editor.selected),j=i+delta;
    if(i<0||j<0||j>=layers.length)return;
    [layers[i].z,layers[j].z]=[layers[j].z,layers[i].z];editor.layers=normalizeZ(layers);editor.dirty=true;updateLayerSelection();
  }
  $('igLayerForward').onclick=()=>reorder(1);$('igLayerBackward').onclick=()=>reorder(-1);
  $('igLayerRemove').onclick=()=>{if(!editor.selected)return;editor.layers=normalizeZ(editor.layers.filter(v=>v.id!==editor.selected));editor.selected=null;editor.dirty=true;updateLayerSelection();$('igLayerStatus').textContent='이미지를 뺐습니다. [적용]을 눌러야 결과에 반영됩니다.';};
  $('igLayerApply').onclick=async()=>{
    if(busy||!editor.open||!editor.base)return;
    const broken=editor.layers.filter(layer=>!editor.assets.has(layer.assetId));
    if(broken.length){$('igLayerStatus').textContent=`불러올 수 없는 이미지(${[...new Set(broken.map(v=>v.assetName||'사용자 이미지'))].join(', ')})를 먼저 빼주세요. 다른 이미지로 몰래 바꾸거나 빼지 않습니다.`;return;}
    const layers=normalizeZ(editor.layers),targets=scopeAll()?items.map((_,i)=>i):[editor.index],assets=editor.assets;
    if(targets.length>1&&!confirm(`완성된 ${targets.length}장 모두에 지금 배치를 똑같이 적용할까요? 각 사진의 기존 사용자 이미지는 이 배치로 바뀝니다.`))return;
    editor.assets=new Map();// the apply loop owns these bitmaps now; closed below
    const epoch=generation,problems=[];let done=0;
    lock(true);
    try{
      const label=await campusLabel(currentSet?.campusId||$('draftCampus').value);
      for(const index of targets){
        if(epoch!==generation)return;
        const item=items[index],slot=slotNumber(item,index);
        $('igLayerStatus').textContent=`${slot}번 사진에 적용 중… (${done+problems.length+1}/${targets.length})`;
        try{
          const own=index===editor.index?layers:layers.map(layer=>({...layer,id:crypto.randomUUID()}));
          const background=item.backgroundFileId||item.sourceId;
          const {blob,layers:placed}=await composeInstagram('/api/data-core/files/'+encodeURIComponent(background),item.design,label,undefined,{layers:own,assets});
          const saved=await saveRender(item.draftId,item.fingerprint,background,blob,placed);
          if(epoch!==generation)return;
          items[index]={...item,renderId:saved.renderId,fingerprint:saved.fingerprint,masterFileId:saved.file.id,layers:placed};
          if(index===activeIndex){releasePreview();localPreview={fileId:saved.file.id,url:URL.createObjectURL(blob)};}
          done++;
        }catch(error){problems.push(`${slot}번: ${error.message}`);}
      }
    }catch(error){problems.push(error.message);}
    finally{for(const image of assets.values())image.close();lock(false);}
    if(epoch!==generation)return;
    closeLayerEditor();items=[...items];preview(Math.min(activeIndex,items.length-1));
    // The saved set follows its pictures; its caption stays as it is (layers never re-run the AI).
    const setSaved=done&&currentSet?await saveSet():true;
    $('igStatus').textContent=`사용자 이미지 적용 · ${done}장 완료${problems.length?` · ${problems.length}장 실패 — ${problems.join(' / ')}`:''}${setSaved?'':' · 세트 저장은 위의 [변경사항 저장]으로 다시 시도해주세요.'}`;
    buttons();void downloads();
  };

  updateTemplateSummary();updatePresetsSummary();
  return {read,refresh,applyText,hasUnsaved:()=>Boolean(busy||editor.dirty||(!currentSet&&(items.length||$('aiCommand').value.trim()))||(currentSet&&$('igCaptionText').value!==(currentSet.caption||''))),invalidated:clear,load:()=>{if(!busy)clear();},selectionChanged(){const key=JSON.stringify(state.selectedFileIds);if(key!==selected){selected=key;clear();}buttons();},restore:async()=>{toast('이전 단일 초안입니다. 사진을 선택해 새 이미지 세트로 제작하세요.');},
    applyDefaults(settings){
      if(!settings)return;
      // A campus default saved while 나만의 로고 replaced the official logo becomes what it is now: no
      // official logo, plus that image as a user layer.
      const custom=CUSTOM_LOGO_PATTERN.test(settings.logoType)?settings.logoType.slice('custom:'.length):null;
      campusDefaultLogoType=custom?'none':settings.logoType;campusDefaultMode=settings.mode;if(templateSnapshot)return;
      logoType=campusDefaultLogoType;$('igMode').value=settings.mode;
      if(custom&&!overlayChoices.some(v=>v.id===custom))overlayChoices=[...overlayChoices,{id:custom,name:'나만의 로고'}];
      $('igLogos').querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.logo===logoType)));syncOverlayChoices();
    }};
}
