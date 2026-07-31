import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { runCLI, scanWorkspace } from './cli.js';
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

/**
 * 多智能体云模式编排：
 *   /api/agents         CRUD 自定义智能体（CLI + 自定义 system prompt + model）
 *   /api/workflows      CRUD 工作流（有序步骤，每步绑定一个智能体 + 任务模板）
 *   /api/multi-agent/run  SSE：顺序执行多个智能体 / 一个工作流，线程化产出
 *
 * 与单 CLI 模式（/api/env/local/run）共享同一套工作目录、沙箱隔离、预览机制，
 * 区别在于：按用户选定的「智能体序列」依次运行，每步把上一步产出带入下一步，
 * 最终统一扫描文件 + 启动预览。
 */

function sendSSE(res, event, data) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * 解析并校验前端选定的智能体 / 工作流，返回「执行计划」：
 *   [{ agent, task }, ...]
 * - 传 workflowId：按工作流步骤解析，taskTemplate 用 {{input}} / {{prev}} 插值
 * - 否则用 agentIds：第一个 agent 直接吃用户任务，后续 agent 带上前序产出
 * 缺失的 agent 会被跳过并发出告警（不阻断流程）。
 */
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
      plan.push({ agent, taskTemplate: step.taskTemplate || '' });
    }
    return { plan, warnings, workflow: wf };
  }

  // ad-hoc 智能体序列
  const ids = Array.isArray(agentIds) ? agentIds.filter(Boolean) : [];
  for (const id of ids) {
    const agent = getAgentById(req, id);
    if (!agent) {
      warnings.push(`智能体「${id}」不存在，已跳过`);
      continue;
    }
    plan.push({ agent, taskTemplate: '' });
  }
  return { plan, warnings, workflow: null };
}

/**
 * 把任务模板插值成实际任务文本。
 *   {{input}} → 用户原始输入
 *   {{prev}}  → 上一个智能体的产出
 * 无模板时：首步用用户输入，后续步把前序产出拼进任务。
 */
function renderTask(template, userInput, prevOutput) {
  if (!template || !template.trim()) {
    if (!prevOutput) return userInput;
    return `${userInput}\n\n【上一个智能体的产出】\n${prevOutput}`;
  }
  return template
    .replace(/\{\{\s*input\s*\}\}/g, userInput || '')
    .replace(/\{\{\s*prev\s*\}\}/g, prevOutput || '');
}

/**
 * 挂载多智能体相关路由。
 * @param {express.Application} app
 */
export function mountMultiAgent(app) {
  // ===================== Custom Agents CRUD =====================

  app.get('/api/agents', (req, res) => {
    res.json({ ok: true, agents: listAgents(req), supportedClis: SUPPORTED_CLIS });
  });

  app.post('/api/agents', (req, res) => {
    const agent = createAgent(req, req.body || {});
    res.json({ ok: true, agent });
  });

  app.put('/api/agents/:id', (req, res) => {
    const updated = updateAgent(req, req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: '智能体不存在' });
    res.json({ ok: true, agent: updated });
  });

  app.delete('/api/agents/:id', (req, res) => {
    const ok = deleteAgent(req, req.params.id);
    if (!ok) return res.status(404).json({ error: '智能体不存在' });
    res.json({ ok: true });
  });

  // ===================== Workflows CRUD =====================

  app.get('/api/workflows', (req, res) => {
    // 附带 agent 清单，便于前端在编辑器里下拉选择。
    res.json({ ok: true, workflows: listWorkflows(req), agents: listAgents(req) });
  });

  app.post('/api/workflows', (req, res) => {
    const wf = createWorkflow(req, req.body || {});
    res.json({ ok: true, workflow: wf });
  });

  app.put('/api/workflows/:id', (req, res) => {
    const updated = updateWorkflow(req, req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: '工作流不存在' });
    res.json({ ok: true, workflow: updated });
  });

  app.delete('/api/workflows/:id', (req, res) => {
    const ok = deleteWorkflow(req, req.params.id);
    if (!ok) return res.status(404).json({ error: '工作流不存在' });
    res.json({ ok: true });
  });

  // ===================== Multi-agent run (SSE) =====================

  app.post('/api/multi-agent/run', async (req, res) => {
    const { task, agentIds, workflowId, sid, workDir: reqWorkDir, projectName, direct } = req.body || {};
    if (!task || !sid) {
      return res.status(400).json({ error: '缺少参数: task, sid' });
    }
    if (!workflowId && (!Array.isArray(agentIds) || agentIds.filter(Boolean).length === 0)) {
      return res.status(400).json({ error: '请至少选择一个智能体或一个工作流' });
    }

    // 对话次数限制：仅做闸门检查（计数由 /api/conversation/start 统一管理）。
    if (!checkConversationLimit(req, res)) return;

    // 解析执行计划（智能体序列 + 每步任务模板）。
    const { plan, warnings, workflow } = buildPlan(req, { task, agentIds, workflowId });
    if (plan.length === 0) {
      return res.status(400).json({ error: warnings[0] || '没有可执行的智能体' });
    }

    // 解析工作目录（与 /api/env/local/run 完全一致的安全策略）。
    const workDir = resolveProjectDir(reqWorkDir, projectName, sid, req.user?.email, direct);
    if (!isWithin(WORKSPACES_DIR, workDir) && !ensureAdminForSensitive(req, res)) return;
    fs.mkdirSync(workDir, { recursive: true });

    // SSE setup
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const abortController = new AbortController();
    const onClose = () => { if (!res.writableEnded) abortController.abort(); };
    res.on('close', onClose);

    // 沙箱用户隔离（与单 CLI 模式共享同一套池子）。
    const { uid, ok: isolateOk } = ensureIsolatedUser(sid);
    if (!isolateOk) {
      sendSSE(res, 'error', { text: '沙箱用户池已满，无法执行新任务。请稍后再试或关闭未使用的会话。' });
      return res.end();
    }
    if (uid !== null) secureWorkspace(workDir, uid, sid);

    const stepTotal = plan.length;
    sendSSE(res, 'plan', {
      workflow: workflow ? { id: workflow.id, name: workflow.name, emoji: workflow.emoji, color: workflow.color } : null,
      steps: plan.map((p, i) => ({
        index: i,
        agentId: p.agent.id,
        agentName: p.agent.name,
        emoji: p.agent.emoji,
        color: p.agent.color,
        cliId: p.agent.cliId,
      })),
      total: stepTotal,
    });
    for (const w of warnings) sendSSE(res, 'status', { text: w });

    try {
      sendSSE(res, 'status', { text: `将在 ${workDir} 中依次执行 ${stepTotal} 个智能体…` });

      let prevOutput = '';

      for (let i = 0; i < plan.length; i++) {
        if (abortController.signal.aborted) break;
        const { agent, taskTemplate } = plan[i];
        const stepTask = renderTask(taskTemplate, task, prevOutput);

        sendSSE(res, 'agent_start', {
          index: i,
          total: stepTotal,
          agentId: agent.id,
          agentName: agent.name,
          emoji: agent.emoji,
          color: agent.color,
          cliId: agent.cliId,
        });
        sendSSE(res, 'status', { text: `[${i + 1}/${stepTotal}] ${agent.emoji} ${agent.name}（${agent.cliId}）开始工作…` });

        let stepOutput = '';
        let stepExit = 0;
        try {
          stepExit = await runCLI(agent.cliId, stepTask, workDir, {
            onDelta: (text) => {
              stepOutput += text;
              sendSSE(res, 'delta', { text, index: i, agentId: agent.id });
            },
            onStatus: (text) => sendSSE(res, 'status', { text, index: i, agentId: agent.id }),
            signal: abortController.signal,
            uid,
          }, {
            systemPrompt: agent.systemPrompt,
            model: agent.model || undefined,
          });
        } catch (err) {
          if (abortController.signal.aborted) {
            sendSSE(res, 'status', { text: `[${i + 1}/${stepTotal}] 已中止` });
            break;
          }
          sendSSE(res, 'error', { text: `${agent.name} 执行失败: ${err.message || err}`, index: i, agentId: agent.id });
          // 单步失败不阻断整体：把已有产出带入下一步，继续编排。
        }

        sendSSE(res, 'agent_done', {
          index: i,
          total: stepTotal,
          agentId: agent.id,
          agentName: agent.name,
          exitCode: stepExit,
          output: stepOutput,
        });

        // 线程化：把本步产出作为下一步的上下文（截断过长内容，避免 token 爆炸）。
        prevOutput = stepOutput.length > 6000 ? stepOutput.slice(0, 6000) + '\n…（已截断）' : stepOutput;
      }

      if (abortController.signal.aborted) {
        sendSSE(res, 'status', { text: '多智能体执行已被用户中止' });
        return res.end();
      }

      // 统一扫描文件 + 启动预览（与单 CLI 模式一致）。
      const files = scanWorkspace(workDir);
      sendSSE(res, 'status', { text: `全部智能体完成，扫描到 ${files.length} 个文件` });

      let previewUrl = null;
      if (files.length > 0) {
        try {
          previewUrl = await startDevServer(sid, workDir);
          sendSSE(res, 'status', { text: '预览已就绪' });
        } catch (err) {
          sendSSE(res, 'status', { text: `启动预览: ${err.message}` });
        }
      }

      sendSSE(res, 'done', { files, previewUrl, workDir });
    } catch (err) {
      if (abortController.signal.aborted) {
        sendSSE(res, 'status', { text: '多智能体执行已被用户中止' });
      } else {
        sendSSE(res, 'error', { text: err.message || '多智能体执行失败' });
      }
    } finally {
      if (!res.writableEnded) res.end();
      res.off('close', onClose);
    }
  });
}
