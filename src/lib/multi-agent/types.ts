/**
 * 自定义智能体与工作流的类型定义（前端视角）。
 * 与后端 server/agents-store.js 的数据模型一一对应。
 */

/** 可绑定的 CLI Agent 类型，取决于云端/本机安装了哪些 CLI。 */
export type AgentCliId = 'claude' | 'opencode' | 'aider';

/** 多智能体运行模式。 */
export type MultiAgentMode = 'agents' | 'workflow' | 'supervisor';

/** 用户自建的智能体：一个 CLI + 自定义 system prompt + 可选 model。 */
export interface CustomAgent {
  id: string;
  name: string;
  cliId: AgentCliId;
  systemPrompt: string;
  model: string;
  enabled: boolean;
  producesCode: boolean;
  /** 只读智能体（review/test），可与其他步骤并行。 */
  readOnly?: boolean;
  /** 默认写文件域（glob 前缀），供工作流步骤继承。 */
  defaultFileScope?: string[];
  createdAt: number;
  updatedAt: number;
}

/** 工作流的一个步骤：绑定一个智能体 + 任务模板 + 编排元信息。 */
export interface WorkflowStep {
  id: string;
  /** 引用 CustomAgent.id；为空表示待配置。 */
  agentId: string;
  /**
   * 任务模板，支持插值变量：
   *   {{input}}               用户本次输入
   *   {{prev}} / {{prev.files}} / {{prev.notes}}  前驱节点产物
   *   {{nodes.<id>.contract.summary|files|notes}} 任意已完成节点产物
   *   {{nodes.<id>.exitCode}}                      任意节点退出码
   *   {{workspace_files}}      当前工作区文件清单
   * 留空时：首步直接用用户输入，后续步自动拼上前序产出。
   */
  taskTemplate: string;
  /**
   * 显式前驱节点 id。留空 = 依赖前一步（顺序链）；
   * 声明后仅依赖指定节点，无依赖关系的节点可并行执行（DAG）。
   */
  dependsOn?: string[];
  /**
   * 条件表达式（留空 = 总是执行）。受限语法（无 eval）：
   *   <path> contains "<string>"    子串/数组成员包含
   *   <path> == <number>            数值相等
   *   <path> exists                 路径有值
   * path 例：input / nodes.step1.exitCode / nodes.step1.contract.summary
   */
  condition?: string;
  /** 失败重试策略。maxAttempts 1-5。 */
  retry?: { maxAttempts: number; backoffMs: number };
  /** 单步超时（ms）；0 = 服务端默认（5 分钟）。 */
  timeoutMs?: number;
  /** 写文件域 glob 前缀；空 = 独占整个工作区。 */
  fileScope?: string[];
  /** 只读步骤，可并行。 */
  readOnly?: boolean;
  /** 失败策略：continue | skip-dependents | abort */
  onFailure?: 'continue' | 'skip-dependents' | 'abort';
}

/** 工作流：有序步骤编排，可复用的智能体协作流程。 */
export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  createdAt: number;
  updatedAt: number;
}

/** CLI 选项的展示元数据。 */
export const CLI_OPTIONS: { id: AgentCliId; name: string; desc: string }[] = [
  { id: 'claude', name: 'Claude Code', desc: 'Anthropic 官方 CLI，读 CLAUDE.md 指令' },
  { id: 'opencode', name: 'OpenCode', desc: '开源 Agent CLI，读 AGENTS.md 指令' },
  { id: 'aider', name: 'Aider', desc: 'Git 友好的代码编辑 CLI' },
];

export function cliLabel(id: AgentCliId): string {
  return CLI_OPTIONS.find((c) => c.id === id)?.name || id;
}

/** 创建一个空白智能体模板。 */
export function newCustomAgentTemplate(): CustomAgent {
  const now = Date.now();
  return {
    id: '',
    name: '新智能体',
    cliId: 'claude',
    systemPrompt: '你是一名资深工程师，擅长用 React + TypeScript 构建现代 Web 应用。',
    model: '',
    enabled: true,
    producesCode: true,
    readOnly: false,
    defaultFileScope: [],
    createdAt: now,
    updatedAt: now,
  };
}

type PresetAgent = Omit<CustomAgent, 'id' | 'createdAt' | 'updatedAt'>;

/** 原内置团队（PM → 设计 → 评审 → 工程师）的 CLI 智能体预设，可一键导入。 */
export function presetTeamTemplates(cliId: AgentCliId = 'claude'): PresetAgent[] {
  return [
    {
      name: '产品经理',
      cliId,
      systemPrompt: `你是一名资深产品经理，负责把模糊的一句话需求转成可执行的产品定义。你不写代码，只输出分析与决策。

工作方法：
1. 先澄清：识别需求中的模糊点、缺失信息与矛盾之处；可基于常识给出合理假设，但必须显式标注「假设」。
2. 拆解范围：定义 MVP 与后续迭代范围，明确「本次不做」的边界，避免范围无限扩张。
3. 梳理核心用户流程：从入口到完成的主路径，以及关键分支与异常路径。
4. 输出验收标准：每条功能点配可验证的验收条件（Given/When/Then 或等价形式）。
5. 排优先级：按 P0/P1/P2 标注，并说明取舍依据。

约束：
- 不臆造需求：所有推断须标注依据；面向真实业务场景，避免空泛口号。
- 结论要可执行：每条决策都能被下游（设计/评审/工程）直接使用，禁止「提升体验」「增强协同」这类无法落地的表述。
- 控制篇幅：主流程清晰即可，不把分析写成论文。
- 只读：不得创建或修改任何文件。`,
      model: '',
      enabled: true,
      producesCode: false,
      readOnly: true,
      defaultFileScope: [],
    },
    {
      name: 'UI 设计师',
      cliId,
      systemPrompt: `你是一名资深 UI/UX 设计师，负责把产品定义变成精致、现代、可实现的视觉与交互方案。你不写代码，只输出设计决策。

工作方法：
1. 先读现有界面与代码风格（如有），保持与既有设计体系一致；没有设计体系时给出并说明一套简单的设计令牌（配色、字体、圆角、间距、阴影、状态色）。
2. 给出整体视觉方案：配色（主色/辅助色/语义色，标注具体色值）、字体层级、布局结构、关键组件的样式与状态（hover/disabled/loading/error）。
3. 关键交互与动效：列出核心交互路径、转场动效的时机与时长，避免过度动效。
4. 明确响应式与可访问性要求：最小可点击区域、对比度、键盘可操作性、移动端断点行为。

约束：
- 方案必须可落地：颜色/间距/组件状态都要具体到实现可照做，禁止「更现代一点」「更有质感」这类无法量化的表述。
- 面向真实场景：考虑空态、加载中、长文本、超长文件名、窄屏等真实数据场景。
- 与产品定义对齐：每项设计都能追溯到对应功能点与验收标准。
- 只读：不得创建或修改任何文件。`,
      model: '',
      enabled: true,
      producesCode: false,
      readOnly: true,
      defaultFileScope: [],
    },
    {
      name: '方案评审',
      cliId,
      systemPrompt: `你是一名严谨的方案评审专家，负责在开发前找出产品与设计方案的缺陷。你不写代码，只输出评审结论。

评审维度（按序检查）：
1. 需求一致性：方案是否完整覆盖产品定义的功能点与验收标准，有没有遗漏或偏差。
2. 边界与异常：空数据、超长输入、并发、重复提交、弱网/断网、权限不足等场景是否都有处理。
3. 可用性与一致性：交互是否符合直觉、与现有界面一致，文案是否统一。
4. 可访问性：对比度、键盘导航、屏幕阅读器、移动端布局。
5. 风险与成本：实现复杂度、对外依赖、性能隐患、安全隐患（越权、注入、敏感信息）。

输出要求：
- 按严重程度分级：P0（必须修）/ P1（应该修）/ P2（建议）。
- 每条问题给出一句定位 + 具体修改建议，避免空泛批评。
- 结尾总结：是否可进入开发，以及开发前必须解决的 P0 项。
- 若没有实质问题，明确说「无阻塞项」，不要为了显得专业而堆砌伪问题。

约束：
- 只评审已有方案，不擅自扩展范围。
- 只读：不得创建或修改任何文件。`,
      model: '',
      enabled: true,
      producesCode: false,
      readOnly: true,
      defaultFileScope: [],
    },
    {
      name: '工程师',
      cliId,
      systemPrompt: `你是一名顶尖工程师，负责把团队（产品/设计/评审）的结论实现为真实、可运行、高质量的代码。

开工前：
1. 先勘察项目：阅读 README、CLAUDE.md、package.json、现有目录结构与代码风格，理解技术栈与约定后再动手。
2. 优先复用项目已有依赖、工具函数与组件，不重复造轮子；新增依赖需说明理由。

实现要求：
1. 与既有代码风格保持一致（命名、格式化、错误处理模式）。
2. 类型安全：TypeScript 严格模式下通过，不滥用 any。
3. 状态完整：loading、空态、错误态都要处理，交互有明确反馈。
4. 健壮性与安全：防御非法输入与边界值；异步操作有超时与失败处理；严禁引入安全漏洞（SQL 注入、XSS、硬编码密钥/Token、越权访问）。
5. 范围克制：只修改任务所需文件，尊重文件域约束，不顺手重构无关代码。

验证（必须做）：
1. 运行构建与类型检查（如 npm run build / tsc --noEmit），确保通过。
2. 运行相关测试（如有），新增关键逻辑补测试。
3. 自查：读一遍改动 diff，确认没有调试残留、死代码、临时代码或敏感信息。

收尾：
- 输出做了哪些改动、关键决策与理由、需要人工复核的点、如何验证结果。
- 若遇到无法解决的外部依赖或环境问题，如实说明，不虚构「已完成」。`,
      model: '',
      enabled: true,
      producesCode: true,
      readOnly: false,
      defaultFileScope: [],
    },
  ];
}

/** 创建一个空白工作流模板。 */
export function newWorkflowTemplate(): Workflow {
  const now = Date.now();
  return {
    id: '',
    name: '新工作流',
    description: '',
    steps: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** 创建一个空白步骤模板。 */
export function newStepTemplate(): WorkflowStep {
  return {
    id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    agentId: '',
    taskTemplate: '',
    dependsOn: [],
    condition: '',
    retry: { maxAttempts: 1, backoffMs: 0 },
    timeoutMs: 0,
    fileScope: [],
    readOnly: false,
    onFailure: 'continue',
  };
}

/** 复杂编排示例（fork-join、条件分支等），导入后绑定智能体即可。 */
export function presetWorkflowTemplates(): Omit<Workflow, 'id' | 'createdAt' | 'updatedAt'>[] {
  const forkJoin = () => {
    const s1 = newStepTemplate();
    s1.taskTemplate = '{{input}}';
    const s2 = newStepTemplate();
    s2.dependsOn = [s1.id];
    s2.readOnly = true;
    s2.taskTemplate = '基于需求输出 UI/交互方案（只读分析）';
    const s3 = newStepTemplate();
    s3.dependsOn = [s1.id];
    s3.readOnly = true;
    s3.taskTemplate = '基于需求输出技术架构与接口设计（只读分析）';
    const s4 = newStepTemplate();
    s4.dependsOn = [s2.id, s3.id];
    s4.taskTemplate = '综合 {{nodes.' + s2.id + '.contract.summary}} 与 {{nodes.' + s3.id + '.contract.summary}} 实现代码';
    return [s1, s2, s3, s4];
  };

  const reviewGate = () => {
    const s1 = newStepTemplate();
    s1.taskTemplate = '{{input}}';
    const s2 = newStepTemplate();
    s2.dependsOn = [s1.id];
    s2.taskTemplate = '实现功能并自测';
    const s3 = newStepTemplate();
    s3.dependsOn = [s2.id];
    s3.readOnly = true;
    s3.taskTemplate = '代码评审，列出问题清单';
    const s4 = newStepTemplate();
    s4.dependsOn = [s3.id];
    s4.condition = `nodes.${s3.id}.contract.summary contains "通过"`;
    s4.taskTemplate = '评审已通过，输出发布说明';
    const s5 = newStepTemplate();
    s5.dependsOn = [s3.id];
    s5.condition = `nodes.${s3.id}.contract.summary contains "问题"`;
    s5.onFailure = 'continue';
    s5.taskTemplate = '按评审意见修复';
    const s6 = newStepTemplate();
    s6.dependsOn = [s5.id];
    s6.taskTemplate = '修复后再次自测';
    return [s1, s2, s3, s4, s5, s6];
  };

  const parallelDomains = () => {
    const s1 = newStepTemplate();
    s1.taskTemplate = '{{input}}';
    const s2 = newStepTemplate();
    s2.dependsOn = [s1.id];
    s2.fileScope = ['src/components'];
    s2.taskTemplate = '实现前端组件';
    const s3 = newStepTemplate();
    s3.dependsOn = [s1.id];
    s3.fileScope = ['src/api', 'server'];
    s3.taskTemplate = '实现 API 与后端逻辑';
    const s4 = newStepTemplate();
    s4.dependsOn = [s2.id, s3.id];
    s4.taskTemplate = '联调前后端，修复集成问题';
    return [s1, s2, s3, s4];
  };

  return [
    {
      name: '并行评审 → 汇聚开发',
      description: '需求分析后 UI 与架构并行（只读），再汇聚到工程师实现',
      steps: forkJoin(),
    },
    {
      name: '评审门禁 + 条件分支',
      description: '开发 → 评审 → 通过/不通过走不同分支（用 condition 控制）',
      steps: reviewGate(),
    },
    {
      name: '分域并行开发',
      description: '前后端按 fileScope 并行写不同目录，最后集成',
      steps: parallelDomains(),
    },
  ];
}
