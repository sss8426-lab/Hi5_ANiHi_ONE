import { DEFAULT_ORGANIZATION_ID } from "./data-core";
import { canReadRegisteredFile } from './data-core-derivative-policy';
import { AI_PHOTO_LIMIT } from './content-ai-images';
import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireCampusAccess,
  requireWriteAccess,
} from "./data-core-access";

export type ContentGenerationSourceApp = "blog" | "instagram";

export type ContentGenerationInput = {
  sourceApp?: ContentGenerationSourceApp;
  campusId?: string | null;
  contentPurpose?: string | null;
  notes?: string | null;
  coreMessage?: string | null;
  selectedFileIds?: string[];
  brandContext?: string | null;
  requestId?: string;
};

export type ContentGenerationOutput = {
  title: string;
  summary: string;
  content: string;
  keywords: string[];
  callToAction: string;
  body?: string;
  hashtags?: string[];
  cta?: string;
};

export type ContentGenerationProviderRequest = {
  sourceApp: ContentGenerationSourceApp;
  campusId: string | null;
  contentPurpose: string;
  notes: string;
  coreMessage: string;
  brandContext: typeof HI5_CONTENT_BRAND_CONTEXT;
  selectedFiles: Array<{
    id: string;
    category: string;
    sourceApp: string;
    fileName: string;
    mimeType: string;
  }>;
};

export type ContentGenerationProvider = {
  generate(input: ContentGenerationProviderRequest): Promise<ContentGenerationOutput>;
};

export type ContentGenerationResult =
  | {
      available: false;
      code: "provider_not_configured";
      message: string;
    }
  | {
      available: true;
      generated: ContentGenerationOutput;
    };

const CONTENT_SOURCE_APPS = new Set(["blog", "instagram"]);

export const HI5_CONTENT_BRAND_CONTEXT = Object.freeze({
  brand: "HI5·ANiHi",
  language: "ko-KR",
  principles: [
    "교육철학 → 전문성 → 증거 → 차별화 → 신뢰 → 상담 흐름을 우선한다.",
    "학생의 성장을 과장하지 않고 실제 수업과 작품 근거를 중심으로 쓴다.",
    "확인되지 않은 입시 수치나 합격 정보를 만들지 않는다.",
    "상담 유도 문구는 자연스럽고 명확하게 쓴다.",
  ],
  instagram: {
    width: 2160,
    height: 2700,
    aspectRatio: "4:5",
  },
});

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeSourceApp(value: unknown): ContentGenerationSourceApp {
  const sourceApp = cleanText(value, 40);
  if (CONTENT_SOURCE_APPS.has(sourceApp)) return sourceApp as ContentGenerationSourceApp;
  throw new DataCoreAccessError(400, "sourceApp은 blog 또는 instagram이어야 합니다.");
}

function normalizeFileIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = Array.from(
    new Set(value.map((item) => cleanText(item, 120)).filter(Boolean)),
  );
  if (ids.length > AI_PHOTO_LIMIT) throw new DataCoreAccessError(400, 'AI가 분석할 사진을 조금 줄여주세요.');
  return ids;
}

async function selectedFileDescriptors(
  db: D1Database,
  context: DataCoreAccessContext,
  campusId: string | null,
  selectedFileIds: string[],
) {
  if (!selectedFileIds.length) return [];
  const placeholders = selectedFileIds.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT *
       FROM file_objects
       WHERE organization_id = ? AND id IN (${placeholders})`,
    )
    .bind(DEFAULT_ORGANIZATION_ID, ...selectedFileIds)
    .all<Record<string, unknown>>();
  const rows = result.results || [];
  const rowMap = new Map(rows.map((row) => [String(row.id), row]));

  const descriptors = [];
  for (const fileId of selectedFileIds) {
    const row = rowMap.get(fileId);
    if (!row || row.deleted_at) {
      throw new DataCoreAccessError(400, "선택한 DATA CORE 파일을 찾을 수 없습니다.");
    }
    if (!await canReadRegisteredFile(db, context, row)) {
      throw new DataCoreAccessError(403, "볼 수 있는 DATA CORE 파일만 생성 요청에 사용할 수 있습니다.");
    }
    const fileCampusId = typeof row.campus_id === "string" ? row.campus_id : null;
    if (campusId && fileCampusId && campusId !== fileCampusId) {
      throw new DataCoreAccessError(400, "다른 캠퍼스의 파일은 같은 생성 요청에 사용할 수 없습니다.");
    }
    descriptors.push({
      id: fileId,
      category: cleanText(row.category, 80),
      sourceApp: cleanText(row.source_app, 80),
      fileName: cleanText(row.original_file_name, 180),
      mimeType: cleanText(row.mime_type, 120),
    });
  }
  return descriptors;
}

export async function generateContentDraft(
  db: D1Database,
  context: DataCoreAccessContext,
  input: ContentGenerationInput,
  provider?: ContentGenerationProvider,
): Promise<ContentGenerationResult> {
  requireWriteAccess(context);
  const sourceApp = normalizeSourceApp(input.sourceApp);
  const campusId = cleanText(input.campusId, 120) || null;
  if (!context.isSuperAdmin || campusId) requireCampusAccess(context, campusId);

  const selectedFileIds = normalizeFileIds(input.selectedFileIds);
  const selectedFiles = await selectedFileDescriptors(db, context, campusId, selectedFileIds);
  const request: ContentGenerationProviderRequest = {
    sourceApp,
    campusId,
    contentPurpose: cleanText(input.contentPurpose || "class-story", 80) || "class-story",
    notes: cleanText(input.notes, 4000),
    coreMessage: cleanText(input.coreMessage, 1200),
    brandContext: HI5_CONTENT_BRAND_CONTEXT,
    selectedFiles,
  };

  if (!provider) {
    return {
      available: false,
      code: "provider_not_configured",
      message: "AI 생성 연결 준비 중입니다. 현재는 초안을 직접 작성하고 저장할 수 있습니다.",
    };
  }

  return {
    available: true,
    generated: await provider.generate(request),
  };
}
