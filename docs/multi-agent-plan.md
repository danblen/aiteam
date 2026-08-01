# 多智能体编排 — 技术方案

> 现状：功能已基本实现（CRUD + SSE 顺序编排 + 远程模式 + 预览），TypeScript 编译通过。
> 本方案聚焦补齐缺口、提升协作质量，分三阶段递进，每阶段可独立交付。

---

## 阶段一 · 稳固地基（修正确性 + 健壮性）

目标：让现有编排结果可控、不丢任务、不挂死。**推荐优先做。**

### 1.1 指令文件跨步清理（P0 正确性 bug）

**问题**：`server/cli.js` 的 `writeInstructionFile` 每步写 CLAUDE.md / AGENTS.md / CONVENTIONS.md，但从不清理。当工作流里同一 CLI 出现多次、或不同 CLI 交替时，旧指令文件会残留并可能被后续 CLI 误读。

**现状分析**（已确认）：
- 同 CLI 重复出现：`writeInstructionFile` 会覆盖同名文件 → 同 CLI 间实际无残留问题。
- 不同 CLI 交替：step1(claude) 写 CLAUDE.md，step2(opencode) 写 AGENTS.md，此时 CLAUDE.md 仍残留。若 step3 又是 claude，会被 step3 覆盖；但若 step3 是 aider，则 CLAUDE.md + AGENTS.md 都残留，aider 不读它们所以无害。
- 真正风险点：opencode 会同时读 AGENTS.md **和** CLAUDE.md（部分版本兼容），导致 step2 读到 step1 的 claude 角色。这是潜在的上下文污染。

**方案**：每步开始前，清理上一步遗留的指令文件（仅清这三类，不动项目文件）。

改动文件：`server/multi-agent.js`

```js
// 新增：清理所有指令文件（在每步 runCLI 之前调用）
const INSTRUCTION_FILES = ['CLAUDE.md', 'AGENTS.md', 'CONVENTIONS.md'];
function cleanInstructionFiles(workDir) {
  for (const name of INSTRUCTION_FILES) {
    try { fs.unlinkSync(path.join(workDir, name)); } catch { /* 不存在则忽略 */ }
  }
}

// 在 for 循环内、runCLI 之前调用：
for (let i = 0; i < plan.length; i++) {
  // ...
  cleanInstructionFiles(workDir);          // ← 新增：清理上一步残留
  stepExit = await runCLI(agent.cliId, stepTask, workDir, { ... }, {
    systemPrompt: agent.systemPrompt,       // runCLI 内部会重新写当前步的指令文件
    model: agent.model || undefined,
  });
}
```

**注意**：`cleanInstructionFiles` 应在 `runCLI` 之前调用，因为 `runCLI` 的 `writeInstructionFile` 会写入当前步的指令文件。顺序：清旧 → 写新 → 跑 CLI。

**验收**：工作流 [claude-step1, opencode-step2] 跑完后，工作目录只剩 step2 的 AGENTS.md，无 CLAUDE.md 残留。

### 1.2 runWorkflow 忙时入队而非丢弃（P0 任务丢失）

**问题**：`src/store/AppProvider.tsx` 第 718 行 `send()` 检测到 `running` 直接 return，而 `runWorkflow()`（第 1461 行）直接调 `send()`。用户在工作流 tab 点"运行"时若已有任务在跑，请求被静默丢弃。

**方案**：`runWorkflow` 不直接调 `send()`，而是走现有消息队列（`enqueue`），并标记为工作流类型。

改动文件：`src/store/AppProvider.tsx`

```ts
// 现有 QueueItem 增加 workflow 标记
export interface QueueItem {
  id: string;
  text: string;
  mode: RunMode;
  workflowId?: string;   // ← 新增：队列项可携带工作流
}

// runWorkflow 改为入队
const runWorkflow = useCallback(
  (workflowId: string, text: string) => {
    const goal = text.trim();
    if (!goal) return;
    setActiveTab('terminal');
    // 不再直接 send，而是入队，由队列消费器在空闲时取出并带 workflowId 执行
    const sid = currentIdRef.current;
    if (!sid) return;
    setQueues((prev) => ({
      ...prev,
      [sid]: [...(prev[sid] || []), { id: uid('q'), text: goal, mode: 'replan', workflowId }],
    }));
  },
  [],
);

// 队列消费器（第 1501 行 useEffect）改为携带 workflowId
useEffect(() => {
  const sid = current?.id;
  if (!sid) return;
  const r = runs[sid] || IDLE;
  if (r.running || r.building) return;
  const q = queues[sid] || [];
  if (q.length === 0) return;
  const [next, ...rest] = q;
  setQueues((prev) => ({ ...prev, [sid]: rest }));
  send(next.text, next.mode, undefined, next.workflowId ? { workflowId: next.workflowId } : undefined);
}, [runs, queues, current]);
```

**验收**：任务运行中在工作流 tab 点运行，新任务进入队列，前一个完成后自动执行。

### 1.3 单步超时 + 自动中止（P0 挂死阻塞）

**问题**：`runCLI` 无超时，CLI 进程挂死（如等待输入、网络卡住）会永久阻塞整个工作流，只能靠用户手动点停止。

**方案**：在 `runCLI` 内部加单步超时（可配置，默认 5 分钟），超时后 kill 子进程并 reject。

改动文件：`server/cli.js` 的 `runCLI`

```js
export function runCLI(cliId, task, workDir, callbacks, opts) {
  // ... 现有逻辑 ...
  const stepTimeoutMs = (opts && opts.timeoutMs) || 5 * 60 * 1000;  // 默认 5 分钟

  return new Promise((resolve, reject) => {
    const child = spawnAsUser(binPath, args, { cwd: workDir, /* ... */ });
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGTERM'); } catch {}
      // 给 3 秒优雅退出，再强杀
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 3000);
      reject(new Error(`步骤超时（${Math.round(stepTimeoutMs / 1000)}s）`));
    }, stepTimeoutMs);

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code);
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    // ... 现有 stdout/stderr 处理 ...
  });
}
```

`multi-agent.js` 的 catch 分支已处理单步失败（发 error 事件但继续），超时会走这个分支，无需额外改动。

**验收**：配一个会 `sleep 9999` 的步骤，5 分钟后自动中止该步，工作流继续后续步骤。

### 1.4 注册表读写加锁（P0 并发竞态）

**问题**：`agents-store.js` 的 read-modify-write 无锁，并发请求（如同时新建两个智能体）会丢失一个。

**方案**：用进程内简单的 Promise 链做串行化锁（per-file）。

改动文件：`server/agents-store.js`

```js
// 简单的 per-file 串行锁：同一文件的写操作排队执行
const _locks = new Map();  // file -> Promise chain
function withLock(file, fn) {
  const prev = _locks.get(file) || Promise.resolve();
  const next = prev.then(fn, fn);  // 无论前一个成功失败都继续
  _locks.set(file, next.catch(() => {}));  // 吞掉错误避免链断裂
  return next;
}

// 所有写操作包一层 withLock
export function createAgent(req, data) {
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
// updateAgent / deleteAgent / createWorkflow / updateWorkflow / deleteWorkflow 同理
```

**验收**：并发 10 个 createAgent 请求，最终 agents.json 里 10 个都在，无丢失。

---

## 阶段二 · 结构化交接（提升协作质量）

目标：解决"产出线程化太粗糙"的根本问题，让智能体间传递结构化产物而非原文拼接。

### 2.1 产出契约（Structured Output）

**问题**：现在 `prevOutput` 是上一步 CLI 的原始 stdout（截断 6000 字）。一个规划智能体的 markdown 长文会被原样塞进下一步任务，噪声大、关键信息（如"要生成哪些文件"）被淹没。

**方案**：定义产出契约，每步结束时尝试从 CLI 输出里抽取结构化产物。

新增文件：`server/agent-contract.js`

```js
/**
 * 产出契约：从 CLI 原始输出里抽取结构化产物。
 * 约定智能体在输出末尾用如下 JSON 块声明产物（可选）：
 *   ```agent-output
 *   { "summary": "...", "files": ["src/App.tsx"], "notes": "..." }
 *   ```
 * 找不到则降级为全文 summary，files 为空。
 */
export function parseAgentOutput(raw) {
  const m = raw.match(/```agent-output\s*\n([\s\S]*?)\n```/);
  if (m) {
    try {
      const parsed = JSON.parse(m[1]);
      return {
        summary: String(parsed.summary || '').slice(0, 2000),
        files: Array.isArray(parsed.files) ? parsed.files.map(String).slice(0, 50) : [],
        notes: String(parsed.notes || '').slice(0, 2000),
        raw,  // 保留原文供展示
      };
    } catch { /* 降级 */ }
  }
  // 降级：无契约块，用全文当 summary
  return {
    summary: raw.length > 2000 ? raw.slice(0, 2000) + '…' : raw,
    files: [],
    notes: '',
    raw,
  };
}
```

### 2.2 模板插值扩展

**问题**：现在只有 `{{input}}` 和 `{{prev}}`。`{{prev}}` 是原文，无法只引用上一步的 summary 或文件清单。

**方案**：扩展模板变量。

改动文件：`server/multi-agent.js` 的 `renderTask`

```js
function renderTask(template, userInput, prevContract) {
  // prevContract: { summary, files, notes, raw } | null
  if (!template || !template.trim()) {
    if (!prevContract) return userInput;
    return `${userInput}\n\n【上一个智能体的产出】\n${prevContract.summary}`;
  }
  return template
    .replace(/\{\{\s*input\s*\}\}/g, userInput || '')
    .replace(/\{\{\s*prev\s*\}\}/g, prevContract?.summary || '')
    .replace(/\{\{\s*prev\.files\s*\}\}/g, (prevContract?.files || []).join('\n'))
    .replace(/\{\{\s*prev\.notes\s*\}\}/g, prevContract?.notes || '')
    .replace(/\{\{\s*prev\.raw\s*\}\}/g, (prevContract?.raw || '').slice(0, 6000));
}
```

`buildPlan` 的循环里：每步 `agent_done` 后用 `parseAgentOutput(stepOutput)` 得到 contract，传给下一步。

### 2.3 黑板模型（共享工作区）

**问题**：现在产出只通过文本传递，文件状态只在最终扫描一次。中间步骤生成的文件无法被后续步骤显式引用。

**方案**：工作目录本身就是"黑板"——每个 CLI 直接读写工作目录文件，后续步骤自然看到前序产物。只需增强可见性：

- 每步 `agent_done` 后扫描一次工作目录，把文件清单作为 SSE 事件下发（`step_files`），前端可展示中间产物。
- 任务模板可加 `{{workspace_files}}` 插值当前工作区文件列表。

改动文件：`server/multi-agent.js`

```js
// agent_done 之后、下一步之前
const stepFiles = scanWorkspace(workDir);
sendSSE(res, 'step_files', { index: i, files: stepFiles });

// renderTask 增加 workspace 文件列表插值
.replace(/\{\{\s*workspace_files\s*\}\}/g, stepFiles.map(f => f.path).join('\n'))
```

前端 `multi-agent.ts` 增加对应事件类型，`AppProvider` 在 `step_files` 时更新一个中间文件视图（可选展示）。

---

## 阶段三 · 高级编排

目标：真正的多智能体能力——分支、并行、续传、复跑。

### 3.1 条件分支 / 路由

**方案**：工作流步骤增加 `condition` 字段，支持基于上一步产出的条件判断。

数据模型扩展（`agents-store.js` 的 `normalizeStep`）：

```js
function normalizeStep(s) {
  return {
    id: String(s.id || genId('step')),
    agentId: String(s.agentId || ''),
    taskTemplate: String(s.taskTemplate || '').slice(0, 8000),
    // 新增：条件表达式，为空则总是执行
    condition: String(s.condition || '').slice(0, 500),
  };
}
```

条件语法（简单 DSL，避免直接 eval）：

```
prev.files contains "src/"          # 上一步产出了 src 下文件
prev.summary contains "错误"          # 上一步总结里含"错误"
exitCode == 0                        # 上一步退出码
```

`multi-agent.js` 的 `buildPlan` 循环里，执行前先求值 condition，不满足则跳过该步并发 `step_skipped` 事件。

### 3.2 并行 DAG

**方案**：步骤增加 `dependsOn`（前驱步骤 id 数组），无依赖的步骤并行执行。

这是较大的架构改动——`buildPlan` 从线性数组变为 DAG，执行器需要拓扑排序 + 并行调度。SSE 事件的 `index` 改为 `stepId`，前端进度展示从线性条变为 DAG 图。

建议单独作为一个迭代，先不实现，待阶段二验证完结构化交接后再评估必要性。

### 3.3 runId + SSE 断流续传

**方案**（对齐 7/28 规划）：

- 每次 `/api/multi-agent/run` 生成 `runId`，服务端维护一个 per-run 的事件日志（内存 ring buffer，按 runId 索引）。
- 每个 SSE 事件带 `id:` 字段（SSE 协议原生）。
- 客户端断线重连时带 `Last-Event-ID` header，服务端从该 id 之后重放事件。
- 中止信号需区分"用户主动中止"与"连接断开"：前者终止 CLI，后者保留状态等重连。

新增文件：`server/run-log.js`（per-run 事件日志，LRU 淘汰）

### 3.4 运行历史 + 复跑

**方案**：把每次 run 的元数据（workflowId/agentIds、task、最终 files、耗时、退出码）持久化到 `server/.data/runs.json`（per-user）。前端新增"历史"tab，可查看过往运行并一键复跑（用相同参数重新发起）。

---

## 实施建议

1. **阶段一 4 个改动互相独立**，可一次性做完提交，风险低、收益高。
2. **阶段二** 改动 `renderTask` 和新增 `parseAgentOutput`，向后兼容（无契约块则降级），可与阶段一合并到一个 PR。
3. **阶段三** 是能力跃升，建议在前两阶段稳定后再分多个 PR 推进，每个子项独立。

## 不建议现在做的

- **并行 DAG（3.2）**：架构改动大，且当前串行已能满足"多智能体协作"的核心诉求。等真有并行场景需求（如"同时让两个 agent 各写一个模块"）再做。
- **复杂条件 DSL（3.1）**：先做最简单的 `contains` 语义，避免造一门小语言增加维护负担。
