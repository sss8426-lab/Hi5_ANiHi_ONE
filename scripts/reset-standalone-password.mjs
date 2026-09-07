import { execFile } from 'node:child_process';
import { pbkdf2 as pbkdf2Callback, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
  const directory = await mkdtemp(join(tmpdir(), 'hi5-data-core-auth-reset-'));
  const file = join(directory, 'reset-password.sql');
  try {
    // The temporary file contains only the derived hash and salt.
    await writeFile(file, contents, { mode: 0o600 });
    await run(['--file', file]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

try {
  const loginId = String(process.env.DATA_CORE_RESET_LOGIN_ID || '').trim().toLowerCase();
  const password = String(process.env.DATA_CORE_RESET_PASSWORD || '');
  delete process.env.DATA_CORE_RESET_LOGIN_ID;
  delete process.env.DATA_CORE_RESET_PASSWORD;
  if (!loginId || password.length < 12) throw new Error('로그인 ID와 12자 이상의 새 비밀번호가 필요합니다.');

  const result = JSON.parse(await run(['--command', `SELECT id, user_id FROM auth_accounts WHERE login_id = ${sql(loginId)} LIMIT 1;`, '--json']));
  const account = result?.[0]?.results?.[0];
  if (!account) throw new Error('standalone 로그인 계정을 찾지 못했습니다.');

  const salt = randomBytes(16).toString('base64');
  const hash = (await pbkdf2(password, Buffer.from(salt, 'base64'), iterations, 32, 'sha256')).toString('base64');
  const now = new Date().toISOString();
  await runSqlFile(`UPDATE auth_accounts SET password_hash = ${sql(hash)}, password_salt = ${sql(salt)}, password_iterations = ${iterations}, must_change_password = 1, failed_login_count = 0, locked_until = NULL, updated_at = ${sql(now)} WHERE id = ${sql(account.id)}; UPDATE auth_sessions SET revoked_at = ${sql(now)} WHERE user_id = ${sql(account.user_id)} AND revoked_at IS NULL;`);
  console.log('비밀번호가 재설정되었습니다. 첫 로그인 후 새 비밀번호 변경이 필요합니다.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
