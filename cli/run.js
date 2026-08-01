import { getAdapter } from './registry.js';

export async function runCLI(cliId, task, workDir, callbacks, opts) {
  const adapter = getAdapter(cliId);
  if (!adapter) throw new Error(`不支持的 CLI Agent: ${cliId}`);
  const _cb = callbacks || {};
  const _opts = opts || {};
  const { exitCode } = await adapter.run({
    task,
    workDir,
    systemPrompt: _opts.systemPrompt,
    model: _opts.model,
    callbacks: { onDelta: _cb.onDelta, onStatus: _cb.onStatus },
    signal: _cb.signal,
    uid: _cb.uid,
    timeoutMs: _opts.timeoutMs,
  });
  return exitCode;
}

export async function probeCli(id) {
  const adapter = getAdapter(id);
  if (!adapter) return null;
  return adapter.isAvailable();
}
