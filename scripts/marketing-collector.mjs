import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKETING_BASE_URL = 'https://hi5-anihi-one.sss8426.workers.dev';
const entropy = 'HI5.ANiHi marketing ingestion v1';

function runCaptured(executable, args, input, options = {}) {
  return new Promise((done, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], ...options });
    const output = [];
    child.stdout.on('data', chunk => output.push(chunk));
    // Deliberately discard raw stderr: credential-related commands must not leak it.
    child.stderr.on('data', () => {});
    child.once('error', () => reject(new Error('수집기 보안 명령을 실행하지 못했습니다.')));
    child.once('close', code => code === 0 ? done(Buffer.concat(output).toString('utf8').trim()) : reject(new Error('수집기 보안 명령이 실패했습니다. 자격증명 원문은 출력하지 않았습니다.')));
    child.stdin.end(input);
  });
}

async function dpapi(input, protect) {
  if (process.platform !== 'win32') throw new Error('DPAPI 자격증명은 Windows 사용자 계정에서만 사용할 수 있습니다. 다른 환경은 MARKETING_INGEST_TOKEN 환경변수를 사용하세요.');
  const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const command = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $data=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $entropy=[Text.Encoding]::UTF8.GetBytes('${entropy}'); $result=[Security.Cryptography.ProtectedData]::${protect ? 'Protect' : 'Unprotect'}($data,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result));`;
  return Buffer.from(await runCaptured(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], Buffer.from(input).toString('base64')), 'base64');
}

export async function readCollectorToken(filePath) {
  if (process.env.MARKETING_INGEST_TOKEN) return process.env.MARKETING_INGEST_TOKEN;
  if (!filePath) throw new Error('암호화된 수집기 인증 경로가 필요합니다.');
  const protectedToken = await readFile(filePath);
  if (protectedToken.length > 8192) throw new Error('수집기 인증 파일 형식을 확인하세요.');
  return (await dpapi(protectedToken, false)).toString('utf8');
}

export async function configureCollector({ tokenFile, wranglerPath, configPath, cwd }) {
  // Reuse the protected local credential on retries. Never rotate it implicitly.
  let existing;
  try { existing = await readFile(tokenFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing && existing.length > 8192) throw new Error('수집기 인증 파일 형식을 확인하세요.');
  const token = existing ? (await dpapi(existing, false)).toString('utf8') : `mm_${randomBytes(48).toString('hex')}`;
  if (!/^mm_[a-f0-9]{96}$/.test(token)) throw new Error('수집기 인증 파일 형식을 확인하세요.');
  // Persist encrypted bytes first so an ambiguous upload failure remains retryable.
  if (!existing) {
    await mkdir(dirname(tokenFile), { recursive: true });
    await writeFile(tokenFile, await dpapi(Buffer.from(token, 'utf8'), true), { flag: 'wx', mode: 0o600 });
    await chmod(tokenFile, 0o600).catch(() => {});
  }
  // No credentials are placed in argv, JSON metadata, logs, browser storage or Git.
  const args = [wranglerPath, 'secret', 'put', 'MARKETING_INGEST_TOKEN'];
  if (configPath) args.push('--config', configPath);
  await runCaptured(process.execPath, args, token + '\n', { cwd, env: { ...process.env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false' } });
  return { configured: true, tokenFile, reusedCredential: Boolean(existing), credentialProtection: 'Windows DPAPI CurrentUser' };
}

export function parseCollectorArgs(args) {
  const result = { command: args[0], images: [] };
  for (let i = 1; i < args.length; i++) {
    const value = args[++i];
    if (!value) throw new Error('명령 인자가 누락되었습니다.');
    const key = args[i - 1];
    if (key === '--image') result.images.push(resolve(value));
    else if (key === '--payload') result.payloadPath = resolve(value);
    else if (key === '--token-file') result.tokenFile = resolve(value);
    else if (key === '--result') result.resultFile = resolve(value);
    else if (key === '--config') result.configPath = resolve(value);
    else throw new Error('지원하지 않는 수집기 인자입니다.');
  }
  return result;
}

export async function ingestMarketingReport({ payloadPath, images = [], tokenFile, request = fetch, pause = ms => new Promise(done => setTimeout(done, ms)) }) {
  const payloadText = await readFile(payloadPath, 'utf8');
  const payload = JSON.parse(payloadText);
  if (payload.version !== 1 || !payload.runId || !payload.campusId || !payload.reportDate) throw new Error('version/runId/campusId/reportDate가 있는 보고서 JSON이 필요합니다.');
  if (Buffer.byteLength(payloadText) > 200_000 || images.length > 4) throw new Error('보고서 크기 제한을 확인하세요.');
  const token = await readCollectorToken(tokenFile);
  if (!token || token.length < 32) throw new Error('수집기 인증 구성이 올바르지 않습니다.');
  const files = [];
  for (const file of images) {
    const bytes = await readFile(file);
    if (bytes.length > 10 * 1024 * 1024 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('원본 PNG 이미지(각 10MB 이하)만 전송할 수 있습니다.');
    files.push({ bytes, name: file.split(/[\\/]/).pop() });
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const body = new FormData();
    body.set('payload', payloadText);
    for (const file of files) body.append('images', new Blob([file.bytes], { type: 'image/png' }), file.name);
    let response;
    try {
      response = await request(MARKETING_BASE_URL + '/api/data-core/marketing/ingest', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body, signal: AbortSignal.timeout(120_000), redirect: 'error' });
    } catch {
      if (attempt === 2) throw new Error('DATA CORE 연결 실패. 보고서 원본을 보존하고 재시도하세요.');
      await pause(1500 * 2 ** attempt);
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      if (attempt === 2) throw new Error(`DATA CORE 일시 오류 (${response.status}). 같은 runId로 재시도하세요.`);
      await pause(1500 * 2 ** attempt);
      continue;
    }
    if (!response.ok) throw new Error(`DATA CORE 보고서 저장이 거절되었습니다 (${response.status}). 인증·스키마·runId 충돌을 확인하세요. 원문은 출력하지 않았습니다.`);
    const data = await response.json();
    const report = data.report;
    if (!report?.id || report.campusId !== payload.campusId || report.reportDate !== payload.reportDate || report.runId !== payload.runId || report.runKind !== payload.runKind) throw new Error('서버가 저장된 보고서의 ID/캠퍼스/날짜/실행을 확인하지 못했습니다.');
    if (!Array.isArray(report.imageFiles) || report.imageFiles.length !== files.length || report.imageFiles.some(file => !file.id || !file.url?.startsWith('/api/data-core/files/'))) throw new Error('서버가 원본 PNG 수와 인증된 파일 연결을 확인하지 못했습니다.');
    return { ok: true, reportId: report.id, campusId: report.campusId, reportDate: report.reportDate, runKind: report.runKind, status: report.status, imageCount: report.imageFiles?.length || 0, deduplicated: Boolean(data.existing || data.deduplicated), confirmedAt: new Date().toISOString() };
  }
  throw new Error('보고서 저장 확인이 필요합니다.');
}

async function main() {
  const args = parseCollectorArgs(process.argv.slice(2));
  if (args.command === 'configure') {
    if (!args.tokenFile) throw new Error('--token-file이 필요합니다.');
    const result = await configureCollector({ ...args, cwd: process.cwd(), wranglerPath: resolve('node_modules/wrangler/bin/wrangler.js') });
    console.log(JSON.stringify({ configured: result.configured, credentialProtection: result.credentialProtection }));
  } else if (args.command === 'ingest') {
    const result = await ingestMarketingReport(args);
    if (args.resultFile) { await mkdir(dirname(args.resultFile), { recursive: true }); await writeFile(args.resultFile, JSON.stringify(result, null, 2)); }
    console.log(JSON.stringify(result));
  } else throw new Error('configure 또는 ingest 명령을 선택하세요.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
