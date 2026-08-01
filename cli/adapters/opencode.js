import os from 'node:os';
import path from 'node:path';
import { BaseAdapter } from '../adapter.js';

const opencodeHome = path.join(os.homedir(), '.opencode', 'bin', process.platform === 'win32' ? 'opencode.exe' : 'opencode');

export const opencodeAdapter = new BaseAdapter('opencode', {
  bin: 'opencode',
  fallbackBins: [opencodeHome, '/Volumes/z/app/opencode/opencode.sh'],
  name: 'OpenCode',
  emoji: '🔵',
  desc: '开源 Agent CLI，读 AGENTS.md 指令',
  supportsModel: false,
  args: (task, workDir) => (workDir ? ['run', '--auto', '--dir', workDir, task] : ['run', '--auto', task]),
});

export default opencodeAdapter;
