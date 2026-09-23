import assert from 'node:assert/strict';
import test from 'node:test';
import { libraryHarness, users, A, B } from './support/library-harness.mjs';

test('campus logo upload, listing/pagination, selection-safe deletion, and cross-campus isolation', async () => {
  const h = await libraryHarness();
  try {
    const png = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]); // header bytes are enough — the endpoint stores bytes as-is, no re-encoding
    const upload = (user, campusId = A, name = '캠퍼스 로고') => {
      const form = new FormData();
      form.set('campusId', campusId); form.set('name', name);
      form.set('file', new File([png], 'logo.png', { type: 'image/png' }));
      return h.request('POST', '/api/data-core/content/instagram-logos', user, form);
    };

    // Only a member of the campus (or MASTER) may upload to it.
    assert.equal((await upload(users.foreign)).status, 403, 'a campus-B staff member must not upload to campus A');
    assert.equal((await upload(users.outsider)).status, 403, 'authenticated but no write access at all');
    const created = await upload(users.campusAdmin);
    assert.equal(created.status, 201, JSON.stringify(created));
    const logo = created.body.logo;
    assert.equal(logo.name, '캠퍼스 로고');
    assert.equal(logo.mimeType, 'image/png');

    // Rejects the wrong mime type and an oversized file, without ever writing a row.
    const badMime = new FormData(); badMime.set('campusId', A); badMime.set('file', new File([png], 'logo.svg', { type: 'image/svg+xml' }));
    assert.equal((await h.request('POST', '/api/data-core/content/instagram-logos', users.campusAdmin, badMime)).status, 415);
    const oversized = new FormData(); oversized.set('campusId', A); oversized.set('file', new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }));
    assert.equal((await h.request('POST', '/api/data-core/content/instagram-logos', users.campusAdmin, oversized)).status, 413);

    // Listed back for the campus, but never for a different campus, and never for a staff member of
    // another campus even with the right campusId query (still 403 via requireCampusAccess).
    const listA = await h.request('GET', `/api/data-core/content/instagram-logos?campusId=${A}`, users.campusAdmin);
    assert.equal(listA.status, 200); assert.equal(listA.body.logos.length, 1); assert.equal(listA.body.logos[0].id, logo.id);
    assert.equal((await h.request('GET', `/api/data-core/content/instagram-logos?campusId=${A}`, users.foreign)).status, 403);
    const listB = await h.request('GET', `/api/data-core/content/instagram-logos?campusId=${B}`, users.foreign);
    assert.equal(listB.status, 200); assert.equal(listB.body.logos.length, 0, 'campus A logo must not leak into campus B listing');

    // Pagination: upload enough logos to exercise the cursor, in creation order (newest first).
    const names = [];
    for (let i = 0; i < 3; i++) { const r = await upload(users.campusAdmin, A, `순서 로고 ${i}`); assert.equal(r.status, 201); names.push(r.body.logo.name); }
    const firstPage = await h.request('GET', `/api/data-core/content/instagram-logos?campusId=${A}`, users.campusAdmin);
    assert.equal(firstPage.status, 200);
    assert.deepEqual(firstPage.body.logos.map(l => l.name), [...names].reverse().concat('캠퍼스 로고'), 'newest first');
    assert.equal(firstPage.body.nextCursor, null, 'fewer than a page of results has no next cursor');

    // Deleting a logo hides it from future listings but is scoped to the uploader's own campus.
    assert.equal((await h.request('DELETE', `/api/data-core/content/instagram-logos/${encodeURIComponent(logo.id)}`, users.foreign)).status, 403, 'campus B staff cannot delete campus A logo');
    const removed = await h.request('DELETE', `/api/data-core/content/instagram-logos/${encodeURIComponent(logo.id)}`, users.campusAdmin);
    assert.equal(removed.status, 200, JSON.stringify(removed));
    const afterDelete = await h.request('GET', `/api/data-core/content/instagram-logos?campusId=${A}`, users.campusAdmin);
    assert.equal(afterDelete.body.logos.some(l => l.id === logo.id), false);
    assert.equal(afterDelete.body.logos.length, 3, 'the other three logos remain untouched by an unrelated deletion');

    // Deleting an already-deleted (or unknown) logo is a clean 404, not a silent success.
    assert.equal((await h.request('DELETE', `/api/data-core/content/instagram-logos/${encodeURIComponent(logo.id)}`, users.campusAdmin)).status, 404);
  } finally { await h.mf.dispose(); }
});

test('MASTER can upload/manage any campus, and normalizeDesign/designChecks accept a valid custom logo reference', async () => {
  const h = await libraryHarness();
  try {
    const png = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
    const form = new FormData(); form.set('campusId', B); form.set('file', new File([png], 'master-logo.png', { type: 'image/png' }));
    const created = await h.request('POST', '/api/data-core/content/instagram-logos', users.master, form);
    assert.equal(created.status, 201, JSON.stringify(created));
    const logoId = created.body.logo.id;

    const { normalizeDesign, designChecks } = await import('../public/data-core/instagram-brand-policy.js');
    const design = normalizeDesign({ workflow: 'carousel-v2', logoType: `custom:${logoId}`, materialKind: 'real-photo', usePermission: 'allowed', externalAiConsent: true });
    assert.equal(design.logoType, `custom:${logoId}`, 'a well-formed custom logo reference must survive normalization unchanged');
    assert.ok(designChecks(design, '광진 캠퍼스').find(c => c.code === 'logo').status === 'pass');

    // A malformed/unknown reference (not a real 36-char id) falls back to the template default, same
    // as any other invalid logoType — never silently accepted.
    const bad = normalizeDesign({ workflow: 'carousel-v2', logoType: 'custom:not-a-real-id', materialKind: 'real-photo', usePermission: 'allowed', externalAiConsent: true });
    assert.notEqual(bad.logoType, 'custom:not-a-real-id');

    // "캠퍼스 기본값으로 저장" (content/defaults) accepts a real custom logo the caller can read, and
    // rejects one that does not exist (never trusts the client-sent id blindly).
    const saveGood = await h.request('PUT', '/api/data-core/content/defaults', users.master,
      { sourceApp: 'instagram', campusId: B, hashtags: '', footer: '', instagramSettings: { logoType: `custom:${logoId}`, mode: 'original' } });
    assert.equal(saveGood.status, 200, JSON.stringify(saveGood));
    assert.equal(saveGood.body.defaults.instagramSettings.logoType, `custom:${logoId}`);
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const saveBad = await h.request('PUT', '/api/data-core/content/defaults', users.master,
      { sourceApp: 'instagram', campusId: B, hashtags: '', footer: '', instagramSettings: { logoType: `custom:${fakeId}`, mode: 'original' } });
    assert.equal(saveBad.status, 400, 'a non-existent custom logo id must not be accepted as a saved campus default');
  } finally { await h.mf.dispose(); }
});
