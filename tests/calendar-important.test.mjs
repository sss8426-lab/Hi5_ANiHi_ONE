import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { libraryHarness, users, A } from './support/library-harness.mjs';

const path = '/api/data-core/calendar';

test('중요 업무: 일정에 핀을 표시하고, 핀 목록만 따로 불러오며, 해제할 수 있다', async () => {
  const h = await libraryHarness();
  try {
    const make = (title, metadata) => h.request('POST', path, users.staff, { title, campusId: A, metadata: { eventType: 'meeting', ...metadata } });
    const pinned = await make('중3 방문상담 주간', { startDate: '2026-10-12', endDate: '2026-10-17', important: true });
    assert.equal(pinned.status, 201, JSON.stringify(pinned.body));
    assert.equal(pinned.body.event.metadata.important, true);
    const plain = await make('일반 회의', { startDate: '2026-10-13' });
    assert.equal(plain.body.event.metadata.important, undefined);
    assert.equal((await make('잘못된 값', { startDate: '2026-10-13', important: 'yes' })).status, 400);

    const list = await h.request('GET', `${path}?from=2026-10-09&to=2027-10-10&important=1`, users.staff);
    assert.deepEqual(list.body.events.map(e => e.title), ['중3 방문상담 주간']);
    // Other campuses never see it through the pinned list either.
    assert.deepEqual((await h.request('GET', `${path}?from=2026-10-09&to=2027-10-10&important=1`, users.foreign)).body.events, []);

    // Editing other fields keeps the pin; unchecking removes it.
    const kept = await h.request('PATCH', `${path}/${pinned.body.event.id}`, users.staff, { title: '중3 방문상담 주간(변경)' });
    assert.equal(kept.body.event.metadata.important, true);
    const off = await h.request('PATCH', `${path}/${pinned.body.event.id}`, users.staff, { metadata: { important: false } });
    assert.equal(off.body.event.metadata.important, undefined);
    assert.deepEqual((await h.request('GET', `${path}?from=2026-10-09&to=2027-10-10&important=1`, users.staff)).body.events, []);
  } finally { await h.mf.dispose(); }
});

test('screens: 중요 업무 checkbox, a blue pin row under 고정 업무 that drops ended events, red pin for 고정 업무', () => {
  const html = fs.readFileSync('public/data-core/index.html', 'utf8'), js = fs.readFileSync('public/data-core/calendar.js', 'utf8'), css = fs.readFileSync('public/data-core/calendar.css', 'utf8');
  assert.match(html, /<input id="calendarImportant" type="checkbox">/);
  assert.match(js, /important:\$\('calendarImportant'\)\.checked/);
  assert.match(js, /ui\.important\.filter\(e=>\(e\.metadata\.endDate\|\|e\.metadata\.startDate\)>=today\)/, 'ended events leave the row on their own');
  assert.match(js, /fixedStrip\(\)\+`<span class="calendar-status-count">[^`]+`\+\(ui\.fixed\?\.canCreate\?[^)]+\)\+importantStrip\(\);/, 'the row sits under 고정 업무');
  assert.match(js, /&important=1`/);
  assert.match(css, /\.calendar-pin\.fixed \{ color:#d93a2f; \} \.calendar-pin\.important \{ color:#2563eb; \}/);
});
