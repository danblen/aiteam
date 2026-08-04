import net from 'node:net';
import { spawn } from 'node:child_process';

function portAvailable(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.on('error', () => resolve(false));
    s.listen({ port, host: '0.0.0.0', reuseAddr: true }, () => {
      s.close();
      resolve(true);
    });
  });
}

async function findPortPair(baseFe) {
  let fe = baseFe;
  while (!(await portAvailable(fe) && await portAvailable(fe + 10))) {
    fe++;
  }
  return { fe, be: fe + 10 };
}

async function main() {
  // 支持通过环境变量指定固定端口（预览代理等场景）
  let fe, be;
  if (process.env.FE_PORT && process.env.SERVER_PORT) {
    fe = Number(process.env.FE_PORT);
    be = Number(process.env.SERVER_PORT);
  } else {
    ({ fe, be } = await findPortPair(5100));
  }

  console.log(`\n  [dev] FE → ${fe}, BE → ${be}\n`);

  const server = spawn('node', ['server/index.js'], {
    env: { ...process.env, SERVER_PORT: String(be) },
    stdio: 'inherit',
  });

  // 直接以 node 启动 vite，避免 Windows 下 spawn('npx') 无法解析 .cmd 扩展名（ENOENT）。
  const web = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], {
    env: { ...process.env, FE_PORT: String(fe), SERVER_PORT: String(be) },
    stdio: 'inherit',
  });

  const cleanup = () => {
    server.kill();
    web.kill();
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  server.on('close', (code) => {
    if (code) web.kill();
    process.exit(code ?? 0);
  });
  web.on('close', (code) => {
    server.kill();
    process.exit(code ?? 0);
  });
}

main();
