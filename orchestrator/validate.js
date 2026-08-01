import { scopesOverlap } from './scope.js';

/**
 * 执行图编译期校验：环检测、依赖引用、并行写冲突预警。
 */

/** @param {{nodes: object[]}} graph */
export function validateGraph(graph) {
  const errors = [];
  const warnings = [];
  const nodes = graph?.nodes || [];
  const ids = new Set(nodes.map((n) => n.id));

  for (const node of nodes) {
    for (const dep of node.dependsOn || []) {
      if (!ids.has(dep)) {
        errors.push(`节点「${node.id}」依赖不存在的步骤「${dep}」`);
      }
      if (dep === node.id) {
        errors.push(`节点「${node.id}」不能依赖自身`);
      }
    }
  }

  const cycle = detectCycle(nodes);
  if (cycle) {
    errors.push(`工作流存在循环依赖：${cycle.join(' → ')}`);
  }

  const levels = topologicalLevels(nodes);
  for (const level of levels) {
    if (level.length <= 1) continue;
    const writers = level.filter((n) => !n.readOnly);
    if (writers.length <= 1) continue;
    for (let i = 0; i < writers.length; i++) {
      for (let j = i + 1; j < writers.length; j++) {
        const a = writers[i];
        const b = writers[j];
        if (scopesOverlap(a.fileScope || [], b.fileScope || [])) {
          warnings.push(
            `步骤「${a.id}」与「${b.id}」可能在同一层并行且写域冲突；请设置 fileScope 或 readOnly`,
          );
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** DFS 检测环，返回环路径或 null。 */
function detectCycle(nodes) {
  const adj = new Map(nodes.map((n) => [n.id, n.dependsOn || []]));
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function dfs(id) {
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

/** 拓扑分层：同层节点互不依赖，可并行。 */
export function topologicalLevels(nodes) {
  const done = new Set();
  const levels = [];

  while (done.size < nodes.length) {
    const level = nodes.filter(
      (n) => !done.has(n.id) && (n.dependsOn || []).every((d) => done.has(d)),
    );
    if (level.length === 0) break;
    for (const n of level) done.add(n.id);
    levels.push(level);
  }
  return levels;
}
