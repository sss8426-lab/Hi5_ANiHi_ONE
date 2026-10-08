import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { libraryHarness, users, A } from './support/library-harness.mjs';

const path = '/api/data-core/calendar';
const event = (title, extra = {}) => ({ title, campusId: A, metadata: { startDate: '2026-10-20', eventType: 'meeting' }, ...extra });

test('일정 수정·삭제: 본인 글, 캠퍼스 관리자는 자기 캠퍼스 사람들의 글, MASTER는 전부', async () => {
  const h = await libraryHarness();
  try {
    const create = async (user, body) => { const r = await h.request('POST', path, user, body); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.event.id; };
    const can = async (user, id) => (await h.request('GET', `${path}/${id}`, user)).body.event?.canManage;
    const staffEvent = await create(users.staff, event('직원이 쓴 일정'));
    const adminEvent = await create(users.campusAdmin, event('캠퍼스 관리자가 쓴 일정'));
    const masterEvent = await create(users.admin, event('MASTER가 쓴 캠퍼스 일정'));
    const orgEvent = await create(users.admin, { title: '조직 공통 일정', visibility: 'organization', metadata: { startDate: '2026-10-21', eventType: 'meeting' } });

    // The writer manages their own event; a colleague in the same campus does not.
    assert.equal(await can(users.staff, staffEvent), true);
    assert.equal(await can(users.teacher, staffEvent), false);
    assert.equal((await h.request('PATCH', `${path}/${staffEvent}`, users.teacher, { title: '남의 일정' })).status, 403);
    assert.equal((await h.request('DELETE', `${path}/${staffEvent}`, users.teacher)).status, 403);
    assert.equal(await can(users.staff, adminEvent), false);

    // The campus admin manages everything written by people of their campus.
    assert.equal(await can(users.campusAdmin, staffEvent), true);
    assert.equal((await h.request('PATCH', `${path}/${staffEvent}`, users.campusAdmin, { title: '관리자가 고침' })).body.event.title, '관리자가 고침');
    assert.equal(await can(users.campusAdmin, adminEvent), true);
    // …but not what MASTER wrote, even for their campus, nor organization-wide events.
    assert.equal(await can(users.campusAdmin, masterEvent), false);
    assert.equal((await h.request('PATCH', `${path}/${masterEvent}`, users.campusAdmin, { title: 'x' })).status, 403);
    assert.equal(await can(users.campusAdmin, orgEvent), false);

    // MASTER manages every campus's events.
    for (const id of [staffEvent, adminEvent, masterEvent, orgEvent]) assert.equal(await can(users.admin, id), true);

    // The list carries the same flags.
    const list = await h.request('GET', `${path}?from=2026-10-01&to=2026-10-31`, users.campusAdmin);
    const flags = Object.fromEntries(list.body.events.map(e => [e.title, e.canManage]));
    assert.deepEqual(flags, { '관리자가 고침': true, '캠퍼스 관리자가 쓴 일정': true, 'MASTER가 쓴 캠퍼스 일정': false, '조직 공통 일정': false });
    assert.equal((await h.request('DELETE', `${path}/${staffEvent}`, users.campusAdmin)).status, 200);
    assert.equal((await h.request('DELETE', `${path}/${masterEvent}`, users.admin)).status, 200);
  } finally { await h.mf.dispose(); }
});

test('달력 날짜를 두 번 누르면 그 날 일정 쓰기 창이 열린다 (브라우저 dblclick 대신 같은 날 두 번 누름을 직접 셈)', () => {
  const calendar = fs.readFileSync('public/data-core/calendar.js', 'utf8');
  assert.match(calendar, /const date=day\.dataset\.calendarCell,now=Date\.now\(\),again=ui\.lastPress\?\.date===date&&now-ui\.lastPress\.at<500;/);
  assert.match(calendar, /if\(again&&canWrite\(\)\)\{openEditor\(\);return;\}/);
  assert.doesNotMatch(calendar, /addEventListener\('dblclick'/, 'the first press re-draws the month, so the browser dblclick never arrives');
});
