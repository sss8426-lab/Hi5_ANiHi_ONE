import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
const source=await readFile('public/data-core/competition-live-enhancement.js','utf8');
function harness(fetch) {
  const nodes=new Map();
  const ctx=vm.createContext({fetch,URL,Date,console,MutationObserver:class{},sessionStorage:{setItem(){},getItem(){return null;}},document:{
    getElementById(id){if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);},querySelectorAll(){return [];},
  }});
  vm.runInContext(source.slice(0,source.lastIndexOf("  if (document.readyState")) + '\n globalThis.check={dedupe,refreshLiveNews,deadlineItems,set:(items)=>{liveItems=items},get:()=>liveItems};})();',ctx);
  return {check:ctx.check,nodes};
}
const item=(id,source='mgood',sourcePage='main',sourceStatus='open',applicationEnd='2099-09-30')=>({title:`합성 ${id}`,externalSourceId:id,source,sourcePage,sourceStatus,applicationEnd,sourceUrl:`https://www.mgood.co.kr/contest/21002_contest_view.php?c_seq=${id}&state=${sourcePage}`});
test('news filters exact source/status and elapsed deadlines, dedupes IDs, then orders deadline/status/title',()=>{
  const {check}=harness();
  const rows=check.dedupe([
    item('late'),item('early','mgood','main','upcoming','2099-01-01'),
    item('early','mgood','other','upcoming','2099-01-01'),item('open','mgood','main','open','2099-01-01'),
    item('expired','artmd','art','open','2000-01-01'),item('not-open','artmd','art','upcoming'),item('closed','mgood','main','unknown'),
    {...item('bad'),sourceUrl:'javascript:alert(1)'},
  ]);
  assert.deepEqual(Array.from(rows,x=>x.externalSourceId),['open','early','late']);
  check.set(rows); assert.equal(check.deadlineItems('2099-01-01').length,2);
});
test('partial failure preserves only that page while successful empty removes stale news and duplicate clicks coalesce',async()=>{
  let calls=0;
  const h=harness(async url=>{
    calls++;
    const mgood=url.includes('/mgood/');
    return new Response(JSON.stringify(mgood?{pages:[{url:'main',ok:true},{url:'other',ok:false}],items:[]}:{pages:[{url:'art',ok:true}],items:[item('new','artmd','art')]}),{headers:{'content-type':'application/json'}});
  });
  h.check.set([item('old-main'),item('keep','mgood','other'),item('old-art','artmd','art')]);
  await Promise.all([h.check.refreshLiveNews(true),h.check.refreshLiveNews(true)]);
  assert.equal(calls,2);
  assert.deepEqual(Array.from(h.check.get(),x=>x.externalSourceId).sort(),['keep','new']);
  assert.match(h.nodes.get('competitionSourceStatus').textContent,/일부 출처 확인 필요/);
  assert.match(h.nodes.get('competitionSourceStatus').textContent,/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  assert.equal(h.nodes.get('refreshCompetitionSourcesBtn').disabled,false);
});
