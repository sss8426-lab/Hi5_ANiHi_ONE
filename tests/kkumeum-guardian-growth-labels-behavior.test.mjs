import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const GUARDIAN_ID = 'growth-guardian';
const CHILD_ID = 'growth-child';
const CAMPUS_ID = 'campus-anihi-admission';
const TOKEN = 'guardian-growth-label-session';
const COOKIE = `kkumeum_family_session=${TOKEN}`;
const TAXONOMY = 'kkumeum-growth-skill-v1';

async function loadWorker() {
  const url = new URL('../dist/server/index.js', import.meta.url);
  url.searchParams.set('guardian-growth-labels', `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

async function sha256Base64(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Buffer.from(new Uint8Array(digest)).toString('base64');
}

async function harness() {
  const mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } }",
    modules: true,
    d1Databases: ['DB', 'FAMILY_DB'],
    r2Buckets: ['FAMILY_FILES'],
    d1Persist: false,
    r2Persist: false,
  });
  const worker = await loadWorker();
  const env = {
    DB: await mf.getD1Database('DB'),
    FAMILY_DB: await mf.getD1Database('FAMILY_DB'),
    FAMILY_FILES: await mf.getR2Bucket('FAMILY_FILES'),
  };
  async function request(path) {
    const response = await worker.fetch(new Request(`http://localhost${path}`, {
      headers: { cookie: COOKIE },
    }), env, { waitUntil() {}, passThroughOnException() {} });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  await worker.fetch(new Request('http://localhost/api/family/auth/session'), env, { waitUntil() {}, passThroughOnException() {} });
  return { mf, env, request };
}

async function seed(h) {
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 3600000).toISOString();
  const db = h.env.FAMILY_DB;
  await db.prepare(`INSERT INTO family_students (
    id, campus_id, name, display_name, school_name, grade, status, created_at, updated_at
  ) VALUES (?, ?, '실명비공개', '꿈학생', '비밀학교', '중1', 'active', ?, ?)`)
    .bind(CHILD_ID, CAMPUS_ID, now, now).run();
  await db.prepare(`INSERT INTO family_guardians (
    id, login_id, display_name, status, must_change_password, failed_login_count, created_at, updated_at
  ) VALUES (?, 'growth-guardian', '보호자', 'active', 0, 0, ?, ?)`)
    .bind(GUARDIAN_ID, now, now).run();
  await db.prepare(`INSERT INTO guardian_sessions (
    id, guardian_id, token_hash, created_at, expires_at, last_seen_at
  ) VALUES ('growth-session', ?, ?, ?, ?, ?)`)
    .bind(GUARDIAN_ID, await sha256Base64(TOKEN), now, expires, now).run();
  await db.prepare(`INSERT INTO student_guardians (
    id, student_id, guardian_id, relationship_label, can_view_reports, can_view_photos, created_at
  ) VALUES ('growth-link', ?, ?, '부모', 1, 1, ?)`)
    .bind(CHILD_ID, GUARDIAN_ID, now).run();

  const initialized = await h.request(`/api/family/children/${CHILD_ID}/reports`);
  assert.equal(initialized.status, 200);

  const rows = [
    ['current', '2026-09', 'sent', TAXONOMY, JSON.stringify(['figure_anatomy', 'composition_focus', 'figure_anatomy', 'unknown_private_code'])],
    ['stale', '2026-08', 'sent', 'kkumeum-growth-skill-v0', JSON.stringify(['line_control'])],
    ['malformed', '2026-07', 'sent', TAXONOMY, '{not-json'],
    ['draft', '2026-10', 'draft', TAXONOMY, JSON.stringify(['color_harmony'])],
  ];
  for (const [id, month, status, version, codes] of rows) {
    await db.prepare(`INSERT INTO monthly_reports (
      id, student_id, campus_id, year_month, teacher_user_id,
      title, summary, evaluation_text, teacher_note, growth_points_json,
      next_month_focus, status, sent_at, growth_skill_taxonomy_version, growth_skill_codes_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'private-teacher', ?, '비밀요약', '보호자 공개 평가', '비밀교사메모', ?,
      '다음 달 목표', ?, ?, ?, ?, ?, ?)`)
      .bind(
        `growth-report-${id}`, CHILD_ID, CAMPUS_ID, month, `${month} 평가`,
        JSON.stringify({ legacySecretSkill: '절대 표준 라벨로 추측 금지' }),
        status, status === 'sent' ? now : null, version, codes, now, now,
      ).run();
  }
}

test('guardian report exposes current canonical Korean labels only', async () => {
  const h = await harness();
  try {
    await seed(h);
    const response = await h.request(`/api/family/children/${CHILD_ID}/reports`);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(response.body.reports.map((report) => report.reportId), [
      'growth-report-current', 'growth-report-stale', 'growth-report-malformed',
    ]);
    assert.deepEqual(response.body.reports[0].growthSkillLabels, ['인체 구조', '구도·주제부 강조']);
    assert.deepEqual(response.body.reports[1].growthSkillLabels, []);
    assert.deepEqual(response.body.reports[2].growthSkillLabels, []);
    const serialized = JSON.stringify(response.body);
    assert.doesNotMatch(serialized, /unknown_private_code|growth_skill_codes_json|growth_skill_taxonomy_version|kkumeum-growth-skill-v1/);
    assert.doesNotMatch(serialized, /growth-report-draft|color_harmony/);
    assert.doesNotMatch(serialized, /비밀교사메모|private-teacher|비밀학교/);

    await h.env.FAMILY_DB.prepare('UPDATE student_guardians SET can_view_reports = 0 WHERE guardian_id = ? AND student_id = ?')
      .bind(GUARDIAN_ID, CHILD_ID).run();
    const denied = await h.request(`/api/family/children/${CHILD_ID}/reports`);
    assert.equal(denied.status, 403);
  } finally {
    await h.mf.dispose();
  }
});

test('guardian UI renders label-only chips without ranking semantics', async () => {
  const [index, enhancement] = await Promise.all([
    readFile(new URL('../public/family/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/family/family-growth-labels.js', import.meta.url), 'utf8'),
  ]);
  assert.match(index, /family-growth-labels\.js/);
  assert.match(enhancement, /growthSkillLabels/);
  assert.match(enhancement, /이번 달 성장영역/);
  assert.doesNotMatch(enhancement, /growthSkillCodes|taxonomyVersion|percentile|ranking|top skill|best skill|점수|등급|순위|백분율/i);
});
