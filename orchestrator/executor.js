import { Blackboard } from './blackboard.js';
import { renderTask, evaluateCondition, DEFAULT_STEP_TIMEOUT_MS } from './graph.js';
import { parseAgentOutput } from './contract.js';
import { pickParallelBatch } from './scope.js';

/**
 * DAG 执行器 —— 编排层的核心调度器。
 *
 * 职责：
 *   1. 拓扑调度：依赖满足的节点就绪；scope 不冲突的节点并行执行。
 *   2. 控制流：条件求值、失败重试、单步超时、onFailure 策略。
 *   3. 黑板：每个节点完成后把结构化产物写入黑板。
 *
 * ctx.executeNode 必须由上层注入（如 server/agents/runner.js）。
 */

/**
 * @param {object} graph
 * @param {object} ctx
 * @param {object} callbacks
 */
export async function executeGraph(graph, ctx, callbacks = {}) {
  if (typeof ctx.executeNode !== 'function') {
    throw new Error('executeGraph 需要 ctx.executeNode(agent, task, nodeCtx, streamCallbacks)');
  }

  const { nodes } = graph;
  const blackboard = new Blackboard(ctx.input);
  const completed = new Set();
  const failed = new Set();
  const running = new Map();
  const results = {};
  let aborted = false;

  callbacks.onPlan?.(graph);

  while (completed.size < nodes.length) {
    if (ctx.signal?.aborted) {
      aborted = true;
      break;
    }

    const ready = nodes.filter((n) => {
      if (completed.has(n.id) || running.has(n.id)) return false;
      if (!allDepsCompleted(n, completed)) return false;
      if (shouldSkipDueToFailedDep(n, failed, nodes)) {
        finishSkipped(n, results, blackboard, completed, callbacks);
        return false;
      }
      return true;
    });

    const toRun = [];
    for (const node of ready) {
      if (!evaluateCondition(node.condition, blackboard.view())) {
        finishSkipped(node, results, blackboard, completed, callbacks);
        continue;
      }
      toRun.push(node);
    }

    const activeWriters = [...running.keys()]
      .map((id) => nodes.find((n) => n.id === id))
      .filter(Boolean)
      .filter((n) => !n.readOnly)
      .map((n) => ({ readOnly: false, fileScope: n.fileScope || [] }));

    const batch = pickParallelBatch(toRun, activeWriters);

    for (const node of batch) {
      if (ctx.signal?.aborted) break;
      const p = runNodeWithRetry(node, ctx, blackboard, callbacks)
        .then((result) => {
          results[node.id] = result;
          blackboard.setNode(node.id, result);
          completed.add(node.id);
          running.delete(node.id);
          if (result.status === 'error') {
            failed.add(node.id);
            if (node.onFailure === 'abort') aborted = true;
          }
        })
        .catch(() => {
          const result = errorResult('未知错误');
          results[node.id] = result;
          blackboard.setNode(node.id, result);
          completed.add(node.id);
          failed.add(node.id);
          running.delete(node.id);
        });
      running.set(node.id, p);
    }

    if (aborted) break;
    if (batch.length === 0 && running.size === 0) break;

    if (running.size > 0) {
      await Promise.race(running.values());
    } else if (toRun.length > 0 && batch.length === 0) {
      await Promise.race(running.values());
    }
  }

  if (running.size > 0) await Promise.all(running.values());

  return { results, blackboard, aborted };
}

function allDepsCompleted(node, completed) {
  return (node.dependsOn || []).every((d) => completed.has(d));
}

function shouldSkipDueToFailedDep(node, failed, allNodes) {
  for (const depId of node.dependsOn || []) {
    if (!failed.has(depId)) continue;
    const depNode = allNodes.find((n) => n.id === depId);
    if (depNode?.onFailure === 'skip-dependents') return true;
  }
  return false;
}

function finishSkipped(node, results, blackboard, completed, callbacks) {
  const result = {
    exitCode: 0,
    output: '',
    contract: parseAgentOutput(''),
    status: 'skipped',
    durationMs: 0,
  };
  results[node.id] = result;
  blackboard.setNode(node.id, result);
  completed.add(node.id);
  callbacks.onNodeSkipped?.(node);
}

function prevContractOf(node, blackboard) {
  const deps = node.dependsOn || [];
  if (deps.length === 0) return null;
  const parts = [];
  const files = [];
  const notes = [];
  for (const depId of deps) {
    const c = blackboard.nodes[depId]?.contract;
    if (!c) continue;
    if (c.summary) parts.push(`[${depId}] ${c.summary}`);
    if (c.files?.length) files.push(...c.files);
    if (c.notes) notes.push(c.notes);
  }
  if (parts.length === 0) return null;
  return {
    summary: parts.join('\n\n'),
    files: [...new Set(files)],
    notes: notes.join('\n'),
    raw: parts.join('\n\n'),
  };
}

async function runNodeWithRetry(node, ctx, blackboard, callbacks) {
  const agent = ctx.getAgent(node.agentId);
  const maxAttempts = node.retry?.maxAttempts || 1;
  const backoffMs = node.retry?.backoffMs || 0;
  const runNode = ctx.executeNode;
  const timeoutMs = node.timeoutMs || ctx.defaultTimeoutMs || DEFAULT_STEP_TIMEOUT_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (ctx.signal?.aborted) return errorResult('已中止');

    callbacks.onNodeStart?.(node, attempt);

    if (!agent) {
      callbacks.onNodeError?.(node, new Error(`智能体「${node.agentId}」不存在`));
      return errorResult(`智能体不存在: ${node.agentId}`);
    }

    const workspaceFiles = ctx.scanFiles ? ctx.scanFiles().map((f) => f.path) : [];
    const task = renderTask(node.taskTemplate, {
      input: ctx.input,
      prevContract: prevContractOf(node, blackboard),
      blackboardView: blackboard.view(),
      workspaceFiles,
    });

    const startedAt = Date.now();
    try {
      const res = await runNode(agent, task, {
        workDir: ctx.workDir,
        signal: ctx.signal,
        uid: ctx.uid,
        timeoutMs,
      }, {
        onDelta: (text) => callbacks.onNodeDelta?.(node, text),
        onStatus: (text) => callbacks.onNodeStatus?.(node, text),
      });
      const result = {
        exitCode: res.exitCode,
        output: res.output,
        contract: res.contract,
        status: 'done',
        durationMs: Date.now() - startedAt,
      };
      callbacks.onNodeDone?.(node, result);
      return result;
    } catch (err) {
      if (ctx.signal?.aborted) {
        callbacks.onNodeError?.(node, err);
        return errorResult('已中止');
      }
      if (attempt < maxAttempts) {
        callbacks.onNodeStatus?.(node, `第 ${attempt} 次失败（${err.message || err}），重试中…`);
        if (backoffMs > 0) await sleep(backoffMs);
        continue;
      }
      callbacks.onNodeError?.(node, err);
      return errorResult(err.message || String(err));
    }
  }
  return errorResult('重试耗尽');
}

function errorResult(msg) {
  return {
    exitCode: -1,
    output: '',
    contract: parseAgentOutput(msg || '执行失败'),
    status: 'error',
    durationMs: 0,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
