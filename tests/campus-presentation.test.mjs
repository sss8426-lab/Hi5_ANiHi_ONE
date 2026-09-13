import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import { libraryHarness, users, ORG, A, B } from './support/library-harness.mjs';

const expected = [
  ['campus-design-admission', '부천 디자인 입시본원'],
  ['campus-anihi-admission', '부천 애니 입시본원'],
  ['campus-beombak', '부천 범박 캠퍼스'],
  ['campus-wonjong', '부천 원종 캠퍼스'],
  ['campus-jungdong', '부천 중동 캠퍼스'],
  ['campus-okgil', '부천 옥길 캠퍼스'],
  ['campus-gwangjin', '서울 광진 입시본원'],
  ['campus-ulsan', '울산 송정 입시본원'],
  ['campus-ansan', '안산 입시본원'],
  ['campus-paju', '파주 입시본원'],
];

test('campus presentation: all selectors and library share names/order without storage or authority changes', async () => {
  const h = await libraryHarness();
  try {
    const retired = 'campus-synthetic-acceptance-20260909';
    const custom = 'campus-real-test-art';
    for (const [id, name] of [[retired, 'SYNTHETIC TEST 20260909'], [custom, 'TEST 아트 실제 캠퍼스']]) {
      await h.env.DB.prepare(`INSERT INTO campuses (id,organization_id,code,name,status,created_at,updated_at)
        VALUES (?,?,?,?,'active','2026-09-14','2026-09-14')`).bind(id, ORG, id.slice(7), name).run();
    }
    const retiredAccount = await h.request('POST', '/api/auth/accounts', users.admin, {
      displayName: 'Synthetic Retired', loginId: 'syntheticretired', campusId: retired, role: 'STAFF',
      temporaryPassword: 'Synthetic-only-2026!',
    });
    assert.equal(retiredAccount.status, 201);
    const accounts = await h.request('GET', '/api/auth/accounts');
    assert.equal(accounts.body.accounts.find(a => a.campus_id === retired).retiredCampus, true);
    assert.equal((await h.request('GET', '/api/auth/accounts', users.teacher)).status, 403);
    const before = await h.env.DB.prepare('SELECT * FROM campuses ORDER BY id').all();
    // Existing bootstrap auth refreshes only the master's membership timestamp on reads.
    const readMemberships = () => h.env.DB.prepare(`SELECT id,organization_id,campus_id,user_id,role,created_at,
      CASE WHEN id='membership:oai:library-admin:super-admin' THEN NULL ELSE updated_at END AS updated_at
      FROM memberships ORDER BY id`).all();
    const members = await readMemberships();
    const list = await h.request('GET', '/api/data-core/campuses');
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.campuses.slice(0, 10).map(c => [c.id, c.name]), expected);
    assert.equal(list.body.campuses.at(-1).id, custom, 'unknown real campus is not hidden by title heuristics');
    assert.equal(list.body.campuses.some(c => c.id === retired), false);
    const root = await h.browse();
    assert.equal(root.status, 200);
    assert.deepEqual(root.body.folders.filter(f => f.campusId).map(f => [f.campusId, f.title]),
      list.body.campuses.map(c => [c.id, c.name]));
    for (const [id, name] of expected) {
      const view = await h.browse('campus:' + id);
      assert.equal(view.body.folder.title, name);
      assert.equal(view.body.breadcrumbs.at(-1).title, name);
      assert.equal(view.body.folders[0].title, '수업사진');
    }
    for (const user of [users.director, users.teacher, users.staff, users.foreign]) {
      const own = await h.request('GET', '/api/data-core/campuses', user);
      assert.deepEqual(own.body.campuses.map(c => c.id), [user.campus]);
      const context = await h.request('GET', '/api/data-core/context', user);
      assert.equal(context.body.memberships[0].campusName, expected.find(c => c[0] === user.campus)[1]);
    }
    assert.equal((await h.request('GET', '/api/data-core/campuses', null)).status, 401);
    assert.equal((await h.browse(`category:${B}:student-artwork`, users.teacher)).status, 403);
    assert.equal((await h.folder(`category:${B}:class-photo`, 'Forbidden', users.teacher)).status, 403);
    assert.equal((await h.browse('campus:' + retired)).status, 200, 'old authorized recovery link remains usable');
    assert.deepEqual((await h.env.DB.prepare('SELECT * FROM campuses ORDER BY id').all()).results, before.results);
    assert.deepEqual((await readMemberships()).results, members.results);
    const folder = await h.folder(`category:${A}:class-photo`, '사용자 폴더', users.teacher);
    assert.equal(folder.status, 201);
    const child = await h.folder(folder.body.folder.id, '하위 폴더', users.teacher);
    assert.equal(child.status, 201);
    assert.deepEqual((await h.browse(child.body.folder.id, users.teacher)).body.breadcrumbs.map(f => f.title),
      ['자료보관함', expected[1][1], '수업사진', '사용자 폴더', '하위 폴더']);
  } finally { await h.mf.dispose(); }
});

test('shared folder presentation preserves server order, custom names, groups and nested search', async () => {
  const window = {};
  vm.runInNewContext(await fs.readFile('public/data-core/library-client.js', 'utf8'), { window });
  const folders = [
    { id: 'hq-default:resources', title: '자료', group: '본원 작업물' },
    ...expected.map(([id, title]) => ({ id: 'campus:' + id, title, group: '캠퍼스' })),
    { id: 'custom', title: '직접 만든 자료', group: '사용자 정의 폴더' },
  ];
  const clone = value => JSON.parse(JSON.stringify(value));
  const groups = clone(window.DataCoreLibraryClient.folderGroups({ folder: { id: 'root' }, folders }));
  assert.deepEqual(groups.map(([name]) => name), ['본원 작업물', '캠퍼스', '사용자 정의 폴더']);
  assert.deepEqual(groups[1][1].map(f => f.title), expected.map(c => c[1]));
  assert.deepEqual(clone(window.DataCoreLibraryClient.folderGroups({ folder: { id: 'root' }, folders }, '송정')),
    [['캠퍼스', [folders[8]]]]);
  assert.deepEqual(clone(window.DataCoreLibraryClient.folderGroups({ folder: { id: 'custom' }, folders: folders.slice(-1) })),
    [['폴더', folders.slice(-1)]]);
  for (const path of ['public/data-core/content.js', 'public/data-core/work/hq-library.js']) {
    assert.match(await fs.readFile(path, 'utf8'), /DataCoreLibraryClient\.folderGroups/);
  }
});
