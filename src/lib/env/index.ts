import type { ExecutionEnvironment, EnvironmentConfig } from './types';
import { LocalEnvironment } from './local';
import { RemoteEnvironment } from './remote';
import { SSHEnvironment } from './ssh';

/**
 * Factory: create the right ExecutionEnvironment for the given config + session.
 *
 * @param projectName 本会话对应的项目目录名（工作根目录下的子文件夹）。
 * @param sessionWorkDir 本会话选定的本地目录（绝对路径）；设置后直接作为项目根。
 */
export function createEnvironment(
  config: EnvironmentConfig,
  sid: string,
  projectName?: string,
  sessionWorkDir?: string,
): ExecutionEnvironment | null {
  if (config.mode === 'local') {
    if (sessionWorkDir) {
      return new LocalEnvironment(
        { ...config.local, workDir: sessionWorkDir },
        sid,
        undefined,
        true,
      );
    }
    return new LocalEnvironment(config.local, sid, projectName);
  }
  if (config.mode === 'ssh' && config.ssh.host) {
    return new SSHEnvironment(config.ssh, sid);
  }
  if (config.mode === 'remote' && config.remote.url) {
    return new RemoteEnvironment(config.remote, sid, projectName, sessionWorkDir);
  }
  return null;
}
