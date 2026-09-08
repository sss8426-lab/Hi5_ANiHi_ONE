(() => {
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  const state = { student: null, artworks: [], reports: [], guardians: [], growthSkillCatalog: null, yearMonth: new Date().toISOString().slice(0, 7), deliveryFilter: 'all' };
  const app = () => window.KkumeumStaff;
  const campusId = () => app()?.state?.campusId || '';
  const manager = () => Boolean(app()?.isManager?.());
  const currentReport = () => state.reports.find((item) => item.yearMonth === state.yearMonth);

  async function api(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', credentials: 'include', ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.error || body.message || `HTTP ${response.status}`), { body });
    return body;
  }

  function note(id, value) { const node = $(id)?.querySelector('[data-feedback]'); if (node) node.textContent = value || ''; }

  function dialog(title, body, save, afterOpen) {
    const root = document.createElement('dialog');
    root.className = 'kk-dialog';
    root.innerHTML = `<form method="dialog"><div class="kk-dialog-head"><h3>${escapeHtml(title)}</h3><button type="button" data-close aria-label="닫기">×</button></div>${body}<p data-feedback class="kk-dialog-feedback"></p><div class="kk-dialog-actions"><button type="button" data-close>취소</button><button class="primary" type="submit">저장</button></div></form>`;
    document.body.append(root);
    root.querySelectorAll('[data-close]').forEach((button) => button.onclick = () => root.close());
    const form = root.querySelector('form');
    form.onsubmit = async (event) => { event.preventDefault(); try { await save(new FormData(event.currentTarget)); root.close(); } catch (error) { root.querySelector('[data-feedback]').textContent = error.message || '저장하지 못했습니다.'; } };
    afterOpen?.(form);
    root.onclose = () => root.remove(); root.showModal();
  }

  async function overview() {
    if (!app()?.state?.health?.ok || !campusId()) return;
    try {
      const [summary, notices] = await Promise.all([
        api(`/api/kkumeum/dashboard?campusId=${encodeURIComponent(campusId())}&yearMonth=${state.yearMonth}`),
        api(`/api/kkumeum/announcements?campusId=${encodeURIComponent(campusId())}`),
      ]);
      const d = summary.dashboard; const published = (notices.announcements || []).filter((item) => item.status === 'published').length;
      const grid = document.querySelector('.kk-status-grid'); if (!grid) return;
      grid.innerHTML = `<article><span>학생·반</span><strong>${d.students} · ${d.classes}</strong><small>재원 학생 · 활성 반</small></article><article><span>${escapeHtml(d.yearMonth)} 평가</span><strong>${d.reports.missing}</strong><small>미작성 · 임시 ${d.reports.draft} · 검토 ${d.reports.ready} · 전달 ${d.reports.sent}</small></article><article><span>이번 달 작품</span><strong>${d.artworks}</strong><small>private 작품 파일</small></article><article><span>보호자·소식</span><strong>${d.guardians.linked} · ${published}</strong><small>연결 학생 · 발행 소식</small></article>`;
    } catch (_) { /* setup-required UI remains visible */ }
  }

  function renderDetail() {
    const root = $('kkStudentDetail'); if (!root) return;
    if (!state.student) { root.hidden = true; return; }
    root.hidden = false;
    const s = state.student;
    root.innerHTML = `<div class="kk-panel-head"><div><span>STUDENT DETAIL</span><h3>${escapeHtml(s.display_name || s.displayName || s.name)}</h3><p class="kk-subline">${escapeHtml([s.class_name || s.className || '반 미지정', s.grade, s.school_name || s.schoolName, s.status].filter(Boolean).join(' · '))}</p></div>${manager() ? '<button id="kkEditStudent" type="button">학생 정보 수정</button>' : ''}</div><div class="kk-month-row"><label>기준 월 <input id="kkYearMonth" type="month" value="${state.yearMonth}"></label><span>전달 완료 평가는 개정으로만 수정합니다.</span></div>`;
    $('kkYearMonth').onchange = async (event) => { state.yearMonth = event.target.value || state.yearMonth; await load(state.student.id); };
    $('kkEditStudent')?.addEventListener('click', editStudent);
  }

  function editStudent() {
    const s = state.student;
    const classes = [{id:'',name:'반 미지정'}, ...(app()?.state?.classes || [])].map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === (s.current_class_id || s.currentClassId) ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
    dialog('학생 정보 수정', `<label><span>학생 이름</span><input name="name" required maxlength="100" value="${escapeHtml(s.name)}"></label><label><span>학년</span><input name="grade" maxlength="40" value="${escapeHtml(s.grade || '')}"></label><label><span>학교</span><input name="schoolName" maxlength="160" value="${escapeHtml(s.school_name || s.schoolName || '')}"></label><label><span>반</span><select name="classId">${classes}</select></label><label><span>상태</span><select name="status">${['active','leave','moved','graduated'].map((value) => `<option value="${value}" ${s.status === value ? 'selected' : ''}>${({active:'재원',leave:'휴원',moved:'이동',graduated:'졸업'})[value]}</option>`).join('')}</select></label>`, async (form) => {
      await api(`/api/kkumeum/students/${encodeURIComponent(s.id)}`, { method:'PATCH', headers:{'content-type':'application/json'}, body:JSON.stringify({campusId:campusId(), ...Object.fromEntries(form.entries()), classId:form.get('classId') || null}) });
      await app().loadClassesAndStudents(); await load(s.id);
    });
  }

  function renderArtworks() {
    const root = $('kkArtworkOperations'); if (!root || !state.student) return;
    const cards = state.artworks.map((item) => `<article class="kk-artwork-card"><img loading="lazy" src="${escapeHtml(item.fileUrl)}" alt="${escapeHtml(item.title || item.fileName)}"><div><strong>${escapeHtml(item.title || item.fileName)}</strong><small>${escapeHtml(item.lessonDate || '')}</small>${manager() ? `<button data-trash="${escapeHtml(item.id)}" type="button">휴지통</button>` : ''}</div></article>`).join('') || '<div class="kk-empty"><strong>선택한 월의 작품이 없습니다.</strong><p>예시 작품은 만들지 않습니다.</p></div>';
    root.innerHTML = `<div class="kk-operation-head"><div><strong>${escapeHtml(state.student.name)} 작품 갤러리</strong><small>${state.yearMonth} · private FAMILY_FILES</small></div>${manager() ? '<label class="kk-upload"><input id="kkArtworkUpload" hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple>이미지 추가</label>' : ''}</div>${manager() ? '<div id="kkArtworkDrop" class="kk-dropzone">이미지를 이곳에 놓거나 이미지 추가를 선택하세요.</div>' : ''}<div class="kk-artwork-grid">${cards}</div><p data-feedback class="kk-inline-feedback"></p>`;
    $('kkArtworkUpload')?.addEventListener('change', (event) => upload(event.target.files));
    const drop = $('kkArtworkDrop'); drop?.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('dragging'); }); drop?.addEventListener('dragleave', () => drop.classList.remove('dragging')); drop?.addEventListener('drop', (event) => { event.preventDefault(); drop.classList.remove('dragging'); upload(event.dataTransfer.files); });
    root.querySelectorAll('[data-trash]').forEach((button) => button.onclick = () => trash(button.dataset.trash));
  }

  async function upload(files) {
    if (!files?.length || !state.student) return;
    for (const file of [...files]) { const data = new FormData(); data.append('file', file); data.append('campusId', campusId()); data.append('studentId', state.student.id); data.append('classId', state.student.current_class_id || state.student.currentClassId || ''); data.append('lessonDate', `${state.yearMonth}-01`); try { await api('/api/kkumeum/artworks', {method:'POST', body:data}); } catch (error) { note('kkArtworkOperations', `${file.name}: ${error.message}`); return; } }
    await load(state.student.id); note('kkArtworkOperations', '작품을 private 저장소에 추가했습니다.');
  }
  async function trash(id) { if (!id || !window.confirm('이 작품을 휴지통으로 이동할까요?')) return; await api(`/api/kkumeum/artworks/${encodeURIComponent(id)}`, {method:'DELETE'}); await load(state.student.id); const undo = document.createElement('button'); undo.type='button'; undo.textContent='방금 삭제한 작품 복원'; undo.onclick=async()=>{await api(`/api/kkumeum/artworks/${encodeURIComponent(id)}/restore`, {method:'POST'}); await load(state.student.id);}; $('kkArtworkOperations').append(undo); }

  function growthSkillPicker(report, readOnly = false) {
    const catalog = state.growthSkillCatalog;
    if (!catalog?.categories) return '<p class="kk-skill-loading">성장 영역 카탈로그를 불러오는 중입니다.</p>';
    const selected = new Set(Array.isArray(report?.growthSkillCodes) ? report.growthSkillCodes : []);
    const max = Number(catalog.maxSelections || 5);
    return `<fieldset class="kk-growth-skill-picker" data-growth-skill-picker data-max="${max}" data-read-only="${readOnly ? 'true' : 'false'}"><legend>성장 영역 <output data-growth-skill-count>${selected.size} / ${max}</output></legend><p>이번 달에 관찰하거나 지도한 영역만 선택합니다.</p><div class="kk-growth-skill-groups">${catalog.categories.map((category) => `<section><strong>${escapeHtml(category.labelKo)}</strong><div>${category.skills.map((skill) => `<label class="kk-growth-skill-chip"><input type="checkbox" name="growthSkillCodes" value="${escapeHtml(skill.code)}" data-growth-skill ${selected.has(skill.code) ? 'checked' : ''} ${readOnly ? 'disabled' : ''}><span>${escapeHtml(skill.labelKo)}</span></label>`).join('')}</div></section>`).join('')}</div></fieldset>`;
  }

  function bindGrowthSkillPicker(root) {
    const picker = root.querySelector('[data-growth-skill-picker]');
    if (!picker || picker.dataset.readOnly === 'true') return;
    const max = Number(picker.dataset.max || 5);
    const inputs = [...picker.querySelectorAll('[data-growth-skill]')];
    const count = picker.querySelector('[data-growth-skill-count]');
    const sync = () => {
      const selected = inputs.filter((input) => input.checked).length;
      if (count) count.textContent = `${selected} / ${max}`;
      inputs.forEach((input) => { input.disabled = !input.checked && selected >= max; });
    };
    inputs.forEach((input) => input.addEventListener('change', sync));
    sync();
  }

  function guardianConfirmationLabel(report) {
    if (!report?.guardianConfirmed || !report?.guardianFirstReadAt) return '보호자 확인 전';
    return `보호자 확인 ${String(report.guardianFirstReadAt).slice(0, 10)}`;
  }

  function filteredDeliveryReports(reports, filter) {
    const sent = reports.filter((report) => report.status === 'sent');
    if (filter === 'unconfirmed') return sent.filter((report) => !report.guardianConfirmed || !report.guardianFirstReadAt);
    if (filter === 'confirmed') return sent.filter((report) => report.guardianConfirmed && report.guardianFirstReadAt);
    return sent;
  }

  function deliveryHistory() {
    const reports = filteredDeliveryReports(state.reports, state.deliveryFilter);
    const options = [
      ['all', '전체 전달 이력'],
      ['unconfirmed', '보호자 확인 전'],
      ['confirmed', '보호자 확인 완료'],
    ].map(([value, label]) => `<option value="${value}" ${value === state.deliveryFilter ? 'selected' : ''}>${label}</option>`).join('');
    const items = reports.map((item) => `<span>${escapeHtml(item.yearMonth)} 전달 완료 · ${escapeHtml(guardianConfirmationLabel(item))}</span>`).join('') || '<span>전달 이력이 없습니다.</span>';
    return `<div class="kk-history"><div class="kk-history-head"><strong>전달 이력</strong><label>확인 상태 <select id="kkDeliveryFilter">${options}</select></label></div><div class="kk-history-items">${items}</div></div>`;
  }

  function bindDeliveryFilter(root) {
    root.querySelector('#kkDeliveryFilter')?.addEventListener('change', (event) => {
      state.deliveryFilter = ['all', 'unconfirmed', 'confirmed'].includes(event.target.value) ? event.target.value : 'all';
      root.querySelector('.kk-history')?.replaceWith(document.createRange().createContextualFragment(deliveryHistory()));
      bindDeliveryFilter(root);
    });
  }

  function reportForm() {
    const root = $('kkReportOperations'); if (!root || !state.student) return;
    const report = currentReport(); const readOnly = report?.status === 'sent'; const growth = report?.growthPoints?.growth || '';
    root.innerHTML = `<div class="kk-operation-head"><div><strong>${escapeHtml(state.student.name)} 월간 평가</strong><small>${state.yearMonth} · ${report?.status || '미작성'}</small></div></div><form id="kkReportForm" class="kk-report-form"><label><span>잘된 점</span><textarea name="strengths" ${readOnly ? 'readonly' : ''}>${escapeHtml(report?.title || '')}</textarea></label><label><span>성장한 부분</span><textarea name="growth" ${readOnly ? 'readonly' : ''}>${escapeHtml(growth)}</textarea></label>${growthSkillPicker(report, readOnly)}<label><span>보완할 부분</span><textarea name="improvements" ${readOnly ? 'readonly' : ''}>${escapeHtml(report?.teacherNote || '')}</textarea></label><label><span>다음 달 목표</span><textarea name="nextMonthFocus" ${readOnly ? 'readonly' : ''}>${escapeHtml(report?.nextMonthFocus || '')}</textarea></label><label><span>종합 평가</span><textarea name="evaluationText" ${readOnly ? 'readonly' : ''}>${escapeHtml(report?.evaluationText || '')}</textarea></label><div class="kk-report-actions">${readOnly ? '<button data-revise type="button">개정 작성</button>' : '<button type="submit">임시저장</button><button data-ai type="button">AI 초안</button>'}${report && !readOnly ? `<button data-next="${report.status === 'draft' ? 'ready' : 'send'}" type="button">${report.status === 'draft' ? '검토 완료' : '보호자 전달'}</button>` : ''}</div><p data-feedback class="kk-inline-feedback"></p></form>${deliveryHistory()}`;
    $('kkReportForm').onsubmit = async (event) => { event.preventDefault(); await saveReport(new FormData(event.currentTarget)); };
    bindGrowthSkillPicker($('kkReportForm'));
    bindDeliveryFilter(root);
    root.querySelector('[data-ai]')?.addEventListener('click', generate); root.querySelector('[data-next]')?.addEventListener('click', (event) => transition(event.currentTarget.dataset.next)); root.querySelector('[data-revise]')?.addEventListener('click', revise);
  }
  function payload(form) { return {campusId:campusId(),studentId:state.student.id,yearMonth:state.yearMonth,title:form.get('strengths') || '',summary:'교사가 검토한 월간 성장 기록',teacherNote:form.get('improvements') || '',growthPoints:{growth:form.get('growth') || ''},growthSkillCodes:form.getAll('growthSkillCodes'),nextMonthFocus:form.get('nextMonthFocus') || '',evaluationText:form.get('evaluationText') || ''}; }
  async function saveReport(form) { const report=currentReport(); if (report) await api(`/api/kkumeum/reports/${encodeURIComponent(report.id)}`, {method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(payload(form))}); else await api('/api/kkumeum/reports',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload(form))}); await load(state.student.id); note('kkReportOperations','월간 평가를 저장했습니다.'); }
  async function generate() { try { const result=await api('/api/kkumeum/reports/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({campusId:campusId(),studentId:state.student.id,yearMonth:state.yearMonth})}); if(result.available){const form=$('kkReportForm');form.elements.strengths.value=result.draft.title||'';form.elements.growth.value=result.draft.growthPoints?.growth||'';form.elements.nextMonthFocus.value=result.draft.nextMonthFocus||'';form.elements.evaluationText.value=result.draft.evaluationText||'';}}catch(error){note('kkReportOperations', error.body?.message || error.message || 'AI 초안 제공자가 아직 연결되지 않았습니다.');} }
  async function transition(action) { const report=currentReport(); if(!report || (action==='send' && !window.confirm('검토한 평가를 보호자에게 전달할까요?')))return; await api(`/api/kkumeum/reports/${encodeURIComponent(report.id)}/${action}`,{method:'POST'}); await load(state.student.id); }
  function revise() { const report=currentReport(); dialog('전달 완료 평가 개정',`<label><span>개정 내용</span><textarea name="evaluationText" required>${escapeHtml(report.evaluationText || '')}</textarea></label>${growthSkillPicker(report)}`,async(form)=>{await api(`/api/kkumeum/reports/${encodeURIComponent(report.id)}/revise`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({evaluationText:form.get('evaluationText'),growthSkillCodes:form.getAll('growthSkillCodes')})});await load(state.student.id);},bindGrowthSkillPicker); }

  function guardians() {
    const root=$('kkGuardianOperations'); if(!root||!state.student||!manager())return;
    const rows=state.guardians.map((item)=>`<article class="kk-guardian-row"><div><strong>${escapeHtml(item.displayName)}</strong><small>${escapeHtml(item.loginId)} · ${escapeHtml(item.relationshipLabel||'관계 미지정')} · ${item.status==='active'?'활성':'중지'}</small></div><div><button data-reset="${escapeHtml(item.id)}" type="button">비밀번호 재설정</button><button data-revoke="${escapeHtml(item.id)}" type="button">세션 종료</button>${item.status==='active'?`<button data-disable="${escapeHtml(item.id)}" type="button">중지</button>`:''}<button data-unlink="${escapeHtml(item.id)}" type="button">연결 해제</button></div></article>`).join('')||'<div class="kk-empty"><strong>연결된 보호자가 없습니다.</strong><p>실제 보호자 정보를 입력할 때만 연결을 만드세요.</p></div>';
    root.innerHTML=`<div class="kk-operation-head"><div><strong>${escapeHtml(state.student.name)} 보호자 연결</strong><small>원장·최고관리자만 관리할 수 있습니다.</small></div><button id="kkAddGuardian" type="button">보호자 연결</button></div>${rows}<p data-feedback class="kk-inline-feedback"></p>`;
    $('kkAddGuardian').onclick=addGuardian; root.querySelectorAll('[data-reset]').forEach((button)=>button.onclick=()=>resetGuardian(button.dataset.reset));root.querySelectorAll('[data-revoke]').forEach((button)=>button.onclick=()=>revokeGuardian(button.dataset.revoke));root.querySelectorAll('[data-disable]').forEach((button)=>button.onclick=()=>disableGuardian(button.dataset.disable));root.querySelectorAll('[data-unlink]').forEach((button)=>button.onclick=()=>unlinkGuardian(button.dataset.unlink));
  }
  function addGuardian(){dialog('보호자 연결','<label><span>보호자 표시 이름</span><input name="displayName" required maxlength="100"></label><label><span>로그인 ID</span><input name="loginId" required pattern="[a-z0-9._-]{3,120}" maxlength="120"></label><label><span>관계</span><input name="relationshipLabel" maxlength="80" placeholder="예: 부모"></label><label><span><input type="checkbox" name="canViewReports" checked> 평가 열람 허용</span></label><label><span><input type="checkbox" name="canViewPhotos" checked> 작품 열람 허용</span></label>',async(form)=>{const result=await api('/api/kkumeum/guardians',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({campusId:campusId(),studentId:state.student.id,displayName:form.get('displayName'),loginId:form.get('loginId'),relationshipLabel:form.get('relationshipLabel'),canViewReports:form.get('canViewReports')==='on',canViewPhotos:form.get('canViewPhotos')==='on'})});await load(state.student.id);note('kkGuardianOperations',`임시 비밀번호: ${result.temporaryPassword} (새로고침하면 다시 표시되지 않습니다.)`);});}
  async function resetGuardian(id){if(!id||!window.confirm('비밀번호를 재설정할까요? 기존 세션은 종료됩니다.'))return;const result=await api(`/api/kkumeum/guardians/${encodeURIComponent(id)}/reset-password`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({campusId:campusId(),studentId:state.student.id})});note('kkGuardianOperations',`임시 비밀번호: ${result.temporaryPassword} (새로고침하면 다시 표시되지 않습니다.)`);}
  async function revokeGuardian(id){if(!id||!window.confirm('현재 보호자 로그인 세션을 모두 종료할까요?'))return;await api(`/api/kkumeum/guardians/${encodeURIComponent(id)}/revoke-sessions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({campusId:campusId(),studentId:state.student.id})});note('kkGuardianOperations','보호자 로그인 세션을 종료했습니다.');}
  async function disableGuardian(id){if(!id||!window.confirm('보호자 계정을 중지할까요? 활성 세션도 종료됩니다.'))return;await api(`/api/kkumeum/guardians/${encodeURIComponent(id)}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({campusId:campusId(),studentId:state.student.id,status:'disabled'})});await load(state.student.id);}
  async function unlinkGuardian(id){if(!id||!window.confirm('이 학생과 보호자의 연결을 해제할까요?'))return;await api(`/api/kkumeum/guardians/${encodeURIComponent(id)}/unlink`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({campusId:campusId(),studentId:state.student.id})});await load(state.student.id);}

  async function load(studentId) {
    const student = await api(`/api/kkumeum/students/${encodeURIComponent(studentId)}?campusId=${encodeURIComponent(campusId())}`);
    state.student=student.student;
    const calls=[api(`/api/kkumeum/artworks?campusId=${encodeURIComponent(campusId())}&studentId=${encodeURIComponent(studentId)}`),api(`/api/kkumeum/reports?campusId=${encodeURIComponent(campusId())}&studentId=${encodeURIComponent(studentId)}`),api('/api/kkumeum/growth-skills/catalog')]; if(manager())calls.push(api(`/api/kkumeum/guardians?campusId=${encodeURIComponent(campusId())}&studentId=${encodeURIComponent(studentId)}`));
    const [artworks,reports,catalog,guardianResult]=await Promise.all(calls); state.artworks=(artworks.artworks||[]).filter((item)=>String(item.lessonDate||item.createdAt||'').slice(0,7)===state.yearMonth);state.reports=reports.reports||[];state.growthSkillCatalog=catalog;state.guardians=guardianResult?.guardians||[];renderDetail();renderArtworks();reportForm();guardians();
  }
  function ready(){if(!app())return;const nav=document.querySelector('.kk-manager-nav');if(nav)nav.hidden=!manager();const guardianSection=$('kkGuardiansSection');if(guardianSection)guardianSection.hidden=!manager();overview();}
  window.addEventListener('kkumeum:ready',ready);window.addEventListener('kkumeum:students-updated',overview);window.addEventListener('kkumeum:select-student',(event)=>load(event.detail.studentId).catch((error)=>{const root=$('kkStudentDetail');root.hidden=false;root.textContent=error.message||'학생 정보를 불러오지 못했습니다.';}));if(app())ready();
})();
