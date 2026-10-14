let admissionBenchmarkModel = null;
let simpleAverageModel = null;
let state = { data: null, selectedUniversityId: 1, lastAnalysis: null, studentSearch: '', studentGradeInputTab: 'simple', studentYearFilter: '', studentRoundFilter: '', studentTypeTab: 'g1', studentEditor: null, studentDetailId: null, studentResultExpandedId: null, studentGalleryId: null, studentGradeId: null, caseSearch: '', caseReserveFilter: '', caseDetail: null, conversionDetailId: null, adminShowArchived: false, adminMode: 'edit', adminEditing: false, adminSearch: '', adminTrackSearch: '', pdfAnalysis: null, adminDraft: null, artworkViewer: null, awardFolderId: null, awardYear: '2024', awardViewer: null, strategyInput: { gpa: 3.2, skillLevel: '중', track: '웹툰', studentId: '', search: '' } };
let dashboardAnalyzeTimer = null;
let casePages = { pass: 1, fail: 1 };
let admissionsDataRevision = 0;
let closeArtworkViewer = null;
let universityIdCache = null;
let universityNameIndexCache = null;
const admissionRowsCache = new Map();
const resolveUniversityCache = new Map();
let caseRowsCache = null;
let pageRenderToken = 0;
const $ = (id) => document.getElementById(id);
function clearComputedCaches(){
  universityIdCache = null;
  universityNameIndexCache = null;
  admissionRowsCache.clear();
  resolveUniversityCache.clear();
  caseRowsCache = null;
}
function setStateData(data){
  closeArtworkViewer?.();
  verifiedGradeDraft = null;
  gradeMountToken += 1;
  admissionsDataRevision += 1;
  state.data = data || { students: [], universities: [], awardFolders: [] };
  if(!Array.isArray(state.data.awardFolders)) state.data.awardFolders = [];
  clearComputedCaches();
}
function universityIdMap(){
  if(!universityIdCache){
    universityIdCache = new Map((state.data?.universities || []).map(university => [Number(university.id), university]));
  }
  return universityIdCache;
}
function addUniversityNameIndexValue(index, key, university){
  if(!key) return;
  if(!index.has(key)) index.set(key, []);
  index.get(key).push(university);
}
function universityNameIndex(){
  if(!universityNameIndexCache){
    universityNameIndexCache = new Map();
    (state.data?.universities || []).forEach(university => {
      const name = compactUniversityText(university.name);
      const baseName = baseUniversityText(university.name);
      addUniversityNameIndexValue(universityNameIndexCache, name, university);
      addUniversityNameIndexValue(universityNameIndexCache, baseName, university);
      addUniversityNameIndexValue(universityNameIndexCache, name.replace(/대$/, ''), university);
    });
  }
  return universityNameIndexCache;
}
function admissionCandidateUniversities(nameCandidates){
  const index = universityNameIndex();
  const byId = new Map();
  nameCandidates.forEach(candidate => {
    const name = compactUniversityText(candidate);
    const baseName = baseUniversityText(candidate);
    [name, baseName, name.replace(/대$/, '')].forEach(key => {
      (index.get(key) || []).forEach(university => byId.set(university.id, university));
    });
  });
  return Array.from(byId.values());
}
function studentAdmissionCacheKey(student){
  if(!student?.id) return '';
  const results = Array.isArray(student.admissionResults) ? student.admissionResults : [];
  return [
    student.id,
    student.updatedAt || '',
    results.length,
    student.admissionUniversity || '',
    student.admissionResult || '',
    student.practiceExperience || '',
    student.skillLevel || ''
  ].join('|');
}
function h(value){ return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function imgSrc(value){
  if(!value) return '';
  const source = String(value);
  if(/^(data:|blob:|https?:\/\/|\/)/i.test(source)) return source;
  if(/^file:\/\//i.test(source)) return source;
  return 'file:///' + source.replace(/\\/g,'/').replace(/^\/+/,'');
}
// 실기능력은 A+ · A0 · A- · B+ · B0 · B- · C 일곱 단계 (실기 점수는 쓰지 않는다). 예전 상·중·하 값도 그대로 읽는다.
const SKILL_LEVELS = ['A+','A0','A-','B+','B0','B-','C'];
const SKILL_LEVEL_SCORES = { 'A+':96, 'A0':91, 'A-':87, 'B+':83, 'B0':79, 'B-':75, 'C':68, '상':90, '중':80, '하':68 };
function skillLevelFromScore(score){ const n = Number(score); return n>=95?'A+':n>=90?'A0':n>=86?'A-':n>=82?'B+':n>=78?'B0':n>=74?'B-':'C'; }
function skillScoreFromLevel(skillLevel){ return SKILL_LEVEL_SCORES[skillLevel] ?? 80; }
function skillLevelOptionsMarkup(current=''){
  const list = current && !SKILL_LEVELS.includes(current) ? [...SKILL_LEVELS, current] : SKILL_LEVELS;
  return `<option value="" ${!current?'selected':''}>선택</option>` + list.map(v => `<option value="${h(v)}" ${v===current?'selected':''}>${h(v)}</option>`).join('');
}
function subjectScoresForCase(caseItem, result){
  if(caseItem && caseItem.subjectScores) return caseItem.subjectScores;
  const base = result === '합격'
    ? { korean: 2.1, english: 1.8, math: 2.0, social: 2.0, science: 2.2 }
    : { korean: 2.7, english: 2.3, math: 2.6, social: 2.6, science: 2.8 };
  if(caseItem && Number(caseItem.gpa)){
    const gpa = Number(caseItem.gpa);
    return {
      korean: Math.max(1, +(gpa - 0.1).toFixed(1)),
      english: Math.max(1, +(gpa - 0.3).toFixed(1)),
      math: +(gpa + 0.1).toFixed(1),
      social: +(gpa + 0.0).toFixed(1),
      science: +(gpa + 0.2).toFixed(1)
    };
  }
  return base;
}
function subjectScoreGrid(caseItem, result){
  const scores = subjectScoresForCase(caseItem, result);
  return `<div class="subject-score-grid">
    <div><span>국어</span><b>${h(scores.korean)}</b></div>
    <div><span>영어</span><b>${h(scores.english)}</b></div>
    <div><span>수학</span><b>${h(scores.math)}</b></div>
    <div><span>사탐</span><b>${h(scores.social)}</b></div>
    <div><span>과탐</span><b>${h(scores.science)}</b></div>
  </div>`;
}
function termSubjectScoresForCase(caseItem){
  if(caseItem?.termGrades){
    const rows = termRows().map(row => ({
      gradeYear: row.gradeLabel,
      semester: row.semesterLabel,
      korean: termScoreValue(caseItem, row, 'korean'),
      english: termScoreValue(caseItem, row, 'english'),
      math: termScoreValue(caseItem, row, 'math'),
      social: termScoreValue(caseItem, row, 'social'),
      science: termScoreValue(caseItem, row, 'science')
    }));
    if(rows.some(row => subjectFields.some(subject => row[subject.key] !== ''))) return rows;
  }
  const base = subjectScoresForCase(caseItem, caseItem?.result || '합격');
  const rows = [
    ['1학년', '1학기', 0.3],
    ['1학년', '2학기', 0.2],
    ['2학년', '1학기', 0.1],
    ['2학년', '2학기', 0],
    ['3학년', '1학기', -0.1]
  ];
  return rows.map(([gradeYear, semester, delta]) => ({
    gradeYear,
    semester,
    korean: Math.max(1, +(Number(base.korean) + delta).toFixed(1)),
    english: Math.max(1, +(Number(base.english) + delta).toFixed(1)),
    math: Math.max(1, +(Number(base.math) + delta).toFixed(1)),
    social: Math.max(1, +(Number(base.social) + delta).toFixed(1)),
    science: Math.max(1, +(Number(base.science) + delta).toFixed(1))
  }));
}
function caseGradeTable(caseItem){
  const rows = termSubjectScoresForCase(caseItem);
  const rowAvg = (row) => {
    const values = scoreNumbers([row.korean, row.english, row.math, row.social, row.science]);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const allScores = scoreNumbers(rows.flatMap(row => [row.korean, row.english, row.math, row.social, row.science]));
  const termAverages = scoreNumbers(rows.map(rowAvg));
  const overallAverage = allScores.length ? allScores.reduce((sum, value) => sum + value, 0) / allScores.length : null;
  const bestScore = termAverages.length ? Math.min(...termAverages) : null;
  return `<div class="case-detail-panel"><h3>학년·학기별 성적</h3>${gradeSummaryValuesMarkup(overallAverage,bestScore)}<table class="grade-term-table"><thead><tr><th>학년</th><th>학기</th><th>국어</th><th>영어</th><th>수학</th><th>사탐</th><th>과탐</th><th>학기 평균</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${h(row.gradeYear)}</td><td>${h(row.semester)}</td><td>${h(row.korean || '-')}</td><td>${h(row.english || '-')}</td><td>${h(row.math || '-')}</td><td>${h(row.social || '-')}</td><td>${h(row.science || '-')}</td><td><b>${formatGrade(rowAvg(row))}</b></td></tr>`).join('')}</tbody></table></div>`;
}
function caseArtworkPanel(caseItem){
  const artworks = studentArtworks(caseItem, false);
  const imagePath = caseItem?.artworkImage || caseItem?.artwork || caseItem?.image;
  if(artworks.length) return `<div class="case-detail-panel"><h3>그림 확인</h3><div class="student-gallery">${artworkGalleryMarkup(artworks)}</div></div>`;
  return `<div class="case-detail-panel"><h3>그림 확인</h3>${imagePath?`<button class="case-artwork-open" type="button" data-open-artwork="${h(imagePath)}" data-open-artwork-name="사례 그림"><img class="case-artwork-large" src="${h(imgSrc(imagePath))}" alt="사례 그림"></button>`:`<div class="case-artwork-empty"><b>등록된 그림 이미지가 없습니다.</b><span>추후 사례 데이터에 그림 파일을 연결하면 이곳에 표시됩니다.</span></div>`}</div>`;
}
function subjectInputsFromDashboard(){
  return {
    korean: parseFloat($('koreanScore')?.value || '0'),
    english: parseFloat($('englishScore')?.value || '0'),
    math: parseFloat($('mathScore')?.value || '0'),
    social: parseFloat($('socialScore')?.value || '0'),
    science: parseFloat($('scienceScore')?.value || '0')
  };
}
function dashboardSubjectAverage(){
  const values = scoreNumbers(Object.values(subjectInputsFromDashboard()));
  if(!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function syncDashboardGpaFromSubjects(){
  const average = dashboardSubjectAverage();
  if(Number.isFinite(average) && $('gpa')) $('gpa').value = formatGrade(average);
}
function bindDashboardSubjectAverage(){
  subjectFields.forEach(subject => {
    const input = $(`${subject.key}Score`);
    if(input) input.addEventListener('input', () => {
      syncDashboardGpaFromSubjects();
      scheduleDashboardAnalyze();
    });
  });
  ['gpa','skill'].forEach(id => {
    const input = $(id);
    if(input) input.addEventListener('input', scheduleDashboardAnalyze);
  });
  syncDashboardGpaFromSubjects();
}
function scheduleDashboardAnalyze(){
  clearTimeout(dashboardAnalyzeTimer);
  dashboardAnalyzeTimer = setTimeout(() => {
    if(activePageId() === 'dashboard') $('dashboard').querySelector('[data-calculate]')?.click();
  }, 500);
}
const subjectFields = [
  { key: 'korean', label: '국어' },
  { key: 'english', label: '영어' },
  { key: 'math', label: '수학' },
  { key: 'social', label: '사탐' },
  { key: 'science', label: '과탐' }
];
function termRows(){
  return [
    { gradeKey: 'grade1', gradeLabel: '1학년', semesterKey: 'semester1', semesterLabel: '1학기' },
    { gradeKey: 'grade1', gradeLabel: '1학년', semesterKey: 'semester2', semesterLabel: '2학기' },
    { gradeKey: 'grade2', gradeLabel: '2학년', semesterKey: 'semester1', semesterLabel: '1학기' },
    { gradeKey: 'grade2', gradeLabel: '2학년', semesterKey: 'semester2', semesterLabel: '2학기' },
    { gradeKey: 'grade3', gradeLabel: '3학년', semesterKey: 'semester1', semesterLabel: '1학기' },
    { gradeKey: 'grade3', gradeLabel: '3학년', semesterKey: 'semester2', semesterLabel: '2학기' }
  ];
}
function studentArtworks(student, resolveStudent = true){
  const source = Array.isArray(student?.artworks) ? student.artworks : [];
  const normalized = source
    .map((item,index) => ({...(typeof item === 'string' ? {path:item} : item), _slot:String(index)}))
    .filter(item => item && (item.path||item.filePath||item.imageUrl||item.url||item.downloadUrl||item.dataCoreFileId));
  for(const field of ['artworkImage','artwork','image'])if(typeof student?.[field]==='string'&&student[field].trim()&&!normalized.some(item=>[item.path,item.filePath,item.imageUrl,item.url,item.downloadUrl].includes(student[field]))){
    normalized.unshift({path:student[field],name:'대표 그림',_slot:field});
  }
  return normalized.map(item=>{
    const path=item.path||item.filePath||item.imageUrl||item.url||item.downloadUrl||'';
    const url=item.dataCoreFileId?`/api/data-core/files/${encodeURIComponent(item.dataCoreFileId)}`
      : /^(https?:\/\/|data:image\/|blob:|\/api\/data-core\/files\/)/i.test(path)?path
      : location.protocol==='file:'||!resolveStudent?imgSrc(path)
      : student.id!==undefined?`/api/admissions/students/${encodeURIComponent(student.id)}/artworks/${item._slot}`:'';
    const result={...item,path};delete result._slot;
    Object.defineProperty(result,'displayUrl',{value:url,enumerable:false});
    const thumbnailUrl=location.protocol==='file:'?url:item.dataCoreFileId?`/api/admissions/files/${encodeURIComponent(item.dataCoreFileId)}/thumbnail`
      :/^\/api\/admissions\/students\//.test(url)?`${url}/thumbnail`:url;
    Object.defineProperty(result,'thumbnailUrl',{value:thumbnailUrl,enumerable:false});
    return result;
  });
}
function studentArtworkImage(url,classes='',alt='학생 그림',priority=false,original=''){
  return url?`<img class="${h(classes)}" src="${h(url)}" alt="${h(alt)}" loading="${priority?'eager':'lazy'}" fetchpriority="${priority?'high':'auto'}" decoding="async" width="160" height="160" data-student-artwork data-original="${h(original)}"><span class="artwork-missing" hidden>그림 없음</span>`:'<span class="artwork-missing">그림 없음</span>';
}
function replaceArtworkContent(host, markup){
  // Keep decoded images only across the current view's redraw, never in persistent storage.
  const existing=new Map();
  host.querySelectorAll('img[data-student-artwork]').forEach(img=>{
    if(!img.complete || !img.naturalWidth || img.dataset.dataRevision!==String(admissionsDataRevision))return;
    const key=img.getAttribute('src');
    if(!existing.has(key))existing.set(key,[]);
    existing.get(key).push(img);
  });
  const template=document.createElement('template');template.innerHTML=markup;
  template.content.querySelectorAll('img[data-student-artwork]').forEach(placeholder=>{
    placeholder.dataset.dataRevision=String(admissionsDataRevision);
    const image=existing.get(placeholder.getAttribute('src'))?.shift();
    if(!image)return;
    for(const attr of ['class','alt','loading','fetchpriority'])image.setAttribute(attr,placeholder.getAttribute(attr));
    placeholder.replaceWith(image);
  });
  host.replaceChildren(template.content);
}
function termScoreValue(student, row, subjectKey){
  return student?.termGrades?.[row.gradeKey]?.[row.semesterKey]?.[subjectKey] ?? '';
}
function scoreNumbers(values){
  return values.map(Number).filter(value => Number.isFinite(value) && value > 0);
}
function formatGrade(value){
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '-';
}
function rowScores(student, row){
  return scoreNumbers(subjectFields.map(subject => termScoreValue(student, row, subject.key)));
}
function rowAverage(student, row){
  const values = rowScores(student, row);
  if(!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function studentGradeStats(student){
  const values = scoreNumbers(termRows().flatMap(row => subjectFields.map(subject => termScoreValue(student, row, subject.key))));
  const termAverages = scoreNumbers(termRows().map(row => rowAverage(student, row)));
  if(!values.length) return { overallAverage: null, bestScore: null };
  return {
    overallAverage: values.reduce((sum, value) => sum + value, 0) / values.length,
    bestScore: termAverages.length ? Math.min(...termAverages) : null
  };
}
function studentOverallGrade(student){
  if(simpleAverageModel && usesSimpleAverage(student)){const average=simpleAverageModel.studentAverage({...student,detailedTranscript:normalizeDetailedTranscript(student)}).value;return Number.isFinite(average)?formatGrade(average):'-';}
  const average = studentGradeStats(student).overallAverage;
  return Number.isFinite(average) ? formatGrade(average) : (student?.gpa || '-');
}
function studentSkillLevel(student){
  if(student?.skillLevel) return student.skillLevel;
  if(student?.skill === undefined || student?.skill === null || String(student.skill).trim() === '') return '-';
  return Number.isFinite(Number(student.skill)) ? skillLevelFromScore(student.skill) : '-';
}
function studentType(student){
  return student?.studentType || student?.type || (normalizeAdmissionResults(student).length ? 'result' : 'current');
}
function isCurrentStudent(student){
  return studentType(student) === 'current';
}
function studentStatusOptions(selected='재원중'){
  return ['재원중', '휴원', '퇴원', '졸업'].map(option=>`<option value="${h(option)}" ${selected===option?'selected':''}>${h(option)}</option>`).join('');
}
function studentGradeLevelOptions(selected='고3'){
  return ['중3', '고1', '고2', '고3', 'N수'].map(option=>`<option value="${h(option)}" ${selected===option?'selected':''}>${h(option)}</option>`).join('');
}
function preparationStageOptions(selected='방향 설정'){
  return ['기초', '방향 설정', '포트폴리오 강화', '실전 준비', '원서 전략'].map(option=>`<option value="${h(option)}" ${selected===option?'selected':''}>${h(option)}</option>`).join('');
}
function studentCurrentManagementPanel(student){
  if(!isCurrentStudent(student)) return '';
  const wishlist = student.targetUniversities || student.wishUniversities || '';
  return `<section class="student-detail-section current-management-panel">
    <div class="student-detail-head"><h3>현재 학생 관리</h3>${canManageStudents() && window.AdmissionsStudentGrades.gradeOf(student).grade === 3 ? `<button class="btn mini primary" type="button" data-convert-student="${h(student.id)}">합격자 데이터로 넘기기</button>` : ''}</div>
    <div class="current-info-grid">
      <div><span>학년</span><b>${h((info => info.grade ? `고${info.grade} · ${window.AdmissionsStudentGrades.gradeLabel(info)}` : (student.gradeLevel || '-'))(window.AdmissionsStudentGrades.gradeOf(student)))}</b></div>
      <div><span>재원 상태</span><b>${h(student.enrollmentStatus || '재원중')}</b></div>
      <div><span>준비 단계</span><b>${h(student.preparationStage || '-')}</b></div>
      <div><span>다음 상담 예정일</span><b>${h(student.nextConsultationDate || '-')}</b></div>
    </div>
    <div class="current-memo-grid">
      <div><span>희망 대학</span><p>${h(wishlist || '-')}</p></div>
      <div><span>상담 메모</span><p>${h(student.consultMemo || student.memo || '-')}</p></div>
    </div>
  </section>`;
}
function caseGradeDisplay(caseItem){
  return studentOverallGrade(caseItem);
}
function caseSkillDisplay(caseItem){
  return studentSkillLevel(caseItem);
}
function gradeSummaryMarkup(student){
  const stats = studentGradeStats(student);
  return gradeSummaryValuesMarkup(stats.overallAverage, stats.bestScore);
}
function gradeSummaryValuesMarkup(overallAverage, bestScore){
  return `<div class="grade-summary">
    <div><span>전체 평균성적</span><b data-grade-overall>${formatGrade(overallAverage)}</b></div>
    <div><span>전체 최고성적</span><b data-grade-best>${formatGrade(bestScore)}</b></div>
  </div>`;
}
function termGradesEditor(student){
  return `<div class="term-score-editor"><h3>학년·학기별 과목 성적</h3>${gradeSummaryMarkup(student)}<table class="grade-term-table"><thead><tr><th>학년</th><th>학기</th>${subjectFields.map(s=>`<th>${s.label}</th>`).join('')}<th>학기 평균</th></tr></thead><tbody>${termRows().map(row=>`<tr data-term-row="${row.gradeKey}_${row.semesterKey}"><td>${row.gradeLabel}</td><td>${row.semesterLabel}</td>${subjectFields.map(subject=>`<td><input id="tg_${row.gradeKey}_${row.semesterKey}_${subject.key}" type="number" step="0.1" value="${h(termScoreValue(student,row,subject.key))}" placeholder="예: 2.2"></td>`).join('')}<td><b data-term-average="${row.gradeKey}_${row.semesterKey}">${formatGrade(rowAverage(student,row))}</b></td></tr>`).join('')}</tbody></table></div>`;
}
function readTermGradesFromEditor(){
  if(!document.querySelector('.term-score-editor')) return state.studentEditor?.student?.termGrades || {};
  const termGrades = {};
  termRows().forEach(row => {
    termGrades[row.gradeKey] = termGrades[row.gradeKey] || {};
    termGrades[row.gradeKey][row.semesterKey] = {};
    subjectFields.forEach(subject => {
      const raw = $(`tg_${row.gradeKey}_${row.semesterKey}_${subject.key}`)?.value ?? '';
      const value = parseFloat(raw);
      termGrades[row.gradeKey][row.semesterKey][subject.key] = Number.isFinite(value) ? value : '';
    });
  });
  return termGrades;
}
function syncStudentEditorDraft(){
  if(!state.studentEditor || !$('editStudentName')) return;
  state.studentEditor.student = {
    ...state.studentEditor.student,
    studentType: $('editStudentType')?.value || state.studentEditor.student.studentType || (state.studentTypeTab === 'result' ? 'result' : 'current'),
    name: $('editStudentName').value,
    division: $('editStudentDivision')?.value || studentDivision(state.studentEditor.student),
    gpa: $('editStudentGpa').value,
    skillLevel: $('editStudentSkillLevel').value,
    track: $('editStudentTrack')?.value ?? state.studentEditor.student.track ?? '',
    practiceExperience: $('editStudentPracticeExperience')?.value || '',
    gradeLevel: $('editStudentGradeLevel')?.value || state.studentEditor.student.gradeLevel || '',
    _gradeYear: $('editStudentGradeYear')?.value || state.studentEditor.student._gradeYear || '',
    entryYear: entryYearFromEditor() ?? state.studentEditor.student.entryYear,
    enrollmentStatus: $('editStudentEnrollmentStatus')?.value || state.studentEditor.student.enrollmentStatus || '',
    preparationStage: $('editStudentPreparationStage')?.value || state.studentEditor.student.preparationStage || '',
    nextConsultationDate: $('editStudentNextConsultationDate')?.value || state.studentEditor.student.nextConsultationDate || '',
    targetUniversities: $('editStudentTargetUniversities')?.value || state.studentEditor.student.targetUniversities || '',
    consultMemo: $('editStudentConsultMemo')?.value || state.studentEditor.student.consultMemo || '',
    admissionResults: readAdmissionResultsFromEditor(),
    termGrades: readTermGradesFromEditor(),
    detailedTranscript: readDetailedTranscriptFromEditor(),
    admissionsProfile: window.BenchmarkStudentUi.readProfile(state.studentEditor.student)
  };
}
const detailedSubjectGroupOptions = [
  { value: 'KOREAN', label: '국어' },
  { value: 'MATH', label: '수학' },
  { value: 'ENGLISH', label: '영어' },
  { value: 'SOCIAL', label: '사회' },
  { value: 'SCIENCE', label: '과학' },
  { value: 'KOREAN_HISTORY', label: '한국사' },
  { value: 'HISTORY', label: '역사' },
  { value: 'ETHICS', label: '도덕' },
  { value: 'TECH_HOME', label: '기술·가정' },
  { value: 'INFORMATION', label: '정보' },
  { value: 'SECOND_LANGUAGE', label: '제2외국어' },
  { value: 'CHINESE_CLASSICS', label: '한문' },
  { value: 'ART', label: '예술' },
  { value: 'PE', label: '체육' },
  { value: 'LIBERAL', label: '교양' },
  { value: 'SPECIALIZED', label: '전문교과' },
  { value: 'ETC', label: '기타' }
];
const detailedSubjectTypeOptions = [
  { value: 'COMMON', label: '공통과목' },
  { value: 'GENERAL', label: '일반선택' },
  { value: 'CAREER', label: '진로선택' },
  { value: 'CONVERGENCE', label: '융합선택' },
  { value: 'SPECIALIZED', label: '전문교과' },
  { value: 'ETC', label: '기타' }
];
const detailedSubjectNameHints = ['국어','문학','독서','화법과 작문','언어와 매체','수학','수학Ⅰ','수학Ⅱ','미적분','확률과 통계','영어','영어Ⅰ','영어Ⅱ','통합사회','사회·문화','생활과 윤리','한국사','통합과학','생명과학','지구과학','미술','드로잉'];
function detailedLabel(options, value){
  const current = String(value || '');
  const found = options.find(option => option.value === current || option.label === current);
  return found ? found.label : current;
}
function detailedOptionMarkup(options, selected, placeholder='선택'){
  const current = String(selected || '');
  return `<option value="">${h(placeholder)}</option>${options.map(option=>`<option value="${h(option.value)}" ${(current===option.value || current===option.label)?'selected':''}>${h(option.label)}</option>`).join('')}`;
}
function normalizeDetailedTranscript(student){
  const rows = Array.isArray(student?.detailedTranscript) ? student.detailedTranscript : [];
  return rows.map((row, index) => ({
    id: row.id || `dt_${Date.now()}_${index}`,
    studentId: row.studentId || student?.id || '',
    schoolYear: row.schoolYear || row.gradeYear || '',
    semester: row.semester || '',
    subjectGroup: row.subjectGroup || '',
    subjectName: row.subjectName || '',
    subjectType: row.subjectType || '',
    grade: row.grade ?? '',
    rawScore: row.rawScore ?? '',
    averageScore: row.averageScore ?? '',
    standardDeviation: row.standardDeviation ?? '',
    achievement: row.achievement || '',
    credits: row.credits ?? '',
    rank: row.rank ?? '',
    studentCount: row.studentCount ?? '',
    percentile: row.percentile ?? '',
    notes: row.notes || ''
  }));
}
function transcriptNumber(value){
  const number = parseFloat(value);
  return Number.isFinite(number) ? number : null;
}
function averageOf(values){
  const numbers = values.map(transcriptNumber).filter(value => value !== null);
  if(!numbers.length) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}
function calculateDetailedTranscriptSummary(studentOrRows){
  const rows = Array.isArray(studentOrRows) ? studentOrRows : normalizeDetailedTranscript(studentOrRows);
  const gradedRows = rows.filter(row => transcriptNumber(row.grade) !== null);
  const overallAverage = averageOf(gradedRows.map(row => row.grade));
  const weightedRows = gradedRows.map(row => ({ grade: transcriptNumber(row.grade), credits: transcriptNumber(row.credits) })).filter(row => row.grade !== null && row.credits !== null && row.credits > 0);
  const creditTotal = weightedRows.reduce((sum, row) => sum + row.credits, 0);
  const weightedAverage = creditTotal ? weightedRows.reduce((sum, row) => sum + row.grade * row.credits, 0) / creditTotal : null;
  const bestScore = gradedRows.length ? Math.min(...gradedRows.map(row => transcriptNumber(row.grade))) : null;
  const byTerm = {};
  const bySubjectGroup = {};
  gradedRows.forEach(row => {
    const termKey = `${row.schoolYear || '학년 미입력'} ${row.semester || '학기 미입력'}`;
    byTerm[termKey] = byTerm[termKey] || [];
    byTerm[termKey].push(row.grade);
    const groupLabel = detailedLabel(detailedSubjectGroupOptions, row.subjectGroup) || '교과 미입력';
    bySubjectGroup[groupLabel] = bySubjectGroup[groupLabel] || [];
    bySubjectGroup[groupLabel].push(row.grade);
  });
  return {
    overallAverage,
    weightedAverage,
    bestScore,
    byTerm: Object.entries(byTerm).map(([label, values]) => ({ label, average: averageOf(values) })),
    bySubjectGroup: Object.entries(bySubjectGroup).map(([label, values]) => ({ label, average: averageOf(values) }))
  };
}
function transcriptSummaryNumber(value){
  return Number.isFinite(value) ? formatGrade(value) : '-';
}
function detailedTranscriptSummaryMarkup(studentOrRows){
  const summary = calculateDetailedTranscriptSummary(studentOrRows);
  const termItems = summary.byTerm.length ? summary.byTerm.map(item=>`<span>${h(item.label)} <b>${transcriptSummaryNumber(item.average)}</b></span>`).join('') : '<span>학기별 평균 없음</span>';
  const groupItems = summary.bySubjectGroup.length ? summary.bySubjectGroup.map(item=>`<span>${h(item.label)} <b>${transcriptSummaryNumber(item.average)}</b></span>`).join('') : '<span>교과별 평균 없음</span>';
  return `<div class="detailed-summary-grid">
    <div><span>전체 단순 평균</span><b data-detailed-overall>${transcriptSummaryNumber(summary.overallAverage)}</b></div>
    <div><span>이수단위 반영 평균</span><b data-detailed-weighted>${transcriptSummaryNumber(summary.weightedAverage)}</b></div>
    <div><span>전체 최고성적</span><b data-detailed-best>${transcriptSummaryNumber(summary.bestScore)}</b></div>
    <div class="wide"><span>학기별 평균</span><p data-detailed-terms>${termItems}</p></div>
    <div class="wide"><span>교과별 평균</span><p data-detailed-groups>${groupItems}</p></div>
  </div>`;
}
function blankDetailedTranscriptRow(){
  return { id: `dt_${Date.now()}_${Math.random().toString(16).slice(2)}`, schoolYear: '', semester: '', subjectGroup: '', subjectName: '', subjectType: '', grade: '', rawScore: '', averageScore: '', standardDeviation: '', achievement: '', credits: '', rank: '', studentCount: '', percentile: '', notes: '' };
}
function detailedTranscriptEditor(student){
  const rows = normalizeDetailedTranscript(student);
  const editableRows = rows.length ? rows : [blankDetailedTranscriptRow()];
  return `<div class="detailed-transcript-editor">
    <div class="detailed-transcript-head">
      <div><h3>상세 학생부 입력</h3><p>정확한 대학별 환산을 위해 과목별 학생부 정보를 한 줄씩 입력합니다.</p></div>
      <div class="detailed-transcript-actions"><button class="btn mini primary" type="button" id="addDetailedTranscriptRow">+ 과목 추가</button><button class="btn mini" type="button" id="copyDetailedTranscriptRow">이전 행 복사</button></div>
    </div>
    ${detailedTranscriptSummaryMarkup(editableRows)}
    <div class="detailed-transcript-scroll"><table class="detailed-transcript-table"><thead><tr><th>학년</th><th>학기</th><th>교과</th><th>과목명</th><th>과목유형</th><th>석차등급</th><th>원점수</th><th>평균</th><th>표준편차</th><th>성취도</th><th>이수단위</th><th>수강자수</th><th>삭제</th></tr></thead><tbody>${editableRows.map(row=>`<tr class="detailed-transcript-row" data-detailed-row="${h(row.id)}">
      <td><select data-detailed-field="schoolYear"><option value="">선택</option><option ${row.schoolYear==='1학년'?'selected':''}>1학년</option><option ${row.schoolYear==='2학년'?'selected':''}>2학년</option><option ${row.schoolYear==='3학년'?'selected':''}>3학년</option></select></td>
      <td><select data-detailed-field="semester"><option value="">선택</option><option ${row.semester==='1학기'?'selected':''}>1학기</option><option ${row.semester==='2학기'?'selected':''}>2학기</option></select></td>
      <td><select data-detailed-field="subjectGroup">${detailedOptionMarkup(detailedSubjectGroupOptions, row.subjectGroup)}</select></td>
      <td><input data-detailed-field="subjectName" list="detailedSubjectNameHints" value="${h(row.subjectName)}" placeholder="과목명"></td>
      <td><select data-detailed-field="subjectType">${detailedOptionMarkup(detailedSubjectTypeOptions, row.subjectType)}</select></td>
      <td><input data-detailed-field="grade" type="number" min="1" max="9" step="0.1" value="${h(row.grade)}" placeholder="예: 2"></td>
      <td><input data-detailed-field="rawScore" type="number" step="0.1" value="${h(row.rawScore)}" placeholder="원점수"></td>
      <td><input data-detailed-field="averageScore" type="number" step="0.1" value="${h(row.averageScore)}" placeholder="평균"></td>
      <td><input data-detailed-field="standardDeviation" type="number" step="0.1" value="${h(row.standardDeviation)}" placeholder="표준편차"></td>
      <td><input data-detailed-field="achievement" value="${h(row.achievement)}" placeholder="A/B/C"></td>
      <td><input data-detailed-field="credits" type="number" step="0.5" value="${h(row.credits)}" placeholder="단위"></td>
      <td><input data-detailed-field="studentCount" type="number" value="${h(row.studentCount)}" placeholder="수강자수"></td>
      <td><button class="btn mini danger" type="button" data-remove-detailed-row>삭제</button></td>
    </tr>`).join('')}</tbody></table></div>
    <datalist id="detailedSubjectNameHints">${detailedSubjectNameHints.map(name=>`<option value="${h(name)}"></option>`).join('')}</datalist>
  </div>`;
}
function readDetailedTranscriptFromEditor(){
  const rowElements = [...document.querySelectorAll('.detailed-transcript-row')];
  if(!rowElements.length) return normalizeDetailedTranscript(state.studentEditor?.student || {});
  return rowElements.map((row, index) => {
    const get = field => row.querySelector(`[data-detailed-field="${field}"]`)?.value?.trim() || '';
    return {
      id: row.dataset.detailedRow || `dt_${Date.now()}_${index}`,
      studentId: state.studentEditor?.student?.id || '',
      schoolYear: get('schoolYear'),
      semester: get('semester'),
      subjectGroup: get('subjectGroup'),
      subjectName: get('subjectName'),
      subjectType: get('subjectType'),
      grade: get('grade'),
      rawScore: get('rawScore'),
      averageScore: get('averageScore'),
      standardDeviation: get('standardDeviation'),
      achievement: get('achievement'),
      credits: get('credits'),
      studentCount: get('studentCount'),
      rank: '',
      percentile: '',
      notes: ''
    };
  }).filter(row => ['schoolYear','semester','subjectGroup','subjectName','subjectType','grade','rawScore','averageScore','standardDeviation','achievement','credits','studentCount'].some(key => row[key] !== ''));
}
function studentGradeInputTabsMarkup(student){
  const activeTab = state.studentGradeInputTab || 'simple';
  return `<div class="student-grade-input-tabs">
    <div class="student-grade-tab-buttons"><button class="btn ${activeTab==='simple'?'primary':''}" type="button" data-student-grade-tab="simple">간편 성적 입력</button><button class="btn ${activeTab==='detailed'?'primary':''}" type="button" data-student-grade-tab="detailed">상세 학생부 입력</button></div>
    <div class="grade-input-notice"><p>평균 내신만으로 대학별 반영성적을 계산하지 않습니다.</p><p>정확한 대학별 환산을 위해서는 상세 학생부 입력을 권장합니다.</p></div>
    ${window.BenchmarkStudentUi.profile(student,{simple:usesSimpleAverage(student)})}
    ${activeTab==='detailed' ? detailedTranscriptEditor(student) : termGradesEditor(student)}
  </div>`;
}
function detailedTranscriptView(student){
  const rows = normalizeDetailedTranscript(student);
  if(!rows.length) return `<div class="empty-box compact">상세 학생부 입력 내역이 없습니다.</div>`;
  return `<div class="detailed-transcript-view"><h4>상세 학생부</h4>${detailedTranscriptSummaryMarkup(rows)}<div class="detailed-transcript-scroll"><table class="detailed-transcript-table"><thead><tr><th>학년</th><th>학기</th><th>교과</th><th>과목명</th><th>과목유형</th><th>석차등급</th><th>원점수</th><th>평균</th><th>표준편차</th><th>성취도</th><th>이수단위</th><th>수강자수</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${h(row.schoolYear || '-')}</td><td>${h(row.semester || '-')}</td><td>${h(detailedLabel(detailedSubjectGroupOptions,row.subjectGroup) || '-')}</td><td>${h(row.subjectName || '-')}</td><td>${h(detailedLabel(detailedSubjectTypeOptions,row.subjectType) || '-')}</td><td><b>${h(row.grade || '-')}</b></td><td>${h(row.rawScore || '-')}</td><td>${h(row.averageScore || '-')}</td><td>${h(row.standardDeviation || '-')}</td><td>${h(row.achievement || '-')}</td><td>${h(row.credits || '-')}</td><td>${h(row.studentCount || '-')}</td></tr>`).join('')}</tbody></table></div></div>`;
}
function refreshDetailedTranscriptSummary(){
  const rows = readDetailedTranscriptFromEditor();
  const summary = calculateDetailedTranscriptSummary(rows);
  const editor = document.querySelector('.detailed-transcript-editor');
  const overall = editor?.querySelector('[data-detailed-overall]');
  const weighted = editor?.querySelector('[data-detailed-weighted]');
  const best = editor?.querySelector('[data-detailed-best]');
  const terms = editor?.querySelector('[data-detailed-terms]');
  const groups = editor?.querySelector('[data-detailed-groups]');
  if(overall) overall.textContent = transcriptSummaryNumber(summary.overallAverage);
  if(weighted) weighted.textContent = transcriptSummaryNumber(summary.weightedAverage);
  if(best) best.textContent = transcriptSummaryNumber(summary.bestScore);
  if(terms) terms.innerHTML = summary.byTerm.length ? summary.byTerm.map(item=>`<span>${h(item.label)} <b>${transcriptSummaryNumber(item.average)}</b></span>`).join('') : '<span>학기별 평균 없음</span>';
  if(groups) groups.innerHTML = summary.bySubjectGroup.length ? summary.bySubjectGroup.map(item=>`<span>${h(item.label)} <b>${transcriptSummaryNumber(item.average)}</b></span>`).join('') : '<span>교과별 평균 없음</span>';
}
function bindDetailedTranscriptEditor(){
  document.querySelectorAll('[data-student-grade-tab]').forEach(btn=>btn.onclick=()=>{syncStudentEditorDraft(); state.studentGradeInputTab=btn.dataset.studentGradeTab; renderStudents();});
  document.querySelectorAll('.detailed-transcript-editor input, .detailed-transcript-editor select').forEach(input=>input.addEventListener('input', refreshDetailedTranscriptSummary));
  const addBtn = $('addDetailedTranscriptRow');
  if(addBtn) addBtn.onclick=()=>{syncStudentEditorDraft(); state.studentEditor.student.detailedTranscript=[...normalizeDetailedTranscript(state.studentEditor.student), blankDetailedTranscriptRow()]; renderStudents();};
  const copyBtn = $('copyDetailedTranscriptRow');
  if(copyBtn) copyBtn.onclick=()=>{syncStudentEditorDraft(); const rows=normalizeDetailedTranscript(state.studentEditor.student); const source=rows[rows.length-1] || blankDetailedTranscriptRow(); state.studentEditor.student.detailedTranscript=[...rows,{...source,id:`dt_${Date.now()}_${Math.random().toString(16).slice(2)}`}]; renderStudents();};
  document.querySelectorAll('[data-remove-detailed-row]').forEach(btn=>btn.onclick=()=>{const row=btn.closest('.detailed-transcript-row'); if(row) row.remove(); refreshDetailedTranscriptSummary();});
  refreshDetailedTranscriptSummary();
}
function artworkGalleryMarkup(artworks, mode='view'){
  if(!artworks.length) return `<div class="artwork-empty">등록된 그림 이미지가 없습니다.</div>`;
  return artworks.map((artwork, index)=>`<figure class="student-artwork-card">
    <button class="artwork-open-btn" type="button" data-open-artwork="${h(artwork.displayUrl || '')}" data-open-artwork-name="${h(artwork.name || `그림 ${index + 1}`)}">
      ${studentArtworkImage(artwork.thumbnailUrl||artwork.displayUrl,'','학생 그림',index<5,artwork.displayUrl)}
    </button>
    <figcaption>${h(artwork.name || `그림 ${index + 1}`)}</figcaption>
    ${mode === 'edit' ? `<button class="btn mini danger" type="button" data-remove-artwork="${index}">삭제</button>` : ''}
  </figure>`).join('');
}
function bindArtworkViewer(){
  document.querySelectorAll('[data-student-artwork]').forEach(img=>{const fail=()=>{if(img.dataset.original&&img.getAttribute('src')!==img.dataset.original){img.src=img.dataset.original;return;}img.hidden=true;if(img.nextElementSibling)img.nextElementSibling.hidden=false;};img.onerror=fail;if(img.complete&&!img.naturalWidth)fail();});
  document.querySelectorAll('[data-generate-thumbnails]').forEach(btn=>btn.onclick=async()=>{
    const student=state.data.students.find(s=>String(s.id)===btn.dataset.generateThumbnails);
    const originals=studentArtworks(student).filter(a=>/^\/api\/admissions\/(students|files)\//.test(a.thumbnailUrl)).slice(0,5);
    if(!originals.length)return;
    btn.disabled=true;let ready=0;
    try{for(const artwork of originals){
      const response=await fetch(artwork.displayUrl,{credentials:'same-origin',cache:'no-store'});
      if(!response.ok)throw Error();
      const blob=await response.blob();
      await window.DataCoreLibraryThumbnail.create(blob,'',new AbortController().signal,artwork.thumbnailUrl);
      ready++;
    }
    btn.textContent=`${ready}장 썸네일 준비 완료`;
    btn.closest('section').querySelectorAll('img[data-original]').forEach(img=>{img.hidden=false;img.src=studentArtworks(student).find(a=>a.displayUrl===img.dataset.original)?.thumbnailUrl||img.dataset.original;});
    }catch{btn.textContent=`${ready}장 완료 · 다시 시도`;}finally{btn.disabled=false;}
  });
  document.querySelectorAll('[data-open-artwork]').forEach(btn=>btn.onclick=()=>{
    const student=btn.dataset.artworkStudent && state.data.students.find(s=>String(s.id)===btn.dataset.artworkStudent);
    const buttons=[...(btn.closest('.student-gallery')?.querySelectorAll('[data-open-artwork]') || [btn])];
    const items=student ? studentArtworks(student).map(a=>({src:imgSrc(a.displayUrl),previewSrc:imgSrc(a.thumbnailUrl),title:a.name||'학생 그림'}))
      : buttons.map(b=>({src:imgSrc(b.dataset.openArtwork),title:b.dataset.openArtworkName||'그림'}));
    const viewer=window.DataCoreImageGallery.open({scope:'admissions-artwork',title:'학생 그림',anchor:btn,
      items,index:student?0:buttons.indexOf(btn),onClose:()=>{closeArtworkViewer=null;}});
    closeArtworkViewer=viewer?.close;
  });
}
function refreshTermGradeSummary(){
  const draft = { termGrades: readTermGradesFromEditor() };
  const stats = studentGradeStats(draft);
  const editor = document.querySelector('.student-editor');
  const overall = editor?.querySelector('[data-grade-overall]');
  const best = editor?.querySelector('[data-grade-best]');
  if(overall) overall.textContent = formatGrade(stats.overallAverage);
  if(best) best.textContent = formatGrade(stats.bestScore);
  termRows().forEach(row => {
    const target = editor?.querySelector(`[data-term-average="${row.gradeKey}_${row.semesterKey}"]`);
    if(target) target.textContent = formatGrade(rowAverage(draft, row));
  });
}
function bindTermGradeAutoCalc(){
  document.querySelectorAll('.term-score-editor input').forEach(input => input.addEventListener('input', refreshTermGradeSummary));
  refreshTermGradeSummary();
}
function studentGradePanel(student){
  const rows = termRows().map(row => ({
    gradeYear: row.gradeLabel,
    semester: row.semesterLabel,
    korean: termScoreValue(student, row, 'korean'),
    english: termScoreValue(student, row, 'english'),
    math: termScoreValue(student, row, 'math'),
    social: termScoreValue(student, row, 'social'),
    science: termScoreValue(student, row, 'science')
  }));
  const hasSimpleScores = rows.some(row => subjectFields.some(subject => row[subject.key] !== ''));
  const hasDetailedScores = normalizeDetailedTranscript(student).length > 0;
  if(!hasSimpleScores && !hasDetailedScores) return `<div class="case-detail-panel"><h3>성적 보기</h3>${gradePhotoNotice(student)}<div class="empty-box">입력된 성적이 없습니다.</div>${gradeReportFiles(student)}</div>`;
  const simpleMarkup = hasSimpleScores ? `${gradeSummaryMarkup(student)}<table class="grade-term-table"><thead><tr><th>학년</th><th>학기</th><th>국어</th><th>영어</th><th>수학</th><th>사탐</th><th>과탐</th><th>학기 평균</th></tr></thead><tbody>${termRows().map((row,index)=>`<tr><td>${h(rows[index].gradeYear)}</td><td>${h(rows[index].semester)}</td><td>${h(rows[index].korean || '-')}</td><td>${h(rows[index].english || '-')}</td><td>${h(rows[index].math || '-')}</td><td>${h(rows[index].social || '-')}</td><td>${h(rows[index].science || '-')}</td><td><b>${formatGrade(rowAverage(student,row))}</b></td></tr>`).join('')}</tbody></table>` : `<div class="empty-box compact">간편 성적 입력 내역이 없습니다.</div>`;
  return `<div class="case-detail-panel"><h3>성적 보기</h3>${gradePhotoNotice(student)}${simpleMarkup}${detailedTranscriptView(student)}${gradeReportFiles(student)}</div>`;
}
// 성적표 사진 넣기 results on a student: doubtful cells still to check, and the kept report photos.
function gradePhotoNotice(student){
  const count = Array.isArray(student?.gradeReview) ? student.gradeReview.length : 0;
  return count ? `<div class="grade-review-note"><b>성적표 사진 확인 필요 ${count}곳</b><span>사진이 애매하거나 기존 값과 다른 칸입니다.</span><button class="btn mini" type="button" data-grade-review="${h(student.id)}">확인하기</button></div>` : '';
}
function gradeReportFiles(student){
  const reports = Array.isArray(student?.gradeReports) ? student.gradeReports : [];
  if(!reports.length) return '';
  return `<div class="grade-report-files"><h4>성적 자료 <small>비공개 · 그림 목록과 따로 보관 · ${reports.length}장</small></h4><div>${reports.map(r=>`<a href="${h(r.path)}" target="_blank" rel="noopener" title="${h(r.name||'')}"><img src="${h(r.path)}" alt="${h(r.name||'성적표')}" loading="lazy"></a>`).join('')}</div></div>`;
}
function replaceStudentInState(saved){
  if(!saved || !state.data?.students) return;
  const index = state.data.students.findIndex(s => String(s.id) === String(saved.id));
  if(index >= 0) state.data.students[index] = saved;
}
let gradePhotoRenderTimer = 0;
function scheduleStudentsRender(){ clearTimeout(gradePhotoRenderTimer); gradePhotoRenderTimer = setTimeout(()=>{ if(document.getElementById('students')) renderStudents(); }, 300); }
if(window.GradePhotoImport) window.GradePhotoImport.onStudentSaved = saved => { replaceStudentInState(saved); scheduleStudentsRender(); };
document.addEventListener('click', event => {
  const button = event.target.closest?.('[data-grade-review]');
  if(!button || !window.GradePhotoImport) return;
  const student = (state.data?.students || []).find(s => String(s.id) === button.dataset.gradeReview);
  if(student) window.GradePhotoImport.review(student, saved => { replaceStudentInState(saved); scheduleStudentsRender(); });
});
function consultantName(){
  const options = consultantNameOptions();
  const savedName = state.data?.settings?.consultantName || '';
  return options.includes(savedName) ? savedName : options[0];
}
function consultantNameOptions(){ return ['ANIHI 만화학원', 'HI5 미술학원']; }
function admissionRoundOptions(){ return ['수시 1차', '수시 2차', '수시', '정시', '추가모집', '기타']; }
function admissionYearOptions(students = state.data?.students || []){
  return [...new Set(students.flatMap(student => normalizeAdmissionResults(student).map(row => row.year || row.admissionYear || student.admissionYear || student.applicationYear || '')).filter(Boolean))]
    .sort((a,b)=>String(b).localeCompare(String(a),'ko'));
}
function admissionResultLabel(row){
  const result = row?.result || '합격';
  const note = row?.resultNote || row?.note || '';
  return note ? `${result}(${note})` : result;
}
function admissionPeriodLabel(row){
  const year = row?.year || row?.admissionYear || '';
  const round = row?.round || row?.admissionRound || row?.period || '';
  return [year, round].filter(Boolean).join(' · ');
}
function admissionMatchesFilters(row, yearFilter, roundFilter){
  const year = String(row?.year || row?.admissionYear || '');
  const round = String(row?.round || row?.admissionRound || row?.period || '');
  return (!yearFilter || year === String(yearFilter)) && (!roundFilter || round === String(roundFilter));
}
function studentMatchesAdmissionFilters(student, yearFilter, roundFilter){
  if(!yearFilter && !roundFilter) return true;
  return normalizeAdmissionResults(student).some(row => admissionMatchesFilters(row, yearFilter, roundFilter));
}
function blankAdmissionResult(){
  return { year: '2025', round: '수시 1차', result: '합격', resultNote: '', universityName: '', competition: '' };
}
function normalizeAdmissionResults(student, includeEmpty=false){
  const rows = Array.isArray(student?.admissionResults) ? student.admissionResults : [];
  const normalized = rows
    .map(row => ({
      result: row?.result || '합격',
      resultNote: row?.resultNote || row?.note || '',
      year: row?.year || row?.admissionYear || student?.admissionYear || student?.applicationYear || '',
      round: row?.round || row?.admissionRound || row?.period || student?.admissionRound || '',
      universityName: row?.universityName || row?.admissionUniversity || '',
      competition: row?.competition || '',
      originalResult: row?.originalResult || '',
      reserveNumber: row?.reserveNumber ?? row?.waitlistNumber ?? null,
      major: row?.major || '',
      university: row?.university || '',
      examSubject: row?.examSubject || '',
      sourceBatch: row?.sourceBatch || '',
      sourceFile: row?.sourceFile || ''
    }))
    .filter(row => includeEmpty || row.universityName || row.competition);
  if(normalized.length) return normalized;
  if(student?.admissionResult && student.admissionResult !== '미정' && student.admissionUniversity){
    return [{ result: student.admissionResult, year: student.admissionYear || '', round: student.admissionRound || '', universityName: student.admissionUniversity, competition: student.admissionCompetition || '' }];
  }
  return [];
}
function admissionResultsEditor(student, universityOptions){
  const rows = normalizeAdmissionResults(student, true);
  const editableRows = rows.length ? rows : [blankAdmissionResult()];
  const roundOptions = admissionRoundOptions();
  return `<div class="admission-results-editor"><div class="editor-section-head"><h3>합격·불합격 결과</h3><button class="btn mini" id="addAdmissionResultBtn" type="button">결과 추가</button></div><div class="admission-result-list">${editableRows.map((row,index)=>`<div class="admission-result-row" data-admission-row="${index}">
    <div class="field"><label>학년도</label><input data-admission-year="${index}" type="number" value="${h(row.year || '')}" placeholder="2025"></div>
    <div class="field"><label>모집 구분</label><select data-admission-round="${index}">${roundOptions.map(option=>`<option value="${h(option)}" ${row.round===option?'selected':''}>${h(option)}</option>`).join('')}</select></div>
    <div class="field"><label>결과</label><select data-admission-result="${index}"><option ${row.result==='합격'?'selected':''}>합격</option><option ${row.result==='불합격'?'selected':''}>불합격</option><option ${row.result==='미응시'?'selected':''}>미응시</option></select></div>
    <div class="field"><label>결과 메모</label><input data-admission-note="${index}" value="${h(row.resultNote || '')}" placeholder="예: 예비 2번"></div>
    <div class="field"><label>대학명</label><input data-admission-university="${index}" list="studentUniversityOptions" value="${h(row.universityName || '')}" placeholder="클릭해서 대학 선택 또는 직접 입력"></div>
    <div class="field"><label>경쟁률</label><input data-admission-competition="${index}" value="${h(row.competition || '')}" placeholder="예: 9.8 : 1"></div>
    <button class="btn mini danger admission-remove-btn" type="button" data-remove-admission="${index}">삭제</button>
  </div>`).join('')}</div><datalist id="studentUniversityOptions">${universityOptions}</datalist></div>`;
}
function skillLevelSelectMarkup(student){
  let value = student?.skillLevel || (studentSkillLevel(student) !== '-' ? studentSkillLevel(student) : '');
  const pendingSkill = pendingOf(student.id)?.skillLevel;
  if(pendingSkill !== undefined) value = pendingSkill;
  return `<select class="skill-level-select" data-row-field="skillLevel" data-row-student="${h(student.id)}" aria-label="실기능력 선택">
    ${skillLevelOptionsMarkup(value)}
  </select>`;
}
function readAdmissionResultsFromEditor(){
  return Array.from(document.querySelectorAll('[data-admission-row]')).map(row => {
    const index = row.dataset.admissionRow;
    return {
      result: row.querySelector(`[data-admission-result="${index}"]`)?.value || '합격',
      resultNote: row.querySelector(`[data-admission-note="${index}"]`)?.value.trim() || '',
      year: row.querySelector(`[data-admission-year="${index}"]`)?.value.trim() || '',
      round: row.querySelector(`[data-admission-round="${index}"]`)?.value || '',
      universityName: row.querySelector(`[data-admission-university="${index}"]`)?.value.trim() || '',
      competition: row.querySelector(`[data-admission-competition="${index}"]`)?.value.trim() || ''
    };
  }).filter(row => row.universityName || row.competition);
}
function compactUniversityText(value){
  return String(value || '')
    .toLowerCase()
    .replace(/대학교/g, '대')
    .replace(/캠퍼스/g, '')
    .replace(/[()\[\]{}·ㆍ\s._\-]/g, '');
}
function baseUniversityText(value){
  return compactUniversityText(value)
    .replace(/서울$/, '')
    .replace(/천안$/, '')
    .replace(/세종$/, '')
    .replace(/글로벌$/, '')
    .replace(/미래$/, '');
}
function hasMeaningfulOverlap(a, b, minLength=4){
  const left = compactUniversityText(a);
  const right = compactUniversityText(b);
  if(!left || !right) return false;
  if(left.includes(right) || right.includes(left)) return true;
  const short = left.length <= right.length ? left : right;
  const long = left.length > right.length ? left : right;
  for(let length=Math.min(short.length, 9); length>=minLength; length--){
    for(let i=0; i<=short.length-length; i++){
      const piece = short.slice(i, i + length);
      if(long.includes(piece)) return true;
    }
  }
  return false;
}
function admissionMatchText(admission){
  return [
    admission?.universityName,
    admission?.university,
    admission?.major,
    admission?.examSubject,
    admission?.admission,
    admission?.originalResult
  ].filter(Boolean).join(' ');
}
function majorKeywordScore(source, major){
  const keywords = ['ai미디어', '미디어', '콘텐츠', '애니', '웹툰', '만화', '게임', '디자인', '조형', '영상', '회화', '조소'];
  return keywords.some(keyword => source.includes(compactUniversityText(keyword)) && major.includes(compactUniversityText(keyword))) ? 35 : 0;
}
function admissionKeywordScore(source, admissionName){
  let score = 0;
  if(source.includes('특교') && admissionName.includes('특수교육')) score += 30;
  if(source.includes('학종') && (admissionName.includes('인재') || admissionName.includes('종합'))) score += 15;
  if(source.includes('교과') && admissionName.includes('교과')) score += 15;
  if(source.includes('실기') && admissionName.includes('실기')) score += 15;
  return score;
}
function universityObject(value){
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
function admissionUniversityNameCandidates(admission){
  return [admission?.universityName, admission?.university]
    .filter(Boolean)
    .flatMap(value => {
      const text = String(value || '').trim();
      const first = text.split(/[\s·ㆍ]/)[0] || text;
      return [text, first, first.replace(/대$/, '')];
    })
    .filter(Boolean);
}
function resolveAdmissionUniversity(admission){
  const source = compactUniversityText(admissionMatchText(admission));
  const nameCandidates = admissionUniversityNameCandidates(admission);
  if(!source) return null;
  if(resolveUniversityCache.has(source)) return resolveUniversityCache.get(source);
  const candidateUniversities = admissionCandidateUniversities(nameCandidates);
  if(!candidateUniversities.length){
    resolveUniversityCache.set(source, null);
    return null;
  }
  let best = null;
  let bestScore = 0;
  for(const university of candidateUniversities){
    const officialName = compactUniversityText(university.name);
    const officialBase = baseUniversityText(university.name);
    const major = compactUniversityText(university.major);
    const admissionName = compactUniversityText(university.admission);
    let nameScore = 0;
    nameCandidates.forEach(candidate => {
      const candidateName = compactUniversityText(candidate);
      const candidateBase = baseUniversityText(candidate);
      if(officialName && candidateName && (candidateName.includes(officialName) || officialName.includes(candidateName))) nameScore = Math.max(nameScore, 120);
      else if(officialBase && candidateBase && candidateBase.length >= 2 && (candidateBase.includes(officialBase) || officialBase.includes(candidateBase))) nameScore = Math.max(nameScore, 80);
    });
    if(!nameScore) continue;
    let score = nameScore;
    if(major && source.includes(major)) score += 90;
    else if(major && hasMeaningfulOverlap(source, major)) score += 45;
    score += majorKeywordScore(source, major);
    if(admissionName && source.includes(admissionName)) score += 25;
    score += admissionKeywordScore(source, admissionName);
    if(score > bestScore){
      best = university;
      bestScore = score;
    }
  }
  const resolved = bestScore >= 80 ? best : null;
  resolveUniversityCache.set(source, resolved);
  return resolved;
}
function admissionDisplayUniversity(row){
  return row?.officialUniversityName || row?.university?.name || row?.universityName || '-';
}
function admissionDisplayMajor(row){
  return row?.officialMajor || row?.university?.major || row?.major || '';
}
function displayAdmissionRows(student){
  const cacheKey = studentAdmissionCacheKey(student);
  if(cacheKey && admissionRowsCache.has(cacheKey)) return admissionRowsCache.get(cacheKey);
  const rows = normalizeAdmissionResults(student).map(row => {
    const university = universityObject(row.university) || uni(row.universityId) || resolveAdmissionUniversity(row);
    return {
      ...row,
      university,
      universityId: university?.id || row.universityId || null,
      officialUniversityName: university?.name || row.officialUniversityName || row.universityName || '',
      officialMajor: university?.major || row.officialMajor || row.major || ''
    };
  });
  const byKey = new Map();
  const rowPriority = (row) => {
    let score = 0;
    if(String(row.round || '').includes('최종')) score += 30;
    if(String(row.sourceBatch || '').includes('최종')) score += 20;
    if(row.universityId) score += 10;
    if(row.competition && row.competition !== '-') score += 5;
    return score;
  };
  rows.forEach(row => {
    const key = [
      student?.id || student?.name || '',
      compactUniversityText(row.officialUniversityName || row.universityName),
      compactUniversityText(row.officialMajor || row.major),
      row.result || '',
      row.resultNote || ''
    ].join('|');
    const existing = byKey.get(key);
    if(!existing || rowPriority(row) > rowPriority(existing)) byKey.set(key, row);
  });
  const result = Array.from(byKey.values());
  if(cacheKey) admissionRowsCache.set(cacheKey, result);
  return result;
}
function admissionSummaryMarkup(student){
  const rows = displayAdmissionRows(student);
  if(!rows.length) return '-';
  return `<div class="admission-summary">${rows.slice(0,3).map(row=>`<span class="${row.result==='합격'?'pass-label':'fail-label'}">${h(admissionResultLabel(row))} ${h(admissionDisplayUniversity(row))}${admissionPeriodLabel(row)?` <small>${h(admissionPeriodLabel(row))}</small>`:''}</span>`).join('')}${rows.length>3?`<span class="muted">+${rows.length-3}</span>`:''}</div>`;
}
function studentAdmissionDetailPanel(student){
  const rows = displayAdmissionRows(student);
  if(!rows.length) return `<section class="student-detail-section"><h3>합격·불합격 결과</h3><div class="empty-box compact">입력된 결과가 없습니다.</div></section>`;
  const expanded = state.studentResultExpandedId === student.id;
  const visibleRows = expanded ? rows : rows.slice(0, 6);
  const moreCount = rows.length - visibleRows.length;
  return `<section class="student-detail-section"><div class="student-detail-head"><h3>합격·불합격 결과 <small>${rows.length}건</small></h3>${rows.length>6?`<button class="btn mini" type="button" data-toggle-student-results="${student.id}">${expanded?'결과 접기':`전체 보기 ${moreCount}건 더`}</button>`:''}</div><div class="student-result-grid">${visibleRows.map(row=>`<div class="student-result-card ${row.result==='합격'?'pass':'fail'}">
    <div><b>${h(admissionResultLabel(row))}</b>${admissionPeriodLabel(row)?`<span>${h(admissionPeriodLabel(row))}</span>`:''}</div>
    <p>${h(admissionDisplayUniversity(row))}${admissionDisplayMajor(row)?` · ${h(admissionDisplayMajor(row))}`:''}</p>
    <dl><dt>경쟁률</dt><dd>${h(row.competition || '-')}</dd>${row.originalResult?`<dt>원본결과</dt><dd>${h(row.originalResult)}</dd>`:''}</dl>
  </div>`).join('')}</div></section>`;
}
function studentArtworkDetailPanel(student){
  const artworks = studentArtworks(student);
  return `<section class="student-detail-section"><h3>그림 ${artworks.length?`<small>${artworks.length}장</small>`:''}</h3>${artworks.length&&state.data?._campus?.master?`<button class="btn mini" type="button" data-generate-thumbnails="${h(student.id)}">기존 썸네일 생성 (최대 5장)</button>`:''}${artworks.length?`<div class="student-gallery">${artworkGalleryMarkup(artworks)}</div>`:'<div class="empty-box compact">등록된 그림 이미지가 없습니다.</div>'}</section>`;
}
function studentFullDetailPanel(student){
  return `<div class="student-full-detail">
    ${studentRecommendationPanel(student)}
    ${studentCurrentManagementPanel(student)}
    ${studentAdmissionDetailPanel(student)}
    <section class="student-detail-section">${studentGradePanel(student)}</section>
    ${studentArtworkDetailPanel(student)}
  </div>`;
}
function editorGradeLevel(student){
  const info = window.AdmissionsStudentGrades.gradeOf(student);
  return info.grade && !info.graduated ? `고${info.grade}` : (student.gradeLevel || '고1');
}
// 학년 + 몇 년도 → the year the student was 고1, so the grade moves up by itself every March.
function entryYearFromEditor(){
  const grade = /고\s*([123])/.exec($('editStudentGradeLevel')?.value || '')?.[1];
  const year = Number($('editStudentGradeYear')?.value);
  return grade && Number.isInteger(year) && year >= 2000 && year <= 2100 ? window.AdmissionsStudentGrades.entryYearFor(grade, year) : null;
}
function studentEditorActions(editor, place='top'){
  const remove = editor.mode === 'edit' && canManageStudents() ? `<button class="btn danger" type="button" data-editor-delete>삭제</button>` : '';
  return `<div class="actions editor-actions editor-actions-${place}"><button class="btn primary" type="button" data-editor-save${place==='bottom'?' id="saveStudentBtn"':''}>저장</button><button class="btn" type="button" data-editor-cancel${place==='bottom'?' id="cancelStudentBtn"':''}>취소</button>${remove}</div>`;
}
function studentEditorMarkup(editor, editorArtworks, universityOptions, studentTrackOptions){
  const currentMode = (editor.student.studentType || (state.studentTypeTab === 'result' ? 'result' : 'current')) === 'current';
  return `<div class="student-editor inline-editor">
    <div class="top compact editor-head"><div><h2>${editor.mode === 'edit' ? '학생 정보 수정' : '학생 추가'}</h2><p>상담에 필요한 기본 성적, 학기별 과목 성적, 그림 이미지, 실기능력을 입력합니다.</p></div>${studentEditorActions(editor)}</div>
    <div class="admin-grid">
      <div class="field"><label>학생 구분</label><select id="editStudentType"><option value="current" ${currentMode?'selected':''}>현재 재원생</option><option value="result" ${!currentMode?'selected':''}>합격자 데이터</option></select></div>
      <div class="field"><label>학생명</label><input id="editStudentName" value="${h(editor.student.name || '')}" placeholder="예: 김학생"></div>
      <div class="field"><label>내신 평균</label><input id="editStudentGpa" type="number" step="0.1" value="${h(editor.student.gpa || '')}" placeholder="3.2"></div>
      <div class="field"><label>실기능력</label><select id="editStudentSkillLevel">${skillLevelOptionsMarkup(editor.student.skillLevel || (studentSkillLevel(editor.student) !== '-' ? studentSkillLevel(editor.student) : ''))}</select></div>
      <div class="field"><label>전공 계열</label><select id="editStudentDivision">${STUDENT_DIVISIONS.map(([key,label]) => `<option value="${key}" ${key===studentDivision(editor.student)?'selected':''}>${label}</option>`).join('')}</select></div>
      <div class="field"><label>희망 계열</label><div class="hope-field"><select id="editStudentTrack">${hopeTrackOptionsMarkup(editor.student.track || '')}</select><button class="btn" type="button" id="addHopeTrackBtn">+ 추가</button></div>
        <div class="hope-add hidden" id="hopeAddRow"><input id="hopeAddInput" maxlength="20" placeholder="예: 캐릭터 디자인"><button class="btn primary" type="button" id="hopeAddSave">추가</button><button class="btn" type="button" id="hopeAddCancel">취소</button></div></div>
      <div class="field"><label>실기경력</label><input id="editStudentPracticeExperience" value="${h(editor.student.practiceExperience || '')}" placeholder="예: 입시반 2년 / 공모전 경험"></div>
      <div class="field current-student-field ${currentMode?'':'hidden'}"><label>학년</label><select id="editStudentGradeLevel">${studentGradeLevelOptions(editorGradeLevel(editor.student))}</select></div>
      <div class="field current-student-field ${currentMode?'':'hidden'}"><label>몇 년도 학년인가요?</label><input id="editStudentGradeYear" type="number" min="2000" max="2100" value="${h(editor.student._gradeYear || window.AdmissionsStudentGrades.schoolYear())}"></div>
      <div class="field current-student-field ${currentMode?'':'hidden'}"><label>재원 상태</label><select id="editStudentEnrollmentStatus">${studentStatusOptions(editor.student.enrollmentStatus || '재원중')}</select></div>
      <div class="field current-student-field ${currentMode?'':'hidden'}"><label>준비 단계</label><select id="editStudentPreparationStage">${preparationStageOptions(editor.student.preparationStage || '방향 설정')}</select></div>
      <div class="field current-student-field ${currentMode?'':'hidden'}"><label>다음 상담 예정일</label><input id="editStudentNextConsultationDate" type="date" value="${h(editor.student.nextConsultationDate || '')}"></div>
      <div class="field wide current-student-field ${currentMode?'':'hidden'}"><label>희망 대학</label><input id="editStudentTargetUniversities" value="${h(editor.student.targetUniversities || editor.student.wishUniversities || '')}" placeholder="예: 홍익대, 건국대, 상명대"></div>
      <div class="field wide current-student-field ${currentMode?'':'hidden'}"><label>상담 메모</label><textarea id="editStudentConsultMemo" rows="3" placeholder="상담 내용, 과제, 보완점">${h(editor.student.consultMemo || editor.student.memo || '')}</textarea></div>
      <div class="field"><label>그림 이미지</label><button class="btn" id="chooseArtworkBtn" type="button">그림 이미지 추가</button></div>
    </div>
    <div class="result-student-editor ${currentMode?'hidden':''}">
      ${admissionResultsEditor(editor.student, universityOptions)}
    </div>
    ${studentGradeInputTabsMarkup(editor.student)}
    <div class="artwork-preview"><div class="student-gallery edit-gallery">${artworkGalleryMarkup(editorArtworks,'edit')}</div></div>
    ${studentEditorActions(editor, 'bottom')}
  </div>`;
}
function caseRowsFromStudents(){
  if(caseRowsCache) return caseRowsCache;
  const rows = (state.data.students || [])
    .filter(s => studentType(s) === 'result')
    .flatMap(s => displayAdmissionRows(s).map((admission, index) => {
      const university = universityObject(admission.university) || uni(admission.universityId) || resolveAdmissionUniversity(admission);
      const officialUniversityName = university?.name || admission.officialUniversityName || admission.universityName;
      const officialMajor = university?.major || admission.officialMajor || admission.major || s.track || '';
      return {
        ...s,
        id: `student-${s.id}-${index}`,
        sourceStudentId: s.id,
        anonymousId: s.name || `학생-${s.id}`,
        result: admission.result,
        resultNote: admission.resultNote || '',
        reserveNumber: admission.reserveNumber,
        admissionYear: admission.year || '',
        admissionRound: admission.round || '',
        originalResult: admission.originalResult || '',
        universityId: university?.id || null,
        universityName: officialUniversityName,
        admissionUniversity: officialUniversityName,
        rawUniversityName: admission.universityName,
        major: officialMajor,
        gpa: studentOverallGrade(s),
        skillDisplay: studentSkillLevel(s),
        competition: admission.competition || '-',
        memo: s.memo || '',
        practiceExperience: s.practiceExperience || '-',
        subjectScores: s.subjectScores || null,
        university
      };
    }));
  const deduped = new Map();
  const priority = (row) => {
    let score = 0;
    if(String(row.admissionRound || '').includes('최종')) score += 30;
    if(String(row.sourceBatch || '').includes('최종')) score += 20;
    if(row.universityId) score += 10;
    if(row.competition && row.competition !== '-') score += 5;
    return score;
  };
  rows.forEach(row => {
    const key = [
      row.sourceStudentId,
      compactUniversityText(row.universityName),
      compactUniversityText(row.major),
      row.result,
      row.resultNote
    ].join('|');
    const existing = deduped.get(key);
    if(!existing || priority(row) > priority(existing)) deduped.set(key, row);
  });
  caseRowsCache = Array.from(deduped.values());
  return caseRowsCache;
}
function caseUniversityName(caseItem){
  return caseItem.universityName || caseItem.admissionUniversity || caseItem.university?.name || '';
}
function universityAcceptanceRate(caseItem, rows){
  const name = caseUniversityName(caseItem);
  const pool = rows.filter(row => {
    if(caseItem.universityId && row.universityId) return row.universityId === caseItem.universityId;
    const rowName = caseUniversityName(row);
    return name && rowName && (rowName.includes(name) || name.includes(rowName));
  });
  if(!pool.length) return '-';
  const accepted = pool.filter(row => row.result === '합격').length;
  return `${Math.round((accepted / pool.length) * 100)}%`;
}
function casePracticeExperience(caseItem){
  return caseItem.practiceExperience || caseItem.memo || '-';
}
function caseSearchMatches(caseItem, query){
  const rawQuery = String(query || '').trim();
  const normalizedQuery = compactUniversityText(rawQuery);
  if(!normalizedQuery) return false;
  const displayedUniversity = compactUniversityText(caseItem.universityName || caseItem.university?.name || '');
  const displayedMajor = compactUniversityText(caseItem.major || caseItem.university?.major || '');
  const rawUniversity = compactUniversityText(caseItem.rawUniversityName || '');
  const displayedUniversityMatches = [displayedUniversity, rawUniversity].some(value => value && (value.includes(normalizedQuery) || normalizedQuery.includes(value)));
  const displayedMajorMatches = displayedMajor && displayedMajor.includes(normalizedQuery);
  const looksLikeUniversitySearch = /대|대학교|대학|전문대|예대|여대|교대|과기대|산기대|시립대|국립/.test(rawQuery);
  if(looksLikeUniversitySearch) return displayedUniversityMatches || displayedMajorMatches;
  return [
    caseItem.anonymousId,
    caseItem.name,
    caseItem.result,
    caseItem.resultNote,
    caseItem.admissionYear,
    caseItem.admissionRound,
    caseItem.originalResult,
    caseItem.memo,
    caseItem.practiceExperience,
    caseItem.universityName,
    caseItem.rawUniversityName,
    caseItem.university?.name,
    caseItem.university?.major,
    caseItem.major
  ].some(value => String(value || '').toLowerCase().includes(rawQuery.toLowerCase()));
}
function conversionRuleForUniversity(university){
  return RuleInterpreter.findRule(state.data.admissionGradeRules || [], university, university?.year);
}
function conversionStudentFromAverage(gpa){
  const termGrades = {};
  termRows().forEach(row => {
    termGrades[row.gradeKey] = termGrades[row.gradeKey] || {};
    termGrades[row.gradeKey][row.semesterKey] = {};
    subjectFields.forEach(subject => {
      termGrades[row.gradeKey][row.semesterKey][subject.key] = Number(gpa || 0);
    });
  });
  return { id: 'analysis', name: '분석용 입력값', gpa, termGrades };
}
function calculateUniversityConversion(student, university){
  if(!window.GradeConversionService) return null;
  return GradeConversionService.calculate(student, university, conversionRuleForUniversity(university));
}
function conversionBadge(result){
  if(!result || !result.rule) return '<span class="badge reach">규칙 확인 필요</span>';
  return `<span class="badge fit">예시</span>`;
}
function ruleSelectionLabel(value){
  return {
    ALL: '전체 과목 반영',
    TOP_N: '상위 과목만 반영',
    TOP_N_PER_GROUP: '교과별 상위 과목 반영',
    TOP_N_PER_SEMESTER: '학기별 상위 과목 반영',
    BEST_GRADE: '최고 등급 과목 반영'
  }[value] || value || '-';
}
function ruleStatusLabel(value){
  return { DRAFT: '검토 전', VERIFIED: '검증 완료', CHANGED: '변경 확인 필요' }[value] || value || '-';
}
function conversionDetailPanel(result){
  if(!result || !result.rule) return `<div class="case-detail-panel"><h3>환산 상세보기</h3><div class="empty-box">등록된 환산 규칙이 없습니다.</div></div>`;
  return `<div class="case-detail-panel conversion-detail"><h3>환산 상세보기</h3>
    <div class="grade-summary">
      <div><span>사용 규칙</span><b>${h(result.rule.ruleName)}</b></div>
      <div><span>검증 상태</span><b>${h(ruleStatusLabel(result.rule.verificationStatus || 'DRAFT'))}</b></div>
      <div><span>원본 학생 평균</span><b>${formatGrade(result.originalAverage)}</b></div>
      <div><span>대학 환산점수</span><b>${formatGrade(result.finalScore)} / ${h(result.maxScore)}</b></div>
    </div>
    ${result.warning ? `<div class="notice">${h(result.warning)} 예시 규칙은 실제 모집요강이 아닙니다.</div>` : ''}
    <table class="grade-term-table"><thead><tr><th>학년</th><th>학기</th><th>교과</th><th>과목</th><th>원등급</th><th>환산점수</th><th>이수단위</th><th>반영여부</th><th>제외 사유</th></tr></thead><tbody>${result.detailRows.map(row=>`<tr><td>${h(row.schoolYear)}</td><td>${h(row.semester)}</td><td>${h(row.subjectGroup)}</td><td>${h(row.subjectName)}</td><td>${h(row.originalGrade)}</td><td>${h(row.convertedScore)}</td><td>${h(row.credits)}</td><td>${row.included?'반영':'제외'}</td><td>${h(row.reason)}</td></tr>`).join('')}</tbody></table>
    <div class="notice">선택 과목 수: ${h(result.summary.selectedSubjectCount)} · 환산 총점: ${formatGrade(result.summary.conversionTotal)} · 학생부 최종 환산점수: ${formatGrade(result.finalScore)} / ${h(result.maxScore)}</div>
  </div>`;
}

function scoreUniversity(u, gpa, skill){
  const gradeRatio = Number.isFinite(Number(u.gradeRatio)) ? Number(u.gradeRatio) : 40;
  const skillRatio = Number.isFinite(Number(u.skillRatio)) ? Number(u.skillRatio) : 60;
  const ratioTotal = Math.max(1, gradeRatio + skillRatio);
  const gpaValue = Number.isFinite(Number(gpa)) ? Number(gpa) : 3.2;
  const skillValue = Number.isFinite(Number(skill)) ? Number(skill) : 80;
  const cutRaw = Number.isFinite(Number(u.cutGpa)) ? Number(u.cutGpa) : Number(u.acceptedStats?.average);
  let gradeScore = 50 + (3.5 - gpaValue) * 8;
  if(Number.isFinite(cutRaw)){
    if(cutRaw > 9){
      const maxScore = Number(u.gradeMaxScore) || (cutRaw > 500 ? 1000 : cutRaw > 120 ? 200 : 100);
      const converted = Math.max(0, Math.min(maxScore, maxScore * (1 - Math.max(0, gpaValue - 1) * 0.065)));
      gradeScore = 50 + ((converted - cutRaw) / maxScore) * 180;
    } else {
      gradeScore = 50 + (cutRaw - gpaValue) * 14;
    }
  }
  const sampleSkill = Number(u.sampleSkill);
  const skillScore = Number.isFinite(sampleSkill) && sampleSkill >= 10
    ? 50 + (skillValue - sampleSkill) * 1.2
    : 50 + (skillValue - 80) * 0.8;
  const score = (gradeScore * gradeRatio + skillScore * skillRatio) / ratioTotal;
  return Math.max(8, Math.min(92, Math.round(score)));
}
function level(p){ if(p>=65)return ['안정','safe']; if(p>=42)return ['적정','fit']; return ['소신','reach']; }
function universityCollegeType(university){
  const raw = String(university?.collegeType || university?.schoolType || university?.admissionCategory || '').trim();
  if(raw==='특수학교/교육기관') return raw;
  if(raw.includes('전문')) return '전문대';
  if(raw.includes('4') || raw.includes('일반')) return '4년제';
  return '4년제';
}
function collegeTypeOptions(selected='4년제'){
  const current = universityCollegeType({ collegeType: selected });
  return ['4년제','전문대','특수학교/교육기관'].map(type => `<option value="${type}" ${current===type?'selected':''}>${type}</option>`).join('');
}
function collegeTypeBadge(university){
  const type = universityCollegeType(university);
  const cls = type === '전문대' ? 'college-type-junior' : 'college-type-four';
  return `<span class="college-type-badge ${cls}">${type}</span>`;
}
function universityRegion(university){
  return String(university?.region || university?.area || university?.location || '').trim();
}
function universityNameText(university){
  const name = String(university?.name || '').trim();
  const region = universityRegion(university);
  return region ? `${name} (${region})` : name;
}
function universityNameMarkup(university){
  const name = h(university?.name || '');
  const region = universityRegion(university);
  return region ? `${name} <span class="university-region">(${h(region)})</span>` : name;
}
function uni(id){ return universityIdMap().get(Number(id)); }
function casesFor(id){
  if(!id) return [];
  return caseRowsFromStudents().filter(x=>Number(x.universityId)===Number(id));
}
function sortedUniversities({management=false}={}){
  const priority = university => {
    if(university.latestAdmissionComplete === true && isUniversityChecked(university)) return 0;
    if(isUniversityChecked(university)) return 1;
    if(university.latestAdmissionComplete === true) return 2;
    return 3;
  };
  const deleted = new Set(management ? (state.data._universityManagementDeletedIds || []).map(String) : []);
  return state.data.universities.filter(u=>!deleted.has(String(u.id))).sort((a,b)=>{
    const priorityDiff = priority(a) - priority(b);
    if(priorityDiff) return priorityDiff;
    const nameDiff = String(a.name||'').localeCompare(String(b.name||''),'ko');
    if(nameDiff) return nameDiff;
    const majorDiff = String(a.major||'').localeCompare(String(b.major||''),'ko');
    if(majorDiff) return majorDiff;
    return String(a.admission||'').localeCompare(String(b.admission||''),'ko');
  });
}
function isUniversityChecked(university){
  if(!university) return false;
  if(Object.prototype.hasOwnProperty.call(university, 'checkedComplete')){
    return university.checkedComplete === true;
  }
  return university.isChecked === true || university.checked === true;
}
function checkedUniversities(){
  const excluded = new Set((state.data._universityRecommendationExcludedIds || []).map(String));
  return (state.data.universities || []).filter(university => !excluded.has(String(university.id)) && isUniversityChecked(university) && !university.hiddenDuplicate);
}
function recommendationUniversities(){
  const checked = checkedUniversities();
  const latest = checked.filter(university => university.latestAdmissionComplete === true);
  return latest.length ? latest : checked;
}
function applyUniversityCheckedToState(universityIds, checked){
  const idSet = new Set((Array.isArray(universityIds) ? universityIds : []).map(Number));
  state.data.universities = (state.data.universities || []).map(university => {
    if(!idSet.has(Number(university.id))) return university;
    return {
      ...university,
      checkedComplete: checked,
      isChecked: checked,
      checked,
      latestAdmissionComplete: checked ? true : university.latestAdmissionComplete,
      latestAdmissionSource: checked && !university.latestAdmissionSource ? '수동 최신입시요강 체크' : university.latestAdmissionSource
    };
  });
  universityIdCache = null;
}
function updateAdminCheckedBadges(universityIds, checked){
  const idSet = new Set((Array.isArray(universityIds) ? universityIds : []).map(String));
  document.querySelectorAll('[data-admin-uni]').forEach(button => {
    if(!idSet.has(String(button.dataset.adminUni))) return;
    const title = button.querySelector('b');
    if(!title) return;
    const badgeWrap = title.querySelector('.admin-card-badges') || title;
    const badge = badgeWrap.querySelector('em');
    if(checked && !badge){
      badgeWrap.insertAdjacentHTML('afterbegin', '<em class="latest-admission-badge">최신입시요강 체크완료</em>');
    }
    if(!checked && badge){
      badge.remove();
    }
  });
  if(idSet.has(String(state.selectedUniversityId)) && $('aCheckedComplete')){
    $('aCheckedComplete').value = checked ? 'true' : 'false';
    if($('checkCompleteBtn')){
      $('checkCompleteBtn').classList.toggle('active', checked);
      $('checkCompleteBtn').textContent = '최신입시요강 체크완료';
    }
  }
}
function persistUniversityCheckedInBackground(universityIds, checked){
  const ids = Array.isArray(universityIds) ? universityIds : [];
  const task = window.desktopAPI.setUniversitiesChecked
    ? window.desktopAPI.setUniversitiesChecked(ids, checked)
    : Promise.all(ids.map(id => {
      const university = uni(Number(id));
      return university ? window.desktopAPI.updateUniversity({ ...university, checkedComplete: checked, isChecked: checked, checked }) : null;
    }));
  Promise.resolve(task).catch(error => {
    alert(error?.message || '체크 상태 저장 중 오류가 발생했습니다. 다시 시도해주세요.');
  });
}
function releaseInteractionFocus(){
  try {
    if(document.activeElement?.tagName === 'BUTTON') document.activeElement.blur();
  } catch (_) {}
}
function dashboardTrackOptions(){ return ['웹툰', '애니메이션', '게임일러스트', '디자인', '인문']; }
function trackOptionsMarkup(selected='', includeAll=false){
  const options = includeAll ? [''] : [];
  return options.concat(dashboardTrackOptions()).map(track => {
    const label = track || '전공 계열 전체';
    return `<option value="${h(track)}" ${selected===track?'selected':''}>${h(label)}</option>`;
  }).join('');
}
function gradeStepOptions(selected=''){
  const current = Number(selected);
  const values = [];
  for(let grade = 1; grade <= 9; grade += 0.5){
    values.push(Number.isInteger(grade) ? grade : Number(grade.toFixed(1)));
  }
  return `<option value="">선택</option>${values.map(value => {
    const selectedAttr = Number.isFinite(current) && Math.abs(current - value) < 0.001 ? 'selected' : '';
    return `<option value="${value}" ${selectedAttr}>${value}등급</option>`;
  }).join('')}`;
}
const practicalTypeRules = [
  { label:'상황표현', keywords:['상황표현','상황 표현','상황','스토리보드','스토리 보드','장면표현','장면 표현','칸 상황'] },
  { label:'칸만화', keywords:['칸만화','칸 만화','컷만화','컷 만화','만화','웹툰 칸','콘티','네컷','4컷','카툰'] },
  { label:'이미지보드', keywords:['이미지보드','이미지 보드','이미지','보드','아이디어보드','아이디어 보드'] },
  { label:'포트폴리오', keywords:['포트폴리오','portfolio','포폴','서류','면접','작품집'] },
  { label:'게임포스터', keywords:['게임포스터','게임 포스터','포스터','게임 일러스트','게임일러스트'] },
  { label:'캐릭터 디자인', keywords:['캐릭터','캐릭터디자인','캐릭터 디자인','캐릭터 상황','캐릭터 창작'] },
  { label:'캐릭터 일러스트', keywords:['캐릭터 일러스트','캐릭터일러스트','일러스트','일러스트레이션'] },
  { label:'기초디자인', keywords:['기초디자인','기초 디자인','발상과표현','발상과 표현','사고의전환','사고의 전환','기초소양','기초 소양'] },
  { label:'소묘', keywords:['소묘','드로잉','정밀묘사','연필소묘'] },
  { label:'수채화', keywords:['수채화','정물수채화','인물수채화'] },
  { label:'인체수채화', keywords:['인체수채화','인체 수채화','인물'] },
  { label:'애니메이션', keywords:['애니메이션','애니','영상애니','애니메이션 실기','움직임'] },
  { label:'면접', keywords:['면접','구술','심층면접'] },
  { label:'실기 없음', keywords:['비실기','실기없음','실기 없음','학생부','교과','종합','면접전형','서류전형'] }
];
function practicalTypeOptions(){ return practicalTypeRules.map(rule => rule.label); }
function practicalTypeOptionsMarkup(selected='', includeAll=false){
  const options = includeAll ? [''] : [];
  return options.concat(practicalTypeOptions()).map(type => {
    const label = type || '실기 유형 전체';
    return `<option value="${h(type)}" ${selected===type?'selected':''}>${h(label)}</option>`;
  }).join('');
}
function universityPracticalText(university){
  const explicit = [university.practicalType, university.practiceType, university.examType].filter(Boolean).join(' ');
  const fallback = [university.major, university.admission, university.subjects, university.notes, university.conversionRule?.name].filter(Boolean).join(' ');
  return (explicit || fallback || '').toLowerCase();
}
function universityMatchesPracticalType(university, selected){
  if(!selected) return true;
  const text = universityPracticalText(university);
  if(!text) return false;
  const rule = practicalTypeRules.find(item => item.label === selected);
  const keywords = rule ? rule.keywords : [selected];
  return keywords.some(keyword => text.includes(String(keyword).toLowerCase()));
}
function displayPracticalType(university){
  const explicit = university.practicalType || university.practiceType || university.examType;
  if(explicit) return explicit;
  const text = universityPracticalText(university);
  const match = practicalTypeRules.find(rule => rule.keywords.some(keyword => text.includes(String(keyword).toLowerCase())));
  return match ? match.label : '';
}
function universityMatchesTrack(university, track){
  const value = `${university.name || ''} ${university.major || ''} ${university.admission || ''} ${university.subjects || ''}`.toLowerCase();
  const rules = {
    '애니': ['웹툰', '만화', '카툰', 'comic', 'comics', 'cartoon', '애니', 'animation', 'anime', '게임', '일러스트', 'illustration', 'game'],
    '웹툰': ['웹툰', '만화', '카툰', 'comic', 'comics', 'cartoon'],
    '애니메이션': ['애니', 'animation', 'anime'],
    '게임일러스트': ['게임', '일러스트', 'illustration', 'game'],
    '디자인': ['디자인', 'design', '시각', '산업', '패션', '제품', '공간', '실내', '영상', '커뮤니케이션', '공예', '금속', '도예', '조형', '미술', '회화', '조소'],
    '인문': ['인문', '국문', '영문', '어문', '문예', '문화', '사회', '경영', '경제']
  };
  return (rules[track] || []).some(keyword => value.includes(keyword.toLowerCase()));
}
function dashboardUniversitiesForTrack(track, practicalType=''){
  const universities = recommendationUniversities();
  return universities.filter(university => universityMatchesTrack(university, track) && universityMatchesPracticalType(university, practicalType));
}
function refreshUniversityRecommendations(){
  const checked = recommendationUniversities();
  const selectedStillAvailable = checked.some(university => university.id === state.selectedUniversityId);
  if(!selectedStillAvailable) state.selectedUniversityId = checked[0]?.id ?? null;
  if(state.lastAnalysis){
    const gpa = Number.isFinite(Number(state.lastAnalysis.gpa)) ? Number(state.lastAnalysis.gpa) : 3.2;
    const skill = Number.isFinite(Number(state.lastAnalysis.skill)) ? Number(state.lastAnalysis.skill) : 80;
    const track = state.lastAnalysis.track || '';
    const practicalType = state.lastAnalysis.practicalType || '';
    const results = window.AdmissionsCounselingUx.sortByDistance(dashboardUniversitiesForTrack(track, practicalType).map(u=>({u,p:scoreUniversity(u,gpa,skill)})));
    state.lastAnalysis = { ...state.lastAnalysis, gpa, skill, track, practicalType, results };
    if(results.length && !results.some(item => item.u.id === state.selectedUniversityId)){
      state.selectedUniversityId = results[0].u.id;
    }
    if(!results.length && !selectedStillAvailable){
      state.selectedUniversityId = checked[0]?.id ?? null;
    }
  }
  state.conversionDetailId = null;
}
function refreshUniversitySelectionOnly(){
  const checked = recommendationUniversities();
  const checkedIds = new Set(checked.map(university => university.id));
  if(!checkedIds.has(state.selectedUniversityId)) state.selectedUniversityId = checked[0]?.id ?? null;
  if(state.lastAnalysis){
    state.lastAnalysis = {
      ...state.lastAnalysis,
      results: (state.lastAnalysis.results || []).filter(item => checkedIds.has(item.u.id))
    };
  }
  state.conversionDetailId = null;
}
function blankUniversity(){
  return {
    name: '새 대학교',
    major: '학과명',
    admission: '전형명',
    year: 2027,
    region: '',
    collegeType: '4년제',
    gradeRatio: 40,
    skillRatio: 60,
    subjects: '국어·영어·수학·사탐·과탐',
    ratePrev: '-',
    rateCurrent: '-',
    cutGpa: 3.5,
    sampleSkill: 80,
    requiredScores: { korean: 0, english: 0, math: 0, social: 0, science: 0 },
    acceptedStats: { average: 0, best: 0, worst: 0 }
  };
}
function num(id, fallback=0){ const value=parseFloat($(id)?.value || ''); return Number.isFinite(value) ? value : fallback; }
function drawTextLines(ctx, text, x, y, maxWidth, lineHeight){
  const words = String(text).split(' ');
  let line = '';
  for(const word of words){
    const test = line ? line + ' ' + word : word;
    if(ctx.measureText(test).width > maxWidth && line){
      ctx.fillText(line, x, y);
      line = word;
      y += lineHeight;
    } else {
      line = test;
    }
  }
  if(line) ctx.fillText(line, x, y);
  return y + lineHeight;
}
async function saveStrategyAsImage(student, gpa, skillLevel, track, results){
  const canvas = document.createElement('canvas');
  canvas.width = 1240;
  canvas.height = 1754;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = '#f5f7fb';
  ctx.fillRect(0,0,canvas.width,180);
  ctx.fillStyle = '#172554';
  ctx.font = 'bold 46px Segoe UI, sans-serif';
  ctx.fillText('지원 전략 상담지', 70, 82);
  ctx.font = '24px Segoe UI, sans-serif';
  ctx.fillStyle = '#43516a';
  ctx.fillText(`${student?.name || '학생'} · 내신 ${formatGrade(gpa)} · 실기 능력 ${skillLevel} · 전공 계열 ${track || '-'}`, 70, 128);
  ctx.fillText(`생성일 ${new Date().toLocaleDateString('ko-KR')}`, 70, 162);
  const groups = [
    ['안정 지원', results.filter(x=>x.p>=65).slice(0,6), '#177a4a'],
    ['적정 지원', results.filter(x=>x.p>=42&&x.p<65).slice(0,6), '#b36b00'],
    ['소신 지원', results.filter(x=>x.p<42).slice(0,6), '#bd3737']
  ];
  groups.forEach(([title, items, color], index) => {
    const x = 70;
    const y0 = 230 + index * 460;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#dbe3ee';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y0, 1100, 390, 18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = 'bold 32px Segoe UI, sans-serif';
    ctx.fillText(title, x + 34, y0 + 56);
    ctx.font = '20px Segoe UI, sans-serif';
    ctx.fillStyle = '#43516a';
    let y = y0 + 112;
    if(!items.length){
      ctx.fillText('추천 후보 없음', x + 34, y);
    }
    items.forEach(({u,p}, idx) => {
      ctx.fillStyle = '#172554';
      ctx.font = 'bold 22px Segoe UI, sans-serif';
      ctx.fillText(`${idx+1}. ${universityNameText(u)}`, x + 34, y);
      ctx.fillStyle = '#43516a';
      ctx.font = '18px Segoe UI, sans-serif';
      ctx.fillText(`${u.major} · ${u.admission || '-'}`, x + 250, y);
      ctx.fillStyle = color;
      ctx.font = 'bold 20px Segoe UI, sans-serif';
      ctx.fillText(`${p}%`, x + 1010, y);
      y += 42;
    });
  });
  ctx.fillStyle = '#667085';
  ctx.font = '18px Segoe UI, sans-serif';
  ctx.fillText('※ 합격 가능성은 상담 참고용 예측값이며 실제 합격을 보장하지 않습니다. 실제 지원 전 대학 공식 모집요강을 확인하세요.', 70, 1688);
  const result = await window.desktopAPI.saveStrategyImage(canvas.toDataURL('image/png'));
  if(result.ok) alert('지원 전략 이미지가 저장되었습니다.');
}

async function boot(){
  try{
    const [loadedData,benchmarkModel,averageModel]=await Promise.all([window.desktopAPI.getAll(),import('./admission-benchmarks.js?v=20261014-evidence'),import('./simple-average-recommendations.js?v=20261014-simple-average')]);
    admissionBenchmarkModel=benchmarkModel;
    simpleAverageModel=averageModel;
    setStateData(loadedData);
    bindNav();
    routeAdmissions();
  }catch(error){
    renderAppError(error);
  }
}
function admissionsHistoryWindow(){ try { return window.top.location.origin === location.origin ? window.top : window; } catch { return window; } }
// 뒤로가기 = 한 단계 위로: 로드맵 홈 (the first page) is the parent of every other page, so the browser's back button
// goes 페이지 → 로드맵 홈 → the screen that opened the roadmap. Moving between pages replaces the entry instead of adding one.
const ADMISSIONS_HOME = 'home';
function pushAdmissionsPage(page){
  const w = admissionsHistoryWindow(), hash = `#page=${encodeURIComponent(page)}`;
  const current = new URLSearchParams(w.location.hash.slice(1)).get('page') || ADMISSIONS_HOME;
  if(page === ADMISSIONS_HOME || current !== ADMISSIONS_HOME) w.history.replaceState({admissionsUp:1},'',hash);
  else w.history.pushState({admissionsUp:1},'',hash);
}
function settleAdmissionsPage(){
  const w = admissionsHistoryWindow(), page = new URLSearchParams(w.location.hash.slice(1)).get('page') || ADMISSIONS_HOME;
  if(page === ADMISSIONS_HOME || page === 'dashboard' || w.history.state?.admissionsUp) return;
  const hash = w.location.hash;
  w.history.replaceState(null,'',`#page=${ADMISSIONS_HOME}`);
  w.history.pushState({admissionsUp:1},'',hash);
}
function routeAdmissions(){
  settleAdmissionsPage();
  const params = new URLSearchParams(admissionsHistoryWindow().location.hash.slice(1));
  const requested = ['dashboard','strategy'].includes(params.get('page')) ? 'students' : params.get('page');
  const page = ['home','students','cases','works','admin','awards','settings','susi','jungsi'].includes(requested) ? requested : ADMISSIONS_HOME;
  const university = params.get('university');
  showPage(page, false);
  // 주소에 대학이 있으면(바로가기 링크) 첫 화면으로 비운 뒤 그 대학을 고른다.
  if(page === 'admin' && university && state.data.universities.some(u=>String(u.id)===university)) state.selectedUniversityId = state.data.universities.find(u=>String(u.id)===university).id;
}
function bindNav(){
  document.querySelectorAll('#nav button').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.page)));
  admissionsHistoryWindow().addEventListener('popstate',routeAdmissions);
  admissionsHistoryWindow().addEventListener('hashchange',routeAdmissions);
}
function showPage(page, updateHistory=true){
  if(page === 'dashboard' || page === 'strategy') page = 'students';
  closeArtworkViewer?.();
  const target = $(page);
  if(!target) return;
  if(updateHistory) pushAdmissionsPage(page);
  if(page !== activePageId()){ resetPageView(page); window.scrollTo(0, 0); }
  pageRenderToken += 1;
  const token = pageRenderToken;
  document.querySelectorAll('.page').forEach(p=>p.classList.add('hidden'));
  target.classList.remove('hidden');
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active', b.dataset.page===page));
  if(!target.innerHTML.trim()) target.innerHTML = '<div class="top"><div><h1>불러오는 중입니다</h1><p>잠시만 기다려주세요.</p></div></div>';
  setTimeout(() => {
    if(token === pageRenderToken) renderPage(page);
  }, 0);
}
function renderAll(){ renderPage(activePageId()); }
function renderPage(page){
  try{
    if(page==='home') renderRoadmapHome();
    if(page==='students') renderStudents();
    if(page==='cases') renderCases();
    if(page==='admin') renderAdmin();
    if(page==='awards') renderAwards();
    if(page==='works') renderWorks();
    if(page==='settings') renderSettings();
    if(page==='susi' || page==='jungsi') import('./guidelines.js?v=20261013-fresh').then(m=>{ const fresh = freshGuidelinePage === page; if(fresh) freshGuidelinePage = ''; return m.renderGuidelines(page, {fresh}); }).catch(()=>{ $(page).textContent='입시요강 화면을 불러오지 못했습니다. 새로고침해주세요.'; });
  }catch(error){
    renderAppError(error, page);
  }
}
function renderAppError(error, page='students'){
  const target = $(page) || $('students');
  if(!target) return;
  target.innerHTML = `<div class="top"><div><h1>화면을 여는 중 문제가 발생했습니다</h1><p>프로그램을 다시 실행해도 반복되면 아래 오류 내용을 알려주세요.</p></div></div><section class="card"><pre class="error-box">${h(error?.stack || error?.message || error || '알 수 없는 오류')}</pre></section>`;
  console.error(error);
}
function activePageId(){ return document.querySelector('.page:not(.hidden)')?.id || ADMISSIONS_HOME; }

// 로드맵 홈: the roadmap's first screen — 학년별 학생 수 and every category as a card (like 상담용 홈).
const ROADMAP_CARDS = [
  ['students','학생 관리','고1·고2·고3 학생 · 정보를 넣으면 추천 대학이 바로','story-academy-work-v1'],
  ['cases','합격·불합격 사례','고3에서 넘어온 합격자 데이터','admissions-v1'],
  ['works','대학합격 재현작 및 공개우수작','대학별 재현작·우수작 모음','design-academy-work-v1'],
  ['admin','대학 데이터 관리','대학·학과·전형 정보','operations-v1'],
  ['susi','미대 수시 입시요강','수시 전형 한눈에','design-v1'],
  ['jungsi','미대 정시 입시요강','정시 전형 한눈에','story-v1'],
];
// 학생 관리 구분: 디자인 / 애니. A saved choice wins; otherwise the campus (디자인 입시관 · 애니 입시본원),
// otherwise 희망 계열 (디자인 → 디자인, 웹툰·애니메이션·게임 → 애니).
const STUDENT_DIVISIONS = [['design','디자인'],['anim','애니']];
function studentDivision(student){
  if(student?.division === 'design' || student?.division === 'anim') return student.division;
  const campus = String(student?.campusId || '');
  if(campus.includes('design')) return 'design';
  if(campus.includes('anihi')) return 'anim';
  return String(student?.track || '').includes('디자인') ? 'design' : 'anim';
}
// 학생 정보 세 가지: 실기능력(A+~C) · 전공 계열(디자인/애니 = 구분) · 희망 계열(실기 유형, 추가 가능).
const trackLabelOf = division => division === 'design' ? '디자인' : '애니';
const BASE_HOPE_TRACKS = ['기초소양', '기초디자인', '발상과표현', '상황표현', '칸만화', '이미지보드', '포트폴리오'];
function hopeTrackOptions(current=''){
  const list = [...BASE_HOPE_TRACKS, ...(state.data?._students?.trackOptions || [])];
  if(current && !list.includes(current)) list.push(current);
  return [...new Set(list)];
}
function hopeTrackOptionsMarkup(current=''){
  return `<option value="" ${!current?'selected':''}>선택</option>` + hopeTrackOptions(current).map(v => `<option value="${h(v)}" ${v===current?'selected':''}>${h(v)}</option>`).join('');
}
// The row keeps changes from its 실기능력 · 전공 계열 · 희망 계열 buttons until 저장 is pressed.
const pendingOf = id => (state.studentPending ||= {})[id] || null;
function rowValue(student, field){ const pending = pendingOf(student.id); return pending && field in pending ? pending[field] : student[field]; }
function studentDivisionSelectMarkup(student){
  const division = rowValue(student, 'division') || studentDivision(student);
  return `<select class="skill-level-select track-select" data-row-field="division" data-row-student="${h(student.id)}" aria-label="전공 계열 선택">
    ${STUDENT_DIVISIONS.map(([key,label]) => `<option value="${key}" ${key===division?'selected':''}>${label}</option>`).join('')}
  </select>`;
}
function studentHopeSelectMarkup(student){
  return `<select class="skill-level-select hope-select" data-row-field="track" data-row-student="${h(student.id)}" aria-label="희망 계열 선택">${hopeTrackOptionsMarkup(rowValue(student, 'track') || '')}</select>`;
}
function studentGradeCounts(division){
  const counts = { g1: 0, g2: 0, g3: 0, result: 0, unknown: 0 };
  for(const student of state.data.students || []){
    if(division && studentDivision(student) !== division) continue;
    if(!isCurrentStudent(student)) { counts.result++; continue; }
    const info = window.AdmissionsStudentGrades.gradeOf(student);
    counts[info.grade ? `g${info.grade}` : 'unknown']++;
  }
  return counts;
}
function renderRoadmapHome(){
  $('home').innerHTML = `<div class="roadmap-home">
    <div class="roadmap-cards">${ROADMAP_CARDS.map(([page,title,text,image]) => `<button type="button" class="roadmap-card" data-roadmap-page="${page}">
      <img src="/data-core/assets/work-visuals/${image}.webp" alt="" width="1440" height="960" loading="lazy" decoding="async">
      <span><strong>${h(title)}</strong><small>${h(text)}</small></span><i aria-hidden="true">→</i></button>`).join('')}</div>
  </div>`;
  document.querySelectorAll('[data-roadmap-page]').forEach(button => button.onclick = () => showPage(button.dataset.roadmapPage));
}
const canManageStudents = () => Boolean(state.data?._students?.canManage);
// 학생 관리 목록의 첫 화면: 검색어 · 열린 수정창 · 펼친 학생 · 업로드 창을 모두 닫는다.
// 탭을 바꾸거나, 저장·삭제·업로드를 마치거나, 다른 메뉴로 갈 때 이전 이름이 남지 않게 한다.
function resetStudentView(){
  Object.assign(state, { studentSearch: '', studentEditor: null, studentDetailId: null, studentResultExpandedId: null,
    studentGalleryId: null, studentGradeId: null, studentYearFilter: '', studentRoundFilter: '', studentUploadOpen: false, studentPending: {} });
}
// 다른 메뉴(또는 뒤로가기 후 로드맵 홈)에서 들어오면 항상 그 메뉴의 첫 화면: 검색어 · 필터 · 고른 대학/폴더 · 열린 창을 비운다.
// 같은 메뉴 안에서 다시 그릴 때(저장·탭 이동 등)는 부르지 않는다.
let freshGuidelinePage = '';
function resetPageView(page){
  resetStudentView();
  Object.assign(state, { caseSearch: '', caseReserveFilter: '', caseDetail: null, conversionDetailId: null,
    adminShowArchived: false, adminSearch: '', adminTrackSearch: '', adminEditing: false, adminDraft: null, adminMode: 'edit', pdfAnalysis: null,
    awardFolderId: null, awardViewer: null });
  if(page === 'admin') state.selectedUniversityId = null;
  // 재현작·우수작은 DATA CORE 폴더 화면(iframe)을 새로 띄워 대학 · 연도 폴더와 그림 보기를 처음 상태로 돌린다.
  if(page === 'works' && $('works')) $('works').innerHTML = '';
  if(page === 'susi' || page === 'jungsi') freshGuidelinePage = page;
}
// 고3은 공식 검증 비교 유지. 나머지 현재 학생은 한 학기만 있어도 단순평균 참고 비교.
function usesSimpleAverage(student){const info=window.AdmissionsStudentGrades.gradeOf(student);return isCurrentStudent(student)&&!(info.grade===3&&!info.graduated);}
function studentRecommendations(student){
 const track=trackLabelOf(studentDivision(student));
 const simple=usesSimpleAverage(student);
 const input=simple?{...student,detailedTranscript:normalizeDetailedTranscript(student)}:student;
 return window.BenchmarkStudentUi.compare(state.data,input,admissionBenchmarkModel,u=>universityMatchesTrack(u,track),{simple,simpleAverageModel});
}
function recommendationChips(student){return window.BenchmarkStudentUi.chips(studentRecommendations(student));}
function studentRecommendationPanel(student){return isCurrentStudent(student)?window.BenchmarkStudentUi.panel(studentRecommendations(student),admissionBenchmarkModel):'';}
// 학생 명단 기본 양식: built by scripts/build-student-roster-template.py (same look as 출석부 기본 양식).
const STUDENT_TEMPLATE_URL = 'templates/student-roster-template.xlsx?v=20261014-student-template';
const STUDENT_TEMPLATE_NAME = '학생명단_기본양식.xlsx';
function studentUploadPanel(){
  const grades = window.AdmissionsStudentGrades;
  const tabGrade = /^g([123])$/.exec(state.studentTypeTab || '')?.[1] || '1';
  return `<div class="card student-upload-card">
    <h3>학생 명단 올리기</h3>
    <div class="admin-grid">
      <div class="field"><label>전공 계열</label><select id="studentUploadDivision">${STUDENT_DIVISIONS.map(([key,label]) => `<option value="${key}" ${key===(state.studentDivision||'design')?'selected':''}>${label}</option>`).join('')}</select></div>
      <div class="field"><label>학년</label><select id="studentUploadGrade">${[1,2,3].map(g => `<option value="${g}" ${String(g)===tabGrade?'selected':''}>고${g}</option>`).join('')}</select></div>
      <div class="field"><label>몇 년도 학년인가요?</label><input id="studentUploadYear" type="number" min="2000" max="2100" value="${grades.schoolYear()}"></div>
      <div class="field wide"><label>엑셀(.xlsx)·CSV 파일</label><input id="studentUploadFile" type="file" accept=".xlsx,.csv,.json"></div>
    </div>
    <p class="muted"><a href="${STUDENT_TEMPLATE_URL}" download="${STUDENT_TEMPLATE_NAME}">학생 명단 기본 양식</a>을 내려받아 채우면 가장 편합니다. 직접 만든 파일은 첫 줄에 이름(학생명) · 내신 · 실기능력(A+~C) · 희망 계열 · 학교 · 희망 대학 · 메모 중 필요한 칸을 적어 주세요. 연도를 기준으로 해가 바뀌면 학년이 자동으로 올라갑니다.</p>
    <p class="student-upload-preview" id="studentUploadPreview" role="status"></p>
    <div class="row-actions"><button class="btn" id="studentUploadCancel" type="button">닫기</button><button class="btn primary" id="studentUploadSave" type="button" disabled>올리기</button></div>
  </div>`;
}

let verifiedGradeDraft = null;
let gradeMountToken = 0;
function renderVerifiedGradePage(page) {
  const root = $(page);
  const token = ++gradeMountToken;
  const revision = admissionsDataRevision;
  const current = () => token === gradeMountToken && revision === admissionsDataRevision && activePageId() === page;
  root.innerHTML = '<p role="status">성적 환산 화면을 불러오는 중입니다.</p>';
  import('./verified-grades.js?v=20260929-1').then(module => {
    if(!current()) return;
    verifiedGradeDraft ||= module.newGradeDraft();
    module.mountVerifiedGrades(root, {
      students: state.data.students || [],
      draft: verifiedGradeDraft,
      current,
      onNavigate: showPage,
      onSave: async (studentId, detailedTranscript) => {
        if(!current()) throw new Error('캠퍼스 또는 화면이 변경되었습니다. 다시 열어주세요.');
        const student = state.data.students.find(item => String(item.id) === String(studentId));
        if(!student) throw new Error('현재 캠퍼스의 학생을 찾을 수 없습니다.');
        const updated = await window.desktopAPI.updateStudent({id:student.id,detailedTranscript});
        if(current()) {
          const index = state.data.students.findIndex(item => String(item.id) === String(studentId));
          if(index >= 0) state.data.students[index] = updated;
        }
      },
    });
  }).catch(error => { if(current()) renderAppError(error,page); });
}
function renderDashboard(){ if($('dashboard')) renderVerifiedGradePage('dashboard'); }

function renderStudents(){
  const query = state.studentSearch.trim().toLowerCase();
  const yearFilter = state.studentYearFilter || '';
  const roundFilter = state.studentRoundFilter || '';
  const grades = window.AdmissionsStudentGrades;
  // First visit: open the first tab that has students (재원생 학년 first), never an empty tab.
  if(!state.studentTabChosen){
    state.studentTabChosen = true;
    const order = ['g1','g2','g3','unknown'].flatMap(tab => STUDENT_DIVISIONS.map(([key]) => [key, tab])).concat(STUDENT_DIVISIONS.map(([key]) => [key, 'result']));
    const first = order.find(([key, tab]) => studentGradeCounts(key)[tab] > 0);
    if(first) [state.studentDivision, state.studentTypeTab] = first;
  }
  const division = state.studentDivision === 'anim' ? 'anim' : 'design';
  const counts = studentGradeCounts(division);
  if(state.studentTypeTab === 'current') state.studentTypeTab = 'g1';
  if(state.studentTypeTab === 'unknown' && !counts.unknown) state.studentTypeTab = 'g1';
  const activeStudentTab = ['g1','g2','g3','unknown','result'].includes(state.studentTypeTab) ? state.studentTypeTab : 'g1';
  const gradeTab = activeStudentTab !== 'result';
  const manager = canManageStudents();
  const yearOptions = admissionYearOptions();
  const roundOptions = admissionRoundOptions();
  const allStudents = state.data.students || [];
  const inTab = s => {
    if(studentDivision(s) !== division) return false;
    if(activeStudentTab === 'result') return !isCurrentStudent(s);
    if(!isCurrentStudent(s)) return false;
    const info = grades.gradeOf(s);
    return activeStudentTab === 'unknown' ? !info.grade : activeStudentTab === `g${info.grade}`;
  };
  const students = allStudents
    .slice()
    .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'ko'))
    .filter(inTab)
    .filter(s => gradeTab || studentMatchesAdmissionFilters(s, yearFilter, roundFilter))
    .filter(s => !query || [
      s.name,
      s.track,
      s.school,
      s.schoolType,
      s.practiceType,
      s.skillLevel,
      s.practiceExperience,
      s.gradeLevel,
      s.enrollmentStatus,
      s.preparationStage,
      s.nextConsultationDate,
      s.targetUniversities,
      s.consultMemo,
      s.admissionResult,
      s.admissionUniversity,
      ...normalizeAdmissionResults(s).flatMap(row => [row.result, row.resultNote, row.year, row.round, row.universityName, row.competition, row.originalResult])
    ].some(v => String(v || '').toLowerCase().includes(query)));
  const editor = state.studentEditor;
  const editorArtworks = editor ? studentArtworks(editor.student) : [];
  const universityOptions = editor ? sortedUniversities().map(u=>`<option value="${h(u.name)}">${h(u.major)}</option>`).join('') : '';
  const studentTrackOptions = editor ? trackOptionsMarkup(editor?.student?.track || '웹툰') : '';
  const renderStudentRow = (s) => {
    const artworks = studentArtworks(s);
    const firstArtwork = artworks[0];
    const detailOpen = state.studentDetailId === s.id;
    const editorOpen = editor?.mode === 'edit' && editor?.student?.id === s.id;
    const resultText = isCurrentStudent(s)
      ? `<span class="student-status-chip">${h(s.enrollmentStatus || '재원중')}</span><span class="student-prep-text">${h(s.preparationStage || '관리중')}</span>`
      : admissionSummaryMarkup(s);
    const artworkCell = firstArtwork
      ? `<button type="button" class="thumb-wrap artwork-open-btn" data-artwork-student="${h(s.id)}" data-open-artwork="${h(firstArtwork.displayUrl || '')}" data-open-artwork-name="학생 그림">${studentArtworkImage(firstArtwork.thumbnailUrl||firstArtwork.displayUrl,'student-thumb','학생 그림',false,firstArtwork.displayUrl)}<span>${artworks.length}장</span></button>`
      : '<div class="student-thumb empty">없음</div>';
    const gradeInfo = grades.gradeOf(s);
    const convertButton = isCurrentStudent(s) && manager && (gradeInfo.grade === 3 || gradeInfo.graduated)
      ? `<button class="btn mini primary" data-convert-student="${s.id}">합격자 데이터로 넘기기</button>`
      : '';
    const deleteButton = manager ? `<button class="btn mini danger" data-delete-student="${s.id}">삭제</button>` : '';
    const gradeCell = gradeInfo.graduated ? `<span class="grade-chip grad">${h(grades.gradeLabel(gradeInfo))}</span>` : gradeInfo.fromYear ? h(grades.gradeLabel(gradeInfo)) : `<span class="grade-chip warn">${h(grades.gradeLabel(gradeInfo))}</span>`;
    const editorDetailRow = editorOpen
      ? `<tr class="student-detail-row editor-row"><td colspan="9">${studentEditorMarkup(editor, editorArtworks, universityOptions, studentTrackOptions)}</td></tr>`
      : '';
    const expandedDetailRow = detailOpen && !editorOpen
      ? `<tr class="student-detail-row"><td colspan="9">${studentFullDetailPanel(s)}</td></tr>`
      : '';
    return `<tr class="student-data-row ${detailOpen?'expanded':''} ${editorOpen?'editing':''}" data-student-row="${s.id}">
      <td>${artworkCell}</td>
      <td><b>${h(s.name)}</b></td>
      <td>${h(studentOverallGrade(s))}</td>
      <td>${skillLevelSelectMarkup(s)}</td>
      <td>${studentDivisionSelectMarkup(s)}</td>
      <td>${studentHopeSelectMarkup(s)}</td>
      <td>${isCurrentStudent(s) ? recommendationChips(s) : resultText}</td>
      <td>${isCurrentStudent(s) ? gradeCell : (s.createdAt ? new Date(s.createdAt).toLocaleDateString('ko-KR') : '-')}</td>
      <td><div class="row-actions">${convertButton}<button class="btn mini" type="button" data-edit-student="${s.id}">수정</button><button class="btn mini primary" type="button" ${editorOpen ? 'data-editor-save' : `data-row-save="${s.id}" ${pendingOf(s.id) ? '' : 'disabled'}`}>저장</button>${deleteButton}</div></td>
    </tr>${editorDetailRow}${expandedDetailRow}`;
  };
  const divisionTabs = ([key,label]) => {
    const c = studentGradeCounts(key);
    const tab = (id,text,count,extra='') => `<button class="${key===division&&activeStudentTab===id?'active':''} ${extra}" type="button" data-student-division="${key}" data-student-tab="${id}">${text} <b>(${count})</b></button>`;
    return `<div class="student-division"><span class="student-division-label">${label}</span><div class="student-type-tabs">${tab('g1','고1',c.g1)}${tab('g2','고2',c.g2)}${tab('g3','고3',c.g3)}${c.unknown ? tab('unknown','학년 미지정',c.unknown) : ''}${tab('result','합격자 데이터',c.result,'final')}</div></div>`;
  };
  replaceArtworkContent($('students'),`<div class="top"><div><h1>학생 관리</h1><p>학년별로 학생을 관리하고, 정보를 입력하면 추천 대학이 바로 나옵니다. 고3은 마지막에 합격자 데이터로 넘깁니다.</p></div></div>
  ${editor?.mode === 'add' ? `<div class="card student-add-card">${studentEditorMarkup(editor, editorArtworks, universityOptions, studentTrackOptions)}</div>` : ''}
  ${state.studentUploadOpen ? studentUploadPanel() : ''}
  <div class="card">
    <div class="student-divisions">${STUDENT_DIVISIONS.map(divisionTabs).join('')}</div>
    ${gradeTab ? `<div class="student-year-note">${grades.schoolYear()}학년도 기준 · 고1 연도로 학년이 매년 3월에 자동으로 올라갑니다${activeStudentTab === 'g3' ? ' · 고3은 마지막에 합격자 데이터로 넘깁니다' : ''}</div>` : ''}
    <div class="student-toolbar">
      <div class="search-box"><input id="studentSearchInput" placeholder="학생명, 전공 계열, 실기능력, 합격 대학 검색" value="${h(state.studentSearch)}"><button class="btn" id="studentSearchBtn">학생 검색</button></div>
      ${gradeTab ? `<button class="btn" id="studentUploadBtn" type="button">엑셀 업로드</button><a class="btn student-template-link" href="${STUDENT_TEMPLATE_URL}" download="${STUDENT_TEMPLATE_NAME}" title="학생 명단 기본 양식(.xlsx) 다운로드"><svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>학생 명단 기본 양식</a>` : ''}
      ${/^g[123]$/.test(activeStudentTab) && window.GradePhotoImport ? '<button class="btn grade-photo-btn" id="studentGradePhotoBtn" type="button">성적표 사진 넣기</button>' : ''}
      <button class="btn primary" id="studentAddBtn">학생 추가</button>
    </div>
    ${activeStudentTab === 'result' ? `<div class="student-filter-bar">
      <div class="field"><label>학년도</label><select id="studentYearFilter"><option value="">전체 연도</option>${yearOptions.map(year=>`<option value="${h(year)}" ${String(yearFilter)===String(year)?'selected':''}>${h(year)}</option>`).join('')}</select></div>
      <div class="field"><label>모집 구분</label><select id="studentRoundFilter"><option value="">전체 구분</option>${roundOptions.map(round=>`<option value="${h(round)}" ${roundFilter===round?'selected':''}>${h(round)}</option>`).join('')}</select></div>
      <button class="btn" id="studentFilterClearBtn" type="button">분류 초기화</button>
    </div>` : ''}
    ${(query || (activeStudentTab === 'result' && (yearFilter || roundFilter))) ? `<div class="search-summary">${query ? `검색어 <b>${h(state.studentSearch)}</b> · ` : ''}${activeStudentTab === 'result' && (yearFilter || roundFilter) ? `분류 <b>${h([yearFilter, roundFilter].filter(Boolean).join(' · '))}</b> · ` : ''}${students.length}명</div>` : ''}
    <div class="student-table-scroll"><table><thead><tr><th>그림</th><th>학생명</th><th>내신</th><th>실기능력</th><th>전공 계열</th><th>희망 계열</th><th>${gradeTab?'추천 대학':'결과'}</th><th>${gradeTab?'학년 (고1 연도)':'등록일'}</th><th>관리</th></tr></thead><tbody>${students.length?students.map(renderStudentRow).join(''):`<tr><td colspan="9" class="muted">${query ? '검색 결과가 없습니다.' : '등록된 학생이 없습니다.'}</td></tr>`}</tbody></table></div>
  </div>
  `);
  document.querySelectorAll('[data-student-tab]').forEach(btn=>btn.onclick=()=>{
    resetStudentView();
    state.studentTypeTab=btn.dataset.studentTab;
    state.studentDivision=btn.dataset.studentDivision;
    renderStudents();
  });
  $('studentSearchBtn').onclick=()=>{syncStudentEditorDraft(); state.studentSearch=$('studentSearchInput').value.trim(); renderStudents();};
  $('studentSearchInput').onkeydown=(e)=>{if(e.key==='Enter')$('studentSearchBtn').click();};
  if($('studentYearFilter')) $('studentYearFilter').onchange=()=>{syncStudentEditorDraft(); state.studentYearFilter=$('studentYearFilter').value; renderStudents();};
  if($('studentRoundFilter')) $('studentRoundFilter').onchange=()=>{syncStudentEditorDraft(); state.studentRoundFilter=$('studentRoundFilter').value; renderStudents();};
  if($('studentFilterClearBtn')) $('studentFilterClearBtn').onclick=()=>{syncStudentEditorDraft(); state.studentYearFilter=''; state.studentRoundFilter=''; renderStudents();};
  if($('studentUploadBtn')) $('studentUploadBtn').onclick=()=>{state.studentUploadOpen=!state.studentUploadOpen; renderStudents();};
  if($('studentGradePhotoBtn')) $('studentGradePhotoBtn').onclick=()=>{
    const grade = activeStudentTab.slice(1);
    window.GradePhotoImport.open({
      divisionLabel: (STUDENT_DIVISIONS.find(([key]) => key === division) || [division, division])[1],
      gradeLabel: `고${grade}`, entryYear: grades.entryYearFor(grade, grades.schoolYear()),
      students: allStudents.filter(inTab),
      onChanged: saved => { replaceStudentInState(saved); scheduleStudentsRender(); },
    });
  };
  if(state.studentUploadOpen) bindStudentUpload();
  $('studentAddBtn').onclick=()=>{state.studentDetailId=null; const tabGrade=/^g([123])$/.exec(activeStudentTab)?.[1]; state.studentEditor={mode:'add',student:{division,studentType:gradeTab?'current':'result',...(tabGrade?{entryYear:grades.entryYearFor(tabGrade,grades.schoolYear())}:{}),name:'',gpa:'',skill:'',skillLevel:'중',track:'웹툰',practiceExperience:'',gradeLevel:'고3',enrollmentStatus:'재원중',preparationStage:'방향 설정',nextConsultationDate:'',targetUniversities:'',consultMemo:'',admissionResults:[],artworkImage:'',artworks:[],termGrades:{},detailedTranscript:[]}}; renderStudents(); requestAnimationFrame(()=>document.querySelector('.student-add-card')?.scrollIntoView({block:'start'}));};
  document.querySelectorAll('[data-student-row]').forEach(row=>row.onclick=(event)=>{
    if(event.target.closest('button,input,select,textarea,label,a')) return;
    syncStudentEditorDraft();
    const id=Number(row.dataset.studentRow);
    state.studentEditor=null;
    state.studentGalleryId=null;
    state.studentGradeId=null;
    state.studentDetailId=state.studentDetailId===id?null:id;
    if(state.studentDetailId !== id) state.studentResultExpandedId=null;
    renderStudents();
  });
  document.querySelectorAll('[data-toggle-student-results]').forEach(btn=>btn.onclick=(event)=>{
    event.stopPropagation();
    const id=Number(btn.dataset.toggleStudentResults);
    state.studentResultExpandedId=state.studentResultExpandedId===id?null:id;
    renderStudents();
  });
  document.querySelectorAll('[data-edit-student]').forEach(btn=>btn.onclick=(event)=>{
    event.stopPropagation();
    const s=state.data.students.find(x=>x.id===Number(btn.dataset.editStudent));
    if(!s) return;
    state.studentDetailId=null;
    state.studentGalleryId=null;
    state.studentGradeId=null;
    state.studentEditor={mode:'edit',student:{...s}};
    renderStudents();
  });
  document.querySelectorAll('[data-convert-student]').forEach(btn=>btn.onclick=async(event)=>{
    event.stopPropagation();
    const s=state.data.students.find(x=>x.id===Number(btn.dataset.convertStudent));
    if(!s || !confirm(`${s.name} 학생을 합격자 데이터로 넘길까요? 넘긴 뒤 합격 대학과 결과를 입력하세요.`)) return;
    let updated;
    try { updated = await window.desktopAPI.updateStudent({ ...s, studentType:'result', enrollmentStatus:'졸업' }); }
    catch(error){ alert(error.message); return; }
    state.data.students = state.data.students.map(item => item.id === updated.id ? updated : item);
    clearComputedCaches();
    resetStudentView();
    state.studentTypeTab='result';
    state.studentEditor={mode:'edit',student:{...updated}};
    state.studentDetailId=null;
    renderStudents();
  });
  document.querySelectorAll('[data-row-field]').forEach(select=>select.onchange=()=>{
    const id = Number(select.dataset.rowStudent), student = state.data.students.find(x=>x.id===id);
    if(!student) return;
    const pending = (state.studentPending ||= {})[id] ||= {};
    pending[select.dataset.rowField] = select.value;
    const row = select.closest('[data-student-row]');
    row?.classList.add('is-dirty');
    const save = row?.querySelector('[data-row-save]');
    if(save) save.disabled = false;
  });
  document.querySelectorAll('[data-row-save]').forEach(btn=>btn.onclick=async(event)=>{
    event.stopPropagation();
    const id = Number(btn.dataset.rowSave), student = state.data.students.find(x=>x.id===id), pending = pendingOf(id);
    if(!student || !pending) return;
    btn.disabled = true;
    try {
      const updated = await window.desktopAPI.updateStudent({ ...student, ...pending });
      state.data.students = state.data.students.map(item => item.id === updated.id ? updated : item);
      delete state.studentPending[id];
      clearComputedCaches();
      renderStudents();
    } catch (error) {
      btn.disabled = false;
      alert(error.message || '저장하지 못했습니다.');
    }
  });
  document.querySelectorAll('[data-delete-student]').forEach(btn=>btn.onclick=(event)=>{event.stopPropagation(); deleteStudentWithConfirm(btn.dataset.deleteStudent);});
  document.querySelectorAll('[data-grade-student]').forEach(btn=>btn.onclick=()=>{syncStudentEditorDraft(); const id=Number(btn.dataset.gradeStudent); state.studentGradeId=state.studentGradeId===id?null:id; renderStudents();});
  document.querySelectorAll('[data-gallery-student]').forEach(btn=>btn.onclick=()=>{syncStudentEditorDraft(); const id=Number(btn.dataset.galleryStudent); state.studentGalleryId=state.studentGalleryId===id?null:id; renderStudents();});
  if(editor){
    document.querySelectorAll('[data-editor-cancel]').forEach(btn=>btn.onclick=()=>{state.studentEditor=null; renderStudents();});
    document.querySelectorAll('[data-editor-save]').forEach(btn=>btn.onclick=saveStudentFromEditor);
    document.querySelectorAll('[data-editor-delete]').forEach(btn=>btn.onclick=()=>deleteStudentWithConfirm(state.studentEditor?.student?.id));
    if($('addHopeTrackBtn')){
      const toggle = open => { $('hopeAddRow').classList.toggle('hidden', !open); if(open) $('hopeAddInput').focus(); };
      $('addHopeTrackBtn').onclick = () => toggle(true);
      $('hopeAddCancel').onclick = () => toggle(false);
      $('hopeAddInput').onkeydown = event => { if(event.key === 'Enter'){ event.preventDefault(); $('hopeAddSave').click(); } };
      $('hopeAddSave').onclick = async () => {
        const label = $('hopeAddInput').value.replace(/\s+/g,' ').trim();
        if(!label) return;
        try {
          const options = await window.desktopAPI.addTrackOption(label);
          state.data._students = { ...(state.data._students || {}), trackOptions: options };
          syncStudentEditorDraft();
          state.studentEditor.student.track = label;
          renderStudents();
        } catch(error){ alert(error.message); }
      };
    }
    if($('editStudentType')) $('editStudentType').onchange=()=>{syncStudentEditorDraft(); renderStudents();};
    bindTermGradeAutoCalc();
    bindDetailedTranscriptEditor();
    $('addAdmissionResultBtn').onclick=()=>{syncStudentEditorDraft(); state.studentEditor.student.admissionResults=[...normalizeAdmissionResults(state.studentEditor.student, true), blankAdmissionResult()]; renderStudents();};
    document.querySelectorAll('[data-remove-admission]').forEach(btn=>btn.onclick=()=>{syncStudentEditorDraft(); const index=Number(btn.dataset.removeAdmission); const rows=normalizeAdmissionResults(state.studentEditor.student, true); rows.splice(index,1); state.studentEditor.student.admissionResults=rows; renderStudents();});
    $('chooseArtworkBtn').onclick=async()=>{syncStudentEditorDraft(); const r=await window.desktopAPI.importStudentArtwork(); if(r.ok){const existing=studentArtworks(state.studentEditor.student); const incoming=Array.isArray(r.files)?r.files:[{path:r.path,url:r.url}].filter(x=>x.path); state.studentEditor.student.artworks=[...existing,...incoming]; state.studentEditor.student.artworkImage=state.studentEditor.student.artworks[0]?.path||''; renderStudents();}};
    document.querySelectorAll('[data-remove-artwork]').forEach(btn=>btn.onclick=()=>{syncStudentEditorDraft(); const index=Number(btn.dataset.removeArtwork); const artworks=studentArtworks(state.studentEditor.student); artworks.splice(index,1); state.studentEditor.student.artworks=artworks; state.studentEditor.student.artworkImage=artworks[0]?.path||''; renderStudents();});
  }
  bindArtworkViewer();
}

async function deleteStudentWithConfirm(id){
  const s = state.data.students.find(x => x.id === Number(id));
  if(!s || !confirm(`${s.name} 학생 정보를 삭제할까요?`)) return;
  try { await window.desktopAPI.deleteStudent(s.id); } catch(error){ alert(error.message); return; }
  setStateData(await window.desktopAPI.getAll());
  resetStudentView();
  renderStudents();
}
function bindStudentUpload(){
  let rows = [];
  const preview = $('studentUploadPreview');
  $('studentUploadCancel').onclick = () => { state.studentUploadOpen = false; renderStudents(); };
  const describe = () => {
    const grade = $('studentUploadGrade').value, year = Number($('studentUploadYear').value);
    preview.textContent = rows.length ? `${rows.length}명을 ${year}년 고${grade}로 올립니다. 해마다 3월에 학년이 자동으로 올라갑니다.` : '';
    $('studentUploadSave').disabled = !rows.length || !Number.isInteger(year) || year < 2000 || year > 2100;
  };
  $('studentUploadGrade').onchange = describe;
  $('studentUploadYear').oninput = describe;
  $('studentUploadFile').onchange = async () => {
    rows = [];
    const file = $('studentUploadFile').files?.[0];
    if(!file) return describe();
    try { rows = await window.AdmissionsStudentGrades.readStudentFile(file); if(!rows.length) preview.textContent = '올릴 학생이 없습니다. 첫 줄에 "이름" 칸이 있는지 확인하세요.'; else describe(); }
    catch(error){ preview.textContent = error.message; $('studentUploadSave').disabled = true; }
  };
  $('studentUploadSave').onclick = async () => {
    const grade = Number($('studentUploadGrade').value), year = Number($('studentUploadYear').value);
    const entryYear = window.AdmissionsStudentGrades.entryYearFor(grade, year);
    $('studentUploadSave').disabled = true;
    try {
      for(let i = 0; i < rows.length; i += 500){
        await window.desktopAPI.addStudents(rows.slice(i, i + 500).map(row => ({ skillLevel: '중', enrollmentStatus: '재원중', preparationStage: '방향 설정', ...row, studentType: 'current', gradeLevel: `고${grade}`, entryYear, division: $('studentUploadDivision').value })));
      }
      setStateData(await window.desktopAPI.getAll());
      resetStudentView();
      state.studentDivision = $('studentUploadDivision')?.value || state.studentDivision;
      state.studentTypeTab = `g${window.AdmissionsStudentGrades.gradeOf({ entryYear }).grade}`;
      renderStudents();
    } catch(error){ preview.textContent = error.message; $('studentUploadSave').disabled = false; }
  };
}

async function saveStudentFromEditor(){
  const editor = state.studentEditor;
  if(!editor) return;
  const name=$('editStudentName').value.trim();
  if(!name){ alert('학생명을 입력하세요.'); return; }
  const artworks = studentArtworks(editor.student);
  const admissionResults = readAdmissionResultsFromEditor();
  const firstAdmission = admissionResults[0] || {};
  const studentTypeValue = $('editStudentType')?.value || editor.student.studentType || (state.studentTypeTab === 'result' ? 'result' : 'current');
  const entryYear = studentTypeValue === 'current' ? entryYearFromEditor() : (editor.student.entryYear ?? null);
  const division = $('editStudentDivision')?.value || studentDivision(editor.student);
  const student={...editor.student,division,entryYear,studentType:studentTypeValue,name,gpa:parseFloat($('editStudentGpa').value||'0'),skillLevel:$('editStudentSkillLevel').value,track:$('editStudentTrack')?.value || '',practiceExperience:$('editStudentPracticeExperience').value.trim(),gradeLevel:$('editStudentGradeLevel')?.value || '',enrollmentStatus:$('editStudentEnrollmentStatus')?.value || '',preparationStage:$('editStudentPreparationStage')?.value || '',nextConsultationDate:$('editStudentNextConsultationDate')?.value || '',targetUniversities:$('editStudentTargetUniversities')?.value?.trim() || '',consultMemo:$('editStudentConsultMemo')?.value?.trim() || '',admissionResults,admissionResult:firstAdmission.result||'미정',admissionUniversity:firstAdmission.universityName||'',admissionCompetition:firstAdmission.competition||'',admissionYear:firstAdmission.year||'',admissionRound:firstAdmission.round||'',artworks,artworkImage:artworks[0]?.path||'',termGrades:readTermGradesFromEditor(),detailedTranscript:readDetailedTranscriptFromEditor()};
  delete student._gradeYear;
  if(student.entryYear === null) delete student.entryYear;
  try {
    if(editor.mode==='edit') await window.desktopAPI.updateStudent({...student,id:editor.student.id});
    else await window.desktopAPI.addStudent(student);
  } catch(error){ alert(error.message); return; }
  setStateData(await window.desktopAPI.getAll());
  resetStudentView();
  const savedGrade = window.AdmissionsStudentGrades.gradeOf(student).grade;
  state.studentDivision = studentDivision(student);
  state.studentTypeTab = studentTypeValue === 'result' ? 'result' : savedGrade ? `g${savedGrade}` : 'unknown';
  renderStudents();
  $('students')?.querySelector('.student-divisions')?.scrollIntoView({ block: 'start' });
}
function renderCases(){
  const query = state.caseSearch.trim().toLowerCase();
  const reserveFilter = state.caseReserveFilter || '';
  const hasCaseSearch = query.length > 0;
  const isReserveCase = (c) => /예비/.test(`${c.resultNote || ''} ${c.originalResult || ''}`);
  const rows = hasCaseSearch
    ? caseRowsFromStudents()
      .filter(c => caseSearchMatches(c, state.caseSearch))
      .filter(c => {
        if(reserveFilter === 'direct') return c.result === '합격' && !isReserveCase(c);
        if(reserveFilter === 'reserve') return c.result === '합격' && isReserveCase(c);
        if(reserveFilter === 'fail') return c.result === '불합격';
        return true;
      })
    : [];
  const accepted = rows.filter(c => c.result === '합격');
  const rejected = window.AdmissionsCounselingUx.rejectedOrder(rows.filter(c => c.result === '불합격'));
  const passPage = window.AdmissionsCounselingUx.casePage(accepted, casePages.pass);
  const failPage = window.AdmissionsCounselingUx.casePage(rejected, casePages.fail);
  casePages = { pass: passPage.page, fail: failPage.page };
  const pagination = (key, page, label) => `<nav class="case-pagination" aria-label="${label} 페이지"><button class="btn" data-case-page="${key}" data-step="-1" aria-label="${label} 이전" ${page.page===1?'disabled':''}><svg width="20" height="20" aria-hidden="true"><use href="/data-core/assets/core-icons.svg#ArrowLeft"></use></svg></button><span>${page.page} / ${page.total}</span><button class="btn" data-case-page="${key}" data-step="1" aria-label="${label} 다음" ${page.page===page.total?'disabled':''}><svg width="20" height="20" aria-hidden="true"><use href="/data-core/assets/core-icons.svg#ArrowLeft"></use></svg></button></nav>`;
  const renderCaseCard = (c) => {
    const detail = state.caseDetail && state.caseDetail.caseId === String(c.id) ? state.caseDetail.type : null;
    const universityName = c.universityName || c.university?.name || '-';
    const major = c.major || c.university?.major || '-';
    const period = admissionPeriodLabel({ year: c.admissionYear, round: c.admissionRound });
    return `<article class="case-compare-card"><div><b>${h(c.anonymousId)}</b><span class="${c.result==='합격'?'pass-label':'fail-label'}">${h(admissionResultLabel(c))}</span></div><p>${h(universityName)} · ${h(major)}${period?` · ${h(period)}`:''}</p><dl><dt>내신</dt><dd>${h(caseGradeDisplay(c))}</dd><dt>실기능력</dt><dd><span class="skill-pill">${h(caseSkillDisplay(c))}</span></dd><dt>경쟁률</dt><dd>${h(c.competition || '-')}</dd><dt>실기경력</dt><dd>${h(casePracticeExperience(c))}</dd></dl><div class="case-actions"><button class="btn mini" data-case-grade="${h(c.id)}">학년/학기 성적 확인</button><button class="btn mini" data-case-artwork="${h(c.id)}">그림 확인</button></div>${detail==='grades'?caseGradeTable(c):''}${detail==='artwork'?caseArtworkPanel(c):''}${c.memo?`<div class="case-note">${h(c.memo)}</div>`:''}</article>`;
  };
  $('cases').innerHTML=`<div class="top"><div><h1>합격·불합격 사례</h1><p>학생 ID, 대학, 학과, 결과, 메모로 검색하고 합격/불합격 사례를 나누어 비교합니다.</p></div></div>
  <div class="card">
    <div class="student-toolbar case-toolbar"><div class="search-box"><input id="caseSearchInput" placeholder="학생 ID, 대학명, 학과, 결과 검색" value="${h(state.caseSearch)}"><button class="btn" id="caseSearchBtn">학생 검색</button></div><div class="case-filter-group"><select id="caseReserveFilter"><option value="" ${!reserveFilter?'selected':''}>전체 결과</option><option value="direct" ${reserveFilter==='direct'?'selected':''}>일반 합격</option><option value="reserve" ${reserveFilter==='reserve'?'selected':''}>예비합격</option><option value="fail" ${reserveFilter==='fail'?'selected':''}>불합격</option></select><button class="btn" id="caseClearBtn">검색 초기화</button></div></div>
    ${hasCaseSearch ? `<div class="search-summary">검색어 <b>${h(state.caseSearch)}</b>${reserveFilter ? ` · <b>${h({direct:'일반 합격',reserve:'예비합격',fail:'불합격'}[reserveFilter])}</b>` : ''}</div>` : '<div class="empty-box case-search-empty">검색창에 학생명, 대학명, 학과명, 결과를 입력한 뒤 학생 검색을 누르면 합격·불합격 사례가 표시됩니다.</div>'}
    ${hasCaseSearch ? `<div class="case-split">
      <section data-case-column="pass"><div class="case-column-head pass"><h2>합격 사례</h2></div>${accepted.length?passPage.rows.map(renderCaseCard).join('')+pagination('pass',passPage,'합격 사례'):'<div class="empty-box">합격 사례가 없습니다.</div>'}</section>
      <section data-case-column="fail"><div class="case-column-head fail"><h2>불합격 사례</h2></div>${rejected.length?failPage.rows.map(renderCaseCard).join('')+pagination('fail',failPage,'불합격 사례'):'<div class="empty-box">불합격 사례가 없습니다.</div>'}</section>
    </div>` : ''}
  </div>`;
  document.querySelectorAll('[data-case-page]').forEach(button=>button.onclick=()=>{casePages[button.dataset.casePage]+=Number(button.dataset.step);state.caseDetail=null;renderCases();});
  $('caseSearchBtn').onclick=()=>{state.caseSearch=$('caseSearchInput').value.trim();casePages={pass:1,fail:1};state.caseDetail=null;renderCases();};
  $('caseSearchInput').onkeydown=(e)=>{if(e.key==='Enter')$('caseSearchBtn').click();};
  $('caseReserveFilter').onchange=()=>{state.caseReserveFilter=$('caseReserveFilter').value; casePages={pass:1,fail:1}; state.caseDetail=null; renderCases();};
  $('caseClearBtn').onclick=()=>{state.caseSearch=''; state.caseReserveFilter=''; casePages={pass:1,fail:1}; state.caseDetail=null; renderCases();};
  document.querySelectorAll('[data-case-grade]').forEach(btn=>btn.onclick=()=>{const id=btn.dataset.caseGrade; state.caseDetail=state.caseDetail?.caseId===id&&state.caseDetail?.type==='grades'?null:{caseId:id,type:'grades'}; renderCases();});
  document.querySelectorAll('[data-case-artwork]').forEach(btn=>btn.onclick=()=>{const id=btn.dataset.caseArtwork; state.caseDetail=state.caseDetail?.caseId===id&&state.caseDetail?.type==='artwork'?null:{caseId:id,type:'artwork'}; renderCases();});
  bindArtworkViewer();
}

function defaultQualificationExamConversionTable(){
  return [
    { min: 97, max: 100, studentRecordScore: 958.3333, practicalScore: 383.3333 },
    { min: 94, max: 96.99, studentRecordScore: 916.6666, practicalScore: 366.6666 },
    { min: 89, max: 93.99, studentRecordScore: 874.9999, practicalScore: 349.9999 },
    { min: 83, max: 88.99, studentRecordScore: 833.3333, practicalScore: 333.3333 },
    { min: 75, max: 82.99, studentRecordScore: 791.6666, practicalScore: 316.6666 },
    { min: 68, max: 74.99, studentRecordScore: 749.9999, practicalScore: 299.9999 },
    { min: 63, max: 67.99, studentRecordScore: 708.3332, practicalScore: 283.3332 },
    { min: 0, max: 62.99, studentRecordScore: 666.6666, practicalScore: 266.6666 }
  ];
}

function blankGradeRule(university){
  return {
    admissionYear: university?.year || 2027,
    universityId: university?.id || null,
    departmentId: null,
    admissionTypeId: null,
    ruleName: `예시 ${university?.name || '대학'} 환산 규칙`,
    calculationType: 'RULE_BASED_GRADE',
    calculationBasis: 'GRADE',
    maxScore: university?.gradeMaxScore || 400,
    baseScore: 0,
    active: true,
    source: '예시 자료 - 실제 모집요강 아님',
    sourcePage: '',
    verifiedAt: '',
    verificationStatus: 'DRAFT',
    notes: '실제 규칙은 공식 모집요강 확인 후 입력하세요.',
    includedSemesters: [{ year:1, semester:1 }, { year:1, semester:2 }, { year:2, semester:1 }, { year:2, semester:2 }, { year:3, semester:1 }],
    subjectGroups: ['KOREAN', 'ENGLISH', 'MATH', 'SOCIAL', 'SCIENCE'],
    selectionType: 'ALL',
    selectionCount: 0,
    creditWeighting: 'NONE',
    yearWeights: {},
    subjectGroupWeights: {},
    gradeConversionTable: { "1": 100, "2": 98, "3": 95, "4": 90, "5": 83, "6": 75, "7": 65, "8": 50, "9": 30 },
    qualificationExamConversionTable: defaultQualificationExamConversionTable(),
    achievementConversionTable: { A: 100, B: 95, C: 90 },
    roundingMethod: 'ROUND',
    decimalPlaces: 2
  };
}
function renderGradeRuleEditor(university){
  const rule = conversionRuleForUniversity(university) || blankGradeRule(university);
  const normalized = RuleInterpreter.normalizeRule(rule);
  const qualificationRows = Array.isArray(normalized.qualificationExamConversionTable) && normalized.qualificationExamConversionTable.length
    ? normalized.qualificationExamConversionTable
    : defaultQualificationExamConversionTable();
  const semesterChecked = (year, semester) => (normalized.includedSemesters || []).some(item => Number(item.year) === year && Number(item.semester) === semester);
  const groupOptions = [
    ['KOREAN','국어'], ['ENGLISH','영어'], ['MATH','수학'], ['SOCIAL','사회'], ['SCIENCE','과학'], ['ART','예술'], ['ETC','기타'], ['ALL','전 교과']
  ];
  return `<section class="rule-editor-panel">
    <h3 class="admin-subtitle">성적 환산 규칙 <span class="badge fit">예시 규칙 포함</span></h3>
    <input type="hidden" id="ruleId" value="${h(normalized.id || '')}">
    <div class="admin-grid">
      <div class="field"><label>규칙명</label><input id="ruleName" value="${h(normalized.ruleName)}"></div>
      <div class="field"><label>학년도</label><input id="ruleYear" type="number" value="${h(normalized.admissionYear)}"></div>
      <div class="field"><label>학생부 만점</label><input id="ruleMaxScore" type="number" value="${h(normalized.maxScore)}"></div>
      <div class="field"><label>기본점수</label><input id="ruleBaseScore" type="number" value="${h(normalized.baseScore)}"></div>
      <div class="field"><label>과목 선택방식</label><select id="ruleSelectionType"><option value="ALL" ${normalized.selectionType==='ALL'?'selected':''}>전체 과목 반영</option><option value="TOP_N" ${normalized.selectionType==='TOP_N'?'selected':''}>상위 과목만 반영</option><option value="TOP_N_PER_GROUP" ${normalized.selectionType==='TOP_N_PER_GROUP'?'selected':''}>교과별 상위 과목 반영</option><option value="TOP_N_PER_SEMESTER" ${normalized.selectionType==='TOP_N_PER_SEMESTER'?'selected':''}>학기별 상위 과목 반영</option><option value="BEST_GRADE" ${normalized.selectionType==='BEST_GRADE'?'selected':''}>최고 등급 과목 반영</option></select></div>
      <div class="field"><label>반영과목 수</label><input id="ruleSelectionCount" type="number" value="${h(normalized.selectionCount || 0)}"></div>
      <div class="field"><label>이수단위 반영</label><select id="ruleCreditWeighting"><option value="NONE" ${normalized.creditWeighting==='NONE'?'selected':''}>이수단위 미반영</option><option value="WEIGHTED" ${normalized.creditWeighting==='WEIGHTED'?'selected':''}>이수단위 반영</option></select></div>
      <div class="field"><label>검증 상태</label><select id="ruleStatus"><option value="DRAFT" ${normalized.verificationStatus==='DRAFT'?'selected':''}>검토 전</option><option value="VERIFIED" ${normalized.verificationStatus==='VERIFIED'?'selected':''}>검증 완료</option><option value="CHANGED" ${normalized.verificationStatus==='CHANGED'?'selected':''}>변경 확인 필요</option></select></div>
      <div class="field"><label>소수점 처리</label><select id="ruleRounding"><option value="ROUND" ${normalized.roundingMethod==='ROUND'?'selected':''}>반올림</option><option value="FLOOR" ${normalized.roundingMethod==='FLOOR'?'selected':''}>버림</option><option value="CEIL" ${normalized.roundingMethod==='CEIL'?'selected':''}>올림</option><option value="NONE" ${normalized.roundingMethod==='NONE'?'selected':''}>처리 안 함</option></select></div>
      <div class="field"><label>소수점 자리</label><input id="ruleDecimalPlaces" type="number" value="${h(normalized.decimalPlaces)}"></div>
      <div class="field"><label>검증일</label><input id="ruleVerifiedAt" type="date" value="${h(normalized.verifiedAt || '')}"></div>
    </div>
    <h4>반영 학기</h4>
    <div class="rule-chip-grid">${termRows().map(row=>`<label><input type="checkbox" data-rule-semester="${row.gradeKey}_${row.semesterKey}" ${semesterChecked(Number(row.gradeKey.replace('grade','')), Number(row.semesterKey.replace('semester',''))) ? 'checked' : ''}> ${row.gradeLabel} ${row.semesterLabel}</label>`).join('')}</div>
    <h4>반영 교과</h4>
    <div class="rule-chip-grid">${groupOptions.map(([key,label])=>`<label><input type="checkbox" data-rule-group="${key}" ${(normalized.subjectGroups || []).includes(key) ? 'checked' : ''}> ${label}</label>`).join('')}</div>
    <h4>학년별 가중치</h4>
    <div class="subject-admin-grid"><div class="field"><label>1학년</label><input id="ruleYearWeight1" type="number" step="0.01" value="${h(normalized.yearWeights?.['1'] || '')}"></div><div class="field"><label>2학년</label><input id="ruleYearWeight2" type="number" step="0.01" value="${h(normalized.yearWeights?.['2'] || '')}"></div><div class="field"><label>3학년</label><input id="ruleYearWeight3" type="number" step="0.01" value="${h(normalized.yearWeights?.['3'] || '')}"></div></div>
    <h4>등급별 환산표</h4>
    <div class="grade-conversion-grid">${Array.from({length:9},(_,i)=>i+1).map(grade=>`<div class="field"><label>${grade}등급</label><input id="ruleGrade${grade}" type="number" step="0.01" value="${h(normalized.gradeConversionTable?.[String(grade)] ?? '')}"></div>`).join('')}</div>
    <h4>검정고시 환산표</h4>
    <div class="qualification-conversion-grid">
      <div class="qualification-head">평균 최저</div><div class="qualification-head">평균 최고</div><div class="qualification-head">학생부 환산점수</div><div class="qualification-head">실기전형 환산점수</div>
      ${qualificationRows.map((row, index)=>`<div class="field"><input id="gedMin${index}" type="number" step="0.01" value="${h(row.min ?? '')}"></div><div class="field"><input id="gedMax${index}" type="number" step="0.01" value="${h(row.max ?? '')}"></div><div class="field"><input id="gedStudentScore${index}" type="number" step="0.0001" value="${h(row.studentRecordScore ?? row.student_record_score ?? row.score ?? '')}"></div><div class="field"><input id="gedPracticalScore${index}" type="number" step="0.0001" value="${h(row.practicalScore ?? row.practical_score ?? '')}"></div>`).join('')}
    </div>
    <div class="notice">검정고시 학생은 고교유형이 검정고시로 들어온 경우 이 표를 우선 적용할 수 있습니다. 예시값은 모집요강 확인 후 대학별로 조정하세요.</div>
    <button class="btn primary" id="saveGradeRuleBtn" type="button">환산 규칙 저장</button>
  </section>`;
}

function renderRuleTemplateCopyPanel(current, list){
  const targets = list.filter(university => Number(university.id) !== Number(current?.id));
  return `<section class="rule-copy-panel">
    <div><h3 class="admin-subtitle">동일 요강 빠른 적용</h3><p class="muted">현재 대학의 반영비율, 반영과목, 기준성적, 환산 규칙을 검색 결과의 다른 학과에도 복사합니다.</p></div>
    <button class="btn" id="applyRuleTemplateBtn" type="button" ${targets.length ? '' : 'disabled'}>검색 결과 ${targets.length}개에 현재 환산식 적용</button>
  </section>`;
}
async function saveGradeRuleFromAdmin(){
  const university = state.adminMode === 'add' ? null : uni(state.selectedUniversityId);
  if(!university){ alert('먼저 대학 정보를 저장한 뒤 환산 규칙을 등록하세요.'); return; }
  const includedSemesters = Array.from(document.querySelectorAll('[data-rule-semester]:checked')).map(input => {
    const [gradeKey, semesterKey] = input.dataset.ruleSemester.split('_');
    return { year: Number(gradeKey.replace('grade','')), semester: Number(semesterKey.replace('semester','')) };
  });
  const subjectGroups = Array.from(document.querySelectorAll('[data-rule-group]:checked')).map(input => input.dataset.ruleGroup);
  const gradeConversionTable = {};
  Array.from({length:9},(_,i)=>i+1).forEach(grade => gradeConversionTable[String(grade)] = num(`ruleGrade${grade}`));
  const qualificationExamConversionTable = Array.from(document.querySelectorAll('[id^="gedMin"]')).map((_, index) => ({
    min: num(`gedMin${index}`),
    max: num(`gedMax${index}`),
    studentRecordScore: num(`gedStudentScore${index}`),
    practicalScore: num(`gedPracticalScore${index}`)
  })).filter(row => Number.isFinite(Number(row.min)) && Number.isFinite(Number(row.max)));
  const yearWeights = {};
  if($('ruleYearWeight1').value) yearWeights['1'] = num('ruleYearWeight1');
  if($('ruleYearWeight2').value) yearWeights['2'] = num('ruleYearWeight2');
  if($('ruleYearWeight3').value) yearWeights['3'] = num('ruleYearWeight3');
  const payload = {
    ...(conversionRuleForUniversity(university) || {}),
    id: $('ruleId').value ? Number($('ruleId').value) : undefined,
    admissionYear: num('ruleYear', university.year),
    universityId: university.id,
    ruleName: $('ruleName').value.trim(),
    calculationType: 'RULE_BASED_GRADE',
    calculationBasis: 'GRADE',
    maxScore: num('ruleMaxScore', 400),
    baseScore: num('ruleBaseScore', 0),
    active: true,
    source: conversionRuleForUniversity(university)?.source || '',
    sourcePage: conversionRuleForUniversity(university)?.sourcePage || '',
    verifiedAt: $('ruleVerifiedAt').value,
    verificationStatus: $('ruleStatus').value,
    notes: conversionRuleForUniversity(university)?.notes || '',
    includedSemesters,
    subjectGroups,
    selectionType: $('ruleSelectionType').value,
    selectionCount: num('ruleSelectionCount', 0),
    creditWeighting: $('ruleCreditWeighting').value,
    yearWeights,
    subjectGroupWeights: {},
    gradeConversionTable,
    qualificationExamConversionTable,
    achievementConversionTable: { A: 100, B: 95, C: 90 },
    roundingMethod: $('ruleRounding').value,
    decimalPlaces: num('ruleDecimalPlaces', 2)
  };
  await window.desktopAPI.saveGradeRule(payload);
  setStateData(await window.desktopAPI.getAll());
  renderAdmin();
}

function renderPdfWizardPanel(){
  const result = state.pdfAnalysis;
  return `<section class="pdf-analysis-panel">
    <div class="editor-section-head">
      <div><h3 class="admin-subtitle">입시요강 이미지 분석</h3><p class="muted">환산표, 반영비율, 반영과목이 보이는 입시요강 이미지를 업로드하면 입력 후보를 만듭니다.</p></div>
      <button class="btn" id="analyzeAdmissionImageBtn" type="button">입시요강 이미지 선택</button>
    </div>
    ${result ? `<div class="pdf-result">
      <div class="grade-summary">
        <div><span>파일</span><b>${h(result.fileName)}</b></div>
        <div><span>이미지</span><b>${h(result.files?.length || (result.imageUrl ? 1 : 0))}장</b></div>
        <div><span>읽은 글자 수</span><b>${h(result.textLength || 0)}</b></div>
        <div><span>상태</span><b>적용 전 미리보기</b></div>
      </div>
      ${result.files?.length ? `<div class="admission-image-grid">${result.files.map(file=>`<div class="admission-image-preview"><img src="${h(file.imageUrl)}" alt="${h(file.fileName)}"><span>${h(file.fileName)}</span></div>`).join('')}</div>` : result.imageUrl ? `<div class="admission-image-preview"><img src="${h(result.imageUrl)}" alt="${h(result.fileName)}"><span>${h(result.fileName)}</span></div>` : ''}
      ${result.warnings?.length ? `<div class="notice warning">${result.warnings.map(h).join('<br>')}</div>` : ''}
      <article class="pdf-candidate-card">
          <div class="pdf-candidate-head"><div><b>분석 결과 후보</b><span>아래 내용을 확인한 뒤 현재 대학정보에 적용하세요.</span></div><button class="btn primary mini" data-apply-pdf-candidate="0" type="button">현재 대학정보에 적용</button></div>
          <div class="grade-summary compact-summary">
            <div><span>학생부/실기</span><b>${h(result.university?.gradeRatio || '-')}% / ${h(result.university?.skillRatio || '-')}%</b></div>
            <div><span>반영 과목</span><b>${h(result.university?.subjects || '-')}</b></div>
            <div><span>환산 방식</span><b>${h(ruleSelectionLabel(result.gradeRule?.selectionType))} ${result.gradeRule?.selectionCount ? `${h(result.gradeRule.selectionCount)}과목` : ''}</b></div>
            <div><span>학생부 만점/기본점수</span><b>${h(result.gradeRule?.maxScore || '-')} / ${h(result.gradeRule?.baseScore || 0)}</b></div>
          </div>
          ${result.gradeRule?.gradeConversionTable ? `<div class="pdf-grade-table">${Array.from({length:9},(_,i)=>i+1).map(grade=>`<div><span>${grade}등급</span><b>${h(result.gradeRule.gradeConversionTable[String(grade)] ?? '-')}</b></div>`).join('')}</div>` : ''}
          <div class="field full"><label>이미지에서 읽은 내용</label><textarea class="pdf-preview" readonly>${h(result.preview || result.ocrText || '')}</textarea></div>
      </article>
    </div>` : `<div class="notice">필요한 입시요강 페이지를 이미지로 캡처해 업로드하세요. 분석 결과는 바로 저장되지 않고, 확인 후 적용 버튼을 눌러야 수정란에 들어갑니다.</div>`}
  </section>`;
}

function setInputValue(id, value, overwriteEmpty=true){
  const input = $(id);
  if(!input || value === undefined || value === null || value === '') return;
  if(!overwriteEmpty && input.value) return;
  input.value = value;
}

function applyPdfSourceToAdmin(source, candidate = {}){
  const university = source.university || {};
  const rule = source.gradeRule || {};
  if(candidate?.department) setInputValue('aMajor', candidate.department, false);
  if(candidate?.detectedDepartment) setInputValue('aMajor', candidate.detectedDepartment, false);
  if(candidate?.admissionType) setInputValue('aAdmission', candidate.admissionType, false);
  if(candidate?.detectedAdmissionType) setInputValue('aAdmission', candidate.detectedAdmissionType, false);
  setInputValue('aYear', university.year);
  setInputValue('aGrade', university.gradeRatio);
  setInputValue('aSkill', university.skillRatio);
  setInputValue('aSubjects', university.subjects);
  setInputValue('aRate', university.rateCurrent);
  if(university.requiredScores){
    setInputValue('reqKorean', university.requiredScores.korean);
    setInputValue('reqEnglish', university.requiredScores.english);
    setInputValue('reqMath', university.requiredScores.math);
    setInputValue('reqSocial', university.requiredScores.social);
    setInputValue('reqScience', university.requiredScores.science);
  }
  setInputValue('ruleName', rule.ruleName);
  setInputValue('ruleYear', rule.admissionYear);
  setInputValue('ruleMaxScore', rule.maxScore);
  setInputValue('ruleBaseScore', rule.baseScore);
  setInputValue('ruleSource', rule.source);
  setInputValue('ruleSourcePage', rule.sourcePage);
  setInputValue('ruleStatus', rule.verificationStatus);
  setInputValue('ruleSelectionType', rule.selectionType);
  setInputValue('ruleSelectionCount', rule.selectionCount || 0);
  if(Array.isArray(rule.subjectGroups)){
    document.querySelectorAll('[data-rule-group]').forEach(input => {
      input.checked = rule.subjectGroups.includes(input.dataset.ruleGroup);
    });
  }
  if(rule.gradeConversionTable){
    Array.from({length:9},(_,i)=>i+1).forEach(grade => {
      setInputValue(`ruleGrade${grade}`, rule.gradeConversionTable[String(grade)]);
    });
  }
  if($('ruleNotes')){
    const note = rule.notes || '이미지 자동 분석 후보값입니다. 공식 모집요강 원문과 대조한 뒤 저장하세요.';
    $('ruleNotes').value = $('ruleNotes').value ? `${$('ruleNotes').value} / ${note}` : note;
  }
  alert('이미지 분석 후보값을 화면에 적용했습니다. 원문 확인 후 저장하세요.');
}

function applyPdfAnalysisToAdmin(candidateIndex){
  const result = state.pdfAnalysis;
  if(!result){ alert('먼저 이미지를 분석하세요.'); return; }
  const candidate = Array.isArray(result.candidates) ? result.candidates[Number(candidateIndex)] : null;
  const source = candidate?.analysis || result;
  applyPdfSourceToAdmin(source, candidate || {});
}

function applyPdfMatchToAdmin(matchIndex){
  const result = state.pdfAnalysis;
  const match = Array.isArray(result?.matches) ? result.matches[Number(matchIndex)] : null;
  if(!match){ alert('적용할 이미지 분석 후보를 찾을 수 없습니다.'); return; }
  state.adminMode = 'edit';
  state.adminEditing = true;
  state.selectedUniversityId = Number(match.universityId);
  state.adminDraft = null;
  renderAdmin();
  requestAnimationFrame(() => applyPdfSourceToAdmin(match.analysis || {}, match));
}

function renderAdmin(){
  const hiddenIds = new Set((state.data._universityManagementDeletedIds || []).map(String));
  const allUniversities = state.adminShowArchived ? sortedUniversities().filter(u=>hiddenIds.has(String(u.id))) : sortedUniversities({management:true});
  if (state.adminMode !== 'add' && !allUniversities.some(u=>String(u.id)===String(state.selectedUniversityId))) state.selectedUniversityId = allUniversities[0]?.id ?? null;
  const adminQuery = String(state.adminSearch || '').trim().toLowerCase();
  const adminTrackQuery = state.adminTrackSearch || '';
  const adminTrackOptions = trackOptionsMarkup(adminTrackQuery, true);
  const list = allUniversities.filter(u => {
    const textMatched = !adminQuery || [u.name, u.region, u.major, u.admission, u.year, u.subjects].some(v => String(v || '').toLowerCase().includes(adminQuery));
    const trackMatched = !adminTrackQuery || universityMatchesTrack(u, adminTrackQuery);
    return textMatched && trackMatched;
  });
  const baseCurrent = state.adminMode === 'add' ? blankUniversity() : (allUniversities.find(u=>String(u.id)===String(state.selectedUniversityId)) || allUniversities[0] || blankUniversity());
  const current = state.adminDraft && state.adminDraft.mode === state.adminMode && String(state.adminDraft.id || '') === String(baseCurrent.id || 'add')
    ? { ...baseCurrent, ...state.adminDraft.university }
    : baseCurrent;
  const editorLocked = state.adminMode === 'edit' && !state.adminEditing;
  const checkedComplete = isUniversityChecked(current);
  const required = current.requiredScores || {};
  const officialStats = window.OfficialAdmissionEvidence.statsFor(state.data,current);
  const stats = officialStats || current.acceptedStats || {};
  $('admin').innerHTML=`<div class="top"><div><h1>대학 데이터 관리</h1><p>ㄱ~ㅎ 순서 대학 목록에서 입시요강과 합격 기준 데이터를 쉽게 확인하고 편집합니다.</p></div><div class="actions"><button class="btn" id="newUniBtn">새 대학 추가</button></div></div>
  ${window.AdmissionUniversityScope.markup(state.data,state.adminShowArchived)}
  <div class="admin-layout">
    <aside class="card university-list"><h2>대학 목록 ㄱ~ㅎ</h2><div class="search-box admin-search-box"><input id="adminSearchInput" placeholder="대학명, 지역, 학과, 전형명 검색" value="${h(state.adminSearch)}"><button class="btn" id="adminSearchBtn">검색</button></div><div class="admin-track-filter"><div class="field"><label>전공 계열 검색</label><select id="adminTrackSearchInput">${adminTrackOptions}</select></div><div class="admin-track-actions"><button class="btn primary" id="checkFilteredUniversitiesBtn" type="button">검색 결과 전체 최신입시요강 체크완료</button><button class="btn danger" id="uncheckFilteredUniversitiesBtn" type="button">검색 결과 전체 체크해제</button></div></div>${(adminQuery || adminTrackQuery) ? `<div class="search-summary">검색 결과 ${list.length}개${adminTrackQuery ? ` · 전공 계열 ${h(adminTrackQuery)}` : ''}</div>` : ''}<div class="university-list-scroll">${list.length ? list.map(u=>{const isChecked=isUniversityChecked(u); return `<button class="${state.adminMode==='edit'&&u.id===current.id?'selected':''}" data-admin-uni="${u.id}"><b>${universityNameMarkup(u)}<span class="admin-card-badges">${collegeTypeBadge(u)}${isChecked?'<em class="latest-admission-badge">최신입시요강 체크완료</em>':''}</span></b><span>${h(u.major)}</span><small>${h(u.admission || '')}</small></button>`}).join('') : '<div class="empty-box">검색 결과가 없습니다.</div>'}</div></aside>
    <section class="card admin-editor-panel">
      <div class="admin-editor-head"><h2>${state.adminMode==='add'?'새 대학 입력':'대학 정보 수정'}</h2><div class="actions admin-head-actions"><input type="hidden" id="aCheckedComplete" value="${checkedComplete?'true':'false'}"><button class="btn admission-image-save-btn" id="saveAdmissionImagesBtn" type="button" ${state.adminMode==='edit'&&current?.id?'':'disabled'}>입시요강 이미지 저장</button><button class="btn admission-image-view-btn" id="viewAdmissionImagesBtn" type="button" ${state.adminMode==='edit'&&current?.id?'':'disabled'}>입시요강 이미지 보기${current.admissionImages?.length ? ` (${current.admissionImages.length})` : ''}</button><button class="btn check-complete-btn ${checkedComplete?'active':''}" id="checkCompleteBtn" type="button">최신입시요강 체크완료</button><button class="btn uncheck-complete-btn" id="uncheckCompleteBtn" type="button">체크해제</button><button class="btn" id="editUniBtn" type="button">${editorLocked?'편집':'편집 중'}</button><button class="btn primary" id="saveUni" type="button" ${editorLocked?'disabled':''}>저장</button><button class="btn danger" id="deleteUniBtn" type="button" ${state.adminMode==='edit'&&current?.id?'':'disabled'}>목록에서 숨기기</button></div></div>
      <div class="admin-grid">
        <div class="field"><label>대학명</label><input id="aName" value="${h(current.name)}"></div>
        <div class="field"><label>학과</label><input id="aMajor" value="${h(current.major)}"></div>
        <div class="field"><label>지역</label><input id="aRegion" value="${h(current.region || '')}" placeholder="예: 서울"></div>
        <div class="field"><label>전형명</label><input id="aAdmission" value="${h(current.admission)}"></div>
        <div class="field"><label>실기유형</label><input id="aPracticalType" list="adminPracticalTypeOptions" value="${h(displayPracticalType(current))}" placeholder="예: 상황표현, 칸만화, 포트폴리오"></div>
        <datalist id="adminPracticalTypeOptions">${practicalTypeOptions().map(type=>`<option value="${h(type)}"></option>`).join('')}</datalist>
        <div class="field"><label>학년도</label><input id="aYear" type="number" value="${h(current.year)}"></div>
        <div class="field"><label>대학 구분</label><select id="aCollegeType">${collegeTypeOptions(current.collegeType)}</select></div>
        <div class="field"><label>성적 반영비</label><input id="aGrade" type="number" value="${h(current.gradeRatio)}"></div>
        <div class="field"><label>실기 반영비</label><input id="aSkill" type="number" value="${h(current.skillRatio)}"></div>
        <div class="field"><label>반영 과목</label><input id="aSubjects" value="${h(current.subjects)}"></div>
        <div class="field"><label>전년도 경쟁률</label><input id="aRatePrev" value="${h(current.ratePrev || '')}"></div>
        <div class="field"><label>올해 경쟁률</label><input id="aRate" value="${h(current.rateCurrent || '')}"></div>
        <div class="field"><label>합격 기준 내신</label><input id="aCutGpa" type="number" step="0.1" value="${h(current.cutGpa || '')}"></div>
        <div class="field"><label>합격 기준 실기점수</label><input id="aSampleSkill" type="number" value="${h(current.sampleSkill || '')}"></div>
      </div>
      <h3 class="admin-subtitle">필수과목 기준 성적</h3>
      <div class="subject-admin-grid">
        <div class="field"><label>국어</label><select id="reqKorean">${gradeStepOptions(required.korean)}</select></div>
        <div class="field"><label>영어</label><select id="reqEnglish">${gradeStepOptions(required.english)}</select></div>
        <div class="field"><label>수학</label><select id="reqMath">${gradeStepOptions(required.math)}</select></div>
        <div class="field"><label>사탐</label><select id="reqSocial">${gradeStepOptions(required.social)}</select></div>
        <div class="field"><label>과탐</label><select id="reqScience">${gradeStepOptions(required.science)}</select></div>
      </div>
      ${window.OfficialAdmissionEvidence.markup(state.data,current)}
      <h3 class="admin-subtitle">${officialStats ? '공식 최종등록자 통계 · 2026학년도' : '기존 입력 성적 (공식 검증 전 참고값)'}</h3>
      <div class="admin-grid">
        <div class="field"><label>합격생 평균성적</label><input id="statAverage" type="number" step="0.1" value="${h(stats.average || '')}"></div>
        <div class="field"><label>합격생 최고성적</label><input id="statBest" type="number" step="0.1" value="${h(stats.best || '')}"></div>
        <div class="field"><label>합격생 최저성적</label><input id="statWorst" type="number" step="0.1" value="${h(stats.worst || '')}"></div>
      </div>
      ${state.adminMode === 'edit' ? renderRuleTemplateCopyPanel(current, list) : ''}
      ${state.adminMode === 'edit' ? renderGradeRuleEditor(current) : '<div class="notice">새 대학은 먼저 저장한 뒤 성적 환산 규칙을 등록할 수 있습니다.</div>'}
      <div class="notice">입시요강이 바뀌면 이 화면에서 바로 수정해 저장하세요. 저장된 데이터는 대시보드 추천과 분석 화면에 즉시 반영됩니다.</div>
    </section>
  </div>`;
  window.AdmissionUniversityScope.bind({data:state.data,showArchived:state.adminShowArchived,selectedId:current.id,onToggle:()=>{state.adminShowArchived=!state.adminShowArchived;state.adminEditing=false;state.adminDraft=null;state.selectedUniversityId=null;renderAdmin();},onSaved:async()=>{setStateData(await window.desktopAPI.getAll());state.adminEditing=false;state.adminDraft=null;state.selectedUniversityId=null;renderAdmin();}});
  window.OfficialAdmissionEvidence.bind(state.data,async()=>{setStateData(await window.desktopAPI.getAll());renderAdmin();});
  $('newUniBtn').onclick=()=>{state.adminMode='add'; state.adminEditing=true; state.pdfAnalysis=null; renderAdmin();};
  $('editUniBtn').onclick=()=>{state.adminEditing=true; renderAdmin();};
  const setCheckComplete = next=>{
    const input = $('aCheckedComplete');
    input.value = next ? 'true' : 'false';
    $('checkCompleteBtn').classList.toggle('active', next);
    $('checkCompleteBtn').textContent = '최신입시요강 체크완료';
    if(state.adminMode !== 'edit' || !current?.id) return;
    const ids = [current.id];
    applyUniversityCheckedToState(ids, next);
    refreshUniversitySelectionOnly();
    updateAdminCheckedBadges(ids, next);
    persistUniversityCheckedInBackground(ids, next);
    releaseInteractionFocus();
  };
  $('checkCompleteBtn').onclick=()=>setCheckComplete(true);
  $('uncheckCompleteBtn').onclick=()=>setCheckComplete(false);
  $('adminSearchBtn').onclick=()=>{state.adminSearch=$('adminSearchInput').value.trim(); renderAdmin();};
  $('adminSearchInput').onkeydown=(event)=>{if(event.key==='Enter'){state.adminSearch=$('adminSearchInput').value.trim(); renderAdmin();}};
  $('adminTrackSearchInput').onchange=()=>{state.adminTrackSearch=$('adminTrackSearchInput').value; renderAdmin();};
  $('checkFilteredUniversitiesBtn').onclick=async()=>{
    if(!list.length){ alert('체크완료할 검색 결과가 없습니다.'); return; }
    const ids = list.map(university => university.id);
    applyUniversityCheckedToState(ids, true);
    refreshUniversitySelectionOnly();
    updateAdminCheckedBadges(ids, true);
    persistUniversityCheckedInBackground(ids, true);
    releaseInteractionFocus();
  };
  $('uncheckFilteredUniversitiesBtn').onclick=async()=>{
    if(!list.length){ alert('체크해제할 검색 결과가 없습니다.'); return; }
    const ids = list.map(university => university.id);
    applyUniversityCheckedToState(ids, false);
    refreshUniversitySelectionOnly();
    updateAdminCheckedBadges(ids, false);
    persistUniversityCheckedInBackground(ids, false);
    releaseInteractionFocus();
  };
  document.querySelectorAll('[data-admin-uni]').forEach(btn=>btn.onclick=()=>{state.adminMode='edit'; state.adminEditing=false; state.selectedUniversityId=Number(btn.dataset.adminUni); state.adminDraft=null; state.pdfAnalysis=null; renderAdmin();});
  if(editorLocked){
    document.querySelectorAll('.admin-editor-panel input, .admin-editor-panel select, .admin-editor-panel textarea, .admin-editor-panel button:not(#applyOfficialEvidence):not(#editUniBtn):not(#saveUni):not(#deleteUniBtn):not(#checkCompleteBtn):not(#uncheckCompleteBtn):not(#saveAdmissionImagesBtn):not(#viewAdmissionImagesBtn):not(#applyRuleTemplateBtn)').forEach(element => {
      element.disabled = true;
    });
  }
  $('saveUni').onclick=saveUniversity;
  $('deleteUniBtn').onclick=deleteUniversity;
  if($('saveGradeRuleBtn')) $('saveGradeRuleBtn').onclick=saveGradeRuleFromAdmin;
  if($('saveAdmissionImagesBtn')) $('saveAdmissionImagesBtn').onclick=async()=>{
    try {
      const result = await window.desktopAPI.saveAdmissionImages(current.id);
      if(result?.ok){
        state.data.universities = state.data.universities.map(university => Number(university.id) === Number(result.university.id) ? result.university : university);
        universityIdCache = null;
        renderAdmin();
      }
    } catch (error) {
      alert(error.message || '입시요강 이미지 저장 중 오류가 발생했습니다.');
    }
  };
  if($('viewAdmissionImagesBtn')) $('viewAdmissionImagesBtn').onclick=async()=>{
    try {
      await window.desktopAPI.openAdmissionImages(current.id);
    } catch (error) {
      alert(error.message || '저장된 입시요강 이미지를 열 수 없습니다.');
    }
  };
  if($('applyRuleTemplateBtn')) $('applyRuleTemplateBtn').onclick=async()=>{
    const targetIds = list.filter(university => Number(university.id) !== Number(current.id)).map(university => university.id);
    if(!targetIds.length) return;
    if(!confirm(`현재 대학의 환산식과 반영 기준을 검색 결과 ${targetIds.length}개 대학/학과에 적용할까요?`)) return;
    try {
      await window.desktopAPI.applyUniversityRuleTemplate(current.id, targetIds, { copyRatios: true, copySubjects: true, copyCutScores: true });
      setStateData(await window.desktopAPI.getAll());
      state.adminEditing = false;
      renderAdmin();
    } catch (error) {
      alert(error.message || '동일 요강 적용 중 오류가 발생했습니다.');
    }
  };
}
async function deleteUniversity(){
  const current=uni(state.selectedUniversityId);if(!current?.id)return;
  if(!state.data._universityScope?.canManage){alert('마스터 권한이 필요합니다.');return;}
  if(!confirm(universityNameText(current)+' 항목을 목록에서 숨길까요? 숨긴 대학 보기에서 언제든 복원할 수 있습니다.'))return;
  try{await window.AdmissionUniversityScope.request({action:'hide',ids:[String(current.id)],expectedRevision:state.data._universityScope?.revision||0});setStateData(await window.desktopAPI.getAll());state.adminEditing=false;state.adminDraft=null;state.selectedUniversityId=null;renderAdmin();}catch(e){alert(e.message);}
}
async function saveUniversity(){
  const current = state.adminMode === 'add' ? blankUniversity() : uni(state.selectedUniversityId);
  const checkedValue = $('aCheckedComplete')?.value === 'true';
  const optionalNumber=id=>{const value=$(id)?.value?.trim();return value&&Number.isFinite(Number(value))?Number(value):null;};
  const payload = {
    ...(current || {}),
    name:$('aName').value.trim(),
    major:$('aMajor').value.trim(),
    region:$('aRegion')?.value.trim() || '',
    admission:$('aAdmission').value.trim(),
    practicalType:$('aPracticalType')?.value.trim() || '',
    year:num('aYear',2027),
    collegeType:$('aCollegeType')?.value || '4년제',
    gradeRatio:num('aGrade',40),
    skillRatio:num('aSkill',60),
    subjects:$('aSubjects').value.trim(),
    ratePrev:$('aRatePrev').value.trim(),
    rateCurrent:$('aRate').value.trim(),
    cutGpa:optionalNumber('aCutGpa'),
    sampleSkill:optionalNumber('aSampleSkill'),
    checkedComplete:checkedValue,
    isChecked:checkedValue,
    checked:checkedValue,
    latestAdmissionComplete: checkedValue ? true : current?.latestAdmissionComplete,
    latestAdmissionSource: checkedValue && !current?.latestAdmissionSource ? '수동 최신입시요강 체크' : current?.latestAdmissionSource,
    requiredScores:{korean:num('reqKorean'),english:num('reqEnglish'),math:num('reqMath'),social:num('reqSocial'),science:num('reqScience')},
    acceptedStats:{average:optionalNumber('statAverage'),best:optionalNumber('statBest'),worst:optionalNumber('statWorst')}
  };
  if(!payload.name){ alert('대학명을 입력하세요.'); return; }
  if(state.adminMode==='add'){
    const added = await window.desktopAPI.addUniversity(payload);
    state.data.universities.push(added);
    state.selectedUniversityId = added.id;
    state.adminMode = 'edit';
  } else {
    const updated = await window.desktopAPI.updateUniversity({ ...payload, id: current.id });
    state.data.universities = state.data.universities.map(university => university.id === updated.id ? updated : university);
  }
  clearComputedCaches();
  refreshUniversityRecommendations();
  state.adminDraft=null;
  state.adminEditing=false;
  if(activePageId()==='admin') renderAdmin();
}

function awardYears(){
  const years = [];
  for(let year = 2024; year <= 2050; year++) years.push(String(year));
  return years;
}

function awardFolders(){
  return Array.isArray(state.data?.awardFolders) ? state.data.awardFolders : [];
}

function selectedAwardFolder(){
  const folders = awardFolders();
  if(!folders.length) return null;
  const selected = folders.find(folder => String(folder.id) === String(state.awardFolderId)) || folders[0];
  state.awardFolderId = selected.id;
  return selected;
}

function awardImages(folder, year){
  return Array.isArray(folder?.years?.[String(year)]) ? folder.years[String(year)] : [];
}

function renderAwards(){
  const page = $('awards');
  const folders = awardFolders().slice().sort((a,b)=>String(a.universityName||'').localeCompare(String(b.universityName||''), 'ko'));
  const selected = selectedAwardFolder();
  const selectedId = selected?.id;
  const year = String(state.awardYear || '2024');
  const images = selected ? awardImages(selected, year) : [];
  const folderList = folders.length ? folders.map(folder => {
    const count = Object.values(folder.years || {}).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
    return `<button class="award-folder-item ${String(folder.id)===String(selectedId)?'selected':''}" data-award-folder="${folder.id}">
      <b>${h(folder.universityName)}</b>
      <span>저장 이미지 ${count}장</span>
    </button>`;
  }).join('') : `<div class="empty-state">대학 폴더를 먼저 만들어주세요.</div>`;
  const yearOptions = awardYears().map(item => `<option value="${item}" ${year===item?'selected':''}>${item}년</option>`).join('');
  const gallery = selected ? (images.length ? images.map(image => `<figure class="award-thumb">
    <button type="button" data-award-image="${h(image.id)}"><img src="${h(imgSrc(image.filePath || image.path || image.url))}" alt="${h(image.fileName || image.name || '수상작 이미지')}" loading="lazy" decoding="async"></button>
    <figcaption>${h(image.fileName || image.name || '수상작 이미지')}</figcaption>
  </figure>`).join('') : `<div class="empty-state">선택한 연도에 저장된 이미지가 없습니다.</div>`) : `<div class="empty-state">새 폴더를 만들면 연도별 이미지를 저장할 수 있습니다.</div>`;

  page.innerHTML = `
    <div class="top">
      <div>
        <h1>공모전 및 실기대회 수상작</h1>
        <p>대학별 폴더와 연도별 이미지로 수상작을 정리합니다.</p>
      </div>
    </div>
    <div class="awards-layout">
      <aside class="card awards-sidebar">
        <h2>대학 폴더</h2>
        <div class="awards-folder-create">
          <input id="awardFolderName" placeholder="대학명 입력">
          <button class="btn primary" id="addAwardFolderBtn">새 폴더</button>
        </div>
        <div class="award-folder-list">${folderList}</div>
      </aside>
      <section class="card awards-main">
        <div class="awards-toolbar">
          <div>
            <h2>${selected ? h(selected.universityName) : '수상작 보관함'}</h2>
            <p class="muted">${selected ? `${year}년 수상작 ${images.length}장` : '대학 폴더를 만든 뒤 이미지를 추가하세요.'}</p>
          </div>
          <div class="award-year-actions">
            <div class="field">
              <label>연도</label>
              <select id="awardYearSelect">${yearOptions}</select>
            </div>
            <button class="btn primary" id="addAwardImagesBtn" ${selected?'':'disabled'}>그림 이미지 추가</button>
          </div>
        </div>
        <div class="award-gallery-grid">${gallery}</div>
      </section>
    </div>
    `;
  bindAwards();
}

function updateAwardFolder(folder){
  state.data.awardFolders = awardFolders().map(item => String(item.id) === String(folder.id) ? folder : item);
}

function bindAwards(){
  const addBtn = $('addAwardFolderBtn');
  const input = $('awardFolderName');
  if(addBtn) addBtn.onclick = async () => {
    const name = input.value.trim();
    if(!name){
      alert('대학명을 입력하세요.');
      return;
    }
    const folder = await window.desktopAPI.addAwardFolder(name);
    state.data.awardFolders = [...awardFolders(), folder];
    state.awardFolderId = folder.id;
    input.value = '';
    renderAwards();
  };
  if(input) input.onkeydown = (event) => {
    if(event.key === 'Enter') addBtn?.click();
  };
  document.querySelectorAll('[data-award-folder]').forEach(button => {
    button.onclick = () => {
      state.awardFolderId = button.dataset.awardFolder;
      state.awardViewer = null;
      renderAwards();
    };
  });
  const yearSelect = $('awardYearSelect');
  if(yearSelect) yearSelect.onchange = () => {
    state.awardYear = yearSelect.value;
    state.awardViewer = null;
    renderAwards();
  };
  const addImagesBtn = $('addAwardImagesBtn');
  if(addImagesBtn) addImagesBtn.onclick = async () => {
    const folder = selectedAwardFolder();
    if(!folder) return;
    const result = await window.desktopAPI.importAwardImages(folder.id, state.awardYear);
    if(result?.ok && result.folder){
      updateAwardFolder(result.folder);
      renderAwards();
    }
  };
  document.querySelectorAll('[data-award-image]').forEach(button => {
    button.onclick = () => {
      const folder = selectedAwardFolder();
      const images=awardImages(folder,state.awardYear), year=state.awardYear;
      const index=images.findIndex(item=>String(item.id)===button.dataset.awardImage);
      if(index<0)return;
      window.DataCoreImageGallery.open({scope:'admissions-awards',title:'수상작',anchor:button,index,
        items:images.map(image=>({src:imgSrc(image.filePath||image.path||image.url),title:image.fileName||image.name||'수상작 이미지'})),
        actions:[{label:'이미지 삭제',icon:'Trash2',run:async(selected,viewer)=>{
          if(!confirm('이 이미지를 삭제할까요?'))return;
          try{const result=await window.desktopAPI.deleteAwardImage(folder.id,year,images[selected].id);
            if(result?.ok&&result.folder)updateAwardFolder(result.folder);
            viewer.close();renderAwards();
          }catch{alert('이미지를 삭제하지 못했습니다. 다시 시도해주세요.');}
        }}]});
    };
  });
}

// 합격 재현작·대학 우수작: DATA CORE의 같은 폴더 화면(대학·연도 폴더, 단계별 줄, 이미지 보기·업로드)을 로드맵 안에 보여 준다.
// 권한은 DATA CORE 서버가 그대로 확인한다.
function renderWorks(){
  const page = $('works');
  if(page.querySelector('#worksFrame')) return;
  page.innerHTML = `<div class="top"><div><h1>대학합격 재현작 및 공개우수작</h1><p>대학합격 재현작과 대학발표 우수작을 대학·연도별 폴더로 모아 봅니다.</p></div></div>
    <iframe id="worksFrame" class="works-frame" src="/data-core/counseling/works?embed=1" title="대학합격 재현작 및 공개우수작 폴더" style="display:block;width:100%;min-height:640px;border:0;background:transparent"></iframe>`;
}
window.addEventListener('message', event => {
  if(event.origin !== location.origin || event.data?.type !== 'data-core-embed-height') return;
  const frame = $('worksFrame');
  if(frame && event.source === frame.contentWindow) frame.style.height = `${Math.max(640, Number(event.data.height) || 0)}px`;
});

function renderSettings(){
  const consultantOptionsMarkup = consultantNameOptions().map(name => `<option value="${h(name)}" ${consultantName()===name?'selected':''}>${h(name)}</option>`).join('');
  $('settings').innerHTML=`<div class="top"><div><h1>설정 / 백업</h1><p>기존 데이터를 덮어쓰지 않고 학생·대학 데이터를 추가하거나 내보낼 수 있습니다.</p></div></div>
  <div class="settings-grid">
    <section class="card"><h2>컨설턴트 이름</h2><p class="muted">로드맵에 표시할 학원명을 선택합니다.</p><div class="field"><label>표시 이름</label><select id="consultantNameInput">${consultantOptionsMarkup}</select></div><button class="btn primary settings-save-btn" id="saveConsultantNameBtn">이름 저장</button></section>
    <section class="card"><h2>데이터 추가 가져오기</h2><p class="muted">다른 PC에서 받은 JSON 데이터를 현재 데이터 뒤에 추가합니다.</p><div class="actions wrap"><button class="btn primary" id="importStudentsBtn">학생 데이터 추가</button><button class="btn primary" id="importUniversitiesBtn">대학 데이터 추가</button></div></section>
    <section class="card"><h2>데이터 내보내기</h2><p class="muted">학생 또는 대학 데이터만 따로 저장해 다른 PC와 공유합니다.</p><div class="actions wrap"><button class="btn" id="exportStudentsBtn">학생데이터 내보내기</button><button class="btn" id="exportUniversitiesBtn">대학데이터 내보내기</button></div></section>
    <section class="card"><h2>기존 그림 웹 저장소 이전</h2><p class="muted">설치형 프로그램에서 쓰던 그림 폴더를 선택하면 웹에서도 보이도록 이미지 주소를 바꿉니다.</p><div class="actions wrap"><button class="btn primary" id="migrateLegacyImagesBtn">기존 그림 폴더 선택해서 이전</button></div><div id="legacyImageMigrationStatus" class="notice compact">권장 선택 위치: %APPDATA%\\admissions-consulting-desktop</div></section>
    <section class="card"><h2>전체 백업</h2><p class="muted">전체 백업/복원은 비상용입니다. 복원은 현재 데이터를 교체합니다.</p><div class="actions wrap"><button class="btn" id="backupBtn">전체 데이터 백업</button><button class="btn danger" id="restoreBtn">전체 백업 복원</button><button class="btn" id="pathBtn">데이터 위치 확인</button></div></section>
  </div>
  <div id="settingsMsg" class="notice">추천 방향: 학원 PC끼리는 학생 데이터와 대학 데이터를 분리해서 주고받으면 충돌이 적고 관리가 쉽습니다.</div>`;
  $('saveConsultantNameBtn').onclick=async()=>{const selectedName=$('consultantNameInput').value; const consultantName=consultantNameOptions().includes(selectedName)?selectedName:consultantNameOptions()[0]; await window.desktopAPI.updateSettings({consultantName}); setStateData(await window.desktopAPI.getAll()); $('settingsMsg').textContent=`로드맵 이름을 ${consultantName}(으)로 저장했습니다.`; renderDashboard();};
  $('importStudentsBtn').onclick=async()=>{const r=await window.desktopAPI.importStudentsAppend(); if(r.ok){setStateData(await window.desktopAPI.getAll()); $('settingsMsg').textContent=`학생 데이터 ${r.count}건을 추가했습니다.`;}};
  $('importUniversitiesBtn').onclick=async()=>{const r=await window.desktopAPI.importUniversitiesAppend(); if(r.ok){setStateData(await window.desktopAPI.getAll()); $('settingsMsg').textContent=`대학 데이터 ${r.count}건을 추가했습니다.`;}};
  $('exportStudentsBtn').onclick=async()=>{const r=await window.desktopAPI.exportStudents(); if(r.ok)$('settingsMsg').textContent=`학생 데이터 ${r.count}건을 내보냈습니다: ${r.filePath}`;};
  $('exportUniversitiesBtn').onclick=async()=>{const r=await window.desktopAPI.exportUniversities(); if(r.ok)$('settingsMsg').textContent=`대학 데이터 ${r.count}건을 내보냈습니다: ${r.filePath}`;};
  if($('migrateLegacyImagesBtn')) $('migrateLegacyImagesBtn').onclick=async()=>{
    if(!window.desktopAPI.migrateLegacyImagesFromDirectory){$('settingsMsg').textContent='현재 버전에서는 그림 이전 기능을 사용할 수 없습니다.';return;}
    const btn=$('migrateLegacyImagesBtn');
    const status=$('legacyImageMigrationStatus');
    try{
      btn.disabled=true;
      status.textContent='폴더를 선택해주세요. 기존 설치형 앱의 admissions-consulting-desktop 폴더를 선택하면 가장 정확합니다.';
      const result=await window.desktopAPI.migrateLegacyImagesFromDirectory();
      if(!result.ok){status.textContent=result.message||'그림 이전을 취소했습니다.';return;}
      setStateData(await window.desktopAPI.getAll());
      status.textContent=`완료: 웹 저장소 업로드 ${result.uploaded||0}개, 데이터 연결 ${result.updated||0}개, 폴더에서 못 찾은 그림 ${result.missing||0}개`;
      $('settingsMsg').textContent='기존 그림을 웹 저장소로 이전했습니다. 이제 다른 컴퓨터에서도 같은 사이트에서 이미지를 볼 수 있습니다.';
    }catch(error){
      status.textContent='그림 이전 중 오류가 발생했습니다: '+(error?.message||error);
    }finally{
      btn.disabled=false;
    }
  };
  window.onlegacyimagemigrationprogress = (event) => {
    const detail = event.detail || {};
    const status = $('legacyImageMigrationStatus');
    if(!status) return;
    if(detail.status === 'started') status.textContent = `이전 준비 중: 선택한 이미지 ${detail.fileCount||0}개, 연결할 기존 경로 ${detail.totalRefs||0}개를 확인했습니다.`;
    else if(detail.status === 'uploading') status.textContent = `업로드 중: ${detail.fileName||'이미지'} / 업로드 ${detail.uploaded||0}개 / 연결 ${detail.updated||0}개`;
    else if(detail.status === 'working') status.textContent = `이전 중: ${detail.current||0}/${detail.total||0} 처리, 업로드 ${detail.uploaded||0}개, 연결 ${detail.updated||0}개`;
  };
  window.removeEventListener('legacy-image-migration-progress', window.__legacyImageMigrationListener || (()=>{}));
  window.__legacyImageMigrationListener = window.onlegacyimagemigrationprogress;
  window.addEventListener('legacy-image-migration-progress', window.__legacyImageMigrationListener);
  $('backupBtn').onclick=async()=>{const r=await window.desktopAPI.createBackup(); if(r.ok)$('settingsMsg').textContent='전체 백업 완료: '+r.filePath;};
  $('restoreBtn').onclick=async()=>{if(!confirm('현재 전체 데이터가 백업 파일 내용으로 교체됩니다. 계속할까요?'))return; try{const r=await window.desktopAPI.restoreBackup(); if(r.ok){setStateData(await window.desktopAPI.getAll());renderAll();alert('복원이 완료되었습니다.');}}catch(e){alert(e.message);}};
  $('pathBtn').onclick=async()=>{$('settingsMsg').textContent='데이터 파일 위치: '+await window.desktopAPI.getDataPath();};
}

boot();

