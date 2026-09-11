import { DEFAULT_ORGANIZATION_ID } from './data-core';
import { DataCoreAccessError, requireAuthenticatedAccess, type DataCoreAccessContext } from './data-core-access';
import { ACTIVE_SESSION_MINUTES, CAMPUS_DIRECTORY, HEARTBEAT_MINUTES } from './campus-directory';

type PresenceRow = { account_id: string; campus_id: string; login_id: string; status: string;
  last_login_at: string | null; last_seen_at: string | null; active_seen_at: string | null };

export async function campusPresence(db: D1Database, context: DataCoreAccessContext, now = new Date()) {
  requireAuthenticatedAccess(context);
  if (!context.isSuperAdmin) throw new DataCoreAccessError(403, '캠퍼스 접속 현황은 마스터 관리자만 볼 수 있습니다.');
  const rows = (await db.prepare(`SELECT a.id AS account_id, m.campus_id, a.login_id,
    CASE WHEN u.status = 'active' AND c.status = 'active' THEN a.status ELSE 'disabled' END AS status,
    a.last_login_at, MAX(s.last_seen_at) AS last_seen_at,
    MAX(CASE WHEN s.revoked_at IS NULL AND s.expires_at > ? AND a.must_change_password = 0 THEN s.last_seen_at END) AS active_seen_at
    FROM auth_accounts a JOIN users u ON u.id = a.user_id
    JOIN memberships m ON m.user_id = u.id AND m.organization_id = ? AND m.role = 'CAMPUS_ADMIN'
    JOIN campuses c ON c.id = m.campus_id
    LEFT JOIN auth_sessions s ON s.user_id = a.user_id
    GROUP BY a.id, m.campus_id`).bind(now.toISOString(), DEFAULT_ORGANIZATION_ID).all<PresenceRow>()).results || [];
  const today = kstDate(now.toISOString());
  const campuses = CAMPUS_DIRECTORY.map(campus => {
    const row = rows.find(r => r.campus_id === campus.id && r.login_id === campus.loginId);
    const activity = Date.parse(row?.active_seen_at || '');
    return { campusId: campus.id, campusCode: campus.code, campusName: campus.name, loginId: campus.loginId,
      accountId: row?.account_id || null, role: 'CAMPUS_ADMIN', status: row?.status || 'not-created',
      lastLoginAt: row?.last_login_at || null, lastSeenAt: row?.last_seen_at || null,
      online: row?.status === 'active' && Number.isFinite(activity) && activity <= now.getTime() && now.getTime() - activity <= ACTIVE_SESSION_MINUTES * 60_000 };
  }).sort((a, b) => Number(b.online) - Number(a.online) ||
    (Date.parse((b.online ? b.lastSeenAt : b.lastLoginAt) || '') || 0) - (Date.parse((a.online ? a.lastSeenAt : a.lastLoginAt) || '') || 0));
  const ids = campuses.map(c => c.accountId).filter((id): id is string => Boolean(id));
  const events = ids.length ? (await db.prepare(`SELECT resource_id AS account_id, created_at AS login_at
    FROM audit_logs WHERE organization_id = ? AND resource_type = 'auth_account' AND action = 'login'
    AND resource_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT 20`)
    .bind(DEFAULT_ORGANIZATION_ID, ...ids).all<{account_id: string; login_at: string}>()).results || [] : [];
  return { serverTime: now.toISOString(), activeSessionMinutes: ACTIVE_SESSION_MINUTES, heartbeatMinutes: HEARTBEAT_MINUTES,
    summary: { total: campuses.length, online: campuses.filter(c => c.online).length,
      today: campuses.filter(c => c.lastLoginAt && kstDate(c.lastLoginAt) === today).length }, campuses,
    recentLogins: events.map(event => ({ campusName: campuses.find(c => c.accountId === event.account_id)!.campusName, loginAt: event.login_at })) };
}

function kstDate(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time + 9 * 60 * 60_000).toISOString().slice(0, 10) : '';
}
