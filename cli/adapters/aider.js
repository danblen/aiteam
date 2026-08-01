import { BaseAdapter } from '../adapter.js';

export const aiderAdapter = new BaseAdapter('aider', {
  bin: 'aider',
  name: 'Aider',
  emoji: '🟢',
  desc: 'Git 友好的代码编辑 CLI',
  supportsModel: true,
  args: (task) => ['--message', task, '--yes'],
});

export default aiderAdapter;
