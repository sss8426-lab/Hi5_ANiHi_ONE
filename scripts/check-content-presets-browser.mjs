// All mutations use ephemeral synthetic D1/R2. --preview only verifies deployed asset hashes.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {libraryHarness,users,A,B} from '../tests/support/library-harness.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const preview=process.argv.includes('--preview')?new URL(process.argv[process.argv.indexOf('--preview')+1]).origin:null;
const out=resolve('outputs/content-presets'+(preview?'-preview':''));await mkdir(out,{recursive:true});
const h=await libraryHarness(),root=resolve('public'),checked=new Set(),errors=[],network=[];
let user=users.admin,failSave=false,delay=0;
const url='/api/data-core/content/text-presets',sc={campusId:A,sourceApp:'blog'};
const presetWrite=async(body)=>h.request('POST',url,users.admin,{...sc,...body});
const server=createServer(async(req,res)=>{
 try{
  const u=new URL(req.url,'http://localhost');if(u.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  if(u.pathname.startsWith('/api/')){
   network.push({method:req.method,path:u.pathname,query:u.search});
   if(u.pathname===url&&req.method==='POST'&&failSave){failSave=false;res.writeHead(503,{'content-type':'application/json'}).end('{"error":"Synthetic save failure"}');return;}
   if(u.pathname===url&&req.method==='GET'&&delay)await new Promise(r=>setTimeout(r,delay));
   const chunks=[];for await(const c of req)chunks.push(c);
   const response=await h.raw(req.method,u.pathname+u.search,user,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);
   res.writeHead(response.status,Object.fromEntries(response.headers)).end(Buffer.from(await response.arrayBuffer()));return;
  }
  const path=/^\/data-core\/content\/(blog|instagram)$/.test(u.pathname)?'/data-core/content.html':u.pathname;
  const file=resolve(root,'.'+path);if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
  const bytes=await readFile(file);
  if(preview&&!checked.has(path)){
   const remote=await fetch(preview+path);assert.equal(remote.status,200,path);
   const hash=b=>createHash('sha256').update(/\.(html|css|js|svg|json)$/.test(path)?b.toString('utf8').replace(/\r\n/g,'\n'):b).digest('hex');
   assert.equal(hash(Buffer.from(await remote.arrayBuffer())),hash(bytes),'Deployed asset '+path);checked.add(path);
  }
  res.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png'}[extname(file)]||'application/octet-stream'}).end(bytes);
 }catch(e){errors.push(String(e));res.writeHead(500).end('Synthetic harness failure');}
});
const browser=await chromium.launch({headless:true,channel:'chrome'}),report={preview,widths:[],flows:[]};
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const context=await browser.newContext({permissions:['clipboard-read','clipboard-write'],serviceWorkers:'block'}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const col=k=>page.locator('.preset-column').nth(k),dialog=()=>page.locator('dialog[open]');
 const ready=()=>page.waitForFunction(()=>document.querySelectorAll('.preset-column').length===2&&!document.querySelector('.preset-actions button').disabled);
 const visit=async(app='blog')=>{await page.goto(base+'/data-core/content/'+app);await page.waitForFunction(id=>[...(document.querySelector('#draftCampus')?.options||[])].some(o=>o.value===id),A);await page.locator('#draftCampus').selectOption(A);await ready();await page.locator(`[data-folder="category:${A}:class-photo"]`).waitFor();};
 const browse=async(k,trash=false)=>{await col(k).getByRole('button',{name:trash?'삭제한 세트':'전체 보기',exact:true}).click();};
 const find=async(k,name)=>{await browse(k);await dialog().getByRole('searchbox').fill(name);};
 const choose=async(k,name)=>{await find(k,name);await dialog().getByRole('button',{name,exact:true}).click();};
 const menu=async(k,name,trash=false)=>{await browse(k,trash);await dialog().getByRole('searchbox').fill(name);await dialog().getByRole('button',{name:name+' 메뉴',exact:true}).click();};
 const submit=async()=>{await dialog().getByRole('button',{name:'저장',exact:true}).click();await dialog().waitFor({state:'detached'});};
 const add=async(k,name,content)=>{await page.locator(k?'#defaultFooter':'#defaultHashtags').fill(content);await col(k).getByRole('button',{name:'+ 새 저장',exact:true}).click();await dialog().getByLabel('이름',{exact:true}).fill(name);await submit();};
 const current=async()=>({tags:await page.locator('#defaultHashtags').inputValue(),footer:await page.locator('#defaultFooter').inputValue()});
 await visit();
 for(const app of ['blog','instagram']){
  await visit(app);await page.locator('#defaultFooter').fill('유지할 직접 입력');
  await choose(0,'학생 작품');assert.equal((await current()).footer,'유지할 직접 입력');assert.equal((await current()).tags.split(' ').length,app==='blog'?8:5);
  const tags=(await current()).tags;await choose(1,'학생 작품');assert.equal((await current()).tags,tags);assert.match((await current()).footer,app==='blog'?/완성된 작품에는/:/한 장의 작품/);
  await page.locator('#defaultFooter').fill('직접 변경한 문구');assert.match(await col(1).locator('.preset-selected').innerText(),/수정됨/);
  for(const width of [320,390,768,1024,1440,1920]){
   await page.setViewportSize({width,height:1000});await page.locator('.defaults-grid').scrollIntoViewIfNeeded();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),app+' overflow '+width);
   const boxes=await page.locator('.preset-column').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width};}));
   assert.ok(boxes[1].x>boxes[0].x&&Math.abs(boxes[0].y-boxes[1].y)<2,app+' two columns '+width);
   await page.screenshot({path:resolve(out,`${app}-${width}.png`)});report.widths.push({app,width});
  }
 }
 report.flows.push('both channels: independent input replacement, 8/5 tags, channel closing, modified state, six two-column widths');
 await visit();const start=network.length;
 await add(0,'합성 해시태그','#직접 #태그');await add(1,'합성 마지막 문구','<img src=x onerror=alert(1)> 합성 문구');
 await choose(1,'합성 마지막 문구');assert.equal(await page.locator('dialog img').count(),0);assert.match((await current()).footer,/<img/);
 await menu(0,'합성 해시태그');await dialog().getByRole('button',{name:'즐겨찾기',exact:true}).click();await dialog().waitFor({state:'detached'});
 assert.match(await col(0).locator('.preset-buttons').innerText(),/★ 합성 해시태그/);
 await menu(0,'합성 해시태그');await dialog().getByRole('button',{name:'이름·내용 수정',exact:true}).click();
 await dialog().getByLabel('이름',{exact:true}).fill('수정 해시태그');await dialog().getByLabel('내용',{exact:true}).fill('#수정 #보존');await dialog().getByLabel('분류',{exact:true}).fill('합성 분류');await submit();
 await menu(0,'수정 해시태그');await dialog().getByRole('button',{name:'복제',exact:true}).click();await submit();
 await browse(0);await dialog().getByRole('combobox',{name:'세트 분류'}).selectOption('합성 분류');assert.equal(await dialog().locator('[data-preset]').count(),2);await dialog().getByRole('button',{name:'닫기',exact:true}).click();
 await choose(0,'수정 해시태그');const before=await current();await menu(0,'수정 해시태그');assert.deepEqual(await current(),before);
 await dialog().getByRole('button',{name:'삭제',exact:true}).click();await dialog().waitFor({state:'detached'});assert.deepEqual(await current(),before);
 assert.equal(await col(0).locator('.preset-selected').innerText(),'');
 await menu(0,'수정 해시태그',true);await dialog().getByRole('button',{name:'복원',exact:true}).click();await dialog().waitFor({state:'detached'});
 await menu(1,'학생 작품');await dialog().getByRole('button',{name:'삭제',exact:true}).click();await dialog().waitFor({state:'detached'});
 const actions=network.slice(start);assert.ok(actions.every(n=>n.path===url||n.path==='/api/data-core/content/ai-usage'&&n.method==='GET'),'Preset operations made unrelated requests: '+JSON.stringify(actions));
 report.presetNetwork={requests:actions.length,ai:0,images:0,folders:0};
 await page.reload();await page.waitForFunction(()=>document.querySelector('#draftCampus')?.options.length>2);await page.locator('#draftCampus').selectOption(A);await ready();await find(1,'학생 작품');assert.equal(await dialog().locator('[data-preset]').count(),0);await dialog().getByRole('button',{name:'닫기',exact:true}).click();
 await menu(1,'학생 작품',true);await dialog().getByRole('button',{name:'복원',exact:true}).click();await dialog().waitFor({state:'detached'});
 report.flows.push('CRUD, duplicate, favorite, category search, sibling menu, soft delete/restore, reload persistence, 0 AI/image/folder requests');
 // Native validation, conflict and failure leave entered values intact.
 await col(1).getByRole('button',{name:'+ 새 저장',exact:true}).click();await dialog().getByLabel('내용',{exact:true}).fill('실패시 보존');
 await dialog().getByRole('button',{name:'저장',exact:true}).click();assert.equal(await dialog().count(),1);
 await dialog().getByLabel('이름',{exact:true}).fill('실패후 재시도');failSave=true;await dialog().getByRole('button',{name:'저장',exact:true}).click();await dialog().getByRole('status').filter({hasText:'Synthetic save failure'}).waitFor();
 assert.equal(await dialog().getByLabel('내용',{exact:true}).inputValue(),'실패시 보존');await submit();
 await menu(0,'수정 해시태그');await dialog().getByRole('button',{name:'이름·내용 수정',exact:true}).click();
 const stored=(await h.request('GET',url+'?'+new URLSearchParams(sc))).body.presets.find(i=>i.name==='수정 해시태그');
 assert.equal((await presetWrite({action:'update',presetId:stored.id,revision:stored.revision,name:stored.name,content:'#다른사람'})).status,200);
 await dialog().getByLabel('내용',{exact:true}).fill('#내수정');await dialog().getByRole('button',{name:'저장',exact:true}).click();await dialog().getByText(/다른 수정이 먼저/).waitFor();assert.equal(await dialog().getByLabel('내용',{exact:true}).inputValue(),'#내수정');await dialog().getByRole('button',{name:'닫기',exact:true}).click();
 report.flows.push('empty input native validation, save failure preserves fields, retry same id, stale revision rejection preserves editor');
 // Explicit apply changes only the independently stored footer/tag/contact fields.
 await page.locator('#manualWork summary').click();await page.locator('#manualDraft').click();await page.locator('#draftTitle').fill('합성 제목');await page.locator('#draftContent').fill('사용자가 수정한 본문\n학생의 과정은 유지합니다.');
 await choose(0,'학생 작품');await choose(1,'학생 작품');await page.getByRole('button',{name:'현재 결과에 적용',exact:true}).click();assert.match(await page.locator('#draftContent').inputValue(),/^사용자가 수정한 본문/);
 await page.locator('#copyContent').click();const copied=await page.evaluate(()=>navigator.clipboard.readText());assert.equal(copied.replace(/\r\n/g,'\n'),['합성 제목',await page.locator('#draftContent').inputValue(),await page.locator('#resultFooter').inputValue(),await page.locator('#draftTags').inputValue()].join('\n\n'));
 await page.locator('#saveDraftBtn').click();await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('초안을 저장'));
 const drafts=await h.request('GET','/api/data-core/content?sourceApp=blog&campusId='+A);assert.ok(drafts.body.drafts.some(d=>d.title==='합성 제목'));
 report.flows.push('blog manual body preserved, exact clipboard order, draft save');
 // New authenticated document has no stale cache; blog deletion never leaks into Instagram.
 await menu(1,'학생 작품');await dialog().getByRole('button',{name:'삭제',exact:true}).click();await dialog().waitFor({state:'detached'});
 await visit('instagram');await choose(1,'학생 작품');assert.match((await current()).footer,/한 장의 작품/);
 await visit('blog');await find(1,'학생 작품');assert.equal(await dialog().locator('[data-preset]').count(),0);await dialog().getByRole('button',{name:'닫기',exact:true}).click();
 // Delayed presets do not lock folder navigation, and old scopes cannot overwrite typed inputs.
 delay=1200;await page.locator('#draftCampus').selectOption(B);await page.locator('#defaultFooter').fill('지연 응답 중 직접 입력');
 await page.locator(`[data-folder="category:${B}:class-photo"]`).click();await page.waitForFunction(()=>document.querySelector('.preset-actions button')?.disabled===false);
 assert.equal((await current()).footer,'지연 응답 중 직접 입력');delay=0;
 for(let i=0;i<32;i++){await page.locator('#draftCampus').selectOption(i%2?A:B);await ready();}
 const n=network.length;await col(1).getByRole('button',{name:'+ 새 저장',exact:true}).click();await dialog().getByLabel('이름',{exact:true}).fill('32회 전환 후');await dialog().getByLabel('내용',{exact:true}).fill('리스너 중복 없음');await submit();
 assert.equal(network.slice(n).filter(r=>r.path===url&&r.method==='POST').length,1);
 report.flows.push('fresh document persistence and channel isolation; delayed response typing/folder navigation; 32 campus switches, one mutation per click');
 user=users.staff;await visit();await menu(1,'기본 상담');assert.equal(await dialog().getByRole('button',{name:'삭제',exact:true}).isEnabled(),false);await page.keyboard.press('Escape');
 await col(1).getByRole('button',{name:'+ 새 저장',exact:true}).press('Enter');await dialog().getByLabel('이름',{exact:true}).fill('직원 소유');await dialog().getByLabel('내용',{exact:true}).fill('직원 문구');await submit();
 user=users.teacher;await visit();await find(1,'직원 소유');assert.equal(await dialog().locator('[data-preset]').count(),0);
 report.flows.push('keyboard dialog, shared-set permissions, private owner isolation after login identity change');
 assert.deepEqual(errors,[]);report.checkedAssets=[...checked];report.errors=errors;await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));await h.mf.dispose();}
