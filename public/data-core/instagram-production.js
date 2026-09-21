import { LOGOS, TEMPLATES, MATERIALS, HUMAN_CHECKS, normalizeDesign } from './instagram-brand-policy.js';

export function mountInstagramProduction({ state, api, $, toast, canWrite, saveDraft, setWorkspaceBusy }) {
  const section=document.createElement('section');section.className='workflow-section instagram-production';section.id='instagramProduction';section.hidden=true;
  section.innerHTML=`<h2>로고·게시 이미지</h2>
    <div class="instagram-fields">
      <label>자료 유형<select id="igMaterial">${Object.entries(MATERIALS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>
      <label>홍보 사용 권한<select id="igPermission"><option value="review">확인 필요</option><option value="allowed">사용 가능 · 동의 확인</option><option value="denied">사용 불가</option></select></label>
      <label>템플릿<select id="igTemplate">${Object.entries(TEMPLATES).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></label>
      <label>로고<select id="igLogo">${Object.entries(LOGOS).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></label>
    </div>
    <p id="igCampusLabel" role="status"></p>
    <label>이미지 제목<input id="igHeadline" maxlength="160"></label>
    <label>검증된 전화 문의 또는 DM 안내<input id="igContact" maxlength="160"></label>
    <label class="ig-check"><input type="checkbox" id="igFacts">캠퍼스·문의 정보·날짜·수치를 실제 자료와 대조했습니다.</label>
    <label class="ig-check"><input type="checkbox" id="igAiConsent">선택 자료의 외부 AI 처리 동의를 별도로 확인했습니다.</label>
    <div class="form-actions"><button id="igRender" type="button" class="primary-btn">로고 합성·미리보기</button><button id="igCaption" type="button" class="ghost-btn">AI 홍보 문구 작성</button></div>
    <p id="igStatus" role="status" aria-live="polite"></p>
    <canvas id="igCanvas" width="2160" height="2700" aria-label="인스타 게시 이미지 미리보기" hidden></canvas>
    <section id="igReviewPanel" hidden aria-labelledby="igReviewHeading"><h3 id="igReviewHeading">게시 전 검수</h3><ul id="igChecks"></ul>
      <fieldset id="igHumanChecks"><legend>담당자 확인</legend>${HUMAN_CHECKS.map((key,i)=>`<label class="ig-check"><input type="checkbox" data-ig-check="${key}">${['학생 작품 전체·원형 보존','로고·캠퍼스 표기와 배치','디자인 완성도·여백','AI 보조 이미지 오류 또는 해당 없음','개인정보·얼굴·이름표 노출 및 동의','휴대폰에서 글자 가독성','캡션·이미지의 숫자·날짜·실적 일치'][i]}</label>`).join('')}</fieldset>
      <div class="form-actions"><button id="igApprove" type="button" class="primary-btn">현재 버전 승인</button><button id="igExport" type="button" class="secondary-btn" disabled>게시용 1080 × 1350 내보내기</button></div>
      <p id="igApproval" role="status"></p></section>`;
  $('aiCommand').closest('.workflow-section').before(section);
  let policy=null,report=null,renderId='',busy=false,generation=0,selected='',renderedSnapshot='';
  const canvas=$('igCanvas');
  const read=()=>normalizeDesign({templateId:$('igTemplate').value,logoType:$('igLogo').value,materialKind:$('igMaterial').value,
    usePermission:$('igPermission').value,externalAiConsent:$('igAiConsent').checked,headline:$('igHeadline').value,contact:$('igContact').value,factsVerified:$('igFacts').checked});
  const snapshot=()=>JSON.stringify({design:read(),campus:$('draftCampus').value,ids:state.selectedFileIds,derived:state.selectedDerivedFileIds,
    title:$('draftTitle').value,content:$('draftContent').value,tags:$('draftTags').value,footer:$('resultFooter').value,summary:$('draftSummary').value,purpose:$('contentPurpose').value,status:$('publishStatus').value});
  function invalidated(){generation++;report=null;renderId='';$('igExport').disabled=true;$('igApprove').disabled=true;$('igApproval').textContent='검사 미실행 · 변경 후 미리보기와 재승인이 필요합니다.';section.querySelectorAll('[data-ig-check]').forEach(el=>el.checked=false);}
  function setBusy(value){busy=value;setWorkspaceBusy(value);$('draftForm').inert=value;$('photoHeading').closest('.workflow-section').inert=value;section.querySelectorAll('input,select,button').forEach(el=>el.disabled=value);$('igExport').disabled=value||!report?.approved;$('igApprove').disabled=value||!report?.canApprove;}
  async function refreshPolicy(){
    policy=null;const campus=$('draftCampus').value;
    if(state.sourceApp!=='instagram')return;
    if(!campus){$('igCampusLabel').textContent='제작할 캠퍼스를 선택하세요.';return;}
    try{const result=await api('/api/data-core/content/instagram-policy?campusId='+encodeURIComponent(campus));if(campus!==$('draftCampus').value)return;policy=result;$('igCampusLabel').textContent=`로고 표시: ${policy.campusLogoLabel} · ${policy.campusName}`;}
    catch(error){$('igCampusLabel').textContent=error.message;}
  }
  function showReport(value){report=value;$('igReviewPanel').hidden=false;$('igChecks').replaceChildren(...value.checks.map(check=>{const li=document.createElement('li');li.textContent=`${({pass:'통과',needs_changes:'수정 필요',human_required:'사람 확인 필요',not_run:'검사 미실행'})[check.status]} · ${check.message}`;return li;}));$('igApprove').disabled=!value.canApprove;$('igExport').disabled=!value.approved;$('igApproval').textContent=value.approved?'현재 버전 승인 완료 · 자동 게시 꺼짐':'사람 확인 후 현재 버전을 승인하세요.';}
  async function bitmap(url){const r=await fetch(url,{credentials:'same-origin'});if(!r.ok)throw Error('이미지를 불러오지 못했습니다.');const blob=await r.blob();if(blob.size>20*1024*1024)throw Error('20MB 이하 이미지를 선택하세요.');const image=await createImageBitmap(blob);if(image.width*image.height>40000000){image.close();throw Error('이미지가 너무 큽니다.');}return image;}
  function wrap(ctx,text,width,maxLines){const lines=[];let line='';for(const ch of text){if(ch==='\n'||ctx.measureText(line+ch).width>width){lines.push(line);line=ch==='\n'?'':ch;}else line+=ch;}if(line)lines.push(line);if(lines.length>maxLines)throw Error('문구가 너무 깁니다. 제목은 두 줄, 문의 문구는 두 줄 안으로 줄이세요.');return lines;}
  function contain(ctx,image,x,y,w,h){const s=Math.min(w/image.width,h/image.height);ctx.drawImage(image,x+(w-image.width*s)/2,y+(h-image.height*s)/2,image.width*s,image.height*s);}
  async function draw(backgroundId,design){
    const image=await bitmap('/api/data-core/files/'+encodeURIComponent(backgroundId));let logo;
    try{
      logo=await bitmap(LOGOS[design.logoType].src);await document.fonts.ready;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,2160,2700);
      contain(ctx,logo,120,80,780,210);ctx.fillStyle='#383634';ctx.textAlign='left';ctx.textBaseline='middle';ctx.font='700 70px sans-serif';
      if(ctx.measureText(policy.campusLogoLabel).width>1020)throw Error('캠퍼스 로고 표기를 확인하세요.');ctx.fillText(policy.campusLogoLabel,1010,162);
      ctx.fillRect(1010,215,1000,2);ctx.font='34px sans-serif';ctx.fillText(LOGOS[design.logoType].tagline,1010,262);
      ctx.font='700 78px sans-serif';ctx.textAlign='center';wrap(ctx,design.headline,1920,2).forEach((line,i)=>ctx.fillText(line,1080,365+i*105));
      contain(ctx,image,120,550,1920,1780);
      ctx.font='42px sans-serif';wrap(ctx,design.contact,1900,2).forEach((line,i)=>ctx.fillText(line,1080,2440+i*60));
      if(design.materialKind==='ai-support'){ctx.font='28px sans-serif';ctx.fillStyle='#666666';ctx.fillText('AI 보조 이미지',1080,2610);}
      canvas.hidden=false;
    }finally{image.close();logo?.close();}
  }
  $('igTemplate').onchange=()=>{$('igLogo').value=TEMPLATES[$('igTemplate').value].logo;invalidated();};
  section.addEventListener('input',event=>{if(!event.target.matches('[data-ig-check]'))invalidated();});
  section.addEventListener('change',event=>{if(!event.target.matches('[data-ig-check]'))invalidated();});
  $('draftForm').addEventListener('input',invalidated);$('draftForm').addEventListener('change',invalidated);
  $('igRender').onclick=async()=>{
    if(busy||state.busy||!canWrite())return;
    if(state.selectedFileIds.length!==1)return toast('대표 원본 1장을 선택하세요.','error');
    invalidated();setBusy(true);$('igStatus').textContent='원본과 로고를 합성하고 있습니다…';
    try{
      await refreshPolicy();if(!policy)throw Error('캠퍼스를 선택하세요.');
      if(!$('draftTitle').value.trim())$('draftTitle').value=read().headline||'인스타 게시 이미지';
      $('aiResult').hidden=false;
      const draft=await saveDraft({preventDefault(){}});if(!draft)throw Error('초안을 저장한 뒤 다시 시도하세요.');
      const current=await api(`/api/data-core/content/instagram/${draft.id}/review`),start=snapshot(),token=generation;
      const backgroundId=read().materialKind==='ai-support'&&state.aiFile&&state.aiSourceId===state.selectedFileIds[0]?state.aiFile.id:state.selectedFileIds[0];
      await draw(backgroundId,read());const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      if(start!==snapshot()||token!==generation)throw Error('내용이 변경되었습니다. 다시 미리보기를 만드세요.');
      const form=new FormData();form.set('file',blob,'instagram-master.png');form.set('fingerprint',current.fingerprint);form.set('backgroundFileId',backgroundId);
      const result=await api(`/api/data-core/content/instagram/${draft.id}/render`,{method:'POST',body:form});
      if(start!==snapshot()||token!==generation)throw Error('내용이 변경되었습니다. 다시 미리보기를 만드세요.');
      renderId=result.renderId;renderedSnapshot=start;
      showReport(await api(`/api/data-core/content/instagram/${draft.id}/review?renderId=${renderId}`));$('igStatus').textContent='원본 보존 · 마스터 2160 × 2700 저장 완료';
    }catch(error){$('igStatus').textContent=error.message;}finally{setBusy(false);}
  };
  $('igApprove').onclick=async()=>{
    if(busy||!report||snapshot()!==renderedSnapshot)return invalidated();
    setBusy(true);try{const checks=Object.fromEntries([...section.querySelectorAll('[data-ig-check]')].map(el=>[el.dataset.igCheck,el.checked]));showReport(await api(`/api/data-core/content/instagram/${state.editingDraftId}/approve`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({renderId,fingerprint:report.fingerprint,checks})}));}catch(error){$('igApproval').textContent=error.message;}finally{setBusy(false);}
  };
  $('igExport').onclick=async()=>{
    if(busy||!report?.approved||snapshot()!==renderedSnapshot)return invalidated();
    setBusy(true);try{const response=await fetch(`/api/data-core/content/instagram/${state.editingDraftId}/export`,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({renderId,fingerprint:report.fingerprint})});if(!response.ok)throw Error((await response.json()).error||'재승인이 필요합니다.');const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download='instagram-1080x1350.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch(error){$('igApproval').textContent=error.message;}finally{setBusy(false);}
  };
  return {read,invalidated,
    async restore(id){const token=generation;try{const value=await api(`/api/data-core/content/instagram/${id}/review`);if(token!==generation||id!==state.editingDraftId||!value.renderId)return;renderId=value.renderId;renderedSnapshot=snapshot();showReport(value);const image=await bitmap('/api/data-core/files/'+encodeURIComponent(value.masterFileId));try{if(token!==generation)return;canvas.getContext('2d').drawImage(image,0,0);canvas.hidden=false;}finally{image.close();}}catch(error){if(token===generation)$('igStatus').textContent=error.message;}},
    refresh(){section.hidden=state.sourceApp!=='instagram';void refreshPolicy();},
    selectionChanged(){const key=JSON.stringify(state.selectedFileIds);if(selected===key)return;selected=key;invalidated();$('igPermission').value='review';$('igAiConsent').checked=false;},
    load(design){const d=normalizeDesign(design);for(const [id,key]of [['igTemplate','templateId'],['igLogo','logoType'],['igMaterial','materialKind'],['igPermission','usePermission'],['igHeadline','headline'],['igContact','contact']])$(id).value=d[key];$('igAiConsent').checked=d.externalAiConsent;$('igFacts').checked=d.factsVerified;invalidated();canvas.hidden=true;$('igReviewPanel').hidden=true;void refreshPolicy();},
  };
}
