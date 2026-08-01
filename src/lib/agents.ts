import type { AgentRole } from './types';

/** Hard rules appended to any agent that produces the runnable app. */
export const CODE_RULES = `

【产出格式要求（必须严格遵守）】
你是团队里最终交付代码的人，需要产出一个**多文件的 React 项目**（使用 Vite 构建）。
请先用 2-3 句话说明实现要点，然后按文件逐个输出代码块，每个代码块的信息行必须带上文件路径，格式如下：

\`\`\`jsx path=src/App.jsx
// 该文件的完整内容
\`\`\`

硬性要求：
- 合理拆分组件到 'src/components/' 下，样式用 '.css' 文件并在组件中 import。
- 代码必须可直接构建运行，import 路径要正确（相对路径带扩展名，如 './components/Foo.jsx'）。
- 界面现代、精致、可交互，有 hover 与过渡动画，响应式。
- 综合团队成员（产品、设计、评审）的意见来实现。
- 若上下文提供了「当前项目文件」，请在其基础上按新需求修改，保持已有可用功能，并输出**完整**的相关文件（不要用省略号）。`;

/** Non-code agents keep their output concise and free of code blocks. */
export const TEXT_RULES = `

【输出要求】用简洁的中文要点表达（3-6 条，以“- ”开头），聚焦你的职责，不要写代码、不要输出代码块。`;

const c = (
  id: string,
  name: string,
  goal: string,
  systemPrompt: string,
  producesCode = false,
  enabled = false,
): AgentRole => ({ id, name, goal, systemPrompt, producesCode, enabled });

/**
 * Default crew. Ordered as a sequential process (CrewAI-style): each agent
 * sees the prior members' output. The engineer runs last so it can synthesize
 * requirements + design + review feedback into the final runnable app.
 */
export const DEFAULT_AGENTS: AgentRole[] = [
  c(
    'pm',
    '产品经理',
    '拆解需求、明确功能点与验收标准',
    '你是一名资深产品经理。基于用户的一句话需求，梳理清晰的核心功能点、关键用户流程与验收标准，并指出优先级。保持精炼、聚焦 MVP。',
  ),
  c(
    'designer',
    'UI 设计师',
    '定义视觉风格、布局与交互',
    '你是一名资深 UI/UX 设计师。基于产品经理的功能点，给出整体视觉风格（配色、字体、圆角、阴影）、页面布局结构与关键交互/动效建议，使成品精致、现代、好用。',
  ),
  c(
    'reviewer',
    '方案评审',
    '审查方案、指出风险与改进点',
    '你是一名严谨的方案评审专家。审查产品与设计方案，指出潜在的体验问题、边界情况、可用性与一致性风险，并给出可直接执行的改进建议。',
  ),
  c(
    'engineer',
    '工程师',
    '综合团队意见，产出可运行应用',
    '你是一名顶尖工程师。综合团队（产品、设计、评审）的全部意见，产出一个可运行、精致、可交互的单文件网页应用。',
    true,
    true,
  ),
];

export function newAgentTemplate(): AgentRole {
  return {
    id: `agent-${Date.now()}`,
    name: '新智能体',
    goal: '描述该角色的职责',
    systemPrompt: '你是一名……，你的职责是……',
    producesCode: false,
    enabled: true,
  };
}

