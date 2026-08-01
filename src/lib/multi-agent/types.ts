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
      systemPrompt: '你是一名资深产品经理。基于用户的一句话需求，梳理清晰的核心功能点、关键用户流程与验收标准，并指出优先级。保持精炼、聚焦 MVP。',
      model: '',
      enabled: true,
      producesCode: false,
      readOnly: true,
      defaultFileScope: [],
    },
    {
      name: 'UI 设计师',
      cliId,
      systemPrompt: '你是一名资深 UI/UX 设计师。基于产品经理的功能点，给出整体视觉风格（配色、字体、圆角、阴影）、页面布局结构与关键交互/动效建议，使成品精致、现代、好用。',
      model: '',
      enabled: true,
      producesCode: false,
      readOnly: true,
      defaultFileScope: [],
    },
    {
      name: '方案评审',
      cliId,
      systemPrompt: '你是一名严谨的方案评审专家。审查产品与设计方案，指出潜在的体验问题、边界情况、可用性与一致性风险，并给出可直接执行的改进建议。',
      model: '',
      enabled: true,
      producesCode: false,
      readOnly: true,
      defaultFileScope: [],
    },
    {
      name: '工程师',
      cliId,
      systemPrompt: '你是一名顶尖工程师。综合团队（产品、设计、评审）的全部意见，在真实工程目录中实现可运行、精致、可交互的 Web 应用。',
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
