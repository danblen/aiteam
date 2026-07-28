import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';

const SERVER_PORT = process.env.SERVER_PORT || 5110;
const FE_PORT = process.env.FE_PORT || 5100;

/**
 * 解析用于右下角版本号展示的 commit 短哈希。
 * 多级回退，确保永远不会显示 `unknown`：
 *   1. 构建时显式注入的 COMMIT_HASH 环境变量（最高优先）
 *   2. 常规场景：用 git 命令解析
 *   3. git 二进制不可用（沙箱 / 容器内无 git）时，直接读取 .git 目录
 *   4. 兜底：使用 package.json 的 version，绝不显示 unknown
 */
function resolveCommitHash(): string {
  if (process.env.COMMIT_HASH) return process.env.COMMIT_HASH;

  // 2. 常规：git 命令解析
  try {
    const hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    if (hash) return hash;
  } catch {
    // git 不可用，继续尝试直接解析 .git
  }

  // 3. 不依赖 git 二进制，直接从 .git 目录读取当前 commit
  try {
    const gitDir = path.join(process.cwd(), '.git');
    if (fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory()) {
      const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
      if (!head.startsWith('ref:')) {
        // detached HEAD：HEAD 本身就是完整 sha
        if (/^[0-9a-f]{40}$/i.test(head)) return head.slice(0, 7);
      } else {
        const ref = head.slice(4).trim(); // 如 refs/heads/main
        // 3a. 普通 ref 文件
        const refPath = path.join(gitDir, ...ref.split('/'));
        if (fs.existsSync(refPath)) {
          return fs.readFileSync(refPath, 'utf8').trim().slice(0, 7);
        }
        // 3b. 在 packed-refs 中查找（ref 被打包时）
        const packed = path.join(gitDir, 'packed-refs');
        if (fs.existsSync(packed)) {
          for (const line of fs.readFileSync(packed, 'utf8').split('\n')) {
            if (!line || line.startsWith('#')) continue;
            const [sha, name] = line.trim().split(/\s+/);
            if (name === ref) return sha.slice(0, 7);
          }
        }
      }
    }
  } catch {
    // 解析失败，继续回退
  }

  // 4. 兜底：package.json 版本号
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    if (pkg?.version) return `v${pkg.version}`;
  } catch {
    // ignore
  }

  return 'dev';
}

const GIT_COMMIT = resolveCommitHash();

export default defineConfig({
  // Exclude the vendored prebuilt codeview bundle from the React plugin's
  // Babel pass: it's already compiled (no JSX) and ~2MB, so running Babel on
  // it only slows dev and trips the "deoptimised styling" note. React itself
  // stays external; only the transform is skipped.
  plugins: [react({ exclude: /\/src\/vendor\// })],
  base: '/aiteam/',
  define: {
    __COMMIT_HASH__: JSON.stringify(GIT_COMMIT),
  },
  server: {
    port: Number(FE_PORT),
    // 监听所有网卡（包含 IPv4 127.0.0.1），避免仅绑定 IPv6 [::1]
    // 导致浏览器用 127.0.0.1 解析 localhost 时连不上。
    host: true,
    // 后端会把预览/发布/工作区文件写入 server 下的这些目录，它们都在
    // Vite 的监听根内。若不忽略，构建预览时写入的大量文件会触发 Vite
    // HMR 整页刷新——表现为「自动跳回概览、会话被刷新」。忽略即可修复。
    watch: {
      ignored: [
        '**/server/.previews/**',
        '**/server/.published/**',
        '**/server/.workspaces/**',
        '**/server/.data/**',
        '**/server/.loop-data/**',
      ],
    },
    proxy: {
      // 前端在 base=/aiteam 下请求 /aiteam/api、/aiteam/preview，
      // 开发时去掉前缀再转发到后端（后端路由挂在根下）。
      '/aiteam/api': {
        target: `http://localhost:${SERVER_PORT}`,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/aiteam/, ''),
      },
      '/aiteam/preview': {
        target: `http://localhost:${SERVER_PORT}`,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/aiteam/, ''),
      },
      // 已发布站点公开访问路径，开发时同样转发到后端。
      '/aiteam/p': {
        target: `http://localhost:${SERVER_PORT}`,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/aiteam/, ''),
      },
    },
  },
});
