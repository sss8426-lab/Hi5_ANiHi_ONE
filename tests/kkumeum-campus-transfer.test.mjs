import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const campusIds = ['campus-anihi-admission','campus-design-admission','campus-wonjong','campus-beombak','campus-jungdong','campus-okgil','campus-gwangjin','campus-paju','campus-ansan','campus-ulsan'];
const master = {id:'synthetic-transfer-master',email:'synthetic-transfer-master@example.test'};
async function harness() {
  const mf = new Miniflare({script:"export default { fetch() { return new Response('ok'); } }",modules:true,d1Databases:['DB','FAMILY_DB'],r2Buckets:['FAMILY_FILES'],d1Persist:false,r2Persist:false});
  const worker = (await import(`../dist/server/index.js?transfer=${Date.now()}`)).default;
  const DB = await mf.getD1Database('DB'), db = await mf.getD1Database('FAMILY_DB'), files = await mf.getR2Bucket('FAMILY_FILES');
  const env = {DB,FAMILY_DB:db,FAMILY_FILES:files,DATA_CORE_SUPER_ADMIN_EMAILS:master.email};
  async function request(path,{user=master,method='GET',body,origin}={}) {
    const headers = new Headers(user?{'oai-authenticated-user-id':user.id,'oai-authenticated-user-email':user.email}:{});
    if (origin) headers.set('origin',origin);
    if (body!==undefined) headers.set('content-type','application/json');
    const response = await worker.fetch(new Request(`http://localhost${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env,{waitUntil(){},passThroughOnException(){}});
    return {status:response.status,body:await response.clone().json().catch(()=>null),response};
  }
  return {mf,DB,db,files,request};
}

test('ten isolated campuses; MASTER transfer preserves IDs, original bytes, relations and historic records', async () => {
  const {mf,DB,db,files,request} = await harness();
  try {
    const users=[], classes=[], students=[];
    for (const [i,campusId] of campusIds.entries()) {
      const user={id:`synthetic-campus-${i}`,email:`synthetic-campus-${i}@example.test`}; users.push(user);
      assert.equal((await request('/api/data-core/context',{user})).status,200);
      await DB.prepare(`INSERT INTO memberships (id,organization_id,campus_id,user_id,role,created_at,updated_at) VALUES (?,'org-hi5-anihi',?,?,'CAMPUS_ADMIN',?,?)`).bind(`synthetic-membership-${i}`,campusId,`oai:${user.id}`,new Date().toISOString(),new Date().toISOString()).run();
      const cls=await request('/api/kkumeum/classes',{user,method:'POST',body:{campusId,name:`SYNTHETIC_FOLDER_${i}`}});
      assert.equal(cls.status,201); classes.push(cls.body.class.id);
      const child=await request('/api/kkumeum/students',{user,method:'POST',body:{campusId,name:`SYNTHETIC_STUDENT_${i}`,classId:classes[i]}});
      assert.equal(child.status,201); students.push(child.body.student.id);
    }
    for (let i=0;i<10;i++) {
      const own=await request(`/api/kkumeum/students?campusId=${campusIds[i]}`,{user:users[i]});
      assert.deepEqual(own.body.students.map(s=>s.id),[students[i]]);
      assert.deepEqual((await request(`/api/kkumeum/classes?campusId=${campusIds[i]}`,{user:users[i]})).body.classes.map(c=>c.id),[classes[i]]);
      const other=(i+1)%10;
      assert.equal((await request(`/api/kkumeum/students?campusId=${campusIds[other]}`,{user:users[i]})).status,403);
      assert.equal((await request(`/api/kkumeum/students/${students[other]}?campusId=${campusIds[i]}`,{user:users[i]})).status,403);
      assert.equal((await request(`/api/kkumeum/classes/${classes[other]}`,{user:users[i],method:'PATCH',body:{name:'DENIED'}})).status,403);
      assert.equal((await request(`/api/kkumeum/students/${students[other]}`,{user:users[i],method:'PATCH',body:{status:'leave'}})).status,403);
      assert.equal((await request(`/api/kkumeum/students/${students[i]}`,{user:users[i],method:'PATCH',body:{grade:'SYNTHETIC'}})).status,200);
      assert.equal((await request(`/api/kkumeum/students/${students[i]}/transfer`,{user:users[i],method:'POST',body:{}})).status,403);
      assert.equal((await request(`/api/kkumeum/students/${students[i]}/transfer`,{user:users[i]})).status,403);
    }
    const id=students[0], from=campusIds[0], to=campusIds[1];
    await request(`/api/kkumeum/artworks?campusId=${from}&studentId=${id}`);
    await request(`/api/kkumeum/guardians?campusId=${from}&studentId=${id}`);
    const bytes = new Uint8Array([137,80,78,71,13,10,26,10,42]);
    const key = `synthetic/${from}/original.png`;
    await files.put(key,bytes);
    const now=new Date().toISOString();
    await db.prepare(`INSERT INTO family_files (id,campus_id,student_id,purpose,r2_key,file_name,mime_type,size_bytes,created_at) VALUES ('synthetic-file',?,?,'artwork',?,'synthetic.png','image/png',?,?)`).bind(from,id,key,bytes.length,now).run();
    await db.prepare(`INSERT INTO student_artworks (id,student_id,campus_id,class_id,family_file_id,created_at) VALUES ('synthetic-art',?,?,?,'synthetic-file',?)`).bind(id,from,classes[0],now).run();
    const report=await request('/api/kkumeum/reports',{method:'POST',body:{campusId:from,studentId:id,yearMonth:'2026-09',title:'SYNTHETIC'}});
    assert.equal(report.status,201);
    await db.prepare(`INSERT INTO family_guardians (id,display_name,login_id,password_hash,status,created_at,updated_at) VALUES ('synthetic-guardian','SYNTHETIC','synthetic-transfer-guardian','non-login-fixture','active',?,?)`).bind(now,now).run();
    await db.prepare(`INSERT INTO student_guardians (id,student_id,guardian_id,created_at) VALUES ('synthetic-link',?,'synthetic-guardian',?)`).bind(id,now).run();
    const before=await request(`/api/kkumeum/students/${id}?campusId=${from}`);
    const body={fromCampusId:from,toCampusId:to,classId:classes[1],expectedUpdatedAt:before.body.student.updated_at};
    const path=`/api/kkumeum/students/${id}/transfer`;
    assert.equal((await request(path,{user:null,method:'POST',body})).status,401);
    assert.equal((await request(path,{method:'POST',body,origin:'https://foreign.example'})).status,403);
    assert.equal((await request(path,{method:'POST',body:{...body,toCampusId:'unknown'}})).status,400);
    assert.equal((await request(path,{method:'POST',body:{...body,classId:classes[0]}})).status,400);
    assert.equal((await request(path,{method:'POST',body:{...body,expectedUpdatedAt:'stale'}})).status,409);
    await db.prepare(`CREATE TRIGGER synthetic_transfer_failure BEFORE UPDATE OF campus_id ON monthly_reports
      BEGIN SELECT RAISE(ABORT, 'synthetic rollback'); END`).run();
    assert.equal((await request(path,{method:'POST',body})).status,500);
    assert.equal((await db.prepare('SELECT campus_id FROM family_students WHERE id=?').bind(id).first()).campus_id,from);
    assert.equal((await db.prepare("SELECT campus_id FROM family_files WHERE id='synthetic-file'").first()).campus_id,from);
    assert.equal((await request(path)).body.transfers.length,0);
    await db.prepare('DROP TRIGGER synthetic_transfer_failure').run();
    const moved=await request(path,{method:'POST',body}); assert.equal(moved.status,200,JSON.stringify(moved.body));
    assert.equal((await request(path,{method:'POST',body})).status,409);
    assert.equal((await request(path)).body.transfers.length,1);
    assert.equal((await request(`/api/kkumeum/students/${id}?campusId=${from}`,{user:users[0]})).status,403);
    assert.equal((await request(`/api/kkumeum/students/${id}?campusId=${to}`,{user:users[1]})).body.student.current_class_id,classes[1]);
    for (const route of ['/api/kkumeum/artworks/synthetic-art','/api/kkumeum/files/synthetic-file',`/api/kkumeum/reports/${report.body.report.id}`]) {
      assert.equal((await request(route,{user:users[0]})).status,403,route);
      assert.equal((await request(route,{user:users[1]})).status,200,route);
      assert.equal((await request(route)).status,200,route);
    }
    assert.equal((await request('/api/kkumeum/artworks/synthetic-art',{user:users[0],method:'DELETE'})).status,403);
    assert.deepEqual(new Uint8Array(await (await files.get(key)).arrayBuffer()),bytes);
    assert.equal((await db.prepare("SELECT r2_key FROM family_files WHERE id='synthetic-file'").first()).r2_key,key);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM student_guardians WHERE student_id=?").bind(id).first()).n,1);
    const enrollments=(await db.prepare('SELECT class_id,ended_at FROM class_enrollments WHERE student_id=? ORDER BY created_at').bind(id).all()).results;
    assert.equal(enrollments.length,2);assert.ok(enrollments[0].ended_at);assert.equal(enrollments[1].ended_at,null);
    assert.equal((await db.prepare("SELECT class_id FROM student_artworks WHERE id='synthetic-art'").first()).class_id,classes[0]);
    assert.equal((await request(`/api/kkumeum/guardians?campusId=${from}&studentId=${id}`,{user:users[0]})).status,403);
    assert.equal((await request(`/api/kkumeum/guardians?campusId=${to}&studentId=${id}`,{user:users[1]})).body.guardians.length,1);
    await db.prepare(`INSERT INTO student_guardians (id,student_id,guardian_id,created_at) VALUES ('synthetic-shared-link',?,'synthetic-guardian',?)`).bind(students[2],now).run();
    const scoped = {campusId:to,studentId:id};
    assert.equal((await request(`/api/kkumeum/guardians?campusId=${to}&studentId=${id}`,{user:users[1]})).body.guardians[0].canManageAccount,false);
    for (const action of ['reset-password','revoke-sessions']) assert.equal((await request(`/api/kkumeum/guardians/synthetic-guardian/${action}`,{user:users[1],method:'POST',body:scoped})).status,403);
    assert.equal((await request('/api/kkumeum/guardians/synthetic-guardian',{user:users[1],method:'PATCH',body:{...scoped,status:'disabled'}})).status,403);
    assert.equal((await request('/api/kkumeum/guardians/synthetic-guardian',{user:users[1],method:'PATCH',body:{...scoped,canViewPhotos:false}})).status,200);
    assert.equal((await db.prepare("SELECT status FROM family_guardians WHERE id='synthetic-guardian'").first()).status,'active');
  } finally { await mf.dispose(); }
});
