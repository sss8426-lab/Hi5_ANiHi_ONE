import {instagramImageMime} from './instagram-image-formats.js';
import {mountAiUsage} from './ai-usage.js?v=20260921-performance';
import {mountTextPresets} from './content-text-presets.js?v=20260923-brandfix';
import {normalizeTags} from './content-preset-catalog.js';
import {captionTail} from './content-caption.js?v=20260922-presets';
import {mountBlogWorkflow} from './blog-workflow.js?v=20260923-unify2';

const state = {
  context: null,
  health: null,
  campuses: [],
  files: [],
  drafts: [],
  sourceApp: location.pathname.endsWith('/instagram') ? 'instagram' : 'blog',
  editingDraftId: null,
  selectedFileIds: [],
  selectedDerivedFileIds: [],
  knownFiles: new Map(),
  folderId: 'root',
  page: 1,
  browseGeneration: 0,
  defaultsGeneration: 0,
  busy: false,
  aiController: null,
  aiFile: null,
  aiSourceId: null,
  // Blog homefeed/search content-strategy state (unused for Instagram).
  blogStrategy: null,
  blogTitles: null,
  blogSelectedTitleKind: null,
  blogFittedKind: null, // which title kind the current lead/body was actually written for
  currentLead: '',
  currentBody: '',
  lastHashtags: [],
  lastCta: '',
  blogNextTopics: [],
  blogWarnings: [],
  blogRecentTitlesCache: [],
};
const BLOG_PHOTO_LIMIT = 10;
// Adaptive long-edge/quality ladder tried in order until the JPEG lands at or under the soft
// target; the browser never upscales a smaller original past its own size.
const AI_OPTIMIZE_STEPS = [
  { edge: 2048, quality: 0.82 },
  { edge: 1800, quality: 0.78 },
  { edge: 1600, quality: 0.74 },
  { edge: 1280, quality: 0.70 },
];
const AI_OPTIMIZE_TARGET_BYTES = 1.5 * 1024 * 1024;
const AI_OPTIMIZE_HARD_CAP_BYTES = 2 * 1024 * 1024;

let derivativeEditor, instagramProduction, aiUsagePanel, textPresets, blogWorkflow, lastInstagramSettings;
let browseController, renderedFolder='', defaultsEdited=0;
let savedDraftSnapshot='',savedDefaultsSnapshot='';
const draftSnapshot=()=>JSON.stringify(['draftTitle','draftSummary','draftContent','draftTags','resultFooter','resultContact','publishStatus','contentPurpose'].map(id=>$(id).value));
const defaultsSnapshot=()=>JSON.stringify([$('defaultHashtags').value,$('defaultFooter').value]);
const thumbnailCache = new window.DataCorePrivateImageCache({maxBytes:8*1024*1024,maxEntries:50,concurrency:3,onUnauthorized:clearPrivateState});
const legacyThumbnails = new window.DataCorePrivateImageCache({maxBytes:32*1024*1024,maxEntries:50,concurrency:2,onUnauthorized:clearPrivateState,transform:async(blob,path,signal)=>{
  const thumbnail=await window.DataCoreLibraryThumbnail.prepare(blob,signal);
  const file=state.knownFiles.get(decodeURIComponent(path.split('/').at(-1)));
  if(file?.canMove){
    // Reuse the existing authenticated, idempotent derivative endpoint, never mutate the original.
    try{await window.DataCoreLibraryThumbnail.persist(thumbnail,file.id,signal);}catch(error){if([401,403].includes(error.status)){clearPrivateState();throw error;}if(signal.aborted)throw error;}
  }
  return thumbnail;
}});
const thumbnailFor=file=>file.thumbnailUrl||file.previewUrl;
const cacheFor=path=>state.files.some(file=>!file.thumbnailUrl&&file.previewUrl===path)||[...state.knownFiles.values()].some(file=>!file.thumbnailUrl&&file.previewUrl===path)?legacyThumbnails:thumbnailCache;
let thumbnailObserver;

function clearPrivateState() {
  blogWorkflow?.reset();
  browseController?.abort();state.browseGeneration++;state.defaultsGeneration++;
  thumbnailObserver?.disconnect();thumbnailCache.clear();renderedFolder='';
  legacyThumbnails.clear();
  aiUsagePanel?.clear();
  textPresets?.clear();
  state.files=[];state.selectedFileIds=[];state.selectedDerivedFileIds=[];state.knownFiles.clear();
  $('photoFolders')?.replaceChildren();$('photoBreadcrumb')?.replaceChildren();$('photoPages')?.replaceChildren();
  renderFilePicker();renderSelectedFiles();instagramProduction?.invalidated();
}
function observeThumbnails() {
  thumbnailObserver?.disconnect();
  const epoch=state.browseGeneration;
  thumbnailObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{
    if(!entry.isIntersecting)return;const img=entry.target;thumbnailObserver.unobserve(img);
    void cacheFor(img.dataset.thumbnail).get(img.dataset.thumbnail).then(url=>{if(epoch===state.browseGeneration&&img.isConnected)img.src=url;}).catch(error=>{if(img.isConnected&&error.name!=='AbortError')img.alt=error.code==='unsupported_preview'?'미리보기를 지원하지 않는 형식':'미리보기 생성 실패 · 확대해서 확인하세요';});
  }),{root:$('filePickList'),rootMargin:'80px'});
  $('filePickList').querySelectorAll('img[data-thumbnail]').forEach(img=>thumbnailObserver.observe(img));
}

const $ = (id) => document.getElementById(id);

function h(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

async function api(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const type = response.headers.get('content-type') || '';
  const body = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    if ([401,403].includes(response.status)) clearPrivateState();
    const message = typeof body === 'object' ? (body?.error || body?.message || '요청을 완료하지 못했습니다.') : '요청을 완료하지 못했습니다.';
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return body;
}

function toast(message, type = 'success') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast ${type}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add('hidden'), 3200);
}

function showNotice(message) {
  const el = $('globalNotice');
  if (!message) return el.classList.add('hidden');
  el.textContent = message;
  el.classList.remove('hidden');
}

function roleLabel(role) {
  return ({
    MASTER: '마스터 관리자', CAMPUS_ADMIN: '캠퍼스 관리자', SUPER_ADMIN: '마스터 관리자', CAMPUS_DIRECTOR: '캠퍼스 원장', TEACHER: '교사', STAFF: '직원'
  })[role] || role || '-';
}

function sourceLabel(source) {
  return source === 'instagram' ? '인스타그램' : '블로그';
}

function statusLabel(status) {
  return ({
    draft: '초안',
    review: '검토',
    ready: '게시 준비',
    published: '게시 완료',
    archived: '보관',
  })[status] || status || '초안';
}

function canWrite() {
  return Boolean(state.context?.canWrite);
}

function isSuperAdmin() {
  return Boolean(state.context?.isSuperAdmin);
}

function renderConnection() {
  const card = $('connectionCard');
  const health = state.health;
  if (health?.ok) {
    card.className = 'connection-card online';
    card.querySelector('strong').textContent = '중앙 저장소 연결됨';
    card.querySelector('small').textContent = 'D1 + R2 정상';
  } else {
    card.className = 'connection-card degraded';
    card.querySelector('strong').textContent = '일부 연결 필요';
    const db = health?.bindings?.database ? 'D1 정상' : 'D1 필요';
    const files = health?.bindings?.files ? 'R2 정상' : 'R2 필요';
    card.querySelector('small').textContent = `${db} · ${files}`;
  }
}

function renderUser() {
  const chip = $('userChip');
  const context = state.context;
  if (!context?.authenticated) {
    chip.querySelector('strong').textContent = '로그인이 필요합니다';
    chip.querySelector('small').textContent = 'DATA CORE 접근 불가';
    chip.querySelector('.avatar').textContent = '?';
    showNotice('DATA CORE를 사용하려면 로그인해야 합니다.');
    return;
  }
  const user = context.user || {};
  chip.querySelector('strong').textContent = context.memberships?.find(m => m.role === 'CAMPUS_ADMIN')?.campusName || user.displayName || user.email || '사용자';
  chip.querySelector('small').textContent = context.isSuperAdmin
    ? '마스터 관리자'
    : context.memberships?.length
      ? context.memberships.map((m) => `${m.campusName || '공통'} · ${roleLabel(m.role)}`).join(' / ')
      : '권한 미부여';
  chip.querySelector('.avatar').textContent = String(user.displayName || user.email || 'H').trim().slice(0, 1).toUpperCase();
  showNotice(context.canWrite ? '' : '로그인은 확인됐지만 DATA CORE 사용 권한이 아직 부여되지 않았습니다.');
  $('saveDraftBtn').disabled = !context.canWrite;
}

function fillCampusSelect(select, options = {}) {
  if (!select) return;
  const rows = [];
  if (options.all) rows.push('<option value="">전체 캠퍼스</option>');
  if (options.allowOrganization && isSuperAdmin()) rows.push('<option value="">조직 공통</option>');
  rows.push(...state.campuses.map((campus) => `<option value="${h(campus.id)}">${h(campus.name)}</option>`));
  select.innerHTML = rows.join('');
}

function renderCampusSelectors() {
  fillCampusSelect($('draftCampus'), { allowOrganization: true });
}

function setSourceApp(sourceApp) {
  state.sourceApp = sourceApp === 'instagram' ? 'instagram' : 'blog';
  document.querySelectorAll('[data-source-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.sourceTab === state.sourceApp);
  });
  document.querySelectorAll('[data-content-nav]').forEach((link) => {
    link.classList.toggle('active', link.dataset.contentNav === state.sourceApp);
  });
  const pageTitle = state.sourceApp === 'instagram' ? '인스타 자동화' : '블로그 자동화';
  $('contentPageTitle').textContent = pageTitle;
  document.title = `${pageTitle} · HI5·ANiHi DATA CORE`;
  $('contentLabel').textContent = state.sourceApp === 'instagram' ? '캡션' : '본문';
  const instagram = state.sourceApp === 'instagram';
  $('draftContent').rows = instagram ? 5 : 12;
  $('commandLabel').textContent = instagram ? '어떤 느낌으로 편집할까요?' : '어떤 글을 만들까요?';
  $('aiCommand').placeholder = instagram ? 'AI 보조 배경을 밝고 차분하게 보정해줘. 실제 수업·학생 작품·성과처럼 보이는 내용과 글자는 추가하지 말아줘.' : '고1 칸만화 수업 사진입니다. 인체와 장면 연출을 연습한 내용을 학부모가 이해하기 쉽게 작성해줘.';
  $('generateAi').textContent = instagram ? 'AI 보조 이미지 편집' : '블로그 글 만들기';
  $('regenerateAi').textContent = instagram ? '다시 편집' : '전체 다시 작성';
  $('copyContent').textContent = instagram ? '문구 복사' : '글 복사';
  $('aiPrivacy').textContent = instagram ? 'AI 이미지 편집은 선택한 대표 사진 1장에 대해 실행됩니다.' : '선택한 사진은 AI 분석에 맞게 자동 최적화되어 전송됩니다. 자료보관함 원본 파일은 변경되지 않습니다.';
  $('strategyModeField').hidden = instagram;
  $('downloadImage').hidden = instagram;
  $('downloadMenu').hidden = instagram;
  resetDraftForm(false);
  instagramProduction?.refresh();
}

function selectedFiles() {
  return state.selectedFileIds.map((id) => state.knownFiles.get(String(id)) || { id, fileName: '이전 작업 파일', mimeType: '' });
}

function renderSelectedFiles() {
  blogWorkflow?.selectionChanged();
  instagramProduction?.selectionChanged();
  const rows = selectedFiles();
  derivativeEditor?.update(rows, state.sourceApp === 'instagram');
  $('selectedDerivatives').innerHTML = state.selectedDerivedFileIds.map((id) => {
    return `<div class="selected-file derived-selection"><img src="/api/data-core/files/${encodeURIComponent(id)}" alt="인스타 파생 이미지" width="64" height="80" loading="lazy" decoding="async"><div><strong>인스타 파생 이미지</strong><small>2160 × 2700px · 4:5</small></div><button class="ghost-btn" data-remove-derived="${h(id)}" type="button">제외</button></div>`;
  }).join('');
  $('selectedDerivatives').querySelectorAll('[data-remove-derived]').forEach((button) => {
    button.onclick = () => {
      state.selectedDerivedFileIds = state.selectedDerivedFileIds.filter((id) => id !== button.dataset.removeDerived);
      renderSelectedFiles(); renderFilePicker();
    };
  });
  $('photoCount').textContent = state.sourceApp === 'instagram' ? `선택 ${rows.length} / 10` : `사진 ${rows.length}/${BLOG_PHOTO_LIMIT}장 선택`;
  $('selectedFiles').innerHTML = rows.map((file, index) => `<button data-remove-file="${h(file.id)}" type="button" aria-label="선택 사진 ${index + 1} 제외" title="선택 해제">${thumbnailFor(file) ? `<img data-thumbnail="${h(thumbnailFor(file))}" alt="선택 ${index+1}">` : `<span>${index+1}</span>`}</button>`).join('');
  $('selectedFiles').querySelectorAll('img[data-thumbnail]').forEach(img=>{void cacheFor(img.dataset.thumbnail).get(img.dataset.thumbnail,{priority:true}).then(url=>{if(img.isConnected)img.src=url;}).catch(()=>{});});
  document.querySelectorAll('[data-remove-file]').forEach((button) => {
    button.onclick = () => {
      if (state.busy) return;
      state.selectedFileIds = state.selectedFileIds.filter((id) => String(id) !== String(button.dataset.removeFile));
      renderSelectedFiles();
      renderFilePicker();
    };
  });
}

async function loadHealthAndContext() {
  void api('/api/data-core/health').then(value=>{state.health=value;renderConnection();}).catch(()=>{state.health=null;renderConnection();});
  const next=await api('/api/data-core/context');
  const accessKey=value=>JSON.stringify([value?.user?.id,value?.user?.internalUserId,value?.user?.email,value?.memberships,value?.isSuperAdmin,value?.canWrite]);
  if(state.context&&accessKey(state.context)!==accessKey(next))clearPrivateState();
  state.context=next;
  window.DataCoreWorkNavigation?.setContext(next);
  renderUser();
  if (!state.context?.authenticated) return;
  try {
    const response = await api('/api/data-core/campuses');
    state.campuses = response.campuses || [];
    const selectedCampus=$('draftCampus').value;
    renderCampusSelectors();
    if([...$('draftCampus').options].some(option=>option.value===selectedCampus))$('draftCampus').value=selectedCampus;
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function loadFiles() {
  if (!state.context?.authenticated || state.busy) return;
  const token = ++state.browseGeneration;
  browseController?.abort();browseController=new AbortController();
  thumbnailObserver?.disconnect();thumbnailCache.cancelPending();thumbnailCache.blocked=false;
  legacyThumbnails.cancelPending();legacyThumbnails.blocked=false;
  const id=state.folderId,skipFolders=renderedFolder===id;
  state.files=[];renderFilePicker();$('photoPages').replaceChildren();
  if(!skipFolders){$('photoFolders').replaceChildren();$('photoBreadcrumb').setAttribute('aria-busy','true');}
  $('pickerStatus').textContent = '사진을 불러오고 있습니다.';
  try {
    await window.DataCoreLibraryClient.browse(api, { id, page: state.page, q: $('fileSearchInput').value.trim() },{signal:browseController.signal,skipFolders,counts:false,skipEmptyRoot:true,onView:view=>{
    if (token !== state.browseGeneration) return;renderedFolder=view.folder.id;
    if(state.folderId!==view.folder.id){state.folderId=view.folder.id;state.page=1;$('fileSearchInput').value='';}
    $('photoBreadcrumb').removeAttribute('aria-busy');
    const folderCampusId = view.folder.campusId || '';
    if ([...$('draftCampus').options].some(option => option.value === folderCampusId) && $('draftCampus').value !== folderCampusId) {
      $('draftCampus').value = folderCampusId;
      resetDraftForm();
      instagramProduction?.refresh();
      void loadDefaults();
    }
    $('photoBreadcrumb').innerHTML = (view.breadcrumbs || []).map(item => `<button type="button" data-folder="${h(item.id)}">${h(item.title)}</button>`).join('<span aria-hidden="true">/</span>');
    $('photoFolders').innerHTML = window.DataCoreLibraryClient.folderGroups(view, $('fileSearchInput').value).map(([group, folders]) =>
      `<section class="photo-folder-group"><h3>${h(group)}</h3><div class="photo-folder-grid">${folders.map(folder => `<button type="button" data-folder="${h(folder.id)}"><svg aria-hidden="true"><use href="/data-core/assets/core-icons.svg#Folder"></use></svg><strong>${h(folder.title)}</strong></button>`).join('')}</div></section>`).join('');
    document.querySelectorAll('[data-folder]').forEach(button => { button.onclick = () => { if (state.busy) return; renderedFolder='';state.folderId = button.dataset.folder; state.page = 1; $('fileSearchInput').value = ''; const crumb=document.createElement('span');crumb.textContent=button.textContent.trim();$('photoBreadcrumb').replaceChildren(crumb);void loadFiles(); }; });
    },onListing:listing=>{
    if (token !== state.browseGeneration) return;
    state.files = (listing.files || []).filter(file => state.sourceApp === 'instagram'
      ? instagramImageMime(file.mimeType, file.fileName)
      : ['image/jpeg','image/png','image/webp'].includes(file.mimeType));
    state.files.forEach((file) => state.knownFiles.set(String(file.id), file));
    for(const key of state.knownFiles.keys())if(state.knownFiles.size>100&&!state.selectedFileIds.includes(key)&&!state.files.some(file=>file.id===key))state.knownFiles.delete(key);
    $('pickerStatus').textContent = state.files.length ? '' : '이 폴더에 선택할 사진이 없습니다.';
    $('photoPages').innerHTML = `<button type="button" class="ghost-btn" id="photoPrev" ${state.page <= 1 ? 'disabled' : ''} aria-label="이전 사진 페이지">←</button><span>${state.page}</span><button type="button" class="ghost-btn" id="photoNext" ${listing.hasMore ? '' : 'disabled'} aria-label="다음 사진 페이지">→</button>`;
    $('photoPrev').onclick = () => { if (state.busy) return; state.page--; void loadFiles(); };
    $('photoNext').onclick = () => { if (state.busy) return; state.page++; void loadFiles(); };
    renderFilePicker();
    renderSelectedFiles();
    }});
  } catch (error) {
    if (token !== state.browseGeneration || error.name==='AbortError') return;
    if(error.status===404)clearPrivateState();
    state.files = []; renderFilePicker();
    $('pickerStatus').textContent = error.message;
    if ([401,403].includes(error.status)) { state.selectedFileIds = []; state.knownFiles.clear(); renderSelectedFiles(); }
  }
}

function renderFilePicker() {
  const list = $('filePickList');
  if (!state.files.length) {
    window.DataCoreImageGallery.close('content-photos');
    list.innerHTML = '';
    delete list.dataset.signature;
    return;
  }
  const signature = state.files.map(file => [file.id,file.thumbnailUrl,file.previewUrl].join(':')).join('|');
  if (list.dataset.signature === signature) {
    list.querySelectorAll('[data-pick-file]').forEach(button => {
      const selected = state.selectedFileIds.includes(button.dataset.pickFile);
      button.setAttribute('aria-pressed',String(selected));
      button.querySelector('.photo-check').textContent = selected ? '✓' : '';
    });
    return;
  }
  list.dataset.signature = signature;
  window.DataCoreImageGallery.close('content-photos');
  list.innerHTML = state.files.map((file, index) => {
    const selected = [...state.selectedFileIds, ...state.selectedDerivedFileIds].includes(String(file.id));
    return `<article class="photo-tile">
      <button data-pick-file="${h(file.id)}" type="button" aria-label="사진 ${index + 1} 선택" aria-pressed="${selected}">
        ${thumbnailFor(file)?`<img data-thumbnail="${h(thumbnailFor(file))}" alt="자료보관함 사진 ${index+1}" decoding="async">`:'<svg class="photo-placeholder" aria-hidden="true"><use href="/data-core/assets/core-icons.svg#Image"></use></svg>'}
        <span class="photo-check" aria-hidden="true">${selected ? '✓' : ''}</span>
      </button>
      <button class="photo-zoom" data-preview="${h(file.id)}" type="button" aria-label="사진 ${index + 1} 확대" title="확대"><svg><use href="/data-core/assets/core-icons.svg#Search"></use></svg></button>
    </article>`;
  }).join('');
  document.querySelectorAll('[data-pick-file]').forEach((button) => {
    button.onclick = () => {
      if (state.busy) return;
      const id = String(button.dataset.pickFile);
      if (state.selectedFileIds.includes(id)) state.selectedFileIds = state.selectedFileIds.filter(item => item !== id);
      else if (state.selectedFileIds.length >= BLOG_PHOTO_LIMIT) return toast(`사진은 최대 ${BLOG_PHOTO_LIMIT}장까지 선택할 수 있습니다.`, 'error');
      else state.selectedFileIds.push(id);
      renderFilePicker();
      renderSelectedFiles();
    };
  });
  observeThumbnails();
  list.querySelectorAll('[data-preview]').forEach(button => { button.onclick = () => {
    window.DataCoreImageGallery.open({scope:'content-photos',title:'사진',anchor:button,
      index:state.files.findIndex(file=>file.id===button.dataset.preview),
      items:state.files.map((file,index)=>({src:file.previewUrl,previewSrc:file.thumbnailUrl,title:`사진 ${index+1}`}))});
  }; });
}

function draftPayload() {
  captionTail($('resultFooter').value,$('draftTags').value,[],$('resultContact').value);
  const metadata = { footer: $('resultFooter').value, contactBlock: $('resultContact').value, callToAction: $('resultFooter').value || null };
  if (state.sourceApp === 'instagram') metadata.instagramDesign = instagramProduction?.read();
  if (state.sourceApp === 'blog') {
    metadata.strategyMode = $('strategyMode').value;
    if (state.blogStrategy) metadata.strategy = state.blogStrategy;
    if (state.blogTitles) metadata.titles = state.blogTitles;
    if (state.blogSelectedTitleKind) metadata.selectedTitleKind = state.blogSelectedTitleKind;
    if (state.blogNextTopics.length) metadata.nextTopics = state.blogNextTopics;
  }
  return {
    sourceApp: state.sourceApp,
    campusId: $('draftCampus').value || null,
    title: $('draftTitle').value.trim(),
    summary: $('draftSummary').value.trim() || null,
    content: $('draftContent').value,
    contentPurpose: $('contentPurpose').value,
    publishStatus: $('publishStatus').value,
    relatedFileIds: state.selectedFileIds,
    derivedFileIds: state.selectedDerivedFileIds,
    tags: normalizedHashtags($('draftTags').value),
    metadata,
  };
}

async function saveDraft(event) {
  event.preventDefault();
  if (!canWrite()) return toast('DATA CORE 쓰기 권한이 필요합니다.', 'error');
  if(state.sourceApp==='blog'&&blogWorkflow){const draft=await blogWorkflow.save();if(draft){savedDraftSnapshot=draftSnapshot();void loadDrafts();}return draft;}
  const button = $('saveDraftBtn');
  button.disabled = true;
  button.textContent = state.editingDraftId ? '수정 중...' : '저장 중...';
  try {
    const payload = draftPayload();
    const submitted=draftSnapshot();
    const url = state.editingDraftId
      ? `/api/data-core/content/${encodeURIComponent(state.editingDraftId)}`
      : '/api/data-core/content';
    const response = await api(url, {
      method: state.editingDraftId ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    toast(`${sourceLabel(state.sourceApp)} 초안을 저장했습니다.`);
    state.editingDraftId = response.draft.id;
    savedDraftSnapshot=submitted;
    await loadDrafts();
    instagramProduction?.invalidated();
    return response.draft;
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = !canWrite();
    button.textContent = '초안 저장';
  }
}

function resetDraftForm(clearSource = true) {
  state.blogFileIssues = [];
  state.pendingBlogGeneration = false;
  $('aiCommand').value = '';
  state.editingDraftId = null;
  instagramProduction?.load({});
  state.selectedFileIds = [];
  blogWorkflow?.reset();
  state.selectedDerivedFileIds = [];
  derivativeEditor?.reset();
  $('draftForm').reset();
  $('aiResult').hidden = true;
  $('aiImageResult').hidden = true;
  $('aiOutput').removeAttribute('src'); $('aiOriginal').removeAttribute('src');
  state.aiFile = null; state.aiSourceId = null;
  $('retryCaption').hidden = true;
  $('aiStatus').textContent = '';
  if (!clearSource) {
    $('publishStatus').value = 'draft';
    $('contentPurpose').value = 'class-story';
  }
  $('deleteDraftBtn').classList.add('hidden');
  $('saveDraftBtn').textContent = state.sourceApp === 'blog' ? '저장하기' : '초안 저장';
  $('existingDraftBadge').classList.add('hidden');
  state.blogStrategy = null; state.blogTitles = null; state.blogSelectedTitleKind = null; state.blogFittedKind = null;
  state.currentLead = ''; state.currentBody = ''; state.lastHashtags = []; state.lastCta = ''; state.blogNextTopics = []; state.blogWarnings = [];
  $('strategyMode').value = 'balanced';
  $('titlePicker').hidden = true;
  $('titlePickerStatus').textContent = '';
  $('nextTopics').hidden = true;
  $('publishChecklist').hidden = true;
  savedDraftSnapshot=draftSnapshot();
  renderSelectedFiles();
  renderFilePicker();
}

function loadDraftIntoForm(draft) {
  if (state.busy) return;
  state.sourceApp = draft.sourceApp;
  setSourceApp(draft.sourceApp);
  state.editingDraftId = draft.id;
  const metadata = draft.metadata || {};
  $('draftCampus').value = draft.campusId || '';
  $('contentPurpose').value = metadata.contentPurpose || 'class-story';
  $('draftTitle').value = draft.title || '';
  $('draftSummary').value = draft.summary || '';
  $('draftContent').value = draft.content || '';
  $('draftTags').value = (draft.tags || []).join(', ');
  $('publishStatus').value = metadata.publishStatus || 'draft';
  $('resultFooter').value = metadata.footer || metadata.callToAction || '';
  $('resultContact').value = metadata.contactBlock || '';
  state.selectedFileIds = Array.isArray(metadata.relatedFileIds) ? metadata.relatedFileIds.map(String) : [];
  state.selectedDerivedFileIds = Array.isArray(metadata.derivedFileIds) ? metadata.derivedFileIds.map(String) : [];
  // Additive, optional fields from the homefeed/search content-strategy work — absent on any draft
  // saved before this feature, which must still open normally (see AGENTS.md 기존 draft 호환).
  $('strategyMode').value = metadata.strategyMode || 'balanced';
  state.blogStrategy = metadata.strategy || null;
  state.blogTitles = metadata.titles || null;
  state.blogSelectedTitleKind = metadata.selectedTitleKind || null;
  state.blogFittedKind = state.blogSelectedTitleKind;
  state.blogNextTopics = Array.isArray(metadata.nextTopics) ? metadata.nextTopics : [];
  // A reopened draft has no separately tracked lead/body — treat the saved content as the body base
  // for a future title switch (retitleTo() still works, just without a distinct lead paragraph).
  state.currentLead = ''; state.currentBody = draft.content || '';
  $('titlePicker').hidden = true;
  $('deleteDraftBtn').classList.remove('hidden');
  $('saveDraftBtn').textContent = state.sourceApp === 'blog' ? '저장하기' : '초안 수정';
  $('aiResult').hidden = false;
  blogWorkflow?.load(draft);
  $('resultHeading').textContent = state.sourceApp === 'blog' ? '블로그 완성본' : '지난 작업';
  $('existingDraftBadge').classList.toggle('hidden', state.sourceApp !== 'blog');
  state.folderId = draft.campusId ? 'campus:' + draft.campusId : 'root';
  void loadDefaults(); void loadFiles();
  renderSelectedFiles();
  renderFilePicker();
  renderNextTopics();
  renderPublishChecklist();
  instagramProduction?.load(metadata.instagramDesign);
  if (state.sourceApp === 'instagram') void instagramProduction?.restore(draft.id);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  savedDraftSnapshot=draftSnapshot();
}

async function loadDrafts() {
  if (!state.context?.authenticated) return;
  const params = new URLSearchParams({ sourceApp: state.sourceApp, limit: '100' });
  const q = $('draftSearchInput')?.value.trim();
  const status = $('draftStatusFilter')?.value;
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  try {
    const response = await api(`/api/data-core/content?${params}`);
    state.drafts = response.drafts || [];
    renderDrafts();
  } catch (error) {
    $('draftList').innerHTML = `<div class="empty-state">${h(error.message)}</div>`;
  }
}

function renderDrafts() {
  const list = $('draftList');
  if (!state.drafts.length) {
    list.innerHTML = '<div class="empty-state">저장된 초안이 없습니다.</div>';
    return;
  }
  list.innerHTML = state.drafts.map((draft) => {
    const metadata = draft.metadata || {};
    const files = (metadata.relatedFileIds?.length || 0) + (metadata.derivedFileIds?.length || 0);
    const snippet = draft.content || draft.summary || '';
    return `<article class="draft-card">
      <div>
        <strong>${h(draft.title)}</strong>
        <small>${h(draft.campusName || '조직 공통')} · ${h(sourceLabel(draft.sourceApp))}</small>
        <p>${h(snippet.slice(0, 180))}</p>
        <div class="draft-meta">
          <span class="pill">${h(statusLabel(metadata.publishStatus))}</span>
          <span class="pill">파일 ${files}개</span>
          ${(draft.tags || []).slice(0, 5).map((tag) => `<span class="pill">#${h(tag)}</span>`).join('')}
        </div>
      </div>
      <button class="ghost-btn" data-open-draft="${h(draft.id)}" type="button">열기</button>
    </article>`;
  }).join('');
  document.querySelectorAll('[data-open-draft]').forEach((button) => {
    button.onclick = async () => {
      if(blogWorkflow?.hasUnsaved()&&!confirm('미저장 변경사항을 닫고 저장한 글을 열까요?'))return;
      try{const response=await api('/api/data-core/content/'+encodeURIComponent(button.dataset.openDraft));loadDraftIntoForm(response.draft);$('draftsDialog').close();}catch(error){toast(error.message,'error');}
    };
  });
}

async function deleteDraft() {
  if (!state.editingDraftId) return;
  if (!confirm('이 콘텐츠 초안을 삭제할까요?')) return;
  try {
    await api(`/api/data-core/content/${encodeURIComponent(state.editingDraftId)}`, { method: 'DELETE' });
    toast('콘텐츠 초안을 삭제했습니다.');
    resetDraftForm();
    await loadDrafts();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function bindEvents() {
  document.querySelectorAll('[data-source-tab]').forEach((button) => {
    button.onclick = () => setSourceApp(button.dataset.sourceTab);
  });
  $('draftForm').onsubmit = saveDraft;
  $('newDraftBtn').onclick = () => {if(!blogWorkflow?.hasUnsaved()||confirm('미저장 변경사항을 닫고 새 초안을 시작할까요?'))resetDraftForm();};
  $('deleteDraftBtn').onclick = deleteDraft;
  $('clearFilesBtn').onclick = () => {
    if (state.busy) return;
    state.selectedFileIds = [];
    renderSelectedFiles();
    renderFilePicker();
  };
  $('fileSearchBtn').onclick = loadFiles;
  $('fileSearchInput').onkeydown = (event) => { if (event.key === 'Enter') loadFiles(); };
  let previousCampus = $('draftCampus').value;
  $('draftCampus').onfocus = () => { previousCampus = $('draftCampus').value; };
  $('draftCampus').onchange = () => {
    if(blogWorkflow?.hasUnsaved()&&!confirm('미저장 변경사항을 닫고 캠퍼스를 바꿀까요?')){$('draftCampus').value=previousCampus;return;}
    previousCampus=$('draftCampus').value;
    resetDraftForm();
    state.selectedFileIds = []; state.selectedDerivedFileIds = [];
    state.folderId = $('draftCampus').value ? 'campus:' + $('draftCampus').value : 'root'; state.page = 1;
    renderSelectedFiles(); void loadFiles(); void loadDefaults();
    instagramProduction?.refresh();
  };
  $('refreshDraftsBtn').onclick = loadDrafts;
  $('draftStatusFilter').onchange = loadDrafts;
  $('draftSearchInput').onkeydown = (event) => { if (event.key === 'Enter') loadDrafts(); };
  $('openDraftsBtn').onclick = () => { $('draftsDialog').showModal(); void loadDrafts(); };
  $('closeDraftsBtn').onclick = () => $('draftsDialog').close();
  $('saveDefaults').onclick = saveDefaults;
  for(const id of ['defaultHashtags','defaultFooter'])$(id).addEventListener('input',()=>{defaultsEdited++;$('defaultsStatus').textContent='기본 문구 변경사항 미저장';});
  $('generateAi').onclick = () => runAi();
  $('regenerateAi').onclick = () => runAi();
  $('retryCaption').onclick = () => runAi(true);
  $('cancelAi').onclick = () => state.aiController?.abort();
  $('copyContent').onclick = copyContent;
  $('copyPublishPackage').onclick = copyPublishPackage;
  $('regenerateTitles').onclick = async () => {
    if (state.busy || !state.blogStrategy) return;
    setAiBusy(true);
    $('titlePickerStatus').textContent = '다른 제목을 만들고 있습니다…';
    try {
      const recentTitles = await recentBlogTitles();
      const response = await api('/api/data-core/content/refine', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'titles', campusId: $('draftCampus').value || null, strategy: state.blogStrategy,
          notes: $('aiCommand').value.trim(), recentTitles, requestId: crypto.randomUUID() }),
      });
      if (!response.available) throw new Error(response.message);
      state.blogTitles = response.refined.titles;
      state.blogFittedKind = null;
      renderTitlePicker();
      await retitleTo(state.blogSelectedTitleKind);
    } catch (error) {
      $('titlePickerStatus').textContent = error.message;
    } finally { setAiBusy(false); }
  };
  $('draftTags').addEventListener('input', renderPublishChecklist);
  $('resultFooter').addEventListener('input', renderPublishChecklist);
  $('manualDraft').onclick = () => { $('titlePicker').hidden = true; $('aiResult').hidden = false; $('resultHeading').textContent = state.sourceApp === 'blog' ? '블로그 완성본' : '작성 결과'; $('resultFooter').value = $('defaultFooter').value; };
  $('compareImage').onclick = () => {
    const visible = !$('aiOriginalFigure').hidden;
    $('aiOriginalFigure').hidden = visible; $('compareImage').setAttribute('aria-pressed', String(!visible));
    if (!visible && state.aiSourceId) $('aiOriginal').src = '/api/data-core/files/' + encodeURIComponent(state.aiSourceId);
  };
  $('downloadImage').onclick = downloadImage;
  const clearPrivateImages = () => {
    window.DataCoreImageGallery.close('content-photos');
    state.aiController?.abort(); state.knownFiles.clear();
    document.querySelectorAll('.content-workspace img').forEach(img => img.removeAttribute('src'));
  };
  window.addEventListener('pagehide', clearPrivateImages);
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  document.addEventListener('click', event => { if (event.target.closest('#logoutBtn')) clearPrivateImages(); }, true);
  $('clearFilesBtn').addEventListener('click', () => { if (!state.busy) renderSelectedFiles(); });
}

function normalizedHashtags(...values) {
  return normalizeTags(...values);
}

async function loadDefaults() {
  void textPresets?.load();
  const token = ++state.defaultsGeneration;
  const edit=defaultsEdited;
  const blogToken=blogWorkflow?.defaultsToken();
  $('defaultHashtags').value = ''; $('defaultFooter').value = '';
  savedDefaultsSnapshot=defaultsSnapshot();
  $('defaultsStatus').textContent = '';
  try {
    const params = new URLSearchParams({ sourceApp: state.sourceApp, campusId: $('draftCampus').value });
    const result = await api('/api/data-core/content/defaults?' + params);
    if (token !== state.defaultsGeneration || edit!==defaultsEdited) return;
    $('defaultHashtags').value = result.defaults.hashtags; $('defaultFooter').value = result.defaults.footer;
    savedDefaultsSnapshot=defaultsSnapshot();
    blogWorkflow?.applyDefaults(result.defaults.blogSettings,blogToken);
    lastInstagramSettings=result.defaults.instagramSettings;
    instagramProduction?.applyDefaults(lastInstagramSettings);
  } catch (error) { if (token === state.defaultsGeneration) $('defaultsStatus').textContent = error.message; }
}

async function saveDefaults() {
  $('saveDefaults').disabled = true;
  const token = state.defaultsGeneration;
  const submitted=defaultsSnapshot();
  try {
    await api('/api/data-core/content/defaults', { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceApp: state.sourceApp, campusId: $('draftCampus').value || null, hashtags: $('defaultHashtags').value, footer: $('defaultFooter').value }) });
    if (token === state.defaultsGeneration){$('defaultsStatus').textContent = '기본 문구가 저장되었습니다.';savedDefaultsSnapshot=submitted;}
  } catch (error) { if (token === state.defaultsGeneration) $('defaultsStatus').textContent = error.message; }
  finally { $('saveDefaults').disabled = !canWrite(); }
}

async function loadAiStatus() {
  if(!state.context?.canWrite)return;
  if(!aiUsagePanel)aiUsagePanel=mountAiUsage({api,element:$('aiDiagnostics')});else void aiUsagePanel.refresh();
}

function setAiBusy(busy) {
  state.busy = busy;
  $('manualWork').inert = busy;
  for (const id of ['generateAi','regenerateAi','regenerateTitles','draftCampus','saveDraftBtn','newDraftBtn','deleteDraftBtn','manualDraft','clearFilesBtn','makeInstagramImage','saveDerivative']) $(id).disabled = busy || !canWrite();
  $('cancelAi').hidden = !busy;
  $('aiStatus').classList.toggle('busy', busy);
  if (!busy) derivativeEditor?.update(selectedFiles(), state.sourceApp === 'instagram');
}

// Resizes/compresses one selected photo for the AI request in the browser; the R2 original itself
// is never touched. Tries the ladder in order and keeps the smallest attempt as a fallback so a
// stubborn photo still lands under the hard cap instead of failing outright.
async function optimizeImageForAi(file) {
  const name = file.fileName || '사진';
  const url = file.previewUrl || '/api/data-core/files/' + encodeURIComponent(file.id);
  let sourceBlob;
  try {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error();
    sourceBlob = await response.blob();
  } catch { throw new Error(`${name} 사진을 불러오지 못했습니다.`); }
  let bitmap;
  try { bitmap = await createImageBitmap(sourceBlob); }
  catch { throw new Error(`${name} 사진을 AI 분석용으로 준비하지 못했습니다.`); }
  try {
    let best = null;
    for (const step of AI_OPTIMIZE_STEPS) {
      const scale = Math.min(1, step.edge / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, width, height);
      best = await canvas.convertToBlob({ type: 'image/jpeg', quality: step.quality });
      if (best.size <= AI_OPTIMIZE_TARGET_BYTES) break;
    }
    if (!best || !best.size || best.size > AI_OPTIMIZE_HARD_CAP_BYTES) throw new Error(`${name} 사진을 AI 분석용으로 준비하지 못했습니다.`);
    return best;
  } finally {
    bitmap.close();
  }
}

// One photo at a time: decode, resize/compress, release, next. Never decodes more than one
// original into memory at once (protects low-memory tablets from a 10-photo decode spike).
async function prepareBlogPhotos(files, signal) {
  const photos = new Map();
  for (let i = 0; i < files.length; i++) {
    if (signal.aborted) throw new DOMException('중단되었습니다.', 'AbortError');
    $('aiStatus').textContent = `사진을 AI 분석에 맞게 준비하고 있습니다… ${i + 1}/${files.length}`;
    photos.set(String(files[i].id), await optimizeImageForAi(files[i]));
  }
  return photos;
}

// Recent blog draft titles for the current campus scope — used both to steer the AI away from
// near-duplicate titles (sent as recentTitles) and for the client-side warning banner. Cheap D1
// read, not an AI call, so it is safe to re-fetch per action (generate / 다른 제목 만들기).
async function recentBlogTitles() {
  if (state.sourceApp !== 'blog') return [];
  try {
    const params = new URLSearchParams({ sourceApp: 'blog', limit: '20' });
    if ($('draftCampus').value) params.set('campusId', $('draftCampus').value);
    const response = await api(`/api/data-core/content?${params}`);
    const titles = (response.drafts || []).map((draft) => draft.title).filter(Boolean);
    state.blogRecentTitlesCache = titles;
    return titles;
  } catch { state.blogRecentTitlesCache=[];state.blogWarnings=['최근 제목 비교 미실행: 목록을 불러오지 못했습니다.'];return []; }
}

function normalizedTitleWords(title) {
  return new Set(String(title || '').replace(/[^가-힣a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter((word) => word.length > 1));
}

// Non-blocking near-duplicate check (word-overlap ratio) — never prevents generation, only warns.
function titlesSimilar(a, b) {
  const wa = normalizedTitleWords(a), wb = normalizedTitleWords(b);
  if (!wa.size || !wb.size) return false;
  let overlap = 0;
  for (const word of wa) if (wb.has(word)) overlap++;
  return overlap / Math.min(wa.size, wb.size) >= 0.6;
}

function renderDuplicateWarning() {
  const el = $('titleDuplicateWarning');
  const candidate = state.blogTitles?.[state.blogSelectedTitleKind];
  const match = candidate && state.blogRecentTitlesCache.find((title) => title !== candidate && titlesSimilar(title, candidate));
  if (match) { el.textContent = `⚠ 최근 비슷한 글이 있습니다: ${match}`; el.hidden = false; }
  else el.hidden = true;
}

function renderNextTopics() {
  const has = state.sourceApp === 'blog' && state.blogNextTopics.length > 0;
  $('nextTopics').hidden = !has;
  if (!has) return;
  $('nextTopicsList').innerHTML = state.blogNextTopics.map((topic, index) => `<li><button type="button" data-next-topic="${index}">${h(topic)}</button></li>`).join('');
  $('nextTopicsList').querySelectorAll('[data-next-topic]').forEach((button) => {
    button.onclick = () => {
      const next=state.blogNextTopics[Number(button.dataset.nextTopic)];
      if(blogWorkflow?.hasUnsaved()&&!confirm('현재 미저장 변경사항을 닫고 다음 글을 시작할까요?'))return;
      resetDraftForm();$('aiCommand').value = next;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      toast('다음 글 주제를 명령창에 채웠습니다. 사진을 새로 선택하고 다시 작성해보세요.');
    };
  });
}

// Client-computed "발행 전 확인" checklist — no server round-trip, recomputed from the current form.
function renderPublishChecklist() {
  $('publishChecklist').hidden=true;
  blogWorkflow?.review();
}

async function copyPublishPackage() {
  return blogWorkflow?.downloadPackage();
}

// Applies a title candidate (whose lead/body already fits it — either the initial generation's
// selectedTitleKind, or the result of a completed retitleTo() call) to the visible draft form.
function applyBlogTitleAndBody(kind) {
  state.pendingBlogGeneration=false;
  state.blogSelectedTitleKind = kind;
  $('draftTitle').value = state.blogTitles[kind];
  $('draftContent').value = [state.currentLead, state.currentBody].filter(Boolean).join('\n\n');
  $('draftTags').value = normalizedHashtags($('defaultHashtags').value, state.lastHashtags).map((tag) => '#' + tag).join(' ');
  $('resultFooter').value = $('defaultFooter').value || state.lastCta || '';
  $('resultContact').value = textPresets?.contact() || '';
  $('titlePicker').hidden = true;
  $('aiResult').hidden = false;
  $('resultHeading').textContent = '블로그 완성본';
  renderSelectedFiles();
  renderNextTopics();
  renderPublishChecklist();
  renderDuplicateWarning();
}

// Switches to a different title candidate. If its lead/body was already fitted (blogFittedKind),
// applies it directly; otherwise asks the AI for a *minimal* rewrite of lead/body only — no photos,
// no full regeneration (see AGENTS.md-style cost-control rule in the spec: never re-send images just
// because the user picked a different title).
async function retitleTo(kind) {
  if(blogWorkflow&&!state.pendingBlogGeneration&&$('draftContent').value.trim()){
    state.blogSelectedTitleKind=kind;$('draftTitle').value=state.blogTitles[kind];$('titlePicker').hidden=true;$('aiResult').hidden=false;blogWorkflow.review();return;
  }
  if (kind === state.blogFittedKind) { applyBlogTitleAndBody(kind);blogWorkflow?.assemble(false);return; }
  $('titlePickerStatus').textContent = '선택한 제목에 맞게 본문을 조정하고 있습니다…';
  const response = await api('/api/data-core/content/refine', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'retitle', campusId: $('draftCampus').value || null, strategy: state.blogStrategy,
      selectedTitle: state.blogTitles[kind], priorLead: state.currentLead, priorBody: state.currentBody,
      notes: $('aiCommand').value.trim(), requestId: crypto.randomUUID(),
    }),
  });
  if (!response.available) throw new Error(response.message);
  state.currentLead = response.refined.lead; state.currentBody = response.refined.body;
  state.blogFittedKind = kind;
  applyBlogTitleAndBody(kind);
  blogWorkflow?.assemble(false);
  $('titlePickerStatus').textContent = '';
}

function renderTitlePicker() {
  const kinds = [['search', '검색형'], ['homefeed', '홈피드형'], ['balanced', '균형형']];
  $('titleOptions').innerHTML = kinds.map(([kind, label]) => `
    <label class="title-option">
      <input type="radio" name="titleKind" value="${h(kind)}" ${state.blogSelectedTitleKind === kind ? 'checked' : ''}>
      <span class="title-option-label">${label}</span>
      <span class="title-option-text">${h(state.blogTitles[kind] || '')}</span>
    </label>`).join('');
  // 'click' (not 'change') so re-clicking the already-recommended, pre-checked option still
  // proceeds — a radio's 'change' event never fires when its checked state doesn't actually flip.
  $('titleOptions').querySelectorAll('input[name="titleKind"]').forEach((input) => {
    input.onclick = async () => {
      if (state.busy) return;
      setAiBusy(true);
      try { await retitleTo(input.value); }
      catch (error) { $('titlePickerStatus').textContent = error.message; }
      finally { setAiBusy(false); }
    };
  });
  $('aiResult').hidden = true;
  $('titlePicker').hidden = false;
  $('titlePickerStatus').textContent = '';
  renderDuplicateWarning();
}

async function runAi(captionOnly = false, quick = false) {
  if (state.busy || !canWrite()) return;
  if(state.sourceApp==='blog'&&$('draftContent').value.trim()&&!confirm('본문 전체를 새로 작성할까요? 기존 본문을 교체합니다.'))return;
  const generationStarted=performance.now();
  const priorDraft=draftSnapshot();
  const ids = [...state.selectedFileIds], direction = $('aiCommand').value.trim();
  const instagram = state.sourceApp === 'instagram';
  const material = instagramProduction?.read();
  if (instagram && (material?.usePermission !== 'allowed' || !material.externalAiConsent || (captionOnly ? !['real-photo','ai-support'].includes(material.materialKind) : material.materialKind !== 'ai-support'))) return toast('학생 작품은 로고 합성으로 제작하세요. AI는 자료 유형·홍보 권한·별도 AI 처리 동의를 확인한 경우에만 사용합니다.', 'error');
  if (!ids.length || (instagram && ids.length !== 1)) return toast('사용할 사진을 선택하세요.', 'error');
  if (!direction) return toast('원하는 내용을 입력해주세요.', 'error');
  const campusId = $('draftCampus').value || null, sourceApp = state.sourceApp;
  state.aiController = new AbortController();
  state.browseGeneration++;
  // Blog gets extra headroom over the old single-photo budget: up to 10 photos are resized/
  // compressed in the browser before the request is even sent.
  const signal = state.aiController.signal, timer = setTimeout(() => state.aiController?.abort(), instagram ? 290000 : 150000);
  setAiBusy(true);
  $('retryCaption').hidden = true;
  $('aiStatus').textContent = captionOnly ? '홍보 문구를 작성하고 있습니다…' : instagram ? '사진을 분석하고 홍보 이미지를 편집하고 있습니다…' : '사진을 AI 분석에 맞게 준비하고 있습니다…';
  let imageSaved = false;
  const post = (path, body) => api('/api/data-core/content/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, signal, body: JSON.stringify({ ...body, sourceApp, campusId, requestId: crypto.randomUUID() }) });
  try {
    if (instagram && !captionOnly) {
      const result = await post('image-edit', { sourceFileId: ids[0], direction, material });
      state.aiFile = result.file; state.aiSourceId = ids[0]; state.selectedDerivedFileIds = [result.file.id];
      state.knownFiles.set(result.file.id, result.file); imageSaved = true;
      $('aiImageResult').hidden = false; $('aiResult').hidden = false;
      $('resultHeading').textContent = '인스타 결과';
      $('aiOutput').src = result.file.downloadUrl;
      $('aiOriginalFigure').hidden = true; $('compareImage').setAttribute('aria-pressed','false');
      $('aiImageSaved').textContent = '저장 완료 · 2160 × 2700px · 4:5';
      $('draftTitle').value = '인스타 홍보 이미지';
      $('draftContent').value = ''; $('draftTags').value = $('defaultHashtags').value;
      $('resultFooter').value = $('defaultFooter').value;
      renderSelectedFiles();
      $('aiStatus').textContent = '이미지가 저장되었습니다. 홍보 문구를 작성하고 있습니다…';
    }
    let result;
    if (instagram) {
      result = await post('generate', { selectedFileIds: ids, notes: direction, material });
    } else {
      const aiIds=blogWorkflow?await blogWorkflow.aiPhotos(signal):ids;
      const photoFiles = aiIds.map((id) => state.knownFiles.get(String(id))).filter(Boolean);
      if (photoFiles.length !== aiIds.length) throw new Error('선택한 사진 정보를 확인할 수 없습니다. 사진을 다시 선택해주세요.');
      const photos = await prepareBlogPhotos(photoFiles, signal);
      const recentTitles = await recentBlogTitles();
      $('aiStatus').textContent = '사진을 살펴보고 글을 작성하고 있습니다…';
      const form = new FormData();
      form.set('input', JSON.stringify({ selectedFileIds: ids, notes: direction, sourceApp, campusId, strategyMode: $('strategyMode').value, recentTitles, photoInstructions:blogWorkflow?.instructions(),requestId: crypto.randomUUID() }));
      for (const [id, blob] of photos) form.set(`photo:${id}`, blob, `${id}.jpg`);
      result = await api('/api/data-core/content/generate', { method: 'POST', signal, body: form });
    }
    const generated = result.generated;
    if(!instagram&&priorDraft!==draftSnapshot())throw Error('작성 대기 중 본문이 수정되었습니다. 현재 내용을 보존했으므로 필요할 때 다시 생성해주세요.');
    if (instagram) {
      $('draftTitle').value = generated.title;
      $('draftContent').value = generated.body || generated.content;
      $('draftTags').value = normalizedHashtags($('defaultHashtags').value, generated.hashtags || generated.keywords).map(tag => '#' + tag).join(' ');
      $('resultFooter').value = $('defaultFooter').value || generated.cta || generated.callToAction || '';
      $('aiResult').hidden = false;
      $('resultHeading').textContent = '인스타 결과';
      $('aiStatus').textContent = '작성이 완료되었습니다.';
    } else {
      // Blog: strategy + 3 title candidates + a body already fitted to generated.selectedTitleKind.
      // "바로 글 만들기" applies it immediately; the default flow shows the title picker first.
      state.blogStrategy = generated.strategy; state.blogTitles = generated.titles;
      state.pendingBlogGeneration=true;
      state.blogSelectedTitleKind = generated.selectedTitleKind; state.blogFittedKind = generated.selectedTitleKind;
      state.currentLead = generated.lead; state.currentBody = generated.body;
      state.lastHashtags = generated.hashtags || []; state.lastCta = generated.cta || '';
      state.blogNextTopics = generated.nextTopics || []; state.blogWarnings = generated.warnings || [];
      if (quick) {
        applyBlogTitleAndBody(state.blogSelectedTitleKind);
        blogWorkflow?.assemble(false);
        $('aiStatus').textContent = state.blogWarnings.length ? `작성이 완료되었습니다. ${state.blogWarnings[0]}` : '작성이 완료되었습니다.';
      } else {
        renderTitlePicker();
        $('aiStatus').textContent = '제목 3개 중 하나를 선택해주세요.';
      }
    }
  } catch (error) {
    const message = error.name === 'AbortError' ? '대기를 중단했습니다. 이미 전송된 AI 작업은 과금되거나 저장될 수 있습니다.' : error.message;
    $('aiStatus').textContent = imageSaved ? '이미지는 저장되었습니다. 홍보 문구는 작성하지 못했습니다. 직접 작성하거나 다시 시도해주세요.' : message;
    $('retryCaption').hidden = !(imageSaved || captionOnly);
  } finally { blogWorkflow?.recordTime('generationTotalMs',generationStarted);clearTimeout(timer); setAiBusy(false); state.aiController = null; }
}

async function copyContent() {
  if(state.sourceApp==='blog'&&blogWorkflow)return blogWorkflow.copy();
  try{captionTail($('resultFooter').value,$('draftTags').value,[],$('resultContact').value);}catch(error){return toast(error.message,'error');}
  if(normalizedHashtags($('draftTags').value).length>30)return toast('현재 저장 계약은 태그 30개까지입니다. 직접 정리해주세요.','error');
  const text = [state.sourceApp === 'blog' ? $('draftTitle').value : '', $('draftContent').value, $('resultFooter').value, $('resultContact').value, normalizedHashtags($('draftTags').value).map(t=>'#'+t).join(' ')].filter(Boolean).join('\n\n');
  try { await navigator.clipboard.writeText(text); toast('복사했습니다.'); }
  catch { toast('클립보드 권한을 확인해주세요.', 'error'); }
}

async function downloadImage() {
  if (!state.aiFile) return;
  $('downloadImage').disabled = true;
  let objectUrl;
  try {
    const response = await fetch('/api/data-core/files/' + encodeURIComponent(state.aiFile.id), { credentials: 'same-origin' });
    if (!response.ok) throw new Error('이미지를 다운로드할 수 없습니다.');
    objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = objectUrl; link.download = 'instagram-4x5.png';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
  } catch (error) { if (objectUrl) URL.revokeObjectURL(objectUrl); toast(error.message, 'error'); }
  finally { $('downloadImage').disabled = false; }
}

async function init() {
  derivativeEditor = window.HI5InstagramDerivative.mount({
    canWrite,
    onError: (message) => toast(message, 'error'),
    onSaved: (file) => {
      state.knownFiles.set(String(file.id), file);
      state.files.unshift(file);
      state.selectedDerivedFileIds.push(String(file.id));
      $('aiResult').hidden = false;
      $('resultHeading').textContent = '작성 결과';
      renderSelectedFiles(); renderFilePicker();
    },
  });
  bindEvents();
  setSourceApp(state.sourceApp);
  await loadHealthAndContext();
  renderCampusSelectors();
  blogWorkflow=mountBlogWorkflow({state,$,toast,renderSelection:()=>{renderSelectedFiles();renderFilePicker();},contact:()=>textPresets?.contact()||''});
  textPresets=mountTextPresets({api,state,$,applyResult:({footer,hashtags,contact})=>{
    if(state.sourceApp==='instagram'){if(!instagramProduction)throw Error('이미지 세트를 먼저 불러오세요.');instagramProduction.applyText({footer,hashtags,contact});return;}
    if($('aiResult').hidden)throw Error('작성 결과를 먼저 열어주세요.');
    $('resultFooter').value=footer;$('draftTags').value=normalizedHashtags(hashtags).map(t=>'#'+t).join(' ');$('resultContact').value=contact;renderPublishChecklist();
  }});
  renderSelectedFiles();
  if (state.context?.authenticated) {
    state.folderId = $('draftCampus').value ? 'campus:' + $('draftCampus').value : 'root';
    void loadDefaults();void loadAiStatus();
    const listing=loadFiles();
    if(state.sourceApp==='instagram'){
      const {mountInstagramProduction}=await import('/data-core/instagram-carousel.js?v=20260923-brandfix2');
      instagramProduction=mountInstagramProduction({state,api,$,toast,canWrite,contact:()=>textPresets.contact()});
      instagramProduction.applyDefaults(lastInstagramSettings);
      instagramProduction.refresh();
    }
    await listing;
  }
}

init().catch((error) => {
  showNotice(error.status === 401 ? '로그인이 필요합니다.' : '자동화 작업실을 시작하지 못했습니다. 새로고침해주세요.');
});
window.addEventListener('pagehide',clearPrivateState);
window.addEventListener('beforeunload',event=>{
  const dirty=state.busy||blogWorkflow?.hasUnsaved()||(state.sourceApp==='instagram'?instagramProduction?.hasUnsaved():$('aiResult').hidden?Boolean($('aiCommand').value.trim()):draftSnapshot()!==savedDraftSnapshot)
    ||Boolean(savedDefaultsSnapshot&&defaultsSnapshot()!==savedDefaultsSnapshot);
  if(dirty){event.preventDefault();event.returnValue='';}
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!state.busy){void loadHealthAndContext().then(()=>{renderedFolder='';void loadFiles();}).catch(clearPrivateState);}});
