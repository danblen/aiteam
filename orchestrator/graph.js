import { evaluateCondition as _evaluateCondition } from './conditions.js';

/** 单步默认超时（5 分钟）；节点 timeoutMs=0 时使用。 */
export const DEFAULT_STEP_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * 图模型与编译器 —— 把工作流（或 ad-hoc 智能体序列）编译为可执行的 DAG。
 *
 * 节点（Node）= 一次智能体调用 + 编排元信息：
 *   { id, agentId, taskTemplate, dependsOn, condition, retry, timeoutMs }
 *
 * 编排语义：
 *   - dependsOn 为空 → 依赖前一个节点（向后兼容：旧工作流/智能体序列=顺序链）
 *   - dependsOn 非空 → 仅依赖指定节点（无依赖关系的节点可并行）
 *   - condition → 求值为 false 时跳过该节点
 *   - retry → 失败重试
 *   - timeoutMs → 单步超时（0 = 使用 DEFAULT_STEP_TIMEOUT_MS）
 *   - fileScope → 写文件域（glob 前缀）；空 = 独占整个工作区
 *   - readOnly → 只读步骤，可与其他只读或不同 fileScope 的写步骤并行
 *   - onFailure → continue | skip-dependents | abort
 */

/**
 * @typedef {Object} GraphNode
 * @property {string} id
 * @property {string} agentId
 * @property {string} taskTemplate
 * @property {string[]} dependsOn   解析后的前驱节点 id
 * @property {string} condition
 * @property {{maxAttempts:number, backoffMs:number}} retry
 * @property {number} timeoutMs
 */

/**
 * @typedef {Object} Graph
 * @property {GraphNode[]} nodes
 * @property {object|null} workflow   工作流摘要（来自 buildPlan）
 */

/**
 * 把工作流步骤或 ad-hoc 智能体序列编译为 DAG。
 *
 * @param {object} params
 * @param {Array} params.plan - buildPlan 产出的 [{ agent, taskTemplate, step }] 序列
 * @param {object|null} params.workflow - 工作流摘要
 * @returns {Graph}
 */
export function compileGraph({ plan, workflow }) {
  const nodes = plan.map((p, i) => {
    const step = p.step || {};
    const agent = p.agent || {};
    const rawDeps = Array.isArray(step.dependsOn) ? step.dependsOn.filter(Boolean) : [];
    // 依赖解析：显式声明则用之；否则默认依赖前一个节点（顺序链）
    const dependsOn = rawDeps.length > 0
      ? rawDeps
      : (i > 0 ? [plan[i - 1].step?.id || `node-${i}`] : []);
    const stepScope = normalizeFileScope(step.fileScope);
    const agentScope = normalizeFileScope(agent.defaultFileScope);
    return {
      id: step.id || `node-${i}`,
      agentId: p.agent.id,
      taskTemplate: p.taskTemplate || step.taskTemplate || '',
      dependsOn,
      condition: String(step.condition || ''),
      retry: normalizeRetry(step.retry),
      timeoutMs: resolveTimeoutMs(step.timeoutMs),
      fileScope: stepScope.length > 0 ? stepScope : agentScope,
      readOnly: step.readOnly === true || agent.readOnly === true,
      onFailure: normalizeOnFailure(step.onFailure),
    };
  });
  return { nodes, workflow };
}

function resolveTimeoutMs(v) {
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return Math.min(n, 3600_000);
  return DEFAULT_STEP_TIMEOUT_MS;
}

function normalizeFileScope(v) {
  if (!Array.isArray(v)) return [];
  return v.map((s) => String(s).trim()).filter(Boolean).slice(0, 20);
}

function normalizeOnFailure(v) {
  const s = String(v || 'continue');
  if (s === 'skip-dependents' || s === 'abort') return s;
  return 'continue';
}

function normalizeRetry(r) {
  if (!r || typeof r !== 'object') return { maxAttempts: 1, backoffMs: 0 };
  return {
    maxAttempts: Math.max(1, Math.min(5, Number(r.maxAttempts) || 1)),
    backoffMs: Math.max(0, Math.min(30000, Number(r.backoffMs) || 0)),
  };
}

/**
 * 把任务模板插值成实际任务文本。支持变量：
 *   {{input}}                      用户原始输入
 *   {{prev}}                       前驱节点的 summary（兼容旧模板）
 *   {{prev.files}}                 前驱节点产物文件清单
 *   {{prev.notes}}                 前驱节点产物备注
 *   {{nodes.<id>.contract.summary}} 任意已完成节点的产物摘要
 *   {{nodes.<id>.contract.files}}   任意已完成节点的文件清单
 *   {{workspace_files}}            当前工作区文件清单
 *
 * 无模板时：首节点用用户输入；后续节点把前驱 summary 拼进任务。
 *
 * @param {string} template
 * @param {object} ctx
 * @param {string} ctx.input
 * @param {object|null} ctx.prevContract - 前驱节点产物契约
 * @param {object} ctx.blackboardView - blackboard.view()（含所有已完成节点）
 * @param {string[]} ctx.workspaceFiles - 当前工作区文件路径清单
 * @returns {string}
 */
export function renderTask(template, ctx) {
  const { input, prevContract, blackboardView, workspaceFiles } = ctx;

  if (!template || !template.trim()) {
    if (!prevContract) return input;
    return `${input}\n\n【上一个智能体的产出】\n${prevContract.summary}`;
  }

  let out = template
    .replace(/\{\{\s*input\s*\}\}/g, input || '')
    .replace(/\{\{\s*prev\.files\s*\}\}/g, (prevContract?.files || []).join('\n'))
    .replace(/\{\{\s*prev\.notes\s*\}\}/g, prevContract?.notes || '')
    .replace(/\{\{\s*prev\.raw\s*\}\}/g, (prevContract?.raw || '').slice(0, 6000))
    .replace(/\{\{\s*prev\s*\}\}/g, prevContract?.summary || '')
    .replace(/\{\{\s*workspace_files\s*\}\}/g, (workspaceFiles || []).join('\n'));

  // 通用：{{nodes.<id>.contract.summary|files|notes|raw}}
  out = out.replace(
    /\{\{\s*nodes\.([^.}\s]+)\.contract\.(summary|files|notes|raw)\s*\}\}/g,
    (_, nodeId, field) => {
      const node = blackboardView?.nodes?.[nodeId];
      if (!node?.contract) return '';
      if (field === 'files') return (node.contract.files || []).join('\n');
      if (field === 'raw') return (node.contract.raw || '').slice(0, 6000);
      return node.contract[field] || '';
    },
  );

  // 通用：{{nodes.<id>.exitCode}}
  out = out.replace(
    /\{\{\s*nodes\.([^.}\s]+)\.exitCode\s*\}\}/g,
    (_, nodeId) => String(blackboardView?.nodes?.[nodeId]?.exitCode ?? ''),
  );

  return out;
}

/** 暴露条件求值（编排器内部使用）。 */
export function evaluateCondition(expr, view) {
  return _evaluateCondition(expr, view);
}
