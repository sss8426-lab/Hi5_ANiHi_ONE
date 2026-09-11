import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';

const campuses = [
  ['ba','BUCHEON_ANI','campus-anihi-admission'],['bd','BUCHEON_DESIGN','campus-design-admission'],
  ['wj','WONJONG','campus-wonjong'],['bb','BEOMBAK','campus-beombak'],['jd','JUNGDONG','campus-jungdong'],
  ['og','OKGIL','campus-okgil'],['gj','GWANGJIN','campus-gwangjin'],['pj','PAJU','campus-paju'],
  ['as','ANSAN','campus-ansan'],['us','ULSAN','campus-ulsan'],
];
const temporary = 'Synthetic-Initial-2026!';
const permanent = 'Synthetic-Changed-2026!';
async function harness() {
  const mf = new Miniflare({script:"export default {fetch(){return new Response('ok')}}",modules:true,d1Databases:['DB','FAMILY_DB'],r2Buckets:['FILES','FAMILY_FILES'],d1Persist:false,r2Persist:false});
  const DB = await mf.getD1Database('DB'), FILES = await mf.getR2Bucket('FILES');
  const env = {DB,FILES,FAMILY_DB:await mf.getD1Database('FAMILY_DB'),FAMILY_FILES:await mf.getR2Bucket('FAMILY_FILES'),DATA_CORE_SUPER_ADMIN_EMAILS:'campus-master@example.test',ASSETS:{fetch:async()=>new Response('<html>synthetic shell</html>',{headers:{'content-type':'text/html'}})}};
  const worker = (await import(new URL(`../dist/server/index.js?campus=${Date.now()}-${Math.random()}`,import.meta.url))).default;
  const master = {'oai-authenticated-user-id':'campus-master','oai-authenticated-user-email':'campus-master@example.test'};
  async function request(path, {cookie,admin=false,method='GET',body,origin='http://localhost',headers={}}={}) {
    const h = new Headers(admin?master:{});
    if(cookie)h.set('cookie',cookie);
    if(origin)h.set('origin',origin);
    for(const [k,v]of Object.entries(headers))h.set(k,v);
    if(body !== undefined && !(body instanceof FormData))h.set('content-type','application/json');
    const r = await worker.fetch(new Request(`http://localhost${path}`,{method,headers:h,body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)}),env,{waitUntil(){}});
    return {status:r.status,body:await r.json().catch(()=>null),cookie:r.headers.get('set-cookie')?.split(';')[0],headers:r.headers};
  }
  await request('/api/auth/session',{admin:true});
  const legacy = {version:1,settings:{consultantName:'컨설턴트님'},universities:[{id:1,name:'synthetic university'}],admissionGradeRules:[],students:[{id:7,name:'synthetic master-owned'}],cases:[],awardFolders:[],changeLogs:[]};
  await FILES.put('state/admissions-data.json',JSON.stringify(legacy));
  return {mf,DB,FILES,request,legacy,worker,env};
}

test('ten campus accounts: normalized login, forced change, own CRUD, cross-campus and master-only rejection; original snapshot preserved',async()=>{
  const h = await harness();
  try {
    const {request,DB,FILES}=h;
    assert.equal((await request('/api/data')).status,401);
    const forged = await h.worker.fetch(new Request('https://hi5-anihi-one.sss8426.workers.dev/api/data',{headers:{'oai-authenticated-user-id':'campus-master','oai-authenticated-user-email':'campus-master@example.test'}}),h.env,{waitUntil(){}});
    assert.equal(forged.status,401,'production does not trust unsigned identity headers');
    const accounts=[];
    for(const [id,code,campus] of campuses) {
      const made=await request('/api/auth/accounts',{admin:true,method:'POST',body:{loginId:id,role:'CAMPUS_ADMIN',campusId:code,temporaryPassword:temporary}});
      assert.equal(made.status,201,JSON.stringify(made.body));
      const login=await request('/api/auth/login',{method:'POST',body:{loginId:id.toUpperCase(),password:temporary}});
      assert.equal(login.status,200);assert.equal(login.body.mustChangePassword,true);
      assert.equal((await request('/api/data',{cookie:login.cookie})).status,403);
      const changed=await request('/api/auth/password',{cookie:login.cookie,method:'PUT',body:{currentPassword:temporary,nextPassword:permanent}});
      assert.equal(changed.status,200);
      const cookie=changed.cookie;
      const context=await request('/api/auth/session',{cookie});
      assert.deepEqual(context.body.campusIds,[campus]);
      assert.equal(context.body.memberships[0].campusCode,code);
      assert.equal(context.body.memberships[0].role,'CAMPUS_ADMIN');assert.equal(context.body.isSuperAdmin,false);
      for(const path of ['/data-core/work','/data-core/counseling','/data-core/curriculum','/data-core/roadmap','/data-core/work/library']) assert.equal((await request(path,{cookie})).status,200,path);
      for(const path of ['/api/auth/accounts','/api/auth/campuses','/api/data-core/admin/users','/api/data-core/admin/backups','/data-core/accounts','/data-core/operations','/data-core/readiness']) assert.equal((await request(path,{cookie})).status,403,path);
      const own=await request('/api/data',{cookie});assert.equal(own.status,200);assert.equal(own.body.students.length,0);
      own.body.students.push({id:own.body._campus.nextIdBase+1,name:'synthetic campus student'});
      assert.equal((await request('/api/data',{cookie,method:'PUT',body:own.body})).status,200);
      assert.equal((await request('/api/data',{cookie,method:'PUT',body:own.body})).status,409,'stale write');
      let updated=(await request('/api/data',{cookie})).body;
      assert.equal(updated.students[0].campusId,campus);
      updated.students[0].name='synthetic updated';
      assert.equal((await request('/api/data',{cookie,method:'PUT',body:updated})).status,200);
      updated=(await request('/api/data',{cookie})).body;updated.students[0].campusId=campuses.find(c=>c[2]!==campus)[2];
      assert.equal((await request('/api/data',{cookie,method:'PUT',body:updated})).status,403);
      updated=(await request('/api/data',{cookie})).body;updated.universities=[];
      assert.equal((await request('/api/data',{cookie,method:'PUT',body:updated})).status,403);
      const record=await request('/api/data-core/records',{cookie,method:'POST',body:{title:'synthetic note',recordType:'campus-note',sourceApp:'data-core',campusId:code,visibility:'campus'}});
      assert.equal(record.status,201,JSON.stringify(record.body));
      const form=new FormData();form.set('file',new Blob(['synthetic only'],{type:'text/plain'}),'synthetic.txt');form.set('category','general');
      const upload=await request('/api/data-core/upload',{cookie,method:'POST',body:form});assert.equal(upload.status,201,JSON.stringify(upload.body));
      assert.equal(upload.body.file.campusId,campus);
      const file=upload.body.file;
      assert.equal((await request(`/api/data-core/records/${record.body.record.id}`,{cookie,method:'PATCH',body:{recordType:'university'}})).status,403);
      const global = await request('/api/data-core/records',{admin:true,method:'POST',body:{recordType:'university',sourceApp:'admissions',title:'Synthetic shared',visibility:'organization'}});
      assert.equal(global.status,201);
      assert.equal((await request(`/api/data-core/records/${global.body.record.id}`,{cookie})).status,200);
      assert.equal((await request(`/api/data-core/records/${global.body.record.id}/content`,{cookie,method:'PUT',body:{content:'forbidden'}})).status,403);
      for(const sourceApp of ['blog','instagram']) {
        const draft=await request('/api/data-core/content',{cookie,method:'POST',body:{sourceApp,campusId:campus,title:'Synthetic draft',content:'Synthetic content'}});
        assert.equal(draft.status,201,JSON.stringify(draft.body));
        assert.equal((await request(`/api/data-core/content/${draft.body.draft.id}`,{cookie,method:'PATCH',body:{content:'Synthetic edited'}})).status,200);
        assert.equal((await request(`/api/data-core/content/${draft.body.draft.id}`,{cookie,method:'DELETE'})).status,200);
      }
      const folder=await request('/api/data-core/library/folders',{cookie,method:'POST',body:{parentFolderId:`category:${campus}:admission-material`,title:'Synthetic campus folder'}});
      assert.equal(folder.status,201,JSON.stringify(folder.body));
      assert.equal((await request(`/api/data-core/library/folders/${folder.body.folder.id}`,{cookie,method:'DELETE'})).status,200);
      const masterScoped=(await request(`/api/data?campusId=${code}`,{admin:true})).body;
      assert.equal(masterScoped.students.length,1);
      masterScoped.students[0].name='Synthetic master edit';
      assert.equal((await request(`/api/data?campusId=${code}`,{admin:true,method:'PUT',body:masterScoped})).status,200);
      const all=(await request('/api/data',{admin:true})).body;
      assert.ok(all.students.some(s=>s.id===7),'master original remains visible');
      accounts.push({cookie,campus,id:made.body.account.id,user:made.body.account.userId,record:record.body.record.id,file:file.id});
    }
    for(let i=0;i<accounts.length;i++) {
      const own=accounts[i],other=accounts[(i+1)%accounts.length];
      assert.equal((await request(`/api/data?campusId=${other.campus}`,{cookie:own.cookie})).status,403);
      const denied = i === accounts.length - 1 ? 404 : 403;
      assert.equal((await request(`/api/data-core/records/${other.record}`,{cookie:own.cookie,method:'PATCH',body:{title:'forbidden'}})).status,denied);
      assert.equal((await request(`/api/data-core/records/${other.record}`,{cookie:own.cookie,method:'DELETE'})).status,denied);
      assert.equal((await request(`/api/data-core/files/${other.file}`,{cookie:own.cookie})).status,denied);
      assert.equal((await request(`/api/data-core/files/${other.file}`,{cookie:own.cookie,method:'DELETE'})).status,denied);
      assert.equal((await request(`/api/data-core/records/${own.record}`,{cookie:own.cookie,method:'PATCH',body:{title:'edited'}})).status,200);
      assert.equal((await request(`/api/data-core/records/${own.record}`,{cookie:own.cookie,method:'DELETE'})).status,200);
      assert.equal((await request(`/api/data-core/files/${own.file}`,{cookie:own.cookie,method:'DELETE'})).status,200);
      const row=await DB.prepare('SELECT r2_key,deleted_at FROM file_objects WHERE id=?').bind(own.file).first();assert.ok(row.deleted_at);assert.ok(await FILES.head(row.r2_key));
      const state=(await request('/api/data',{cookie:own.cookie})).body;state.students=[];
      assert.equal((await request('/api/data',{cookie:own.cookie,method:'PUT',body:state})).status,200);
    }
    assert.deepEqual(await (await FILES.get('state/admissions-data.json')).json(),h.legacy);
    const presence=await request('/api/auth/campuses',{admin:true});assert.equal(presence.status,200);
    assert.equal(presence.body.summary.total,10);assert.equal(presence.body.summary.online,10);assert.equal(presence.body.summary.today,10);
    assert.equal(presence.body.recentLogins.length,10);
    assert.ok(!/password|token_hash|salt|email/.test(JSON.stringify(presence.body)));
    const account=accounts[0],old=new Date(Date.now()-16*60000).toISOString();
    await DB.prepare('UPDATE auth_sessions SET last_seen_at=? WHERE user_id=?').bind(old,account.user).run();
    await request('/api/auth/session',{cookie:account.cookie});
    let offline=await request('/api/auth/campuses',{admin:true});assert.equal(offline.body.summary.online,9,'session fetch is not activity');
    assert.equal((await request('/api/auth/activity',{cookie:account.cookie,method:'POST',origin:'https://evil.test'})).status,403);
    assert.equal((await request('/api/auth/activity',{cookie:account.cookie,method:'POST'})).status,200);
    const after=await DB.prepare('SELECT last_seen_at FROM auth_sessions WHERE user_id=? AND revoked_at IS NULL').bind(account.user).first();
    await request('/api/auth/activity',{cookie:account.cookie,method:'POST'});
    assert.deepEqual(await DB.prepare('SELECT last_seen_at FROM auth_sessions WHERE user_id=? AND revoked_at IS NULL').bind(account.user).first(),after,'throttled activity');
    assert.equal((await request('/api/auth/campuses',{admin:true})).body.summary.online,10);
    await request(`/api/auth/accounts/${account.id}`,{admin:true,method:'PATCH',body:{status:'disabled'}});
    assert.equal((await request('/api/auth/session',{cookie:account.cookie})).body.authenticated,false);
    assert.equal((await request('/api/auth/login',{method:'POST',body:{loginId:'ba',password:permanent}})).status,401);
    assert.equal((await request('/api/auth/campuses',{admin:true})).body.summary.online,9);
    assert.equal(Number((await DB.prepare('SELECT count(*) AS n FROM campus_admissions_state').first()).n),10);
  } finally {await h.mf.dispose();}
});
