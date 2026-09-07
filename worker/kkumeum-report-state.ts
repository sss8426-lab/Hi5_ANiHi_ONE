import { DataCoreAccessError } from "./data-core-access";

export type KkumeumReportStatus = "draft" | "ready" | "sent";

const REPORT_TRANSITIONS: Record<KkumeumReportStatus, readonly KkumeumReportStatus[]> = {
  draft: ["ready"],
  ready: ["draft", "sent"],
  sent: [],
};

export function requireKkumeumReportEditable(status: KkumeumReportStatus): void {
  if (status === "sent") {
    throw new DataCoreAccessError(
      409,
      "보호자에게 전달된 월간평가는 직접 덮어쓸 수 없습니다. 수정본은 revision으로 남겨야 합니다.",
    );
  }
}

export function requireKkumeumReportTransition(
  from: KkumeumReportStatus,
  to: KkumeumReportStatus,
): void {
  if (from === to) return;
  if (!REPORT_TRANSITIONS[from].includes(to)) {
    if (from === "sent") {
      throw new DataCoreAccessError(
        409,
        "전달 완료된 월간평가는 상태를 되돌리지 않습니다. 수정 시 revision을 생성하세요.",
      );
    }
    throw new DataCoreAccessError(400, `허용되지 않은 월간평가 상태 변경입니다: ${from} → ${to}`);
  }
}

export function kkumeumReportNeedsRevision(status: KkumeumReportStatus): boolean {
  return status === "sent";
}
