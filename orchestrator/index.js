/**
 * @danblen/orchestrator —— 多智能体 DAG 编排引擎。
 *
 * 不依赖 HTTP / CLI；通过 ctx.executeNode 注入节点执行函数。
 */

import { compileGraph, renderTask, evaluateCondition, DEFAULT_STEP_TIMEOUT_MS } from './graph.js';
import { executeGraph } from './executor.js';
import { executeSupervisor, parseSupervisorDecision, DEFAULT_MAX_ITERATIONS } from './supervisor.js';
import { validateGraph, topologicalLevels } from './validate.js';
import { Blackboard } from './blackboard.js';
import { parseAgentOutput, stripContractBlock } from './contract.js';
import { scopesOverlap, pickParallelBatch } from './scope.js';

export {
  compileGraph,
  renderTask,
  evaluateCondition,
  DEFAULT_STEP_TIMEOUT_MS,
  executeGraph,
  executeSupervisor,
  parseSupervisorDecision,
  DEFAULT_MAX_ITERATIONS,
  validateGraph,
  topologicalLevels,
  Blackboard,
  parseAgentOutput,
  stripContractBlock,
  scopesOverlap,
  pickParallelBatch,
};

/**
 * 编排执行一个图。executeGraph 的便捷别名。
 * @returns {Promise<{results:Record<string,NodeResult>, blackboard:Blackboard}>}
 */
export async function orchestrate(graph, ctx, callbacks) {
  return executeGraph(graph, ctx, callbacks);
}
