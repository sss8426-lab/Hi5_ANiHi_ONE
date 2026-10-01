import {BLOG_SCHEMA,BLOG_TEMPLATES,PHOTO_KINDS,templateDefaults,synchronizePhotos,assembleBlocks,placeManaged,publishingImages,postText,inspectPost,WRITTEN_TYPES,sentencesOf,editedSentences,placeTeacherComment} from './blog-post-model.js?v=20261001-naver';
import {buildDownload,startDownload,resolveFiles} from './blog-download.js';
import {normalizeTags} from './content-preset-catalog.js';
import {postHashtags,hashtagText} from './campus-seo-keywords.js?v=20260929-seo';
import {mountBlogCover} from './blog-cover.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const options=map=>Object.entries(map).map(([id,label])=>`<option value="${id}">${label}</option>`).join('');
// A post can hold any number of photos; the AI looks at the first 10 eligible ones as images
// (cost/size bound) and gets every photo's written description via photoInstructions.
const AI_IMAGE_PHOTOS=10;
const command=(id,label)=>`<button type="button" class="ghost-btn" id="${id}">${label}</button>`;
// Naver-like editor toolbar button (icon above a short label).
const ICONS={photo:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 8"/>',quote:'<path d="M6 8h4v4H6zM14 8h4v4h-4z"/><path d="M6 12c0 3 1 4 3 5M14 12c0 3 1 4 3 5"/>',divider:'<path d="M3 12h18"/>',heading:'<path d="M5 6h14M5 12h9M5 18h12"/>',paragraph:'<path d="M4 7h16M4 12h16M4 17h10"/>',ai:'<path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z"/><path d="M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',undo:'<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'};
const btnHtml=(id,label,icon)=>`<button type="button" class="nv-tool${icon==='ai'?' nv-tool-ai':''}" id="${id}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg><span>${label}</span></button>`;
const BLOCK_LABELS={greeting:'인사말',lead:'도입부',heading:'소제목',paragraph:'본문',caption:'사진 설명',quote:'인용구',closing:'마지막 문구',contact:'연락처',hashtags:'해시태그'};
export const TITLE_KIND_LABELS={homefeed:'홈피드형',search:'검색형',balanced:'균형형',list:'목록형',curious:'궁금증형'};
const PHOTO_TARGET=[8,12],WEEK_TARGET=5,EDIT_TARGET=3;
const ymd=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
// Title words worth finding again in the opening paragraph (the region/brand prefix and particles left out).
const titleWords=title=>[...new Set(String(title||'').replace(/\[[^\]]*\]/g,' ').split(/[\s,.!?·…"'“”‘’()]+/).map(w=>w.replace(/(에서|으로|은|는|이|가|을|를|의|에|로|과|와|도|만)$/,'')).filter(w=>w.length>=2))];
export function mountBlogWorkflow({state,$,toast,renderSelection,managed=()=>({greeting:'',hashtags:'',closing:'',contactText:''}),titleChoices=()=>[],chooseTitle=async()=>{}}){
  if(state.sourceApp!=='blog')return null;
  let photos=[],blocks=[],template=templateDefaults(),revision=0,epoch=0,defaultsEdit=0,downloadController,saving=false,lastBody='',saved='',pendingSave=null;
  const timings={},undo=[];let cover=null,reviewCache=new Map(),textController,reviewSnapshot='',reviewResult=null,templates={};
  let focused='',editing='',aiSentences=[],overlap=null,overlapTimer,overlapToken=0,reviewTimer;
  const selection=document.createElement('div');selection.className='blog-workflow';
  selection.innerHTML=`<div class="blog-actions">${command('blogOriginals','선택한 원본 사진 다운로드')}${command('blogCancelDownload','취소')}</div><p id="blogDownloadStatus" role="status" aria-live="polite"></p><details><summary>사진별 설명·순서</summary><label>공통 사진 설명<textarea id="blogCommonDescription" rows="2" maxlength="2000"></textarea></label><div id="blogPhotoRows"></div></details>`;
  $('selectedFiles').closest('.selected-files-head').after(selection);
  // "글 종류" is the single user-facing selector — placed above the main input, never duplicated
  // elsewhere. Internally it still drives template.templateId exactly as before.
  const typeField=document.createElement('label');typeField.className='blog-type-field';typeField.innerHTML=`<span>글 종류</span><select id="blogTemplate">${options(BLOG_TEMPLATES)}</select>`;
  document.querySelector('.workflow-command').before(typeField);
  const setup=document.createElement('div');setup.className='blog-workflow';
  // The main screen shows only 글 종류, 요청, 핵심 메시지·독자 and 문구 설정. These older request fields and
  // the layout template stay (hidden) so a saved post that used them opens and saves without losing them.
  setup.innerHTML=`<div id="blogMoreRequest" hidden><div class="blog-fields"><label>포함할 내용<textarea id="blogInclude" maxlength="2000"></textarea></label><label>넣지 않을 내용<textarea id="blogExclude" maxlength="2000"></textarea></label><label>날짜·인원 등 정확한 정보<textarea id="blogFacts" maxlength="3000"></textarea></label><label>참고자료·출처<textarea id="blogSources" maxlength="2000"></textarea></label><label>문체<input id="blogStyle" maxlength="300"></label></div></div>
    <dialog id="blogTemplateDialog" class="workflow-dialog" aria-labelledby="blogTemplateDialogTitle"><div class="workflow-heading"><h2 id="blogTemplateDialogTitle">양식 수정</h2>${command('blogCloseTemplate','닫기')}</div><div class="blog-fields"><label>인사말<textarea id="blogGreeting" maxlength="2000"></textarea></label><label>상단 이미지<select id="blogTop"></select></label><label>하단 이미지<select id="blogBottom"></select></label></div><div class="blog-actions">${command('blogApplyTemplate','이번 글에 적용')}${command('blogSaveTemplate','캠퍼스 기본값으로 저장')}${command('blogCancelTemplate','취소')}</div><span id="blogTemplateStatus" role="status"></span></dialog>`;
  const strategyModeField=$('strategyModeField');
  strategyModeField.querySelector('span').textContent='글 방향';
  setup.querySelector('#blogMoreRequest').append(strategyModeField);
  strategyModeField.hidden=true;
  // Nothing in it is shown on the main screen any more (kept only so older posts round-trip).
  setup.hidden=true;
  document.querySelector('.workflow-command').after(setup);
  $('blogBottom').closest('.blog-fields').insertAdjacentHTML('beforeend','<label>정렬<select id="blogAlign"><option value="left">왼쪽</option><option value="center">가운데</option></select></label><label>문단 여백<select id="blogSpacing"><option value="16">16px</option><option value="24" selected>24px</option><option value="32">32px</option></select></label><label>서체<select id="blogFont"><option value="sans-serif">고딕</option><option value="serif">명조</option></select></label><label>연락처<select id="blogContactMode"><option value="verified">확인된 연락처</option><option value="none">표시 안 함</option></select></label>');
  const result=document.createElement('section');result.className='blog-workflow';result.id='blogComplete';
  // Written the way a Naver blog post is written: one big page with the title on top and the text,
  // photos, quotes and dividers in order. The page is copied as plain text, so Naver's own formatting
  // is used there and nothing hidden comes along.
  result.innerHTML=`<div class="nv-shell"><section class="nv-editor" aria-label="네이버 블로그 글쓰기 창">
    <div class="nv-toolbar" role="toolbar" aria-label="글쓰기 도구">${btnHtml('blogAddPhoto','사진','photo')}${btnHtml('blogAddQuote','인용구','quote')}${btnHtml('blogAddDivider','구분선','divider')}${btnHtml('blogAddHeading','소제목','heading')}${btnHtml('blogAddParagraph','문단','paragraph')}${btnHtml('blogPolish','AI 다듬기','ai')}${btnHtml('blogUndo','되돌리기','undo')}
      <span class="nv-spacer"></span><button type="button" class="nv-btn" id="blogSaveTemp">임시저장</button><button type="button" class="nv-btn" id="blogPhotosInOrder" title="[사진 1]부터 글에 들어간 순서대로 내려받습니다">사진 받기</button><button type="button" class="nv-btn nv-copy" id="blogCopyPlain">서식 없이 복사</button></div>
    <div id="blogPhotoMenu" class="nv-photo-menu" hidden></div>
    <div class="nv-infobar"><span>글꼴·크기·색은 네이버에서 정하세요. ‘서식 없이 복사’는 글만 옮겨 네이버 서식이 깨지지 않습니다.</span></div>
    <div class="nv-page"><div id="blogTitleChips" class="nv-title-chips"></div><div id="blogBlocks"></div></div>
  </section>
  <aside class="nv-side" aria-label="글 점검과 기록">
    <div class="nv-card"><h4>글 점검 <small>네이버 기준</small></h4><div id="blogChecks"></div><p id="blogCheckNote" class="nv-note" hidden></p><label class="blog-check"><input type="checkbox" id="blogPrivacy"> 홍보 사용 권한·얼굴·이름·개인정보 노출 확인</label><ul id="blogReview"></ul></div>
    <div class="nv-card"><h4>네이버로 옮기는 순서</h4><ol class="nv-steps"><li><b>서식 없이 복사</b> → 네이버 글쓰기 창에 붙여넣기</li><li><b>[사진 1] [사진 2] …</b> 자리에 네이버 ‘사진’ 버튼으로 사진 올리기 <small>(‘사진 받기’로 받은 순서 그대로)</small></li><li>제목·사진 설명 확인 후 발행</li><li>발행한 주소·게시일을 더보기 ▸ ‘실제 게시·성과 기록’에 입력 <small>(꾸준함·잘된 글에 반영)</small></li></ol></div>
    <div class="nv-card"><h4>강사 코멘트 <small>한 줄이면 충분</small></h4><textarea id="blogTeacherComment" rows="3" maxlength="300" placeholder="예: 처음엔 그림부터 그리려고 해요. 칸을 먼저 나누면 훨씬 쉬워집니다."></textarea><small class="nv-hint">적으면 본문에 인용구로 자동으로 들어갑니다.</small></div>
    <div class="nv-card"><h4>발행 꾸준함 <small>이번 주</small></h4><div id="blogStreak"><p class="nv-hint">불러오는 중</p></div></div>
    <div class="nv-card"><h4>잘된 글 <small>입력한 조회수 기준</small></h4><div id="blogTopPosts"><p class="nv-hint">불러오는 중</p></div></div>
  </aside></div>`;
  $('titleField').after(result);
  $('blogTitleChips').after($('titleField'));$('titleField').classList.add('nv-title');
  // A long title wraps on the page like Naver's; the original input stays the value everything else reads.
  $('titleField').insertAdjacentHTML('beforeend','<textarea id="blogTitleBox" rows="1" maxlength="300" aria-label="제목" placeholder="제목"></textarea>');
  const titleBox=$('blogTitleBox'),fitTitle=()=>{titleBox.style.height='auto';if(titleBox.scrollHeight)titleBox.style.height=titleBox.scrollHeight+'px';};
  titleBox.addEventListener('input',()=>{titleBox.value=titleBox.value.replace(/\n/g,' ');$('draftTitle').value=titleBox.value;$('draftTitle').dispatchEvent(new Event('input',{bubbles:true}));fitTitle();});
  titleBox.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('blogBlocks').querySelector('.nv-text[contenteditable]')?.focus();}});
  const syncTitle=()=>{if(document.activeElement!==titleBox&&titleBox.value!==$('draftTitle').value)titleBox.value=$('draftTitle').value;fitTitle();};
  $('completeActions').classList.add('nv-complete-actions');
  result.querySelector('.nv-infobar').append($('saveStateStatus'));
  // Buttons that used to duplicate content.html's unified 저장하기/글 복사 are gone — saveDraftBtn
  // and copyContent already bridge to save()/copy() below. These remaining actions relocate into
  // the shared 이미지 다운로드/더보기 menus so nothing is lost, just regrouped.
  const moreExtra=document.createElement('div');moreExtra.innerHTML=`${command('blogAssemble','본문·사진 배치 다시 하기')}<details><summary>실제 게시·성과 기록</summary><div class="blog-fields"><label>게시 URL<input id="blogPublishedUrl" type="url" maxlength="1000"></label><label>게시일<input id="blogPublishedDate" type="date"></label><label>조회수<input id="blogViews" type="number" min="0"></label><label>홈피드 유입수<input id="blogFeedViews" type="number" min="0"></label><label>측정 기준일<input id="blogMeasuredDate" type="date"></label><label>통계 출처<input id="blogMetricSource" maxlength="300"></label></div></details><details><summary>작업 시간</summary><pre id="blogTimings"></pre></details>`;
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
  const fieldIds=['blogMessage','blogReader','blogInclude','blogExclude','blogFacts','blogSources','blogStyle','blogTeacherComment','blogCommonDescription','blogPrivacy','blogPublishedUrl','blogPublishedDate','blogViews','blogFeedViews','blogMeasuredDate','blogMetricSource'];
  function changed(){pendingSave=null;reviewSnapshot='';reviewResult=null;$('blogAiReviewResult').replaceChildren();$('blogTextStatus').textContent='변경 후 미검사';saveStatus.textContent='변경사항 미저장';scheduleOverlap();}
  const signature=()=>{const p=read();delete p.timings;delete p.reviewReport;return JSON.stringify(p);};
  const reviewKey=()=>JSON.stringify({title:$('draftTitle').value,brief:brief(),photos:photos.map(({fileId,kind,description,facts,exclude})=>({fileId,kind,description,facts,exclude})),blocks});
  for(const id of fieldIds)$(id).addEventListener('input',changed);
  const brief=()=>({topic:$('aiCommand').value,coreMessage:$('blogMessage').value,reader:$('blogReader').value,include:$('blogInclude').value,exclude:$('blogExclude').value,facts:$('blogFacts').value,sources:$('blogSources').value,style:$('blogStyle').value,teacherComment:$('blogTeacherComment').value});
  function readTemplate(){return {...template,templateId:$('blogTemplate').value,greeting:$('blogGreeting').value,topFileId:$('blogTop').value,bottomFileId:$('blogBottom').value,align:$('blogAlign').value,spacing:Number($('blogSpacing').value),font:$('blogFont').value,contactMode:$('blogContactMode').value,logoType:$('blogCoverLogo').value};}
  function applyTemplate(){for(const [id,key] of [['blogGreeting','greeting'],['blogAlign','align'],['blogSpacing','spacing'],['blogFont','font'],['blogContactMode','contactMode'],['blogCoverLogo','logoType']])$(id).value=template[key];$('blogTop').value='';$('blogBottom').value='';renderPhotos();}
  function read(){
    syncText();
    if(reviewSnapshot&&reviewSnapshot!==reviewKey()){reviewSnapshot='';reviewResult=null;$('blogAiReviewResult').replaceChildren();$('blogTextStatus').textContent='변경 후 미검사';}
    return {schemaVersion:BLOG_SCHEMA,id:state.editingDraftId,revision,campusId:$('draftCampus').value||null,title:$('draftTitle').value,brief:brief(),strategyMode:$('strategyMode').value,generation:{strategy:state.blogStrategy,titles:state.blogTitles,nextTopics:state.blogNextTopics,selectedTitleKind:state.blogSelectedTitleKind,aiSentences},commonDescription:$('blogCommonDescription').value,photos:structuredClone(photos),blocks:structuredClone(blocks),template:readTemplate(),cover,privacyConfirmed:$('blogPrivacy').checked,
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
    // 인사말 first; 연락처(링크·상담전화·주소) → 마지막 문구 → 해시태그 last — by role, whatever the block order.
    blocks=placeManaged(blocks,{contact:$('resultContact').value,closing:$('resultFooter').value,hashtags:normalizeTags($('draftTags').value).map(t=>'#'+t).join(' ')});
  }
  function assemble(ask=true){
    if(ask&&blocks.length&&!confirm('수정한 사진 배치를 현재 본문·선택 순서로 다시 구성할까요?'))return;
    checkpoint();template=readTemplate();const greeting=blocks.find(b=>b.type==='greeting')?.text??managed().greeting;
    blocks=placeTeacherComment(assembleBlocks({body:$('draftContent').value,photos,template,cover,greeting,footer:$('resultFooter').value,contact:$('resultContact').value,tags:normalizeTags($('draftTags').value)}),$('blogTeacherComment').value);lastBody=$('draftContent').value;
    // Right after an AI generation, remember its sentences so '직접 고친 문장' can count the writer's own edits.
    if(state.blogAiOriginal){aiSentences=blocks.filter(b=>WRITTEN_TYPES.includes(b.type)).flatMap(b=>sentencesOf(b.text));state.blogAiOriginal=false;}
    changed();renderBlocks();
  }
  function checkpoint(){undo.push({blocks:structuredClone(blocks),photos:structuredClone(photos),cover:structuredClone(cover),body:$('draftContent').value});if(undo.length>12)undo.shift();}
  function renderReview(){const p=read();$('blogReview').innerHTML=inspectPost(p).map(i=>`<li data-status="${i.status}">${escape(({needs_changes:'수정 필요',human_required:'사람 확인',unchecked:'미검사'})[i.status])}: ${escape(i.message)}</li>`).join('');renderChecks(p);renderTitleChips();syncTitle();}
  function scheduleReview(){clearTimeout(reviewTimer);reviewTimer=setTimeout(renderReview,300);}
  const bodyText=()=>blocks.filter(v=>WRITTEN_TYPES.includes(v.type)).map(v=>v.text).join('\n\n');
  const current=id=>blocks.find(v=>v.id===id);
  // Mirrors a block edit into the plain fields the rest of the page (save, AI, settings) reads.
  function mirror(b){if(WRITTEN_TYPES.includes(b.type))$('draftContent').value=lastBody=bodyText();if(b.type==='closing')$('resultFooter').value=b.text;if(b.type==='hashtags')$('draftTags').value=b.text;}
  function renderTitleChips(){
    const choices=titleChoices();$('blogTitleChips').hidden=!choices.length;
    $('blogTitleChips').innerHTML=choices.map(c=>`<button type="button" class="nv-chip" data-title-kind="${escape(c.kind)}" aria-pressed="${c.selected}"><em>${escape(TITLE_KIND_LABELS[c.kind]||c.kind)}</em>${escape(c.title)}</button>`).join('');
    $('blogTitleChips').querySelectorAll('[data-title-kind]').forEach(b=>b.onclick=async()=>{await chooseTitle(b.dataset.titleKind);renderReview();});
  }
  function renderChecks(p){
    const rows=[],notes=[],row=(label,value,ok)=>rows.push(`<div class="nv-row"><span>${label}</span><b class="${ok===null?'':ok?'nv-ok':'nv-warn'}">${escape(value)}</b></div>`);
    const photoCount=p.blocks.filter(b=>b.type==='image'&&!['top','bottom'].includes(b.role)).length,[min,max]=PHOTO_TARGET;
    row('사진 수',`${photoCount}장 / 권장 ${min}~${max}장`,photoCount>=min&&photoCount<=max);
    if(photoCount<min)notes.push(`사진이 권장보다 적어요(${min-photoCount}장 더).`);
    const kind=state.blogSelectedTitleKind;row('제목 유형',TITLE_KIND_LABELS[kind]||'직접 작성',null);
    const words=titleWords(p.title),lead=p.blocks.find(b=>b.type==='lead')?.text||'',hit=words.filter(w=>lead.includes(w)).length,answered=words.length>0&&hit/words.length>=0.34;
    row('제목 핵심어가 도입부에',answered?'있음':'확인 필요',answered);
    if(!answered&&p.title.trim())notes.push('첫 문단에서 제목이 약속한 내용에 바로 답해 주세요.');
    const teacher=p.blocks.some(b=>b.type==='quote'&&b.role==='teacher');row('강사 코멘트',teacher?'들어감':'없음',teacher);
    if(!teacher)notes.push('오른쪽 ‘강사 코멘트’에 한 줄만 적어도 글이 훨씬 우리 학원 글다워져요.');
    row('다른 글과 겹침',overlap?`${overlap.percent}% · ${overlap.percent>=30?'높음':'안전'}`:'확인 중',overlap?overlap.percent<30:null);
    if(overlap?.percent>=30)notes.push(`${overlap.otherCampus?'다른 캠퍼스':'이전'} 글과 ${overlap.percent}% 겹쳐요. 같은 문장을 그대로 쓰면 네이버에서 유사 문서로 볼 수 있어요.`);
    if(aiSentences.length){const n=editedSentences(p.blocks,aiSentences);row('직접 고친 문장',`${n} / 권장 ${EDIT_TARGET}`,n>=EDIT_TARGET);if(n<EDIT_TARGET)notes.push(`직접 고친 문장이 적어요 — 수업 분위기나 학생 반응을 ${EDIT_TARGET-n}문장만 더 바꿔 주세요.`);}
    $('blogChecks').innerHTML=rows.join('');$('blogCheckNote').hidden=!notes.length||!p.blocks.length;$('blogCheckNote').textContent=notes.join(' ');
  }
  // Near-duplicate check against other saved blog posts: only a percentage comes back.
  function scheduleOverlap(){
    clearTimeout(overlapTimer);const token=++overlapToken;
    overlapTimer=setTimeout(async()=>{
      const text=blocks.filter(b=>[...WRITTEN_TYPES,'caption','quote'].includes(b.type)).map(b=>b.text).join('\n');
      if(text.length<40){overlap=null;return;}
      try{const response=await fetch('/api/data-core/content/blog/overlap',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({campusId:$('draftCampus').value||null,id:state.editingDraftId||'',text:text.slice(0,60000)})});const value=await response.json();if(!response.ok)throw Error(value.error);if(token===overlapToken){overlap=value;renderChecks(read());}}catch{if(token===overlapToken)overlap=null;}
    },1500);
  }
  async function loadStats(){
    try{const campusId=$('draftCampus').value;const response=await fetch('/api/data-core/content/blog/stats'+(campusId?`?campusId=${encodeURIComponent(campusId)}`:''));const value=await response.json();if(!response.ok)throw Error(value.error);renderStats(value);}
    catch{$('blogStreak').innerHTML=$('blogTopPosts').innerHTML='<p class="nv-hint">기록을 불러오지 못했습니다.</p>';}
  }
  function renderStats({publishedDates=[],top=[],kinds={}}){
    const count=new Map();for(const d of publishedDates)count.set(d,(count.get(d)||0)+1);
    const today=new Date(),monday=new Date(today.getFullYear(),today.getMonth(),today.getDate()-(today.getDay()+6)%7);
    const week=Array.from({length:7},(_,i)=>{const d=new Date(monday);d.setDate(monday.getDate()+i);return count.get(ymd(d))||0;}),done=week.reduce((a,b)=>a+b,0),peak=Math.max(1,...week);
    let streak=0;const day=new Date(today);if(!count.get(ymd(day)))day.setDate(day.getDate()-1);while(count.get(ymd(day))){streak++;day.setDate(day.getDate()-1);}
    $('blogStreak').innerHTML=`<div class="nv-row"><span>이번 주 발행</span><b class="${done>=WEEK_TARGET?'nv-ok':''}">${done} / 목표 ${WEEK_TARGET}</b></div><div class="nv-row"><span>연속 발행</span><b>${streak?`${streak}일째`:'—'}</b></div><div class="nv-bars" aria-hidden="true">${week.map(n=>`<i class="${n?'on':''}" style="height:${n?Math.max(18,Math.round(n/peak*100)):8}%"></i>`).join('')}</div><div class="nv-week" aria-hidden="true">${['월','화','수','목','금','토','일'].map(d=>`<span>${d}</span>`).join('')}</div>${publishedDates.length?'':'<p class="nv-hint">게시일을 기록하면 여기에 쌓입니다.</p>'}`;
    const label=k=>TITLE_KIND_LABELS[k]||'직접 작성';
    const ranked=Object.entries(kinds).filter(([,v])=>v.posts>=2).sort((a,b)=>b[1].avgViews-a[1].avgViews);
    const insight=ranked.length>=2&&ranked.at(-1)[1].avgViews>0?`<p class="nv-note nv-good">${escape(label(ranked[0][0]))} 제목이 ${escape(label(ranked.at(-1)[0]))}보다 평균 ${(ranked[0][1].avgViews/ranked.at(-1)[1].avgViews).toFixed(1)}배 많이 읽혔어요.</p>`:'';
    $('blogTopPosts').innerHTML=top.length?`<table class="nv-perf">${top.map(t=>`<tr><td>${escape(t.title)}<div class="nv-kind">${escape(label(t.titleKind))} · ${escape(BLOG_TEMPLATES[t.templateId]||'글')}</div></td><td>${Number(t.views).toLocaleString('ko-KR')}</td></tr>`).join('')}</table>${insight}`:'<p class="nv-hint">게시 기록에 조회수를 입력하면 잘 읽힌 글이 여기 보입니다.</p>';
  }
  function renderBlocks(){
    syncText();$('rawFields').hidden=blocks.length>0;const page=$('blogBlocks');page.replaceChildren();let photo=0;
    if(!blocks.length)page.innerHTML='<p class="nv-empty">위에서 사진을 고르고 ‘AI로 블로그 글 작성’을 누르면 이 창에 글이 바로 써집니다. 직접 쓰려면 위의 ‘문단’ 버튼을 누르세요.</p>';
    for(const b of blocks){
      const row=document.createElement('div');row.className=`nv-block nv-${b.type}`;row.dataset.blockId=b.id;
      if(b.type==='image')row.innerHTML=`<figure><span class="nv-slot">사진 ${++photo} · 네이버에서 직접 올리기</span><img loading="lazy" src="/api/data-core/files/${encodeURIComponent(b.fileId)}" alt="${escape(b.role==='body'?'본문 사진':b.role==='top'?'상단 이미지':b.role==='bottom'?'하단 이미지':'대표 이미지')}"></figure>`;
      else if(b.type==='divider')row.innerHTML='<div class="nv-divider" role="separator">· · ·</div>';
      else{
        const teacher=b.type==='quote'&&b.role==='teacher',el=document.createElement(b.type==='heading'?'h2':b.type==='quote'?'blockquote':'p');
        el.className='nv-text';el.textContent=b.text;el.dataset.placeholder=`${BLOCK_LABELS[b.type]||'본문'} 입력`;el.setAttribute('aria-label',BLOCK_LABELS[b.type]||'본문');
        if(b.type!=='contact'&&!teacher){
          try{el.contentEditable='plaintext-only';}catch{el.contentEditable='true';}
          el.setAttribute('role','textbox');el.setAttribute('aria-multiline','true');
          el.addEventListener('focus',()=>{focused=b.id;if(editing!==b.id){checkpoint();editing=b.id;}});
          el.addEventListener('input',()=>{const cur=current(b.id);if(!cur)return;cur.text=el.innerText.replace(/\n$/,'');mirror(cur);changed();scheduleReview();});
        }else el.addEventListener('click',()=>{focused=b.id;});
        row.append(el);
        if(teacher)row.insertAdjacentHTML('beforeend','<small class="nv-quote-note">— 강사 한마디 · ‘강사 코멘트’ 칸에서 고칩니다</small>');
      }
      const tools=document.createElement('div');tools.className='nv-block-tools';
      const add=(label,run,icon)=>{const button=document.createElement('button');button.type='button';button.title=label;button.setAttribute('aria-label',label);button.innerHTML=icon?`<svg aria-hidden="true" style="transform:rotate(${icon})"><use href="/data-core/assets/core-icons.svg#${icon==='0deg'?'Trash2':'ArrowLeft'}"></use></svg>`:escape(label);button.onclick=run;tools.append(button);};
      if(b.type==='image')add('이 사진 받기',async()=>{try{await download([b.fileId],false);}catch(error){toast(error.message,'error');}});
      if([...WRITTEN_TYPES,'caption'].includes(b.type))add('AI 다듬기',()=>textAction(current(b.id)||b));
      for(const [label,icon,delta] of [['위로','90deg',-1],['아래로','-90deg',1],['블록 삭제','0deg',0]])add(label,()=>{
        const i=blocks.findIndex(v=>v.id===b.id),cur=blocks[i];if(i<0||(delta&&(i+delta<0||i+delta>=blocks.length)))return;checkpoint();
        if(delta)[blocks[i],blocks[i+delta]]=[blocks[i+delta],blocks[i]];
        else{blocks.splice(i,1);if(cur.type==='closing')$('resultFooter').value='';if(cur.type==='hashtags')$('draftTags').value='';if(cur.type==='contact')$('resultContact').value='';if(cur.type==='quote'&&cur.role==='teacher')$('blogTeacherComment').value='';}
        $('draftContent').value=lastBody=bodyText();changed();renderBlocks();
      },icon);
      row.append(tools);page.append(row);
    }
    const n=publishingImages({blocks}).length;$('blogPublishImages').textContent=`게시용 이미지 ${n}장 다운로드`;$('blogPublishImages').disabled=!n;$('blogPhotosInOrder').disabled=!n;
    renderReview();
  }
  // New blocks go right after the block being written, never below the contact/closing/hashtag tail.
  // The block being written: the one holding the caret (toolbar buttons keep it, see mousedown below).
  const activeBlock=()=>{const id=document.activeElement?.closest?.('#blogBlocks [data-block-id]')?.dataset.blockId;if(id)focused=id;return focused;};
  result.querySelector('.nv-toolbar').addEventListener('mousedown',event=>{if(event.target.closest('.nv-tool'))event.preventDefault();});
  function insertBlock(block){
    activeBlock();checkpoint();const tail=blocks.findIndex(v=>['contact','closing','hashtags'].includes(v.type));let at=blocks.findIndex(v=>v.id===focused);
    at=at>=0?at+1:tail>=0?tail:blocks.length;if(tail>=0&&at>tail)at=tail;
    blocks.splice(at,0,block);focused=block.id;if(WRITTEN_TYPES.includes(block.type))$('draftContent').value=lastBody=bodyText();
    changed();renderBlocks();$('blogBlocks').querySelector(`[data-block-id="${block.id}"] .nv-text`)?.focus();
  }
  const textBlock=type=>({id:crypto.randomUUID(),type,text:''});
  $('blogAddParagraph').onclick=()=>insertBlock(textBlock('paragraph'));
  $('blogAddHeading').onclick=()=>insertBlock(textBlock('heading'));
  $('blogAddQuote').onclick=()=>insertBlock(textBlock('quote'));
  $('blogAddDivider').onclick=()=>insertBlock({id:crypto.randomUUID(),type:'divider',text:''});
  $('blogAddPhoto').onclick=()=>{
    const menu=$('blogPhotoMenu');if(!menu.hidden){menu.hidden=true;return;}
    if(!photos.length){toast('위의 사진 선택에서 먼저 사진을 고르세요.','error');return;}
    menu.innerHTML=`<p>넣을 사진을 고르세요</p><div>${photos.map((p,i)=>`<button type="button" data-photo-pick="${i}" aria-label="사진 ${i+1} 넣기"><img loading="lazy" src="/api/data-core/files/${encodeURIComponent(p.editedFileId||p.fileId)}" alt=""></button>`).join('')}</div>`;menu.hidden=false;
    menu.querySelectorAll('[data-photo-pick]').forEach(b=>b.onclick=()=>{const p=photos[Number(b.dataset.photoPick)];menu.hidden=true;insertBlock({id:crypto.randomUUID(),type:'image',role:'body',fileId:p.editedFileId||p.fileId,sourceFileId:p.fileId});});
  };
  $('blogPolish').onclick=()=>{const id=activeBlock(),b=blocks.find(v=>v.id===id&&[...WRITTEN_TYPES,'caption'].includes(v.type));if(!b){toast('다듬을 문단을 먼저 클릭하세요.','error');return;}textAction(b);};
  $('blogSaveTemp').onclick=()=>{if(!$('draftTitle').value.trim()){toast('제목을 입력하세요.','error');titleBox.focus();return;}$('saveDraftBtn').click();};
  $('blogCopyPlain').onclick=()=>copyText();
  $('blogPhotosInOrder').onclick=()=>download(publishingImages(read()).map(p=>p.id),false);
  $('blogTeacherComment').addEventListener('input',()=>{if(!blocks.length)return;blocks=placeTeacherComment(blocks,$('blogTeacherComment').value);renderBlocks();});
  $('draftCampus').addEventListener('change',()=>{overlap=null;scheduleOverlap();loadStats();});
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
      pendingSave=null;void loadStats();timings.saveMs=Math.round(performance.now()-started);$('blogTimings').textContent=JSON.stringify(timings,null,2);return value.draft;
    }catch(error){if(token===epoch)saveStatus.textContent=`저장 실패: ${error.message}`;toast(error.message,'error');}finally{saving=false;}
  }
  function reset(){epoch++;downloadController?.abort();textController?.abort();coverEditor.reset();cover=null;reviewCache.clear();reviewSnapshot='';reviewResult=null;templates={};$('blogAiReviewResult').replaceChildren();$('blogTextStatus').textContent='';$('blogRewriteDialog').close();photos=[];blocks=[];aiSentences=[];overlap=null;focused=editing='';revision=0;template=templateDefaults();lastBody='';saved='';pendingSave=null;undo.length=0;defaultsEdit++;for(const id of fieldIds){if($(id).type==='checkbox')$(id).checked=false;else $(id).value='';}$('blogTemplate').value='class';applyTemplate();saveStatus.textContent='';$('blogDownloadStatus').textContent='';renderPhotos();renderBlocks();}
  function load(draft){
    state.blogFileIssues=draft.metadata?.blogPost?.fileIssues||[];
    const p=draft.metadata?.blogPost;if(!p){photos=synchronizePhotos(state.selectedFileIds,[],state.knownFiles);assemble(false);saved=signature();return;}cover=p.cover||null;
    photos=structuredClone(p.photos);blocks=structuredClone(p.blocks);aiSentences=Array.isArray(p.generation?.aiSentences)?p.generation.aiSentences:[];overlap=null;revision=p.revision;template={...templateDefaults(),...p.template};lastBody=blocks.filter(b=>['lead','paragraph','heading'].includes(b.type)).map(b=>b.text).join('\n\n');$('draftContent').value=lastBody;
    for(const [id,key] of [['blogMessage','coreMessage'],['blogReader','reader'],['blogInclude','include'],['blogExclude','exclude'],['blogFacts','facts'],['blogSources','sources'],['blogStyle','style'],['blogTeacherComment','teacherComment']])$(id).value=p.brief?.[key]||'';
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
      if(block){$('blogRewriteBefore').value=block.text;$('blogRewriteAfter').value=value.text;$('blogRewriteReason').textContent=value.reason;$('blogRewriteDialog').showModal();$('blogRewriteApply').onclick=()=>{if(snapshot!==signature()){toast('현재 내용이 바뀌었습니다. 제안을 다시 확인하세요.','error');return;}checkpoint();block.text=$('blogRewriteAfter').value;mirror(block);changed();renderBlocks();$('blogRewriteDialog').close();};}
      else{reviewSnapshot=reviewKey();reviewResult={...value,checkedAt:new Date().toISOString()};reviewCache.set(snapshot,value);if(reviewCache.size>8)reviewCache.delete(reviewCache.keys().next().value);$('blogAiReviewResult').innerHTML=value.checks.map(c=>`<p>${escape(c.blockId)} · ${escape(({pass:'텍스트 검토 통과',needs_changes:'수정 필요',human_required:'사람 확인'})[c.status])}: ${escape(c.reason)}</p>`).join('');}
      $('blogTextStatus').textContent='텍스트 검토 완료 · 실제 사진·외부 사실은 담당자 확인 필요';
      timings[block?'blockRewriteMs':'contentReviewMs']=Math.round(performance.now()-start);$('blogTimings').textContent=JSON.stringify(timings,null,2);
    }catch(error){if(token===epoch)$('blogTextStatus').textContent=error.name==='AbortError'?'검토 중단 · 미검사':`검토 실패 · 미검사: ${error.message}`;}finally{clearTimeout(timer);if(textController===controller){textController=null;$('blogTextCancel').hidden=true;}}
  }
  for(const id of ['aiCommand','draftTitle','draftContent','resultFooter','draftTags'])$(id).addEventListener('input',()=>{changed();renderReview();});
  async function copyText(){try{if(!blocks.length)assemble(false);const p=read();if(inspectPost(p).some(i=>i.status==='needs_changes'))throw Error('수정 필요 항목을 확인한 뒤 완성본을 복사하세요.');const refs=await resolveFiles(publishingImages(p).map(v=>v.id),p.campusId,undefined,false);if(refs.some(v=>v.error))throw Error('접근할 수 없는 게시용 이미지가 있습니다. 연결을 확인하세요.');const text=postText(p),images=publishingImages(p).length,headings=p.blocks.filter(b=>b.type==='heading'&&b.text.trim()).length;await navigator.clipboard.writeText(text);toast(`서식 없이 복사했습니다 · 글 ${text.replace(/\[사진 \d+\]/g,'').replace(/\s/g,'').length.toLocaleString('ko-KR')}자 · 소제목 ${headings}개 · 사진 자리 ${images}곳`);}catch(error){toast(error.message,'error');}}
  for(const id of ['strategyMode','blogTemplate','blogGreeting','blogTop','blogBottom','blogAlign','blogSpacing','blogFont','blogContactMode'])$(id).addEventListener('change',()=>{defaultsEdit++;changed();});
  $('blogTemplate').addEventListener('change',()=>{template={...templateDefaults(),...templates[$('blogTemplate').value],templateId:$('blogTemplate').value};applyTemplate();});
  $('blogSaveTemplate').onclick=async()=>{const token=epoch;$('blogSaveTemplate').disabled=true;try{const response=await fetch('/api/data-core/content/defaults',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({sourceApp:'blog',campusId:$('draftCampus').value||null,blogSettings:{strategyMode:$('strategyMode').value,template:readTemplate()}})});const value=await response.json();if(!response.ok)throw Error(value.error);if(token===epoch){templates=value.defaults.blogSettings.templates||{};$('blogTemplateStatus').textContent='캠퍼스 기본 양식 저장 완료';}}catch(error){if(token===epoch)$('blogTemplateStatus').textContent=error.message;}finally{$('blogSaveTemplate').disabled=false;}};
  // 양식 수정 dialog: fields already apply live via the 'change' listeners above (that is what
  // "이번 글에 적용" means here — nothing further to do but close). 취소 restores the snapshot taken
  // when the dialog opened, so an edit made and abandoned mid-dialog never lingers on the post.
  // 문구·태그·연락처만 바뀌면 그 블록만 다시 조립합니다 — 본문·사진은 그대로, 다시 생성하지 않습니다.
  function applyManaged(values){
    if(!blocks.length)return false;
    // The post's own AI content tags stay after the fixed keywords/tags when settings are re-applied.
    const tags=hashtagText(postHashtags(values.hashtags,[],state.blogAiTags||[]));
    checkpoint();$('resultFooter').value=values.closing;$('draftTags').value=tags;$('resultContact').value=values.contactText;
    blocks=placeManaged(blocks,{greeting:values.greeting,contact:values.contactText,closing:values.closing,hashtags:tags});
    changed();renderBlocks();return true;
  }
  window.addEventListener('pagehide',()=>downloadController?.abort());
  renderPhotos();renderBlocks();void loadStats();
  return {read,save,load,reset,selectionChanged:renderPhotos,assemble,applyManaged,review:renderReview,copy:copyText,downloadPackage:()=>$('blogPackage').click(),defaultsToken:()=>defaultsEdit,
    applyDefaults(value,token){if(token!==defaultsEdit||state.editingDraftId||!value)return;templates=value.templates||{};template={...templateDefaults(),...value.template};$('strategyMode').value=value.strategyMode||'balanced';$('blogTemplate').value=template.templateId;applyTemplate();},
    hasUnsaved:()=>Boolean((blocks.length||photos.length||Object.values(brief()).some(v=>v.trim()))&&signature()!==saved),
    instructions:()=>({brief:brief(),commonDescription:$('blogCommonDescription').value,photos:photos.map(({fileId,kind,description,facts,exclude,externalAiConsent})=>({fileId,kind,description,facts,exclude,externalAiConsent}))}),
    async aiPhotos(signal){const ids=photos.filter(p=>p.externalAiConsent&&!['student','teacher','fact','unknown'].includes(p.kind)).map(p=>p.fileId);if(!ids.length)return [];const rows=await resolveFiles(ids,$('draftCampus').value,signal);const bad=rows.find(r=>r.error);if(bad)throw Error(bad.error);return rows.filter(r=>!r.preserveReason).map(r=>r.selectedId).slice(0,AI_IMAGE_PHOTOS);},
    recordTime(key,start){timings[key]=Math.round(performance.now()-start);$('blogTimings').textContent=JSON.stringify(timings,null,2);},
  };
}
