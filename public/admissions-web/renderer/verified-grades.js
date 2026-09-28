import { calculateCandidates, RULES, CATALOG_VERSION } from './verified-grade-engine.js?v=20260929-1';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const icon = name => `<svg aria-hidden="true" width="18" height="18"><use href="/data-core/assets/core-icons.svg#${name}"></use></svg>`;
const groups = [['KOREAN','국어'],['MATH','수학'],['ENGLISH','영어'],['SOCIAL','사회'],['SCIENCE','과학'],['KOREAN_HISTORY','한국사'],['HISTORY','역사'],['ETHICS','도덕'],['ART','예술'],['ETC','기타']];
const types = [['COMMON','공통과목'],['GENERAL','일반선택'],['CAREER','진로선택'],['SPECIALIZED','전문교과'],['CONVERGENCE','융합선택'],['ETC','기타']];
const options = (items, value) => items.map(([id,label]) => `<option value="${escape(id)}" ${String(value) === String(id) || value === label ? 'selected' : ''}>${escape(label)}</option>`).join('');
const blank = () => ({ id: crypto.randomUUID(), schoolYear:'1학년', semester:'1학기', subjectGroup:'KOREAN', subjectName:'', subjectType:'COMMON', grade:'', achievement:'' });
const link = (url, label) => `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label)} ${icon('ChevronRight')}</a>`;
let directoryPromise;
export function newGradeDraft() { return { studentId:'', rows:[], profile:{ year:2027, season:'수시', scale:9, schoolStatus:'expected', complete:false }, track:'', calculated:false, sample:false }; }

export function mountVerifiedGrades(root, { students, draft, onSave, onNavigate, current }) {
  const active = () => root.isConnected && current();
  let results = [], saving = false;
  root.classList.add('verified-grades');
  root.innerHTML = `<div class="top"><div><h1>성적 기반 대학 비교</h1><p>공식 교과 환산 · 2027학년도 수시</p></div><div class="vg-actions"><button class="btn" data-nav="students">${icon('Users')}학생 관리</button><button class="btn" data-nav="susi">${icon('BookOpen')}미대 수시 입시요강</button></div></div>
    <section class="vg-section" aria-labelledby="vg-input-title"><h2 id="vg-input-title">학생 성적</h2>
      <div class="vg-controls">
        <label>학생<select data-student><option value="">직접 입력 (미저장)</option>${students.map(student => `<option value="${escape(student.id)}" ${String(student.id) === draft.studentId ? 'selected' : ''}>${escape(student.name)} · ${escape(student.track || '')}</option>`).join('')}</select></label>
        <label>입시 학년도<select data-profile="year">${options([[2027,'2027학년도'],[2028,'2028학년도']],draft.profile.year)}</select></label>
        <label>모집 시기<select data-profile="season">${options([['수시','수시'],['정시','정시']],draft.profile.season)}</select></label>
        <label>등급제<select data-profile="scale">${options([[9,'9등급제'],[5,'5등급제']],draft.profile.scale)}</select></label>
        <label>학력 구분<select data-profile="schoolStatus">${options([['expected','졸업예정'],['graduate','졸업'],['other','검정고시·해외고·기타']],draft.profile.schoolStatus)}</select></label>
        <label>희망 분야<select data-track>${options([['','전체'],['디자인','디자인'],['웹툰·애니','웹툰·애니'],['영상','영상']],draft.track)}</select></label>
      </div>
      <p class="vg-scope">자동 환산: 2개 대학 / 8개 학과·전형. 전년도 비교: 중부대 4개 전형. 나머지 대학은 아래 산출 경로에서 별도 확인이 필요합니다.</p>
      <div class="vg-actions"><button class="btn" data-add>+ 과목 추가</button><button class="btn" data-sample>예시 성적 불러오기</button><button class="btn" data-reset>${icon('RotateCcw')}입력 초기화</button></div>
      <div data-rows></div>
      <label class="vg-confirm"><input type="checkbox" data-complete ${draft.profile.complete ? 'checked' : ''}>대상 학기 과목을 빠짐없이 입력했습니다. 실제 미이수 과목 부족분은 대학 규칙에 따라 9등급으로 반영합니다.</label>
      <div class="vg-actions"><button class="btn primary" data-calculate>대학별 환산·비교</button><button class="btn" data-save ${draft.studentId ? '' : 'disabled'}>${icon('Check')}선택 학생에 성적 저장</button><span data-save-status role="status"></span></div>
      <p data-status role="status" class="vg-status"></p>
    </section>
    <section class="vg-section" aria-labelledby="vg-results-title"><div class="vg-result-head"><h2 id="vg-results-title">대학별 결과</h2><div class="vg-actions"><button class="btn" data-copy disabled>결과 복사</button><button class="btn" data-export disabled>${icon('Download')}상담지 이미지 저장</button></div></div>
      <p class="vg-caution">교과 성적 기준의 비교이며 합격 가능성이나 지원 자격 판정이 아닙니다. 실기·면접·수능최저·출결·감점·모집인원은 별도 확인해야 합니다. 전년도 최저 성적이 올해의 합격선은 아닙니다.</p>
      <div data-results><p>과목별 성적을 입력하고 환산해 주세요.</p></div>
    </section>
    <details class="vg-section" data-directory><summary>74개 대학 산출 경로·검증 상태</summary><label class="vg-directory-search">대학 검색<input type="search" data-search placeholder="대학명"></label><div data-links role="status"></div></details>`;
  const q = selector => root.querySelector(selector);
  const status = message => { q('[data-status]').textContent = message; };
  const invalidate = () => {
    draft.calculated = false; results = [];
    q('[data-results]').textContent = '성적 또는 조건이 변경되었습니다. 다시 환산해 주세요.';
    q('[data-copy]').disabled = q('[data-export]').disabled = true;
    q('[data-save-status]').textContent = '';
  };
  function renderRows() {
    q('[data-rows]').innerHTML = draft.rows.map((row,index) => `<div class="vg-row" data-row="${index}">
      <label>학년<select data-field="schoolYear">${options([['','선택'],['1학년','1학년'],['2학년','2학년'],['3학년','3학년']],row.schoolYear)}</select></label>
      <label>학기<select data-field="semester">${options([['','선택'],['1학기','1학기'],['2학기','2학기']],row.semester)}</select></label>
      <label>교과<select data-field="subjectGroup">${row.subjectGroup && !groups.some(([id,label]) => id === row.subjectGroup || label === row.subjectGroup) ? `<option selected value="${escape(row.subjectGroup)}">${escape(row.subjectGroup)}</option>` : ''}${options([['','선택'],...groups],row.subjectGroup)}</select></label>
      <label class="vg-subject">과목명<input data-field="subjectName" value="${escape(row.subjectName)}" maxlength="100"></label>
      <label>유형<select data-field="subjectType">${options([['','선택'],...types],row.subjectType)}</select></label>
      <label>석차등급<input data-field="grade" inputmode="numeric" type="number" min="1" max="9" step="1" value="${escape(row.grade)}" ${['CAREER','SPECIALIZED','진로선택','전문교과'].includes(row.subjectType) ? 'disabled' : ''}></label>
      <label>성취도<select data-field="achievement">${options([['','선택'],['A','A'],['B','B'],['C','C'],['D','D'],['E','E']],row.achievement)}</select></label>
      <button class="btn vg-remove" type="button" data-remove="${index}" title="${index+1}행 삭제" aria-label="${index+1}행 삭제">${icon('Trash2')}</button>
    </div>`).join('') || '<p class="vg-empty">입력된 과목이 없습니다.</p>';
    q('[data-rows]').querySelectorAll('[data-field]').forEach(input => { input.oninput = () => {
      const row = draft.rows[Number(input.closest('[data-row]').dataset.row)];
      row[input.dataset.field] = input.value; draft.profile.complete = false; q('[data-complete]').checked = false; invalidate();
      if (input.dataset.field === 'subjectType') renderRows();
    }; });
    q('[data-rows]').querySelectorAll('[data-remove]').forEach(button => { button.onclick = () => { draft.rows.splice(Number(button.dataset.remove),1); draft.profile.complete = false; q('[data-complete]').checked = false; invalidate(); renderRows(); }; });
  }
  q('[data-student]').onchange = event => {
    if (draft.rows.length && !confirm('현재 입력 내용을 선택한 학생의 저장 성적으로 바꿀까요?')) { event.target.value = draft.studentId; return; }
    draft.studentId = event.target.value;
    draft.rows = structuredClone(students.find(student => String(student.id) === draft.studentId)?.detailedTranscript || []).map(row => ({...row,schoolYear: /^[123]$/.test(String(row.schoolYear)) ? `${row.schoolYear}학년` : row.schoolYear,semester: /^[12]$/.test(String(row.semester)) ? `${row.semester}학기` : row.semester}));
    draft.sample = false; draft.profile.complete = false; q('[data-complete]').checked = false;
    q('[data-save]').disabled = !draft.studentId; invalidate(); renderRows(); status(draft.rows.length ? '저장된 과목을 불러왔습니다. 학력·등급제와 대상 학기를 확인해 주세요.' : '저장된 과목별 성적이 없습니다. 평균 내신은 자동 변환하지 않습니다.');
  };
  root.querySelectorAll('[data-profile]').forEach(input => { input.onchange = () => { draft.profile[input.dataset.profile] = input.value; draft.profile.complete = false; q('[data-complete]').checked = false; invalidate(); }; });
  q('[data-track]').onchange = event => { draft.track = event.target.value; invalidate(); };
  q('[data-complete]').onchange = event => { draft.profile.complete = event.target.checked; invalidate(); };
  q('[data-add]').onclick = () => { draft.rows.push(blank()); draft.profile.complete = false; q('[data-complete]').checked = false; invalidate(); renderRows(); q('[data-rows]').lastElementChild.querySelector('[data-field="subjectName"]').focus(); };
  q('[data-reset]').onclick = () => {
    if (draft.rows.length && !confirm('작성 중인 성적을 초기화할까요? 저장된 학생 성적은 유지됩니다.')) return;
    Object.assign(draft,newGradeDraft()); mountVerifiedGrades(root,{students,draft,onSave,onNavigate,current});
  };
  q('[data-sample]').onclick = () => {
    if (draft.rows.length && !confirm('현재 입력을 예시 성적으로 바꿀까요? 저장된 학생 성적은 유지됩니다.')) return;
    Object.assign(draft,newGradeDraft());
    const names = ['국어','수학','영어','통합사회','통합과학','문학','수학Ⅰ','영어Ⅰ','한국사','생명과학'];
    const subjects = ['KOREAN','MATH','ENGLISH','SOCIAL','SCIENCE','KOREAN','MATH','ENGLISH','KOREAN_HISTORY','SCIENCE'];
    draft.rows = names.map((name,i) => ({ ...blank(), schoolYear:i<5?'1학년':'2학년', subjectName:name, subjectGroup:subjects[i], grade:[3,4,2,3,4,3,5,2,3,4][i] }));
    draft.sample = true; draft.profile.complete = true;
    mountVerifiedGrades(root,{students,draft,onSave,onNavigate,current});
    q('[data-status]').textContent = '예시 성적입니다. 학생 기록에 저장되지 않습니다.';
  };
  q('[data-save]').onclick = async () => {
    if (saving || !draft.studentId || !active()) return;
    saving = true; q('[data-save]').disabled = true;
    const id = draft.studentId, snapshot = structuredClone(draft.rows);
    try { await onSave(id,snapshot); if (active()) q('[data-save-status]').textContent = draft.studentId === id && JSON.stringify(draft.rows) === JSON.stringify(snapshot) ? '성적 저장됨' : '요청 당시 성적 저장됨 · 이후 입력 변경은 미저장'; }
    catch(error) { if(active()) q('[data-save-status]').textContent = `저장 실패: ${error.message}`; }
    finally { saving = false; if(active()) q('[data-save]').disabled = !draft.studentId; }
  };
  function calculate() {
    results = calculateCandidates(draft.rows,draft.profile,draft.track); draft.calculated = true;
    status(draft.sample ? '예시 성적 계산 결과 (미저장)' : `${results.filter(result => result.ok).length}개 전형 환산 완료`);
    const compared = results.filter(result => result.ok && result.benchmark);
    const only = results.filter(result => result.ok && !result.benchmark);
    const failed = results.filter(result => !result.ok);
    q('[data-results]').innerHTML = (compared.length ? `<h3>전년도 최저 교과등급 대비 차이순</h3>${resultMarkup(compared,true)}` : '') + (only.length ? `<h3>환산 완료 · 전년도 비교 자료 확인 필요</h3>${resultMarkup(only,false)}` : '') + (failed.length ? `<h3>산출 보류</h3><ul class="vg-blocked">${failed.map(result => `<li><b>${escape(RULES[result.program.rule].university)} ${escape(result.program.major)} · ${escape(result.program.admission)}</b><span>${escape(result.reason)}</span></li>`).join('')}</ul>` : '');
    q('[data-copy]').disabled = q('[data-export]').disabled = !results.some(result => result.ok);
  }
  q('[data-calculate]').onclick = calculate;
  const report = () => [draft.sample ? '예시 성적 / 미저장' : (students.find(student => String(student.id) === draft.studentId)?.name || '직접 입력 / 미저장'), `${draft.profile.year}학년도 ${draft.profile.season} 교과 환산`, '합격 가능성·지원 자격 판정 아님. 실기·면접·수능최저·감점 별도 확인.', ...results.filter(row=>row.ok).flatMap(row=>[`${row.rule.university} ${row.rule.campus} / ${row.program.major} / ${row.program.admission}`, `교과 ${row.score} / ${row.program.maxScore}점 · 반영등급 ${row.convertedGrade.toFixed(2)}${row.benchmark ? ` · 전년도 최저 ${row.benchmark.grade.toFixed(2)} · 차이 ${row.benchmark.margin.toFixed(2)}` : ' · 비교 자료 확인 필요'}`, `근거: ${row.rule.source} (${row.rule.pages}쪽)`]), `규칙 버전: ${CATALOG_VERSION}`].join('\n');
  q('[data-copy]').onclick = async () => { try { await navigator.clipboard.writeText(report()); if(active()) status('환산 결과를 복사했습니다.'); } catch { if(active()) status('클립보드에 접근할 수 없습니다. 브라우저 권한을 확인해 주세요.'); } };
  q('[data-export]').onclick = () => {
    const canvas = document.createElement('canvas'); canvas.width = 1600;
    const context = canvas.getContext('2d'); context.font = '24px sans-serif';
    const lines = report().split('\n').flatMap(line => { const parts = []; let part = ''; for(const char of line) { if(context.measureText(part+char).width > 1460) { parts.push(part); part = ''; } part += char; } return [...parts,part]; });
    canvas.height = Math.max(500, lines.length*44+100); context.fillStyle = '#ffffff'; context.fillRect(0,0,canvas.width,canvas.height); context.font = '24px sans-serif'; context.fillStyle = '#192823'; lines.forEach((line,index)=>context.fillText(line,60,70+index*44));
    canvas.toBlob(blob => { if(!blob || !active()) return; const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = `대학_교과환산_${draft.profile.year}.png`; anchor.click(); setTimeout(()=>URL.revokeObjectURL(url),30000); status('상담지 다운로드를 시작했습니다.'); },'image/png');
  };
  root.querySelectorAll('[data-nav]').forEach(button => { button.onclick = () => onNavigate(button.dataset.nav); });
  async function renderDirectory() {
    q('[data-links]').textContent = '산출 경로 불러오는 중';
    try {
      directoryPromise ||= fetch('./calculator-directory.json?v=20260929-1').then(response => { if(!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }).catch(error=>{ directoryPromise=null; throw error; });
      const entries = await directoryPromise; if(!active()) return;
      const search = q('[data-search]').value.trim();
      q('[data-links]').innerHTML = entries.filter(entry=>entry.name.includes(search)).map(entry => `<div class="vg-directory-row"><b>${escape(entry.name)}</b><span>${entry.id === 59 || entry.id === 39 ? '2027 수시 일부 전형 자동 환산' : entry.sourceYear === '2026' ? '2026 자료 · 2027 식 미검증' : '자동 환산 미검증'}${entry.id === 5 ? ' · 글로컬(충주) 전용 · 서울 제외' : ''}${entry.suppliedNote ? ` · ${escape(entry.suppliedNote)}` : ''}</span>${entry.url ? link(entry.url,'제공된 산출 경로') : '<span>산출 링크 확인 필요</span>'}</div>`).join('') || '<p>검색 결과가 없습니다.</p>';
    } catch(error) { if(active()) q('[data-links]').textContent = `조회 실패: ${error.message}`; }
  }
  q('[data-directory]').ontoggle = () => { if(q('[data-directory]').open) renderDirectory(); };
  q('[data-search]').oninput = renderDirectory;
  renderRows(); if(draft.calculated) calculate();
}

function resultMarkup(results, ranked) {
  return `<div class="vg-results">${results.map((row,index) => `<article class="vg-result">
    <div class="vg-result-title"><h4>${ranked ? `${index+1}. ` : ''}${escape(row.rule.university)} <small>${escape(row.rule.campus)}</small></h4><b>${escape(row.program.major)}</b><span>${escape(row.program.admission)}</span></div>
    <dl><div><dt>교과 환산</dt><dd>${row.score.toFixed(2)} / ${row.program.maxScore}</dd></div><div><dt>반영등급</dt><dd>${row.convertedGrade.toFixed(2)}</dd></div>${row.benchmark ? `<div><dt>2026 최저 교과등급</dt><dd>${row.benchmark.grade.toFixed(2)}</dd></div><div><dt>전년도 대비 차이</dt><dd>${row.benchmark.margin > 0 ? '+' : ''}${row.benchmark.margin.toFixed(2)} <small>${row.benchmark.margin >= 0 ? '전년도 성적 이상' : '전년도 성적 미달'}</small></dd></div>` : '<div><dt>전년도 비교</dt><dd>자료 확인 필요</dd></div>'}</dl>
    <details><summary>반영 과목·계산 근거</summary><p>${escape(row.rule.summary)}</p><p>${row.program.rule === 'seowon' ? '졸업예정자는 3-1, 졸업자는 3-2까지 입력된 이수과목. 과목별 등급점수 평균을 소수 둘째 자리로 반올림 후 교과 배점 적용.' : '상위 10과목 등급 평균에 전형별 공식 환산표 적용.'}</p><ol>${row.selected.map(subject=>`<li>${escape(subject.schoolYear)} ${escape(subject.semester)} ${escape(subject.subjectName)}: ${subject.convertedGrade}등급${subject.fromAchievement ? ` (${escape(subject.achievement)} 환산)` : ''}${subject.padded ? ' · 미이수 부족분' : ''}</li>`).join('')}</ol>${row.excluded.length ? `<p>미반영 과목</p><ul>${row.excluded.map(subject=>`<li>${escape(subject.subjectName)}: ${escape(subject.reason)}</li>`).join('')}</ul>` : ''}${row.benchmark ? '<p>2026 최종등록자 성적을 2027 학생부 반영법으로 다시 산출한 대학 공개 자료와 비교합니다. 양수는 반영등급이 전년도 최저보다 좋다는 뜻이며, 합격 보장은 아닙니다.</p>' : ''}<div class="vg-actions">${link(row.rule.source,`공식 모집요강 ${row.rule.pages}쪽`)}${link(row.rule.calculator,'대학 성적 계산기')}</div><p>근거 확인: ${row.rule.verifiedAt} · ${escape(row.rule.version)}</p></details>
  </article>`).join('')}</div>`;
}
