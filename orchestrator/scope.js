/**
 * 并行步骤的文件域（fileScope）调度。
 *
 * - readOnly 步骤可任意并行
 * - 写步骤需 acquire 非重叠 fileScope；空 scope = 独占整个工作区
 */

/** @param {string} pattern */
function normalizePattern(pattern) {
  return String(pattern || '').trim().replace(/\\/g, '/').replace(/\/+$/, '') || '**';
}

/** 两个 glob 是否可能匹配同一文件。 */
function patternsOverlap(a, b) {
  const pa = normalizePattern(a);
  const pb = normalizePattern(b);
  if (pa === '**' || pb === '**') return true;
  if (pa === pb) return true;
  if (pa.startsWith(`${pb}/`) || pb.startsWith(`${pa}/`)) return true;
  return false;
}

/**
 * 两组 fileScope 是否冲突（可能写同一文件）。
 * @param {string[]} scopeA
 * @param {string[]} scopeB
 */
export function scopesOverlap(scopeA, scopeB) {
  const a = Array.isArray(scopeA) ? scopeA.filter(Boolean) : [];
  const b = Array.isArray(scopeB) ? scopeB.filter(Boolean) : [];
  // 空 scope = 全局写锁
  if (a.length === 0 || b.length === 0) return true;
  for (const x of a) {
    for (const y of b) {
      if (patternsOverlap(x, y)) return true;
    }
  }
  return false;
}

/** 节点是否与其他活跃写步骤冲突。 */
export function nodeConflictsWith(node, others) {
  if (node.readOnly) return false;
  const scopes = node.fileScope || [];
  for (const other of others) {
    if (other.readOnly) continue;
    if (scopesOverlap(scopes, other.fileScope || [])) return true;
  }
  return false;
}

/**
 * 从就绪节点中挑选可并行的一批（scope 不冲突）。
 * @param {object[]} ready - 已通过条件求值、待运行的节点
 * @param {object[]} activeWriters - 当前运行中的写节点摘要 { nodeId, fileScope, readOnly }
 * @returns {object[]}
 */
export function pickParallelBatch(ready, activeWriters) {
  const batch = [];
  const writers = [...activeWriters];
  for (const node of ready) {
    const probe = { readOnly: node.readOnly, fileScope: node.fileScope || [] };
    if (nodeConflictsWith(probe, writers)) continue;
    if (nodeConflictsWith(probe, batch.filter((n) => !n.readOnly).map((n) => ({
      readOnly: false,
      fileScope: n.fileScope || [],
    })))) continue;
    batch.push(node);
    if (!node.readOnly) {
      writers.push({ nodeId: node.id, fileScope: node.fileScope || [], readOnly: false });
    }
  }
  return batch;
}
