import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarketingReport, REPORT_KEYWORDS } from '../scripts/render-marketing-report.mjs';
test('print report keeps all 13 keywords per platform and sample/unknown distinctions',()=>{const html=renderMarketingReport({version:1,campusId:'campus-anihi-admission',runKind:'sample',reportDate:'2026-10-13',capturedAt:'2026-10-13T01:00:00+09:00',runId:'test',platforms:{naver:{status:'observed',keywords:[{keyword:REPORT_KEYWORDS[0],adRank:1,adCount:10,officialDocuments:0,inspectedResults:20}]}},channels:{},improvements:[],limitations:[]});for(const keyword of REPORT_KEYWORDS)assert.equal(html.split(`<th>${keyword}</th>`).length-1,2);assert.match(html,/13:30 정기 보고서 아님/);assert.match(html,/확인 불가/);assert.match(html,/전회 대비 변화/);assert.match(html,/샘플 관찰은 정기 기준선과 비교하지 않습니다/);assert.match(html,/Google 지도 \/ 로컬팩/);assert.match(html,/>0 \/ 20</);assert.match(html,/@page\{size:1080px 3400px/);});
test('print report escapes untrusted evidence and never inserts active markup',()=>{const html=renderMarketingReport({version:1,campusId:'campus-anihi-admission',runKind:'daily',platforms:{},channels:{},improvements:[{title:'<script>alert(1)</script>',action:'<img src=x onerror=alert(1)>',evidence:'& raw'}],limitations:['<iframe>']});assert.doesNotMatch(html,/<script>|<iframe>|<img src=x/);assert.match(html,/&lt;script&gt;/);assert.match(html,/&amp; raw/);assert.throws(()=>renderMarketingReport({version:1,campusId:'unknown',runKind:'daily'}));});

test('print report marks confirmed noncore queries without changing stored keyword names',()=>{
 const html=renderMarketingReport({version:1,runKind:'sample',campusId:'campus-anihi-admission',reportDate:'2026-10-13',capturedAt:'2026-10-13T01:00:00+09:00',platforms:{naver:{keywords:[{keyword:'부천디자인학원',relevance:'noncore'}]}}});
 assert.match(html,/부천디자인학원 · 비핵심/);
});
