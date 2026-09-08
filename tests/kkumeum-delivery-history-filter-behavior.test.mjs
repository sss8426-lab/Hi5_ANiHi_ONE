import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const uiPath = new URL('../public/data-core/work/kkumeum-operations.js', import.meta.url);

async function deliveryFilter() {
  const source = await readFile(uiPath, 'utf8');
  const match = source.match(/function filteredDeliveryReports\(reports, filter\) \{[\s\S]*?\n  \}/);
  assert.ok(match, 'delivery filter must be defined in the staff UI source');
  return new Function(`${match[0]}; return filteredDeliveryReports;`)();
}

test('delivery history filter shows sent reports only and separates guardian confirmation state', async () => {
  const filter = await deliveryFilter();
  const reports = [
    { id: 'synthetic-sent-confirmed', status: 'sent', guardianConfirmed: true, guardianFirstReadAt: '2026-09-03T00:00:00.000Z' },
    { id: 'synthetic-sent-unconfirmed', status: 'sent', guardianConfirmed: false, guardianFirstReadAt: null },
    { id: 'synthetic-sent-malformed', status: 'sent', guardianConfirmed: true, guardianFirstReadAt: null },
    { id: 'synthetic-draft', status: 'draft', guardianConfirmed: true, guardianFirstReadAt: '2026-09-01T00:00:00.000Z' },
    { id: 'synthetic-ready', status: 'ready', guardianConfirmed: true, guardianFirstReadAt: '2026-09-01T00:00:00.000Z' },
  ];

  assert.deepEqual(filter(reports, 'all').map((report) => report.id), ['synthetic-sent-confirmed', 'synthetic-sent-unconfirmed', 'synthetic-sent-malformed']);
  assert.deepEqual(filter(reports, 'confirmed').map((report) => report.id), ['synthetic-sent-confirmed']);
  assert.deepEqual(filter(reports, 'unconfirmed').map((report) => report.id), ['synthetic-sent-unconfirmed', 'synthetic-sent-malformed']);
  assert.deepEqual(filter(reports, 'unexpected').map((report) => report.id), ['synthetic-sent-confirmed', 'synthetic-sent-unconfirmed', 'synthetic-sent-malformed']);
});

test('delivery history UI uses the existing confirmation summary without guardian identity or analytics semantics', async () => {
  const ui = await readFile(uiPath, 'utf8');
  const history = ui.slice(ui.indexOf('function filteredDeliveryReports'), ui.indexOf('function reportForm'));
  assert.match(history, /전체 전달 이력/);
  assert.match(history, /보호자 확인 전/);
  assert.match(history, /보호자 확인 완료/);
  assert.match(history, /guardianConfirmationLabel\(item\)/);
  assert.doesNotMatch(history, /guardianName|guardianId|relationshipLabel|guardianCount|phone|email|receipt|percentile|ranking|점수|순위|백분율/i);
});
