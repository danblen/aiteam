import type { ProjectFile } from '../types';
import { BASE_PREFIX, getAuthToken, apiUrl, apiHeaders } from '../api';

/**
 * 多智能体执行器：消费 /api/multi-agent/run 的 SSE 流。
 *
 * 与单 CLI 模式的 ExecutionEnvironment.run(task, agentId) 不同，多智能体一次
 * 运行多个 agent，因此用独立的事件类型（带 index/agentId 归属）与独立 runner。
 * 本地模式打到本机后端；云端模式打到远端部署实例（同 RemoteEnvironment 的做法）。
 */

/** 执行计划中一步的摘要（plan 事件下发，前端据此渲染进度条）。 */
export interface PlanStep {
  index: number;
  agentId: string;
  agentName: string;
  emoji: string;
  color: string;
  cliId: string;
}

/** 工作流摘要（若本次执行的是工作流）。 */
export interface PlanWorkflow {
  id: string;
  name: string;
  emoji: string;
  color: string;
}

/** 多智能体流式事件。 */
export type MultiAgentEvent =
  | { type: 'plan'; steps: PlanStep[]; total: number; workflow: PlanWorkflow | null }
  | {
      type: 'agent_start';
      index: number;
      total: number;
      agentId: string;
      agentName: string;
      emoji: string;
      color: string;
      cliId: string;
    }
  | { type: 'delta'; text: string; index: number; agentId: string }
  | { type: 'status'; text: string; index?: number; agentId?: string }
  | {
      type: 'agent_done';
      index: number;
      total: number;
      agentId: string;
      agentName: string;
      exitCode: number;
      output: string;
    }
  | { type: 'done'; files: ProjectFile[]; previewUrl: string | null; workDir?: string }
  | { type: 'error'; text: string; index?: number; agentId?: string };

/** 运行参数。 */
export interface MultiAgentRunParams {
  task: string;
  /** ad-hoc 智能体序列；与 workflowId 二选一。 */
  agentIds?: string[];
  /** 预定义工作流；与 agentIds 二选一。 */
  workflowId?: string;
  sid: string;
  workDir?: string;
  projectName?: string;
  direct?: boolean;
  /** 远端目标（remote 模式）；为空时打到本地后端。 */
  remoteUrl?: string;
  remoteToken?: string;
}

/** 解析一个 SSE frame，返回 {event, payload} 或 null。 */
function parseFrame(frame: string): { event: string; payload: Record<string, unknown> } | null {
  let event = 'message';
  let dataLine = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLine += line.slice(5).trim();
  }
  if (!dataLine) return null;
  try {
    return { event, payload: JSON.parse(dataLine) };
  } catch {
    return null;
  }
}

/** 把后端事件映射为前端 MultiAgentEvent。 */
function mapEvent(event: string, p: Record<string, unknown>): MultiAgentEvent | null {
  const str = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : '');
  const num = (k: string) => (typeof p[k] === 'number' ? (p[k] as number) : 0);
  switch (event) {
    case 'plan':
      return {
        type: 'plan',
        steps: (p.steps as PlanStep[]) || [],
        total: num('total'),
        workflow: (p.workflow as PlanWorkflow | null) || null,
      };
    case 'agent_start':
      return {
        type: 'agent_start',
        index: num('index'),
        total: num('total'),
        agentId: str('agentId'),
        agentName: str('agentName'),
        emoji: str('emoji'),
        color: str('color'),
        cliId: str('cliId'),
      };
    case 'delta':
      return { type: 'delta', text: str('text'), index: num('index'), agentId: str('agentId') };
    case 'status':
      return { type: 'status', text: str('text'), index: num('index'), agentId: str('agentId') };
    case 'agent_done':
      return {
        type: 'agent_done',
        index: num('index'),
        total: num('total'),
        agentId: str('agentId'),
        agentName: str('agentName'),
        exitCode: num('exitCode'),
        output: str('output'),
      };
    case 'done': {
      const files = (p.files || []) as ProjectFile[];
      const previewUrl = typeof p.previewUrl === 'string' ? (p.previewUrl as string) : null;
      const workDir = typeof p.workDir === 'string' ? (p.workDir as string) : undefined;
      return { type: 'done', files, previewUrl, workDir };
    }
    case 'error':
      return { type: 'error', text: str('text'), index: num('index'), agentId: str('agentId') };
    default:
      return null;
  }
}

/**
 * 执行多智能体任务，流式产出事件。
 *
 * @param params 任务与目标参数
 * @param signal 中止信号
 */
export async function* runMultiAgent(
  params: MultiAgentRunParams,
  signal: AbortSignal,
): AsyncIterable<MultiAgentEvent> {
  const { task, agentIds, workflowId, sid, workDir, projectName, direct, remoteUrl, remoteToken } = params;

  // 远端模式：直接打到远端实例的 /api/multi-agent/run。
  // 本地模式：经 apiUrl() 走当前（可能被 setApiConfig 重定向的）前缀。
  let url: string;
  let headers: Record<string, string>;
  if (remoteUrl) {
    const base = remoteUrl.replace(/\/+$/, '');
    url = `${base}${BASE_PREFIX}/api/multi-agent/run`;
    headers = { 'Content-Type': 'application/json' };
    const bearer = remoteToken || getAuthToken();
    if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  } else {
    url = apiUrl('/api/multi-agent/run');
    headers = apiHeaders({ 'Content-Type': 'application/json' });
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ task, agentIds, workflowId, sid, workDir, projectName, direct }),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    yield { type: 'error', text: (err as Error).message || '网络请求失败' };
    return;
  }

  if (!res.ok || !res.body) {
    const msg =
      res.status === 500
        ? (await res.json().catch(() => ({ error: '服务器错误' }))).error
        : `请求失败 (${res.status})`;
    yield { type: 'error', text: msg };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split('\n\n');
      buffer = frames.pop() || '';

      for (const frame of frames) {
        const parsed = parseFrame(frame);
        if (!parsed) continue;
        const ev = mapEvent(parsed.event, parsed.payload);
        if (ev) {
          yield ev;
          // done / error 是终止事件。
          if (ev.type === 'done' || ev.type === 'error') return;
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      yield { type: 'status', text: '已中止' };
    } else {
      yield { type: 'error', text: (err as Error).message || '读取流失败' };
    }
  }
}
