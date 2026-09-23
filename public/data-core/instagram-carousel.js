import {LOGOS,normalizeDesign} from './instagram-brand-policy.js';
import {composeInstagram,drawLogo} from './instagram-layout.js?v=20260921-performance';
import {assembleCaption,captionTail,replaceManagedTail,assertResolvedText} from './content-caption.js?v=20260922-presets';
import {normalizeTags} from './content-preset-catalog.js';
import {optimizeImageForAi} from './image-ai-optimize.js?v=20260923-imgfix';

const btnHtml=(id,label)=>`<button type="button" class="ghost-btn" id="${id}">${label}</button>`;

export function mountInstagramProduction({state,api,$,toast,canWrite,contact=()=>''}) {
  document.body.classList.add('instagram-carousel-mode');
  const command=$('aiCommand').closest('.workflow-section'),section=document.createElement('section');
  section.className='workflow-section ig-carousel';section.id='instagramProduction';
  section.innerHTML=`<div class="workflow-status-row"><span id="igTemplateSummary" role="status"></span>${btnHtml('igOpenTemplate','양식 수정')}</div>
    <div class="workflow-status-row"><span id="igPresetsSummary" role="status"></span>${btnHtml('igOpenPresets','마무리 수정')}</div>
    <dialog id="igTemplateDialog" class="workflow-dialog" aria-labelledby="igTemplateDialogTitle">
      <div class="workflow-heading"><h2 id="igTemplateDialogTitle">양식 수정</h2>${btnHtml('igCloseTemplate','닫기')}</div>
      <h3>로고 선택</h3><div id="igLogos" class="ig-logo-options" role="group" aria-label="공식 로고"></div>
      <div class="ig-options"><label>제작 방식<select id="igMode"><option value="original">작품 전체 보존</option><option value="photo-layout">공간·학원 사진 크게 배치</option><option value="photo">사진 보정 · AI</option></select></label><span id="igCampusLabel" role="status"></span></div>
      <div class="blog-actions">${btnHtml('igApplyTemplate','이번 글에 적용')}${btnHtml('igSaveTemplate','캠퍼스 기본값으로 저장')}${btnHtml('igCancelTemplate','취소')}</div>
      <span id="igTemplateStatus" role="status"></span>
    </dialog>
    <p id="igSourceNotice" role="status" hidden></p>
    <div class="form-actions"><button type="button" id="igGenerate" class="primary-btn" disabled>이미지 만들기</button><button type="button" id="igCancel" class="ghost-btn" hidden>중단</button></div>
    <div id="igProgressWrap" class="ig-progress" hidden><label for="igProgress">전체 단계 진행률 <output id="igPercent">0%</output></label><progress id="igProgress" max="100" value="0"></progress></div><p id="igStatus" role="status" aria-live="polite"></p>`;
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
  let campusDefaultLogoType='anihi',campusDefaultMode='original',templateSnapshot=null;
  let localPreview=null;
  let imageState='new',hasSaved=false;
  let captionBusy=false,captionEpoch=0,captionController=null;
  let managedTail=null;
  function captionLock(value){captionBusy=value;for(const id of ['igCaptionText','igCaptionSave','igCaptionRetry'])$(id).disabled=value;}
  const backgrounds=new Map();
  const previewUrl=item=>localPreview?.fileId===item.masterFileId?localPreview.url:'/api/data-core/files/'+encodeURIComponent(item.masterFileId);
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
    $('igGenerate').textContent=originalMode()||preserved===state.selectedFileIds.length?'이미지 만들기':'AI로 이미지 만들기';$('igCancel').hidden=!busy||!controller; }
  function lock(value){busy=value;state.busy=value;$('photoHeading').closest('.workflow-section').inert=value;command.inert=value;$('igLogos').inert=value;$('igMode').disabled=value;history.inert=value;result.querySelectorAll('button,textarea').forEach(el=>el.disabled=value);buttons();}
  function clear(keepBackgrounds=false){managedTail=null;captionEpoch++;captionController?.abort();captionLock(false);if(keepBackgrounds!==true)backgrounds.clear();releasePreview();generation++;items=[];currentSet=null;signature='';requestId='';imageState='new';result.hidden=true;$('igProgressWrap').hidden=true;$('igProgress').value=0;$('igPercent').textContent='0%';$('igPreview').removeAttribute('src');$('igSlides').replaceChildren();$('igDownloads').replaceChildren();$('igCaptionSection').hidden=true;$('igCaptionText').value='';$('igCaptionStatus').textContent='';$('igStatus').textContent=hasSaved?'변경사항 미저장':'';$('igSaved').textContent=hasSaved?'변경사항 미저장':'저장 전';$('igCaptionRetry').hidden=true;buttons();}
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
    }catch(error){if(epoch===policyEpoch)$('igCampusLabel').textContent=error.message;}
    buttons();
  }
  function preview(index=0){activeIndex=index;$('igPreview').src=previewUrl(items[index]);$('igSlides').replaceChildren(...items.map((item,i)=>{
    const button=document.createElement('button');button.type='button';button.setAttribute('aria-pressed',String(i===index));button.textContent=String(i+1);button.onclick=()=>preview(i);return button;
  }));result.hidden=false;}
  $('igPreview').onclick=()=>window.DataCoreImageGallery.open({scope:'instagram-set',title:'인스타 이미지',anchor:$('igPreview'),index:activeIndex,items:items.map((item,i)=>({src:previewUrl(item),title:`${i+1} / ${items.length}`}))});
  $('igMode').onchange=()=>{clear();updateTemplateSummary();};$('aiCommand').addEventListener('input',clear);
  $('igCancel').onclick=()=>controller?.abort();
  $('igGenerate').onclick=async()=>{
    if(busy||!canWrite()||state.selectedFileIds.length<1||state.selectedFileIds.length>10)return;
    if(!originalMode()&&state.selectedFileIds.some(id=>!preserveSource(id))&&!$('aiCommand').value.trim())return toast('원하는 느낌을 입력해주세요.','error');
    const ids=[...state.selectedFileIds],campusId=$('draftCampus').value,design=read(),direction=$('aiCommand').value.trim()||'선택한 원본을 인스타그램 4:5 규격으로 배치';
    const backgroundKey=id=>JSON.stringify([campusId,id,direction,$('igMode').value]);
    const pending=ids.filter(id=>!preserveSource(id)&&!backgrounds.has(backgroundKey(id)));
    if(!originalMode()&&pending.length&&!confirm(`선택한 ${pending.length}장의 사진만 외부 AI에 전송합니다. 학생 작품·로고·성적 자료가 아니며 홍보 사용과 AI 처리 동의가 확인된 사진인가요?`))return;
    if((originalMode()||ids.every(preserveSource))&&!confirm(`선택한 ${ids.length}장의 홍보 사용 권한을 확인했나요? 원본을 보존하며, 홍보글 작성에는 사진 없이 입력한 방향만 AI에 전송합니다.`))return;
    clear(true);signature=snapshot();requestId=crypto.randomUUID();const epoch=generation;controller=new AbortController();lock(true);
    let stage='캠퍼스 확인';
    progress(0,stage+' 중...');
    try{
      await logos();if(!policy||policy.campusId!==campusId)throw Error('캠퍼스 정보를 확인하세요.');
      for(let i=0;i<ids.length;i++){
        controller.signal.throwIfAborted();
        const preserve=preserveSource(ids[i]);
        const itemDesign=preserve?normalizeDesign({...design,materialKind:'student-artwork',externalAiConsent:false}):design;
        const reportProgress=(fraction,message)=>progress((i+fraction)/ids.length*100,message);
        stage=`${i+1} / ${ids.length} ${preserve?'원본 보존 제작':'이미지 제작'}`;reportProgress(.05,stage+' 중...');let backgroundId=ids[i];
        if(itemDesign.externalAiConsent){
          stage=`${i+1} / ${ids.length} AI 사진 보정`;
          if(!backgrounds.has(backgroundKey(ids[i]))){
            reportProgress(.08,stage+' · 사진 준비 중');
            const photoFile=state.knownFiles.get(String(ids[i]));
            if(!photoFile)throw Error('선택한 사진 정보를 확인할 수 없습니다. 사진을 다시 선택해주세요.');
            const optimized=await optimizeImageForAi(photoFile);
            reportProgress(.1,stage+' · AI 응답 대기');
            const timer=setTimeout(()=>controller?.abort(),290000);
            try{backgroundId=(await postWithPhoto('image-edit',{sourceApp:'instagram',campusId,sourceFileId:ids[i],direction,material:itemDesign,requestId:crypto.randomUUID()},ids[i],optimized,controller.signal)).file.id;backgrounds.set(backgroundKey(ids[i]),backgroundId);}finally{clearTimeout(timer);}
          } else backgroundId=backgrounds.get(backgroundKey(ids[i]));
        }
        stage=`${i+1} / ${ids.length} ${preserve?'원본 보존·로고 합성':'로고 합성'}`;reportProgress(.75,stage+' 중...');
        // Only one decoded image at a time; metadata work can overlap composition.
        const [blob,report]=await Promise.all([
          composeInstagram('/api/data-core/files/'+encodeURIComponent(backgroundId),itemDesign,policy.campusLogoLabel,controller.signal),
          (async()=>{const draft=(await post('',{sourceApp:'instagram',campusId,title:`인스타 이미지 ${i+1}`,summary:direction,relatedFileIds:[ids[i]],metadata:{instagramDesign:itemDesign}},controller.signal)).draft;return {draft,...await api(`/api/data-core/content/instagram/${draft.id}/review`,{signal:controller.signal})};})(),
        ]);
        controller.signal.throwIfAborted();stage=`${i+1} / ${ids.length} 이미지 저장`;reportProgress(.9,stage+' 중...');
        const draft=report.draft;
        const form=new FormData();form.set('file',blob,'instagram-master.png');form.set('fingerprint',report.fingerprint);form.set('backgroundFileId',backgroundId);
        const saved=await api(`/api/data-core/content/instagram/${draft.id}/render`,{method:'POST',body:form,signal:controller.signal});
        if(epoch!==generation)return;
        // Keep only the latest saved frame in memory; no redundant multi-MB GET
        // for its preview. Earlier slides/history still use authenticated reads.
        releasePreview();localPreview={fileId:saved.file.id,url:URL.createObjectURL(blob)};
        items.push({sourceId:ids[i],draftId:draft.id,renderId:saved.renderId,fingerprint:saved.fingerprint,masterFileId:saved.file.id});preview(i);reportProgress(1,`${i+1} / ${ids.length} 이미지 제작 완료`);
        // A completed photo's own draft/render is already persisted server-side — its individual
        // download does not need to wait for the rest of the batch (or the bundled 세트 save).
        void downloads();
      }
      $('igStatus').textContent=`${items.length}장 제작 완료`;$('igSaved').textContent=hasSaved?'변경사항 미저장':'저장 전';
    }catch(error){$('igStatus').textContent=error.name==='AbortError'?'작업을 중단했습니다. 이미 전송된 AI 작업은 과금될 수 있습니다.':`${stage}: ${error.message}`;
      if(items.length){$('igSaved').textContent=`${items.length}장 완료 · 완료된 사진은 아래에서 개별로 받을 수 있습니다. 나머지는 다시 시도해주세요.`;void downloads();}
    }finally{controller=null;lock(false);}
  };
  async function downloads(){
    $('igDownloads').replaceChildren(...items.map((item,index)=>{
      const button=document.createElement('button');let downloading=false;button.className='secondary-btn';button.type='button';button.innerHTML=`<svg aria-hidden="true"><use href="/data-core/assets/core-icons.svg#Download"></use></svg>${index+1}번 이미지 다운로드`;
      button.onclick=async()=>{if(downloading)return;downloading=true;button.disabled=true;try{
        const response=await fetch(`/api/data-core/content/instagram/${item.draftId}/export`,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({renderId:item.renderId,fingerprint:item.fingerprint})});
        if(!response.ok)throw Error((await response.json()).error||'다운로드하지 못했습니다.');
        const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=`instagram-${index+1}-1080x1350.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
      }catch(error){toast(error.message,'error');}finally{downloading=false;button.disabled=false;}};return button;
    }));
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
          const generated=(await post('generate',{sourceApp:'instagram',campusId:target.campusId,selectedFileIds:ids,textOnly,notes:`${direction}\n${label}. ${textOnly?'사진은 제공하지 않았습니다. 사용자가 명시한 내용만 사용하세요.':'사진에서 확인 가능한 내용만 사용하세요.'} 제목형 도입과 본문 ${batches.length>1?'3':'3~6'}문장으로 작성하고 전화번호·날짜·실적은 만들지 마세요.`,material:design,requestId:crypto.randomUUID()},abort.signal)).generated;
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
      button.onclick=async()=>{if(busy)return;lock(true);try{const saved=await api('/api/data-core/content/instagram-sets/'+encodeURIComponent(item.id));clear();currentSet=saved;managedTail=saved.managedTail??null;items=saved.items;preview();await downloads();$('igSaved').textContent='저장된 최종본';$('igCaptionText').value=saved.caption;$('igCaptionSection').hidden=false;}catch(error){toast(error.message,'error');}finally{lock(false);}};return button;
    }));if(!data.sets.length)$('igHistory').textContent='저장된 이미지 세트가 없습니다.';}catch(error){if(campusId===$('draftCampus').value)$('igHistory').textContent=error.message;}
  }
  history.ontoggle=loadHistory;
  function refresh(){void logos();void loadHistory();buttons();}
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
    applyDefaults(settings){if(!settings)return;campusDefaultLogoType=settings.logoType;campusDefaultMode=settings.mode;if(templateSnapshot)return;logoType=settings.logoType;$('igMode').value=settings.mode;$('igLogos').querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.logo===logoType)));updateTemplateSummary();}};
}
