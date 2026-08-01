import fs from 'node:fs';
import path from 'node:path';
import { getAdapter, INSTRUCTION_FILES } from '../../cli/index.js';
import { parseAgentOutput } from '../../orchestrator/contract.js';

/**
 * 智能体执行器 —— 编排层与 CLI 适配器层之间的桥梁。
 *
 * 一个"智能体"= 身份（name/emoji/角色）+ 绑定（cliId + systemPrompt + model）。
 * executeAgent 负责把智能体绑定到对应的 CLI 适配器并运行，返回结构化产物。
 *
 * 编排层只调 executeAgent，不直接接触 CLI 适配器 —— 这样编排逻辑与 CLI 实现
 * 彻底解耦：换 CLI、加 CLI、改角色注入策略，编排层都不用动。
 */

/**
 * 执行单个智能体。
 *
 * @param {object} agent - 智能体定义 { id, name, cliId, systemPrompt, model }
 * @param {string} task - 已渲染的任务文本（模板插值后）
 * @param {object} ctx
 * @param {string} ctx.workDir - 工作目录
 * @param {AbortSignal} [ctx.signal]
 * @param {number|null} [ctx.uid] - 沙箱用户 UID
 * @param {number} [ctx.timeoutMs] - 单步超时
 * @param {object} [callbacks]
 * @param {(text:string)=>void} [callbacks.onDelta]
 * @param {(text:string)=>void} [callbacks.onStatus]
 * @returns {Promise<{exitCode:number, output:string, contract:AgentContract}>}
 */
export async function executeAgent(agent, task, ctx, callbacks = {}) {
  const adapter = getAdapter(agent.cliId);
  if (!adapter) {
    throw new Error(`智能体「${agent.name}」绑定的 CLI 不可用: ${agent.cliId}`);
  }

  // 每步开始前清理上一步遗留的指令文件，避免跨 CLI 角色污染。
  cleanInstructionFiles(ctx.workDir);

  const { exitCode, output } = await adapter.run({
    task,
    workDir: ctx.workDir,
    systemPrompt: agent.systemPrompt,
    model: agent.model || undefined,
    callbacks: { onDelta: callbacks.onDelta, onStatus: callbacks.onStatus },
    signal: ctx.signal,
    uid: ctx.uid,
    timeoutMs: ctx.timeoutMs,
  });

  const contract = parseAgentOutput(output);
  return { exitCode, output, contract };
}

/** 清理工作目录里所有指令文件（角色配置，非项目产物）。 */
export function cleanInstructionFiles(workDir) {
  for (const name of INSTRUCTION_FILES) {
    try { fs.unlinkSync(path.join(workDir, name)); } catch { /* 不存在则忽略 */ }
  }
}
