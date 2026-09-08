import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('보호자 인증은 FAMILY_DB 계약 테이블과 별도 세션 쿠키를 사용한다', async () => {
  const source = await read('worker/kkumeum-guardian-auth.ts');
  for (const table of ['family_guardians', 'guardian_sessions', 'student_guardians']) {
    assert.match(source, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(source, /KKUMEUM_GUARDIAN_COOKIE_NAME = "kkumeum_family_session"/);
  assert.match(source, /Secure; HttpOnly; SameSite=Lax/);
  assert.match(source, /ensureKkumeumPhase1Schema\(familyDb\)/);
  assert.doesNotMatch(source, /\benv\.DB\b/);
  assert.doesNotMatch(source, /\benv\.FILES\b/);
  assert.doesNotMatch(source, /data_core_session/);
});

test('보호자 비밀번호와 세션은 PBKDF2/해시 저장 경계를 지킨다', async () => {
  const source = await read('worker/kkumeum-guardian-auth.ts');
  assert.match(source, /const PASSWORD_ITERATIONS = 100_000/);
  assert.match(source, /const MAX_PASSWORD_ITERATIONS = 100_000/);
  assert.match(source, /name: "PBKDF2", hash: "SHA-256"/);
  assert.match(source, /crypto\.getRandomValues\(new Uint8Array\(16\)\)/);
  assert.match(source, /crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
  assert.match(source, /token_hash TEXT NOT NULL UNIQUE/);
  assert.match(source, /await sha256\(rawToken\)/);
  assert.match(source, /INSERT INTO guardian_sessions/);
  assert.doesNotMatch(source, /token_hash[^\n]*rawToken/);
});

test('보호자 로그인은 잠금·비활성·세션 revoke를 구현하고 공개 signup을 만들지 않는다', async () => {
  const source = await read('worker/kkumeum-guardian-auth.ts');
  assert.match(source, /const MAX_FAILED_LOGINS = 5/);
  assert.match(source, /const LOCK_MINUTES = 15/);
  assert.match(source, /guardian\.status !== "active"/);
  assert.match(source, /failed_login_count = \?, locked_until = \?/);
  assert.match(source, /UPDATE guardian_sessions SET revoked_at = \?/);
  assert.match(source, /assertSameOrigin\(request\)/);
  assert.doesNotMatch(source, /signup/i);
  assert.doesNotMatch(source, /registerGuardian/i);
});

test('보호자 session identity는 인증정보만 반환하고 비밀번호·토큰 해시를 노출하지 않는다', async () => {
  const source = await read('worker/kkumeum-guardian-auth.ts');
  assert.match(source, /export type KkumeumGuardianIdentity/);
  assert.match(source, /guardianId: string/);
  assert.match(source, /displayName: string/);
  const identityBlock = source.match(/export async function kkumeumGuardianSessionIdentity[\s\S]*?\r?\n}\r?\n\r?\nexport async function loginKkumeumGuardian/)?.[0] || '';
  assert.ok(identityBlock);
  assert.doesNotMatch(identityBlock, /password_hash/);
  assert.doesNotMatch(identityBlock, /token_hash:/);
});
