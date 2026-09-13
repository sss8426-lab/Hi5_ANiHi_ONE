import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
const read=p=>readFile(new URL(`../${p}`,import.meta.url),'utf8');
test('staff and guardian share one 480px app geometry, without desktop navigation or fake classes',async()=>{
 const [staff,family,css,js,nav]=await Promise.all([read('public/data-core/work/kkumeum.html'),read('public/family/index.html'),read('public/family/kkumeum-mobile.css'),read('public/data-core/work/kkumeum-mobile.js'),read('public/data-core/design-shell.js')]);
 assert.match(staff,/kk-mobile/);assert.match(css,/max-width: 480px/);assert.match(css,/position: fixed/);
 assert.match(staff,/\/family\/kkumeum-mobile\.css/);assert.match(family,/\/family\/kkumeum-mobile\.css/);
 assert.doesNotMatch(staff,/<span>기초반<\/span>/);assert.match(nav,/!document\.body\.classList\.contains\('kk-mobile'\)/);
 for(const label of ['아이소식','반소식','전체공지','선택전달','출석체크','아이소식 글모음','답변모음','문의모음'])assert.ok((staff+js).includes(label));
 assert.match(js,/state\.selected\.clear\(\)/);assert.match(js,/announcement-capabilities/);assert.match(js,/state\.version/);
 assert.doesNotMatch(js,/localStorage|sessionStorage|indexedDB/);
});
test('mobile adapters preserve private family routes, legacy tools, and explicitly mark unavailable operations',async()=>{
 const [staff,guardian,docs]=await Promise.all([read('public/data-core/work/kkumeum-mobile.js'),read('public/family/family-mobile.js'),read('docs/KKUMEUM_MOBILE_APP_2026-09-13.md')]);
 assert.match(staff,/selected-delivery/);assert.match(staff,/window\.KkumeumStaff/);assert.match(staff,/kkReportsSection/);assert.match(staff,/kkArtworkSection/);
 assert.match(staff,/자동 예약발송은 지원하지 않습니다/);assert.match(staff,/아직 전용 API가 구현되지 않았습니다/);
 assert.doesNotMatch(guardian,/\/api\/kkumeum|\/api\/data-core|MASTER|CAMPUS_ADMIN/);
 assert.match(docs,/새 테이블, migration, D1\/R2 binding 없음/);
});
