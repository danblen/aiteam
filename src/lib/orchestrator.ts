import type { Framework, ProjectFile } from './types';

export type RunMode = 'replan' | 'iterate';

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
