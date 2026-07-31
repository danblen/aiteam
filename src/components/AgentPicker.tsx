import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppProvider';
import { cliLabel } from '../lib/custom-agents';

interface Props {
  /** 运行中/会话锁定时禁用切换。 */
  disabled?: boolean;
}

/**
 * 聊天级智能体选择器：决定本次任务用哪些智能体执行。
 * - 选了若干智能体 → 按选择顺序依次执行（每步产出带入下一步）
 * - 都没选 → 走默认模式（内置团队 / 单 CLI，由环境配置决定）
 *
 * 工作流（预定义编排）不在本选择器里选，而是从「工作流」tab 直接触发运行。
 */
export default function AgentPicker({ disabled }: Props) {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 点击外部关闭弹层。
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const agents = app.customAgents.filter((a) => a.enabled);
  const selectedIds = app.selectedAgentIds;
  const selectedAgents = selectedIds
    .map((id) => agents.find((a) => a.id === id))
    .filter(Boolean) as typeof agents;

  const active = selectedAgents.length > 0;
  const summary = active ? `${selectedAgents.length} 个智能体` : '默认模式';

  const toggleAgent = (id: string) => {
    if (disabled) return;
    app.toggleSelectedAgent(id);
  };

  const clearAll = () => {
    if (disabled) return;
    app.clearSelectedAgents();
  };

  // 没有可用智能体时，不显示选择器（引导用户先去智能体 tab 创建）。
  if (agents.length === 0) return null;

  return (
    <div className={`agent-picker-wrap${disabled ? ' is-locked' : ''}`} ref={ref}>
      <button
        type="button"
        className={`agent-picker-btn${active ? ' active' : ''}`}
        title={disabled ? '运行中，暂不可切换' : '选择本次任务使用的智能体'}
        onClick={() => { if (!disabled) setOpen((v) => !v); }}
      >
        <span className="ap-ico">🤖</span>
        <span className="ap-summary">{summary}</span>
        <span className="ap-caret">{open ? '▴' : '▾'}</span>
      </button>

      {open && !disabled && (
        <div className="agent-picker-pop">
          <div className="ap-section">
            <div className="ap-section-head">
              <span>智能体（按选择顺序执行）</span>
              {selectedIds.length > 0 && <button className="ap-link" onClick={clearAll}>清除</button>}
            </div>
            <div className="ap-chips">
              {agents.map((a) => {
                const idx = selectedIds.indexOf(a.id);
                const on = idx >= 0;
                return (
                  <button
                    key={a.id}
                    className={`ap-chip${on ? ' on' : ''}`}
                    style={on ? { borderColor: a.color, background: a.color + '18', color: a.color } : {}}
                    onClick={() => toggleAgent(a.id)}
                  >
                    <span className="ap-chip-emoji">{a.emoji}</span>
                    <span className="ap-chip-name">{a.name}</span>
                    <span className="ap-chip-cli">{cliLabel(a.cliId)}</span>
                    {on && <span className="ap-chip-ord">{idx + 1}</span>}
                  </button>
                );
              })}
            </div>
            <div className="ap-hint">
              点击选中要参与本次任务的智能体，数字标号代表执行先后。工作流请到「工作流」tab 运行。
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
