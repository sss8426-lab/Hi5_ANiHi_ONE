import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";
import { encode, decode } from 'fast-png';

const derivativePng = () => encode({ width: 2160, height: 2700, channels: 4, depth: 8, data: new Uint8Array(2160 * 2700 * 4).fill(180) });
test('legacy student artwork read-through restores exact stored originals with campus auth and no writes',async()=>{
  const h=await createHarness();
  try{
    const state={students:[{id:'synthetic-student',campusId:CAMPUS_A,artworks:[{path:'/api/files/student-artwork%2Fmissing.jpg',fileName:'synthetic-original-folder/original.png'}]}],universities:[{id:'untouched'}]};
    const save=()=>h.env.FILES.put('state/admissions-data.json',JSON.stringify(state));
    await save();await h.env.FILES.put('artworks/original.png',tinyPng(),{httpMetadata:{contentType:'image/png'}});
    const before=await(await h.env.FILES.get('state/admissions-data.json')).text();
    let artworkHeads=0;
    const files=h.env.FILES;
    h.env.FILES=new Proxy(files,{get(target,name){
      if(name==='head')return async(key,...args)=>{if(key.startsWith('artworks/'))artworkHeads++;return target.head(key,...args);};
      const value=target[name];return typeof value==='function'?value.bind(target):value;
    }});
    const path='/api/admissions/students/synthetic-student/artworks/0';
    assert.equal((await h.request('GET',path)).response.status,401);
    const read=await h.request('GET',path,users.a);
    assert.equal(read.response.status,200,JSON.stringify(read.body));
    assert.equal(artworkHeads,0,'a single exact stored key skips the redundant R2 HEAD');
    assert.equal(read.response.headers.get('content-type'),'image/png');
    assert.match(read.response.headers.get('cache-control'),/private/);
    const etag=read.response.headers.get('etag');
    assert.equal((await h.request('GET',path,users.a,undefined,{'if-none-match':etag})).response.status,304);
    assert.equal((await h.request('HEAD',path,users.a)).response.status,200);
    assert.equal((await h.request('POST',path,users.a)).response.status,405);
    assert.equal((await h.request('GET','/api/files/artworks%2Foriginal.png',users.admin)).response.status,404);
    assert.equal((await h.request('GET',path+'?key=artworks/another.png',users.a)).response.status,200,'client key ignored');
    state.students[0].campusId=CAMPUS_B;await save();
    assert.equal((await h.request('GET',path,users.a,undefined,{'if-none-match':etag})).response.status,403);
    assert.equal((await h.request('GET',path,users.admin)).response.status,200);
    delete state.students[0].campusId;await save();
    assert.equal((await h.request('GET',path,users.a)).response.status,403);
    state.students[0].campusId=CAMPUS_A;
    for(const value of ['../original.png','artworks/../original.png','https://example.test/original.png','%252e%252e%252foriginal.png','state/admissions-data.json','unrelated/original.png']){
      state.students[0].artworks=[{path:value}];await save();
      assert.equal((await h.request('GET',path,users.a)).response.status,404,value);
    }
    for(const value of ['C:\\synthetic\\artworks\\original.png','/synthetic/artworks/original.png','original.png']){
      state.students[0].artworks=[{path:value}];await save();assert.equal((await h.request('GET',path,users.a)).response.status,200);
    }
    await h.env.FILES.put('artworks/other.png',tinyPng());
    state.students[0].artworks=[{path:'original.png',name:'other.png'}];await save();
    assert.equal((await h.request('GET',path,users.a)).response.status,404,'ambiguous stored references fail closed');
    assert.equal((await h.request('GET','/api/admissions/students/unknown/artworks/0',users.admin)).response.status,404);
    await h.env.FILES.put('state/admissions-data.json',before);
    assert.equal(await(await h.env.FILES.get('state/admissions-data.json')).text(),before);
    assert.deepEqual(new Uint8Array(await(await h.env.FILES.get('artworks/original.png')).arrayBuffer()),tinyPng());
  }finally{await h.mf.dispose();}
});
const tinyPng = () => encode({ width: 16, height: 20, channels: 4, depth: 8, data: new Uint8Array(16 * 20 * 4).fill(90) });
function derivativeForm(source = 'file-shared', bytes = derivativePng()) {
  const form = new FormData();
  form.append('derivedFromFileId', source);
  form.append('file', new File([bytes], 'synthetic.png', { type: 'image/png' }));
  return form;
}

test('Instagram derivatives preserve originals, inherit authority, link drafts and soft-trash without deleting bytes', async () => {
  const h = await createHarness();
  try {
    const key = 'data-core/test/file-shared.png';
    await h.env.FILES.put(key, tinyPng());
    await h.request('GET', '/api/data-core/content', users.a);
    const before = await h.env.DB.prepare('SELECT * FROM file_objects WHERE id = ?').bind('file-shared').first();
    const original = new Uint8Array(await (await h.env.FILES.get(key)).arrayBuffer());
    const form = derivativeForm();
    for (const [name, value] of Object.entries({ campusId: CAMPUS_B, ownerUserId: 'forged', sourceApp: 'blog', visibility: 'public', metadata: '{"derivedFromFileId":"forged"}' })) form.append(name, value);
    const saved = await h.requestForm('/api/data-core/instagram/derivatives', users.b, form);
    assert.equal(saved.response.status, 201, JSON.stringify(saved.body));
    const file = saved.body.file;
    assert.notEqual(file.id, 'file-shared');
    assert.equal(file.sourceApp, 'instagram'); assert.equal(file.category, 'instagram-derived');
    assert.equal(file.metadata.derivedFromFileId, 'file-shared');
    assert.equal(file.metadata.derivativeFileId, file.id);
    assert.equal(file.metadata.width, 2160); assert.equal(file.metadata.height, 2700);
    assert.equal(file.metadata.aspectRatio, '4:5'); assert.equal(file.metadata.createdBy, 'instagram-editor');
    assert.equal('r2Key' in file, false); assert.equal(file.downloadUrl, `/api/data-core/files/${file.id}`);
    const row = await h.env.DB.prepare('SELECT * FROM file_objects WHERE id = ?').bind(file.id).first();
    assert.equal(row.owner_user_id, before.owner_user_id); assert.equal(row.campus_id, before.campus_id);
    assert.equal(row.visibility, before.visibility);
    const actual = decode(new Uint8Array(await (await h.env.FILES.get(row.r2_key)).arrayBuffer()));
    assert.equal(actual.width, 2160); assert.equal(actual.height, 2700);
    assert.equal(actual.width / actual.height, 4 / 5);
    const second = await h.requestForm('/api/data-core/instagram/derivatives', users.a, derivativeForm());
    assert.equal(second.response.status, 201); assert.notEqual(second.body.file.id, file.id);
    assert.deepEqual(await h.env.DB.prepare('SELECT * FROM file_objects WHERE id = ?').bind('file-shared').first(), before);
    assert.deepEqual(new Uint8Array(await (await h.env.FILES.get(key)).arrayBuffer()), original);
    const listing = await h.request('GET', '/api/data-core/files?category=instagram-derived', users.a);
    assert.equal(listing.body.files.length, 2);
    assert.equal(listing.body.files.find((item) => item.id === file.id).metadata.derivedFromFileId, 'file-shared');
    assert.equal((await h.request('GET', file.downloadUrl, users.a)).response.status, 200);
    assert.equal((await h.request('GET', `/api/files/${encodeURIComponent(row.r2_key)}`, users.a)).response.status, 404);
    const draft = await h.createDraft(users.a, { sourceApp: 'instagram', campusId: CAMPUS_A, title: 'Synthetic derivative', relatedFileIds: ['file-shared'], derivedFileIds: [file.id] });
    assert.deepEqual(draft.metadata.relatedFileIds, ['file-shared']); assert.deepEqual(draft.metadata.derivedFileIds, [file.id]);
    const updated = await h.request('PATCH', `/api/data-core/content/${draft.id}`, users.a, { content: 'Synthetic edit' });
    assert.deepEqual(updated.body.draft.metadata.derivedFileIds, [file.id]);
    const blog = await h.createDraft(users.a, { sourceApp: 'blog', campusId: CAMPUS_A, title: 'Same original', relatedFileIds: ['file-shared'] });
    assert.deepEqual(blog.metadata.relatedFileIds, ['file-shared']); assert.deepEqual(blog.metadata.derivedFileIds, []);
    const badLink = await h.request('POST', '/api/data-core/content', users.a, { sourceApp: 'instagram', campusId: CAMPUS_A, title: 'Bad link', metadata: { derivedFileIds: ['file-shared'] } });
    assert.equal(badLink.response.status, 400);
    assert.equal((await h.request('DELETE', `/api/data-core/content/${draft.id}`, users.a)).response.status, 200);
    assert.equal((await h.request('DELETE', file.downloadUrl, users.a)).response.status, 200);
    assert.ok(await h.env.FILES.get(row.r2_key)); assert.ok(await h.env.FILES.get(key));
  } finally { await h.mf.dispose(); }
});

test('Instagram derivative provenance rejects private, foreign campus, anonymous and cross-origin access', async () => {
  const h = await createHarness();
  try {
    await h.env.FILES.put('data-core/test/file-shared.png', tinyPng());
    for (const [source, user, headers, expected] of [
      ['file-shared', null, {}, 401],
      ['file-private-b', users.a, {}, 403],
      ['file-other-campus', users.a, {}, 403],
      ['file-shared', users.a, { origin: 'https://attacker.example' }, 403],
      ['file-shared', users.a, { origin: '' }, 403],
    ]) {
      const result = await h.requestForm('/api/data-core/instagram/derivatives', user, derivativeForm(source), headers);
      assert.equal(result.response.status, expected, JSON.stringify(result.body));
    }
    const saved = await h.requestForm('/api/data-core/instagram/derivatives', users.a, derivativeForm());
    assert.equal(saved.response.status, 201, JSON.stringify(saved.body));
    const file = saved.body.file;
    assert.equal((await h.request('GET', file.downloadUrl)).response.status, 401);
    await h.env.DB.prepare("UPDATE file_objects SET visibility = 'private' WHERE id = 'file-shared'").run();
    assert.equal((await h.request('GET', file.downloadUrl, users.b)).response.status, 403);
    const list = await h.request('GET', '/api/data-core/files?category=instagram-derived', users.b);
    assert.deepEqual(list.body.files, []);
    const link = await h.request('POST', '/api/data-core/content', users.b, { sourceApp: 'instagram', campusId: CAMPUS_A, title: 'Forbidden', derivedFileIds: [file.id] });
    assert.equal(link.response.status, 403);
    assert.equal((await h.request('GET', file.downloadUrl, users.a)).response.status, 200);
    await h.env.DB.prepare("UPDATE file_objects SET campus_id = ? WHERE id = 'file-shared'").bind(CAMPUS_B).run();
    assert.equal((await h.request('GET', file.downloadUrl, users.a)).response.status, 403);
    await h.env.DB.prepare("UPDATE file_objects SET campus_id = ?, deleted_at = 'synthetic-deleted' WHERE id = 'file-shared'").bind(CAMPUS_A).run();
    assert.equal((await h.request('GET', file.downloadUrl, users.admin)).response.status, 403);
  } finally { await h.mf.dispose(); }
});

test('Instagram derivative rejects malformed images and non-images without new rows or objects', async () => {
  const h = await createHarness();
  try {
    await h.env.FILES.put('data-core/test/file-shared.png', tinyPng());
    await h.seedFile({ id: 'document', campusId: CAMPUS_A, ownerUserId: users.a.id, mimeType: 'application/pdf' });
    const before = await h.env.DB.prepare('SELECT COUNT(*) AS n FROM file_objects').first();
    const corrupt = derivativePng(); corrupt[corrupt.length - 1] ^= 1;
    for (const [source, bytes, status] of [ ['document', derivativePng(), 415], ['file-shared', tinyPng(), 400], ['file-shared', corrupt, 400], ['file-shared', new Uint8Array([1, 2, 3]), 400], ['file-shared', new Uint8Array(8 * 1024 * 1024 + 1), 400] ]) {
      const result = await h.requestForm('/api/data-core/instagram/derivatives', users.a, derivativeForm(source, bytes));
      assert.equal(result.response.status, status, JSON.stringify(result.body));
    }
    assert.deepEqual(await h.env.DB.prepare('SELECT COUNT(*) AS n FROM file_objects').first(), before);
    assert.equal((await h.env.FILES.list()).objects.length, 1);
    assert.equal((await h.requestForm('/api/data-core/instagram/derivatives', users.a, derivativeForm('file-shared', new Uint8Array(9 * 1024 * 1024)))).response.status, 413);
    const missing = await h.requestForm('/api/data-core/instagram/derivatives', users.b, derivativeForm('file-private-b'));
    assert.equal(missing.response.status, 404);
    for (const mime of ['image/jpeg', 'image/webp']) {
      await h.env.DB.prepare("UPDATE file_objects SET mime_type = ? WHERE id = 'file-shared'").bind(mime).run();
      assert.equal((await h.requestForm('/api/data-core/instagram/derivatives', users.a, derivativeForm())).response.status, 201);
    }
  } finally { await h.mf.dispose(); }
});

test('Instagram provenance cannot be forged or edited through generic record/file APIs', async () => {
  const h = await createHarness();
  try {
    await h.env.FILES.put('data-core/test/file-shared.png', tinyPng());
    const saved = await h.requestForm('/api/data-core/instagram/derivatives', users.a, derivativeForm());
    assert.equal(saved.response.status, 201, JSON.stringify(saved.body));
    const file = saved.body.file;
    const row = await h.env.DB.prepare('SELECT data_record_id FROM file_objects WHERE id = ?').bind(file.id).first();
    const recordPath = `/api/data-core/records/${encodeURIComponent(row.data_record_id)}`;
    const original = await h.env.DB.prepare('SELECT * FROM data_records WHERE id = ?').bind(row.data_record_id).first();
    assert.equal((await h.request('POST', '/api/data-core/records', users.admin, { recordType: 'instagram-derived-file', title: 'forged' })).response.status, 403);
    const ordinary = await h.request('POST', '/api/data-core/records', users.admin, { recordType: 'ordinary', sourceApp: 'instagram', title: 'Synthetic ordinary' });
    assert.equal(ordinary.response.status, 201);
    assert.equal((await h.request('PATCH', `/api/data-core/records/${ordinary.body.record.id}`, users.admin, { recordType: ' instagram-derived-file ' })).response.status, 403);
    assert.equal((await h.request('GET', recordPath, users.admin)).response.status, 403);
    assert.equal((await h.request('PATCH', recordPath, users.admin, { metadata: { derivedFromFileId: 'forged' } })).response.status, 403);
    assert.equal((await h.request('DELETE', recordPath, users.admin)).response.status, 403);
    assert.equal((await h.request('PUT', `${recordPath}/content`, users.admin, { content: 'forged' })).response.status, 403);
    for (const values of [{ category: 'instagram-derived' }, { category: 'instagram-source', recordId: row.data_record_id }]) {
      const form = new FormData(); form.append('file', new File([tinyPng()], 'synthetic.png', { type: 'image/png' })); form.append('campusId', CAMPUS_A);
      for (const [key, value] of Object.entries(values)) form.append(key, value);
      assert.equal((await h.requestForm('/api/data-core/files', users.admin, form)).response.status, values.category === 'instagram-derived' ? 400 : 403);
    }
    assert.deepEqual(await h.env.DB.prepare('SELECT * FROM data_records WHERE id = ?').bind(row.data_record_id).first(), original);
    assert.equal((await h.requestForm('/api/data-core/instagram/derivatives', users.a, derivativeForm(file.id))).response.status, 415);
    await h.env.DB.prepare("UPDATE data_records SET metadata_json = '{}' WHERE id = ?").bind(row.data_record_id).run();
    assert.equal((await h.request('GET', file.downloadUrl, users.admin)).response.status, 403);
  } finally { await h.mf.dispose(); }
});

test('Instagram failed batches clean only new orphans and preserve committed bytes after transport failure', async () => {
  const h = await createHarness();
  try {
    const db = h.env.DB, key = 'data-core/test/file-shared.png';
    await h.env.FILES.put(key, tinyPng());
    await h.request('GET', '/api/data-core/content', users.a);
    const before = await db.prepare('SELECT * FROM file_objects WHERE id = ?').bind('file-shared').first();
    for (const commitFirst of [false, true]) {
      let derivativeBatch = false;
      h.env.DB = new Proxy(db, {
        get(target, name) {
          if (name === 'prepare') return (sql) => {
            if (sql.includes("'derive','file_object'")) derivativeBatch = true;
            return target.prepare(sql);
          };
          if (name === 'batch') return async (statements) => {
            if (!derivativeBatch) return target.batch(statements);
            derivativeBatch = false;
            if (commitFirst) await target.batch(statements);
            throw new Error('Synthetic batch transport failure');
          };
          const value = target[name]; return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const response = await h.requestForm('/api/data-core/instagram/derivatives', users.a, derivativeForm());
      assert.equal(response.response.status, 500);
      assert.equal((await h.env.FILES.list()).objects.length, commitFirst ? 2 : 1);
    }
    const created = await db.prepare("SELECT r2_key FROM file_objects WHERE category = 'instagram-derived'").all();
    assert.equal(created.results.length, 1); assert.ok(await h.env.FILES.get(created.results[0].r2_key));
    assert.deepEqual(await db.prepare('SELECT * FROM file_objects WHERE id = ?').bind('file-shared').first(), before);
    assert.deepEqual(new Uint8Array(await (await h.env.FILES.get(key)).arrayBuffer()), tinyPng());
  } finally { await h.mf.dispose(); }
});

const ORGANIZATION_ID = "org-hi5-anihi";
const CAMPUS_A = "campus-anihi-admission";
const CAMPUS_B = "campus-design-admission";

const users = {
  admin: { id: "admin", email: "admin@example.test", name: "Admin" },
  a: { id: "user-a", email: "a@example.test", name: "User A" },
  b: { id: "user-b", email: "b@example.test", name: "User B" },
};

function authHeaders(user) {
  return {
    "oai-authenticated-user-id": user.id,
    "oai-authenticated-user-email": user.email,
    "oai-authenticated-user-full-name": encodeURIComponent(user.name),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
}

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("behavior", `${process.pid}-${Date.now()}`);
  const mod = await import(workerUrl.href);
  return mod.default;
}

function contentTypeFor(pathname) {
  const ext = extname(pathname);
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function createAssetsBinding() {
  return {
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      const safePath = pathname.replace(/^\/+/, "");
      try {
        const body = await readFile(join(process.cwd(), "public", safePath));
        return new Response(body, {
          headers: { "content-type": contentTypeFor(pathname) },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  };
}

async function createHarness() {
  const mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } }",
    modules: true,
    d1Databases: ["DB"],
    d1Persist: false,
    r2Buckets: ["FILES"],
    r2Persist: false,
  });
  const worker = await loadWorker();
  const env = {
    DB: await mf.getD1Database("DB"),
    FILES: await mf.getR2Bucket("FILES"),
    ASSETS: createAssetsBinding(),
    DATA_CORE_SUPER_ADMIN_EMAILS: users.admin.email,
  };
  // Miniflare proxies cannot receive Node's Headers instance across their RPC boundary.
  const rawFiles = env.FILES;
  env.FILES = new Proxy(rawFiles, {
    get(target, name) {
      // Node-to-workerd RPC loses the native R2 stream's known length. Buffer only tiny test fixtures at this boundary.
      if (name === 'put') return async (key, value, options) => target.put(key,
        value && typeof value.getReader === 'function' ? await new Response(value).arrayBuffer() : value, options);
      if (name === 'get') return async (...args) => {
        const object = await target.get(...args);
        if (!object) return object;
        return new Proxy(object, {
          get(value, key) {
            if (key === 'writeHttpMetadata') return (headers) => {
              if (value.httpMetadata?.contentType) headers.set('content-type', value.httpMetadata.contentType);
            };
            const member = value[key];
            return typeof member === 'function' ? member.bind(value) : member;
          },
        });
      };
      const member = target[name];
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });

  async function request(method, pathname, user, body, extraHeaders = {}) {
    const headers = new Headers(user ? authHeaders(user) : undefined);
    if (pathname.startsWith('/api/data-core/content')) headers.set('origin', 'http://localhost');
    if (pathname.includes('awardFolderId=')) headers.set('origin', 'http://localhost');
    for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
    let requestBody;
    if (body !== undefined) {
      headers.set("content-type", "application/json");
      requestBody = JSON.stringify(body);
    }
    const response = await worker.fetch(
      new Request(`http://localhost${pathname}`, { method, headers, body: requestBody }),
      env,
      { waitUntil() {}, passThroughOnException() {} },
    );
    const type = response.headers.get("content-type") || "";
    const parsed = type.includes("application/json")
      ? await response.json()
      : await response.text();
    return { response, body: parsed };
  }

  async function requestForm(pathname, user, form, extraHeaders = {}) {
    const headers = new Headers(user ? authHeaders(user) : undefined);
    if (pathname === '/api/data-core/instagram/derivatives') headers.set('origin', 'http://localhost');
    for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
    const response = await worker.fetch(
      new Request(`http://localhost${pathname}`, { method: "POST", headers, body: form }),
      env,
      { waitUntil() {}, passThroughOnException() {} },
    );
    const type = response.headers.get("content-type") || "";
    const parsed = type.includes("application/json")
      ? await response.json()
      : await response.text();
    return { response, body: parsed };
  }

  async function seedMembership(user, campusId, role = "TEACHER") {
    await request("GET", "/api/data-core/context", user);
    const now = new Date().toISOString();
    await env.DB
      .prepare(
        `INSERT INTO memberships (
           id, organization_id, campus_id, user_id, role, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        `membership:${user.id}:${campusId}:${role}`,
        ORGANIZATION_ID,
        campusId,
        `oai:${user.id}`,
        role,
        now,
        now,
      )
      .run();
  }

  async function seedFile({
    id,
    campusId,
    ownerUserId,
    visibility = "campus",
    category = "student-artwork",
    sourceApp = "data-core",
    recordId = null,
    mimeType = "image/png",
  }) {
    const now = new Date().toISOString();
    await env.DB
      .prepare(
        `INSERT INTO file_objects (
           id, organization_id, campus_id, data_record_id, owner_user_id,
           area, category, source_app, r2_key, original_file_name, mime_type,
           size_bytes, visibility, created_at, deleted_at
         ) VALUES (?, ?, ?, ?, ?, 'academy-public', ?, ?,
           ?, ?, ?, 128, ?, ?, NULL)`,
      )
      .bind(
        id,
        ORGANIZATION_ID,
        campusId,
        recordId,
        ownerUserId ? `oai:${ownerUserId}` : null,
        category,
        sourceApp,
        `data-core/test/${id}.png`,
        `${id}.png`,
        mimeType,
        visibility,
        now,
      )
      .run();
  }

  async function createDraft(user, payload) {
    const result = await request("POST", "/api/data-core/content", user, payload);
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    return result.body.draft;
  }

  await request("GET", "/api/data-core/context", users.admin);
  await seedMembership(users.a, CAMPUS_A);
  await seedMembership(users.b, CAMPUS_A);
  await seedMembership(users.b, CAMPUS_B);
  await seedFile({ id: "file-shared", campusId: CAMPUS_A, ownerUserId: users.a.id, visibility: "campus" });
  await seedFile({ id: "file-private-b", campusId: CAMPUS_A, ownerUserId: users.b.id, visibility: "private" });
  await seedFile({ id: "file-other-campus", campusId: CAMPUS_B, ownerUserId: users.b.id, visibility: "public" });

  return { mf, env, request, requestForm, createDraft, seedFile };
}

test("file and trash campus filters reject unauthorized scopes before returning an empty list", async () => {
  const h = await createHarness();
  try {
    await h.env.DB.prepare("UPDATE memberships SET role = 'STAFF' WHERE user_id = ?")
      .bind(`oai:${users.a.id}`).run();
    for (const path of ["/api/data-core/files", "/api/data-core/trash/files"]) {
      const foreign = await h.request("GET", `${path}?campusId=${CAMPUS_B}&q=no-matching-synthetic-file`, users.a);
      assert.equal(foreign.response.status, 403, `${path} must reject a foreign campus even when empty`);
      assert.equal("files" in foreign.body, false);
      const unknown = await h.request("GET", `${path}?campusId=synthetic-unknown-campus`, users.a);
      assert.equal(unknown.response.status, 403);
      assert.deepEqual(unknown.body, foreign.body);
      const own = await h.request("GET", `${path}?campusId=${CAMPUS_A}&q=no-matching-synthetic-file`, users.a);
      assert.equal(own.response.status, 200);
      assert.deepEqual(own.body.files, []);
      const multiCampus = await h.request("GET", `${path}?campusId=${CAMPUS_B}`, users.b);
      assert.equal(multiCampus.response.status, 200);
      const admin = await h.request("GET", `${path}?campusId=${CAMPUS_B}`, users.admin);
      assert.equal(admin.response.status, 200);
      const anonymous = await h.request("GET", `${path}?campusId=${CAMPUS_A}`);
      assert.equal(anonymous.response.status, 401);
      const unfiltered = await h.request("GET", path, users.a);
      assert.equal(unfiltered.response.status, 200);
      assert.equal(unfiltered.body.files.some((file) => file.id === "file-private-b"), false);
    }
    await h.seedFile({ id: "synthetic-foreign-private", campusId: CAMPUS_B, ownerUserId: users.b.id, visibility: "campus" });
    const fileRead = await h.request("GET", "/api/data-core/files/synthetic-foreign-private", users.a);
    assert.equal(fileRead.response.status, 403);
    const before = await h.env.DB.prepare("SELECT COUNT(*) AS count FROM file_objects").first();
    const listed = await h.request("GET", `/api/data-core/files?campusId=${CAMPUS_B}`, users.a);
    assert.equal(listed.response.status, 403);
    const after = await h.env.DB.prepare("SELECT COUNT(*) AS count FROM file_objects").first();
    assert.equal(after.count, before.count);
  } finally {
    await h.mf.dispose();
  }
});

test("content API enforces draft lifecycle, file reuse, filters, and permissions", async () => {
  const h = await createHarness();
  try {
    const blog = await h.createDraft(users.a, {
      campusId: CAMPUS_A,
      sourceApp: "blog",
      title: "Blog draft",
      summary: "first",
      content: "blog body",
      publishStatus: "draft",
      relatedFileIds: ["file-shared"],
      tags: ["class", "story"],
    });
    assert.equal(blog.recordType, "blog-draft");
    assert.equal(blog.sourceApp, "blog");
    assert.deepEqual(blog.metadata.relatedFileIds, ["file-shared"]);
    assert.equal(blog.content, "blog body");

    const fetchedBlog = await h.request("GET", `/api/data-core/content/${blog.id}`, users.a);
    assert.equal(fetchedBlog.response.status, 200);
    assert.equal(fetchedBlog.body.draft.title, "Blog draft");

    const patchedBlog = await h.request("PATCH", `/api/data-core/content/${blog.id}`, users.a, {
      campusId: CAMPUS_A,
      sourceApp: "blog",
      title: "Blog draft updated",
      content: "updated body",
      publishStatus: "ready",
      relatedFileIds: ["file-shared"],
    });
    assert.equal(patchedBlog.response.status, 200);
    assert.equal(patchedBlog.body.draft.metadata.publishStatus, "ready");
    assert.equal(patchedBlog.body.draft.content, "updated body");

    const instagram = await h.createDraft(users.a, {
      campusId: CAMPUS_A,
      sourceApp: "instagram",
      title: "Instagram draft",
      content: "caption",
      publishStatus: "review",
      relatedFileIds: ["file-shared"],
    });
    assert.equal(instagram.recordType, "instagram-draft");
    assert.equal(instagram.sourceApp, "instagram");
    assert.deepEqual(instagram.metadata.relatedFileIds, ["file-shared"]);
    assert.deepEqual(instagram.metadata.imageSpec, {
      width: 2160,
      height: 2700,
      aspectRatio: "4:5",
    });

    const patchedInstagram = await h.request(
      "PATCH",
      `/api/data-core/content/${instagram.id}`,
      users.a,
      {
        campusId: CAMPUS_A,
        sourceApp: "instagram",
        title: "Instagram draft updated",
        content: "caption updated",
        publishStatus: "ready",
        relatedFileIds: ["file-shared"],
      },
    );
    assert.equal(patchedInstagram.response.status, 200);
    assert.equal(patchedInstagram.body.draft.metadata.imageSpec.width, 2160);
    assert.equal(patchedInstagram.body.draft.metadata.imageSpec.height, 2700);
    assert.equal(patchedInstagram.body.draft.metadata.imageSpec.aspectRatio, "4:5");

    const blogList = await h.request("GET", "/api/data-core/content?sourceApp=blog", users.a);
    const instagramList = await h.request("GET", "/api/data-core/content?sourceApp=instagram", users.a);
    assert.equal(blogList.response.status, 200);
    assert.equal(instagramList.response.status, 200);
    assert.ok(blogList.body.drafts.some((draft) => draft.id === blog.id));
    assert.ok(blogList.body.drafts.every((draft) => draft.sourceApp === "blog"));
    assert.ok(instagramList.body.drafts.some((draft) => draft.id === instagram.id));
    assert.ok(instagramList.body.drafts.every((draft) => draft.sourceApp === "instagram"));

    const userBDraft = await h.createDraft(users.b, {
      campusId: CAMPUS_A,
      sourceApp: "blog",
      title: "User B draft",
      content: "owned by user b",
      relatedFileIds: ["file-shared"],
    });
    const userAPatchUserB = await h.request(
      "PATCH",
      `/api/data-core/content/${userBDraft.id}`,
      users.a,
      {
        campusId: CAMPUS_A,
        sourceApp: "blog",
        title: "take over",
      },
    );
    assert.equal(userAPatchUserB.response.status, 403);
    const userADeleteUserB = await h.request("DELETE", `/api/data-core/content/${userBDraft.id}`, users.a);
    assert.equal(userADeleteUserB.response.status, 403);

    const campusBCreate = await h.request("POST", "/api/data-core/content", users.a, {
      campusId: CAMPUS_B,
      sourceApp: "blog",
      title: "wrong campus",
      content: "not allowed",
    });
    assert.equal(campusBCreate.response.status, 403);

    const privateFileLink = await h.request("POST", "/api/data-core/content", users.a, {
      campusId: CAMPUS_A,
      sourceApp: "blog",
      title: "private file",
      relatedFileIds: ["file-private-b"],
    });
    assert.equal(privateFileLink.response.status, 403);

    const otherCampusFileLink = await h.request("POST", "/api/data-core/content", users.a, {
      campusId: CAMPUS_A,
      sourceApp: "blog",
      title: "other campus file",
      relatedFileIds: ["file-other-campus"],
    });
    assert.equal(otherCampusFileLink.response.status, 400);

    const deleteBlog = await h.request("DELETE", `/api/data-core/content/${blog.id}`, users.a);
    const deleteInstagram = await h.request("DELETE", `/api/data-core/content/${instagram.id}`, users.a);
    assert.equal(deleteBlog.response.status, 200);
    assert.equal(deleteInstagram.response.status, 200);
    assert.equal(deleteBlog.body.ok, true);
    assert.equal(deleteInstagram.body.ok, true);

    const deletedBlogFetch = await h.request("GET", `/api/data-core/content/${blog.id}`, users.a);
    const deletedInstagramFetch = await h.request("GET", `/api/data-core/content/${instagram.id}`, users.a);
    assert.equal(deletedBlogFetch.response.status, 404);
    assert.equal(deletedInstagramFetch.response.status, 404);
  } finally {
    await h.mf.dispose();
  }
});

test("smoke checks admissions, competition, roadmap, knowledge, and readiness routes", async () => {
  const h = await createHarness();
  try {
    const publicRoutes = [
      "/",
      "/admissions-web/renderer/index.html",
      "/data-core",
      "/data-core/counseling",
      "/data-core/counseling/competitions",
      "/data-core/curriculum",
      ...['content','design'].flatMap(family=>[
        `/data-core/curriculum/${family}`,
        ...['basic','advanced','admission'].map(stage=>`/data-core/curriculum/${family}/${stage}`),
      ]),
      "/data-core/work",
      "/data-core/work/library",
      "/data-core/content",
      "/data-core/content/blog",
      "/data-core/content/instagram",
      "/data-core/operations",
      "/data-core/roadmap",
      "/data-core/readiness",
    ];
    for (const route of publicRoutes) {
      const result = await h.request("GET", route, undefined);
      assert.equal(result.response.status, 200, `${route} should render`);
    }

    const health = await h.request("GET", "/api/data-core/health", undefined);
    assert.equal(health.response.status, 200);
    assert.equal(health.body.ok, true);

    const protectedApiRoutes = [
      "/api/data-core/competitions?limit=1",
      "/api/data-core/roadmap/goals",
      "/api/data-core/admin/knowledge/admissions/status",
      "/api/data-core/knowledge/nodes?limit=1",
    ];
    for (const route of protectedApiRoutes) {
      const result = await h.request("GET", route, undefined);
      assert.equal(result.response.status, 401, `${route} should reach the protected router`);
    }
  } finally {
    await h.mf.dispose();
  }
});

test("standalone accounts use secure sessions, enforce first password change, lock failures, and respect campus access", async () => {
  const h = await createHarness();
  try {
    const temporaryPassword = "Temporary-pass-123";
    const created = await h.request("POST", "/api/auth/accounts", users.admin, {
      loginId: "campus-a-teacher",
      displayName: "Campus A Teacher",
      role: "TEACHER",
      campusId: CAMPUS_A,
      temporaryPassword,
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.account.loginId, "campus-a-teacher");

    const accountId = created.body.account.id;
    const createdAccount = await h.env.DB.prepare("SELECT password_iterations FROM auth_accounts WHERE id = ?")
      .bind(accountId)
      .first();
    assert.equal(createdAccount.password_iterations, 100_000);

    for (let index = 0; index < 5; index += 1) {
      const failed = await h.request("POST", "/api/auth/login", undefined, { loginId: "campus-a-teacher", password: "wrong-password" });
      assert.equal(failed.response.status, 401);
    }
    const locked = await h.request("POST", "/api/auth/login", undefined, { loginId: "campus-a-teacher", password: temporaryPassword });
    assert.equal(locked.response.status, 423);

    const reset = await h.request("PATCH", `/api/auth/accounts/${accountId}`, users.admin, { temporaryPassword, revokeSessions: true });
    assert.equal(reset.response.status, 200);
    const login = await h.request("POST", "/api/auth/login", undefined, { loginId: "campus-a-teacher", password: temporaryPassword });
    assert.equal(login.response.status, 200);
    assert.equal(login.body.mustChangePassword, true);
    const cookie = login.response.headers.get("set-cookie");
    assert.match(cookie, /Secure; HttpOnly; SameSite=Lax/);
    const auth = { cookie };

    const initialSession = await h.request("GET", "/api/auth/session", undefined, undefined, auth);
    assert.equal(initialSession.body.authenticated, true);
    assert.equal(initialSession.body.mustChangePassword, true);
    const blockedSecondLogin = await h.request("POST", "/api/auth/login", undefined, { loginId: "campus-a-teacher", password: temporaryPassword }, auth);
    assert.equal(blockedSecondLogin.response.status, 403);
    const blockedWrite = await h.request("POST", "/api/data-core/content", undefined, { campusId: CAMPUS_A, sourceApp: "blog", title: "blocked", content: "blocked" }, auth);
    assert.equal(blockedWrite.response.status, 403);
    for (const route of [
      "/api/data-core/campuses",
      `/api/data-core/files?campusId=${CAMPUS_A}`,
      "/api/data-core/content?sourceApp=blog",
      "/api/data-core/context",
    ]) {
      const blockedRead = await h.request("GET", route, undefined, undefined, auth);
      assert.equal(blockedRead.response.status, 403, `${route} should require a password change`);
    }
    for (const route of ["/data-core/work/library", "/data-core/accounts", "/data-core/operations"]) {
      const redirectedUi = await h.request("GET", route, undefined, undefined, auth);
      assert.match(String(redirectedUi.body), /비밀번호 변경/, `${route} should render the password-change login page`);
    }

    const changed = await h.request("PUT", "/api/auth/password", undefined, { currentPassword: temporaryPassword, nextPassword: "Changed-pass-456" }, auth);
    assert.equal(changed.response.status, 200);
    const changedCookie = changed.response.headers.get("set-cookie");
    const changedAuth = { cookie: changedCookie };
    const campusAWrite = await h.request("POST", "/api/data-core/content", undefined, { campusId: CAMPUS_A, sourceApp: "blog", title: "allowed", content: "allowed" }, changedAuth);
    assert.equal(campusAWrite.response.status, 201);
    const campusBWrite = await h.request("POST", "/api/data-core/content", undefined, { campusId: CAMPUS_B, sourceApp: "blog", title: "denied", content: "denied" }, changedAuth);
    assert.equal(campusBWrite.response.status, 403);

    const logout = await h.request("POST", "/api/auth/logout", undefined, {}, changedAuth);
    assert.equal(logout.response.status, 200);
    const afterLogout = await h.request("GET", "/api/auth/session", undefined, undefined, changedAuth);
    assert.equal(afterLogout.body.authenticated, false);

    const disabled = await h.request("PATCH", `/api/auth/accounts/${accountId}`, users.admin, { status: "disabled" });
    assert.equal(disabled.response.status, 200);
    const disabledLogin = await h.request("POST", "/api/auth/login", undefined, { loginId: "campus-a-teacher", password: "Changed-pass-456" });
    assert.equal(disabledLogin.response.status, 401);

    await h.env.DB.prepare("UPDATE auth_accounts SET status = 'active', password_iterations = ? WHERE id = ?")
      .bind(100_001, accountId)
      .run();
    const unsupportedLegacyAccount = await h.request("POST", "/api/auth/login", undefined, { loginId: "campus-a-teacher", password: "Changed-pass-456" });
    assert.equal(unsupportedLegacyAccount.response.status, 409);
    assert.match(unsupportedLegacyAccount.body.error, /비밀번호 재설정/);
  } finally {
    await h.mf.dispose();
  }
});

test("standalone master accounts cannot lose the final administrator or revoke their own session", async () => {
  const h = await createHarness();
  try {
    const temporaryPassword = "Master-temp-pass-123";
    const first = await h.request("POST", "/api/auth/accounts", users.admin, {
      loginId: "standalone-master-one",
      displayName: "Standalone Master One",
      role: "SUPER_ADMIN",
      temporaryPassword,
    });
    assert.equal(first.response.status, 201, JSON.stringify(first.body));

    const blockedLastAdmin = await h.request("PATCH", `/api/auth/accounts/${first.body.account.id}`, users.admin, { status: "disabled" });
    assert.equal(blockedLastAdmin.response.status, 409);

    const second = await h.request("POST", "/api/auth/accounts", users.admin, {
      loginId: "standalone-master-two",
      displayName: "Standalone Master Two",
      role: "SUPER_ADMIN",
      temporaryPassword,
    });
    assert.equal(second.response.status, 201, JSON.stringify(second.body));

    const firstLogin = await h.request("POST", "/api/auth/login", undefined, { loginId: "standalone-master-one", password: temporaryPassword });
    const firstChanged = await h.request("PUT", "/api/auth/password", undefined, {
      currentPassword: temporaryPassword,
      nextPassword: "Master-changed-pass-456",
    }, { cookie: firstLogin.response.headers.get("set-cookie") });
    assert.equal(firstChanged.response.status, 200);
    const firstAuth = { cookie: firstChanged.response.headers.get("set-cookie") };

    const blockedSelfRevoke = await h.request("PATCH", `/api/auth/accounts/${first.body.account.id}`, undefined, { revokeSessions: true }, firstAuth);
    assert.equal(blockedSelfRevoke.response.status, 400);
    const blockedSelfDisable = await h.request("PATCH", `/api/auth/accounts/${first.body.account.id}`, undefined, { status: "disabled" }, firstAuth);
    assert.equal(blockedSelfDisable.response.status, 400);

    const disableWithBackupAdmin = await h.request("PATCH", `/api/auth/accounts/${first.body.account.id}`, users.admin, { status: "disabled" });
    assert.equal(disableWithBackupAdmin.response.status, 200);
  } finally {
    await h.mf.dispose();
  }
});

test("DATA CORE mode folders use registered campuses and category filters", async () => {
  const h = await createHarness();
  try {
    const now = new Date().toISOString();
    await h.env.DB
      .prepare(
        `INSERT INTO campuses (
           id, organization_id, code, name, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      )
      .bind(
        "campus-issue-23-auto",
        ORGANIZATION_ID,
        "issue-23-auto",
        "Issue 23 자동 캠퍼스",
        now,
        now,
      )
      .run();

    const campuses = await h.request("GET", "/api/data-core/campuses", users.admin);
    assert.equal(campuses.response.status, 200);
    assert.ok(
      campuses.body.campuses.some((campus) => campus.id === "campus-issue-23-auto"),
      "new campus rows should be returned without code changes",
    );

    const filteredFiles = await h.request(
      "GET",
      `/api/data-core/files?campusId=${CAMPUS_A}&category=student-artwork`,
      users.a,
    );
    assert.equal(filteredFiles.response.status, 200);
    assert.ok(filteredFiles.body.files.some((file) => file.id === "file-shared"));
    assert.ok(filteredFiles.body.files.every((file) => file.campusId === CAMPUS_A));
    assert.ok(filteredFiles.body.files.every((file) => file.category === "student-artwork"));
  } finally {
    await h.mf.dispose();
  }
});

test("DATA CORE source folders apply blog and Instagram sourceApp filters", async () => {
  const h = await createHarness();
  try {
    await h.seedFile({
      id: "file-blog-source",
      campusId: CAMPUS_A,
      ownerUserId: users.a.id,
      category: "class-photo",
      sourceApp: "blog",
    });
    await h.seedFile({
      id: "file-instagram-source",
      campusId: CAMPUS_A,
      ownerUserId: users.a.id,
      category: "class-photo",
      sourceApp: "instagram",
    });

    const blogFiles = await h.request(
      "GET",
      `/api/data-core/files?campusId=${CAMPUS_A}&category=class-photo&sourceApp=blog`,
      users.a,
    );
    const instagramFiles = await h.request(
      "GET",
      `/api/data-core/files?campusId=${CAMPUS_A}&category=class-photo&sourceApp=instagram`,
      users.a,
    );

    assert.equal(blogFiles.response.status, 200);
    assert.deepEqual(blogFiles.body.files.map((file) => file.id), ["file-blog-source"]);
    assert.equal(blogFiles.body.files[0].sourceApp, "blog");
    assert.equal(instagramFiles.response.status, 200);
    assert.deepEqual(instagramFiles.body.files.map((file) => file.id), ["file-instagram-source"]);
    assert.equal(instagramFiles.body.files[0].sourceApp, "instagram");
  } finally {
    await h.mf.dispose();
  }
});

test("library uploads accept exactly nine categories and derive storage metadata on the server", async () => {
  const h = await createHarness();
  try {
    const categories = [
      "class-photo",
      "student-artwork",
      "academy-photo",
      "competition-material",
      "admission-material",
      "counseling-material",
      "blog-source",
      "instagram-source",
      "promotion-material",
    ];

    for (const category of categories) {
      const form = new FormData();
      form.append("file", new File([category], `${category}.txt`, { type: "text/plain" }));
      form.append("campusId", CAMPUS_A);
      form.append("category", category);
      form.append("area", "academy-public");
      form.append("sourceApp", "forged-client-value");
      const uploaded = await h.requestForm("/api/data-core/files", users.a, form);
      assert.equal(uploaded.response.status, 201, JSON.stringify(uploaded.body));
      assert.equal(uploaded.body.file.category, category);

      const expectedArea = category === "student-artwork"
        ? "student-private"
        : category === "promotion-material"
          ? "academy-public"
          : "documents-private";
      const expectedVisibility = category === "student-artwork"
        ? "private"
        : category === "promotion-material"
          ? "public"
          : "campus";
      const expectedSourceApp = category === "blog-source"
        ? "blog"
        : category === "instagram-source"
          ? "instagram"
          : "data-core";
      assert.equal(uploaded.body.file.area, expectedArea);
      assert.equal(uploaded.body.file.visibility, expectedVisibility);
      assert.equal(uploaded.body.file.sourceApp, expectedSourceApp);

      const stored = await h.env.DB
        .prepare("SELECT area, visibility, source_app FROM file_objects WHERE id = ?")
        .bind(uploaded.body.file.id)
        .first();
      assert.deepEqual(stored, {
        area: expectedArea,
        visibility: expectedVisibility,
        source_app: expectedSourceApp,
      });
    }

    const rejected = new FormData();
    rejected.append("file", new File(["legacy"], "legacy.txt", { type: "text/plain" }));
    rejected.append("campusId", CAMPUS_A);
    rejected.append("category", "document");
    const response = await h.requestForm("/api/data-core/files", users.a, rejected);
    assert.equal(response.response.status, 400);
  } finally {
    await h.mf.dispose();
  }
});

test("competition media uses linked DATA CORE files and has an empty state before files exist", async () => {
  const h = await createHarness();
  try {
    const created = await h.request("POST", "/api/data-core/competitions", users.admin, {
      title: "Connected media competition",
      campusId: CAMPUS_A,
      targetGrades: ["고2"],
      practicalTypes: ["상황표현"],
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    const competitionId = created.body.competition.id;

    const empty = await h.request(
      "GET",
      `/api/data-core/files?recordId=${competitionId}&sourceApp=competition`,
      users.admin,
    );
    assert.equal(empty.response.status, 200);
    assert.deepEqual(empty.body.files, []);

    await h.seedFile({
      id: "competition-poster-file",
      campusId: CAMPUS_A,
      ownerUserId: users.admin.id,
      recordId: competitionId,
      category: "competition-poster",
      sourceApp: "competition",
    });
    await h.seedFile({
      id: "competition-guide-file",
      campusId: CAMPUS_A,
      ownerUserId: users.admin.id,
      recordId: competitionId,
      category: "competition-guide",
      sourceApp: "competition",
      mimeType: "application/pdf",
    });
    await h.seedFile({
      id: "competition-award-file",
      campusId: CAMPUS_A,
      ownerUserId: users.admin.id,
      recordId: competitionId,
      category: "award-work",
      sourceApp: "competition",
    });
    await h.seedFile({
      id: "competition-unrelated-file",
      campusId: CAMPUS_A,
      ownerUserId: users.admin.id,
      category: "award-work",
      sourceApp: "competition",
    });

    const linked = await h.request(
      "GET",
      `/api/data-core/files?recordId=${competitionId}&sourceApp=competition`,
      users.admin,
    );
    assert.equal(linked.response.status, 200);
    assert.deepEqual(
      linked.body.files.map((file) => file.id).sort(),
      ["competition-award-file", "competition-guide-file", "competition-poster-file"],
    );
    assert.ok(linked.body.files.every((file) => file.recordId === competitionId));
    assert.ok(linked.body.files.every((file) => file.sourceApp === "competition"));
  } finally {
    await h.mf.dispose();
  }
});

test("competition award folders link DATA CORE files and reject deleting nonempty folders", async () => {
  const h = await createHarness();
  try {
    const created = await h.request("POST", "/api/data-core/records", users.admin, {
      recordType: "competition-award-folder",
      sourceApp: "competition",
      campusId: CAMPUS_A,
      title: "2026 수상작",
      visibility: "organization",
      tags: ["competition-award-library"],
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    const folderId = created.body.record.id;

    const form = new FormData();
    form.append("file", new File(["award"], "award.png", { type: "image/png" }));
    form.append("campusId", CAMPUS_A);
    form.append("category", "competition-material");
    form.append("recordId", folderId);
    const uploaded = await h.requestForm("/api/data-core/files", users.admin, form);
    assert.equal(uploaded.response.status, 201, JSON.stringify(uploaded.body));
    assert.equal(uploaded.body.file.recordId, folderId);

    const linked = await h.request(
      "GET",
      `/api/data-core/files?recordId=${folderId}&category=competition-material`,
      users.admin,
    );
    assert.equal(linked.response.status, 200);
    assert.equal(linked.body.files.length, 1);

    const deleted = await h.request("DELETE", `/api/data-core/records/${folderId}`, users.admin);
    assert.equal(deleted.response.status, 409, JSON.stringify(deleted.body));

    const remaining = await h.request(
      "GET",
      `/api/data-core/files?recordId=${folderId}&category=competition-material`,
      users.admin,
    );
    assert.equal(remaining.response.status, 200);
    assert.equal(remaining.body.files.length, 1);
  } finally {
    await h.mf.dispose();
  }
});

test("award folder files enforce campus authorization and retain R2 bytes when folder deletion is blocked", async () => {
  const h = await createHarness();
  try {
    // This harness normally gives B both campuses; keep only B's campus for this isolation test.
    await h.env.DB.prepare("DELETE FROM memberships WHERE user_id = ? AND campus_id = ?")
      .bind("oai:user-b", CAMPUS_A).run();
    const created = await h.request("POST", "/api/data-core/records", users.a, {
      recordType: "competition-award-folder", sourceApp: "competition", campusId: CAMPUS_A,
      title: "Synthetic campus award folder", visibility: "campus",
    });
    assert.equal(created.response.status, 201);
    const folderId = created.body.record.id;
    const upload = (campus) => {
      const form = new FormData();
      form.append("file", new File(["synthetic-award-bytes"], "synthetic.png", {type:"image/png"}));
      form.append("campusId", campus);
      form.append("category", "competition-material");
      form.append("recordId", folderId);
      return form;
    };
    assert.equal((await h.request("GET", `/api/data-core/records/${folderId}`, users.b)).response.status, 403);
    assert.equal((await h.requestForm("/api/data-core/files", users.b, upload(CAMPUS_B))).response.status, 403);
    const uploaded = await h.requestForm("/api/data-core/files", users.a, upload(CAMPUS_A));
    assert.equal(uploaded.response.status, 201);
    const fileId = uploaded.body.file.id;
    assert.equal((await h.request("GET", `/api/data-core/files/${fileId}`, users.b)).response.status, 403);
    const otherList = await h.request("GET", `/api/data-core/files?recordId=${folderId}`, users.b);
    assert.deepEqual(otherList.body.files, []);
    assert.equal((await h.request("DELETE", `/api/data-core/records/${folderId}`, users.b)).response.status, 403);
    assert.equal((await h.request("DELETE", `/api/data-core/records/${folderId}`, users.a)).response.status, 409);
    const retained = await h.request("GET", `/api/data-core/files?recordId=${folderId}`, users.a);
    assert.equal(retained.response.status, 200);
    assert.equal(retained.body.files[0].id, fileId);
    const stored = await h.env.DB.prepare("SELECT r2_key, deleted_at FROM file_objects WHERE id = ?").bind(fileId).first();
    assert.equal(stored.deleted_at, null);
    assert.equal(await (await h.env.FILES.get(stored.r2_key)).text(), "synthetic-award-bytes");
  } finally {
    await h.mf.dispose();
  }
});

test("academy calendar shares validated events while enforcing campus ownership and date ranges", async () => {
  const h = await createHarness();
  try {
    const unauthenticated = await h.request("GET", "/api/data-core/calendar?from=2026-10-01&to=2026-10-31");
    assert.equal(unauthenticated.response.status, 401);

    const organizationDenied = await h.request("POST", "/api/data-core/calendar", users.a, {
      title: "forged organization event",
      visibility: "organization",
      startDate: "2026-10-10",
      eventType: "meeting",
    });
    assert.equal(organizationDenied.response.status, 403);

    const crossCampusDenied = await h.request("POST", "/api/data-core/calendar", users.a, {
      title: "forged campus event",
      campusId: CAMPUS_B,
      visibility: "campus",
      startDate: "2026-10-10",
      eventType: "meeting",
    });
    assert.equal(crossCampusDenied.response.status, 403);

    const created = await h.request("POST", "/api/data-core/calendar", users.a, {
      title: "Campus schedule",
      campusId: CAMPUS_A,
      visibility: "campus",
      summary: "synthetic test event",
      startDate: "2026-10-10",
      endDate: "2026-10-12",
      allDay: false,
      eventType: "class",
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.event.recordType, "academy-calendar-event");
    assert.equal(created.body.event.sourceApp, "academy-calendar");
    assert.equal(created.body.event.metadata.schemaVersion, 1);
    assert.equal(created.body.event.metadata.allDay, true);
    assert.equal(created.body.event.metadata.endDate, "2026-10-12");
    const eventId = created.body.event.id;

    const range = await h.request("GET", "/api/data-core/calendar?from=2026-10-11&to=2026-10-11", users.a);
    assert.equal(range.response.status, 200, JSON.stringify(range.body));
    assert.deepEqual(range.body.events.map((event) => event.id), [eventId]);

    const outsideRange = await h.request("GET", "/api/data-core/calendar?from=2026-10-13&to=2026-10-13", users.a);
    assert.equal(outsideRange.response.status, 200);
    assert.deepEqual(outsideRange.body.events, []);

    const crossCampusList = await h.request("GET", `/api/data-core/calendar?from=2026-10-01&to=2026-10-31&campusId=${CAMPUS_B}`, users.a);
    assert.equal(crossCampusList.response.status, 403);

    const updated = await h.request("PATCH", `/api/data-core/calendar/${eventId}`, users.a, {
      title: "Updated schedule",
      summary: "updated synthetic event",
      campusId: CAMPUS_A,
      visibility: "campus",
      metadata: { startDate: "2026-10-11", eventType: "meeting" },
    });
    assert.equal(updated.response.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.event.title, "Updated schedule");
    assert.equal(updated.body.event.metadata.startDate, "2026-10-11");
    assert.equal(updated.body.event.metadata.endDate, "2026-10-12");

    const otherUsersEvent = await h.request("POST", "/api/data-core/calendar", users.admin, {
      title: "Admin campus event",
      campusId: CAMPUS_A,
      visibility: "campus",
      startDate: "2026-10-14",
      eventType: "meeting",
    });
    assert.equal(otherUsersEvent.response.status, 201, JSON.stringify(otherUsersEvent.body));
    const editOthersEvent = await h.request("PATCH", `/api/data-core/calendar/${otherUsersEvent.body.event.id}`, users.a, {
      title: "not allowed",
      campusId: CAMPUS_A,
      visibility: "campus",
      metadata: { startDate: "2026-10-14", eventType: "meeting" },
    });
    assert.equal(editOthersEvent.response.status, 403);

    const deleted = await h.request("DELETE", `/api/data-core/calendar/${eventId}`, users.a);
    assert.equal(deleted.response.status, 200, JSON.stringify(deleted.body));
  } finally {
    await h.mf.dispose();
  }
});

test("competition source preview and import keep raw HTML out while preserving safe provenance", async () => {
  const h = await createHarness();
  const originalFetch = globalThis.fetch;
  const artmdHtml = `
    <li class="list-item"><a href="/shop/item.php?it_id=synthetic-01">Synthetic Art Contest</a>
    <div class="wr-date">2026.10.01 ~ 2026.10.31</div><div class="wr-wr_15">접수중</div></li>`;
  const mgoodHtml = `
    <table><tr><td>공모전</td><td><a href="/contest/21002_contest_view.php?c_seq=synthetic-02">Synthetic Art Contest</a></td>
    <td></td><td>2026.10.01 ~ 2026.10.31</td><td><div class="dDay">접수중</div></td></tr></table>`;
  try {
    globalThis.fetch = async (url) => new Response(String(url).includes("mgood") ? mgoodHtml : artmdHtml, {
      headers: { "content-type": "text/html" },
    });
    const origin = { origin: "http://localhost" };
    const unauthenticated = await h.request("POST", "/api/data-core/competition-sources/artmd/preview");
    assert.equal(unauthenticated.response.status, 401);

    const preview = await h.request("POST", "/api/data-core/competition-sources/artmd/preview", users.admin, undefined, origin);
    assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.response.headers.get("cache-control"), "private, no-store");
    assert.equal(preview.body.items.length, 1);
    assert.equal(preview.body.items[0].importStatus, "new");
    assert.ok(preview.body.items[0].sourceUrl.includes("synthetic-01"));
    assert.equal(JSON.stringify(preview.body).includes("<a href"), false);

    const crossOrigin = await h.request("POST", "/api/data-core/competition-sources/artmd/import", users.admin, undefined, { origin: "https://attacker.example" });
    assert.equal(crossOrigin.response.status, 403);

    const imported = await h.request("POST", "/api/data-core/competition-sources/artmd/import", users.admin, undefined, origin);
    assert.equal(imported.response.status, 200, JSON.stringify(imported.body));
    assert.equal(imported.body.summary.created, 1);

    const repeated = await h.request("POST", "/api/data-core/competition-sources/artmd/import", users.admin, undefined, origin);
    assert.equal(repeated.response.status, 200, JSON.stringify(repeated.body));
    assert.equal(repeated.body.summary.unchanged, 1);

    const merged = await h.request("POST", "/api/data-core/competition-sources/mgood/import", users.admin, undefined, origin);
    assert.equal(merged.response.status, 200, JSON.stringify(merged.body));
    assert.equal(merged.body.summary.updated, 1);
    const competitions = await h.request("GET", "/api/data-core/competitions?limit=10", users.admin);
    assert.equal(competitions.response.status, 200);
    assert.equal(competitions.body.competitions.length, 1);
    assert.equal(competitions.body.competitions[0].metadata.sources.length, 2);
    assert.equal(JSON.stringify(competitions.body.competitions[0]).includes("<a href"), false);
  } finally {
    globalThis.fetch = originalFetch;
    await h.mf.dispose();
  }
});

test("competition source failures and ambiguous matches never replace existing DATA CORE records", async () => {
  const h = await createHarness();
  const originalFetch = globalThis.fetch;
  const origin = { origin: "http://localhost" };
  const html = `<li class="list-item"><a href="/shop/item.php?it_id=ambiguous">Ambiguous Contest</a><div class="wr-date">2026.11.01 ~ 2026.11.30</div><div class="wr-wr_15">접수중</div></li>`;
  try {
    for (const suffix of ["one", "two"]) {
      const created = await h.request("POST", "/api/data-core/competitions", users.admin, {
        title: "Ambiguous Contest",
        visibility: "organization",
        applicationStart: "2026-11-01",
        applicationEnd: "2026-11-30",
        organizer: `Synthetic ${suffix}`,
      });
      assert.equal(created.response.status, 201, JSON.stringify(created.body));
    }
    globalThis.fetch = async () => new Response(html, { headers: { "content-type": "text/html" } });
    const ambiguous = await h.request("POST", "/api/data-core/competition-sources/artmd/import", users.admin, undefined, origin);
    assert.equal(ambiguous.response.status, 200, JSON.stringify(ambiguous.body));
    assert.equal(ambiguous.body.summary.ambiguous, 1);
    const beforeFailure = await h.request("GET", "/api/data-core/competitions?limit=10", users.admin);
    assert.equal(beforeFailure.body.competitions.length, 2);

    globalThis.fetch = async () => { throw new Error("synthetic timeout"); };
    const failedPreview = await h.request("POST", "/api/data-core/competition-sources/artmd/preview", users.admin, undefined, origin);
    assert.equal(failedPreview.response.status, 502);
    const afterFailure = await h.request("GET", "/api/data-core/competitions?limit=10", users.admin);
    assert.equal(afterFailure.body.competitions.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    await h.mf.dispose();
  }
});

test('award uploads preserve original names and scoped permanent deletion removes only unreferenced authorized files', async () => {
  const h = await createHarness();
  try {
    const create = (title) => h.request('POST', '/api/data-core/records', users.a, {
      recordType:'competition-award-folder', sourceApp:'competition', campusId:CAMPUS_A, title, visibility:'campus',
    });
    const folder = (await create('합성 / 폴더')).body.record;
    const other = (await create('다른 합성 폴더')).body.record;
    const originals = [];
    for (const name of ['합성 작품 (최종).PNG', '합성 작품 (최종).PNG', 'three.webp']) {
      const form = new FormData();
      form.append('file', new File([tinyPng()], name, {type:'image/png'}));
      form.append('recordId',folder.id); form.append('category','competition-material'); form.append('campusId',CAMPUS_A);
      form.append('fileName','forged'); form.append('ownerUserId','forged');
      const saved = await h.requestForm('/api/data-core/files', users.a, form);
      assert.equal(saved.response.status,201,JSON.stringify(saved.body));
      const row = await h.env.DB.prepare('SELECT * FROM file_objects WHERE id=?').bind(saved.body.file.id).first();
      assert.equal(row.original_file_name, name);
      assert.equal(saved.body.file.fileName, name);
      assert.equal(row.owner_user_id,'oai:user-a'); assert.equal(row.data_record_id,folder.id);
      originals.push(row);
    }
    assert.equal(new Set(originals.map(row=>row.r2_key)).size,3);
    assert.equal(new Set(originals.map(row=>row.id)).size,3);
    const listed = await h.request('GET',`/api/data-core/files?recordId=${folder.id}`,users.a);
    for (const row of originals) {
      assert.equal(listed.body.files.find(file=>file.id===row.id)?.fileName,row.original_file_name);
      assert.deepEqual(new Uint8Array(await (await h.env.FILES.get(row.r2_key)).arrayBuffer()),tinyPng());
    }
    const path = `/api/data-core/files/${originals[0].id}?awardFolderId=${folder.id}`;
    assert.equal((await h.request('DELETE',path,users.b)).response.status,403);
    assert.equal((await h.request('DELETE',path,users.a)).response.status,403);
    assert.equal((await h.request('DELETE',`/api/data-core/records/${folder.id}`,users.admin)).response.status,409);
    assert.equal((await h.request('DELETE',path.replace(folder.id,other.id),users.admin)).response.status,403);
    assert.equal((await h.request('DELETE',path,users.a,undefined,{origin:'https://attacker.example'})).response.status,403);
    await h.env.DB.prepare('DELETE FROM memberships WHERE user_id=? AND campus_id=?').bind('oai:user-a',CAMPUS_A).run();
    assert.equal((await h.request('DELETE',path,users.a)).response.status,403);
    assert.equal((await h.request('DELETE',path,users.admin)).response.status,200);
    assert.equal((await h.request('GET',`/api/data-core/files/${originals[0].id}`,users.admin)).response.status,404);
    assert.equal(await h.env.FILES.get(originals[0].r2_key),null);
    assert.equal(await h.env.DB.prepare('SELECT id FROM file_objects WHERE id=?').bind(originals[0].id).first(),null);
    for (const row of originals.slice(1)) assert.deepEqual(new Uint8Array(await (await h.env.FILES.get(row.r2_key)).arrayBuffer()),tinyPng());
    for (const row of originals.slice(1)) assert.deepEqual(await h.env.DB.prepare('SELECT * FROM file_objects WHERE id=?').bind(row.id).first(),row);
    const restored = await h.request('POST',`/api/data-core/trash/files/${originals[0].id}/restore`,users.admin);
    assert.equal(restored.response.status,404);
    const secondPath=`/api/data-core/files/${originals[1].id}?awardFolderId=${folder.id}`;
    const draft=await h.createDraft(users.admin,{sourceApp:'blog',campusId:CAMPUS_A,title:'Synthetic shared reference',relatedFileIds:[originals[1].id]});
    assert.equal((await h.request('DELETE',secondPath,users.admin)).response.status,409);
    assert.deepEqual(await h.env.DB.prepare('SELECT * FROM file_objects WHERE id=?').bind(originals[1].id).first(),originals[1]);
    assert.equal((await h.request('DELETE',`/api/data-core/content/${draft.id}`,users.admin)).response.status,200);
    assert.equal((await h.request('DELETE',secondPath,users.admin)).response.status,409,'trashed draft still protects the original');
    await h.env.DB.prepare("UPDATE data_records SET metadata_json='{}' WHERE id=?").bind(draft.id).run();
    await h.env.FILES.put('state/admissions-data.json',JSON.stringify({synthetic:{dataCoreFileId:originals[1].id}}));
    assert.equal((await h.request('DELETE',secondPath,users.admin)).response.status,409,'legacy admissions reference also protected');
    await h.env.FILES.delete('state/admissions-data.json');
    for(const row of originals.slice(1)) assert.equal((await h.request('DELETE',`/api/data-core/files/${row.id}?awardFolderId=${folder.id}`,users.admin)).response.status,200);
    assert.equal((await h.request('GET',`/api/data-core/files?recordId=${folder.id}`,users.admin)).body.files.length,0);
    assert.equal((await h.request('DELETE',`/api/data-core/records/${folder.id}`,users.admin)).response.status,200);
  } finally { await h.mf.dispose(); }
});

test('award purge compensates R2/DB failures and refuses concurrent deletes', async () => {
  const h=await createHarness();
  try {
    const folder=(await h.request('POST','/api/data-core/records',users.admin,{recordType:'competition-award-folder',sourceApp:'competition',title:'Synthetic failure fixture'})).body.record;
    const form=new FormData();form.append('file',new File([tinyPng()],'synthetic.png',{type:'image/png'}));form.append('recordId',folder.id);form.append('category','competition-material');
    const saved=await h.requestForm('/api/data-core/files',users.admin,form);
    assert.equal(saved.response.status,201);
    const row=await h.env.DB.prepare('SELECT * FROM file_objects WHERE id=?').bind(saved.body.file.id).first();
    const endpoint=`/api/data-core/files/${row.id}?awardFolderId=${folder.id}`;
    const db=h.env.DB,bucket=h.env.FILES;
    let deleted=false,failR2=true,failDb=false;
    h.env.FILES=new Proxy(bucket,{get(target,name){
      if(name==='delete')return async key=>{if(failR2)throw Error('synthetic R2 failure');await target.delete(key);deleted=true;};
      const value=target[name];return typeof value==='function'?value.bind(target):value;
    }});
    h.env.DB=new Proxy(db,{get(target,name){
      if(name==='batch')return async statements=>{if(failDb&&deleted)throw Error('synthetic DB failure');return target.batch(statements);};
      const value=target[name];return typeof value==='function'?value.bind(target):value;
    }});
    for(const failure of ['R2','DB']) {
      failR2=failure==='R2';failDb=failure==='DB';deleted=false;
      assert.equal((await h.request('DELETE',endpoint,users.admin)).response.status,500);
      assert.deepEqual(await db.prepare('SELECT * FROM file_objects WHERE id=?').bind(row.id).first(),row);
      assert.deepEqual(new Uint8Array(await (await bucket.get(row.r2_key)).arrayBuffer()),tinyPng());
    }
    failR2=false;failDb=false;
    await db.prepare("UPDATE file_objects SET deleted_at='purging:synthetic' WHERE id=?").bind(row.id).run();
    assert.equal((await h.request('DELETE',endpoint,users.admin)).response.status,409);
    assert.equal((await h.request('POST',`/api/data-core/trash/files/${row.id}/restore`,users.admin)).response.status,409);
    failR2=false;failDb=false;
    await db.prepare('UPDATE file_objects SET deleted_at=NULL WHERE id=?').bind(row.id).run();
    assert.equal((await h.request('DELETE',endpoint,users.admin)).response.status,200);
  } finally {await h.mf.dispose();}
});

test('live news isolates exact row status, ignores comments, reports three pages and keeps partial failures read-only', async () => {
  const h = await createHarness(), originalFetch = globalThis.fetch;
  const artRow = (id,status,date='09.01 ~ 09.30') => `<li class="list-item"><div class="wr-subject"><a href="./item.php?it_id=${id}&amp;ca_id=20">합성 대회 ${id}</a></div><div class="wr-date">${date}</div><div class="wr-wr_4">합성 주최</div><div class="wr-wr_15">${status}</div></li>`;
  const mgoodRow = (id,status) => `<tr><td>실기대회</td><td><a href="21002_contest_view.php?c_seq=${id}&amp;state=other">합성 대회 ${id}</a></td><td>합성 주최</td><td>2099-09-01<br>~<br>2099-09-30</td><td><div class="dDay">${status}</div><div class="dd">D-20</div></td></tr>`;
  try {
    let failOther = false;
    globalThis.fetch = async (url) => {
      if (String(url).includes('artndesign')) return new Response(artRow('1','접수중','2099.09.01 ~ 2099.09.30') + artRow('2','접수전') + artRow('3','수험표발급') + artRow('4','접수중','2020.09.01 ~ 2020.09.30') + `<!--${artRow('comment','접수중')}-->`);
      if (String(url).includes('state=other')) {
        if (failOther) throw new Error('synthetic timeout');
        return new Response(`<table>${mgoodRow('one','접수중')}${mgoodRow('two','예정')}${mgoodRow('three','접수전')}${mgoodRow('four','마감')}</table>`);
      }
      return new Response(`<table>${mgoodRow('closed','종료')}<!--${mgoodRow('comment','접수중')}--></table>`);
    };
    const art = await h.request('POST','/api/data-core/competition-sources/artmd/preview',users.admin);
    assert.equal(art.response.status,200); assert.equal(art.body.items.length,4);
    assert.equal(art.body.pages[0].open,1); assert.equal(art.body.pages[0].excluded,2); assert.equal(art.body.pages[0].upcoming,1);
    assert.match(art.body.items[0].sourceUrl,/\?it_id=1&ca_id=20$/);
    assert.equal(art.body.items[1].sourceStatus,'upcoming');
    assert.equal(art.body.items[2].sourceStatus,'unknown');
    const mgood = await h.request('POST','/api/data-core/competition-sources/mgood/preview',users.admin);
    assert.equal(mgood.body.pages.length,2); assert.equal(mgood.body.pages[0].open,0);
    assert.equal(mgood.body.pages[1].open,1); assert.equal(mgood.body.pages[1].upcoming,2);
    assert.equal(mgood.body.pages[1].excluded,1);
    failOther = true;
    const partial = await h.request('POST','/api/data-core/competition-sources/mgood/preview',users.admin);
    assert.equal(partial.response.status,200); assert.equal(partial.body.pages[0].ok,true); assert.equal(partial.body.pages[1].ok,false);
    const records = await h.request('GET','/api/data-core/competitions',users.admin);
    assert.equal(records.body.competitions.length,0);
  } finally { globalThis.fetch=originalFetch; await h.mf.dispose(); }
});
