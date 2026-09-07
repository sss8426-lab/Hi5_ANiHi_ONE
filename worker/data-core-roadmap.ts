import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireAuthenticatedAccess,
} from "./data-core-access";
import {
  getKnowledgeNode,
  listKnowledgeEdges,
  listKnowledgeNodes,
  type KnowledgeNodeType,
} from "./data-core-knowledge";
import { seedKnowledgeFoundation } from "./data-core-knowledge-seed";

type RoadmapNode = Awaited<ReturnType<typeof getKnowledgeNode>>;
type RoadmapEdge = Awaited<ReturnType<typeof listKnowledgeEdges>>[number];

const FORWARD_RELATIONS = new Set([
  "RELATED_MAJOR",
  "LEADS_TO_PROGRAM",
  "OFFERED_BY",
  "USES_ADMISSION_METHOD",
  "REQUIRES_SKILL",
  "LEARNED_THROUGH",
  "PREREQUISITE_OF",
]);

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function scoreGoalMatch(node: RoadmapNode, goal: string) {
  const name = String(node.name || "").toLowerCase();
  const summary = String(node.summary || "").toLowerCase();
  const target = goal.toLowerCase();
  if (name === target) return 100;
  if (name.startsWith(target) || target.startsWith(name)) return 90;
  if (name.includes(target) || target.includes(name)) return 80;
  if (summary.includes(target)) return 60;
  return 20;
}

function uniqueById<T extends { id?: unknown }>(items: T[]) {
  const map = new Map<string, T>();
  for (const item of items) {
    const id = String(item.id || "");
    if (id && !map.has(id)) map.set(id, item);
  }
  return Array.from(map.values());
}

function nodeOrder(node: RoadmapNode) {
  const metadata = node.metadata as Record<string, unknown> | undefined;
  const order = Number(metadata?.order);
  return Number.isFinite(order) ? order : 9999;
}

function stageOrder(node: RoadmapNode) {
  const metadata = node.metadata as Record<string, unknown> | undefined;
  const stage = String(metadata?.stage || "");
  return ({ 기초: 10, 중급: 20, 전공: 30, 입시: 40 } as Record<string, number>)[stage] || 90;
}

function canUseEdge(context: DataCoreAccessContext, edge: RoadmapEdge) {
  if (context.isSuperAdmin) return true;
  const campusId = edge.campusId ? String(edge.campusId) : "";
  return !campusId || context.campusIds.includes(campusId);
}

async function outgoingEdges(
  db: D1Database,
  context: DataCoreAccessContext,
  nodeId: string,
) {
  const url = new URL("https://data-core.local/api");
  url.searchParams.set("fromNodeId", nodeId);
  url.searchParams.set("limit", "300");
  return (await listKnowledgeEdges(db, context, url)).filter((edge) =>
    FORWARD_RELATIONS.has(String(edge.relationType)) && canUseEdge(context, edge),
  );
}

async function graphFromStarts(
  db: D1Database,
  context: DataCoreAccessContext,
  starts: RoadmapNode[],
) {
  const nodes = new Map<string, RoadmapNode>();
  const edges = new Map<string, RoadmapEdge>();
  const queue: Array<{ id: string; depth: number }> = [];

  for (const node of starts) {
    nodes.set(String(node.id), node);
    queue.push({ id: String(node.id), depth: 0 });
  }

  const expanded = new Set<string>();
  while (queue.length && nodes.size < 250 && edges.size < 500) {
    const current = queue.shift();
    if (!current || current.depth >= 6 || expanded.has(current.id)) continue;
    expanded.add(current.id);

    const outgoing = await outgoingEdges(db, context, current.id);
    for (const edge of outgoing) {
      const edgeId = String(edge.id || "");
      const targetId = String(edge.toNodeId || "");
      if (!edgeId || !targetId) continue;
      edges.set(edgeId, edge);

      if (!nodes.has(targetId)) {
        try {
          const target = await getKnowledgeNode(db, context, targetId);
          nodes.set(targetId, target);
          queue.push({ id: targetId, depth: current.depth + 1 });
        } catch (_) {
          // Permission filtering and deleted nodes are intentionally skipped.
        }
      }
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  };
}

function grouped(nodes: RoadmapNode[]) {
  const byType = new Map<string, RoadmapNode[]>();
  for (const node of nodes) {
    const type = String(node.nodeType || "unknown");
    const list = byType.get(type) || [];
    list.push(node);
    byType.set(type, list);
  }
  return byType;
}

function curriculumSequence(nodes: RoadmapNode[]) {
  return nodes
    .filter((node) => node.nodeType === "curriculum_module")
    .sort((a, b) => stageOrder(a) - stageOrder(b) || nodeOrder(a) - nodeOrder(b) || String(a.name).localeCompare(String(b.name), "ko"))
    .map((node, index) => ({
      step: index + 1,
      id: node.id,
      name: node.name,
      summary: node.summary,
      stage: (node.metadata as Record<string, unknown> | undefined)?.stage || null,
      order: nodeOrder(node),
    }));
}

function missingDataFlags(byType: Map<string, RoadmapNode[]>) {
  return {
    universityPrograms: !(byType.get("university_program") || []).length,
    universities: !(byType.get("university") || []).length,
    admissionMethods: !(byType.get("admission_method") || []).length,
  };
}

export async function buildDreamRoadmap(
  db: D1Database,
  context: DataCoreAccessContext,
  url: URL,
) {
  requireAuthenticatedAccess(context);
  await seedKnowledgeFoundation(db);

  const goal = cleanText(url.searchParams.get("goal"), 160);
  const goalId = cleanText(url.searchParams.get("goalId"), 160);
  if (!goal && !goalId) {
    throw new DataCoreAccessError(400, "goal 또는 goalId가 필요합니다.");
  }

  let matches: RoadmapNode[] = [];
  if (goalId) {
    const node = await getKnowledgeNode(db, context, goalId);
    matches = [node];
  } else {
    const query = new URL("https://data-core.local/api");
    query.searchParams.set("q", goal);
    query.searchParams.set("limit", "50");
    matches = (await listKnowledgeNodes(db, context, query))
      .filter((node) => ["career", "major"].includes(String(node.nodeType)))
      .sort((a, b) => scoreGoalMatch(b, goal) - scoreGoalMatch(a, goal))
      .slice(0, 5);
  }

  if (!matches.length) {
    return {
      goal,
      goalMatches: [],
      message: "등록된 꿈·전공 지식에서 일치하는 항목을 찾지 못했습니다.",
      roadmap: null,
    };
  }

  const graph = await graphFromStarts(db, context, matches);
  const byType = grouped(graph.nodes);
  const careers = uniqueById(byType.get("career") || []);
  const majors = uniqueById(byType.get("major") || []);
  const programs = uniqueById(byType.get("university_program") || []);
  const universities = uniqueById(byType.get("university") || []);
  const admissionMethods = uniqueById(byType.get("admission_method") || []);
  const skills = uniqueById(byType.get("skill") || []).sort((a, b) => nodeOrder(a) - nodeOrder(b));
  const sequence = curriculumSequence(graph.nodes);

  return {
    goal,
    goalMatches: matches,
    roadmap: {
      careers,
      majors,
      universityPrograms: programs,
      universities,
      admissionMethods,
      requiredSkills: skills,
      curriculumSequence: sequence,
      missingData: missingDataFlags(byType),
      graph,
    },
  };
}

export async function listRoadmapGoals(
  db: D1Database,
  context: DataCoreAccessContext,
) {
  requireAuthenticatedAccess(context);
  await seedKnowledgeFoundation(db);
  const url = new URL("https://data-core.local/api");
  url.searchParams.set("limit", "200");
  const nodes = await listKnowledgeNodes(db, context, url);
  return nodes
    .filter((node) => ["career", "major"].includes(String(node.nodeType)))
    .sort((a, b) => String(a.nodeType).localeCompare(String(b.nodeType)) || String(a.name).localeCompare(String(b.name), "ko"))
    .map((node) => ({
      id: node.id,
      nodeType: node.nodeType as KnowledgeNodeType,
      name: node.name,
      summary: node.summary,
    }));
}
