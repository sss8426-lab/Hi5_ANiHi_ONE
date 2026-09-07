import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireAuthenticatedAccess,
} from "./data-core-access";
import { ensureDataCoreMigrations } from "./data-core-migrations";

type DiagnosticCheck = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  durationMs: number;
};

function requireSuperAdmin(context: DataCoreAccessContext) {
  requireAuthenticatedAccess(context);
  if (!context.isSuperAdmin) {
    throw new DataCoreAccessError(403, "운영환경 진단은 마스터 관리자만 실행할 수 있습니다.");
  }
}

async function timedCheck(
  id: string,
  label: string,
  runner: () => Promise<string>,
): Promise<DiagnosticCheck> {
  const started = Date.now();
  try {
    const detail = await runner();
    return { id, label, ok: true, detail, durationMs: Date.now() - started };
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return { id, label, ok: false, detail: message.slice(0, 300), durationMs: Date.now() - started };
  }
}

export async function runDataCoreDiagnostics(
  db: D1Database,
  files: R2Bucket,
  context: DataCoreAccessContext,
) {
  requireSuperAdmin(context);
  await ensureDataCoreMigrations(db);

  const startedAt = new Date().toISOString();
  const probeId = crypto.randomUUID();
  const probeKey = `data-core/diagnostics/${probeId}.txt`;
  const probeValue = `HI5-ANiHi-DATA-CORE:${probeId}`;
  const checks: DiagnosticCheck[] = [];

  checks.push(
    await timedCheck("auth", "마스터 권한", async () => {
      if (!context.user?.internalUserId) throw new Error("로그인 사용자 식별자를 확인할 수 없습니다.");
      return "SUPER_ADMIN 권한 확인 완료";
    }),
  );

  checks.push(
    await timedCheck("d1-read", "D1 읽기", async () => {
      const row = await db
        .prepare("SELECT COUNT(*) AS count FROM organizations")
        .first<{ count: number }>();
      if (row?.count === undefined || row?.count === null) throw new Error("organizations 조회 결과가 없습니다.");
      return `organizations 조회 성공 (${row.count}행)`;
    }),
  );

  checks.push(
    await timedCheck("d1-write", "D1 쓰기/삭제", async () => {
      await db
        .prepare(
          `CREATE TABLE IF NOT EXISTS data_core_diagnostic_probes (
             id TEXT PRIMARY KEY NOT NULL,
             value TEXT NOT NULL,
             created_at TEXT NOT NULL
           )`,
        )
        .run();

      const createdAt = new Date().toISOString();
      await db
        .prepare("INSERT INTO data_core_diagnostic_probes (id, value, created_at) VALUES (?, ?, ?)")
        .bind(probeId, probeValue, createdAt)
        .run();

      const row = await db
        .prepare("SELECT value FROM data_core_diagnostic_probes WHERE id = ?")
        .bind(probeId)
        .first<{ value: string }>();
      if (row?.value !== probeValue) throw new Error("D1에 쓴 probe 값을 동일하게 읽지 못했습니다.");

      await db
        .prepare("DELETE FROM data_core_diagnostic_probes WHERE id = ?")
        .bind(probeId)
        .run();
      return "임시 probe 생성·조회·삭제 성공";
    }),
  );

  checks.push(
    await timedCheck("r2-write", "R2 쓰기", async () => {
      await files.put(probeKey, probeValue, {
        httpMetadata: { contentType: "text/plain; charset=utf-8" },
        customMetadata: { purpose: "data-core-diagnostic" },
      });
      return "임시 진단 객체 업로드 성공";
    }),
  );

  checks.push(
    await timedCheck("r2-read", "R2 읽기", async () => {
      const object = await files.get(probeKey);
      if (!object) throw new Error("업로드한 진단 객체를 찾지 못했습니다.");
      const text = await new Response(object.body).text();
      if (text !== probeValue) throw new Error("R2에서 읽은 probe 내용이 일치하지 않습니다.");
      return "진단 객체 읽기/내용 검증 성공";
    }),
  );

  checks.push(
    await timedCheck("r2-delete", "R2 삭제", async () => {
      await files.delete(probeKey);
      const object = await files.get(probeKey);
      if (object) throw new Error("진단 객체 삭제 후에도 R2에서 조회됩니다.");
      return "임시 진단 객체 삭제 확인";
    }),
  );

  const failed = checks.filter((check) => !check.ok);
  const completedAt = new Date().toISOString();

  return {
    ok: failed.length === 0,
    startedAt,
    completedAt,
    checks,
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
    },
  };
}
