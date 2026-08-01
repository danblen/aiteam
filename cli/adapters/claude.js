import { BaseAdapter } from '../adapter.js';

export const claudeAdapter = new BaseAdapter('claude', {
  bin: 'claude',
  name: 'Claude Code',
  emoji: '🟠',
  desc: 'Anthropic 官方 CLI，读 CLAUDE.md 指令',
  supportsModel: true,
  args: (task) => ['-p', task, '--print'],
});

export default claudeAdapter;
