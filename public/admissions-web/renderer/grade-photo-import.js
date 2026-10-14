// 성적표 사진 넣기: a teacher drops photos (or whole student folders) on a grade tab; every photo is read by
// AI, matched to a student of that tab (folder name first, then the name printed on the report) and saved
// into 상세 학생부. Certain values are saved straight away; doubtful ones are saved too but listed in the
// student's gradeReview so a teacher can check them against the photo later. Nothing already entered is
// overwritten: a different value becomes a "기존 값과 다름" item instead.
(() => {
  const h = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const FIELDS = ['credits', 'grade', 'rawScore', 'averageScore', 'standardDeviation', 'achievement', 'rank', 'studentCount'];
  const FIELD_LABEL = { credits: '단위수', grade: '석차등급', rawScore: '원점수', averageScore: '평균', standardDeviation: '표준편차', achievement: '성취도', rank: '석차', studentCount: '수강자수', subjectName: '과목명', schoolYear: '학년', semester: '학기' };
  const SOCIAL = new Set(['SOCIAL', 'KOREAN_HISTORY', 'HISTORY', 'ETHICS']);
  const TERM_KEY = g => g === 'KOREAN' ? 'korean' : g === 'ENGLISH' ? 'english' : g === 'MATH' ? 'math' : SOCIAL.has(g) ? 'social' : g === 'SCIENCE' ? 'science' : null;
  const CUTS = { 5: [10, 34, 66, 90, 100], 9: [4, 11, 23, 40, 60, 77, 89, 96, 100] };
  const ART_DIR = /평소작|포폴|포트폴리오|그림|작품/;
  const ART_FILE = /^(그림|입선)|창작|모작|포폴|포트폴리오/;
  const MAX_SIDE = 2400, CONCURRENCY = 4, PHOTO_LIMIT = 600;
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const str = v => v === null || v === undefined ? '' : String(v).trim();
  const same = (a, b) => str(a) === str(b) || (num(a) !== null && num(a) === num(b) && /^[\d.]+$/.test(str(a)) && /^[\d.]+$/.test(str(b)));
  const nameKey = n => String(n || '').replace(/\(.*?\)/g, '').replace(/[-_\s]+$/g, '').replace(/\s+/g, '').trim();
  const subjectKey = n => String(n || '').replace(/\s+/g, '').replace(/Ⅰ/g, 'I').replace(/Ⅱ/g, 'II').replace(/Ⅲ/g, 'III').replace(/[·ㆍ•‧∙.]/g, '').toLowerCase();
  const rowKey = r => `${r.schoolYear}|${r.semester}|${subjectKey(r.subjectName)}`;
  const today = () => new Date().toISOString().slice(0, 10);
  const uid = p => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  /** 석차/수강자수 → the 석차등급 it should be (cumulative headcount rounded, as schools do). */
  function expectedGrade(rank, count, scale) {
    const r = num(rank), c = num(count), cuts = CUTS[scale];
    if (!cuts || !r || !c || r > c) return null;
    for (let i = 0; i < cuts.length; i++) if (r <= Math.round(c * cuts[i] / 100)) return i + 1;
    return cuts.length;
  }
  function scaleOf(student, reading) {
    if (reading?.gradeScale === '5등급') return 5;
    if (reading?.gradeScale === '9등급') return 9;
    return Number(student?.entryYear) >= 2025 ? 5 : 9;
  }

  // ---------- files ----------
  async function entriesFromDrop(dataTransfer) {
    const out = [];
    const walk = (entry, prefix) => new Promise(resolve => {
      if (entry.isFile) entry.file(file => { out.push({ file, path: prefix + file.name }); resolve(); }, () => resolve());
      else if (entry.isDirectory) {
        const reader = entry.createReader(), all = [];
        const next = () => reader.readEntries(async batch => {
          if (!batch.length) { for (const child of all) await walk(child, `${prefix}${entry.name}/`); resolve(); }
          else { all.push(...batch); next(); }
        }, () => resolve());
        next();
      } else resolve();
    });
    const roots = [...dataTransfer.items].map(item => item.webkitGetAsEntry?.()).filter(Boolean);
    if (!roots.length) return [...dataTransfer.files].map(file => ({ file, path: file.name }));
    for (const entry of roots) await walk(entry, '');
    return out;
  }
  const fromInput = files => [...files].map(file => ({ file, path: file.webkitRelativePath || file.name }));
  async function shrink(file) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('사진을 줄이지 못했습니다.')), 'image/jpeg', 0.86));
  }
  async function readPhoto(blob, gradeHint) {
    const form = new FormData();
    form.append('image', new File([blob], 'report.jpg', { type: 'image/jpeg' }));
    form.append('gradeHint', gradeHint);
    for (let attempt = 0; ; attempt++) {
      const response = await fetch('/api/admissions/grade-photos/read', { method: 'POST', body: form, credentials: 'same-origin' });
      const body = await response.json().catch(() => ({}));
      if (response.ok) return body;
      if ((response.status === 429 || response.status >= 500) && attempt < 2) { await new Promise(r => setTimeout(r, 4000 * (attempt + 1))); continue; }
      throw Error(body.error || '사진을 읽지 못했습니다.');
    }
  }
  async function uploadReport(blob, name, campusId) {
    const form = new FormData();
    form.append('file', new File([blob], name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }));
    form.append('purpose', 'student-artwork'); form.append('ownerId', 'student');
    if (campusId) form.append('campusId', campusId);
    const response = await fetch('/api/upload', { method: 'POST', body: form });
    const uploaded = response.ok ? await response.json().catch(() => null) : null;
    if (!uploaded?.path) throw Error('성적표 사진을 보관하지 못했습니다.');
    return uploaded;
  }
  async function listStudents() {
    const response = await fetch('/api/admissions/students', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw Error('학생 목록을 불러오지 못했습니다.');
    return (await response.json()).students || [];
  }

  // ---------- merging into a student ----------
  function validate(row, scale) {
    const issues = [];
    for (const field of row.uncertainFields || []) if (str(row[field]) || field === 'grade') issues.push({ kind: 'warn', field, value: str(row[field]), reason: '사진이 흐리거나 잘려 확실하지 않음' });
    const g = num(row.grade), expected = expectedGrade(row.rank, row.studentCount, scale);
    if (g !== null && g > scale) issues.push({ kind: 'error', field: 'grade', value: str(row.grade), reason: `${scale}등급제인데 ${g}등급` });
    else if (g !== null && expected && expected !== g) issues.push({ kind: 'error', field: 'grade', value: str(row.grade), reason: `석차 ${row.rank}/${row.studentCount}은 ${expected}등급 범위인데 ${g}등급 (동석차면 맞을 수 있음)` });
    return issues;
  }
  function mergeInto(student, readings) {
    const rows = (student.detailedTranscript || []).map(r => ({ ...r }));
    const byKey = new Map();
    rows.forEach(r => { const k = rowKey(r); byKey.set(k, byKey.has(k) ? null : r); });
    const review = [], added = [], filledCells = [];
    for (const { reading, reportId } of readings) {
      const scale = scaleOf(student, reading);
      for (const raw of reading.rows) {
        const incoming = { schoolYear: raw.schoolYear, semester: raw.semester, subjectGroup: raw.subjectGroup, subjectName: raw.subjectName, subjectType: raw.subjectType, notes: raw.notes };
        for (const f of FIELDS) incoming[f] = str(raw[f]);
        const key = rowKey(incoming), where = `${incoming.schoolYear} ${incoming.semester}`.trim();
        const issues = validate(raw, scale).map(i => ({ ...i, id: uid('rv'), key, subjectName: incoming.subjectName, where, reportId }));
        const existing = byKey.get(key);
        if (existing === undefined) {
          const row = { id: uid('dt'), studentId: student.id, ...incoming, percentile: '' };
          rows.push(row); byKey.set(key, row); added.push(row); review.push(...issues);
          continue;
        }
        if (existing === null) { review.push({ id: uid('rv'), kind: 'warn', key, subjectName: incoming.subjectName, where, field: 'subjectName', value: incoming.subjectName, reason: '같은 학기에 같은 과목이 두 줄 있어 자동으로 넣지 않음', reportId }); continue; }
        for (const f of [...FIELDS, 'subjectGroup', 'subjectType']) {
          const now = str(existing[f]), next = str(incoming[f]);
          if (!next || same(now, next)) continue;
          if (!now) { existing[f] = next; filledCells.push(f); continue; }
          if (FIELDS.includes(f)) review.push({ id: uid('rv'), kind: 'diff', key, subjectName: existing.subjectName, where, field: f, value: now, incoming: next, reason: `이미 입력된 값 ${now}, 사진에서 읽은 값 ${next}`, reportId });
        }
        // A doubt about the photo only matters if that photo's value is the one now stored.
        review.push(...issues.filter(i => same(existing[i.field], i.value)));
      }
    }
    // The same subject read from two photos (요약본 + 상세본) must not list the same doubt twice.
    const seen = new Set((student.gradeReview || []).map(r => `${r.key}|${r.field}|${r.kind}`));
    const unique = review.filter(r => { const k = `${r.key}|${r.field}|${r.kind}`; if (seen.has(k)) return false; seen.add(k); return true; });
    return { rows, review: unique, added, filledCells };
  }
  function fillTermGrades(student, rows) {
    const calc = {};
    for (const r of rows) {
      const k = TERM_KEY(r.subjectGroup), g = num(r.grade), y = /^([123])학년$/.exec(r.schoolYear)?.[1], t = /^([12])학기$/.exec(r.semester)?.[1];
      if (!k || g === null || !y || !t) continue;
      const w = num(r.credits) || 1, c = ((calc[`grade${y}`] ??= {})[`semester${t}`] ??= {})[k] ??= { sum: 0, w: 0 };
      c.sum += g * w; c.w += w;
    }
    const termGrades = JSON.parse(JSON.stringify(student.termGrades || {})), filled = [];
    for (const [gk, sems] of Object.entries(calc)) for (const [sk, subj] of Object.entries(sems)) {
      const cur = termGrades[gk]?.[sk];
      if (cur && ['korean', 'english', 'math', 'social', 'science'].some(k => cur[k] !== '' && cur[k] != null)) continue;
      const next = { korean: '', english: '', math: '', social: '', science: '' };
      for (const [k, c] of Object.entries(subj)) next[k] = Math.round(c.sum / c.w * 100) / 100;
      (termGrades[gk] ??= {})[sk] = next; filled.push(`${gk.slice(5)}-${sk.slice(8)}`);
    }
    let gpa = null;
    if (student.gpa === '' || student.gpa == null || Number(student.gpa) === 0) {
      let a = 0, w = 0;
      for (const r of rows) { const g = num(r.grade); if (g === null || !TERM_KEY(r.subjectGroup)) continue; const cw = num(r.credits) || 1; a += g * cw; w += cw; }
      if (w) gpa = Math.round(a / w * 100) / 100;
    }
    return { termGrades, filled, gpa };
  }
  async function saveStudent(student, items, session) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = (await listStudents()).find(s => String(s.id) === String(student.id));
      if (!current) throw Error('학생을 찾을 수 없습니다.');
      if (!session.before.has(current.id)) session.before.set(current.id, JSON.parse(JSON.stringify(current)));
      const reports = [];
      for (const item of items) {
        if (!item.uploaded) item.uploaded = await uploadReport(item.blob, item.file.name, current.campusId || '');
        reports.push({ id: item.uploaded.dataCoreFileId || item.uploaded.id || uid('rp'), dataCoreFileId: item.uploaded.dataCoreFileId || '', path: item.uploaded.path, name: item.file.name, readAt: today(), batch: session.id });
      }
      const merged = mergeInto(current, items.map((item, i) => ({ reading: item.reading, reportId: reports[i].id })));
      const term = fillTermGrades(current, merged.rows);
      const known = new Set((current.gradeReports || []).map(r => r.path));
      const memoLine = `성적표 사진 자동 입력 (${today()}): 사진 ${items.length}장 · 새 과목 ${merged.added.length}개${merged.review.length ? ` · 확인 필요 ${merged.review.length}곳` : ''}`;
      const next = {
        ...current, detailedTranscript: merged.rows, termGrades: term.filled.length ? term.termGrades : current.termGrades,
        ...(term.gpa !== null ? { gpa: term.gpa } : {}),
        gradeReports: [...(current.gradeReports || []), ...reports.filter(r => !known.has(r.path))],
        gradeReview: [...(current.gradeReview || []), ...merged.review],
        consultMemo: [current.consultMemo || '', memoLine].filter(Boolean).join('\n'),
      };
      try {
        const saved = await window.desktopAPI.updateStudent(next);
        return { saved, added: merged.added.length, filled: term.filled, review: merged.review };
      } catch (error) { if (attempt || !/먼저 수정/.test(error.message || '')) throw error; }
    }
  }

  // ---------- UI ----------
  const STATUS = { saved: ['ok', '자동 저장됨'], review: ['w', '확인 필요'], pick: ['e', '학생 선택 필요'], none: ['n', '성적 자료 없음'], error: ['e', '저장 실패'], reading: ['n', '읽는 중'] };
  function modal(html) {
    let host = document.getElementById('gpiModal');
    if (!host) { host = document.createElement('div'); host.id = 'gpiModal'; host.className = 'gpi-scrim'; document.body.append(host); }
    host.innerHTML = `<div class="gpi-dialog" role="dialog" aria-modal="true">${html}</div>`;
    host.hidden = false;
    return host;
  }
  const close = () => { const host = document.getElementById('gpiModal'); if (host) { host.hidden = true; host.innerHTML = ''; } };

  function open({ divisionLabel, gradeLabel, entryYear, students, onChanged }) {
    const session = { id: uid('batch'), items: [], groups: new Map(), before: new Map(), running: false, done: false, filter: 'all', started: 0 };
    const targets = students.slice();
    const byName = new Map();
    targets.forEach(s => { const k = nameKey(s.name); byName.set(k, byName.has(k) ? null : s); });
    const gradeHint = `${gradeLabel} (${entryYear || ''}학년도 고1 입학)`;
    const warnLeave = e => { if (session.running) { e.preventDefault(); e.returnValue = ''; } };

    function pickFromPath(path) {
      for (const segment of path.split('/').slice(0, -1)) { const s = byName.get(nameKey(segment)); if (s) return s; }
      return null;
    }
    function skipReason(path) {
      const parts = path.split('/'), file = parts.pop();
      if (!/\.(jpe?g|png|webp|heic|heif)$/i.test(file)) return '사진 아님';
      if (parts.some(p => ART_DIR.test(p)) || ART_FILE.test(file)) return '그림 폴더·파일';
      return '';
    }
    function intro() {
      const host = modal(`<div class="gpi-head"><h2>성적표 사진 넣기</h2><button class="gpi-x" data-close aria-label="닫기">×</button></div>
        <p class="gpi-sub">사진이나 폴더를 한꺼번에 넣으면 AI가 모두 읽고, 학생과 학기를 찾아 알아서 입력합니다.</p>
        <div class="gpi-target"><span>넣을 학년</span><b>${h(divisionLabel)} · ${h(gradeLabel)} (${targets.length}명)</b><small>지금 보고 있는 탭 기준</small></div>
        <div class="gpi-drop" id="gpiDrop" tabindex="0"><b>사진이나 학년 폴더를 통째로 끌어다 놓으세요</b>
          <p>학생 이름 폴더가 있으면 폴더 이름으로, 없으면 성적표에 찍힌 이름으로 학생을 찾습니다.<br>휴대폰 사진·학교 앱 캡처·스캔 모두 가능 · 그림·증명사진은 자동으로 건너뜁니다.</p>
          <div class="gpi-pick"><label class="btn primary">폴더 선택<input type="file" id="gpiFolder" webkitdirectory multiple hidden></label><label class="btn">사진 선택<input type="file" id="gpiFiles" accept="image/*" multiple hidden></label></div></div>
        <ul class="gpi-how"><li><b>학생 찾기</b> 폴더 이름 → 성적표의 이름</li><li><b>학기 찾기</b> 성적표 제목, 없으면 과목명</li><li><b>자동 저장</b> 애매한 칸만 따로 모아 보여줌</li></ul>
        <p class="gpi-note">이미 입력된 성적은 덮어쓰지 않고, 다른 값만 "확인 필요"로 표시합니다. 사진은 학생별 비공개 성적 자료로 보관되고 그림 목록에는 넣지 않습니다.</p>`);
      host.querySelector('[data-close]').onclick = close;
      const start = list => begin(list);
      host.querySelector('#gpiFolder').onchange = e => start(fromInput(e.target.files));
      host.querySelector('#gpiFiles').onchange = e => start(fromInput(e.target.files));
      const drop = host.querySelector('#gpiDrop');
      drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
      drop.ondragleave = () => drop.classList.remove('over');
      drop.ondrop = async e => { e.preventDefault(); drop.classList.remove('over'); start(await entriesFromDrop(e.dataTransfer)); };
    }
    async function begin(list) {
      if (!list.length) return;
      if (list.length > PHOTO_LIMIT) { alert(`한 번에 사진 ${PHOTO_LIMIT}장까지 넣을 수 있습니다. 나눠서 넣어 주세요.`); return; }
      session.items = list.map(({ file, path }) => ({ id: uid('it'), file, path, student: pickFromPath(path), skip: skipReason(path), state: 'queued' }));
      session.items.forEach(item => { if (item.skip) item.state = 'skipped'; });
      session.folderStudents = new Set(session.items.map(i => i.student?.id).filter(Boolean));
      session.running = true; session.started = Date.now();
      window.addEventListener('beforeunload', warnLeave);
      render();
      const queue = session.items.filter(i => i.state === 'queued');
      let index = 0;
      const worker = async () => {
        while (index < queue.length) {
          const item = queue[index++];
          item.state = 'reading'; render();
          try {
            item.blob = await shrink(item.file);
            item.reading = await readPhoto(item.blob, gradeHint);
            if (item.reading.kind !== 'report' || !item.reading.rows.length) { item.state = 'skipped'; item.skip = item.reading.kind === 'report' ? '성적 행 없음' : '그림·사진'; }
            else {
              if (!item.student && item.reading.studentName) item.student = byName.get(nameKey(item.reading.studentName)) || null;
              item.state = item.student ? 'read' : 'pick';
            }
          } catch (error) { item.state = 'failed'; item.error = error.message; }
          render();
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      // Save per student once all its photos are read.
      const groups = new Map();
      for (const item of session.items.filter(i => i.state === 'read')) (groups.get(item.student.id) || groups.set(item.student.id, { student: item.student, items: [] }).get(item.student.id)).items.push(item);
      for (const group of groups.values()) await saveGroup(group);
      session.running = false; session.done = true;
      window.removeEventListener('beforeunload', warnLeave);
      render();
    }
    async function saveGroup(group) {
      const entry = session.groups.get(group.student.id) || { student: group.student, items: [], status: 'reading' };
      entry.items.push(...group.items); entry.status = 'saving'; session.groups.set(group.student.id, entry); render();
      try {
        const result = await saveStudent(group.student, group.items, session);
        entry.student = result.saved || entry.student; entry.added = (entry.added || 0) + result.added;
        entry.review = (result.saved?.gradeReview || []).filter(r => r.reportId && (result.saved.gradeReports || []).some(p => p.id === r.reportId && p.batch === session.id));
        entry.status = entry.review.length ? 'review' : 'saved';
        group.items.forEach(i => { i.state = 'saved'; });
        onChanged?.(result.saved);
      } catch (error) { entry.status = 'error'; entry.error = error.message; }
      render();
    }
    function summaryRows() {
      const rows = [...session.groups.values()].map(g => ({ kind: g.status, student: g.student, items: g.items, added: g.added, review: g.review || [], error: g.error }));
      for (const item of session.items.filter(i => i.state === 'pick')) rows.push({ kind: 'pick', item });
      for (const item of session.items.filter(i => i.state === 'failed')) rows.push({ kind: 'error', item, error: item.error });
      if (session.done) for (const id of session.folderStudents) if (!session.groups.has(id)) { const s = targets.find(t => t.id === id); if (s) rows.push({ kind: 'none', student: s, items: session.items.filter(i => i.student?.id === id) }); }
      return rows;
    }
    function render() {
      if (!session.items.length) return;
      const items = session.items, total = items.filter(i => i.state !== 'skipped' || i.reading).length || 1;
      const finished = items.filter(i => ['read', 'pick', 'failed', 'saved'].includes(i.state) || (i.state === 'skipped' && i.reading)).length;
      const pct = session.done ? 100 : Math.round(finished / total * 100);
      const rows = summaryRows();
      const count = k => rows.filter(r => r.kind === k).length;
      const shown = rows.filter(r => session.filter === 'all' || (session.filter === 'todo' ? ['review', 'pick', 'error'].includes(r.kind) : r.kind === session.filter));
      const minutes = Math.max(1, Math.round((Date.now() - session.started) / 60000));
      const skipped = items.filter(i => i.state === 'skipped').length;
      const host = modal(`<div class="gpi-head"><h2>성적표 사진 넣기 · ${h(divisionLabel)} ${h(gradeLabel)}</h2>
          ${session.done && session.before.size ? '<button class="btn" id="gpiUndo">이번에 넣은 것 모두 되돌리기</button>' : ''}<button class="btn primary" data-close ${session.running ? 'disabled' : ''}>${session.running ? '읽는 중…' : '완료'}</button></div>
        <div class="gpi-prog"><i style="width:${pct}%"></i></div>
        <p class="gpi-muted">${session.done ? `사진 ${items.length}장 처리 끝 · 약 ${minutes}분` : `사진 ${finished}/${total}장 읽음 · 창을 닫지 말고 기다려 주세요 (다른 탭은 사용 가능)`}</p>
        <div class="gpi-stats"><div class="ok"><span>자동 저장됨</span><b>${count('saved')}명</b></div><div class="w"><span>확인 필요</span><b>${count('review')}명</b></div><div class="e"><span>학생 선택·실패</span><b>${count('pick') + count('error')}건</b></div><div class="n"><span>성적 자료 없음</span><b>${count('none')}명</b></div><div><span>건너뛴 그림·사진</span><b>${skipped}장</b></div></div>
        <div class="gpi-filter">${[['all', `전체 ${rows.length}`], ['todo', `확인할 것만 ${count('review') + count('pick') + count('error')}`], ['saved', `자동 저장됨 ${count('saved')}`]].map(([k, t]) => `<button type="button" data-filter="${k}" class="${session.filter === k ? 'on' : ''}">${t}</button>`).join('')}</div>
        <div class="gpi-table"><table><thead><tr><th>상태</th><th>학생</th><th>사진</th><th>들어간 과목</th><th>할 일</th></tr></thead><tbody>
        ${shown.map(r => {
          const [cls, label] = STATUS[r.kind] || STATUS.reading;
          if (r.kind === 'pick') return `<tr class="e"><td><span class="gpi-badge ${cls}">${label}</span></td><td>${h(r.item.reading.studentName || '(이름 안 보임)')}<small>${h(r.item.path)}</small></td><td>1장</td><td>${r.item.reading.rows.length}과목</td><td><select data-pick="${r.item.id}"><option value="">학생 고르기…</option>${targets.map(s => `<option value="${h(s.id)}">${h(s.name)}</option>`).join('')}</select></td></tr>`;
          if (r.kind === 'error' && r.item) return `<tr class="e"><td><span class="gpi-badge e">읽기 실패</span></td><td>${h(r.item.student?.name || '')}<small>${h(r.item.path)}</small></td><td>1장</td><td>-</td><td>${h(r.error)} <button class="btn mini" data-retry="${r.item.id}">다시 읽기</button></td></tr>`;
          const rv = r.review || [];
          return `<tr class="${cls}"><td><span class="gpi-badge ${cls}">${r.kind === 'review' ? `${label} ${rv.length}곳` : label}</span></td><td><b>${h(r.student.name)}</b></td><td>${r.items.length}장</td><td>${r.kind === 'none' ? '-' : `새 과목 ${r.added || 0}개`}</td><td>${r.kind === 'review' ? `<button class="btn mini" data-review="${h(r.student.id)}">확인하기</button> <small>${h(rv.slice(0, 2).map(x => `${x.subjectName} ${FIELD_LABEL[x.field] || ''}`).join(', '))}</small>` : r.kind === 'none' ? '<small>폴더에 성적표 없음</small>' : r.kind === 'error' ? h(r.error) : '-'}</td></tr>`;
        }).join('') || `<tr><td colspan="5" class="gpi-muted">${session.running ? '읽은 사진이 학생별로 여기에 나옵니다…' : '표시할 학생이 없습니다.'}</td></tr>`}
        </tbody></table></div>
        <p class="gpi-muted">간편 성적·내신 평균은 비어 있는 학기만 채웁니다. "확인하기"에서 고친 값은 바로 저장됩니다.</p>`);
      host.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { session.filter = b.dataset.filter; render(); });
      host.querySelector('[data-close]').onclick = () => { if (!session.running) close(); };
      host.querySelectorAll('[data-review]').forEach(b => b.onclick = () => {
        const g = [...session.groups.values()].find(x => String(x.student.id) === b.dataset.review);
        if (g) review(g.student, saved => { g.student = saved; g.review = []; g.status = 'saved'; render(); }, render);
      });
      host.querySelectorAll('[data-pick]').forEach(sel => sel.onchange = async () => {
        const item = session.items.find(i => i.id === sel.dataset.pick), student = targets.find(s => String(s.id) === sel.value);
        if (!item || !student) return;
        item.student = student; item.state = 'read'; await saveGroup({ student, items: [item] });
      });
      host.querySelectorAll('[data-retry]').forEach(b => b.onclick = async () => {
        const item = session.items.find(i => i.id === b.dataset.retry); if (!item) return;
        item.state = 'reading'; render();
        try { item.blob ||= await shrink(item.file); item.reading = await readPhoto(item.blob, gradeHint); item.state = item.student ? 'read' : 'pick'; if (item.student) await saveGroup({ student: item.student, items: [item] }); }
        catch (error) { item.state = 'failed'; item.error = error.message; }
        render();
      });
      const undo = host.querySelector('#gpiUndo');
      if (undo) undo.onclick = async () => {
        if (!confirm(`이번에 넣은 ${session.before.size}명의 성적을 넣기 전으로 되돌릴까요?`)) return;
        undo.disabled = true;
        const all = await listStudents(); let ok = 0;
        for (const [id, before] of session.before) {
          const current = all.find(s => String(s.id) === String(id)); if (!current) continue;
          try { const saved = await window.desktopAPI.updateStudent({ ...before, gradeReports: before.gradeReports || [], gradeReview: before.gradeReview || [], detailedTranscript: before.detailedTranscript || [], termGrades: before.termGrades || {}, _revision: current._revision }); onChanged?.(saved); ok++; } catch { /* reported below */ }
        }
        alert(`${ok}명을 되돌렸습니다.${ok < session.before.size ? ` ${session.before.size - ok}명은 다른 선생님이 먼저 수정해 되돌리지 못했습니다.` : ''}`);
        session.before.clear(); session.groups.clear(); close();
      };
    }
    intro();
  }

  // ---------- 확인하기: one student's doubtful cells next to the photos ----------
  function review(student, onResolved, onBack) {
    const items = (student.gradeReview || []).slice();
    if (!items.length) return;
    const reports = student.gradeReports || [];
    const photo = id => reports.find(r => r.id === id);
    let active = items[0]?.reportId;
    const draw = () => {
      const current = photo(active) || reports[reports.length - 1];
      const host = modal(`<div class="gpi-head"><h2>확인하기 · ${h(student.name)}</h2><button class="btn" data-back>${onBack ? '목록으로' : '닫기'}</button><button class="btn primary" data-save>확인한 값 저장</button></div>
        <p class="gpi-sub">노란색 = 사진이 애매함, 빨간색 = 석차·등급이 서로 안 맞음, 파란색 = 이미 입력된 값과 다름. 값을 고치거나 그대로 두고 저장하면 목록에서 빠집니다.</p>
        <div class="gpi-review"><div class="gpi-table"><table><thead><tr><th>과목</th><th>항목</th><th>값</th><th>이유</th><th>사진</th></tr></thead><tbody>
        ${items.map(it => `<tr class="${it.kind === 'diff' ? 'd' : it.kind === 'error' ? 'e' : 'w'}"><td><b>${h(it.subjectName)}</b><small>${h(it.where || '')}</small></td><td>${h(FIELD_LABEL[it.field] || it.field)}</td>
          <td>${it.kind === 'diff' ? `<label><input type="radio" name="d_${it.id}" value="keep" checked> 기존 ${h(it.value)}</label><label><input type="radio" name="d_${it.id}" value="new"> 사진 ${h(it.incoming)}</label>` : `<input data-fix="${it.id}" value="${h(it.value)}">`}</td>
          <td><small>${h(it.reason)}</small></td><td>${photo(it.reportId) ? `<button class="btn mini" data-photo="${h(it.reportId)}">보기</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="gpi-photo">${current ? `<a href="${h(current.path)}" target="_blank" rel="noopener"><img src="${h(current.path)}" alt="${h(current.name)}"></a><small>${h(current.name)} · 누르면 크게 열림</small>` : '<p class="gpi-muted">보관된 사진이 없습니다.</p>'}</div></div>`);
      host.querySelectorAll('[data-photo]').forEach(b => b.onclick = () => { active = b.dataset.photo; draw(); });
      host.querySelector('[data-back]').onclick = () => onBack ? onBack() : close();
      host.querySelector('[data-save]').onclick = async e => {
        e.target.disabled = true;
        try {
          const current = (await listStudents()).find(s => String(s.id) === String(student.id));
          const rows = (current.detailedTranscript || []).map(r => ({ ...r }));
          for (const it of items) {
            const row = rows.find(r => rowKey(r) === it.key); if (!row) continue;
            if (it.kind === 'diff') { if (host.querySelector(`input[name="d_${it.id}"]:checked`)?.value === 'new') row[it.field] = it.incoming; }
            else { const v = host.querySelector(`[data-fix="${it.id}"]`)?.value?.trim() ?? it.value; row[it.field] = v; }
          }
          const done = new Set(items.map(i => i.id));
          // 간편 성적·내신 that were worked out from these rows follow the corrected values; ones a teacher typed stay.
          const empty = { ...current, termGrades: {}, gpa: '' };
          const was = fillTermGrades(empty, current.detailedTranscript || []), now = fillTermGrades(empty, rows);
          const termGrades = JSON.parse(JSON.stringify(current.termGrades || {}));
          for (const [gk, sems] of Object.entries(was.termGrades)) for (const [sk, value] of Object.entries(sems))
            if (JSON.stringify(termGrades[gk]?.[sk]) === JSON.stringify(value) && now.termGrades[gk]?.[sk]) termGrades[gk][sk] = now.termGrades[gk][sk];
          const gpa = was.gpa !== null && num(current.gpa) === was.gpa && now.gpa !== null ? now.gpa : current.gpa;
          const saved = await window.desktopAPI.updateStudent({ ...current, detailedTranscript: rows, termGrades, gpa, gradeReview: (current.gradeReview || []).filter(r => !done.has(r.id)) });
          student.gradeReview = saved.gradeReview; window.GradePhotoImport.onStudentSaved?.(saved);
          onResolved?.(saved); if (!onBack) close();
        } catch (error) { alert(error.message || '저장하지 못했습니다.'); e.target.disabled = false; }
      };
    };
    draw();
  }

  window.GradePhotoImport = { open, review, close, _test: { expectedGrade, mergeInto, fillTermGrades, nameKey, subjectKey, validate } };
})();
