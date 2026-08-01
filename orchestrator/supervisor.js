import { Blackboard } from './blackboard.js';
import { renderTask } from './graph.js';
import { parseAgentOutput } from './contract.js';
import { pickParallelBatch } from './scope.js';

/** 默认最大监督迭代轮次。 */
export const DEFAULT_MAX_ITERATIONS = 12;

const SUPERVISOR_SYSTEM = `你是多智能体编排监督者（Supervisor）。根据用户任务、可用智能体列表、以及已完成步骤的产出，决定下一步行动。

你必须在回复末尾输出唯一一个 JSON 决策块（fenced code block）：

\`\`\`supervisor-decision
{
  "action": "run" | "parallel" | "done",
  "agents": [{ "agentId": "<id>", "task": "<给该智能体的具体任务>" }],
  "reason": "<简短说明>"
}
\`\`\`

规则：
- action=done：任务已完成或无法继续，agents 可为空
- action=run：调用单个智能体
- action=parallel：同时调用多个智能体（仅当它们写不同文件域或只读时）
- task 要具体、可执行，引用已完成步骤的关键结论
- 优先让 producesCode 的智能体写代码，只读智能体做 review/test
- 不要重复已完成的工作
- 若已有足够产出满足用户目标，应 done`;

/**
 * 从监督者输出解析决策。
 * @param {string} raw
 */
export function parseSupervisorDecision(raw) {
  const text = typeof raw === 'string' ? raw : '';
  const m = text.match(/```supervisor-decision\s*\n([\s\S]*?)\n```/);
  if (m) {
    try {
      const parsed = JSON.parse(m[1]);
      const action = ['run', 'parallel', 'done'].includes(parsed.action) ? parsed.action : 'done';
      const agents = Array.isArray(parsed.agents)
        ? parsed.agents
          .filter((a) => a && a.agentId)
          .map((a) => ({ agentId: String(a.agentId), task: String(a.task || '').slice(0, 8000) }))
          .slice(0, 8)
        : [];
      return { action, agents, reason: String(parsed.reason || '').slice(0, 500), raw: text };
    } catch {
      /* fall through */
    }
  }
  return { action: 'done', agents: [], reason: '无法解析监督者决策，结束任务', raw: text };
}

/**
 * 开放任务：Supervisor 动态调度智能体池。
 *
 * ctx.executeNode 必须由上层注入。
 */
export async function executeSupervisor(ctx, callbacks = {}) {
  if (typeof ctx.executeNode !== 'function') {
    throw new Error('executeSupervisor 需要 ctx.executeNode(agent, task, nodeCtx, streamCallbacks)');
  }

  const {
    input,
    workDir,
    agentPool,
    supervisorAgentId,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    signal,
    getAgent,
    scanFiles,
  } = ctx;

  const pool = (agentPool || []).filter((id) => getAgent(id));
  if (pool.length === 0) {
    throw new Error('Supervisor 模式需要至少一个可用智能体');
  }

  const supervisorAgent = resolveSupervisorAgent(supervisorAgentId, pool, getAgent);
  const blackboard = new Blackboard(input);
  const decisions = [];
  let stepCounter = 0;

  callbacks.onSupervisorStart?.({ agentPool: pool, supervisorId: supervisorAgent.id, maxIterations });

  for (let iter = 0; iter < maxIterations; iter++) {
    if (signal?.aborted) break;

    const decision = await requestDecision(supervisorAgent, {
      input,
      pool,
      getAgent,
      blackboard,
      iter,
      decisions,
      scanFiles,
    }, { workDir, signal, uid: ctx.uid, executeNode: ctx.executeNode }, callbacks);

    decisions.push(decision);
    callbacks.onSupervisorDecision?.({ iteration: iter, ...decision });

    if (decision.action === 'done' || decision.agents.length === 0) break;

    const tasks = decision.action === 'run' ? decision.agents.slice(0, 1) : decision.agents;
    const nodes = tasks.map((t) => {
      stepCounter += 1;
      const agent = getAgent(t.agentId);
      return {
        id: `sup-${stepCounter}`,
        agentId: t.agentId,
        taskTemplate: t.task,
        dependsOn: [],
        condition: '',
        retry: { maxAttempts: 1, backoffMs: 0 },
        timeoutMs: ctx.defaultTimeoutMs || 0,
        fileScope: agent?.defaultFileScope || [],
        readOnly: agent?.readOnly === true,
        onFailure: 'continue',
        _adhocTask: t.task,
      };
    });

    const activeWriters = [];
    const batch = pickParallelBatch(nodes, activeWriters);
    const toRun = batch.length > 0 ? batch : nodes.slice(0, 1);

    await Promise.all(toRun.map((node) => runSupervisorNode(node, ctx, blackboard, callbacks)));
  }

  return { blackboard, decisions };
}

function resolveSupervisorAgent(supervisorAgentId, pool, getAgent) {
  if (supervisorAgentId) {
    const a = getAgent(supervisorAgentId);
    if (a) return { ...a, systemPrompt: SUPERVISOR_SYSTEM + '\n\n' + (a.systemPrompt || '') };
  }
  const first = getAgent(pool[0]);
  return {
    id: '__supervisor__',
    name: 'Supervisor',
    cliId: first?.cliId || 'claude',
    systemPrompt: SUPERVISOR_SYSTEM,
    model: first?.model || '',
  };
}

async function requestDecision(supervisorAgent, ctx, runCtx, callbacks) {
  const { input, pool, getAgent, blackboard, iter, decisions, scanFiles } = ctx;
  const agentLines = pool.map((id) => {
    const a = getAgent(id);
    return `- ${id}: ${a?.name || id} (${a?.cliId || '?'})${a?.producesCode ? ' [写代码]' : ''}${a?.readOnly ? ' [只读]' : ''}`;
  }).join('\n');

  const doneLines = Object.entries(blackboard.nodes).map(([nid, r]) => {
    const c = r.contract;
    return `### ${nid}\nexitCode=${r.exitCode} status=${r.status}\nsummary: ${c?.summary || '(无)'}\nfiles: ${(c?.files || []).join(', ') || '(无)'}`;
  }).join('\n\n') || '(尚无已完成步骤)';

  const prevDecisions = decisions.slice(-5).map((d, i) => `${i + 1}. ${d.action}: ${d.reason}`).join('\n') || '(无)';

  const prompt = renderTask(`【用户任务】
{{input}}

【可用智能体】
${agentLines}

【已完成步骤】
${doneLines}

【工作区文件】
{{workspace_files}}

【历史决策】
${prevDecisions}

【当前轮次】第 ${iter + 1} 轮

请决定下一步：调用哪些智能体、各自做什么；或声明 done。`, {
    input,
    prevContract: null,
    blackboardView: blackboard.view(),
    workspaceFiles: scanFiles ? scanFiles().map((f) => f.path) : [],
  });

  callbacks.onSupervisorThinking?.({ iteration: iter });

  const { output } = await runCtx.executeNode(supervisorAgent, prompt, {
    workDir: runCtx.workDir,
    signal: runCtx.signal,
    uid: runCtx.uid,
    timeoutMs: runCtx.timeoutMs || 3 * 60 * 1000,
  }, {
    onDelta: (text) => callbacks.onSupervisorDelta?.({ iteration: iter, text }),
    onStatus: (text) => callbacks.onSupervisorStatus?.({ iteration: iter, text }),
  });

  return parseSupervisorDecision(output);
}

async function runSupervisorNode(node, ctx, blackboard, callbacks) {
  const agent = ctx.getAgent(node.agentId);
  if (!agent) {
    const result = errorResult(`智能体不存在: ${node.agentId}`);
    blackboard.setNode(node.id, result);
    callbacks.onNodeError?.(node, new Error(result.contract.summary));
    return;
  }

  callbacks.onNodeStart?.(node, 1);

  const workspaceFiles = ctx.scanFiles ? ctx.scanFiles().map((f) => f.path) : [];
  const task = node._adhocTask || renderTask(node.taskTemplate, {
    input: ctx.input,
    prevContract: mergePrevContracts(node, blackboard),
    blackboardView: blackboard.view(),
    workspaceFiles,
  });

  const startedAt = Date.now();
  try {
    const res = await ctx.executeNode(agent, task, {
      workDir: ctx.workDir,
      signal: ctx.signal,
      uid: ctx.uid,
      timeoutMs: node.timeoutMs || ctx.defaultTimeoutMs || 0,
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
    blackboard.setNode(node.id, result);
    callbacks.onNodeDone?.(node, result);
  } catch (err) {
    const result = errorResult(err.message || String(err));
    blackboard.setNode(node.id, result);
    callbacks.onNodeError?.(node, err);
  }
}

function mergePrevContracts(node, blackboard) {
  const deps = node.dependsOn?.length ? node.dependsOn : Object.keys(blackboard.nodes);
  const parts = [];
  const files = [];
  for (const depId of deps) {
    const c = blackboard.nodes[depId]?.contract;
    if (c?.summary) parts.push(`[${depId}] ${c.summary}`);
    if (c?.files?.length) files.push(...c.files);
  }
  if (parts.length === 0) return null;
  return {
    summary: parts.join('\n\n'),
    files: [...new Set(files)],
    notes: '',
    raw: parts.join('\n\n'),
  };
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
