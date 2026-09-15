import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('attendance is upload / month / generate; no technical mapping or original preview UI',async()=>{
  const script=await readFile(new URL('../public/data-core/work/attendance.js',import.meta.url),'utf8');
  for(const id of ['atFile','atMonth','atGenerate','atTabs','atReview','atDownload','atPrint','atAgain'])assert.match(script,new RegExp(`id="${id}"`));
  assert.match(script,/id="atMonth" type="month"/);
  assert.doesNotMatch(script,/atMapping|data-map|id="atSource"|atReadRows|atYear|atConfirm|양식 영역 확인|원본 미리보기/);
  assert.doesNotMatch(script,/fetch\(|localStorage|indexedDB|console\./);
  assert.match(script,/inspectAttendanceSheets\(template,filename\)/);assert.match(script,/generateWorkbook\(template,analysis/);
});
