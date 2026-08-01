import type { ProjectFile } from '../types';
import type { MultiAgentMode } from './types';
import { BASE_PREFIX, getAuthToken, apiUrl, apiHeaders } from '../api';

/** 执行计划中一步的摘要。 */
export interface PlanStep {
  index: number;
  nodeId: string;
  agentId: string;
  agentName: string;
  cliId: string;
  dependsOn: string[];
  readOnly?: boolean;
  fileScope?: string[];
}

export interface PlanWorkflow {
  id: string;
  name: string;
}

export interface AgentContract {
  summary: string;
  files: string[];
  notes: string;
  raw: string;
}

export interface NodeResult {
  exitCode: number;
  output: string;
  contract: AgentContract;
  status: 'done' | 'skipped' | 'error';
  durationMs: number;
}

export type MultiAgentEvent =
  | { type: 'run_start'; runId: string; mode: MultiAgentMode }
  | { type: 'plan'; steps: PlanStep[]; total: number; workflow: PlanWorkflow | null }
  | {
      type: 'agent_start';
      index: number;
      total: number;
      nodeId: string;
      agentId: string;
      agentName: string;
      cliId: string;
      attempt?: number;
      readOnly?: boolean;
      fileScope?: string[];
    }
  | { type: 'delta'; text: string; index: number; nodeId?: string; agentId: string }
  | { type: 'status'; text: string; index?: number; nodeId?: string; agentId?: string }
  | {
      type: 'agent_done';
      index: number;
      total: number;
      nodeId: string;
      agentId: string;
      agentName: string;
      exitCode: number;
      output: string;
      status?: NodeResult['status'];
      durationMs?: number;
      contract?: AgentContract;
    }
  | { type: 'node_skipped'; nodeId: string; index: number; agentId: string; agentName: string }
  | { type: 'node_files'; nodeId: string; index: number; files: string[] }
  | { type: 'supervisor_start'; agentPool: string[]; supervisorId: string; maxIterations: number }
  | { type: 'supervisor_decision'; iteration: number; action: string; reason: string; agents: { agentId: string; task: string }[] }
  | { type: 'done'; files: ProjectFile[]; previewUrl: string | null; workDir?: string; runId?: string }
  | { type: 'error'; text: string; index?: number; nodeId?: string; agentId?: string };

export interface MultiAgentRunParams {
  task: string;
  mode?: MultiAgentMode;
  agentIds?: string[];
  workflowId?: string;
  supervisorAgentId?: string;
  maxIterations?: number;
  sid: string;
  workDir?: string;
  projectName?: string;
  direct?: boolean;
  remoteUrl?: string;
  remoteToken?: string;
}

function parseFrame(frame: string): { event: string; payload: Record<string, unknown>; eventId?: number } | null {
  let event = 'message';
  let dataLine = '';
  let eventId: number | undefined;
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLine += line.slice(5).trim();
    else if (line.startsWith('id:')) eventId = Number(line.slice(3).trim()) || undefined;
  }
  if (!dataLine) return null;
  try {
    return { event, payload: JSON.parse(dataLine), eventId };
  } catch {
    return null;
  }
}

function mapEvent(event: string, p: Record<string, unknown>): MultiAgentEvent | null {
  const str = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : '');
  const num = (k: string) => (typeof p[k] === 'number' ? (p[k] as number) : 0);
  const strArr = (k: string) => (Array.isArray(p[k]) ? (p[k] as string[]) : []);
  const obj = (k: string) => (p[k] && typeof p[k] === 'object' ? (p[k] as Record<string, unknown>) : undefined);
  const bool = (k: string) => p[k] === true;

  switch (event) {
    case 'run_start':
      return { type: 'run_start', runId: str('runId'), mode: (str('mode') as MultiAgentMode) || 'agents' };
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
        nodeId: str('nodeId'),
        agentId: str('agentId'),
        agentName: str('agentName'),
        cliId: str('cliId'),
        attempt: num('attempt') || undefined,
        readOnly: bool('readOnly'),
        fileScope: strArr('fileScope'),
      };
    case 'delta':
      return { type: 'delta', text: str('text'), index: num('index'), nodeId: str('nodeId') || undefined, agentId: str('agentId') };
    case 'status':
      return { type: 'status', text: str('text'), index: num('index'), nodeId: str('nodeId') || undefined, agentId: str('agentId') || undefined };
    case 'agent_done': {
      const contract = obj('contract') as AgentContract | undefined;
      return {
        type: 'agent_done',
        index: num('index'),
        total: num('total'),
        nodeId: str('nodeId'),
        agentId: str('agentId'),
        agentName: str('agentName'),
        exitCode: num('exitCode'),
        output: str('output'),
        status: (str('status') as NodeResult['status']) || undefined,
        durationMs: num('durationMs') || undefined,
        contract,
      };
    }
    case 'node_skipped':
      return {
        type: 'node_skipped',
        nodeId: str('nodeId'),
        index: num('index'),
        agentId: str('agentId'),
        agentName: str('agentName'),
      };
    case 'node_files':
      return { type: 'node_files', nodeId: str('nodeId'), index: num('index'), files: strArr('files') };
    case 'supervisor_start':
      return {
        type: 'supervisor_start',
        agentPool: strArr('agentPool'),
        supervisorId: str('supervisorId'),
        maxIterations: num('maxIterations'),
      };
    case 'supervisor_decision':
      return {
        type: 'supervisor_decision',
        iteration: num('iteration'),
        action: str('action'),
        reason: str('reason'),
        agents: (p.agents as { agentId: string; task: string }[]) || [],
      };
    case 'done': {
      const files = (p.files || []) as ProjectFile[];
      const previewUrl = typeof p.previewUrl === 'string' ? (p.previewUrl as string) : null;
      const workDir = typeof p.workDir === 'string' ? (p.workDir as string) : undefined;
      const runId = typeof p.runId === 'string' ? p.runId : undefined;
      return { type: 'done', files, previewUrl, workDir, runId };
    }
    case 'error':
      return { type: 'error', text: str('text'), index: num('index'), nodeId: str('nodeId') || undefined, agentId: str('agentId') || undefined };
    default:
      return null;
  }
}

function buildUrl(remoteUrl: string | undefined, path: string): { url: string; headers: Record<string, string> } {
  if (remoteUrl) {
    const base = remoteUrl.replace(/\/+$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const bearer = getAuthToken();
    if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
    return { url: `${base}${BASE_PREFIX}${path}`, headers };
  }
  return { url: apiUrl(path), headers: apiHeaders({ 'Content-Type': 'application/json' }) };
}

/** 显式中止服务端 run。 */
export async function abortMultiAgentRun(runId: string, remoteUrl?: string): Promise<boolean> {
  const { url, headers } = buildUrl(remoteUrl, '/api/multi-agent/abort');
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ runId }),
  });
  if (!res.ok) return false;
  const data = await res.json().catch(() => ({}));
  return Boolean(data.ok);
}

export async function* runMultiAgent(
  params: MultiAgentRunParams,
  signal: AbortSignal,
): AsyncIterable<MultiAgentEvent> {
  const {
    task, mode, agentIds, workflowId, supervisorAgentId, maxIterations,
    sid, workDir, projectName, direct, remoteUrl, remoteToken,
  } = params;

  let url: string;
  let headers: Record<string, string>;
  if (remoteUrl) {
    const built = buildUrl(remoteUrl, '/api/multi-agent/run');
    url = built.url;
    headers = built.headers;
    const bearer = remoteToken || getAuthToken();
    if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  } else {
    const built = buildUrl(undefined, '/api/multi-agent/run');
    url = built.url;
    headers = built.headers;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        task, mode, agentIds, workflowId, supervisorAgentId, maxIterations,
        sid, workDir, projectName, direct,
      }),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    yield { type: 'error', text: (err as Error).message || '网络请求失败' };
    return;
  }

  if (!res.ok || !res.body) {
    let msg = `请求失败 (${res.status})`;
    try {
      const j = await res.json();
      if (j.error) msg = j.error;
    } catch { /* ignore */ }
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
          if (ev.type === 'done' || (ev.type === 'error' && !ev.nodeId)) return;
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
