import fs from 'node:fs';
import path from 'node:path';
import { getSpawn } from './config.js';
import { resolveExecutable, resolveBinSync, needsShell } from './resolve-bin.js';

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1B\][0-9;]*\x07/g, '');
}

export const INSTRUCTION_FILES_BY_CLI = {
  claude: 'CLAUDE.md',
  opencode: 'AGENTS.md',
  aider: 'CONVENTIONS.md',
};

export const INSTRUCTION_FILES = new Set(Object.values(INSTRUCTION_FILES_BY_CLI));

export class BaseAdapter {
  constructor(id, config) {
    this.id = id;
    this.config = config;
  }

  resolveBin() {
    const { bin, fallbackBins } = this.config;
    return resolveBinSync(bin, fallbackBins) || bin || null;
  }

  instructionFile() {
    return INSTRUCTION_FILES_BY_CLI[this.id] || null;
  }

  supportsModel() {
    return this.config.supportsModel === true;
  }

  buildArgs(task, workDir, opts = {}) {
    return this.config.args(task, workDir, opts);
  }

  async isAvailable() {
    const { bin, fallbackBins } = this.config;
    const sync = resolveBinSync(bin, fallbackBins);
    if (sync) return sync;
    return bin ? resolveExecutable(bin) : null;
  }

  async run({ task, workDir, systemPrompt, model, callbacks = {}, signal, uid, timeoutMs }) {
    const { bin, fallbackBins } = this.config;
    let binPath = resolveBinSync(bin, fallbackBins);
    if (!binPath || !path.isAbsolute(binPath)) {
      binPath = await resolveExecutable(bin);
    }
    if (!binPath) throw new Error(`找不到 ${this.id} 的可执行文件（${bin}）`);

    let finalTask = task;
    const instrFile = this.instructionFile();
    if (systemPrompt && instrFile) {
      try {
        fs.writeFileSync(path.join(workDir, instrFile), systemPrompt.trim() + '\n', 'utf8');
      } catch { /* ok */ }
      finalTask = buildComposedTask(task, systemPrompt);
    }

    let args = this.buildArgs(finalTask, workDir, { model });
    if (model && this.supportsModel()) {
      args = [...args, '--model', String(model)];
    }

    return runProcess(binPath, args, { cwd: workDir, callbacks, signal, uid, timeoutMs, shell: needsShell(binPath) });
  }
}

function buildComposedTask(task, systemPrompt) {
  const sp = (systemPrompt || '').trim();
  if (!sp) return task;
  return `【角色设定】\n${sp}\n\n【任务】\n${task}`;
}

function runProcess(binPath, args, { cwd, callbacks, signal, uid, timeoutMs, shell = false }) {
  return new Promise((resolve, reject) => {
    const child = getSpawn()(binPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell }, uid ?? null);
    let output = '';
    let aborted = false;
    let settled = false;
    let timer = null;

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };

    if (signal) {
      const onAbort = () => {
        aborted = true;
        try { child.kill('SIGTERM'); } catch {}
        setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000);
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch {}
        setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 3000);
        finish(() => reject(new Error(`步骤超时（${Math.round(timeoutMs / 1000)}s）`)));
      }, timeoutMs);
    }

    child.stdout.on('data', (chunk) => {
      const cleaned = stripAnsi(chunk.toString());
      if (cleaned) {
        output += cleaned;
        if (callbacks.onDelta) callbacks.onDelta(cleaned);
      }
    });
    child.stderr.on('data', (chunk) => {
      const cleaned = stripAnsi(chunk.toString());
      if (cleaned && callbacks.onStatus) callbacks.onStatus(cleaned);
    });
    child.on('close', (code) => {
      if (aborted) return finish(() => reject(new Error('CLI 执行被中止')));
      finish(() => resolve({ exitCode: code ?? -1, output }));
    });
    child.on('error', (err) => {
      if (aborted) return;
      finish(() => reject(new Error(`启动 CLI ${binPath} 失败: ${err.message}`)));
    });
  });
}

export class AdapterRegistry {
  constructor() {
    this._adapters = new Map();
  }

  register(adapter) {
    if (!(adapter instanceof BaseAdapter)) throw new Error('注册项必须是 BaseAdapter 实例');
    this._adapters.set(adapter.id, adapter);
  }

  get(id) {
    return this._adapters.get(id) || null;
  }

  list() {
    return Array.from(this._adapters.values());
  }

  ids() {
    return Array.from(this._adapters.keys());
  }

  has(id) {
    return this._adapters.has(id);
  }

  async availableIds() {
    const entries = await Promise.all(this.list().map(async (a) => ({ id: a.id, ok: Boolean(await a.isAvailable()) })));
    return entries.filter((e) => e.ok).map((e) => e.id);
  }
}

export const registry = new AdapterRegistry();
