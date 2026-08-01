import type { CustomAgent, WorkflowStep } from './types';
import { cliLabel } from './types';

export type WorkflowNodeStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error';

export interface WorkflowGraphNode {
  id: string;
  index: number;
  label: string;
  agentName: string;
  cliLabel: string;
  x: number;
  y: number;
  width: number;
  height: number;
  dependsOn: string[];
  badges: string[];
  condition: string;
  readOnly: boolean;
  taskPreview: string;
}

export interface WorkflowGraphEdge {
  from: string;
  to: string;
}

export interface WorkflowGraphLayout {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  width: number;
  height: number;
}

const NODE_W = 172;
const NODE_H = 88;
const GAP_X = 28;
const GAP_Y = 52;
const PAD = 24;

/** 与后端 compileGraph 一致：无显式 dependsOn 时默认依赖前一步。 */
export function effectiveDependsOn(steps: WorkflowStep[], index: number): string[] {
  const step = steps[index];
  const raw = (step.dependsOn || []).filter(Boolean);
  if (raw.length > 0) return raw;
  return index > 0 ? [steps[index - 1].id] : [];
}

function stepBadges(step: WorkflowStep, index: number, allSteps: WorkflowStep[]): string[] {
  const badges: string[] = [];
  if (step.readOnly) badges.push('只读');
  if (step.fileScope?.length) badges.push(`域×${step.fileScope.length}`);
  const deps = effectiveDependsOn(allSteps, index);
  if (deps.length > 1 || (step.dependsOn?.length ?? 0) > 0) {
    const nums = deps.map((id) => allSteps.findIndex((s) => s.id === id) + 1).filter((n) => n > 0);
    badges.push(nums.length ? `依赖 #${nums.join(',')}` : '自定义依赖');
  }
  if (step.condition?.trim()) badges.push('条件');
  if ((step.retry?.maxAttempts ?? 1) > 1) badges.push(`重试×${step.retry!.maxAttempts}`);
  if (step.timeoutMs && step.timeoutMs > 0) badges.push(`${Math.round(step.timeoutMs / 1000)}s`);
  if (step.onFailure && step.onFailure !== 'continue') {
    badges.push(step.onFailure === 'abort' ? '失败中止' : '跳过下游');
  }
  return badges;
}

/** 将工作流步骤布局为分层 DAG（自上而下）。 */
export function layoutWorkflowGraph(
  steps: WorkflowStep[],
  agents: CustomAgent[],
): WorkflowGraphLayout {
  if (steps.length === 0) {
    return { nodes: [], edges: [], width: 320, height: 120 };
  }

  const edges: WorkflowGraphEdge[] = [];
  const layerOf = new Map<string, number>();

  for (let i = 0; i < steps.length; i++) {
    const deps = effectiveDependsOn(steps, i);
    for (const dep of deps) {
      edges.push({ from: dep, to: steps[i].id });
    }
  }

  // 按最长路径分层。
  const computeLayer = (id: string, visiting: Set<string>): number => {
    if (layerOf.has(id)) return layerOf.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const incoming = edges.filter((e) => e.to === id).map((e) => e.from);
    const layer = incoming.length === 0
      ? 0
      : 1 + Math.max(...incoming.map((from) => computeLayer(from, visiting)));
    visiting.delete(id);
    layerOf.set(id, layer);
    return layer;
  };

  for (const s of steps) computeLayer(s.id, new Set());

  const layers = new Map<number, WorkflowStep[]>();
  for (const s of steps) {
    const l = layerOf.get(s.id) ?? 0;
    if (!layers.has(l)) layers.set(l, []);
    layers.get(l)!.push(s);
  }

  const sortedLayerKeys = [...layers.keys()].sort((a, b) => a - b);
  const nodes: WorkflowGraphNode[] = [];

  for (const layerKey of sortedLayerKeys) {
    const layerSteps = layers.get(layerKey)!;
    const layerWidth = layerSteps.length * NODE_W + (layerSteps.length - 1) * GAP_X;
    const startX = PAD + Math.max(0, (800 - layerWidth) / 2);

    layerSteps.forEach((step, j) => {
      const i = steps.findIndex((s) => s.id === step.id);
      const agent = agents.find((a) => a.id === step.agentId);
      nodes.push({
        id: step.id,
        index: i + 1,
        label: agent?.name || `步骤 ${i + 1}`,
        agentName: agent?.name || '未绑定智能体',
        cliLabel: agent ? cliLabel(agent.cliId) : '—',
        x: startX + j * (NODE_W + GAP_X),
        y: PAD + layerKey * (NODE_H + GAP_Y),
        width: NODE_W,
        height: NODE_H,
        dependsOn: effectiveDependsOn(steps, i),
        badges: stepBadges(step, i, steps),
        condition: (step.condition || '').trim(),
        readOnly: step.readOnly === true,
        taskPreview: (step.taskTemplate || '').trim(),
      });
    });
  }

  const maxX = Math.max(...nodes.map((n) => n.x + n.width), 320);
  const maxY = Math.max(...nodes.map((n) => n.y + n.height), 120);

  return {
    nodes,
    edges,
    width: maxX + PAD,
    height: maxY + PAD,
  };
}

/** 贝塞尔连线路径（父节点底 → 子节点顶）。 */
export function edgePath(
  layout: WorkflowGraphLayout,
  fromId: string,
  toId: string,
): string {
  const from = layout.nodes.find((n) => n.id === fromId);
  const to = layout.nodes.find((n) => n.id === toId);
  if (!from || !to) return '';
  const x1 = from.x + from.width / 2;
  const y1 = from.y + from.height;
  const x2 = to.x + to.width / 2;
  const y2 = to.y;
  const mid = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
}

export interface WorkflowGraphValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** 拓扑分层：同层节点可并行 */
  levels: string[][];
}

function scopesOverlap(a: string[], b: string[]): boolean {
  const sa = a.filter(Boolean);
  const sb = b.filter(Boolean);
  if (sa.length === 0 || sb.length === 0) return true;
  for (const x of sa) {
    for (const y of sb) {
      const pa = x.replace(/\\/g, '/').replace(/\/+$/, '') || '**';
      const pb = y.replace(/\\/g, '/').replace(/\/+$/, '') || '**';
      if (pa === '**' || pb === '**' || pa === pb) return true;
      if (pa.startsWith(`${pb}/`) || pb.startsWith(`${pa}/`)) return true;
    }
  }
  return false;
}

/** 编译期校验（与后端 validateGraph 语义一致）。 */
export function validateWorkflowSteps(steps: WorkflowStep[]): WorkflowGraphValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set(steps.map((s) => s.id));
  const nodes = steps.map((s, i) => ({
    id: s.id,
    dependsOn: effectiveDependsOn(steps, i),
    readOnly: s.readOnly === true,
    fileScope: s.fileScope || [],
  }));

  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!ids.has(dep)) errors.push(`步骤依赖不存在的节点`);
      if (dep === node.id) errors.push(`步骤不能依赖自身`);
    }
  }

  const cycle = detectCycle(nodes);
  if (cycle) errors.push(`存在循环依赖：${cycle.map((id) => `#${steps.findIndex((s) => s.id === id) + 1}`).join(' → ')}`);

  const levels: string[][] = [];
  const done = new Set<string>();
  while (done.size < nodes.length) {
    const level = nodes.filter(
      (n) => !done.has(n.id) && n.dependsOn.every((d) => done.has(d)),
    );
    if (level.length === 0) break;
    for (const n of level) done.add(n.id);
    levels.push(level.map((n) => n.id));
  }

  for (const level of levels) {
    if (level.length <= 1) continue;
    const writers = level
      .map((id) => nodes.find((n) => n.id === id)!)
      .filter((n) => !n.readOnly);
    for (let i = 0; i < writers.length; i++) {
      for (let j = i + 1; j < writers.length; j++) {
        if (scopesOverlap(writers[i].fileScope, writers[j].fileScope)) {
          const a = steps.findIndex((s) => s.id === writers[i].id) + 1;
          const b = steps.findIndex((s) => s.id === writers[j].id) + 1;
          warnings.push(`步骤 #${a} 与 #${b} 同层并行且写域可能冲突，请设 readOnly 或 fileScope`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, levels };
}

function detectCycle(nodes: { id: string; dependsOn: string[] }[]): string[] | null {
  const adj = new Map(nodes.map((n) => [n.id, n.dependsOn]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function dfs(id: string): string[] | null {
    if (visited.has(id)) return null;
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      return start >= 0 ? [...stack.slice(start), id] : [id, id];
    }
    visiting.add(id);
    stack.push(id);
    for (const dep of adj.get(id) || []) {
      const cyc = dfs(dep);
      if (cyc) return cyc;
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  }

  for (const n of nodes) {
    const cyc = dfs(n.id);
    if (cyc) return cyc;
  }
  return null;
}

/** 与上一有效前驱并行：复制前一步的 dependsOn。 */
export function parallelWithPrevious(steps: WorkflowStep[], stepIndex: number): WorkflowStep[] {
  if (stepIndex <= 0) return steps;
  const prevDeps = effectiveDependsOn(steps, stepIndex - 1);
  return steps.map((s, i) => (i === stepIndex ? { ...s, dependsOn: [...prevDeps] } : s));
}

/** 切换依赖边 fromId → toId（to 依赖 from）。 */
export function toggleStepDependency(steps: WorkflowStep[], fromId: string, toId: string): WorkflowStep[] {
  if (fromId === toId) return steps;
  const toIndex = steps.findIndex((s) => s.id === toId);
  if (toIndex < 0) return steps;
  const step = steps[toIndex];
  const current = (step.dependsOn?.length ?? 0) > 0
    ? [...step.dependsOn!]
    : [...effectiveDependsOn(steps, toIndex)];
  const nextDeps = current.includes(fromId)
    ? current.filter((d) => d !== fromId)
    : [...current, fromId];
  return steps.map((s) => (s.id === toId ? { ...s, dependsOn: nextDeps } : s));
}
