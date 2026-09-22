import { DEFAULT_ORGANIZATION_ID as ORG } from './data-core';
import { DataCoreAccessContext, DataCoreAccessError, requireWriteAccess } from './data-core-access';

export type R2UsageEnv = { CLOUDFLARE_USAGE_API_TOKEN?: string; CLOUDFLARE_USAGE_ACCOUNT_ID?: string; CORE_R2_USAGE_BUCKETS?: string };
type Kind = 'storage' | 'billing';
type Snapshot = { state: string; data: any; updatedAt: string | null; attemptedAt: string; reason?: string };
const TYPE = 'library-r2-usage', VERSION = '2026-09-22-v1', TTL = 15 * 60_000, LEASE = 45_000;
const API = 'https://api.cloudflare.com/client/v4';
const pending = new WeakMap<D1Database, Map<string, Promise<Snapshot>>>();
const validTime = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const nonnegative = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export function usageScope(env: R2UsageEnv) {
  const account = env.CLOUDFLARE_USAGE_ACCOUNT_ID?.trim() || '';
  const buckets = [...new Set((env.CORE_R2_USAGE_BUCKETS || '').split(',').map(s => s.trim()).filter(Boolean))].sort();
  return { account, buckets, valid: /^[a-f0-9]{32}$/.test(account) && buckets.length > 0 && buckets.length <= 10 && buckets.every(b => /^[a-z0-9][a-z0-9_-]{1,100}$/.test(b)) };
}

// Latest snapshot per physical bucket, never a sum across hours. Metadata is reported separately.
export function storageSummary(buckets: string[], rows: Record<string, any[]>, now = Date.now()) {
  const snapshots = [...new Set(buckets)].map(bucket => {
    const row = (rows[bucket] || []).filter(r => validTime(r.dimensions?.datetime) && Date.parse(r.dimensions.datetime) <= now && nonnegative(r.max?.payloadSize) && nonnegative(r.max?.metadataSize))
      .sort((a, b) => Date.parse(b.dimensions.datetime) - Date.parse(a.dimensions.datetime))[0];
    return row ? { bucket, bytes: row.max.payloadSize, metadataBytes: row.max.metadataSize, asOf: row.dimensions.datetime, delayed: now - Date.parse(row.dimensions.datetime) > 86_400_000 } : { bucket, bytes: null, metadataBytes: null, asOf: null, delayed: false };
  });
  const available = snapshots.filter(s => s.bytes !== null), complete = available.length === snapshots.length;
  const knownBytes = available.reduce((sum, s) => sum + s.bytes!, 0);
  return { bytes: complete ? knownBytes : null, knownBytes: available.length ? knownBytes : null, gb: complete ? knownBytes / 1e9 : null,
    gib: complete ? knownBytes / 2 ** 30 : null, complete, buckets: snapshots, source: 'Cloudflare GraphQL r2StorageAdaptiveGroups', unit: 'bytes', storageMeasure: 'payloadSize', scope: 'CORE 연결 R2 저장량' };
}

// v1 returns daily ContractedCost and also cumulative columns. Only daily costs are summed.
export function billingSummary(rows: any[], info: any, account: string) {
  if (!Array.isArray(rows) || !Array.isArray(info?.subscriptions)) throw new Error('invalid_response');
  const seen = new Set<string>(), identities = new Map<string, string>(), groups = new Map<string, any>();
  for (const row of rows) {
    if (row.ServiceFamilyName !== 'R2') continue;
    if (row.BillingAccountId !== account || typeof row.ContractedCost !== 'number' || !Number.isFinite(row.ContractedCost) || !/^[A-Z]{3}$/.test(row.BillingCurrency) ||
      !validTime(row.BillingPeriodStart) || !validTime(row.ChargePeriodStart) || !validTime(row.ChargePeriodEnd) || row.ChargeCategory !== 'Usage' || typeof row.ServiceName !== 'string') throw new Error('invalid_response');
    const subscription = info.subscriptions.find((s: any) => s.id === row.SubscriptionId);
    if (!subscription || !validTime(subscription.billing_cycle_anchor_timestamp)) throw new Error('subscription_unverified');
    // Exact repeats are idempotent; distinct correction/cost/zone rows remain distinct.
    const signature = JSON.stringify(Object.keys(row).sort().map(k => [k, row[k]]));
    if (seen.has(signature)) continue;
    seen.add(signature);
    const identity = JSON.stringify([row.SubscriptionId,row.BillingPeriodStart,row.BillingCurrency,row.ServiceName,row.ChargePeriodStart,row.ChargePeriodEnd,row.ChargeCategory,row.ChargeClass,row.ChargeDescription,row.ZoneId]);
    const daily = JSON.stringify(Object.keys(row).filter(k=>!k.startsWith('Cumulated')).sort().map(k=>[k,row[k]]));
    if(identities.has(identity)){if(identities.get(identity)!==daily)throw new Error('conflicting_rows');continue;}
    identities.set(identity,daily);
    const key = JSON.stringify([row.SubscriptionId, row.BillingPeriodStart, row.BillingCurrency]);
    let group = groups.get(key);
    if (!group) groups.set(key, group = { subscriptionId: row.SubscriptionId, periodStart: row.BillingPeriodStart, periodEnd: null,
      billingAnchor: subscription.billing_cycle_anchor_timestamp, currency: row.BillingCurrency, cost: 0, through: row.ChargePeriodEnd, items: [] });
    group.cost += row.ContractedCost;
    if (Date.parse(row.ChargePeriodEnd) > Date.parse(group.through)) group.through = row.ChargePeriodEnd;
    group.items.push({ service: row.ServiceName, cost: row.ContractedCost, chargeStart: row.ChargePeriodStart, chargeEnd: row.ChargePeriodEnd, correction: row.ChargeClass ?? null });
  }
  const periods = [...groups.values()];
  const currencies = [...new Set(periods.map(p => p.currency))];
  return { cost: periods.length && currencies.length === 1 ? periods.reduce((s, p) => s + p.cost, 0) : null,
    currency: currencies.length === 1 ? currencies[0] : null, periods, source: 'Cloudflare Billable Usage v1', scope: 'Cloudflare 계정 전체 R2 비용',
    label: '이번 청구기간 R2 비용 · Cloudflare 집계', estimate: false, finalInvoice: false, periodEndStatus: 'provider_not_supplied' };
}

async function providerJson(token: string, path: string, body?: unknown) {
  const response = await fetch(API + path, { method: body ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(12_000),
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) { await response.body?.cancel(); throw new Error([401, 403].includes(response.status) ? 'permission_denied' : response.status === 429 ? 'rate_limited' : 'unavailable'); }
  const reader = response.body!.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('response_too_large'); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (value.success === false || value.errors?.length) throw new Error('provider_error');
  return value;
}

async function collect(kind: Kind, env: R2UsageEnv, scope: ReturnType<typeof usageScope>) {
  const token = env.CLOUDFLARE_USAGE_API_TOKEN!;
  if (kind === 'billing') {
    const info = await providerJson(token, `/accounts/${scope.account}/billable-usage/info`);
    if (info.result?.covered !== true) return { state: 'no_data', data: null, reason: 'account_not_supported' };
    // Omitting dates requests the provider's current subscription periods, not a guessed calendar month.
    const result = await providerJson(token, `/accounts/${scope.account}/billable-usage`);
    const data = billingSummary(result.result, info.result, scope.account);
    return { state: data.periods.length ? 'current' : 'no_data', data, reason: data.periods.length ? undefined : 'no_r2_rows' };
  }
  const now = Date.now(), rows: Record<string, any[]> = {};
  const variables: Record<string, string> = { account: scope.account, start: new Date(now - 7 * 86_400_000).toISOString(), end: new Date(now).toISOString() };
  scope.buckets.forEach((b, i) => { variables['b' + i] = b; });
  const query = `query($account:string!,$start:Time,$end:Time,${scope.buckets.map((_, i) => `$b${i}:string`).join(',')}){viewer{accounts(filter:{accountTag:$account}){${scope.buckets.map((_, i) => `b${i}:r2StorageAdaptiveGroups(limit:24,filter:{datetime_geq:$start,datetime_leq:$end,bucketName:$b${i}},orderBy:[datetime_DESC]){max{payloadSize metadataSize}dimensions{datetime}}`).join(' ')}}}}`;
  const result = await providerJson(token, '/graphql', { query, variables });
  const accounts = result.data?.viewer?.accounts;
  if (!Array.isArray(accounts) || accounts.length !== 1) throw new Error('invalid_response');
  scope.buckets.forEach((b, i) => { if (!Array.isArray(accounts[0]['b' + i])) throw new Error('invalid_response'); rows[b] = accounts[0]['b' + i]; });
  const data = storageSummary(scope.buckets, rows, now);
  return { state: data.complete ? 'current' : data.knownBytes === null ? 'no_data' : 'partial', data };
}

async function read(db: D1Database, id: string): Promise<any> {
  const row = await db.prepare('SELECT metadata_json FROM data_records WHERE id=? AND organization_id=? AND record_type=? AND deleted_at IS NULL').bind(id, ORG, TYPE).first<{ metadata_json: string }>();
  try {
    const value = row ? JSON.parse(row.metadata_json) : null;
    if(value?.snapshotId){const stored=await db.prepare('SELECT metadata_json FROM data_records WHERE id=? AND organization_id=? AND record_type=? AND deleted_at IS NULL').bind(value.snapshotId,ORG,TYPE).first<{metadata_json:string}>();value.snapshot=stored?JSON.parse(stored.metadata_json).snapshot:null;}
    return value;
  } catch { return null; }
}
async function cached(db: D1Database, context: DataCoreAccessContext, env: R2UsageEnv, kind: Kind, scope: ReturnType<typeof usageScope>, id: string): Promise<Snapshot> {
  const now = Date.now(), prior = await read(db, id);
  if (prior?.snapshot && now - Date.parse(prior.snapshot.attemptedAt) < TTL) return prior.snapshot;
  const owner = crypto.randomUUID(), stamp = new Date(now).toISOString();
  // D1 atomic compare-and-swap coalesces different Worker isolates as well as users.
  const lease = await db.prepare(`INSERT INTO data_records(id,organization_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at)
    VALUES(?,?,?,?,'data-core','R2 usage cache','private','active',?,?,?) ON CONFLICT(id) DO UPDATE SET
    metadata_json=json_set(data_records.metadata_json,'$.leaseUntil',?,'$.owner',?),updated_at=excluded.updated_at
    WHERE data_records.record_type=? AND data_records.organization_id=? AND COALESCE(json_extract(data_records.metadata_json,'$.leaseUntil'),0)<?
    AND COALESCE(json_extract(data_records.metadata_json,'$.nextAttempt'),0)<?`)
    .bind(id, ORG, context.user!.internalUserId, TYPE, JSON.stringify({ leaseUntil: now + LEASE, owner }), stamp, stamp, now + LEASE, owner, TYPE, ORG, now, now).run();
  if (!lease.meta?.changes) { const latest = await read(db, id); return latest?.snapshot ? { ...latest.snapshot, state: 'stale' } : { state: 'loading', data: null, updatedAt: null, attemptedAt: stamp }; }
  let snapshot: Snapshot;
  try { const value = await collect(kind, env, scope); snapshot = { ...value, attemptedAt: stamp, updatedAt: stamp }; }
  catch (e) {
    const reason = e instanceof Error && ['permission_denied', 'rate_limited', 'subscription_unverified'].includes(e.message) ? e.message : 'unavailable';
    snapshot = { state: prior?.snapshot?.data ? 'stale' : reason === 'permission_denied' ? reason : 'failed', data: prior?.snapshot?.data ?? null, updatedAt: prior?.snapshot?.updatedAt ?? null, attemptedAt: stamp, reason };
  }
  const periodKey = kind === 'billing' ? JSON.stringify(snapshot.data?.periods?.map((p: any) => [p.subscriptionId, p.periodStart, p.currency]) || []) : 'latest';
  const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(periodKey))).toString('hex');
  const snapshotId=`${id}:period:${digest}`;
  await db.prepare(`INSERT INTO data_records(id,organization_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at)
    VALUES(?,?,?,?,'data-core','R2 usage snapshot','private','active',?,?,?) ON CONFLICT(id) DO UPDATE SET metadata_json=excluded.metadata_json,updated_at=excluded.updated_at
    WHERE data_records.organization_id=excluded.organization_id AND data_records.record_type=excluded.record_type`)
    .bind(snapshotId,ORG,context.user!.internalUserId,TYPE,JSON.stringify({snapshot,periodKey}),stamp,stamp).run();
  await db.prepare(`UPDATE data_records SET metadata_json=?,updated_at=? WHERE id=? AND organization_id=? AND record_type=? AND json_extract(metadata_json,'$.owner')=?`)
    .bind(JSON.stringify({ snapshotId, periodKey, nextAttempt: now + TTL, leaseUntil: 0 }), stamp, id, ORG, TYPE, owner).run();
  return snapshot;
}

export async function r2Usage(db: D1Database, context: DataCoreAccessContext, env: R2UsageEnv, kind: Kind) {
  requireWriteAccess(context);
  if (!context.isSuperAdmin) throw new DataCoreAccessError(403, 'R2 사용량과 비용은 마스터만 확인할 수 있습니다.');
  const scope = usageScope(env), now = new Date();
  const common = { kind, ttlSeconds: TTL / 1000, aggregationVersion: VERSION, checkedDocumentationAt: '2026-09-22',
    scope: kind === 'storage' ? 'CORE 연결 R2 저장량' : 'Cloudflare 계정 전체 R2 비용',
    dashboardUrl: scope.valid ? `https://dash.cloudflare.com/${scope.account}/${kind === 'storage' ? 'r2/overview' : 'billing'}` : null };
  if (!scope.valid || !env.CLOUDFLARE_USAGE_API_TOKEN) return { ...common, state: 'setup_required', data: null, updatedAt: null, attemptedAt: now.toISOString(),
    missing: [...(!scope.valid ? ['CLOUDFLARE_USAGE_ACCOUNT_ID / CORE_R2_USAGE_BUCKETS'] : []), ...(!env.CLOUDFLARE_USAGE_API_TOKEN ? ['CLOUDFLARE_USAGE_API_TOKEN'] : [])] };
  // A stable locator preserves last-good data across midnight; immutable scope/period keys hold the snapshots.
  const id = `r2-usage:${VERSION}:${ORG}:${scope.account}:${scope.buckets.join(',')}:${kind}:current`;
  let map = pending.get(db); if (!map) pending.set(db, map = new Map());
  if (!map.has(id)) map.set(id, cached(db, context, env, kind, scope, id).finally(() => map!.delete(id)));
  return { ...common, ...await map.get(id)! };
}
