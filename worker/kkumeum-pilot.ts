import { DataCoreAccessContext, DataCoreAccessError } from "./data-core-access";

export type KkumeumPilotSettings = {
  pilotCampusId: string | null;
  closedBetaEnabled: boolean;
  internalGuardianBetaEnabled: boolean;
  updatedAt: string | null;
};

type PilotRow = {
  pilot_campus_id: string | null;
  closed_beta_enabled: number;
  internal_guardian_beta_enabled: number;
  updated_at: string | null;
};

export async function ensureKkumeumPilotSchema(familyDb: D1Database): Promise<void> {
  await familyDb.batch([
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS family_pilot_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      pilot_campus_id TEXT,
      closed_beta_enabled INTEGER NOT NULL DEFAULT 0,
      internal_guardian_beta_enabled INTEGER NOT NULL DEFAULT 0,
      updated_by TEXT,
      updated_at TEXT NOT NULL
    )`),
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS family_internal_beta_guardians (
      guardian_id TEXT PRIMARY KEY NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    )`),
  ]);
}

function response(row: PilotRow | null): KkumeumPilotSettings {
  return {
    pilotCampusId: row?.pilot_campus_id || null,
    closedBetaEnabled: Boolean(row?.closed_beta_enabled),
    internalGuardianBetaEnabled: Boolean(row?.internal_guardian_beta_enabled),
    updatedAt: row?.updated_at || null,
  };
}

export async function getKkumeumPilotSettings(familyDb: D1Database): Promise<KkumeumPilotSettings> {
  await ensureKkumeumPilotSchema(familyDb);
  const row = await familyDb.prepare(
    "SELECT pilot_campus_id, closed_beta_enabled, internal_guardian_beta_enabled, updated_at FROM family_pilot_settings WHERE id = 1",
  ).first<PilotRow>();
  return response(row || null);
}

function campusId(value: unknown): string | null {
  const result = String(value || "").trim().slice(0, 120);
  return result || null;
}

export async function updateKkumeumPilotSettings(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  input: Record<string, unknown>,
): Promise<KkumeumPilotSettings> {
  if (!context.isSuperAdmin) throw new DataCoreAccessError(403, "파일럿 캠퍼스 설정은 최고관리자만 변경할 수 있습니다.");
  const selectedCampusId = campusId(input.pilotCampusId);
  const closedBetaEnabled = input.closedBetaEnabled === true;
  const internalGuardianBetaEnabled = input.internalGuardianBetaEnabled === true;
  if ((closedBetaEnabled || internalGuardianBetaEnabled) && !selectedCampusId) {
    throw new DataCoreAccessError(400, "파일럿 또는 내부 보호자 beta를 켜려면 pilotCampusId가 필요합니다.");
  }
  await ensureKkumeumPilotSchema(familyDb);
  const now = new Date().toISOString();
  await familyDb.prepare(`INSERT INTO family_pilot_settings (
    id, pilot_campus_id, closed_beta_enabled, internal_guardian_beta_enabled, updated_by, updated_at
  ) VALUES (1, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    pilot_campus_id = excluded.pilot_campus_id,
    closed_beta_enabled = excluded.closed_beta_enabled,
    internal_guardian_beta_enabled = excluded.internal_guardian_beta_enabled,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at`).bind(
    selectedCampusId, closedBetaEnabled ? 1 : 0, internalGuardianBetaEnabled ? 1 : 0,
    context.user?.internalUserId || null, now,
  ).run();
  return getKkumeumPilotSettings(familyDb);
}

// No setting row means legacy disabled configuration. Once enabled, every campus other than the one explicit pilot is denied.
export async function assertKkumeumPilotCampus(familyDb: D1Database, requestedCampusId: string): Promise<void> {
  const settings = await getKkumeumPilotSettings(familyDb);
  if (!settings.closedBetaEnabled) return;
  if (settings.pilotCampusId !== requestedCampusId) {
    throw new DataCoreAccessError(403, "현재 꿈이음은 선택된 파일럿 캠퍼스에서만 사용할 수 있습니다.");
  }
}

export async function assertInternalGuardianBeta(
  familyDb: D1Database,
  guardianId: string,
): Promise<void> {
  const settings = await getKkumeumPilotSettings(familyDb);
  if (!settings.internalGuardianBetaEnabled) return;
  const allowed = await familyDb.prepare(
    "SELECT guardian_id FROM family_internal_beta_guardians WHERE guardian_id = ? AND enabled = 1",
  ).bind(guardianId).first<{ guardian_id: string }>();
  if (!allowed) throw new DataCoreAccessError(403, "현재 보호자 기능은 내부 closed beta 계정에만 열려 있습니다.");
}

export async function setKkumeumInternalGuardianBeta(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  guardianId: string,
  enabled: boolean,
): Promise<void> {
  if (!context.isSuperAdmin) throw new DataCoreAccessError(403, "내부 보호자 beta 지정은 최고관리자만 변경할 수 있습니다.");
  await ensureKkumeumPilotSchema(familyDb);
  await familyDb.prepare(`INSERT INTO family_internal_beta_guardians (guardian_id, enabled, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(guardian_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`).bind(
    guardianId, enabled ? 1 : 0, new Date().toISOString(),
  ).run();
}
