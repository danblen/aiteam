#!/usr/bin/env node
/**
 * 独立 CLI 入口：列出 / 探测 / 运行本机 Agent CLI。
 *
 *   cli list
 *   cli probe claude
 *   cli run --id claude --dir . --task "hello"
 */
import path from 'node:path';
import fs from 'node:fs';
import {
  listAdapters,
  availableClis,
  probeCli,
  runCLI,
} from '../index.js';

const [, , cmd, ...rest] = process.argv;

async function main() {
  if (cmd === 'list' || !cmd) {
    const adapters = listAdapters();
    const installed = await availableClis();
    for (const a of adapters) {
      const ok = installed.includes(a.id);
      const pathHint = ok ? await probeCli(a.id) : '';
      console.log(`${ok ? '✔' : '✗'} ${a.id.padEnd(10)} ${a.name}${pathHint ? `  →  ${pathHint}` : ''}`);
    }
    return;
  }

  if (cmd === 'probe') {
    const id = rest[0];
    if (!id) {
      console.error('用法: cli probe <claude|opencode|aider>');
      process.exit(1);
    }
    const p = await probeCli(id);
    if (p) console.log(p);
    else {
      console.error(`未找到: ${id}`);
      process.exit(1);
    }
    return;
  }

  if (cmd === 'run') {
    const args = parseArgs(rest);
    if (!args.id || !args.task) {
      console.error('用法: cli run --id <cli> --dir <workDir> --task "<text>"');
      process.exit(1);
    }
    const workDir = path.resolve(args.dir || '.');
    fs.mkdirSync(workDir, { recursive: true });
    const code = await runCLI(args.id, args.task, workDir, {
      onDelta: (t) => process.stdout.write(t),
      onStatus: (t) => process.stderr.write(t + '\n'),
    }, { timeoutMs: args.timeout ? Number(args.timeout) * 1000 : 0 });
    process.exit(code === 0 ? 0 : 1);
  }

  console.error(`未知命令: ${cmd}\n用法: cli list | probe <id> | run --id ... --task ...`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { id: '', dir: '.', task: '', timeout: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--id') out.id = argv[++i] || '';
    else if (a === '--dir') out.dir = argv[++i] || '.';
    else if (a === '--task') out.task = argv[++i] || '';
    else if (a === '--timeout') out.timeout = argv[++i] || '0';
  }
  return out;
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
