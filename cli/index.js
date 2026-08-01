/**
 * @danblen/cli —— 统一调度 claude / opencode / aider 等本机 CLI。
 */

export { configure, getSpawn } from './config.js';
export {
  normalizeBinPath,
  resolveExecutable,
  resolveBinSync,
  needsShell,
  wellKnownCandidates,
} from './resolve-bin.js';
export {
  BaseAdapter,
  AdapterRegistry,
  registry,
  INSTRUCTION_FILES,
  INSTRUCTION_FILES_BY_CLI,
} from './adapter.js';
export {
  getAdapter,
  listAdapters,
  supportedClis,
  availableClis,
  isCliAvailable,
  registerAdapter,
} from './registry.js';
export { scanWorkspace } from './workspace.js';
export { runCLI, probeCli } from './run.js';
