import type { CustomAgent, Workflow } from './types';
import { apiUrl, apiHeaders } from '../api';

/** 列出当前用户的自定义智能体。 */
export async function listCustomAgents(): Promise<{ agents: CustomAgent[]; supportedClis: string[] }> {
  const res = await fetch(apiUrl('/api/agents'), { headers: apiHeaders() });
  const data = await res.json().catch(() => ({ agents: [] }));
  if (!res.ok) throw new Error(data.error || `读取智能体失败 (${res.status})`);
  return { agents: (data.agents || []) as CustomAgent[], supportedClis: data.supportedClis || [] };
}

export async function createCustomAgent(agent: Omit<CustomAgent, 'id' | 'createdAt' | 'updatedAt'>): Promise<CustomAgent> {
  const res = await fetch(apiUrl('/api/agents'), {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(agent),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.agent) throw new Error(data.error || `新建智能体失败 (${res.status})`);
  return data.agent as CustomAgent;
}

export async function updateCustomAgent(id: string, changes: Partial<CustomAgent>): Promise<CustomAgent> {
  const res = await fetch(apiUrl(`/api/agents/${encodeURIComponent(id)}`), {
    method: 'PUT',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(changes),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.agent) throw new Error(data.error || `更新智能体失败 (${res.status})`);
  return data.agent as CustomAgent;
}

export async function deleteCustomAgent(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/agents/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: apiHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `删除智能体失败 (${res.status})`);
}

export async function listWorkflows(): Promise<{ workflows: Workflow[]; agents: CustomAgent[] }> {
  const res = await fetch(apiUrl('/api/workflows'), { headers: apiHeaders() });
  const data = await res.json().catch(() => ({ workflows: [] }));
  if (!res.ok) throw new Error(data.error || `读取工作流失败 (${res.status})`);
  return { workflows: (data.workflows || []) as Workflow[], agents: (data.agents || []) as CustomAgent[] };
}

export async function createWorkflow(wf: Omit<Workflow, 'id' | 'createdAt' | 'updatedAt'>): Promise<Workflow> {
  const res = await fetch(apiUrl('/api/workflows'), {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(wf),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.workflow) throw new Error(data.error || `新建工作流失败 (${res.status})`);
  return data.workflow as Workflow;
}

export async function updateWorkflow(id: string, changes: Partial<Workflow>): Promise<Workflow> {
  const res = await fetch(apiUrl(`/api/workflows/${encodeURIComponent(id)}`), {
    method: 'PUT',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(changes),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.workflow) throw new Error(data.error || `更新工作流失败 (${res.status})`);
  return data.workflow as Workflow;
}

export async function deleteWorkflow(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/workflows/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: apiHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `删除工作流失败 (${res.status})`);
}
