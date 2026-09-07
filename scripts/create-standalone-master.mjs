import { execFile } from 'node:child_process';
import { randomBytes, pbkdf2 as pbkdf2Callback, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';

const pbkdf2 = promisify(pbkdf2Callback);
const iterations = 100_000;
const run = (args) => new Promise((resolve, reject) => {
  const windowsNpxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  const command = process.platform === 'win32' ? process.execPath : 'npx';
  const commandArgs = process.platform === 'win32'
    ? [windowsNpxCli, 'wrangler', 'd1', 'execute', 'DB', '--config', 'dist/server/wrangler.json', '--remote', '--yes', ...args]
    : ['wrangler', 'd1', 'execute', 'DB', '--config', 'dist/server/wrangler.json', '--remote', '--yes', ...args];
  execFile(command, commandArgs, { windowsHide: true }, (error, stdout, stderr) => {
    if (error) reject(new Error(stderr || 'D1 실행에 실패했습니다. Wrangler 로그인을 확인하세요.'));
    else resolve(stdout);
  });
});
const sql = (value) => `'${String(value).replace(/'/g, "''")}'`;

async function runSqlFile(contents) {
  const directory = await mkdtemp(join(tmpdir(), 'hi5-data-core-auth-'));
  const file = join(directory, 'bootstrap.sql');
  try {
    // The file contains only IDs and derived hashes, never the raw password.
    await writeFile(file, contents, { mode: 0o600 });
    await run(['--file', file]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const prompt = createInterface({ input: process.stdin, output: process.stdout });
const hiddenQuestion = (message) => {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('보안을 위해 Windows에서는 npm run auth:create-master:windows 명령을 사용하세요.');
  }
  process.stdout.write(message);
  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (chunk) => {
      const key = String(chunk);
      if (key === '\r' || key === '\n') {
        cleanup();
        process.stdout.write('\n');
        resolve(value);
      } else if (key === '\u0003') {
        cleanup();
        reject(new Error('입력이 취소되었습니다.'));
      } else if (key === '\b' || key === '\u007f') {
        value = value.slice(0, -1);
      } else if (!key.startsWith('\u001b')) {
        value += key;
      }
    };
    const cleanup = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
};
try {
  const loginId = (process.env.DATA_CORE_BOOTSTRAP_LOGIN_ID || await prompt.question('마스터 로그인 ID: ')).trim().toLowerCase();
  const password = process.env.DATA_CORE_BOOTSTRAP_PASSWORD || await hiddenQuestion('마스터 비밀번호(12자 이상): ');
  delete process.env.DATA_CORE_BOOTSTRAP_LOGIN_ID;
  delete process.env.DATA_CORE_BOOTSTRAP_PASSWORD;
  if (!loginId || password.length < 12) throw new Error('로그인 ID와 12자 이상의 비밀번호가 필요합니다.');
  await run(['--command', `CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY NOT NULL, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS campuses (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (organization_id, code)); CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY NOT NULL, email TEXT, display_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', auth_subject TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS memberships (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, campus_id TEXT, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS auth_accounts (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL UNIQUE, login_id TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, password_iterations INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active', must_change_password INTEGER NOT NULL DEFAULT 1, failed_login_count INTEGER NOT NULL DEFAULT 0, locked_until TEXT, last_login_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS auth_sessions (id TEXT PRIMARY KEY NOT NULL, token_hash TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, last_seen_at TEXT NOT NULL);`]);
  const existing = JSON.parse(await run(['--command', "SELECT count(*) AS count FROM auth_accounts a INNER JOIN memberships m ON m.user_id = a.user_id WHERE m.role = 'SUPER_ADMIN';", '--json']));
  if (Number(existing?.[0]?.results?.[0]?.count || 0) > 0) throw new Error('standalone 마스터 계정이 이미 있습니다. 새 마스터를 만들지 않았습니다.');
  const salt = randomBytes(16).toString('base64');
  const hash = (await pbkdf2(password, Buffer.from(salt, 'base64'), iterations, 32, 'sha256')).toString('base64');
  const now = new Date().toISOString();
  const userId = `local:${randomUUID()}`;
  const accountId = randomUUID();
  const membershipId = randomUUID();
  const statements = `INSERT OR IGNORE INTO organizations (id, slug, name, status, created_at, updated_at) VALUES ('org-hi5-anihi', 'hi5-anihi', 'HI5·ANiHi', 'active', ${sql(now)}, ${sql(now)}); INSERT INTO users (id, email, display_name, status, created_at, updated_at) VALUES (${sql(userId)}, NULL, ${sql(loginId)}, 'active', ${sql(now)}, ${sql(now)}); INSERT INTO auth_accounts (id, user_id, login_id, password_hash, password_salt, password_iterations, status, must_change_password, failed_login_count, created_at, updated_at) VALUES (${sql(accountId)}, ${sql(userId)}, ${sql(loginId)}, ${sql(hash)}, ${sql(salt)}, ${iterations}, 'active', 1, 0, ${sql(now)}, ${sql(now)}); INSERT INTO memberships (id, organization_id, campus_id, user_id, role, created_at, updated_at) VALUES (${sql(membershipId)}, 'org-hi5-anihi', NULL, ${sql(userId)}, 'SUPER_ADMIN', ${sql(now)}, ${sql(now)});`;
  await runSqlFile(statements);
  console.log('마스터 계정이 생성되었습니다. 비밀번호는 저장하거나 출력하지 않았습니다.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  prompt.close();
}
