import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';

// 상담용 화면도 업무용처럼 왼쪽 메뉴가 항상 보인다 (마우스를 왼쪽 끝에 대야 열리던 숨김 기능 없음).
test('counseling pages keep the menu visible like 업무용', () => {
  assert.equal(existsSync('public/data-core/counseling-sidebar.css'), false);
  for (const file of ['public/data-core/index.html', 'public/admissions-web/renderer/index.html']) {
    const html = readFileSync(file, 'utf8');
    assert.doesNotMatch(html, /counseling-sidebar\.css|sidebar-peek/, file);
    assert.match(html, /<aside class="sidebar">/, file);
  }
});
