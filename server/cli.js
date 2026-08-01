import { configure, runCLI as _runCLI, scanWorkspace, getAdapter } from '../cli/index.js';
import { spawnAsUser } from './user-isolate.js';

/**
 * server/cli.js —— 向后兼容门面。
 * 实际逻辑在根目录 cli/；本文件注入沙箱 spawn 并 re-export。
 */

configure({
  spawn: (binPath, args, opts, uid) => spawnAsUser(binPath, args, opts, uid ?? null),
});

export { scanWorkspace };

export async function runCLI(cliId, task, workDir, callbacks, opts) {
  return _runCLI(cliId, task, workDir, callbacks, opts);
}

export { getAdapter };
