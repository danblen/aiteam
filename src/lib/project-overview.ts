import type { ChatMessage, Framework, ProjectFile, Session } from './types';

export interface TechStackItem {
  icon: string;
  label: string;
}

export interface ProductOverview {
  description: string;
  features: string[];
  source: 'summary' | 'conversation' | 'files' | 'empty';
}

function extractBullets(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*•]/.test(l))
    .map((l) => l.replace(/^[-*•]\s?/, ''))
    .filter(Boolean);
}

function firstParagraph(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const prose = lines.filter((l) => !/^[-*•#`]/.test(l) && !l.startsWith('```'));
  return prose.slice(0, 3).join(' ').trim();
}

function agentInsight(messages: ChatMessage[]): string[] {
  const bullets: string[] = [];
  for (const m of messages) {
    if (m.kind !== 'agent' || m.hasCode) continue;
    bullets.push(...extractBullets(m.content));
    const para = firstParagraph(m.content);
    if (para && para.length > 20 && bullets.length === 0) {
      bullets.push(para.length > 120 ? para.slice(0, 117) + '…' : para);
    }
  }
  return [...new Set(bullets)].slice(0, 8);
}

function parsePackageJson(files: ProjectFile[]): Record<string, Record<string, string>> | null {
  const pkg = files.find((f) => /(^|\/)package\.json$/i.test(f.path));
  if (!pkg) return null;
  try {
    const j = JSON.parse(pkg.content);
    return {
      dependencies: j.dependencies || {},
      devDependencies: j.devDependencies || {},
    };
  } catch {
    return null;
  }
}

/** 从会话消息与已保存 summary 推导产品描述。 */
export function deriveProductOverview(session: Session): ProductOverview {
  if (session.summary?.trim()) {
    return {
      description: stripBullets(session.summary),
      features: extractBullets(session.summary),
      source: 'summary',
    };
  }

  const userMsgs = session.messages.filter((m) => m.kind === 'user');
  const agentFeatures = agentInsight(session.messages);

  if (userMsgs.length === 0 && session.files.length === 0) {
    return { description: '', features: [], source: 'empty' };
  }

  const first = userMsgs[0]?.content.trim() || '';
  const latest = userMsgs.length > 1 ? userMsgs[userMsgs.length - 1]?.content.trim() : '';

  let description = '';
  if (first && latest && latest !== first) {
    description = `初始需求：${first}\n\n最新迭代：${latest}`;
  } else if (first) {
    description = first;
  } else if (session.title && session.title !== '新会话') {
    description = session.title;
  } else if (session.files.length > 0) {
    description = `当前工作区已有 ${session.files.length} 个文件，产品说明可从对话或智能体产出中补充。`;
    return { description, features: agentFeatures, source: 'files' };
  }

  return {
    description,
    features: agentFeatures,
    source: userMsgs.length > 0 ? 'conversation' : 'files',
  };
}

function stripBullets(text: string): string {
  const nonBullet = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^[-*•]/.test(l));
  return nonBullet.join(' ') || text.trim();
}

function hasPath(files: ProjectFile[], re: RegExp): boolean {
  return files.some((f) => re.test(f.path));
}

function countPath(files: ProjectFile[], re: RegExp): number {
  return files.filter((f) => re.test(f.path)).length;
}

/** 从项目文件与 framework 字段检测真实技术栈。 */
export function detectTechStack(files: ProjectFile[], framework: Framework): TechStackItem[] {
  if (files.length === 0) return [];

  const stack: TechStackItem[] = [];
  const pkg = parsePackageJson(files);
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };

  const hasReact = Boolean(deps.react || deps['react-dom'])
    || hasPath(files, /\.(jsx|tsx)$/i)
    || framework === 'react';
  const hasVue = Boolean(deps.vue);
  const hasTs = hasPath(files, /\.tsx?$/i) || hasPath(files, /tsconfig(\.[\w-]+)?\.json$/i);
  const hasJs = hasPath(files, /\.(jsx?|mjs|cjs)$/i);
  const hasVite = Boolean(deps.vite) || hasPath(files, /vite\.config\.(ts|js|mjs|cjs)$/i);
  const hasTailwind = Boolean(deps.tailwindcss) || hasPath(files, /tailwind\.config\.(js|ts|cjs|mjs)$/i);
  const hasHtmlOnly = hasPath(files, /^index\.html$/i)
    && !hasPath(files, /\.(jsx|tsx|vue|svelte)$/i)
    && framework === 'html';

  if (hasHtmlOnly) stack.push({ icon: '🌐', label: '静态 HTML / CSS' });
  if (hasReact) stack.push({ icon: '⚛️', label: deps.react ? `React ${majorVersion(deps.react)}` : 'React' });
  if (hasVue) stack.push({ icon: '💚', label: 'Vue' });
  if (hasTs) stack.push({ icon: '📘', label: 'TypeScript' });
  else if (hasJs && !hasHtmlOnly) stack.push({ icon: '📒', label: 'JavaScript' });
  if (hasVite) stack.push({ icon: '⚡', label: 'Vite' });
  if (hasTailwind) stack.push({ icon: '🎨', label: 'Tailwind CSS' });

  const cssCount = countPath(files, /\.css$/i);
  if (cssCount > 0 && !hasTailwind) {
    stack.push({ icon: '🎨', label: cssCount === 1 ? 'CSS 样式' : `${cssCount} 个 CSS 文件` });
  }

  const componentCount = countPath(files, /\.(jsx|tsx|vue|svelte)$/i);
  if (componentCount > 0) {
    stack.push({ icon: '🧩', label: `${componentCount} 个组件文件` });
  }

  if (deps.express || deps.fastify || deps.koa) {
    stack.push({ icon: '🖧', label: Object.keys(deps).find((k) => ['express', 'fastify', 'koa'].includes(k)) || 'Node 服务端' });
  }

  if (stack.length === 0) {
    const ext = new Set(files.map((f) => {
      const m = f.path.match(/\.(\w+)$/);
      return m ? m[1].toLowerCase() : 'file';
    }));
    stack.push({ icon: '📁', label: `${files.length} 个文件 · ${[...ext].slice(0, 4).join(', ')}` });
  }

  return stack;
}

function majorVersion(range: string): string {
  const m = range.match(/(\d+)/);
  return m ? m[1] : '';
}

/** 概览页主标签：优先技术栈首项，否则 framework。 */
export function primaryFrameworkBadge(files: ProjectFile[], framework: Framework): string {
  const stack = detectTechStack(files, framework);
  if (stack.length > 0) return `${stack[0].icon} ${stack[0].label}`;
  if (framework === 'html') return '🌐 HTML';
  if (files.length > 0) return '⚛️ React';
  return '待生成';
}
