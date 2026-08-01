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

/**
 * per-file 串行锁：同一文件的写操作排队执行，避免并发 read-modify-write 丢写。
 * 进程内 Promise 链实现，足够单实例部署使用。
 */
const _locks = new Map(); // file -> Promise chain
function withLock(file, fn) {
  const prev = _locks.get(file) || Promise.resolve();
  const next = prev.then(fn, fn); // 无论前一个成功失败都继续
  _locks.set(file, next.catch(() => {})); // 吞错避免链断裂
  return next;
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
    readOnly: a.readOnly === true,
    defaultFileScope: normalizeFileScope(a.defaultFileScope),
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

export async function createAgent(req, data) {
  return withLock(AGENTS_FILE, () => {
    const owner = ownerKey(req);
    const reg = readRegistry(AGENTS_FILE);
    const list = reg[owner] || [];
    const agent = normalizeAgent({ ...data, id: genId('agent'), createdAt: Date.now(), updatedAt: Date.now() });
    list.push(agent);
    reg[owner] = list;
    writeRegistry(AGENTS_FILE, reg);
    return agent;
  });
}

export async function updateAgent(req, id, changes) {
  return withLock(AGENTS_FILE, () => {
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
  });
}

export async function deleteAgent(req, id) {
  return withLock(AGENTS_FILE, () => {
    const owner = ownerKey(req);
    const reg = readRegistry(AGENTS_FILE);
    const list = reg[owner] || [];
    const next = list.filter((a) => a.id !== id);
    if (next.length === list.length) return false;
    reg[owner] = next;
    writeRegistry(AGENTS_FILE, reg);
    // 级联：从该 owner 的所有工作流步骤中移除对该 agent 的引用（置空标记由前端处理）。
    return true;
  });
}

// ---------- Workflow ----------

function normalizeFileScope(v) {
  if (!Array.isArray(v)) return [];
  return v.map((s) => String(s).trim()).filter(Boolean).slice(0, 20);
}

function normalizeOnFailure(v) {
  const s = String(v || 'continue');
  if (s === 'skip-dependents' || s === 'abort') return s;
  return 'continue';
}

function normalizeStep(s) {
  if (!s || typeof s !== 'object') return null;
  // dependsOn：显式声明的前驱节点 id；为空时编译器默认依赖前一步（顺序链）
  const dependsOn = Array.isArray(s.dependsOn)
    ? s.dependsOn.map((d) => String(d)).filter(Boolean).slice(0, 20)
    : [];
  return {
    id: String(s.id || genId('step')),
    agentId: String(s.agentId || ''),
    taskTemplate: String(s.taskTemplate || '').slice(0, 8000),
    dependsOn,
    // 条件表达式（留空=总是执行）；见根目录 orchestrator/conditions.js 支持的语法
    condition: String(s.condition || '').slice(0, 500),
    retry: normalizeRetry(s.retry),
    timeoutMs: Number(s.timeoutMs) || 0,
    fileScope: normalizeFileScope(s.fileScope),
    readOnly: s.readOnly === true,
    onFailure: normalizeOnFailure(s.onFailure),
  };
}

function normalizeRetry(r) {
  if (!r || typeof r !== 'object') return { maxAttempts: 1, backoffMs: 0 };
  return {
    maxAttempts: Math.max(1, Math.min(5, Number(r.maxAttempts) || 1)),
    backoffMs: Math.max(0, Math.min(30000, Number(r.backoffMs) || 0)),
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

export async function createWorkflow(req, data) {
  return withLock(WORKFLOWS_FILE, () => {
    const owner = ownerKey(req);
    const reg = readRegistry(WORKFLOWS_FILE);
    const list = reg[owner] || [];
    const wf = normalizeWorkflow({ ...data, id: genId('wf'), createdAt: Date.now(), updatedAt: Date.now() });
    list.push(wf);
    reg[owner] = list;
    writeRegistry(WORKFLOWS_FILE, reg);
    return wf;
  });
}

export async function updateWorkflow(req, id, changes) {
  return withLock(WORKFLOWS_FILE, () => {
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
  });
}

export async function deleteWorkflow(req, id) {
  return withLock(WORKFLOWS_FILE, () => {
    const owner = ownerKey(req);
    const reg = readRegistry(WORKFLOWS_FILE);
    const list = reg[owner] || [];
    const next = list.filter((w) => w.id !== id);
    if (next.length === list.length) return false;
    reg[owner] = next;
    writeRegistry(WORKFLOWS_FILE, reg);
    return true;
  });
}
