import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const routerSource = await readFile(new URL('../worker/router.ts', import.meta.url), 'utf8');
const kkumeumRouterSource = await readFile(new URL('../worker/kkumeum-router.ts', import.meta.url), 'utf8');
const navSource = await readFile(new URL('../public/data-core/work/kkumeum-nav.js', import.meta.url), 'utf8');
const shellSource = await readFile(new URL('../public/data-core/work/kkumeum.html', import.meta.url), 'utf8');
const shellJs = await readFile(new URL('../public/data-core/work/kkumeum.js', import.meta.url), 'utf8');

test('꿈이음 is a protected work-only route and work-home card, not a counseling feature', () => {
  assert.match(routerSource, /pathname === "\/data-core\/kkumeum"/);
  assert.match(routerSource, /url\.pathname = "\/data-core\/work\/kkumeum\.html"/);
  assert.match(navSource, /data-nav-scope="work"/);
  assert.match(navSource, /학생 작품·월간 평가·보호자 소식을 한곳에서 관리합니다/);
  assert.match(navSource, /#view-work-home \.menu-card-grid/);
  assert.doesNotMatch(navSource, /data-nav-scope="counseling"/);
  assert.doesNotMatch(shellSource, /상담용/);
});

test('꿈이음 API environment keeps isolated FAMILY bindings and never falls back to DATA CORE DB/FILES', () => {
  assert.match(routerSource, /FAMILY_DB\?: D1Database/);
  assert.match(routerSource, /FAMILY_FILES\?: R2Bucket/);
  assert.match(routerSource, /handleKkumeumApi\(request, env, context, jsonResponse\)/);
  assert.match(kkumeumRouterSource, /requireKkumeumBindingsReady/);
  assert.match(kkumeumRouterSource, /requireFamilyDatabase\(context, env\.FAMILY_DB\)/);
  assert.doesNotMatch(kkumeumRouterSource, /FAMILY_DB\s*\|\|/);
  assert.doesNotMatch(kkumeumRouterSource, /FAMILY_FILES\s*\|\|/);
  assert.doesNotMatch(kkumeumRouterSource, /env\.DB/);
  assert.doesNotMatch(kkumeumRouterSource, /env\.FILES/);
});

test('staff shell exposes setup-required state and activates only against 꿈이음 health/classes/students APIs', () => {
  assert.match(shellSource, /FAMILY_DB 전용 D1/);
  assert.match(shellSource, /FAMILY_FILES private R2/);
  assert.match(shellJs, /\/api\/kkumeum\/health/);
  assert.match(shellJs, /\/api\/kkumeum\/classes/);
  assert.match(shellJs, /\/api\/kkumeum\/students/);
  assert.match(shellJs, /기존 DATA CORE DB\/R2에 대신 저장하지 않습니다/);
});
