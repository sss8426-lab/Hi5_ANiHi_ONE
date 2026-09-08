import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('꿈이음 Phase 2 report schema stays isolated and keeps sent revisions', async () => {
  const schema = await read('worker/kkumeum-phase2-schema.ts');
  for (const table of ['family_files', 'monthly_reports', 'monthly_report_revisions', 'student_artworks']) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(schema, /ensureKkumeumPhase1Schema\(familyDb\)/);
  assert.match(schema, /UNIQUE\(student_id, year_month\)/);
  assert.match(schema, /CHECK \(status IN \('draft', 'ready', 'sent'\)\)/);
  assert.match(schema, /snapshot_json TEXT NOT NULL/);
  assert.match(schema, /growth_skill_taxonomy_version TEXT/);
  assert.match(schema, /growth_skill_codes_json TEXT/);
  assert.match(schema, /ALTER TABLE monthly_reports ADD COLUMN/);
  assert.match(schema, /r2_key TEXT NOT NULL UNIQUE/);
  assert.doesNotMatch(schema, /\benv\.DB\b/);
  assert.doesNotMatch(schema, /\benv\.FILES\b/);
});

test('월간평가는 교사 검토 후에만 전달되고 sent 직접 덮어쓰기를 막는다', async () => {
  const reports = await read('worker/kkumeum-reports.ts');
  assert.match(reports, /from === "draft" && target === "ready"/);
  assert.match(reports, /from === "ready" && \(target === "draft" \|\| target === "sent"\)/);
  assert.match(reports, /current\.status === "sent"/);
  assert.match(reports, /throw new DataCoreAccessError\(409, "전달 완료된 평가는 직접 덮어쓸 수 없습니다/);
  assert.match(reports, /INSERT INTO monthly_report_revisions/);
  assert.match(reports, /JSON\.stringify\(reportResponse\(current\)\)/);
  assert.match(reports, /normalizeKkumeumGrowthSkillCodes/);
  assert.match(reports, /growthSkillTaxonomyVersion/);
  assert.match(reports, /requiresTeacherReview: true/);
  assert.match(reports, /autoSend: false/);
});

test('성장 영역 catalog와 교직원 UI는 canonical registry를 API로만 사용한다', async () => {
  const router = await read('worker/kkumeum-router.ts');
  const ui = await read('public/data-core/work/kkumeum-operations.js');
  assert.match(router, /\/api\/kkumeum\/growth-skills\/catalog/);
  assert.match(router, /kkumeumGrowthSkillCatalog\(\)/);
  assert.match(ui, /\/api\/kkumeum\/growth-skills\/catalog/);
  assert.match(ui, /data-growth-skill/);
  assert.match(ui, /growthSkillCodes:form\.getAll\('growthSkillCodes'\)/);
  assert.match(ui, /selected >= max/);
  assert.doesNotMatch(ui, /figure_anatomy|color_harmony|form_observation/);
});

test('AI provider 미연결은 가짜 생성 결과 없이 503 계약을 유지한다', async () => {
  const reports = await read('worker/kkumeum-reports.ts');
  const router = await read('worker/kkumeum-router.ts');
  assert.match(reports, /available: false as const/);
  assert.match(reports, /provider_not_configured/);
  assert.match(router, /status: generation\.available \? 200 : 503/);
  assert.doesNotMatch(reports, /available: false[\s\S]{0,250}generated:/);
});

test('TEACHER report write 권한은 active assignment의 can_edit_reports=1을 요구한다', async () => {
  const access = await read('worker/kkumeum-report-access.ts');
  const router = await read('worker/kkumeum-router.ts');
  assert.match(access, /a\.ended_at IS NULL/);
  assert.match(access, /a\.can_edit_reports = 1/);
  assert.match(access, /c\.campus_id = s\.campus_id/);
  assert.match(access, /a\.staff_user_id = \?/);

  const occurrences = (router.match(/requireKkumeumReportEditAccess/g) || []).length;
  assert.ok(occurrences >= 5, `expected report edit guard on mutation/generation routes, got ${occurrences}`);
  assert.match(router, /reports\/generate/);
  assert.match(router, /action === "revise"/);
  assert.match(router, /action === "ready" \|\| action === "draft" \|\| action === "send"/);
  assert.match(router, /request\.method === "PATCH"/);
});

test('꿈이음 개인정보 JSON 응답은 브라우저 캐시에 저장하지 않는다', async () => {
  const router = await read('worker/kkumeum-router.ts');
  assert.match(router, /headers\.set\("cache-control", "private, no-store"\)/);
  assert.match(router, /const respond = privateJsonResponder\(jsonResponse\)/);
  assert.doesNotMatch(router, /return jsonResponse\(/);
});
