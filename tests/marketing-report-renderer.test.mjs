import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarketingReport, REPORT_KEYWORDS } from '../scripts/render-marketing-report.mjs';
test('print report keeps all 13 keywords per platform and sample/unknown distinctions',()=>{const html=renderMarketingReport({version:1,campusId:'campus-anihi-admission',runKind:'sample',reportDate:'2026-10-13',capturedAt:'2026-10-13T01:00:00+09:00',runId:'test',platforms:{naver:{status:'observed',keywords:[{keyword:REPORT_KEYWORDS[0],adRank:1,adCount:10,officialDocuments:0,inspectedResults:20}]}},channels:{},improvements:[],limitations:[]});for(const keyword of REPORT_KEYWORDS)assert.equal(html.split(`<th>${keyword}</th>`).length-1,2);assert.match(html,/13:30 정기 보고서 아님/);assert.match(html,/확인 불가/);assert.match(html,/전회 대비 변화/);assert.match(html,/샘플 관찰은 정기 기준선과 비교하지 않습니다/);assert.match(html,/Google 지도 \/ 로컬팩/);assert.match(html,/>0 \/ 20</);assert.match(html,/@page\{size:1080px 3400px/);});
test('print report escapes untrusted evidence and never inserts active markup',()=>{const html=renderMarketingReport({version:1,campusId:'campus-anihi-admission',runKind:'daily',platforms:{},channels:{},improvements:[{title:'<script>alert(1)</script>',action:'<img src=x onerror=alert(1)>',evidence:'& raw'}],limitations:['<iframe>']});assert.doesNotMatch(html,/<script>|<iframe>|<img src=x/);assert.match(html,/&lt;script&gt;/);assert.match(html,/&amp; raw/);assert.throws(()=>renderMarketingReport({version:1,campusId:'unknown',runKind:'daily'}));});

test('print report marks confirmed noncore queries without changing stored keyword names',()=>{
 const html=renderMarketingReport({version:1,runKind:'sample',campusId:'campus-anihi-admission',reportDate:'2026-10-13',capturedAt:'2026-10-13T01:00:00+09:00',platforms:{naver:{keywords:[{keyword:'부천디자인학원',relevance:'noncore'}]}}});
 assert.match(html,/부천디자인학원 · 비핵심/);
});

test('naver table explains organic rank and lists keywords without our posts first',async()=>{
 const {organicFocusKeywords}=await import('../public/data-core/marketing.js');
 const naver={status:'observed',keywords:[{keyword:'부천웹툰학원',organicRank:4},{keyword:'부천미술학원',organicRank:null},{keyword:'부천디자인학원'}]};
 assert.deepEqual(organicFocusKeywords(naver),['부천미술학원','부천디자인학원']);
 assert.deepEqual(organicFocusKeywords(undefined),[]);
 const html=renderMarketingReport({version:1,runKind:'sample',campusId:'campus-anihi-admission',reportDate:'2026-10-13',capturedAt:'2026-10-13T01:00:00+09:00',platforms:{naver}});
 assert.equal(html.split('자연검색 순위란?').length-1,1);
 assert.match(html,/자연검색 순위를 올리려면/);
 assert.match(html,/먼저 할 일: 우리 글이 보이지 않은 부천미술학원, 부천디자인학원/);
 assert.ok(html.indexOf('자연검색 순위란?')<html.indexOf('Google · 광고'));
});

test('google robot-check block is named instead of a bare unknown',async()=>{
 const {status}=await import('../public/data-core/marketing.js');
 assert.match(status('blocked'),/Google 로봇 확인/);
 const html=renderMarketingReport({version:1,runKind:'sample',campusId:'campus-anihi-admission',reportDate:'2026-10-13',capturedAt:'2026-10-13T01:00:00+09:00',platforms:{google:{status:'blocked',keywords:[]}}});
 assert.match(html,/Google · 광고 \/ 자연검색 <small>자동 검색 차단 \(Google 로봇 확인 화면\)/);
});
