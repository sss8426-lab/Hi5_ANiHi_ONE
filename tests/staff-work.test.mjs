import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { encode } from 'fast-png';
import { libraryHarness, users, A, B } from './support/library-harness.mjs';
import { firstSaturday, ruleDates, reportDeadline } from '../public/data-core/fixed-task-rules.js';

test('업무보고 마감: 매월 첫째 주 토요일, 첫 주가 3일 이하면 다음 주 토요일', () => {
  assert.equal(firstSaturday(2026, 10), '2026-10-10', '10월 1일이 목요일 → 첫 주 3일 → 다음 주');
  assert.equal(firstSaturday(2026, 11), '2026-11-07');
  assert.equal(firstSaturday(2026, 12), '2026-12-05');
  assert.equal(firstSaturday(2027, 1), '2027-01-09', '1일이 금요일 → 첫 주 2일');
  assert.equal(firstSaturday(2026, 8), '2026-08-08', '1일이 토요일 → 첫 주 1일');
  assert.equal(firstSaturday(2026, 7), '2026-07-04', '1일이 수요일 → 첫 주 4일이면 그 주 토요일');
  assert.equal(reportDeadline('2026-09'), '2026-10-10');
  assert.equal(reportDeadline('2026-12'), '2027-01-09');
  assert.deepEqual(ruleDates('month-end', null, 2026, 2), ['2026-02-28']);
  assert.deepEqual(ruleDates('month-day', 31, 2026, 4), ['2026-04-30']);
  assert.deepEqual(ruleDates('weekday', 1, 2026, 10), ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
});

const report = (extra = {}) => ({ month: '2026-09', done: [{ category: '홍보', text: '수상소식 블로그 업로드' }, { category: '없는분류', text: '분류는 운영으로' }],
  planned: [{ category: '상담', text: '중3 학부모 방문상담 준비' }], classes: [{ text: '기초디자인 형태·구조 지도' }],
  joins: { 고2: 2, 고1: 1 }, leaves: { 중1: 2 }, awards: [{ contest: '2026 서울여대 실기대회', prize: '동상', count: 1 }], ...extra });

test('월간 업무보고: 모든 직원이 읽고, 작성자만 고치며, 공감·댓글·읽음이 쌓인다', async () => {
  const h = await libraryHarness();
  try {
    const url = '/api/data-core/staff-reports';
    assert.equal((await h.request('GET', url + '?month=2026-09', null)).status, 401);
    const created = await h.request('POST', url, users.staff, { ...report(), campusId: A });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const id = created.body.report.id;
    assert.equal(created.body.report.campusId, A);
    assert.equal(created.body.report.body.done[1].category, '운영');
    assert.deepEqual(created.body.report.body.joins, { 초: 0, 중1: 0, 중2: 0, 중3: 0, 고1: 1, 고2: 2, 고3: 0 });
    assert.equal((await h.request('POST', url, users.staff, report())).status, 409, 'one report per person per month');
    assert.equal((await h.request('POST', url, users.foreign, { ...report(), campusId: A })).status, 403, 'only into your own campus');
    assert.equal((await h.request('POST', url, users.teacher, { month: '2026-09' })).status, 400, 'an empty report is refused');

    // Every staff member, from any campus, reads the shared list.
    const list = await h.request('GET', url + '?month=2026-09', users.foreign);
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.deepEqual(list.body.reports.map(r => r.id), [id]);
    assert.equal(list.body.deadline, '2026-10-10');
    assert.equal(list.body.submittedCount, 1);
    assert.equal(list.body.reports[0].canManage, false);
    assert.equal(list.body.reports[0].readCount, 0);

    // Opening a report marks it read for others, never for the author.
    await h.request('GET', `${url}/${id}?read=1`, users.staff);
    const opened = await h.request('GET', `${url}/${id}?read=1`, users.foreign);
    assert.equal(opened.body.report.readCount, 1);
    assert.deepEqual(opened.body.readers.map(r => r.name).length, 1);

    // 공감 toggles, 댓글 can be removed by its writer or MASTER only.
    let d = await h.request('POST', `${url}/${id}/reactions`, users.foreign);
    assert.equal(d.body.report.reactionCount, 1); assert.equal(d.body.report.reacted, true);
    d = await h.request('POST', `${url}/${id}/reactions`, users.foreign);
    assert.equal(d.body.report.reactionCount, 0);
    d = await h.request('POST', `${url}/${id}/comments`, users.foreign, { body: '기획안 공유 부탁드립니다!' });
    assert.equal(d.body.comments.length, 1); assert.equal(d.body.report.commentCount, 1);
    const commentId = d.body.comments[0].id;
    assert.equal((await h.request('DELETE', `${url}/${id}/comments/${commentId}`, users.staff)).status, 403);
    assert.equal((await h.request('DELETE', `${url}/${id}/comments/${commentId}`, users.admin)).body.comments.length, 0);

    // Only the author (or MASTER) edits or deletes.
    assert.equal((await h.request('PATCH', `${url}/${id}`, users.foreign, report())).status, 403);
    const edited = await h.request('PATCH', `${url}/${id}`, users.staff, report({ classes: [{ text: '고친 수업내용' }] }));
    assert.equal(edited.body.report.body.classes[0].text, '고친 수업내용');
    assert.equal((await h.request('DELETE', `${url}/${id}`, users.foreign)).status, 403);

    // Photos: shrunk in the browser, stored per uploader; a report may only use its author's photos.
    const png = encode({ width: 8, height: 8, channels: 4, depth: 8, data: new Uint8Array(256).fill(120) });
    const form = new FormData(); form.set('file', new File([png], 'p.png', { type: 'image/png' }));
    const up = await h.request('POST', `${url}/photos`, users.staff, form);
    assert.equal(up.status, 200, JSON.stringify(up.body));
    assert.match(up.body.key, /^staff-reports\/[\w-]+\/[\w-]+\.png$/);
    const photo = await h.raw('GET', '/api/data-core/staff-reports/photos/' + up.body.key.split('/').slice(1).join('/'), users.foreign);
    assert.equal(photo.status, 200); assert.equal(photo.headers.get('content-type'), 'image/png');
    assert.equal((await h.raw('GET', '/api/data-core/staff-reports/photos/' + up.body.key.split('/').slice(1).join('/'), null)).status, 401);
    assert.equal((await h.request('PATCH', `${url}/${id}`, users.staff, report({ photos: [up.body.key] }))).status, 200);
    assert.equal((await h.request('POST', url, users.foreign, report({ campusId: B, photos: [up.body.key] }))).status, 400, "someone else's photo");
    const bad = new FormData(); bad.set('file', new File(['x'], 'a.txt', { type: 'text/plain' }));
    assert.equal((await h.request('POST', `${url}/photos`, users.staff, bad)).status, 400);

    assert.equal((await h.request('DELETE', `${url}/${id}`, users.staff)).status, 200);
    assert.equal((await h.request('GET', url + '?month=2026-09', users.staff)).body.reports.length, 0);
  } finally { await h.mf.dispose(); }
});

test('고정 업무: 업무보고 마감이 기본으로 있고, 캠퍼스 관리자는 자기 캠퍼스만, 전체 캠퍼스는 MASTER만 관리한다', async () => {
  const h = await libraryHarness();
  try {
    const url = '/api/data-core/calendar/fixed-tasks';
    await h.request('POST', '/api/data-core/staff-reports', users.staff, { ...report(), campusId: A });
    const oct = await h.request('GET', url + '?month=2026-10', users.staff);
    assert.equal(oct.status, 200, JSON.stringify(oct.body));
    const deadline = oct.body.tasks.find(t => t.kind === 'monthly-report');
    assert.equal(deadline.title, '9월 월간 업무보고 마감');
    assert.deepEqual(deadline.dates, ['2026-10-10']);
    assert.equal(deadline.submittedCount, 1);
    assert.equal(deadline.canManage, false);
    assert.equal(oct.body.canCreate, false);
    assert.deepEqual((await h.request('GET', url + '?month=2027-01', users.staff)).body.tasks[0].dates, ['2027-01-09']);

    // Staff cannot add; a campus admin adds for their own campus only; 전체 캠퍼스 is MASTER's.
    const task = { title: '출석부 월말 정리', rule: 'month-end', campusId: A };
    assert.equal((await h.request('POST', url + '?month=2026-10', users.staff, task)).status, 403);
    assert.equal((await h.request('POST', url + '?month=2026-10', users.campusAdmin, { ...task, campusId: B })).status, 403);
    assert.equal((await h.request('POST', url + '?month=2026-10', users.campusAdmin, { ...task, campusId: null })).status, 403);
    const added = await h.request('POST', url + '?month=2026-10', users.campusAdmin, task);
    assert.equal(added.status, 200, JSON.stringify(added.body));
    const mine = added.body.tasks.find(t => t.title === '출석부 월말 정리');
    assert.deepEqual(mine.dates, ['2026-10-31']); assert.equal(mine.canManage, true);
    assert.deepEqual(added.body.manageableCampuses.map(c => c.id), [A]);
    assert.equal((await h.request('POST', url + '?month=2026-10', users.campusAdmin, { title: '', rule: 'month-end', campusId: A })).status, 400);
    assert.equal((await h.request('POST', url + '?month=2026-10', users.campusAdmin, { title: '주간 회의', rule: 'weekday', ruleValue: 9, campusId: A })).status, 400);

    // Campus tasks are seen by that campus only.
    assert.ok((await h.request('GET', url + '?month=2026-10', users.staff)).body.tasks.some(t => t.id === mine.id));
    assert.ok(!(await h.request('GET', url + '?month=2026-10', users.foreign)).body.tasks.some(t => t.id === mine.id));
    assert.equal((await h.request('PATCH', `${url}/${mine.id}?month=2026-10`, users.staff, { ...task, title: 'x' })).status, 403);

    // The 업무보고 deadline: only MASTER may change its rule; nobody deletes it.
    assert.equal((await h.request('PATCH', `${url}/${deadline.id}?month=2026-10`, users.campusAdmin, { title: '월간 업무보고 마감', rule: 'month-end' })).status, 403);
    assert.equal((await h.request('DELETE', `${url}/${deadline.id}?month=2026-10`, users.admin)).status, 400);
    const moved = await h.request('PATCH', `${url}/${deadline.id}?month=2026-10`, users.admin, { title: '월간 업무보고 마감', rule: 'month-day', ruleValue: 5 });
    assert.deepEqual(moved.body.tasks.find(t => t.kind === 'monthly-report').dates, ['2026-10-05']);
    const all = await h.request('POST', url + '?month=2026-10', users.admin, { title: '전체회의', rule: 'weekday', ruleValue: 3, campusId: null });
    assert.equal(all.status, 200);
    assert.ok((await h.request('GET', url + '?month=2026-10', users.foreign)).body.tasks.some(t => t.title === '전체회의'));
    assert.equal((await h.request('DELETE', `${url}/${mine.id}?month=2026-10`, users.campusAdmin)).status, 200);
  } finally { await h.mf.dispose(); }
});

test('screens: 월간 업무보고 menu, page ids, calendar bars and 고정 업무 줄 are wired', () => {
  const nav = fs.readFileSync('public/data-core/work-navigation.js', 'utf8');
  assert.match(nav, /\['instagram','인스타 자동화',[^\]]+\],\r?\n\s+\['reports','월간 업무보고','\/data-core\/reports','ClipboardList'\]/);
  const html = fs.readFileSync('public/data-core/reports.html', 'utf8'), js = fs.readFileSync('public/data-core/reports.js', 'utf8');
  const ids = new Set([...html.matchAll(/id="([\w-]+)"/g)].map(m => m[1]));
  const missing = [...js.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]).filter(id => !ids.has(id));
  assert.deepEqual([...new Set(missing)], []);
  const calendar = fs.readFileSync('public/data-core/calendar.js', 'utf8');
  assert.match(calendar, /class="calendar-week"/);
  assert.match(calendar, /grid-column:\$\{c1\+1\}\/\$\{c2\+2\}/, 'a multi-day event is one bar over its days');
  assert.match(calendar, /📌 고정 업무/);
  assert.match(calendar, /선택한 월 \$\{monthly\.length\}건 · 전체 조회 완료/);
  assert.match(fs.readFileSync('public/data-core/assets/core-icons.svg', 'utf8'), /<symbol id="ClipboardList"/);
});
