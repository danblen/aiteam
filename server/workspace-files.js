import fs from 'node:fs';
import path from 'node:path';
import { isWithin, WORKSPACES_DIR } from './env.js';
import { ensureAdminForSensitive } from './auth.js';

/** 与 scanWorkspace / codeview 树一致：跳过这些目录名。 */
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'dist-ssr', '.git', '.published', '.previews',
  '.workspaces', '.loop-data', '.workbuddy',
]);

const MAX_FILE_BYTES = 50 * 1024 * 1024;

function resolveReadablePath(req, res, rawPath) {
  if (!rawPath || typeof rawPath !== 'string') {
    res.status(400).json({ error: '缺少 path 参数' });
    return null;
  }
  const abs = path.resolve(rawPath);
  if (!fs.existsSync(abs)) {
    res.status(404).json({ error: '路径不存在' });
    return null;
  }
  if (!isWithin(WORKSPACES_DIR, abs) && !ensureAdminForSensitive(req, res)) {
    return null;
  }
  return abs;
}

/**
 * codeview ServerProvider 按需读盘 API。
 * GET /api/read-tree?path=<absDir>
 * GET /api/read-file?path=<absFile>
 */
export function mountWorkspaceFiles(app) {
  app.get('/api/read-tree', (req, res) => {
    const abs = resolveReadablePath(req, res, req.query.path);
    if (!abs) return;

    try {
      const stat = fs.statSync(abs);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: '路径不是目录' });
      }

      const entries = fs.readdirSync(abs, { withFileTypes: true });
      const children = entries
        .filter((e) => !(e.isDirectory() && SKIP_DIRS.has(e.name)))
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => ({
          name: e.name,
          kind: e.isDirectory() ? 'directory' : 'file',
          path: path.join(abs, e.name),
        }))
        .sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
        });

      res.json({ name: path.basename(abs), children });
    } catch (err) {
      res.status(400).json({ error: `无法读取目录: ${err.message}` });
    }
  });

  app.get('/api/read-file', (req, res) => {
    const abs = resolveReadablePath(req, res, req.query.path);
    if (!abs) return;

    try {
      const stat = fs.statSync(abs);
      if (!stat.isFile()) {
        return res.status(400).json({ error: '路径不是文件' });
      }
      if (stat.size > MAX_FILE_BYTES) {
        return res.status(400).json({ error: '文件过大（超过 50MB）' });
      }

      const data = fs.readFileSync(abs);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(data.length));
      res.send(data);
    } catch (err) {
      res.status(400).json({ error: `无法读取文件: ${err.message}` });
    }
  });
}
