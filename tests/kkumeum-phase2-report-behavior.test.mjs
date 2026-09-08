import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const ADMIN = {
  id: 'kkumeum-report-admin',
  email: 'kkumeum-report-admin@example.test',
  name: '꿈이음 평가 관리자',
};
const TEACHER = {
  id: 'kkumeum-report-teacher',
  email: 'kkumeum-report-teacher@example.test',
  name: '꿈이음 평가 교사',
};
const CAMPUS = 'campus-anihi-admission';
const ORGANIZATION_ID = 'org-hi5-anihi';

function authHeaders(user) {
  return {
    'oai-authenticated-user-id': user.id,
    'oai-authenticated-user-email': user.email,
    'oai-authenticated-user-full-name': encodeURIComponent(user.name),
    'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
  };
}

async function loadWorker() {
  const workerUrl = new URL('../dist/server/index.js', import.meta.url);
  workerUrl.searchParams.set('kkumeum-phase2-report', `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

async function makeHarness() {
  const mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } }",
    modules: true,
    d1Databases: ['DB', 'FAMILY_DB'],
    r2Buckets: ['FAMILY_FILES'],
    d1Persist: false,
    r2Persist: false,
  });
  const worker = await loadWorker();
  const DB = await mf.getD1Database('DB');
  const FAMILY_DB = await mf.getD1Database('FAMILY_DB');
  const env = {
    DB,
    FAMILY_DB,
    FAMILY_FILES: await mf.getR2Bucket('FAMILY_FILES'),
    DATA_CORE_SUPER_ADMIN_EMAILS: ADMIN.email,
  };

  async function request(path, { user = ADMIN, method = 'GET', body } = {}) {
    const headers = new Headers(user ? authHeaders(user) : undefined);
    if (body !== undefined) headers.set('content-type', 'application/json');
    const response = await worker.fetch(
      new Request(`http://localhost${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
      { waitUntil() {}, passThroughOnException() {} },
    );
    return {
      status: response.status,
      headers: response.headers,
      body: await response.json().catch(() => ({})),
    };
  }

  return { mf, env, request };
}

test('꿈이음 월간평가 권한·상태·revision·AI 미연결 계약을 실제 라우터에서 지킨다', async () => {
  const { mf, env, request } = await makeHarness();
  try {
    const catalog = await request('/api/kkumeum/growth-skills/catalog', { user: ADMIN });
    assert.equal(catalog.status, 200);
    assert.equal(catalog.headers.get('cache-control'), 'private, no-store');
    assert.equal(catalog.body.taxonomyVersion, 'kkumeum-growth-skill-v1');
    assert.equal(catalog.body.maxSelections, 5);
    assert.ok(catalog.body.categories.some((category) => category.code === 'FIGURE_CHARACTER'));

    const classResult = await request('/api/kkumeum/classes', {
      method: 'POST',
      body: { campusId: CAMPUS, name: '평가테스트반', stage: '기초' },
    });
    assert.equal(classResult.status, 201);
    const classId = classResult.body.class.id;

    const studentResult = await request('/api/kkumeum/students', {
      method: 'POST',
      body: { campusId: CAMPUS, name: '평가테스트학생', classId, grade: '중1' },
    });
    assert.equal(studentResult.status, 201);
    const studentId = studentResult.body.student.id;

    await request('/api/data-core/context', { user: TEACHER });
    const teacherInternalId = `oai:${TEACHER.id}`;
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO memberships (id, organization_id, campus_id, user_id, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'TEACHER', ?, ?)`,
    ).bind('membership:kkumeum-report-teacher', ORGANIZATION_ID, CAMPUS, teacherInternalId, now, now).run();

    await env.FAMILY_DB.prepare(
      `INSERT INTO class_staff_assignments (
         id, class_id, staff_user_id, role, can_edit_reports, can_manage_artworks,
         started_at, ended_at, created_at, updated_at
       ) VALUES (?, ?, ?, 'TEACHER', 0, 0, ?, NULL, ?, ?)`,
    ).bind('assignment:kkumeum-report-teacher', classId, teacherInternalId, now, now, now).run();

    const denied = await request('/api/kkumeum/reports', {
      user: TEACHER,
      method: 'POST',
      body: {
        campusId: CAMPUS,
        studentId,
        yearMonth: '2026-09',
        evaluationText: '권한이 없을 때 저장되면 안 됩니다.',
      },
    });
    assert.equal(denied.status, 403);

    await env.FAMILY_DB.prepare(
      'UPDATE class_staff_assignments SET can_edit_reports = 1, updated_at = ? WHERE id = ?',
    ).bind(new Date().toISOString(), 'assignment:kkumeum-report-teacher').run();

    const created = await request('/api/kkumeum/reports', {
      user: TEACHER,
      method: 'POST',
      body: {
        campusId: CAMPUS,
        studentId,
        yearMonth: '2026-09',
        title: '9월 성장평가',
        evaluationText: '인체 비례를 관찰하며 표현하는 힘이 좋아졌습니다.',
        teacherNote: '보호자 화면에는 노출하지 않을 내부 메모',
        growthPoints: { drawing: '향상' },
        growthSkillCodes: ['figure_anatomy', 'color_harmony', 'figure_anatomy'],
        nextMonthFocus: '배경 공간감을 강화합니다.',
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.report.status, 'draft');
    assert.equal(created.body.report.growthSkillTaxonomyVersion, 'kkumeum-growth-skill-v1');
    assert.deepEqual(created.body.report.growthSkillCodes, ['figure_anatomy', 'color_harmony']);
    assert.deepEqual(created.body.report.growthSkills.map((skill) => skill.labelKo), ['인체 구조', '색채·조화']);
    assert.equal(created.headers.get('cache-control'), 'private, no-store');
    const reportId = created.body.report.id;

    const columns = await env.FAMILY_DB.prepare('PRAGMA table_info(monthly_reports)').all();
    assert.ok(columns.results.some((column) => column.name === 'growth_skill_taxonomy_version'));
    assert.ok(columns.results.some((column) => column.name === 'growth_skill_codes_json'));

    const unknownCode = await request('/api/kkumeum/reports', {
      user: TEACHER,
      method: 'POST',
      body: { campusId: CAMPUS, studentId, yearMonth: '2026-10', evaluationText: '검증', growthSkillCodes: ['not_a_skill'] },
    });
    assert.equal(unknownCode.status, 400);

    const tooManyCodes = await request('/api/kkumeum/reports', {
      user: TEACHER,
      method: 'POST',
      body: {
        campusId: CAMPUS, studentId, yearMonth: '2026-10', evaluationText: '검증',
        growthSkillCodes: ['form_observation', 'proportion_accuracy', 'line_control', 'figure_anatomy', 'pose_motion', 'face_expression'],
      },
    });
    assert.equal(tooManyCodes.status, 400);

    const cleared = await request(`/api/kkumeum/reports/${reportId}`, {
      user: TEACHER,
      method: 'PATCH',
      body: { evaluationText: '인체 비례를 관찰하며 표현하는 힘이 좋아졌습니다.', growthSkillCodes: [] },
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.report.growthSkillTaxonomyVersion, null);
    assert.deepEqual(cleared.body.report.growthSkillCodes, []);

    const updated = await request(`/api/kkumeum/reports/${reportId}`, {
      user: TEACHER,
      method: 'PATCH',
      body: { evaluationText: '인체 비례를 관찰하며 표현하는 힘이 좋아졌습니다.', growthSkillCodes: ['figure_anatomy', 'color_harmony'] },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.report.growthSkillTaxonomyVersion, 'kkumeum-growth-skill-v1');
    assert.deepEqual(updated.body.report.growthSkillCodes, ['figure_anatomy', 'color_harmony']);

    const generation = await request('/api/kkumeum/reports/generate', {
      user: TEACHER,
      method: 'POST',
      body: {
        campusId: CAMPUS,
        studentId,
        yearMonth: '2026-09',
        teacherObservations: '수업 관찰 메모',
        artworkNotes: ['인체 비례가 안정됨'],
      },
    });
    assert.equal(generation.status, 503);
    assert.equal(generation.body.available, false);
    assert.equal(generation.body.code, 'provider_not_configured');
    assert.equal('generated' in generation.body, false);

    const ready = await request(`/api/kkumeum/reports/${reportId}/ready`, {
      user: TEACHER,
      method: 'POST',
    });
    assert.equal(ready.status, 200);
    assert.equal(ready.body.report.status, 'ready');

    const sent = await request(`/api/kkumeum/reports/${reportId}/send`, {
      user: TEACHER,
      method: 'POST',
    });
    assert.equal(sent.status, 200);
    assert.equal(sent.body.report.status, 'sent');
    assert.ok(sent.body.report.sentAt);

    const directPatch = await request(`/api/kkumeum/reports/${reportId}`, {
      user: TEACHER,
      method: 'PATCH',
      body: { evaluationText: '직접 덮어쓰기 시도' },
    });
    assert.equal(directPatch.status, 409);

    const rollback = await request(`/api/kkumeum/reports/${reportId}/draft`, {
      user: TEACHER,
      method: 'POST',
    });
    assert.equal(rollback.status, 409);

    const revised = await request(`/api/kkumeum/reports/${reportId}/revise`, {
      user: TEACHER,
      method: 'POST',
      body: {
        title: '9월 성장평가 수정본',
        evaluationText: '교사 확인 후 수정 이력을 남긴 평가입니다.',
        teacherNote: '수정 사유 내부 확인',
        growthSkillCodes: ['composition_focus'],
      },
    });
    assert.equal(revised.status, 200);
    assert.ok(revised.body.revisionId);
    assert.equal(revised.body.report.status, 'sent');
    assert.deepEqual(revised.body.report.growthSkillCodes, ['composition_focus']);

    const revisions = await request(`/api/kkumeum/reports/${reportId}/revisions`, {
      user: TEACHER,
    });
    assert.equal(revisions.status, 200);
    assert.equal(revisions.body.revisions.length, 1);
    assert.equal(
      revisions.body.revisions[0].snapshot.evaluationText,
      '인체 비례를 관찰하며 표현하는 힘이 좋아졌습니다.',
    );
    assert.equal(revisions.body.revisions[0].snapshot.growthSkillTaxonomyVersion, 'kkumeum-growth-skill-v1');
    assert.deepEqual(revisions.body.revisions[0].snapshot.growthSkillCodes, ['figure_anatomy', 'color_harmony']);

    await env.FAMILY_DB.prepare(`UPDATE monthly_reports
      SET growth_skill_taxonomy_version = NULL, growth_skill_codes_json = NULL WHERE id = ?`).bind(reportId).run();
    const legacy = await request(`/api/kkumeum/reports/${reportId}`, { user: TEACHER });
    assert.equal(legacy.status, 200);
    assert.equal(legacy.body.report.growthSkillTaxonomyVersion, null);
    assert.deepEqual(legacy.body.report.growthSkillCodes, []);
  } finally {
    await mf.dispose();
  }
});
