import { DEFAULT_ORGANIZATION_ID } from "./data-core";
import { ensureKnowledgeSchema } from "./data-core-knowledge";

type SeedNode = {
  id: string;
  nodeType: string;
  name: string;
  summary: string;
  metadata?: Record<string, unknown>;
};

type SeedEdge = {
  id: string;
  from: string;
  to: string;
  relation: string;
  weight?: number;
  metadata?: Record<string, unknown>;
};

const nodes: SeedNode[] = [
  {
    id: "knowledge:career:webtoon-artist",
    nodeType: "career",
    name: "웹툰 작가",
    summary: "웹툰의 스토리, 캐릭터, 연출과 작화를 종합적으로 설계하고 제작하는 진로",
  },
  {
    id: "knowledge:career:animation",
    nodeType: "career",
    name: "애니메이터·애니메이션 감독",
    summary: "캐릭터 움직임, 연기, 화면 연출과 애니메이션 제작을 다루는 진로",
  },
  {
    id: "knowledge:career:game-character",
    nodeType: "career",
    name: "게임 캐릭터 디자이너",
    summary: "게임 세계관에 맞는 캐릭터의 형태, 의상, 장비, 색채와 비주얼을 설계하는 진로",
  },
  {
    id: "knowledge:career:visual-designer",
    nodeType: "career",
    name: "시각디자이너",
    summary: "정보와 메시지를 이미지, 타이포그래피, 조형과 색채로 시각화하는 진로",
  },
  {
    id: "knowledge:major:webtoon-content",
    nodeType: "major",
    name: "웹툰·만화콘텐츠",
    summary: "웹툰, 만화, 스토리, 연출과 디지털 작화를 중심으로 준비하는 전공군",
  },
  {
    id: "knowledge:major:animation",
    nodeType: "major",
    name: "만화·애니메이션",
    summary: "애니메이션, 캐릭터 움직임, 스토리보드와 영상 연출을 중심으로 준비하는 전공군",
  },
  {
    id: "knowledge:major:game-art",
    nodeType: "major",
    name: "게임그래픽·게임아트",
    summary: "게임 캐릭터, 배경, 컨셉아트와 디지털 비주얼 제작을 중심으로 준비하는 전공군",
  },
  {
    id: "knowledge:major:visual-design",
    nodeType: "major",
    name: "시각디자인·커뮤니케이션디자인",
    summary: "조형, 색채, 시각정보와 커뮤니케이션 디자인을 중심으로 준비하는 전공군",
  },

  { id: "knowledge:skill:drawing", nodeType: "skill", name: "드로잉 기초", summary: "선, 형태, 비례, 관찰과 입체감을 이해하는 기본 표현 능력", metadata: { order: 10 } },
  { id: "knowledge:skill:face", nodeType: "skill", name: "얼굴·표정", summary: "얼굴 구조와 표정을 활용해 캐릭터의 감정과 인상을 표현하는 능력", metadata: { order: 20 } },
  { id: "knowledge:skill:figure", nodeType: "skill", name: "인체·동세", summary: "인체 구조, 비례, 포즈와 움직임을 자연스럽게 표현하는 능력", metadata: { order: 30 } },
  { id: "knowledge:skill:hands-feet", nodeType: "skill", name: "손·발", summary: "손과 발의 구조와 다양한 동작을 정확하게 표현하는 능력", metadata: { order: 40 } },
  { id: "knowledge:skill:clothing", nodeType: "skill", name: "옷주름·의상", summary: "인체 움직임에 따른 옷주름과 캐릭터 의상 구조를 표현하는 능력", metadata: { order: 50 } },
  { id: "knowledge:skill:perspective", nodeType: "skill", name: "투시·공간", summary: "1점·2점·3점 투시와 공간 구조를 이해하고 장면에 적용하는 능력", metadata: { order: 60 } },
  { id: "knowledge:skill:background", nodeType: "skill", name: "배경·환경", summary: "실내외 공간, 사물, 자연환경을 캐릭터와 조화롭게 구성하는 능력", metadata: { order: 70 } },
  { id: "knowledge:skill:color", nodeType: "skill", name: "색채·채색", summary: "색의 대비, 분위기, 명암과 재질을 활용해 화면을 완성하는 능력", metadata: { order: 80 } },
  { id: "knowledge:skill:character", nodeType: "skill", name: "캐릭터 디자인", summary: "성격과 세계관이 드러나는 캐릭터의 형태, 의상과 소품을 설계하는 능력", metadata: { order: 90 } },
  { id: "knowledge:skill:story-direction", nodeType: "skill", name: "스토리·연출", summary: "장면의 흐름, 컷 구성, 시선과 이야기 전달을 설계하는 능력", metadata: { order: 100 } },
  { id: "knowledge:skill:digital", nodeType: "skill", name: "디지털 제작", summary: "디지털 드로잉과 편집 도구를 활용해 결과물을 완성하는 능력", metadata: { order: 110 } },
  { id: "knowledge:skill:design-form", nodeType: "skill", name: "디자인 조형", summary: "형태, 구성, 대비, 리듬과 시각적 질서를 활용해 화면을 설계하는 능력", metadata: { order: 115 } },

  { id: "knowledge:curriculum:foundation", nodeType: "curriculum_module", name: "기초 선·형태·관찰", summary: "선 연습, 기본도형, 비례와 입체감을 이해하는 기초 단계", metadata: { stage: "기초", order: 10 } },
  { id: "knowledge:curriculum:face", nodeType: "curriculum_module", name: "얼굴 드로잉", summary: "얼굴 구조, 각도, 표정과 캐릭터화 학습", metadata: { stage: "기초", order: 20 } },
  { id: "knowledge:curriculum:figure", nodeType: "curriculum_module", name: "인체 드로잉", summary: "인체 비례, 구조, 동세와 포즈 학습", metadata: { stage: "기초", order: 30 } },
  { id: "knowledge:curriculum:hands-feet", nodeType: "curriculum_module", name: "손·발 드로잉", summary: "손발 구조와 다양한 동작 학습", metadata: { stage: "기초", order: 40 } },
  { id: "knowledge:curriculum:clothing", nodeType: "curriculum_module", name: "옷주름·의상", summary: "주름 원리, 의복 구조와 캐릭터 의상 학습", metadata: { stage: "기초", order: 50 } },
  { id: "knowledge:curriculum:perspective", nodeType: "curriculum_module", name: "1·2·3점 투시", summary: "투시 원리와 공간 구성 학습", metadata: { stage: "중급", order: 60 } },
  { id: "knowledge:curriculum:background", nodeType: "curriculum_module", name: "배경·공간", summary: "실내외 공간과 오브젝트를 장면에 적용하는 학습", metadata: { stage: "중급", order: 70 } },
  { id: "knowledge:curriculum:color", nodeType: "curriculum_module", name: "색채·채색", summary: "색 조합, 명암, 재질과 분위기 표현 학습", metadata: { stage: "중급", order: 80 } },
  { id: "knowledge:curriculum:major-foundation", nodeType: "curriculum_module", name: "전공 기초", summary: "희망 전공에 맞는 캐릭터, 스토리, 디자인 또는 컨셉 표현을 강화하는 단계", metadata: { stage: "전공", order: 90 } },
  { id: "knowledge:curriculum:practical", nodeType: "curriculum_module", name: "전공별 실기유형", summary: "상황표현, 칸만화, 세로웹툰, 이미지보드, 게임포스터, 기초디자인 등 목표 전형의 실기유형을 집중 준비하는 단계", metadata: { stage: "입시", order: 100 } },
  { id: "knowledge:curriculum:portfolio", nodeType: "curriculum_module", name: "포트폴리오·입시 완성", summary: "지원대학 기준에 맞춰 작품 완성도와 시간관리, 지원전략을 최종 조정하는 단계", metadata: { stage: "입시", order: 110 } },
];

const edges: SeedEdge[] = [
  { id: "knowledge:edge:webtoon-major", from: "knowledge:career:webtoon-artist", to: "knowledge:major:webtoon-content", relation: "RELATED_MAJOR", weight: 10 },
  { id: "knowledge:edge:animation-major", from: "knowledge:career:animation", to: "knowledge:major:animation", relation: "RELATED_MAJOR", weight: 10 },
  { id: "knowledge:edge:game-major", from: "knowledge:career:game-character", to: "knowledge:major:game-art", relation: "RELATED_MAJOR", weight: 10 },
  { id: "knowledge:edge:visual-major", from: "knowledge:career:visual-designer", to: "knowledge:major:visual-design", relation: "RELATED_MAJOR", weight: 10 },

  ...[
    ["knowledge:major:webtoon-content", ["drawing", "face", "figure", "hands-feet", "clothing", "perspective", "background", "color", "character", "story-direction", "digital"]],
    ["knowledge:major:animation", ["drawing", "face", "figure", "hands-feet", "clothing", "perspective", "background", "color", "character", "story-direction", "digital"]],
    ["knowledge:major:game-art", ["drawing", "face", "figure", "hands-feet", "clothing", "perspective", "background", "color", "character", "digital"]],
    ["knowledge:major:visual-design", ["drawing", "perspective", "color", "digital", "design-form"]],
  ].flatMap(([major, skills]) => (skills as string[]).map((skill, index) => ({
    id: `knowledge:edge:${String(major).split(":").pop()}:skill:${skill}`,
    from: String(major),
    to: `knowledge:skill:${skill}`,
    relation: "REQUIRES_SKILL",
    weight: 10 - index * 0.1,
  }))),

  ...[
    ["drawing", "foundation"],
    ["face", "face"],
    ["figure", "figure"],
    ["hands-feet", "hands-feet"],
    ["clothing", "clothing"],
    ["perspective", "perspective"],
    ["background", "background"],
    ["color", "color"],
    ["character", "major-foundation"],
    ["story-direction", "major-foundation"],
    ["digital", "major-foundation"],
    ["design-form", "major-foundation"],
  ].map(([skill, module], index) => ({
    id: `knowledge:edge:skill:${skill}:curriculum:${module}`,
    from: `knowledge:skill:${skill}`,
    to: `knowledge:curriculum:${module}`,
    relation: "LEARNED_THROUGH",
    weight: 10 - index * 0.1,
  })),

  ...[
    ["foundation", "face"],
    ["face", "figure"],
    ["figure", "hands-feet"],
    ["hands-feet", "clothing"],
    ["clothing", "perspective"],
    ["perspective", "background"],
    ["background", "color"],
    ["color", "major-foundation"],
    ["major-foundation", "practical"],
    ["practical", "portfolio"],
  ].map(([from, to], index) => ({
    id: `knowledge:edge:curriculum:${from}:${to}`,
    from: `knowledge:curriculum:${from}`,
    to: `knowledge:curriculum:${to}`,
    relation: "PREREQUISITE_OF",
    weight: 10 - index * 0.1,
  })),
];

export async function seedKnowledgeFoundation(db: D1Database) {
  await ensureKnowledgeSchema(db);
  const now = new Date().toISOString();

  for (const node of nodes) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO knowledge_nodes (
           id, organization_id, campus_id, node_type, name, summary, content_text,
           metadata_json, visibility, status, created_by_user_id, created_at, updated_at
         ) VALUES (?, ?, NULL, ?, ?, ?, NULL, ?, 'organization', 'active', NULL, ?, ?)`,
      )
      .bind(
        node.id,
        DEFAULT_ORGANIZATION_ID,
        node.nodeType,
        node.name,
        node.summary,
        JSON.stringify({ seed: "hi5-anihi-foundation-v1", ...(node.metadata || {}) }),
        now,
        now,
      )
      .run();
  }

  for (const edge of edges) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO knowledge_edges (
           id, organization_id, campus_id, from_node_id, to_node_id, relation_type,
           weight, metadata_json, created_by_user_id, created_at, updated_at
         ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .bind(
        edge.id,
        DEFAULT_ORGANIZATION_ID,
        edge.from,
        edge.to,
        edge.relation,
        edge.weight ?? 1,
        JSON.stringify({ seed: "hi5-anihi-foundation-v1", ...(edge.metadata || {}) }),
        now,
        now,
      )
      .run();
  }

  return { nodes: nodes.length, edges: edges.length, version: "hi5-anihi-foundation-v1" };
}
