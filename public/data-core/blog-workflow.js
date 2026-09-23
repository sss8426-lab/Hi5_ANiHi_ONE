import {BLOG_SCHEMA,BLOG_TEMPLATES,PHOTO_KINDS,templateDefaults,synchronizePhotos,assembleBlocks,publishingImages,postText,inspectPost} from './blog-post-model.js';
import {buildDownload,startDownload,resolveFiles} from './blog-download.js';
import {normalizeTags} from './content-preset-catalog.js';
import {mountBlogCover} from './blog-cover.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const options=map=>Object.entries(map).map(([id,label])=>`<option value="${id}">${label}</option>`).join('');
const command=(id,label)=>`<button type="button" class="ghost-btn" id="${id}">${label}</button>`;
export function mountBlogWorkflow({state,$,toast,renderSelection,contact}){
  if(state.sourceApp!=='blog')return null;
  let photos=[],blocks=[],template=templateDefaults(),revision=0,epoch=0,defaultsEdit=0,downloadController,saving=false,lastBody='',saved='',pendingSave=null;
  const timings={},undo=[];let cover=null,reviewCache=new Map(),textController,reviewSnapshot='',reviewResult=null,templates={};
  const selection=document.createElement('div');selection.className='blog-workflow';
  selection.innerHTML=`<div class="blog-actions">${command('blogOriginals','선택한 원본 사진 다운로드')}${command('blogCancelDownload','취소')}</div><p id="blogDownloadStatus" role="status" aria-live="polite"></p><details><summary>사진별 설명·순서</summary><label>공통 사진 설명<textarea id="blogCommonDescription" rows="2" maxlength="2000"></textarea></label><div id="blogPhotoRows"></div></details>`;
  $('selectedFiles').closest('.selected-files-head').after(selection);
  // "글 종류" is the single user-facing selector — placed above the main input, never duplicated
  // elsewhere. Internally it still drives template.templateId exactly as before.
  const typeField=document.createElement('label');typeField.className='blog-type-field';typeField.innerHTML=`<span>글 종류</span><select id="blogTemplate">${options(BLOG_TEMPLATES)}</select>`;
  document.querySelector('.workflow-command').before(typeField);
  const setup=document.createElement('div');setup.className='blog-workflow';
  setup.innerHTML=`<details id="blogMoreRequest"><summary>추가 요청</summary><div class="blog-fields"><label>핵심 메시지<input id="blogMessage" maxlength="1000"></label><label>독자<input id="blogReader" maxlength="160" placeholder="학부모, 학생"></label><label>포함할 내용<textarea id="blogInclude" maxlength="2000"></textarea></label><label>넣지 않을 내용<textarea id="blogExclude" maxlength="2000"></textarea></label><label>날짜·인원 등 정확한 정보<textarea id="blogFacts" maxlength="3000"></textarea></label><label>참고자료·출처<textarea id="blogSources" maxlength="2000"></textarea></label><label>문체<input id="blogStyle" maxlength="300"></label></div></details>
    <div class="workflow-status-row"><span id="blogTemplateSummary" role="status"></span>${command('blogOpenTemplate','양식 수정')}</div>
    <div class="workflow-status-row"><span id="blogPresetsSummary" role="status"></span>${command('blogOpenPresets','마무리 수정')}</div>
    <dialog id="blogTemplateDialog" class="workflow-dialog" aria-labelledby="blogTemplateDialogTitle"><div class="workflow-heading"><h2 id="blogTemplateDialogTitle">양식 수정</h2>${command('blogCloseTemplate','닫기')}</div><div class="blog-fields"><label>인사말<textarea id="blogGreeting" maxlength="2000"></textarea></label><label>상단 이미지<select id="blogTop"></select></label><label>하단 이미지<select id="blogBottom"></select></label></div><div class="blog-actions">${command('blogApplyTemplate','이번 글에 적용')}${command('blogSaveTemplate','캠퍼스 기본값으로 저장')}${command('blogCancelTemplate','취소')}</div><span id="blogTemplateStatus" role="status"></span></dialog>`;
  const strategyModeField=$('strategyModeField');
  strategyModeField.querySelector('span').textContent='글 방향';
  setup.querySelector('#blogMoreRequest').append(strategyModeField);
  strategyModeField.hidden=false;
  // setup (추가 요청 / 양식 수정 / 마무리 수정) belongs to area② — always reachable before generating,
  // not gated behind a draft. Only the completion block editor (result) waits inside #aiResult.
  document.querySelector('.workflow-command').after(setup);
  $('blogBottom').closest('.blog-fields').insertAdjacentHTML('beforeend','<label>정렬<select id="blogAlign"><option value="left">왼쪽</option><option value="center">가운데</option></select></label><label>문단 여백<select id="blogSpacing"><option value="16">16px</option><option value="24" selected>24px</option><option value="32">32px</option></select></label><label>서체<select id="blogFont"><option value="sans-serif">고딕</option><option value="serif">명조</option></select></label><label>연락처<select id="blogContactMode"><option value="verified">확인된 연락처</option><option value="none">표시 안 함</option></select></label>');
  const result=document.createElement('section');result.className='blog-workflow';result.id='blogComplete';
  result.innerHTML=`<div class="blog-actions">${command('blogAssemble','현재 본문·사진 배치 적용')}${command('blogUndo','되돌리기')}</div><div id="blogBlocks"></div><label class="blog-check"><input type="checkbox" id="blogPrivacy"> 홍보 사용 권한·얼굴·이름·개인정보 노출 확인</label><ul id="blogReview"></ul>`;
  $('titleField').after(result);
  // Buttons that used to duplicate content.html's unified 저장하기/글 복사 are gone — saveDraftBtn
  // and copyContent already bridge to save()/copy() below. These remaining actions relocate into
  // the shared 이미지 다운로드/더보기 menus so nothing is lost, just regrouped.
  const moreExtra=document.createElement('div');moreExtra.innerHTML=`<details><summary>실제 게시·성과 기록</summary><div class="blog-fields"><label>게시 URL<input id="blogPublishedUrl" type="url" maxlength="1000"></label><label>게시일<input id="blogPublishedDate" type="date"></label><label>조회수<input id="blogViews" type="number" min="0"></label><label>홈피드 유입수<input id="blogFeedViews" type="number" min="0"></label><label>측정 기준일<input id="blogMeasuredDate" type="date"></label><label>통계 출처<input id="blogMetricSource" maxlength="300"></label></div></details><details><summary>작업 시간</summary><pre id="blogTimings"></pre></details>`;
  // publishStatus is still read by save() below; move its field (not clone it) out of the
  // Instagram-oriented "초안 세부 정보" block — which stays hidden for blog — into 더보기 instead.
  moreExtra.querySelector('details').before($('publishStatus').closest('label'));
  $('manualDetails').hidden=true;
  $('moreMenuList').append(moreExtra);
  const downloadExtra=document.createElement('div');downloadExtra.innerHTML=`${command('blogResultOriginals','선택한 원본 사진 다운로드')}${command('blogPublishImages','게시용 이미지 다운로드')}${command('blogPackage','HTML·게시용 이미지 ZIP')}`;
  $('downloadMenuList').append(downloadExtra);
  const saveStatus=$('saveStateStatus');
  const coverEditor=mountBlogCover({host:result,$,state,onError:message=>toast(message,'error'),onApply:value=>{
    checkpoint();
    if(value.target==='body'){
      const photo=photos.find(p=>p.fileId===value.sourceFileId||p.sourceFileId===value.sourceFileId);if(!photo)throw Error('편집 원본이 현재 선택에서 제외되었습니다.');photo.editedFileId=value.fileId;photo.editSettings=value;
      for(const b of blocks.filter(b=>b.type==='image'&&b.role==='body'&&(b.sourceFileId===value.sourceFileId||b.fileId===photo.fileId))){b.fileId=value.fileId;b.sourceFileId=value.sourceFileId;}
    }else{cover=value;const b=blocks.find(b=>b.type==='image'&&b.role==='cover');if(b){b.fileId=value.fileId;b.sourceFileId=value.sourceFileId;}else blocks.unshift({id:crypto.randomUUID(),type:'image',role:'cover',fileId:value.fileId,sourceFileId:value.sourceFileId});}
    changed();renderBlocks();
  }});
  document.body.insertAdjacentHTML('beforeend',`<dialog id="blogRewriteDialog"><h3>블록 수정 제안</h3><div class="blog-fields"><label>현재 내용<textarea id="blogRewriteBefore" rows="8" readonly></textarea></label><label>제안 내용<textarea id="blogRewriteAfter" rows="8"></textarea></label></div><p id="blogRewriteReason"></p><div class="blog-actions">${command('blogRewriteApply','이 블록에 적용')}${command('blogRewriteClose','닫기')}</div></dialog>`);
  const reviewExtra=document.createElement('div');reviewExtra.innerHTML=`<div class="blog-actions">${command('blogAiReview','AI 내용 검토')}${command('blogTextCancel','검토·수정 취소')}</div><p id="blogTextStatus" role="status"></p><div id="blogAiReviewResult"></div>`;
  moreExtra.prepend(reviewExtra);
  $('blogTextCancel').hidden=true;
  $('blogCancelDownload').hidden=true;
  const fieldIds=['blogMessage','blogReader','blogInclude','blogExclude','blogFacts','blogSources','blogStyle','blogCommonDescription','blogPrivacy','blogPublishedUrl','blogPublishedDate','blogViews','blogFeedViews','blogMeasuredDate','blogMetricSource'];
  function changed(){pendingSave=null;reviewSnapshot='';reviewResult=null;$('blogAiReviewResult').replaceChildren();$('blogTextStatus').textContent='변경 후 미검사';saveStatus.textContent='변경사항 미저장';}
  const signature=()=>{const p=read();delete p.timings;delete p.reviewReport;return JSON.stringify(p);};
  const reviewKey=()=>JSON.stringify({title:$('draftTitle').value,brief:brief(),photos:photos.map(({fileId,kind,description,facts,exclude})=>({fileId,kind,description,facts,exclude})),blocks});
  for(const id of fieldIds)$(id).addEventListener('input',changed);
  const brief=()=>({topic:$('aiCommand').value,coreMessage:$('blogMessage').value,reader:$('blogReader').value,include:$('blogInclude').value,exclude:$('blogExclude').value,facts:$('blogFacts').value,sources:$('blogSources').value,style:$('blogStyle').value});
  function readTemplate(){return {...template,templateId:$('blogTemplate').value,greeting:$('blogGreeting').value,topFileId:$('blogTop').value,bottomFileId:$('blogBottom').value,align:$('blogAlign').value,spacing:Number($('blogSpacing').value),font:$('blogFont').value,contactMode:$('blogContactMode').value,logoType:$('blogCoverLogo').value};}
  function applyTemplate(){for(const [id,key] of [['blogGreeting','greeting'],['blogAlign','align'],['blogSpacing','spacing'],['blogFont','font'],['blogContactMode','contactMode'],['blogCoverLogo','logoType']])$(id).value=template[key];$('blogTop').value='';$('blogBottom').value='';renderPhotos();updateTemplateSummary?.();updatePresetsSummary?.();}
  function read(){
    syncText();
    if(reviewSnapshot&&reviewSnapshot!==reviewKey()){reviewSnapshot='';reviewResult=null;$('blogAiReviewResult').replaceChildren();$('blogTextStatus').textContent='변경 후 미검사';}
    return {schemaVersion:BLOG_SCHEMA,id:state.editingDraftId,revision,campusId:$('draftCampus').value||null,title:$('draftTitle').value,brief:brief(),strategyMode:$('strategyMode').value,generation:{strategy:state.blogStrategy,titles:state.blogTitles,nextTopics:state.blogNextTopics,selectedTitleKind:state.blogSelectedTitleKind},commonDescription:$('blogCommonDescription').value,photos:structuredClone(photos),blocks:structuredClone(blocks),template:readTemplate(),cover,privacyConfirmed:$('blogPrivacy').checked,
      publication:{url:$('blogPublishedUrl').value,date:$('blogPublishedDate').value,views:$('blogViews').value===''?null:Number($('blogViews').value),homefeedViews:$('blogFeedViews').value===''?null:Number($('blogFeedViews').value),asOf:$('blogMeasuredDate').value,source:$('blogMetricSource').value},fileIssues:state.blogFileIssues||[],reviewReport:reviewSnapshot===reviewKey()?reviewResult:null,timings:{...timings}};
  }
  function syncText(){
    if(!blocks.length)return;
    const body=$('draftContent').value;
    if(body!==lastBody){
      const paragraphs=body.split(/\n\s*\n/).filter(Boolean),textBlocks=blocks.filter(b=>['lead','heading','paragraph'].includes(b.type));
      for(let i=0;i<textBlocks.length;i++)textBlocks[i].text=paragraphs[i]||'';
      let at=blocks.findIndex(b=>['closing','contact','hashtags'].includes(b.type));if(at<0)at=blocks.length;
      blocks.splice(at,0,...paragraphs.slice(textBlocks.length).map(text=>({id:crypto.randomUUID(),type:'paragraph',text})));
      lastBody=body;
    }
    for(const [type,text] of [['closing',$('resultFooter').value],['contact',$('blogContactMode').value==='none'?'':$('resultContact').value],['hashtags',normalizeTags($('draftTags').value).map(t=>'#'+t).join(' ')]]){
      const b=blocks.find(b=>b.type===type);if(b)b.text=text;else if(text)blocks.push({id:crypto.randomUUID(),type,text});
    }
  }
  function assemble(ask=true){
    if(ask&&blocks.length&&!confirm('수정한 사진 배치를 현재 본문·선택 순서로 다시 구성할까요?'))return;
    checkpoint();template=readTemplate();blocks=assembleBlocks({body:$('draftContent').value,photos,template,cover,footer:$('resultFooter').value,contact:$('resultContact').value,tags:normalizeTags($('draftTags').value)});lastBody=$('draftContent').value;changed();renderBlocks();
  }
  function checkpoint(){undo.push({blocks:structuredClone(blocks),photos:structuredClone(photos),cover:structuredClone(cover),body:$('draftContent').value});if(undo.length>12)undo.shift();}
  function renderReview(){const p=read();$('blogReview').innerHTML=inspectPost(p).map(i=>`<li data-status="${i.status}">${escape(({needs_changes:'수정 필요',human_required:'사람 확인',unchecked:'미검사'})[i.status])}: ${escape(i.message)}</li>`).join('');for(const row of $('blogBlocks').children){const text=row.querySelector('textarea'),b=blocks.find(b=>b.id===row.dataset.blockId);if(text&&b&&document.activeElement!==text)text.value=b.text;}}
  function renderBlocks(){
    syncText();$('rawFields').hidden=blocks.length>0;$('blogBlocks').replaceChildren();
    for(const b of blocks){
      const row=document.createElement('div');row.className='blog-block';row.dataset.blockId=b.id;
      if(b.type==='image')row.innerHTML=`<figure><img loading="lazy" src="/api/data-core/files/${encodeURIComponent(b.fileId)}" alt="${escape(b.role||'게시용 이미지')}"><figcaption>${escape(b.role==='body'?'본문 사진':b.role==='top'?'상단 이미지':b.role==='bottom'?'하단 이미지':'대표 이미지')}</figcaption></figure>`;
      else row.innerHTML=`<label>${escape(b.type==='caption'?'사진 설명':b.type==='lead'?'도입부':b.type==='heading'?'소제목':b.type==='closing'?'마지막 문구':b.type==='contact'?'연락처':b.type==='hashtags'?'해시태그':'본문')}<textarea rows="${b.type==='paragraph'?4:2}" ${b.type==='contact'?'readonly':''}></textarea></label>`;
      const text=row.querySelector('textarea');if(text){text.value=b.text;text.addEventListener('change',()=>{checkpoint();b.text=text.value;if(['lead','paragraph','heading'].includes(b.type)){lastBody=blocks.filter(v=>['lead','paragraph','heading'].includes(v.type)).map(v=>v.text).join('\n\n');$('draftContent').value=lastBody;}if(b.type==='closing')$('resultFooter').value=b.text;if(b.type==='hashtags')$('draftTags').value=b.text;updatePresetsSummary();changed();renderReview();});}
      const tools=document.createElement('div');tools.className='blog-block-tools';
      const copy=document.createElement('button');copy.type='button';copy.className='ghost-btn';copy.textContent=b.type==='image'?'이 게시용 이미지 다운로드':'블록 텍스트 복사';copy.onclick=async()=>{try{if(b.type==='image')await download([b.fileId],false);else{await navigator.clipboard.writeText(b.text);toast('블록 텍스트를 복사했습니다.');}}catch(error){toast(error.message,'error');}};tools.append(copy);
      if(['lead','paragraph','heading','caption'].includes(b.type)){const button=document.createElement('button');button.type='button';button.className='ghost-btn';button.textContent='이 블록만 AI 다듬기';button.onclick=()=>textAction(b);tools.append(button);}
      for(const [label,icon,delta] of [['위로','ArrowLeft',-1],['아래로','ArrowLeft',1],['블록 삭제','Trash2',0]]){
        const button=document.createElement('button');button.type='button';button.className='ghost-btn icon-command';button.title=label;button.setAttribute('aria-label',label);button.innerHTML=`<svg aria-hidden="true" style="transform:rotate(${delta===-1?90:delta===1?-90:0}deg)"><use href="/data-core/assets/core-icons.svg#${icon}"></use></svg>`;
        button.onclick=()=>{const i=blocks.indexOf(b);if(delta&&(i+delta<0||i+delta>=blocks.length))return;checkpoint();if(delta)[blocks[i],blocks[i+delta]]=[blocks[i+delta],blocks[i]];else{blocks.splice(i,1);if(b.type==='closing')$('resultFooter').value='';if(b.type==='hashtags')$('draftTags').value='';updatePresetsSummary();}lastBody=blocks.filter(v=>['lead','paragraph','heading'].includes(v.type)).map(v=>v.text).join('\n\n');$('draftContent').value=lastBody;changed();renderBlocks();};tools.append(button);
      }row.append(tools);$('blogBlocks').append(row);
    }
    const n=publishingImages({blocks}).length;$('blogPublishImages').textContent=`게시용 이미지 ${n}장 다운로드`;$('blogPublishImages').disabled=!n;
    renderReview();
  }
  function renderPhotos(){
    photos=synchronizePhotos(state.selectedFileIds,photos,state.knownFiles);
    coverEditor.selection(photos);
    $('blogOriginals').disabled=!photos.length;$('blogOriginals').textContent=photos.length>1?`선택한 원본 사진 ${photos.length}장 다운로드`:'선택한 원본 사진 다운로드';
    $('blogResultOriginals').textContent=`선택한 원본 사진 ${photos.length}장 다운로드`;$('blogResultOriginals').disabled=!photos.length;
    $('blogPhotoRows').innerHTML=photos.map((p,i)=>`<div class="blog-photo" data-photo-id="${escape(p.fileId)}"><strong>${i+1}. ${escape(state.knownFiles.get(p.fileId)?.fileName||p.fileName||'저장한 사진')}</strong><div class="blog-fields"><label>자료 종류<select data-key="kind">${options(PHOTO_KINDS)}</select></label><label>사진 설명<textarea data-key="description" maxlength="2000"></textarea></label><label>확인된 사실<textarea data-key="facts" maxlength="2000"></textarea></label><label>제외할 내용<textarea data-key="exclude" maxlength="2000"></textarea></label></div><label class="blog-check"><input type="checkbox" data-key="use"> 본문 사용</label><label class="blog-check"><input type="checkbox" data-key="externalAiConsent"> 이 사진의 외부 AI 분석에 동의</label><div class="blog-actions"><button type="button" data-download="${escape(p.fileId)}" class="ghost-btn">원본 다운로드</button><button type="button" data-up="${i}" class="ghost-btn" aria-label="사진 ${i+1} 위로">↑</button><button type="button" data-down="${i}" class="ghost-btn" aria-label="사진 ${i+1} 아래로">↓</button></div></div>`).join('');
    $('blogPhotoRows').querySelectorAll('[data-photo-id]').forEach(row=>{const p=photos.find(p=>p.fileId===row.dataset.photoId);row.querySelectorAll('[data-key]').forEach(el=>{if(el.type==='checkbox')el.checked=Boolean(p[el.dataset.key]);else el.value=p[el.dataset.key]||'';el.oninput=()=>{p[el.dataset.key]=el.type==='checkbox'?el.checked:el.value;if(el.dataset.key==='kind')coverEditor.selection(photos);changed();};});});
    $('blogPhotoRows').querySelectorAll('[data-download]').forEach(b=>b.onclick=()=>download([b.dataset.download]));
    for(const key of ['up','down'])$('blogPhotoRows').querySelectorAll(`[data-${key}]`).forEach(b=>b.onclick=()=>{const i=Number(b.dataset[key]),j=i+(key==='up'?-1:1);if(j<0||j>=photos.length||state.busy)return;[state.selectedFileIds[i],state.selectedFileIds[j]]=[state.selectedFileIds[j],state.selectedFileIds[i]];changed();renderSelection();});
    for(const [id,key] of [['blogTop','topFileId'],['blogBottom','bottomFileId']]){const value=$(id).value||template[key];$(id).innerHTML='<option value="">없음</option>'+photos.map(p=>`<option value="${escape(p.fileId)}">${escape(state.knownFiles.get(p.fileId)?.fileName||p.fileName||p.fileId)}</option>`).join('');if(value&&!photos.some(p=>p.fileId===value)){const option=document.createElement('option');option.value=value;option.textContent='저장된 양식 이미지';$(id).append(option);}$(id).value=value;}
  }
  async function download(ids,originals=true,html=false){
    if(downloadController)return;
    const started=performance.now(),token=epoch,p=read(),campusId=$('draftCampus').value,controller=new AbortController();downloadController=controller;$('blogCancelDownload').hidden=false;
    const progress=text=>{if(token===epoch)$('blogDownloadStatus').textContent=text;};
    try{
      if(!originals&&inspectPost(p).some(i=>i.status==='needs_changes'))throw Error('수정 필요 항목을 확인한 뒤 게시용 결과를 내려받으세요. 원본 다운로드는 사용할 수 있습니다.');
      const packageResult=await buildDownload({ids,campusId,originals,post:html?p:undefined,expectedVersions:new Map(originals?p.photos.map(p=>[p.fileId,p.version]):[]),signal:controller.signal,onProgress:progress});
      controller.signal.throwIfAborted();if(token!==epoch)return;
      const campus=$('draftCampus').selectedOptions[0]?.textContent||'캠퍼스';
      startDownload(packageResult.blob,packageResult.name||(p.title?`${p.title}_${originals?'원본사진':html?'게시준비':'게시용이미지'}.zip`:`${campus}_선택사진_${new Date().toISOString().slice(0,10)}.zip`));
      timings.downloadPreparationMs=Math.round(performance.now()-started);$('blogTimings').textContent=JSON.stringify(timings,null,2);progress('다운로드 시작');
    }catch(error){progress(error.name==='AbortError'?'다운로드 취소':`실패: ${error.message}`);}finally{if(downloadController===controller){downloadController=null;$('blogCancelDownload').hidden=true;}}
  }
  async function save(){
    if(saving)return;saving=true;const token=epoch,started=performance.now();saveStatus.textContent='저장 중';
    try{
      if(!blocks.length)assemble(false);
      const p=read(),fingerprint=JSON.stringify(p);
      if(!pendingSave||pendingSave.fingerprint!==fingerprint)pendingSave={fingerprint,requestId:crypto.randomUUID()};
      const response=await fetch('/api/data-core/content/blog/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:state.editingDraftId,campusId:$('draftCampus').value||null,requestId:pendingSave.requestId,post:p,publishStatus:$('publishStatus').value,tags:normalizeTags($('draftTags').value),footer:$('resultFooter').value,contactBlock:$('resultContact').value})});
      const value=await response.json();if(!response.ok)throw Error(value.error||'저장 실패');if(token!==epoch)return;
      const current=JSON.stringify(read());state.editingDraftId=value.draft.id;revision=value.draft.metadata.blogPost.revision;
      // Do not let a late save response replace newer edits or photo selection.
      if(current===fingerprint){photos=value.draft.metadata.blogPost.photos;state.blogFileIssues=value.draft.metadata.blogPost.fileIssues||[];saved=signature();saveStatus.textContent=state.blogFileIssues.length?'초안 저장 완료 · 파일 연결 확인 필요':'저장 완료';renderReview();}else saveStatus.textContent='저장 완료 · 이후 변경사항 미저장';
      pendingSave=null;timings.saveMs=Math.round(performance.now()-started);$('blogTimings').textContent=JSON.stringify(timings,null,2);return value.draft;
    }catch(error){if(token===epoch)saveStatus.textContent=`저장 실패: ${error.message}`;toast(error.message,'error');}finally{saving=false;}
  }
  function reset(){epoch++;downloadController?.abort();textController?.abort();coverEditor.reset();cover=null;reviewCache.clear();reviewSnapshot='';reviewResult=null;templates={};$('blogAiReviewResult').replaceChildren();$('blogTextStatus').textContent='';$('blogRewriteDialog').close();photos=[];blocks=[];revision=0;template=templateDefaults();lastBody='';saved='';pendingSave=null;undo.length=0;defaultsEdit++;for(const id of fieldIds){if($(id).type==='checkbox')$(id).checked=false;else $(id).value='';}$('blogTemplate').value='class';applyTemplate();saveStatus.textContent='';$('blogDownloadStatus').textContent='';renderPhotos();renderBlocks();}
  function load(draft){
    state.blogFileIssues=draft.metadata?.blogPost?.fileIssues||[];
    const p=draft.metadata?.blogPost;if(!p){photos=synchronizePhotos(state.selectedFileIds,[],state.knownFiles);assemble(false);saved=signature();return;}cover=p.cover||null;
    photos=structuredClone(p.photos);blocks=structuredClone(p.blocks);revision=p.revision;template={...templateDefaults(),...p.template};lastBody=blocks.filter(b=>['lead','paragraph','heading'].includes(b.type)).map(b=>b.text).join('\n\n');$('draftContent').value=lastBody;
    for(const [id,key] of [['blogMessage','coreMessage'],['blogReader','reader'],['blogInclude','include'],['blogExclude','exclude'],['blogFacts','facts'],['blogSources','sources'],['blogStyle','style']])$(id).value=p.brief?.[key]||'';
    $('aiCommand').value=p.brief?.topic||'';$('blogCommonDescription').value=p.commonDescription||'';$('blogPrivacy').checked=p.privacyConfirmed===true;$('blogTemplate').value=template.templateId;$('blogGreeting').value=template.greeting;
    for(const [id,key] of [['blogPublishedUrl','url'],['blogPublishedDate','date'],['blogViews','views'],['blogFeedViews','homefeedViews'],['blogMeasuredDate','asOf'],['blogMetricSource','source']])$(id).value=p.publication?.[key]??'';
    applyTemplate();renderPhotos();renderBlocks();if(p.reviewReport){reviewResult=p.reviewReport;reviewSnapshot=reviewKey();$('blogAiReviewResult').textContent='저장된 텍스트 검토: '+JSON.stringify(reviewResult.checks);$('blogTextStatus').textContent='저장 당시 검토 기록 · 실제 사진·외부 사실은 담당자 확인 필요';}saved=signature();saveStatus.textContent=`저장된 버전 ${revision}`;
  }
  $('blogOriginals').onclick=$('blogResultOriginals').onclick=()=>download(photos.map(p=>p.fileId));
  $('blogPublishImages').onclick=()=>download(publishingImages(read()).map(p=>p.id),false);
  $('blogPackage').onclick=()=>download(publishingImages(read()).map(p=>p.id),false,true);
  $('blogCancelDownload').onclick=()=>downloadController?.abort();
  $('blogAssemble').onclick=()=>assemble();
  $('blogUndo').onclick=()=>{const previous=undo.pop();if(!previous)return;blocks=previous.blocks;photos=synchronizePhotos(state.selectedFileIds,previous.photos,state.knownFiles);cover=previous.cover;$('draftContent').value=lastBody=previous.body;for(const [type,id] of [['closing','resultFooter'],['hashtags','draftTags']])$(id).value=blocks.find(b=>b.type===type)?.text||'';changed();renderPhotos();renderBlocks();};
  $('blogPrivacy').onchange=renderReview;
  $('blogAiReview').onclick=()=>textAction();$('blogTextCancel').onclick=()=>textController?.abort();$('blogRewriteClose').onclick=()=>$('blogRewriteDialog').close();
  async function textAction(block){
    if(textController||state.busy)return;if(!blocks.length)assemble(false);
    const token=epoch,p=read(),snapshot=signature(),start=performance.now(),controller=new AbortController();textController=controller;$('blogTextCancel').hidden=false;
    const timer=setTimeout(()=>controller.abort(),100000);
    try{
      $('blogTextStatus').textContent=block?'블록 수정 중':'내용 검토 중';
      let value=!block&&reviewCache.get(snapshot);
      if(!value){const response=await fetch('/api/data-core/content/blog/text-action',{method:'POST',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({mode:block?'rewrite':'review',campusId:p.campusId,title:p.title,brief:p.brief,photos:p.photos.map(({fileId,kind,description,facts,exclude})=>({fileId,kind,description,facts,exclude})),blocks:(block?[block]:p.blocks.filter(b=>b.type!=='image')).map(({id,type,text})=>({id,type,text})),requestId:crypto.randomUUID()})});value=await response.json();if(!response.ok)throw Error(value.error||'내용 검토 실패');}
      if(token!==epoch)return;if(snapshot!==signature())throw Error('대기 중 내용이 변경되었습니다. 현재 버전으로 다시 요청하세요.');
      if(block){$('blogRewriteBefore').value=block.text;$('blogRewriteAfter').value=value.text;$('blogRewriteReason').textContent=value.reason;$('blogRewriteDialog').showModal();$('blogRewriteApply').onclick=()=>{if(snapshot!==signature()){toast('현재 내용이 바뀌었습니다. 제안을 다시 확인하세요.','error');return;}checkpoint();block.text=$('blogRewriteAfter').value;if(['lead','paragraph','heading'].includes(block.type)){$('draftContent').value=lastBody=blocks.filter(b=>['lead','paragraph','heading'].includes(b.type)).map(b=>b.text).join('\n\n');}changed();renderBlocks();$('blogRewriteDialog').close();};}
      else{reviewSnapshot=reviewKey();reviewResult={...value,checkedAt:new Date().toISOString()};reviewCache.set(snapshot,value);if(reviewCache.size>8)reviewCache.delete(reviewCache.keys().next().value);$('blogAiReviewResult').innerHTML=value.checks.map(c=>`<p>${escape(c.blockId)} · ${escape(({pass:'텍스트 검토 통과',needs_changes:'수정 필요',human_required:'사람 확인'})[c.status])}: ${escape(c.reason)}</p>`).join('');}
      $('blogTextStatus').textContent='텍스트 검토 완료 · 실제 사진·외부 사실은 담당자 확인 필요';
      timings[block?'blockRewriteMs':'contentReviewMs']=Math.round(performance.now()-start);$('blogTimings').textContent=JSON.stringify(timings,null,2);
    }catch(error){if(token===epoch)$('blogTextStatus').textContent=error.name==='AbortError'?'검토 중단 · 미검사':`검토 실패 · 미검사: ${error.message}`;}finally{clearTimeout(timer);if(textController===controller){textController=null;$('blogTextCancel').hidden=true;}}
  }
  for(const id of ['aiCommand','draftTitle','draftContent','resultFooter','draftTags'])$(id).addEventListener('input',()=>{changed();renderReview();});
  async function copyText(){try{if(!blocks.length)assemble(false);const p=read();if(inspectPost(p).some(i=>i.status==='needs_changes'))throw Error('수정 필요 항목을 확인한 뒤 완성본을 복사하세요.');const refs=await resolveFiles(publishingImages(p).map(v=>v.id),p.campusId,undefined,false);if(refs.some(v=>v.error))throw Error('접근할 수 없는 게시용 이미지가 있습니다. 연결을 확인하세요.');await navigator.clipboard.writeText(postText(p));toast('화면의 완성본 텍스트를 복사했습니다.');}catch(error){toast(error.message,'error');}}
  for(const id of ['strategyMode','blogTemplate','blogGreeting','blogTop','blogBottom','blogAlign','blogSpacing','blogFont','blogContactMode'])$(id).addEventListener('change',()=>{defaultsEdit++;changed();});
  $('blogTemplate').addEventListener('change',()=>{template={...templateDefaults(),...templates[$('blogTemplate').value],templateId:$('blogTemplate').value};applyTemplate();});
  $('blogSaveTemplate').onclick=async()=>{const token=epoch;$('blogSaveTemplate').disabled=true;try{const response=await fetch('/api/data-core/content/defaults',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({sourceApp:'blog',campusId:$('draftCampus').value||null,hashtags:$('defaultHashtags').value,footer:$('defaultFooter').value,blogSettings:{strategyMode:$('strategyMode').value,template:readTemplate()}})});const value=await response.json();if(!response.ok)throw Error(value.error);if(token===epoch){templates=value.defaults.blogSettings.templates||{};$('blogTemplateStatus').textContent='캠퍼스 기본 양식 저장 완료';}}catch(error){if(token===epoch)$('blogTemplateStatus').textContent=error.message;}finally{$('blogSaveTemplate').disabled=false;}};
  // 양식 수정 dialog: fields already apply live via the 'change' listeners above (that is what
  // "이번 글에 적용" means here — nothing further to do but close). 취소 restores the snapshot taken
  // when the dialog opened, so an edit made and abandoned mid-dialog never lingers on the post.
  let templateSnapshot=null;
  function updateTemplateSummary(){$('blogTemplateSummary').textContent=state.editingDraftId||blocks.some(b=>b.type==='image'&&['top','bottom'].includes(b.role))||template.greeting?'양식 적용됨':'캠퍼스 기본 양식 적용 중';}
  $('blogOpenTemplate').onclick=()=>{templateSnapshot=readTemplate();$('blogTemplateStatus').textContent='';$('blogTemplateDialog').showModal();};
  $('blogApplyTemplate').onclick=()=>{updateTemplateSummary();$('blogTemplateDialog').close();};
  $('blogCloseTemplate').onclick=$('blogCancelTemplate').onclick=()=>{if(templateSnapshot){template=templateSnapshot;applyTemplate();}$('blogTemplateDialog').close();};
  // 마무리 수정 dialog: the hashtag/closing preset picker (mountTextPresets) is mounted separately
  // in content.js and exposes its own dialog; this button only needs to open it.
  $('blogOpenPresets').onclick=()=>window.dispatchEvent(new CustomEvent('open-text-presets'));
  function updatePresetsSummary(){
    const count=normalizeTags($('draftTags').value).length,footer=$('resultFooter').value.trim();
    $('blogPresetsSummary').textContent=`해시태그 ${count}개 · 마지막 문구 ${footer?'적용':'미설정'} · 상담 정보 ${$('blogContactMode').value==='none'?'미포함':'포함'}`;
  }
  for(const id of ['draftTags','resultFooter'])$(id).addEventListener('input',updatePresetsSummary);
  $('blogContactMode').addEventListener('change',updatePresetsSummary);
  window.addEventListener('text-presets-changed',updatePresetsSummary);
  updateTemplateSummary();updatePresetsSummary();
  window.addEventListener('pagehide',()=>downloadController?.abort());
  renderPhotos();
  return {read,save,load,reset,selectionChanged:renderPhotos,assemble,review:renderReview,copy:copyText,downloadPackage:()=>$('blogPackage').click(),defaultsToken:()=>defaultsEdit,
    applyDefaults(value,token){if(token!==defaultsEdit||state.editingDraftId||!value)return;templates=value.templates||{};template={...templateDefaults(),...value.template};$('strategyMode').value=value.strategyMode||'balanced';$('blogTemplate').value=template.templateId;applyTemplate();},
    hasUnsaved:()=>Boolean((blocks.length||photos.length||Object.values(brief()).some(v=>v.trim()))&&signature()!==saved),
    instructions:()=>({brief:brief(),commonDescription:$('blogCommonDescription').value,photos:photos.map(({fileId,kind,description,facts,exclude,externalAiConsent})=>({fileId,kind,description,facts,exclude,externalAiConsent}))}),
    async aiPhotos(signal){const ids=photos.filter(p=>p.externalAiConsent&&!['student','teacher','fact','unknown'].includes(p.kind)).map(p=>p.fileId);if(!ids.length)return [];const rows=await resolveFiles(ids,$('draftCampus').value,signal);const bad=rows.find(r=>r.error);if(bad)throw Error(bad.error);return rows.filter(r=>!r.preserveReason).map(r=>r.selectedId);},
    recordTime(key,start){timings[key]=Math.round(performance.now()-start);$('blogTimings').textContent=JSON.stringify(timings,null,2);},
  };
}
