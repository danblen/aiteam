import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { scanWorkspace } from './cli.js';
import { startDevServer } from './preview-dev.js';
import { ensureAdminForSensitive, checkConversationLimit } from './auth.js';
import { ensureIsolatedUser, secureWorkspace } from './user-isolate.js';
import { resolveProjectDir, isWithin, WORKSPACES_DIR } from './env.js';
import {
  listAgents,
  getAgentById,
  createAgent,
  updateAgent,
  deleteAgent,
  listWorkflows,
  getWorkflowById,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  SUPPORTED_CLIS,
} from './agents-store.js';
import {
  compileGraph,
  executeGraph,
  executeSupervisor,
  validateGraph,
  DEFAULT_STEP_TIMEOUT_MS,
} from '../orchestrator/index.js';
import { executeAgent } from './agents/runner.js';
import { listAdapters, availableClis } from '../cli/index.js';
import {
  createRun,
  appendRunEvent,
  getRun,
  getEventsSince,
  abortRun,
  finishRun,
  getAbortSignal,
} from './run-log.js';

/**
 * 多智能体编排 —— API 层。
 *
 * 运行模式：
 *   - workflow：预定义工作流（DAG，支持并行 + fileScope）
 *   - agents：ad-hoc 智能体序列
 *   - supervisor：开放任务，监督者动态调度智能体池
 */

function sendSSE(res, event, data, runId) {
  if (res.writableEnded) return;
  if (runId) {
    const appended = appendRunEvent(runId, event, data);
    if (appended) {
      res.write(appended.frame);
      return;
    }
  }
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function buildPlan(req, { task, agentIds, workflowId }) {
  const plan = [];
  const warnings = [];

  if (workflowId) {
    const wf = getWorkflowById(req, workflowId);
    if (!wf) {
      return { plan, warnings: ['工作流不存在或已被删除'], workflow: null };
    }
    for (const step of wf.steps) {
      const agent = getAgentById(req, step.agentId);
      if (!agent) {
        warnings.push(`步骤「${step.id}」引用的智能体已删除，已跳过`);
        continue;
      }
      plan.push({ agent, taskTemplate: step.taskTemplate || '', step });
    }
    return { plan, warnings, workflow: wf };
  }

  const ids = Array.isArray(agentIds) ? agentIds.filter(Boolean) : [];
  for (const id of ids) {
    const agent = getAgentById(req, id);
    if (!agent) {
      warnings.push(`智能体「${id}」不存在，已跳过`);
      continue;
    }
    plan.push({
      agent,
      taskTemplate: '',
      step: {
        id: `adhoc-${plan.length}`,
        agentId: id,
        taskTemplate: '',
        dependsOn: [],
        condition: '',
        retry: { maxAttempts: 1, backoffMs: 0 },
        timeoutMs: 0,
        fileScope: agent.defaultFileScope || [],
        readOnly: agent.readOnly === true,
        onFailure: 'continue',
      },
    });
  }
  return { plan, warnings, workflow: null };
}

function makeCallbacks(res, runId, graph, getAgent, workDir) {
  return {
    onPlan: () => {},
    onNodeStart: (node, attempt) => {
      const a = getAgent(node.agentId) || {};
      const idx = graph?.nodes?.findIndex((n) => n.id === node.id) ?? -1;
      sendSSE(res, 'agent_start', {
        index: idx, total: graph?.nodes?.length ?? 0, nodeId: node.id,
        agentId: node.agentId, agentName: a.name || node.agentId,
        emoji: a.emoji || '🤖', color: a.color || '#9aa4b6', cliId: a.cliId || '',
        attempt, readOnly: node.readOnly, fileScope: node.fileScope || [],
      }, runId);
      sendSSE(res, 'status', {
        text: `[${idx >= 0 ? idx + 1 : '?'}] ${a.emoji || ''} ${a.name || node.agentId} 开始${attempt > 1 ? `（第 ${attempt} 次）` : ''}…`,
        nodeId: node.id, agentId: node.agentId,
      }, runId);
    },
    onNodeDelta: (node, text) => {
      const idx = graph?.nodes?.findIndex((n) => n.id === node.id) ?? -1;
      sendSSE(res, 'delta', { text, index: idx, nodeId: node.id, agentId: node.agentId }, runId);
    },
    onNodeStatus: (node, text) => {
      sendSSE(res, 'status', { text, nodeId: node.id, agentId: node.agentId }, runId);
    },
    onNodeDone: (node, result) => {
      const idx = graph?.nodes?.findIndex((n) => n.id === node.id) ?? -1;
      const a = getAgent(node.agentId) || {};
      const files = scanWorkspace(workDir);
      sendSSE(res, 'node_files', { nodeId: node.id, index: idx, files: files.map((f) => f.path) }, runId);
      sendSSE(res, 'agent_done', {
        index: idx, total: graph?.nodes?.length ?? 0, nodeId: node.id,
        agentId: node.agentId, agentName: a.name || node.agentId,
        exitCode: result.exitCode, output: result.output,
        status: result.status, durationMs: result.durationMs,
        contract: result.contract,
      }, runId);
    },
    onNodeSkipped: (node) => {
      const idx = graph?.nodes?.findIndex((n) => n.id === node.id) ?? -1;
      const a = getAgent(node.agentId) || {};
      sendSSE(res, 'node_skipped', { nodeId: node.id, index: idx, agentId: node.agentId, agentName: a.name || node.agentId }, runId);
      sendSSE(res, 'status', { text: `[${idx + 1}] ${a.name || node.agentId} 被跳过`, nodeId: node.id, agentId: node.agentId }, runId);
    },
    onNodeError: (node, err) => {
      const idx = graph?.nodes?.findIndex((n) => n.id === node.id) ?? -1;
      sendSSE(res, 'error', {
        text: `${getAgent(node.agentId)?.name || node.agentId} 失败: ${err.message || err}`,
        index: idx, nodeId: node.id, agentId: node.agentId,
      }, runId);
    },
    onSupervisorStart: (info) => {
      sendSSE(res, 'supervisor_start', info, runId);
    },
    onSupervisorDecision: (info) => {
      sendSSE(res, 'supervisor_decision', info, runId);
    },
    onSupervisorDelta: (info) => {
      sendSSE(res, 'delta', { text: info.text, index: -1, nodeId: 'supervisor', agentId: 'supervisor' }, runId);
    },
    onSupervisorStatus: (info) => {
      sendSSE(res, 'status', { text: info.text, nodeId: 'supervisor' }, runId);
    },
  };
}

async function runOrchestration(req, res, params) {
  const {
    task, agentIds, workflowId, sid, reqWorkDir, projectName, direct,
    mode = 'agents', supervisorAgentId, maxIterations,
  } = params;

  const runMode = mode === 'supervisor' ? 'supervisor'
    : (workflowId ? 'workflow' : 'agents');

  const { plan, warnings, workflow } = buildPlan(req, { task, agentIds, workflowId });

  if (runMode === 'supervisor') {
    const pool = Array.isArray(agentIds) ? agentIds.filter(Boolean) : [];
    if (pool.length === 0) {
      return { error: 'Supervisor 模式需要选择至少一个智能体作为执行池', status: 400 };
    }
  } else if (plan.length === 0) {
    return { error: warnings[0] || '没有可执行的智能体', status: 400 };
  }

  const workDir = resolveProjectDir(reqWorkDir, projectName, sid, req.user?.email, direct);
  if (!isWithin(WORKSPACES_DIR, workDir) && !ensureAdminForSensitive(req, res)) {
    return { error: 'forbidden', status: 403 };
  }
  fs.mkdirSync(workDir, { recursive: true });

  const runRec = createRun({ sid, task, mode: runMode, workflowId, agentIds });
  const runId = runRec.id;
  const signal = getAbortSignal(runId);

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // 断线不中止：仅显式 POST /abort 或客户端 AbortSignal（同连接）才中止
  sendSSE(res, 'run_start', { runId, mode: runMode }, runId);

  const { uid, ok: isolateOk } = ensureIsolatedUser(sid);
  if (!isolateOk) {
    sendSSE(res, 'error', { text: '沙箱用户池已满，无法执行新任务。请稍后再试或关闭未使用的会话。' }, runId);
    finishRun(runId, 'failed');
    res.end();
    return {};
  }
  if (uid !== null) secureWorkspace(workDir, uid, sid);

  const agentMap = new Map(plan.map((p) => [p.agent.id, p.agent]));
  for (const id of (agentIds || [])) {
    const a = getAgentById(req, id);
    if (a) agentMap.set(a.id, a);
  }
  const getAgent = (id) => agentMap.get(id) || getAgentById(req, id) || null;

  let graph = null;
  if (runMode !== 'supervisor') {
    graph = compileGraph({ plan, workflow });
    const validation = validateGraph(graph);
    if (!validation.ok) {
      sendSSE(res, 'error', { text: validation.errors.join('；') }, runId);
      finishRun(runId, 'failed');
      res.end();
      return {};
    }
    for (const w of validation.warnings) sendSSE(res, 'status', { text: w }, runId);
  }

  for (const w of warnings) sendSSE(res, 'status', { text: w }, runId);

  const callbacks = makeCallbacks(res, runId, graph, getAgent, workDir);
  const execCtx = {
    input: task,
    workDir,
    signal,
    uid,
    getAgent,
    executeNode: executeAgent,
    scanFiles: () => scanWorkspace(workDir),
    defaultTimeoutMs: DEFAULT_STEP_TIMEOUT_MS,
  };

  try {
    if (runMode === 'supervisor') {
      const pool = Array.isArray(agentIds) ? agentIds.filter(Boolean) : [];
      sendSSE(res, 'status', { text: `Supervisor 开放任务模式：智能体池 ${pool.length} 个，最多 ${maxIterations || 12} 轮…` }, runId);
      const { blackboard, decisions } = await executeSupervisor({
        ...execCtx,
        agentPool: pool,
        supervisorAgentId,
        maxIterations: maxIterations || undefined,
      }, callbacks);

      if (signal?.aborted) {
        sendSSE(res, 'status', { text: '任务已被中止' }, runId);
        finishRun(runId, 'aborted');
        res.end();
        return {};
      }

      const files = scanWorkspace(workDir);
      sendSSE(res, 'status', { text: `Supervisor 完成 ${decisions.length} 轮决策，扫描到 ${files.length} 个文件` }, runId);
      await finishWithPreview(res, runId, sid, workDir, files);
      return {};
    }

    sendSSE(res, 'plan', {
      workflow: workflow ? { id: workflow.id, name: workflow.name, emoji: workflow.emoji, color: workflow.color } : null,
      steps: graph.nodes.map((n, i) => {
        const a = getAgent(n.agentId) || {};
        return {
          index: i,
          nodeId: n.id,
          agentId: n.agentId,
          agentName: a.name || n.agentId,
          emoji: a.emoji || '🤖',
          color: a.color || '#9aa4b6',
          cliId: a.cliId || '',
          dependsOn: n.dependsOn,
          readOnly: n.readOnly,
          fileScope: n.fileScope,
        };
      }),
      total: graph.nodes.length,
    }, runId);

    sendSSE(res, 'status', { text: `将在 ${workDir} 中编排执行 ${graph.nodes.length} 个节点（支持并行）…` }, runId);

    const { blackboard, aborted } = await executeGraph(graph, execCtx, callbacks);

    if (signal?.aborted || aborted) {
      sendSSE(res, 'status', { text: '多智能体执行已被中止' }, runId);
      finishRun(runId, 'aborted');
      res.end();
      return {};
    }

    const files = scanWorkspace(workDir);
    const doneCount = Object.values(blackboard.nodes).filter((r) => r.status === 'done').length;
    const skipCount = Object.values(blackboard.nodes).filter((r) => r.status === 'skipped').length;
    sendSSE(res, 'status', { text: `编排完成：${doneCount} 成功 / ${skipCount} 跳过，扫描到 ${files.length} 个文件` }, runId);
    await finishWithPreview(res, runId, sid, workDir, files);
    return {};
  } catch (err) {
    if (signal?.aborted) {
      sendSSE(res, 'status', { text: '多智能体执行已被中止' }, runId);
      finishRun(runId, 'aborted');
    } else {
      sendSSE(res, 'error', { text: err.message || '多智能体执行失败' }, runId);
      finishRun(runId, 'failed');
    }
    if (!res.writableEnded) res.end();
    return {};
  }
}

async function finishWithPreview(res, runId, sid, workDir, files) {
  let previewUrl = null;
  if (files.length > 0) {
    try {
      previewUrl = await startDevServer(sid, workDir);
      sendSSE(res, 'status', { text: '预览已就绪' }, runId);
    } catch (err) {
      sendSSE(res, 'status', { text: `启动预览: ${err.message}` }, runId);
    }
  }
  sendSSE(res, 'done', { files, previewUrl, workDir, runId }, runId);
  finishRun(runId, 'done');
  if (!res.writableEnded) res.end();
}

/** @param {express.Application} app */
export function mountMultiAgent(app) {
  app.get('/api/agents', async (req, res) => {
    const installed = await availableClis().catch(() => []);
    res.json({
      ok: true,
      agents: listAgents(req),
      supportedClis: SUPPORTED_CLIS,
      adapters: listAdapters(),
      installedClis: installed,
    });
  });

  app.post('/api/agents', async (req, res) => {
    const agent = await createAgent(req, req.body || {});
    res.json({ ok: true, agent });
  });

  app.put('/api/agents/:id', async (req, res) => {
    const updated = await updateAgent(req, req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: '智能体不存在' });
    res.json({ ok: true, agent: updated });
  });

  app.delete('/api/agents/:id', async (req, res) => {
    const ok = await deleteAgent(req, req.params.id);
    if (!ok) return res.status(404).json({ error: '智能体不存在' });
    res.json({ ok: true });
  });

  app.get('/api/workflows', (req, res) => {
    res.json({ ok: true, workflows: listWorkflows(req), agents: listAgents(req) });
  });

  app.post('/api/workflows', async (req, res) => {
    const wf = await createWorkflow(req, req.body || {});
    res.json({ ok: true, workflow: wf });
  });

  app.put('/api/workflows/:id', async (req, res) => {
    const updated = await updateWorkflow(req, req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: '工作流不存在' });
    res.json({ ok: true, workflow: updated });
  });

  app.delete('/api/workflows/:id', async (req, res) => {
    const ok = await deleteWorkflow(req, req.params.id);
    if (!ok) return res.status(404).json({ error: '工作流不存在' });
    res.json({ ok: true });
  });

  // 显式中止 run（断线不会触发此逻辑）
  app.post('/api/multi-agent/abort', (req, res) => {
    const { runId } = req.body || {};
    if (!runId) return res.status(400).json({ error: '缺少 runId' });
    const ok = abortRun(runId);
    res.json({ ok, aborted: ok });
  });

  // SSE 断线重连：重放 runId 下 since 之后的事件
  app.get('/api/multi-agent/run/:runId/events', (req, res) => {
    const since = Number(req.query.since) || Number(req.headers['last-event-id']) || 0;
    const replay = getEventsSince(req.params.runId, since);
    if (!replay) return res.status(404).json({ error: 'run 不存在或已过期' });

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    for (const ev of replay.events) {
      res.write(`id: ${ev.id}\nevent: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`);
    }
    if (replay.status !== 'running') {
      res.end();
    }
  });

  app.post('/api/multi-agent/run', async (req, res) => {
    const {
      task, agentIds, workflowId, sid, workDir: reqWorkDir, projectName, direct,
      mode, supervisorAgentId, maxIterations,
    } = req.body || {};

    if (!task || !sid) {
      return res.status(400).json({ error: '缺少参数: task, sid' });
    }

    const runMode = mode === 'supervisor' ? 'supervisor'
      : (workflowId ? 'workflow' : 'agents');

    if (runMode === 'supervisor') {
      if (!Array.isArray(agentIds) || agentIds.filter(Boolean).length === 0) {
        return res.status(400).json({ error: 'Supervisor 模式需要选择智能体池（agentIds）' });
      }
    } else if (!workflowId && (!Array.isArray(agentIds) || agentIds.filter(Boolean).length === 0)) {
      return res.status(400).json({ error: '请至少选择一个智能体或一个工作流' });
    }

    if (!checkConversationLimit(req, res)) return;

    const result = await runOrchestration(req, res, {
      task, agentIds, workflowId, sid,
      reqWorkDir, projectName, direct,
      mode: runMode, supervisorAgentId, maxIterations,
    });

    if (result.error && result.status) {
      return res.status(result.status).json({ error: result.error });
    }
  });
}
