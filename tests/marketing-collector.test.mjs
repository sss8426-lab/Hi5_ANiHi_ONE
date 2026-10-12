import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { MARKETING_BASE_URL, parseCollectorArgs, ingestMarketingReport } from '../scripts/marketing-collector.mjs';

const payload = { version: 1, runId: 'collector-test-1', campusId: 'campus_bucheon_ani', reportDate: '2026-10-13', runKind: 'sample' };
async function fixture(fn) {
  await mkdir(resolve('.wrangler'), { recursive: true });
  const dir = await mkdtemp(join(resolve('.wrangler'), 'marketing-collector-test-'));
  const payloadPath = join(dir, 'payload.json');
  const previous = process.env.MARKETING_INGEST_TOKEN;
  process.env.MARKETING_INGEST_TOKEN = 'unit_test_credential_not_real_1234567890';
  try { await writeFile(payloadPath, JSON.stringify(payload)); await fn({ payloadPath, dir }); }
  finally { if (previous === undefined) delete process.env.MARKETING_INGEST_TOKEN; else process.env.MARKETING_INGEST_TOKEN = previous; await rm(dir, { recursive: true, force: true }); }
}

test('collector CLI accepts explicit payload/image paths and rejects unknown arguments', () => {
  const args = parseCollectorArgs(['ingest', '--payload', 'report.json', '--image', 'one.png', '--image', 'two.png']);
  assert.equal(args.command, 'ingest');
  assert.equal(args.images.length, 2);
  assert.equal(args.payloadPath, resolve('report.json'));
  assert.throws(() => parseCollectorArgs(['ingest', '--base-url', 'https://untrusted.test']));
  assert.throws(() => parseCollectorArgs(['ingest', '--token-file']));
});

test('collector confirms saved identity and existing-idempotency response', async () => fixture(async ({ payloadPath }) => {
  const result = await ingestMarketingReport({ payloadPath, request: async (url, options) => {
    assert.equal(url, MARKETING_BASE_URL + '/api/data-core/marketing/ingest');
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'POST');
    assert.equal(JSON.parse(options.body.get('payload')).runId, payload.runId);
    return Response.json({ existing: true, report: { ...payload, id: 'marketing:test', status: 'partial', imageFiles: [] } });
  } });
  assert.equal(result.ok, true);
  assert.equal(result.deduplicated, true);
  assert.equal(result.imageCount, 0);
  assert.equal(JSON.stringify(result).includes(process.env.MARKETING_INGEST_TOKEN), false);
}));

test('collector retries temporary errors using exactly the same runId', async () => fixture(async ({ payloadPath }) => {
  const ids = []; const pauses = [];
  const result = await ingestMarketingReport({ payloadPath, pause: async ms => pauses.push(ms), request: async (_url, options) => {
    ids.push(JSON.parse(options.body.get('payload')).runId);
    return ids.length === 1 ? Response.json({ error: 'temporary' }, { status: 503 }) : Response.json({ report: { ...payload, id: 'marketing:test', imageFiles: [] } });
  } });
  assert.equal(result.ok, true);
  assert.deepEqual(ids, [payload.runId, payload.runId]);
  assert.deepEqual(pauses, [1500]);
}));

test('collector refuses authorization errors without retry or credential disclosure', async () => fixture(async ({ payloadPath }) => {
  let calls = 0;
  await assert.rejects(ingestMarketingReport({ payloadPath, request: async () => { calls++; return Response.json({ secret: process.env.MARKETING_INGEST_TOKEN }, { status: 401 }); } }), error => error.message.includes('401') && !error.message.includes(process.env.MARKETING_INGEST_TOKEN));
  assert.equal(calls, 1);
}));

test('collector does not call a response complete if identity mismatches', async () => fixture(async ({ payloadPath }) => {
  await assert.rejects(ingestMarketingReport({ payloadPath, request: async () => Response.json({ report: { ...payload, campusId: 'other', id: 'marketing:test' } }) }));
}));

test('collector rejects mislabeled non-PNG files before transmission', async () => fixture(async ({ payloadPath, dir }) => {
  const fake = join(dir, 'fake.png'); await writeFile(fake, '<svg></svg>');
  let called = false;
  await assert.rejects(ingestMarketingReport({ payloadPath, images: [fake], request: async () => { called = true; } }));
  assert.equal(called, false);
}));

test('collector requires a registered private link for every source PNG', async () => fixture(async ({ payloadPath, dir }) => {
  const { encode } = await import('fast-png');
  const image = join(dir, 'real.png');
  await writeFile(image, encode({ width: 1, height: 1, channels: 4, data: new Uint8Array([0, 0, 0, 255]) }));
  await assert.rejects(ingestMarketingReport({ payloadPath, images: [image], request: async () => Response.json({ report: { ...payload, id: 'marketing:test', imageFiles: [] } }) }));
  const saved = await ingestMarketingReport({ payloadPath, images: [image], request: async () => Response.json({ report: { ...payload, id: 'marketing:test', imageFiles: [{ id: 'image', url: '/api/data-core/files/image' }] } }) });
  assert.equal(saved.imageCount, 1);
}));
