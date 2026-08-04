# 03 — CLI 适配器设计

## 要解决什么问题

项目需要调用三种不同的 AI CLI：Claude Code、OpenCode、Aider。它们各自有：
- 不同的二进制路径
- 不同的命令行参数格式
- 不同的指令文件（CLAUDE.md vs AGENTS.md vs CONVENTIONS.md）
- 不同的模型参数支持（有的支持 `--model`，有的不支持）

如何在项目里统一调用它们？**适配器模式**。

## BaseAdapter 的抽象

```javascript
class BaseAdapter {
  id                 // 标识: 'claude' | 'opencode' | 'aider'
  config.bin         // 二进制名字或路径
  config.args(task, workDir, opts)  // 返回命令行参数数组
  config.supportsModel              // 是否支持 --model
  
  resolveBin()       // 找到可执行文件在哪
  instructionFile()  // 这个 CLI 读哪个指令文件
  run({ task, workDir, systemPrompt, ... })  // 执行
}
```

关键设计：**`config.args` 是一个函数**，不是静态数组。因为参数构建需要上下文（task、workDir、model）。

每个适配器只重写配置，不重写 `run()` 逻辑：

```
BaseAdapter.run() 的通用流程:
  1. resolveBin() → 找到可执行文件路径
  2. 如果有 systemPrompt → 写入指令文件 (CLAUDE.md / AGENTS.md / CONVENTIONS.md)
  3. buildArgs(task, workDir) → 获取命令行参数
  4. 如果 supportsModel → 追加 --model xxx
  5. 把 { task, systemPrompt } 拼成 "【角色设定】\n...\n\n【任务】\n..."
  6. spawn(binPath, args) → 收集输出 → 返回 { exitCode, output }
```

## 三个适配器的差异

```javascript
// claude: 简单直接
args(task) → ['-p', task, '--print']
指令文件: CLAUDE.md
supportsModel: true

// opencode: 需要指定工作目录
args(task, workDir) → ['--auto', '--dir', workDir, task]
指令文件: AGENTS.md
supportsModel: false  // OpenCode 从配置文件读模型
后备路径: ~/.opencode/bin/opencode

// aider: 消息模式和自动确认
args(task) → ['--message', task, '--yes']
指令文件: CONVENTIONS.md
supportsModel: true
```

## 可执行文件解析的复杂性

`resolve-bin.js` 是整个适配器层最复杂的文件。为什么不是简单的 `which claude`？

因为要处理：
1. **跨平台**：Windows 下 `.cmd`/`.exe` 后缀，MSYS 路径转换
2. **非 PATH 安装**：用户可能装在 `~/.opencode/bin/` 或 `/Volumes/z/app/opencode/opencode.sh`
3. **环境变量**：`{BIN}_BIN` 可以指定路径（如 `OPECODE_BIN`）
4. **优先级**：同步候选列表 → PATH 异步解析

```javascript
resolveBinSync(bin, fallbackBins) {
  // 1. 先查标准化路径 (MSYS → Windows)
  // 2. 在 wellKnownCandidates 中查找（知名安装位置）
  // 3. 如果有，返回完整路径
  // 4. 否则返回 bin 名（留给后面的异步 PATH 解析）
}
```

`resolveExecutable(bin)` 做异步的 PATH 解析（通过 `which`/`where` 命令），结果会**全局缓存**——同一个 CLI 只查一次。

## spawn 注入机制

这是一个重要的设计模式：**spawn 函数不是硬编码的**。

```javascript
// config.js
let _spawn = child_process.spawn;  // 默认原生 spawn

export function configure({ spawn }) {
  _spawn = spawn;  // 替换为自定义实现
}

export function getSpawn() {
  return _spawn;
}
```

为什么需要替换？因为 **Docker 沙箱需要以不同 UID 启动进程**：

```javascript
// server/cli.js (启动时配置)
import { configure } from '@danblen/cli';
import { spawnAsUser } from './user-isolate.js';

configure({ spawn: spawnAsUser });
```

`spawnAsUser` 会传 `{ uid, gid }` 给子进程，实现用户隔离。**适配器代码本身完全不需要知道沙箱的存在**——它只调用 `getSpawn()`，具体是谁实现的 spawn 对它透明。

## 指令文件的注入策略

每个 CLI 有自己的"项目指令"文件。适配器的做法是：

```javascript
// 在 run() 中
if (systemPrompt && instrFile) {
  fs.writeFileSync(path.join(workDir, instrFile), systemPrompt.trim() + '\n');
  // 同时把 systemPrompt 拼进 task 文本:
  finalTask = `【角色设定】\n${systemPrompt}\n\n【任务】\n${task}`;
}
```

两个渠道同时生效：指令文件（CLI 会自动读）+ 任务文本内嵌（确保 CLI 一定看到角色设定）。

每次执行前，`cleanInstructionFiles()` 会删除所有遗留的指令文件——防止上一个智能体的 CLAUDE.md 被下一个智能体误读。

## 进程管理的细节

`runProcess()` 处理了很多边缘情况：

```javascript
// stdout → 逐块收集，剥离 ANSI，实时回调 onDelta
child.stdout.on('data', chunk => {
  const cleaned = stripAnsi(chunk.toString());
  output += cleaned;
  callbacks.onDelta?.(cleaned);
});

// 超时: SIGTERM → 3秒 → SIGKILL
// (两层递进，给进程清理机会)

// AbortSignal: 和超时同样的终止逻辑
signal?.addEventListener('abort', () => child.kill('SIGTERM'));

// 退出码: close 事件而非 exit 事件
// (close 在所有 stdio 流关闭后触发，确保 output 收集完毕)
child.on('close', code => resolve({ exitCode: code ?? -1, output }));
```

## 工作区扫描的设计

`scanWorkspace(workDir)` 递归列出目录文件，跳过：
- 构建产物：`node_modules`、`dist`、`.git`
- 系统目录：`.published`、`.previews`、`.loop-data`
- 指令文件：`CLAUDE.md`、`AGENTS.md`、`CONVENTIONS.md`（这些是角色配置，不是项目产物）
- 隐藏目录 (`.`前缀)

为什么要跳过指令文件？因为这些文件是临时的角色注入方式，不是用户项目的代码。如果不跳过，扫描结果里会出现 `CLAUDE.md`，前端文件树里就会多出不该有的文件。
