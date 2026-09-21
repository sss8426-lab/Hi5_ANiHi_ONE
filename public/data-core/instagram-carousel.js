import {LOGOS,normalizeDesign} from './instagram-brand-policy.js';
import {composeInstagram,drawLogo} from './instagram-layout.js';

export function mountInstagramProduction({state,api,$,toast,canWrite}) {
  document.body.classList.add('instagram-carousel-mode');
  const command=$('aiCommand').closest('.workflow-section'),section=document.createElement('section');
  section.className='workflow-section ig-carousel';section.id='instagramProduction';
  section.innerHTML=`<h2>로고 선택</h2><div id="igLogos" class="ig-logo-options" role="group" aria-label="공식 로고"></div>
    <div class="ig-options"><label>제작 방식<select id="igMode"><option value="original">작품 전체 보존</option><option value="photo-layout">공간·학원 사진 크게 배치</option><option value="photo">사진 보정 · AI</option></select></label><span id="igCampusLabel" role="status"></span></div>
    <div class="form-actions"><button type="button" id="igGenerate" class="primary-btn" disabled>이미지 만들기</button><button type="button" id="igCancel" class="ghost-btn" hidden>중단</button></div><p id="igStatus" role="status" aria-live="polite"></p>`;
  command.after(section);
  const result=document.createElement('section');result.className='workflow-section ig-carousel';result.id='igResult';result.hidden=true;
  result.innerHTML=`<h2>결과 미리보기</h2><div id="igSlides" class="ig-slide-tabs" aria-label="이미지 순서"></div><figure class="ig-preview"><img id="igPreview" alt="인스타 최종 이미지 미리보기" width="2160" height="2700"></figure>
    <div class="form-actions"><button id="igComplete" type="button" class="primary-btn" disabled>완료 및 저장</button><span id="igSaved" role="status"></span></div>
    <div id="igDownloads" class="form-actions"></div>
    <section id="igCaptionSection" hidden><h2>인스타 홍보용 글</h2><textarea id="igCaptionText" rows="8" maxlength="12000" aria-label="인스타 홍보용 글"></textarea><div class="form-actions"><button id="igCopy" type="button" class="secondary-btn">문구 복사</button><button id="igCaptionSave" type="button" class="ghost-btn">문구 저장</button><button id="igCaptionRetry" type="button" class="ghost-btn" hidden>홍보글 다시 작성</button></div><p id="igCaptionStatus" role="status"></p></section>`;
  section.after(result);
  const history=document.createElement('details');history.className='workflow-details';history.innerHTML='<summary>저장한 이미지 세트</summary><div id="igHistory"></div>';result.after(history);
  const defaults=document.createElement('details');defaults.className='workflow-details';defaults.innerHTML='<summary>기본 해시태그·문의 문구</summary>';
  defaults.append(command.querySelector('.defaults-grid'),command.querySelector('.defaults-actions'));$('igCaptionSection').append(defaults);
  let logoType='anihi',policy=null,policyEpoch=0,generation=0,busy=false,items=[],currentSet=null,controller=null,selected='',signature='',requestId='',activeIndex=0;
  let localPreview=null;
  const previewUrl=item=>localPreview?.fileId===item.masterFileId?localPreview.url:'/api/data-core/files/'+encodeURIComponent(item.masterFileId);
  function releasePreview(){if(localPreview)URL.revokeObjectURL(localPreview.url);localPreview=null;}
  const originalMode=()=>$('igMode').value!=='photo';
  const read=()=>normalizeDesign({workflow:'carousel-v2',logoType,templateId:'academy',materialKind:$('igMode').value==='original'?'student-artwork':'real-photo',usePermission:'allowed',externalAiConsent:!originalMode(),contact:$('defaultFooter').value});
  const snapshot=()=>JSON.stringify([state.selectedFileIds,$('draftCampus').value,$('aiCommand').value,logoType,$('igMode').value]);
  const post=(path,body,signal)=>api('/api/data-core/content'+(path?'/'+path:''),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:signal||AbortSignal.timeout(150000)});
  function buttons(){ $('igGenerate').disabled=busy||!canWrite()||!state.selectedFileIds.length||!$('draftCampus').value;
    $('igComplete').disabled=busy||!items.length||items.length!==state.selectedFileIds.length||signature!==snapshot()||Boolean(currentSet);
    $('igGenerate').textContent=originalMode()?'이미지 만들기':'AI로 이미지 만들기';$('igCancel').hidden=!busy||!controller; }
  function lock(value){busy=value;state.busy=value;$('photoHeading').closest('.workflow-section').inert=value;command.inert=value;$('igLogos').inert=value;$('igMode').disabled=value;history.inert=value;result.querySelectorAll('button,textarea').forEach(el=>el.disabled=value);buttons();}
  function clear(){releasePreview();generation++;items=[];currentSet=null;signature='';requestId='';result.hidden=true;$('igPreview').removeAttribute('src');$('igSlides').replaceChildren();$('igDownloads').replaceChildren();$('igCaptionSection').hidden=true;$('igCaptionText').value='';$('igCaptionStatus').textContent='';$('igStatus').textContent='';$('igSaved').textContent='';$('igCaptionRetry').hidden=true;buttons();}
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
        button.onclick=()=>{if(busy)return;logoType=id;clear();$('igLogos').querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.logo===id)));};
        void drawLogo(canvas,id,value.campusLogoLabel).catch(()=>{if(epoch===policyEpoch){canvas.replaceWith(Object.assign(document.createElement('img'),{src:spec.src,alt:spec.label}));button.title='로고 미리보기를 다시 불러오려면 캠퍼스를 다시 선택하세요.';}});
      }
    }catch(error){if(epoch===policyEpoch)$('igCampusLabel').textContent=error.message;}
    buttons();
  }
  function preview(index=0){activeIndex=index;$('igPreview').src=previewUrl(items[index]);$('igSlides').replaceChildren(...items.map((item,i)=>{
    const button=document.createElement('button');button.type='button';button.setAttribute('aria-pressed',String(i===index));button.textContent=String(i+1);button.onclick=()=>preview(i);return button;
  }));result.hidden=false;}
  $('igPreview').onclick=()=>window.DataCoreImageGallery.open({scope:'instagram-set',title:'인스타 이미지',anchor:$('igPreview'),index:activeIndex,items:items.map((item,i)=>({src:previewUrl(item),title:`${i+1} / ${items.length}`}))});
  $('igMode').onchange=clear;$('aiCommand').addEventListener('input',clear);
  $('igCancel').onclick=()=>controller?.abort();
  $('igGenerate').onclick=async()=>{
    if(busy||!canWrite()||state.selectedFileIds.length<1||state.selectedFileIds.length>10)return;
    if(!originalMode()&&!$('aiCommand').value.trim())return toast('원하는 느낌을 입력해주세요.','error');
    const ids=[...state.selectedFileIds],campusId=$('draftCampus').value,design=read(),direction=$('aiCommand').value.trim()||'선택한 원본을 인스타그램 4:5 규격으로 배치';
    if(!originalMode()&&!confirm(`선택한 ${ids.length}장의 사진만 외부 AI에 전송합니다. 학생 작품·로고·성적 자료가 아니며 홍보 사용과 AI 처리 동의가 확인된 사진인가요?`))return;
    if(originalMode()&&!confirm(`선택한 ${ids.length}장의 홍보 사용 권한을 확인했나요? 원본을 보존하며, 홍보글 작성에는 사진 없이 입력한 방향만 AI에 전송합니다.`))return;
    clear();signature=snapshot();requestId=crypto.randomUUID();const epoch=generation;controller=new AbortController();lock(true);
    let stage='캠퍼스 확인';
    try{
      await logos();if(!policy||policy.campusId!==campusId)throw Error('캠퍼스 정보를 확인하세요.');
      for(let i=0;i<ids.length;i++){
        controller.signal.throwIfAborted();stage=`${i+1} / ${ids.length} 이미지 제작`;$('igStatus').textContent=stage+' 중...';let backgroundId=ids[i];
        if(design.externalAiConsent){
          stage=`${i+1} / ${ids.length} AI 사진 보정`;$('igStatus').textContent=stage+' 중...';
          const timer=setTimeout(()=>controller?.abort(),290000);
          try{backgroundId=(await post('image-edit',{sourceApp:'instagram',campusId,sourceFileId:ids[i],direction,material:design,requestId:crypto.randomUUID()},controller.signal)).file.id;}finally{clearTimeout(timer);}
        }
        stage=`${i+1} / ${ids.length} 로고 합성`;$('igStatus').textContent=stage+' 중...';
        const blob=await composeInstagram('/api/data-core/files/'+encodeURIComponent(backgroundId),design,policy.campusLogoLabel,controller.signal);
        stage=`${i+1} / ${ids.length} 이미지 저장`;$('igStatus').textContent=stage+' 중...';
        const draft=(await post('',{sourceApp:'instagram',campusId,title:`인스타 이미지 ${i+1}`,summary:direction,relatedFileIds:[ids[i]],metadata:{instagramDesign:design}},controller.signal)).draft;
        const report=await api(`/api/data-core/content/instagram/${draft.id}/review`,{signal:controller.signal});
        const form=new FormData();form.set('file',blob,'instagram-master.png');form.set('fingerprint',report.fingerprint);form.set('backgroundFileId',backgroundId);
        const saved=await api(`/api/data-core/content/instagram/${draft.id}/render`,{method:'POST',body:form,signal:controller.signal});
        if(epoch!==generation)return;
        // Keep only the latest saved frame in memory; no redundant multi-MB GET
        // for its preview. Earlier slides/history still use authenticated reads.
        releasePreview();localPreview={fileId:saved.file.id,url:URL.createObjectURL(blob)};
        items.push({draftId:draft.id,renderId:saved.renderId,fingerprint:saved.fingerprint,masterFileId:saved.file.id});preview(i);
      }
      $('igStatus').textContent=`${items.length}장 제작 완료`;$('igSaved').textContent='';
    }catch(error){$('igStatus').textContent=error.name==='AbortError'?'작업을 중단했습니다. 이미 전송된 AI 작업은 과금될 수 있습니다.':`${stage}: ${error.message}`;
      if(items.length)$('igSaved').textContent=`${items.length}장만 제작되었습니다. 전체 제작 완료 후 저장할 수 있습니다.`;
    }finally{controller=null;lock(false);}
  };
  async function downloads(){
    $('igDownloads').replaceChildren(...items.map((item,index)=>{
      const button=document.createElement('button');let downloading=false;button.className='secondary-btn';button.type='button';button.textContent=`${index+1}번 PNG 다운로드`;
      button.onclick=async()=>{if(downloading)return;downloading=true;button.disabled=true;try{
        const response=await fetch(`/api/data-core/content/instagram/${item.draftId}/export`,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({renderId:item.renderId,fingerprint:item.fingerprint})});
        if(!response.ok)throw Error((await response.json()).error||'다운로드하지 못했습니다.');
        const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=`instagram-${index+1}-1080x1350.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
      }catch(error){toast(error.message,'error');}finally{downloading=false;button.disabled=false;}};return button;
    }));
  }
  async function caption(){
    if(!currentSet||busy)return;lock(true);$('igDownloads').querySelectorAll('button').forEach(button=>button.disabled=false);$('igCancel').hidden=true;$('igCaptionSection').hidden=false;$('igCaptionRetry').hidden=true;$('igCaptionStatus').textContent='홍보글을 작성하고 있습니다...';
    try{
      let body='',title='',tags=[];
      const batches=originalMode()?[state.selectedFileIds]:[state.selectedFileIds.slice(0,5),state.selectedFileIds.slice(5)].filter(ids=>ids.length);
      for(const ids of batches){
          const generated=(await post('generate',{sourceApp:'instagram',campusId:currentSet.campusId,selectedFileIds:ids,textOnly:originalMode(),notes:`${$('aiCommand').value.trim()}\n${policy.campusLogoLabel}. ${originalMode()?'사진은 제공하지 않았습니다. 사용자가 명시한 내용만 사용하세요.':'사진에서 확인 가능한 내용만 사용하세요.'} 제목형 도입과 본문 ${batches.length>1?'3':'3~6'}문장으로 작성하고 전화번호·날짜·실적은 만들지 마세요.`,material:read(),requestId:crypto.randomUUID()})).generated;
          title ||= generated.title;body += (body?'\n':'')+(generated.body||generated.content||'');tags.push(...(generated.hashtags||generated.keywords||[]));
      }
      $('igCaptionStatus').textContent=originalMode()?'사진 전송 없이 작성 완료 · 게시 전에 내용을 확인하세요.':'홍보글 작성 완료 · 게시 전에 내용을 확인하세요.';
      tags=[...new Set([...tags,...$('defaultHashtags').value.split(/[\s,#]+/)].map(t=>t.replace(/^#/,'' )).filter(Boolean))].slice(0,30);
      $('igCaptionText').value=[title,body,$('defaultFooter').value||'궁금한 점은 DM으로 문의해주세요.',tags.map(t=>'#'+t).join(' ')].filter(Boolean).join('\n\n');
      await saveCaption();
    }catch{$('igCaptionStatus').textContent='이미지 저장은 완료되었습니다. 홍보글은 작성하지 못했습니다. 다시 작성하거나 직접 입력할 수 있습니다.';$('igCaptionRetry').hidden=false;}
    finally{lock(false);}
  }
  async function saveCaption(){if(!currentSet)return;await api('/api/data-core/content/instagram-sets/'+encodeURIComponent(currentSet.id),{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({caption:$('igCaptionText').value})});}
  $('igComplete').onclick=async()=>{
    if(busy||currentSet||signature!==snapshot()||items.length!==state.selectedFileIds.length)return;
    lock(true);let completed=false;
    try{currentSet=await post('instagram-sets',{requestId,items:items.map(({draftId,renderId,fingerprint})=>({draftId,renderId,fingerprint}))});$('igSaved').textContent='저장 완료';await downloads();completed=true;}
    catch(error){$('igSaved').textContent=error.message;}finally{lock(false);}
    if(completed)await caption();
  };
  $('igCopy').onclick=async()=>{try{await navigator.clipboard.writeText($('igCaptionText').value);toast('복사했습니다.');}catch{toast('클립보드 권한을 확인해주세요.','error');}};
  $('igCaptionSave').onclick=async()=>{if(busy)return;lock(true);try{await saveCaption();$('igCaptionStatus').textContent='문구 저장 완료';}catch(error){$('igCaptionStatus').textContent=error.message;}finally{lock(false);}};
  $('igCaptionRetry').onclick=caption;
  async function loadHistory(){
    if(!history.open||!$('draftCampus').value)return;
    const campusId=$('draftCampus').value;$('igHistory').textContent='불러오는 중...';
    try{const data=await api('/api/data-core/content/instagram-sets?campusId='+encodeURIComponent(campusId));if(campusId!==$('draftCampus').value||!history.open)return;$('igHistory').replaceChildren(...data.sets.map(item=>{
      const button=document.createElement('button');button.type='button';button.className='ghost-btn';button.textContent=`${item.title} · ${item.createdAt.slice(0,10)}`;
      button.onclick=async()=>{if(busy)return;lock(true);try{const saved=await api('/api/data-core/content/instagram-sets/'+encodeURIComponent(item.id));clear();currentSet=saved;items=saved.items;preview();await downloads();$('igSaved').textContent='저장된 최종본';$('igCaptionText').value=saved.caption;$('igCaptionSection').hidden=false;}catch(error){toast(error.message,'error');}finally{lock(false);}};return button;
    }));if(!data.sets.length)$('igHistory').textContent='저장된 이미지 세트가 없습니다.';}catch(error){if(campusId===$('draftCampus').value)$('igHistory').textContent=error.message;}
  }
  history.ontoggle=loadHistory;
  function refresh(){void logos();void loadHistory();buttons();}
  return {read,refresh,invalidated:clear,load:()=>{if(!busy)clear();},selectionChanged(){const key=JSON.stringify(state.selectedFileIds);if(key!==selected){selected=key;clear();}buttons();},restore:async()=>{toast('이전 단일 초안입니다. 사진을 선택해 새 이미지 세트로 제작하세요.');}};
}
