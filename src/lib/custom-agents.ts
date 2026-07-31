/**
 * 自定义智能体与工作流的类型定义（前端视角）。
 * 与后端 server/agents-store.js 的数据模型一一对应。
 */

/** 可绑定的 CLI Agent 类型，取决于云端/本机安装了哪些 CLI。 */
export type AgentCliId = 'claude' | 'opencode' | 'aider';

/** 用户自建的智能体：一个 CLI + 自定义 system prompt + 可选 model。 */
export interface CustomAgent {
  id: string;
  name: string;
  emoji: string;
  color: string;
  /** 该智能体调用哪个 CLI 执行任务。 */
  cliId: AgentCliId;
  /** 角色系统提示词，会写入指令文件 + 组合任务前缀双重注入。 */
  systemPrompt: string;
  /** 模型覆盖（留空走 CLI 默认）。claude/aider 走 --model。 */
  model: string;
  enabled: boolean;
  /** 标记该智能体产出最终代码（用于前端展示与文件解析）。 */
  producesCode: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 工作流的一个步骤：绑定一个智能体 + 任务模板。 */
export interface WorkflowStep {
  id: string;
  /** 引用 CustomAgent.id；为空表示待配置。 */
  agentId: string;
  /**
   * 任务模板，支持插值变量：
   *   {{input}} → 用户本次输入
   *   {{prev}}  → 上一个智能体的产出
   * 留空时：首步直接用用户输入，后续步自动拼上前序产出。
   */
  taskTemplate: string;
}

/** 工作流：有序步骤编排，可复用的智能体协作流程。 */
export interface Workflow {
  id: string;
  name: string;
  emoji: string;
  color: string;
  description: string;
  steps: WorkflowStep[];
  createdAt: number;
  updatedAt: number;
}

/** CLI 选项的展示元数据。 */
export const CLI_OPTIONS: { id: AgentCliId; name: string; desc: string; emoji: string }[] = [
  { id: 'claude', name: 'Claude Code', desc: 'Anthropic 官方 CLI，读 CLAUDE.md 指令', emoji: '🟠' },
  { id: 'opencode', name: 'OpenCode', desc: '开源 Agent CLI，读 AGENTS.md 指令', emoji: '🔵' },
  { id: 'aider', name: 'Aider', desc: 'Git 友好的代码编辑 CLI', emoji: '🟢' },
];

export function cliLabel(id: AgentCliId): string {
  return CLI_OPTIONS.find((c) => c.id === id)?.name || id;
}

/** 智能体可选项（与团队编辑器共用，保持视觉一致）。 */
export const AGENT_EMOJIS = ['🤖', '🧠', '🛠️', '🚀', '🧪', '📊', '🔐', '💡', '📝', '🗂️', '⚡', '🔮', '🦾', '🎯'];
export const AGENT_COLORS = ['#7c86ff', '#a86bff', '#4dd6c1', '#46d39a', '#f0a35e', '#ff6b7a', '#ffb454', '#5ea8f0'];

/** 创建一个空白智能体模板。 */
export function newCustomAgentTemplate(): CustomAgent {
  const now = Date.now();
  return {
    id: '',
    name: '新智能体',
    emoji: '🤖',
    color: '#7c86ff',
    cliId: 'claude',
    systemPrompt: '你是一名资深工程师，擅长用 React + TypeScript 构建现代 Web 应用。',
    model: '',
    enabled: true,
    producesCode: true,
    createdAt: now,
    updatedAt: now,
  };
}

/** 创建一个空白工作流模板。 */
export function newWorkflowTemplate(): Workflow {
  const now = Date.now();
  return {
    id: '',
    name: '新工作流',
    emoji: '🧩',
    color: '#a86bff',
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
  };
}
