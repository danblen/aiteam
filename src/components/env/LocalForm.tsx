import type { AvailableAgent, LocalEnvConfig } from '../../lib/env/types';

interface Props {
  config: LocalEnvConfig;
  agents: AvailableAgent[];
  loading: boolean;
  onChange: (patch: Partial<LocalEnvConfig>) => void;
}

export default function LocalForm({ config, agents, loading, onChange }: Props) {
  return (
    <div className="env-form">
      <div className="env-field">
        <label className="env-label">本机 CLI Agent</label>
        <p className="env-hint">
          未在聊天栏选择自定义智能体时，任务交给下方 CLI 整体执行。多智能体协作请在「智能体」tab 创建并在聊天栏选择。
        </p>
        {loading ? (
          <p className="env-hint">正在检测本机已安装的 CLI…</p>
        ) : agents.length === 0 ? (
          <p className="env-hint warn">
            未检测到可用的 CLI（claude / opencode / aider）。请先在终端安装其一。
          </p>
        ) : (
          <select
            className="env-input"
            value={config.cliId}
            onChange={(e) => onChange({ cliId: e.target.value })}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.path ? ` · ${a.path}` : ''}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
