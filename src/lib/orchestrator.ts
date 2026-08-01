import type { AgentRole, Framework, ProjectFile } from './types';
import { CODE_RULES, TEXT_RULES } from './agents';
import { streamChat } from './api';

export type RunMode = 'replan' | 'iterate';

export interface OrchestratorCallbacks {
  /** A high-level orchestrator/system note (AutoGen manager style). */
  onSystem: (text: string) => void;
  /** An agent is about to speak. */
  onAgentStart: (agent: AgentRole) => void;
  /** Incremental token for the current agent. */
  onAgentDelta: (text: string) => void;
  /** The current agent finished; content is its full output. */
  onAgentDone: (agent: AgentRole, content: string) => void;
  onError: (message: string) => void;
}

export interface RunContext {
  /** The current project's files (for iterating on an existing app). */
  currentFiles: ProjectFile[];
  /** Condensed prior conversation, so follow-ups continue the same project. */
  history: string;
}

interface Contribution {
  name: string;
  content: string;
}

/** Build the per-agent task prompt with the shared collaboration context. */
function buildAgentTask(
  agent: AgentRole,
  goal: string,
  mode: RunMode,
  prior: Contribution[],
  ctx: RunContext,
): string {
  const parts: string[] = [];

  if (ctx.history) {
    parts.push(`# 项目历史对话（供延续参考）\n${ctx.history}`);
  }

  parts.push(`# 本次用户需求\n${goal}`);

  if (mode === 'iterate') {
    parts.push('# 说明\n这是对**现有项目**的迭代，请在已有代码基础上按新需求增量修改，不要推倒重来。');
  }

  if (prior.length > 0) {
    const c = prior.map((p) => `## ${p.name} 的产出\n${p.content}`).join('\n\n');
    parts.push(`# 团队已完成的工作\n${c}`);
  }

  if (agent.producesCode && ctx.currentFiles.length > 0) {
    const dump = ctx.currentFiles
      .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
      .join('\n\n');
    parts.push(`# 当前项目文件（在此基础上按新需求修改）\n${dump}`);
  }

  parts.push(`# 你的任务\n请以「${agent.name}」的身份，完成你负责的部分。`);
  return parts.join('\n\n');
}

/**
 * Run the crew. In `replan` mode every enabled agent runs in sequence
 * (CrewAI-style). In `iterate` mode only the code-producing agent(s) run,
 * modifying the existing project. Returns the produced files (if any).
 */
export async function runCrew(
  agents: AgentRole[],
  goal: string,
  mode: RunMode,
  ctx: RunContext,
  callbacks: OrchestratorCallbacks,
  signal: AbortSignal,
): Promise<{ files: ProjectFile[] | null; framework: Framework; aborted: boolean }> {
  const enabled = agents.filter((a) => a.enabled);
  let team = enabled;

  if (mode === 'iterate') {
    const coders = enabled.filter((a) => a.producesCode);
    team = coders.length > 0 ? coders : enabled;
  }

  if (team.length === 0) {
    callbacks.onError('没有启用任何智能体，请在「智能体团队」中至少启用一个。');
    return { files: null, framework: 'react', aborted: false };
  }

  const roster = team.map((a) => a.name).join(' → ');
  callbacks.onSystem(
    mode === 'iterate'
      ? `延续当前项目，由 ${roster} 进行增量迭代`
      : `已组建 ${team.length} 位智能体，按顺序协作：${roster}`,
  );

  const prior: Contribution[] = [];
  let finalFiles: ProjectFile[] | null = null;
  let framework: Framework = 'react';

  for (const agent of team) {
    if (signal.aborted) return { files: finalFiles, framework, aborted: true };

    callbacks.onAgentStart(agent);

    const system = agent.systemPrompt + (agent.producesCode ? CODE_RULES : TEXT_RULES);
    const task = buildAgentTask(agent, goal, mode, prior, ctx);

    let content = '';
    let failed = false;

    await streamChat(
      system,
      [{ role: 'user', content: task }],
      {
        signal,
        onDelta: (t) => {
          content += t;
          callbacks.onAgentDelta(t);
        },
        onError: (msg) => {
          failed = true;
          callbacks.onError(msg);
        },
        onDone: () => {},
      },
    );

    if (failed) return { files: finalFiles, framework, aborted: false };
    if (signal.aborted) return { files: finalFiles, framework, aborted: true };

    callbacks.onAgentDone(agent, content);
    prior.push({ name: agent.name, content });

    if (agent.producesCode) {
      const parsed = parseEngineerOutput(content);
      if (parsed.files.length > 0) {
        finalFiles = parsed.files;
        framework = parsed.framework;
      }
    }
  }

  return { files: finalFiles, framework, aborted: false };
}

/**
 * Parse the engineer's output into a project file map.
 *
 * Primary format: multiple fenced blocks whose info string carries a path,
 * e.g. ```jsx path=src/App.jsx . Fallback: a single ```html block is treated
 * as a legacy single-file app (index.html).
 */
export function parseEngineerOutput(raw: string): {
  files: ProjectFile[];
  framework: Framework;
} {
  const files: ProjectFile[] = [];
  const re = /```([\w-]*)\s+path=(\S+)[^\n]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const path = m[2].trim().replace(/^["'`]|["'`]$/g, '');
    const content = m[3].replace(/\n$/, '');
    if (path) files.push({ path, content });
  }

  // Tolerate an unclosed final block while streaming.
  const openRe = /```([\w-]*)\s+path=(\S+)[^\n]*\n([\s\S]*)$/;
  if (files.length === 0 || !raw.trimEnd().endsWith('```')) {
    const tail = raw.slice(lastFenceIndex(raw));
    const om = tail.match(openRe);
    if (om && !tail.trimEnd().endsWith('```')) {
      const path = om[2].trim().replace(/^["'`]|["'`]$/g, '');
      const content = om[3];
      if (path && !files.some((f) => f.path === path)) files.push({ path, content });
    }
  }

  if (files.length > 0) {
    const isReact = files.some((f) => /\.(jsx|tsx|ts|js|css)$/.test(f.path));
    return { files, framework: isReact ? 'react' : 'html' };
  }

  // Legacy single-file html fallback.
  const html = extractCode(raw);
  if (html) return { files: [{ path: 'index.html', content: html }], framework: 'html' };

  return { files: [], framework: 'react' };
}

function lastFenceIndex(raw: string): number {
  const closed = /```([\w-]*)\s+path=\S+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = closed.exec(raw))) last = m.index;
  return last;
}

/** True if the engineer's output contains any project code. */
export function hasProjectCode(raw: string): boolean {
  return parseEngineerOutput(raw).files.length > 0;
}

/** Pull the HTML out of a fenced code block (tolerant of a missing close). */
export function extractCode(raw: string): string {
  const fence = raw.match(/```(?:html|HTML)?[^\n]*\n?/);
  if (!fence || fence.index === undefined) return '';
  const after = raw.slice(fence.index + fence[0].length);
  const close = after.lastIndexOf('```');
  return (close >= 0 ? after.slice(0, close) : after).trim();
}
