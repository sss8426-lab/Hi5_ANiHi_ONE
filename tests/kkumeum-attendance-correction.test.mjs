import assert from 'node:assert/strict';
import test from 'node:test';
import { hkdfSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { Miniflare } from 'miniflare';

// Isolated D1 and locally generated keys. No production people, secrets or provider endpoints.
const CAMPUS = 'campus-anihi-admission';
const OTHER_CAMPUS = 'campus-design-admission';
const ADMIN = { id: 'correction-admin', email: 'correction-admin@example.test' };
const DIRECTOR = { id: 'correction-director', email: 'correction-director@example.test' };
const TEACHER = { id: 'correction-teacher', email: 'correction-teacher@example.test' };
const STATUSES = { arrive: '등원', leave: '하원', absent: '결석', late: '지각', early: '조퇴', makeup: '보강' };
const privateNote = '재전송하면 안 되는 자유입력 메모 010-0000-0000';
const dateKst = (value = Date.now()) => new Date(value + 9 * 3600_000).toISOString().slice(0, 10);
const timeKst = value => new Date(Date.parse(value) + 9 * 3600_000).toISOString().slice(11, 16);

async function harness() {
  const mf = new Miniflare({ script: "export default { fetch() { return new Response('ok'); } }", modules: true,
    d1Databases: ['DB', 'FAMILY_DB'], r2Buckets: ['FAMILY_FILES'], d1Persist: false, r2Persist: false });
  const url = new URL('../dist/server/index.js', import.meta.url);
  url.searchParams.set('attendance-correction', `${process.pid}-${Math.random()}`);
  const worker = (await import(url.href)).default;
  const env = { DB: await mf.getD1Database('DB'), FAMILY_DB: await mf.getD1Database('FAMILY_DB'),
    FAMILY_FILES: await mf.getR2Bucket('FAMILY_FILES'), DATA_CORE_SUPER_ADMIN_EMAILS: ADMIN.email,
    PUSH_SUBSCRIPTION_ENCRYPTION_KEY: Buffer.alloc(32, 23).toString('base64url') };
  async function request(path, { user = ADMIN, method = 'GET', body, cookie, origin = 'http://localhost' } = {}) {
    const headers = new Headers(user ? { 'oai-authenticated-user-id': user.id, 'oai-authenticated-user-email': user.email } : {});
    if (cookie) headers.set('cookie', cookie);
    if (method !== 'GET') headers.set('origin', origin);
    if (body !== undefined) headers.set('content-type', 'application/json');
    const r = await worker.fetch(new Request(`http://localhost${path}`, { method, headers,
      body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {}, passThroughOnException() {} });
    return { status: r.status, body: await r.json(), headers: r.headers };
  }
  const cls = await request('/api/kkumeum/classes', { method: 'POST', body: { campusId: CAMPUS, name: '합성반' } });
  assert.equal(cls.status, 201);
  const student = await request('/api/kkumeum/students', { method: 'POST', body: { campusId: CAMPUS, name: '합성학생', displayName: '합성표시명', classId: cls.body.class.id } });
  assert.equal(student.status, 201);
  const studentId = student.body.student.id;
  // Explicitly set a different display name to prove notifications prefer it.
  await env.FAMILY_DB.prepare("UPDATE family_students SET display_name = '합성표시명' WHERE id = ?").bind(studentId).run();
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  env.PUSH_VAPID_PUBLIC_KEY = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url');
  env.PUSH_VAPID_PRIVATE_JWK = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
  env.PUSH_VAPID_SUBJECT = 'mailto:correction@example.test';
  await request('/api/family/push/status', { user: null });
  const devices = new Map();
  const cookies = new Map();
  async function guardian(id, linked = true, deviceCount = 1) {
    const now = new Date().toISOString(), token = `synthetic-token-${id}`;
    const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('base64');
    await env.FAMILY_DB.prepare(`INSERT INTO family_guardians (id, login_id, display_name, status, must_change_password, created_at, updated_at)
      VALUES (?, ?, '합성보호자', 'active', 0, ?, ?)`).bind(id, id, now, now).run();
    await env.FAMILY_DB.prepare(`INSERT INTO guardian_sessions (id, guardian_id, token_hash, created_at, expires_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(`session-${id}`, id, hash, now, new Date(Date.now() + 86400_000).toISOString(), now).run();
    if (linked) await env.FAMILY_DB.prepare(`INSERT INTO student_guardians (id, student_id, guardian_id, relationship_label, created_at)
      VALUES (?, ?, ?, '보호자', ?)`).bind(`link-${id}`, studentId, id, now).run();
    const cookie = `kkumeum_family_session=${token}`;
    cookies.set(id, cookie);
    for (let i = 0; i < deviceCount; i++) {
      const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
      const publicKey = Buffer.from(await crypto.subtle.exportKey('raw', keys.publicKey));
      const auth = Buffer.alloc(16, 24 + i);
      const endpoint = `https://synthetic.push.example/${id}/${i}`;
      devices.set(endpoint, { privateKey: keys.privateKey, publicKey, auth });
      const r = await request('/api/family/push/subscribe', { user: null, cookie, method: 'POST', body: {
        endpoint, keys: { p256dh: publicKey.toString('base64url'), auth: auth.toString('base64url') }, platform: 'synthetic-browser' } });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
    return cookie;
  }
  const mark = (status = 'arrive') => request('/api/kkumeum/attendance', { method: 'POST', body: { campusId: CAMPUS, studentIds: [studentId], status, message: privateNote } });
  const cancel = (id, options = {}) => request(`/api/kkumeum/attendance/${id}`, { method: 'DELETE', body: {}, ...options });
  return { mf, env, request, studentId, classId: cls.body.class.id, guardian, mark, cancel, devices, cookies };
}

// Independent RFC 8291 receiver decrypts the actual encrypted HTTP body.
async function decryptPayload(body, device) {
  const bytes = Buffer.from(body), salt = bytes.subarray(0, 16), keyLength = bytes[20];
  const serverPublic = bytes.subarray(21, 21 + keyLength);
  const key = await crypto.subtle.importKey('raw', serverPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = Buffer.from(await crypto.subtle.deriveBits({ name: 'ECDH', public: key }, device.privateKey, 256));
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), device.publicKey, serverPublic]);
  const ikm = hkdfSync('sha256', shared, device.auth, info, 32);
  const cek = hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = Buffer.from(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, bytes.subarray(21 + keyLength)));
  assert.equal(plain.at(-1), 2);
  return JSON.parse(plain.subarray(0, -1).toString());
}

async function withProvider(h, work) {
  const previous = globalThis.fetch, deliveries = [];
  let respond = async () => new Response(null, { status: 201 });
  globalThis.fetch = async (endpoint, init) => {
    const device = h.devices.get(String(endpoint));
    assert.ok(device, 'only synthetic endpoints may be contacted');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Content-Encoding'], 'aes128gcm');
    deliveries.push({ endpoint: String(endpoint), payload: await decryptPayload(init.body, device) });
    return respond(endpoint);
  };
  try { await work(deliveries, fn => { respond = fn; }); }
  finally { globalThis.fetch = previous; }
}

for (const [status, label] of Object.entries(STATUSES)) test(`출결 ${label}: registration → encrypted initial alert → cancellation → distinct correction`, async () => {
  const h = await harness();
  try {
    const parent = await h.guardian('linked');
    await h.guardian('unrelated', false);
    await withProvider(h, async deliveries => {
      const marked = await h.mark(status);
      assert.equal(marked.status, 201, JSON.stringify(marked.body));
      assert.deepEqual(marked.body.push, { sent: 1, failed: 0, code: null });
      const id = marked.body.marked[0].id;
      const original = await h.env.FAMILY_DB.prepare('SELECT * FROM family_attendance_events WHERE id = ?').bind(id).first();
      assert.equal(deliveries[0].payload.attendanceAction, 'marked');
      assert.equal(deliveries[0].payload.eventId, id);
      const undone = await h.cancel(id);
      assert.equal(undone.status, 200, JSON.stringify(undone.body));
      assert.equal(undone.headers.get('cache-control'), 'private, no-store');
      assert.deepEqual(undone.body.push, { sent: 1, failed: 0, code: null });
      assert.equal(undone.body.guardians, 1);
      assert.equal(deliveries.length, 2);
      assert.ok(deliveries.every(d => d.endpoint.includes('/linked/')));
      const correction = deliveries[1].payload;
      assert.equal(correction.kind, 'attendance', 'existing installed service workers already display this kind');
      assert.equal(correction.attendanceAction, 'canceled');
      assert.equal(correction.eventId, id);
      assert.equal(correction.title, `꿈이음 · 출결 정정 (${label} 취소)`);
      assert.equal(correction.body, `출결 정정: 합성표시명 학생의 ${original.event_date} ${timeKst(original.occurred_at)} ${label} 기록을 취소했습니다. 해당 기록은 유효하지 않습니다. 현재 출결은 앱에서 확인해 주세요.`);
      assert.equal(correction.route, `/family/?openAttendance=${h.studentId}`);
      assert.ok(!JSON.stringify(correction).includes(privateNote));
      assert.ok(!JSON.stringify(correction).includes(ADMIN.id));
      const history = await h.request(`/api/family/children/${h.studentId}/attendance`, { user: null, cookie: parent });
      assert.equal(history.status, 200);
      assert.deepEqual(history.body.events, []);
      assert.equal(history.body.corrections[0].id, id);
      assert.ok(history.body.corrections[0].canceledAt);
      for (const secret of [privateNote, 'created_by', 'campus_id', 'guardian_id']) assert.ok(!JSON.stringify(history.body).includes(secret));
      const day = await h.request(`/api/kkumeum/attendance?campusId=${CAMPUS}`);
      assert.deepEqual(day.body.students.find(s => s.id === h.studentId).events, []);
      const month = await h.request(`/api/kkumeum/attendance/monthly?campusId=${CAMPUS}`);
      assert.equal(month.body.students.find(s => s.id === h.studentId).counts[status], 0);
      const audit = await h.env.FAMILY_DB.prepare("SELECT metadata_json FROM family_audit_logs WHERE action = 'attendance_cancel' AND resource_id = ?").bind(id).all();
      assert.equal(audit.results.length, 1);
      assert.deepEqual(JSON.parse(audit.results[0].metadata_json), { status });
    });
  } finally { await h.mf.dispose(); }
});

test('concurrent and repeated cancellations produce one correction and one audit, without changing another valid event', async () => {
  const h = await harness();
  try {
    await h.guardian('linked', true, 2);
    await withProvider(h, async deliveries => {
      const first = (await h.mark()).body.marked[0].id;
      const second = (await h.mark('leave')).body.marked[0].id;
      const results = await Promise.all([h.cancel(first), h.cancel(first), h.cancel(first)]);
      assert.equal(results.filter(r => r.status === 200).length, 1);
      assert.ok(results.filter(r => r.status !== 200).every(r => [404, 409].includes(r.status)));
      assert.equal(deliveries.filter(d => d.payload.attendanceAction === 'canceled').length, 2, 'once per active device');
      assert.equal((await h.cancel(first)).status, 404);
      assert.equal((await h.env.FAMILY_DB.prepare("SELECT COUNT(*) AS n FROM family_audit_logs WHERE action = 'attendance_cancel'").first()).n, 1);
      assert.equal((await h.env.FAMILY_DB.prepare('SELECT canceled_at FROM family_attendance_events WHERE id = ?').bind(second).first()).canceled_at, null);
    });
  } finally { await h.mf.dispose(); }
});

test('cancellation rechecks linked, active guardians and devices, and guardians cannot read another child correction', async () => {
  const h = await harness();
  try {
    const unrelated = await h.guardian('unrelated', false);
    await h.guardian('unlinked');
    await h.guardian('disabled');
    await h.guardian('revoked');
    await h.guardian('active');
    await withProvider(h, async deliveries => {
      const id = (await h.mark()).body.marked[0].id;
      await h.env.FAMILY_DB.prepare("DELETE FROM student_guardians WHERE guardian_id = 'unlinked'").run();
      await h.env.FAMILY_DB.prepare("UPDATE family_guardians SET status = 'disabled' WHERE id = 'disabled'").run();
      await h.env.FAMILY_DB.prepare("UPDATE push_subscriptions SET active = 0, revoked_at = ? WHERE guardian_id = 'revoked'").bind(new Date().toISOString()).run();
      const result = await h.cancel(id);
      assert.equal(result.body.push.sent, 1);
      assert.deepEqual(deliveries.filter(d => d.payload.attendanceAction === 'canceled').map(d => d.endpoint), ['https://synthetic.push.example/active/0']);
      assert.equal((await h.request(`/api/family/children/${h.studentId}/attendance`, { user: null, cookie: unrelated })).status, 403);
    });
  } finally { await h.mf.dispose(); }
});

test('cancel auth, origin, campus, teacher assignment, past-date and nonexistent-id guards reject before mutation or push', async () => {
  const h = await harness();
  try {
    await h.guardian('linked');
    for (const [user, role, campus] of [[DIRECTOR, 'CAMPUS_DIRECTOR', OTHER_CAMPUS], [TEACHER, 'TEACHER', CAMPUS]]) {
      await h.request('/api/data-core/context', { user });
      const now = new Date().toISOString();
      await h.env.DB.prepare(`INSERT INTO memberships (id, organization_id, campus_id, user_id, role, created_at, updated_at)
        VALUES (?, 'org-hi5-anihi', ?, ?, ?, ?, ?)`).bind(`membership-${user.id}`, campus, `oai:${user.id}`, role, now, now).run();
    }
    await withProvider(h, async deliveries => {
      const id = (await h.mark()).body.marked[0].id;
      assert.equal((await h.cancel(id, { user: null })).status, 401);
      assert.equal((await h.cancel(id, { origin: 'https://other.example' })).status, 403);
      assert.equal((await h.cancel(id, { user: DIRECTOR })).status, 403);
      assert.equal((await h.cancel(id, { user: TEACHER })).status, 403);
      assert.equal((await h.cancel('does-not-exist')).status, 404);
      await h.env.FAMILY_DB.prepare('UPDATE family_attendance_events SET event_date = ? WHERE id = ?').bind(dateKst(Date.now() - 86400_000), id).run();
      assert.equal((await h.cancel(id)).status, 409);
      assert.equal(deliveries.length, 1);
      assert.equal((await h.env.FAMILY_DB.prepare('SELECT canceled_at FROM family_attendance_events WHERE id = ?').bind(id).first()).canceled_at, null);
      await h.env.FAMILY_DB.prepare('UPDATE family_attendance_events SET event_date = ? WHERE id = ?').bind(dateKst(), id).run();
      const now = new Date().toISOString();
      await h.env.FAMILY_DB.prepare(`INSERT INTO class_staff_assignments (id, class_id, staff_user_id, role, started_at, created_at, updated_at)
        VALUES ('assigned', ?, ?, 'TEACHER', ?, ?, ?)`).bind(h.classId, `oai:${TEACHER.id}`, now, now, now).run();
      assert.equal((await h.cancel(id, { user: TEACHER })).status, 200, 'assigned teacher retains existing access');
    });
  } finally { await h.mf.dispose(); }
});

for (const failure of ['rejected', 'network', 'gone', 'configuration', 'encryption-key']) test(`correction push failure (${failure}) preserves cancellation and guardian correction history, and reports no false success`, async () => {
  const h = await harness();
  try {
    const cookie = await h.guardian('linked');
    await withProvider(h, async (deliveries, setResponse) => {
      const id = (await h.mark()).body.marked[0].id;
      let expectedCode;
      if (failure === 'rejected') { expectedCode = 'provider_rejected'; setResponse(async () => new Response(null, { status: 503 })); }
      if (failure === 'network') { expectedCode = 'provider_error'; setResponse(async () => { throw new Error('synthetic network failure'); }); }
      if (failure === 'gone') { expectedCode = 'subscription_gone'; setResponse(async () => new Response(null, { status: 410 })); }
      if (failure === 'configuration') { expectedCode = 'vapid_invalid'; delete h.env.PUSH_VAPID_PRIVATE_JWK; }
      if (failure === 'encryption-key') { expectedCode = 'subscription_key_mismatch'; h.env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY = Buffer.alloc(32, 99).toString('base64url'); }
      const result = await h.cancel(id);
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.push, { sent: 0, failed: 1, code: expectedCode });
      assert.ok((await h.env.FAMILY_DB.prepare('SELECT canceled_at FROM family_attendance_events WHERE id = ?').bind(id).first()).canceled_at);
      const history = await h.request(`/api/family/children/${h.studentId}/attendance`, { user: null, cookie });
      assert.equal(history.body.events.length, 0);
      assert.equal(history.body.corrections.length, 1);
      assert.equal((await h.cancel(id)).status, 404, 'no blind retry after provider rejection or ambiguous timeout');
      assert.equal(deliveries.length, ['configuration', 'encryption-key'].includes(failure) ? 1 : 2);
      if (failure === 'gone') assert.equal((await h.env.FAMILY_DB.prepare('SELECT active FROM push_subscriptions').first()).active, 0);
    });
  } finally { await h.mf.dispose(); }
});

test('no subscription or no linked guardian means no provider call, but cancellation remains visible', async () => {
  const h = await harness();
  try {
    await h.guardian('no-device', true, 0);
    await withProvider(h, async deliveries => {
      const first = (await h.mark()).body.marked[0].id;
      const result = await h.cancel(first);
      assert.equal(result.body.guardians, 1);
      assert.deepEqual(result.body.push, { sent: 0, failed: 0, code: null });
      await h.env.FAMILY_DB.prepare('DELETE FROM student_guardians').run();
      const second = (await h.mark()).body.marked[0].id;
      const noGuardian = await h.cancel(second);
      assert.equal(noGuardian.body.guardians, 0);
      assert.deepEqual(noGuardian.body.push, { sent: 0, failed: 0, code: null });
      assert.equal(deliveries.length, 0);
    });
  } finally { await h.mf.dispose(); }
});

test('partial provider acceptance is counted accurately and a revoked second device is rechecked during dispatch', async () => {
  const h = await harness();
  try {
    await h.guardian('linked', true, 2);
    await withProvider(h, async (deliveries, setResponse) => {
      const id = (await h.mark()).body.marked[0].id;
      setResponse(async endpoint => new Response(null, { status: String(endpoint).endsWith('/1') ? 503 : 201 }));
      const result = await h.cancel(id);
      assert.deepEqual(result.body.push, { sent: 1, failed: 1, code: 'provider_rejected' });
      setResponse(async () => new Response(null, { status: 201 }));
      const second = (await h.mark()).body.marked[0].id;
      let revoked = false;
      setResponse(async () => {
        if (!revoked) {
          revoked = true;
          await h.env.FAMILY_DB.prepare("UPDATE push_subscriptions SET active = 0 WHERE guardian_id = 'linked' AND platform = 'synthetic-browser' AND id != (SELECT id FROM push_subscriptions WHERE endpoint_hash = ?)")
            .bind(Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('https://synthetic.push.example/linked/0'))).toString('base64url')).run();
        }
        return new Response(null, { status: 201 });
      });
      const during = await h.cancel(second);
      assert.deepEqual(during.body.push, { sent: 1, failed: 0, code: null });
      assert.equal(deliveries.filter(d => d.payload.eventId === second && d.payload.attendanceAction === 'canceled').length, 1);
    });
  } finally { await h.mf.dispose(); }
});

test('cancel overtaking initial dispatch suppresses later initial device sends', async () => {
  const h = await harness();
  try {
    await h.guardian('linked', true, 2);
    await withProvider(h, async (deliveries, setResponse) => {
      let canceled = false;
      setResponse(async () => {
        if (!canceled) {
          canceled = true;
          const result = await h.cancel(deliveries[0].payload.eventId);
          assert.equal(result.body.push.sent, 2);
        }
        return new Response(null, { status: 201 });
      });
      const marked = await h.mark();
      assert.equal(marked.status, 201);
      assert.equal(marked.body.push.sent, 1, 'already in-flight provider request can finish, remaining stale sends are suppressed');
      assert.equal(deliveries.filter(d => d.payload.attendanceAction === 'marked').length, 1);
      assert.equal(deliveries.filter(d => d.payload.attendanceAction === 'canceled').length, 2);
    });
  } finally { await h.mf.dispose(); }
});

test('cancellation and its audit are atomic: an audit write failure rolls back and sends no correction', async () => {
  const h = await harness();
  try {
    await h.guardian('linked');
    await withProvider(h, async deliveries => {
      const id = (await h.mark()).body.marked[0].id;
      await h.env.FAMILY_DB.exec("CREATE TRIGGER fail_cancel_audit BEFORE INSERT ON family_audit_logs WHEN NEW.action = 'attendance_cancel' BEGIN SELECT RAISE(ABORT, 'synthetic audit write failure'); END;");
      assert.equal((await h.cancel(id)).status, 500);
      assert.equal((await h.env.FAMILY_DB.prepare('SELECT canceled_at FROM family_attendance_events WHERE id = ?').bind(id).first()).canceled_at, null);
      assert.equal(deliveries.length, 1);
      await h.env.FAMILY_DB.exec('DROP TRIGGER fail_cancel_audit;');
      assert.equal((await h.cancel(id)).status, 200, 'a clean retry works after a transaction that did not commit');
      assert.equal(deliveries.length, 2);
    });
  } finally { await h.mf.dispose(); }
});

test('KST midnight is the same-day boundary, independent of UTC date', async () => {
  const h = await harness(), RealDate = globalThis.Date;
  let clock = RealDate.parse('2026-10-08T14:59:59Z');
  try {
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [clock])); }
      static now() { return clock; }
    };
    const sameDay = await h.mark();
    assert.equal(sameDay.body.date, '2026-10-08');
    assert.equal((await h.cancel(sameDay.body.marked[0].id)).status, 200);
    const beforeMidnight = await h.mark();
    clock = RealDate.parse('2026-10-08T15:00:00Z');
    assert.equal((await h.cancel(beforeMidnight.body.marked[0].id)).status, 409);
    const afterMidnight = await h.mark();
    assert.equal(afterMidnight.body.date, '2026-10-09');
    assert.equal((await h.cancel(afterMidnight.body.marked[0].id)).status, 200);
  } finally { globalThis.Date = RealDate; await h.mf.dispose(); }
});

test('existing PWA displays correction text as attendance and replaces the original student notification, while notices stay generic', async () => {
  const source = await readFile(new URL('../public/family/sw.js', import.meta.url), 'utf8');
  const handlers = new Map(), shown = [];
  vm.runInNewContext(source, { URL, self: { location: { origin: 'https://synthetic.example' },
    addEventListener: (kind, handler) => handlers.set(kind, handler),
    registration: { showNotification: async (title, options) => shown.push({ title, ...options }) } } });
  async function push(payload) {
    let done;
    handlers.get('push')({ data: { json: () => payload }, waitUntil: promise => { done = promise; } });
    await done;
  }
  await push({ kind: 'attendance', title: '꿈이음 · 등원', body: '합성학생이 등원했습니다.', studentId: 'child', route: '/family/?openAttendance=child' });
  await push({ kind: 'attendance', attendanceAction: 'canceled', title: '꿈이음 · 출결 정정 (등원 취소)', body: '출결 정정: 해당 기록은 유효하지 않습니다.', studentId: 'child', route: '/family/?openAttendance=child' });
  assert.equal(shown[1].title, '꿈이음 · 출결 정정 (등원 취소)');
  assert.match(shown[1].body, /유효하지 않습니다/);
  assert.equal(shown[0].tag, shown[1].tag);
  assert.equal(shown[1].renotify, true);
  assert.equal(shown[1].data.route, '/family/?openAttendance=child');
  await push({ noticeId: 'notice', title: 'private notice title', body: privateNote });
  assert.equal(shown[2].body, '꿈이음 새 소식이 도착했습니다.');
});

test('guardian DOM separates corrections from active attendance and staff feedback distinguishes partial failures from no device', async () => {
  const family = await readFile(new URL('../public/family/family.js', import.meta.url), 'utf8');
  const staff = await readFile(new URL('../public/data-core/work/kkumeum-attendance.js', import.meta.url), 'utf8');
  const node = () => ({ children: [], append(...nodes) { this.children.push(...nodes); }, replaceChildren() { this.children = []; } });
  const nodes = Object.fromEntries(['attendanceToday', 'attendanceList', 'attendanceNext', 'attendanceMonthLabel'].map(id => [id, node()]));
  const context = vm.createContext({ Date, Map, document: { createElement: node }, $: id => nodes[id], emptyInline: text => ({ textContent: text }),
    state: { attendance: { month: '2026-10', today: '2026-10-09', events: [{ date: '2026-10-09', label: '등원', status: 'arrive', time: '16:00' }],
      corrections: [{ date: '2026-10-09', label: '등원', status: 'arrive', time: '15:00', canceledAt: '2026-10-09T06:05:00Z' }] } } });
  vm.runInContext(family.slice(family.indexOf('const kstToday ='), family.indexOf('async function loadAttendance')), context);
  vm.runInContext('renderAttendance()', context);
  assert.equal(nodes.attendanceToday.children[0].textContent, '정정 · 등원 15:00 취소');
  assert.equal(nodes.attendanceToday.children[0].className, 'attendance-chip attendance-canceled');
  assert.equal(nodes.attendanceToday.children[1].textContent, '등원 16:00');
  assert.match(nodes.attendanceToday.children[2].textContent, /유효하지 않습니다/);
  assert.equal(nodes.attendanceList.children.length, 1);
  const feedback = vm.runInNewContext(`(${staff.slice(staff.indexOf('function pushFeedback('), staff.indexOf('  async function cancel(')).trim()})`);
  assert.match(feedback({ sent: 1, failed: 1, code: 'provider_error' }, 2, true), /1건 전송 접수.*직접 안내/);
  assert.match(feedback({ sent: 0, failed: 0, code: 'vapid_invalid' }, 1, true), /전송을 완료하지 못/);
  assert.match(feedback({ sent: 0, failed: 0, code: null }, 1, true), /기기가 없어/);
  assert.match(feedback({ sent: 0, failed: 0, code: null }, 0, true), /연결된 보호자가 없어/);
  assert.match(feedback({ sent: 1, failed: 0, code: null }, 1, true), /수신 여부는 보호자 확인/);
});
