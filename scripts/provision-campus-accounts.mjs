// Receives credentials on stdin; never accepts passwords in argv or writes them to disk.
import { execFile } from 'node:child_process';
import { randomBytes, pbkdf2Sync, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const directory = [
  ['ba','BUCHEON_ANI','campus-anihi-admission','부천 애니입시관'],['bd','BUCHEON_DESIGN','campus-design-admission','부천 디자인입시관'],
  ['wj','WONJONG','campus-wonjong','부천원종'],['bb','BEOMBAK','campus-beombak','부천범박'],
  ['jd','JUNGDONG','campus-jungdong','부천중동'],['og','OKGIL','campus-okgil','부천옥길'],
  ['gj','GWANGJIN','campus-gwangjin','광진'],['pj','PAJU','campus-paju','파주'],['as','ANSAN','campus-ansan','안산'],['us','ULSAN','campus-ulsan','울산'],
];
const quote = value => `'${String(value).replaceAll("'","''")}'`;
async function run(args) {
  const result = await execute(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'d1','execute','DB','--config','dist/server/wrangler.json','--remote','--yes','--json',...args],
    {windowsHide:true,maxBuffer:2_000_000,env:{...process.env,WRANGLER_WRITE_LOGS:'false'}}).catch(()=>{throw new Error('Cloudflare 인증 또는 D1 작업을 확인하세요. 비밀 값은 출력하지 않았습니다.');});
  const parsed = JSON.parse(result.stdout);
  if (!Array.isArray(parsed) || parsed.some(r=>!r.success)) throw new Error('D1 작업 실패. 기존 계정은 재설정하지 않았습니다.');
  return parsed;
}
async function provision() {
  const query = `SELECT a.login_id,m.campus_id,m.role FROM auth_accounts a LEFT JOIN memberships m ON m.user_id=a.user_id WHERE lower(a.login_id) IN (${directory.map(r=>quote(r[0])).join(',')})`;
  const existing = (await run(['--command',query]))[0].results;
  for (const row of existing) {
    const wanted = directory.find(c=>c[0]===row.login_id);
    if (!wanted || row.campus_id!==wanted[2] || row.role!=='CAMPUS_ADMIN') throw new Error('기존 로그인 ID/권한 충돌이 있어 중단했습니다. 기존 계정을 수정하지 않았습니다.');
  }
  const needed = directory.filter(c=>!existing.some(r=>r.login_id===c[0]));
  const campusRows=(await run(['--command',`SELECT id FROM campuses WHERE organization_id='org-hi5-anihi' AND status='active'`]))[0].results;
  if (needed.some(c=>!campusRows.some(r=>r.id===c[2]))) throw new Error('기존 활성 캠퍼스 연결 확인이 필요합니다.');
  if (!process.argv.includes('--apply')) { console.log(JSON.stringify({existing:directory.length-needed.length,toCreate:needed.length,mode:'dry-run'}));return; }
  let raw='';for await (const chunk of process.stdin) {raw+=chunk;if(raw.length>16000)throw new Error('입력 크기를 확인하세요.');}
  const input = JSON.parse(raw);raw='';
  const statements=[];
  const now=new Date().toISOString();
  for(const [loginId,code,campusId,name] of needed) {
    const record = input.accounts?.find(a=>a.loginId===loginId && a.campusCode===code);
    if (typeof record?.password!=='string' || record.password.length<6) throw new Error('초기 계정 입력을 확인하세요. 비밀번호는 출력하지 않았습니다.');
    const salt=randomBytes(16),hash=pbkdf2Sync(record.password,salt,100_000,32,'sha256').toString('base64');
    delete record.password;
    const user=`local:${randomUUID()}`,account=randomUUID();
    statements.push(`INSERT INTO users (id,email,display_name,status,created_at,updated_at) VALUES (${quote(user)},NULL,${quote(name)},'active',${quote(now)},${quote(now)});`);
    statements.push(`INSERT INTO auth_accounts (id,user_id,login_id,password_hash,password_salt,password_iterations,status,must_change_password,failed_login_count,created_at,updated_at) VALUES (${quote(account)},${quote(user)},${quote(loginId)},${quote(hash)},${quote(salt.toString('base64'))},100000,'active',1,0,${quote(now)},${quote(now)});`);
    statements.push(`INSERT INTO memberships (id,organization_id,campus_id,user_id,role,created_at,updated_at) VALUES (${quote(randomUUID())},'org-hi5-anihi',${quote(campusId)},${quote(user)},'CAMPUS_ADMIN',${quote(now)},${quote(now)});`);
  }
  if (statements.length) {
    const folder=await mkdtemp(join(tmpdir(),'hi5-campus-hashes-')),file=join(folder,'accounts.sql');
    try { await writeFile(file,statements.join('\n'),{mode:0o600}); await run(['--file',file]); }
    finally { await unlink(file).catch(()=>{});await rmdir(folder); }
  }
  const verified=(await run(['--command',query]))[0].results;
  if(directory.some(c=>!verified.some(r=>r.login_id===c[0]&&r.campus_id===c[2]&&r.role==='CAMPUS_ADMIN'))) throw new Error('계정 생성 후 연결 확인이 필요합니다.');
  console.log(JSON.stringify({created:needed.length,verifiedCampuses:10,existingMasterUnchanged:true,firstPasswordChangeRequired:true}));
}
provision().catch(error=>{console.error(error instanceof SyntaxError?'입력 형식을 확인하세요.':error.message);process.exitCode=1;});
