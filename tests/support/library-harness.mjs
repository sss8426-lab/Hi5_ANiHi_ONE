import { Miniflare } from 'miniflare';

export const ORG = 'org-hi5-anihi';
export const A = 'campus-anihi-admission', B = 'campus-gwangjin';
export const users = {
  admin: { id: 'library-admin', email: 'library-admin@example.test' },
  director: { id: 'library-director', email: 'library-director@example.test', campus: A, role: 'CAMPUS_DIRECTOR' },
  teacher: { id: 'library-teacher', email: 'library-teacher@example.test', campus: A, role: 'TEACHER' },
  staff: { id: 'library-staff', email: 'library-staff@example.test', campus: A, role: 'STAFF' },
  foreign: { id: 'library-foreign', email: 'library-foreign@example.test', campus: B, role: 'STAFF' },
  outsider: { id: 'library-outsider', email: 'library-outsider@example.test' },
};
export async function libraryHarness() {
  const mf = new Miniflare({ script: 'export default { fetch() { return new Response("ok"); } }', modules: true,
    d1Databases: ['DB', 'FAMILY_DB'], r2Buckets: ['FILES', 'FAMILY_FILES'], d1Persist: false, r2Persist: false });
  const worker = (await import(new URL(`../../dist/server/index.js?library=${Date.now()}`, import.meta.url))).default;
  const env = { DB: await mf.getD1Database('DB'), FILES: await mf.getR2Bucket('FILES'),
    FAMILY_DB: await mf.getD1Database('FAMILY_DB'), FAMILY_FILES: await mf.getR2Bucket('FAMILY_FILES'),
    DATA_CORE_SUPER_ADMIN_EMAILS: users.admin.email };
  // The Node/workerd RPC bridge cannot pass a Node Headers instance to R2's native method.
  env.FILES = new Proxy(env.FILES, { get(target,name) {
    if(name==='get')return async(...args)=>{
      const object=await target.get(...args);if(!object)return object;
      return new Proxy(object,{get(value,key){
        if(key==='writeHttpMetadata')return headers=>{if(value.httpMetadata?.contentType)headers.set('content-type',value.httpMetadata.contentType);};
        const member=value[key];return typeof member==='function'?member.bind(value):member;
      }});
    };
    const member=target[name];return typeof member==='function'?member.bind(target):member;
  }});
  async function raw(method, path, user = users.admin, body, origin = 'http://localhost', extraHeaders = {}) {
    const headers = new Headers(extraHeaders);
    if (user) {
      headers.set('oai-authenticated-user-id', user.id); headers.set('oai-authenticated-user-email', user.email);
      headers.set('oai-authenticated-user-full-name', 'Synthetic Library');
    }
    if (origin) headers.set('origin', origin);
    if (body && !(body instanceof FormData) && !(body instanceof Uint8Array)) {
      headers.set('content-type', 'application/json'); body = JSON.stringify(body);
    }
    return worker.fetch(new Request(`http://localhost${path}`, { method, headers, body }), env, { waitUntil() {}, passThroughOnException() {} });
  }
  async function request(...args) {
    const response = await raw(...args);
    const body = (response.headers.get('content-type') || '').includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, body, headers: response.headers };
  }
  for (const user of Object.values(users)) {
    await request('GET', '/api/data-core/context', user);
    if (user.role) await env.DB.prepare(`INSERT INTO memberships (id,organization_id,campus_id,user_id,role,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)`).bind(user.id, ORG, user.campus, `oai:${user.id}`, user.role, new Date().toISOString(), new Date().toISOString()).run();
  }
  await env.FAMILY_DB.prepare('CREATE TABLE library_sentinel (value TEXT)').run();
  await env.FAMILY_DB.prepare("INSERT INTO library_sentinel VALUES ('preserved')").run();
  await env.FAMILY_FILES.put('synthetic-sentinel', 'preserved');
  const folder = (parent, title, user = users.admin) => request('POST', '/api/data-core/library/folders', user, { parentFolderId: parent, title });
  const browse = (id = 'root', user = users.admin) => request('GET', `/api/data-core/library/folders?parentId=${encodeURIComponent(id)}`, user);
  const list = (id, user = users.admin, query = '') => request('GET', `/api/data-core/library/files?folderId=${encodeURIComponent(id)}${query}`, user);
  async function upload(id, user = users.admin, options = {}) {
    const form = new FormData();
    form.set('file', new File([options.bytes || 'synthetic library content'], options.name || '검증 자료.txt', { type: options.mime || 'text/plain' }));
    form.set('recordId', id);
    for (const [key, value] of Object.entries(options.fields || {})) form.set(key, value);
    return request('POST', options.path || '/api/data-core/library/files', user, form, options.origin);
  }
  const file = id => env.DB.prepare('SELECT * FROM file_objects WHERE id = ?').bind(id).first();
  return { mf, env, raw, request, folder, browse, list, upload, file };
}
