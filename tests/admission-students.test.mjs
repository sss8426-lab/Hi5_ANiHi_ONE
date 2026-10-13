import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { libraryHarness, users } from './support/library-harness.mjs';

// Synthetic students only. 학생 관리 = one list for every teacher, one row per student.
const legacy = { version: 1, settings: {}, universities: [], admissionGradeRules: [], cases: [], awardFolders: [], changeLogs: [],
  students: [{ id: 7, name: '가상학생 하나', studentType: 'current', gradeLevel: '고2' }, { id: 8, name: '가상학생 둘', studentType: 'result', admissionResults: [{ result: '합격' }] }] };
const api = '/api/admissions/students';

test('every teacher sees the same students; teachers add/edit; delete and 합격자 데이터로 넘기기 are for managers', async () => {
  const h = await libraryHarness();
  try {
    await h.env.FILES.put('state/admissions-data.json', JSON.stringify(legacy));
    const original = await (await h.env.FILES.get('state/admissions-data.json')).text();
    // Untagged students used to be master-only; now any campus teacher sees them.
    for (const user of [users.teacher, users.staff, users.foreign, users.campusAdmin]) {
      const data = await h.request('GET', '/api/data', user);
      assert.equal(data.status, 200, JSON.stringify(data.body));
      assert.deepEqual(data.body.students.map(s => s.name), ['가상학생 하나', '가상학생 둘'], user.id);
    }
    assert.equal((await h.request('GET', '/api/data', users.teacher)).body._students.canManage, false);
    assert.equal((await h.request('GET', '/api/data', users.campusAdmin)).body._students.canManage, true);
    assert.equal((await h.request('GET', api, users.outsider)).status, 403);
    assert.equal((await h.request('GET', api, null)).status, 401);

    const created = await h.request('POST', api, users.teacher, { students: [{ name: '가상학생 셋', entryYear: 2026, studentType: 'current', gpa: 3.2, track: '웹툰' }, { name: '가상학생 넷', entryYear: 2025, studentType: 'current' }] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const [three] = created.body.students;
    assert.ok(three.id > 8); assert.equal(three.entryYear, 2026);
    assert.equal((await h.request('POST', api, users.teacher, { student: { name: '', entryYear: 2026 } })).status, 400);
    assert.equal((await h.request('POST', api, users.teacher, { student: { name: 'x', entryYear: 1800 } })).status, 400);
    assert.equal((await h.request('POST', api, users.teacher, { student: { name: '가상 결과', studentType: 'result' } })).status, 403);

    const edited = await h.request('PATCH', `${api}/${three.id}`, users.foreign, { student: { ...three, gpa: 2.8 } });
    assert.equal(edited.status, 200); assert.equal(edited.body.student.gpa, 2.8);
    assert.equal((await h.request('PATCH', `${api}/${three.id}`, users.teacher, { student: { ...three, gpa: 4 } })).status, 409, 'stale revision');
    assert.equal((await h.request('PATCH', `${api}/${three.id}`, users.teacher, { student: { studentType: 'result' } })).status, 403);
    assert.equal((await h.request('DELETE', `${api}/${three.id}`, users.teacher)).status, 403);
    assert.equal((await h.request('PATCH', `${api}/${three.id}`, users.teacher, { student: { name: 'x' } }, 'https://attacker.invalid')).status, 403);
    const moved = await h.request('PATCH', `${api}/${three.id}`, users.campusAdmin, { student: { studentType: 'result' } });
    assert.equal(moved.status, 200); assert.equal(moved.body.student.studentType, 'result');
    assert.equal((await h.request('DELETE', `${api}/7`, users.director)).status, 200);
    const list = (await h.request('GET', api, users.staff)).body.students.map(s => s.name);
    assert.deepEqual(list, ['가상학생 둘', '가상학생 셋', '가상학생 넷']);

    // 희망 계열 options: any teacher adds one; everyone sees it; bad names refused.
    const added = await h.request('POST', `${api}/track-options`, users.teacher, { label: '  캐릭터   디자인 ' });
    assert.equal(added.status, 201); assert.deepEqual(added.body.trackOptions, ['캐릭터 디자인']);
    assert.equal((await h.request('POST', `${api}/track-options`, users.staff, { label: '캐릭터 디자인' })).body.trackOptions.length, 1, 'no duplicates');
    assert.equal((await h.request('POST', `${api}/track-options`, users.teacher, { label: '' })).status, 400);
    assert.equal((await h.request('POST', `${api}/track-options`, users.outsider, { label: 'x' })).status, 403);
    assert.deepEqual((await h.request('GET', '/api/data', users.foreign)).body._students.trackOptions, ['캐릭터 디자인']);

    // A whole-document save never touches students (nor the legacy copy of them).
    const doc = (await h.request('GET', '/api/data', users.admin)).body;
    doc.students = [];
    assert.equal((await h.request('PUT', '/api/data', users.admin, doc)).status, 200);
    assert.equal((await h.request('GET', api, users.staff)).body.students.length, 3);
    assert.deepEqual(JSON.parse(await (await h.env.FILES.get('state/admissions-data.json')).text()).students, JSON.parse(original).students);
  } finally { await h.mf.dispose(); }
});

test('학년 follows the 고1 year and the March school year; uploads map header names', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync('public/admissions-web/renderer/student-grades.js', 'utf8'), { window });
  const g = window.AdmissionsStudentGrades;
  assert.equal(g.schoolYear(new Date(2027, 1, 28)), 2026);
  assert.equal(g.schoolYear(new Date(2027, 2, 1)), 2027);
  assert.equal(g.entryYearFor(2, 2026), 2025);
  const at = new Date(2026, 9, 12);
  assert.deepEqual([1, 2, 3].map(n => g.gradeOf({ entryYear: 2026 - n + 1 }, at).grade), [1, 2, 3]);
  assert.equal(g.gradeOf({ entryYear: 2026 }, new Date(2027, 2, 2)).grade, 2, 'next March 고1 → 고2');
  assert.equal(g.gradeOf({ entryYear: 2023 }, at).graduated, true);
  assert.deepEqual(JSON.parse(JSON.stringify(g.gradeOf({ gradeLevel: '고2' }, at))), { grade: 2, graduated: false, entryYear: null, fromYear: false });
  assert.equal(g.gradeOf({}, at).grade, null);
  const rows = g.parseCsv('\uFEFF번호,학생명,내신,희망 계열,메모\r\n1,"가상, 하나",3.2,웹툰,"메모 ""인용"""\n2,가상 둘,,애니메이션,\n');
  assert.deepEqual(JSON.parse(JSON.stringify(g.mapRows(rows.map(r => r.map(c => c.replace(/^\uFEFF/, '')))))), [
    { name: '가상, 하나', gpa: 3.2, track: '웹툰', consultMemo: '메모 "인용"' }, { name: '가상 둘', track: '애니메이션' }]);
  assert.throws(() => g.mapRows([['번호', '점수']]), /이름/);
});

test('로드맵 홈 first, 지원 전략 removed, 학생 관리 tabs by 학년 with 추천 대학', () => {
  const html = fs.readFileSync('public/admissions-web/renderer/index.html', 'utf8');
  const app = fs.readFileSync('public/admissions-web/renderer/app.js', 'utf8');
  assert.match(html, /<button class="active" data-page="home">로드맵 홈<\/button>/);
  assert.doesNotMatch(html, /data-page="strategy"|id="strategy"/);
  assert.match(app, /const ADMISSIONS_HOME = 'home';/);
  assert.match(app, /\$\{tab\('g1','고1',c\.g1\)\}\$\{tab\('g2','고2',c\.g2\)\}\$\{tab\('g3','고3',c\.g3\)\}/);
  assert.match(app, /STUDENT_DIVISIONS = \[\['design','디자인'\],\['anim','애니'\]\]/);
  assert.match(app, /\$\{text\} <b>\(\$\{count\}\)<\/b>/);
  assert.doesNotMatch(app, /roadmap-stat/);
  // A searched or edited name never stays: tabs, save, delete, upload and leaving the page reset the list.
  assert.doesNotMatch(app, /state\.studentSearch=name/);
  assert.ok((app.match(/resetStudentView\(\);/g) || []).length >= 6);
  assert.match(app, /if\(page !== activePageId\(\)\)\{ resetPageView\(page\); window\.scrollTo\(0, 0\); \}/);
  assert.match(app, /const first = order\.find\(\(\[key, tab\]\) => studentGradeCounts\(key\)\[tab\] > 0\);/, '학생 관리 opens on a tab that has students');
  assert.match(app, /합격자 데이터로 넘기기/);
  assert.match(app, /\(matched\.length \? matched : dashboardUniversitiesForTrack\(track\)\)\.map\(u => \(\{ u, p: scoreUniversity\(u, gpa, skill\) \}\)\)/);
  // 실기능력 · 전공 계열(디자인/애니) · 희망 계열(실기 유형) wait for the row 저장; 관리 = 수정 · 저장 · 삭제.
  assert.match(app, /const BASE_HOPE_TRACKS = \['기초소양', '기초디자인', '발상과표현', '상황표현', '칸만화', '이미지보드', '포트폴리오'\];/);
  assert.match(app, /data-row-field="division"/); assert.match(app, /data-row-field="track"/); assert.match(app, /data-row-field="skillLevel"/);
  assert.match(app, />수정<\/button><button class="btn mini primary" type="button" \$\{editorOpen \? 'data-editor-save' : `data-row-save=/);
  assert.doesNotMatch(app, /track: trackLabelOf/, '전공 계열 never overwrites 희망 계열');
  // 실기 점수 is gone everywhere; 실기능력 is A+ · A0 · A- · B+ · B0 · B- · C.
  assert.match(app, /const SKILL_LEVELS = \['A\+','A0','A-','B\+','B0','B-','C'\];/);
  assert.doesNotMatch(app, /<th>실기점수<\/th>|id="editStudentSkill"|<dt>실기점수<\/dt>/);
  assert.match(app, /const deleteButton = manager \?/);
});
