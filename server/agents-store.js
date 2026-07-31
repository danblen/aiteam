import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * 持久化存储：自定义智能体（CustomAgent）与工作流（Workflow）。
 * 采用与 projects.js 一致的「JSON 文件 + per-user owner」模式：
 *   server/.data/agents.json     { [owner]: CustomAgent[] }
 *   server/.data/workflows.json  { [owner]: Workflow[] }
 *
 * owner = sanitizeName(req.user?.email) || '_anon'，与项目注册表同源，
 * 保证未登录（本地开发 / 开放访问）时多用户也不互相覆盖。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '.data');
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');
const WORKFLOWS_FILE = path.join(DATA_DIR, 'workflows.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

/** 将任意字符串规整为单层、安全的目录名（与 env.js / projects.js 一致）。 */
function sanitizeName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.replace(/[\\/]/g, '_').replace(/\.{2,}/g, '_').trim();
}

/** owner 归一化：未登录回退到 '_anon'，避免空键污染共享数据。 */
export function ownerKey(req) {
  return sanitizeName(req?.user?.email) || '_anon';
}

/** 生成「前缀-随机后缀」形式的 id。 */
function genId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------- 通用 JSON 注册表读写 ----------

function readRegistry(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeRegistry(file, reg) {
  try {
    fs.writeFileSync(file, JSON.stringify(reg, null, 2));
  } catch (err) {
    console.error(`[agents-store] 写入 ${path.basename(file)} 失败:`, err?.message || err);
  }
}

// ---------- CustomAgent ----------

/** 服务端视角的自定义智能体定义。 */
export const SUPPORTED_CLIS = ['claude', 'opencode', 'aider'];

function normalizeAgent(a) {
  if (!a || typeof a !== 'object') return null;
  const cliId = SUPPORTED_CLIS.includes(a.cliId) ? a.cliId : 'claude';
  return {
    id: String(a.id || genId('agent')),
    name: String(a.name || '新智能体').slice(0, 60),
    emoji: String(a.emoji || '🤖').slice(0, 8),
    color: String(a.color || '#9aa4b6').slice(0, 9),
    cliId,
    systemPrompt: String(a.systemPrompt || '').slice(0, 8000),
    model: a.model ? String(a.model).slice(0, 80) : '',
    enabled: a.enabled !== false,
    producesCode: a.producesCode === true,
    createdAt: Number(a.createdAt) || Date.now(),
    updatedAt: Number(a.updatedAt) || Date.now(),
  };
}

export function listAgents(req) {
  const owner = ownerKey(req);
  const reg = readRegistry(AGENTS_FILE);
  return (reg[owner] || []).map(normalizeAgent).filter(Boolean);
}

export function getAgentById(req, id) {
  return listAgents(req).find((a) => a.id === id) || null;
}

export function createAgent(req, data) {
  const owner = ownerKey(req);
  const reg = readRegistry(AGENTS_FILE);
  const list = reg[owner] || [];
  const agent = normalizeAgent({ ...data, id: genId('agent'), createdAt: Date.now(), updatedAt: Date.now() });
  list.push(agent);
  reg[owner] = list;
  writeRegistry(AGENTS_FILE, reg);
  return agent;
}

export function updateAgent(req, id, changes) {
  const owner = ownerKey(req);
  const reg = readRegistry(AGENTS_FILE);
  const list = reg[owner] || [];
  const idx = list.findIndex((a) => a.id === id);
  if (idx < 0) return null;
  const updated = normalizeAgent({ ...list[idx], ...changes, id, updatedAt: Date.now() });
  list[idx] = updated;
  reg[owner] = list;
  writeRegistry(AGENTS_FILE, reg);
  return updated;
}

export function deleteAgent(req, id) {
  const owner = ownerKey(req);
  const reg = readRegistry(AGENTS_FILE);
  const list = reg[owner] || [];
  const next = list.filter((a) => a.id !== id);
  if (next.length === list.length) return false;
  reg[owner] = next;
  writeRegistry(AGENTS_FILE, reg);
  // 级联：从该 owner 的所有工作流步骤中移除对该 agent 的引用（置空标记由前端处理）。
  return true;
}

// ---------- Workflow ----------

function normalizeStep(s) {
  if (!s || typeof s !== 'object') return null;
  return {
    id: String(s.id || genId('step')),
    agentId: String(s.agentId || ''),
    taskTemplate: String(s.taskTemplate || '').slice(0, 8000),
  };
}

function normalizeWorkflow(w) {
  if (!w || typeof w !== 'object') return null;
  const steps = Array.isArray(w.steps)
    ? w.steps.map(normalizeStep).filter(Boolean)
    : [];
  return {
    id: String(w.id || genId('wf')),
    name: String(w.name || '新工作流').slice(0, 60),
    emoji: String(w.emoji || '🧩').slice(0, 8),
    color: String(w.color || '#7c86ff').slice(0, 9),
    description: String(w.description || '').slice(0, 500),
    steps,
    createdAt: Number(w.createdAt) || Date.now(),
    updatedAt: Number(w.updatedAt) || Date.now(),
  };
}

export function listWorkflows(req) {
  const owner = ownerKey(req);
  const reg = readRegistry(WORKFLOWS_FILE);
  return (reg[owner] || []).map(normalizeWorkflow).filter(Boolean);
}

export function getWorkflowById(req, id) {
  return listWorkflows(req).find((w) => w.id === id) || null;
}

export function createWorkflow(req, data) {
  const owner = ownerKey(req);
  const reg = readRegistry(WORKFLOWS_FILE);
  const list = reg[owner] || [];
  const wf = normalizeWorkflow({ ...data, id: genId('wf'), createdAt: Date.now(), updatedAt: Date.now() });
  list.push(wf);
  reg[owner] = list;
  writeRegistry(WORKFLOWS_FILE, reg);
  return wf;
}

export function updateWorkflow(req, id, changes) {
  const owner = ownerKey(req);
  const reg = readRegistry(WORKFLOWS_FILE);
  const list = reg[owner] || [];
  const idx = list.findIndex((w) => w.id === id);
  if (idx < 0) return null;
  const updated = normalizeWorkflow({ ...list[idx], ...changes, id, updatedAt: Date.now() });
  list[idx] = updated;
  reg[owner] = list;
  writeRegistry(WORKFLOWS_FILE, reg);
  return updated;
}

export function deleteWorkflow(req, id) {
  const owner = ownerKey(req);
  const reg = readRegistry(WORKFLOWS_FILE);
  const list = reg[owner] || [];
  const next = list.filter((w) => w.id !== id);
  if (next.length === list.length) return false;
  reg[owner] = next;
  writeRegistry(WORKFLOWS_FILE, reg);
  return true;
}
