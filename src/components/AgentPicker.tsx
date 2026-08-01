import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppProvider';
import { cliLabel } from '../lib/custom-agents';
import type { MultiAgentMode } from '../lib/custom-agents';

interface Props {
  disabled?: boolean;
}

/**
 * 聊天级智能体选择器。
 * - 顺序模式：按选择顺序执行（可并行，取决于工作流 dependsOn / fileScope）
 * - Supervisor 模式：开放任务，监督者动态调度所选智能体池
 */
export default function AgentPicker({ disabled }: Props) {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
  const mode = app.multiAgentMode;
  const selectedAgents = selectedIds
    .map((id) => agents.find((a) => a.id === id))
    .filter(Boolean) as typeof agents;

  const active = selectedAgents.length > 0 || mode === 'supervisor';
  const summary = mode === 'supervisor'
    ? (selectedAgents.length > 0 ? `Supervisor · ${selectedAgents.length}` : 'Supervisor')
    : (selectedAgents.length > 0 ? `${selectedAgents.length} 个智能体` : '默认模式');

  const toggleAgent = (id: string) => {
    if (disabled) return;
    app.toggleSelectedAgent(id);
  };

  const setMode = (m: MultiAgentMode) => {
    if (disabled) return;
    app.setMultiAgentMode(m);
  };

  if (agents.length === 0) return null;

  return (
    <div className={`agent-picker-wrap${disabled ? ' is-locked' : ''}`} ref={ref}>
      <button
        type="button"
        className={`agent-picker-btn${active ? ' active' : ''}${mode === 'supervisor' ? ' supervisor' : ''}`}
        title={disabled ? '运行中，暂不可切换' : '选择智能体与编排模式'}
        onClick={() => { if (!disabled) setOpen((v) => !v); }}
      >
        <span className="ap-ico">{mode === 'supervisor' ? '🧭' : '🤖'}</span>
        <span className="ap-summary">{summary}</span>
        <span className="ap-caret">{open ? '▴' : '▾'}</span>
      </button>

      {open && !disabled && (
        <div className="agent-picker-pop">
          <div className="ap-section">
            <div className="ap-section-head">
              <span>编排模式</span>
            </div>
            <div className="ap-mode-row">
              <button
                type="button"
                className={`ap-mode-btn${mode === 'agents' ? ' on' : ''}`}
                onClick={() => setMode('agents')}
              >
                顺序 / 并行
              </button>
              <button
                type="button"
                className={`ap-mode-btn${mode === 'supervisor' ? ' on' : ''}`}
                onClick={() => setMode('supervisor')}
              >
                开放任务
              </button>
            </div>
            <div className="ap-hint">
              {mode === 'supervisor'
                ? 'Supervisor 会根据任务动态调用下方选中的智能体；至少选 1 个。'
                : '选中智能体按顺序协作；并行请在「工作流」里配置 dependsOn 与 fileScope。'}
            </div>
          </div>

          <div className="ap-section">
            <div className="ap-section-head">
              <span>{mode === 'supervisor' ? '智能体池' : '智能体（执行顺序）'}</span>
              {selectedIds.length > 0 && (
                <button className="ap-link" onClick={() => app.clearSelectedAgents()}>清除</button>
              )}
            </div>
            <div className="ap-chips">
              {agents.map((a) => {
                const idx = selectedIds.indexOf(a.id);
                const on = idx >= 0;
                return (
                  <button
                    key={a.id}
                    className={`ap-chip${on ? ' on' : ''}`}
                    style={on ? { borderColor: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 16%, transparent)', color: 'var(--accent)' } : {}}
                    onClick={() => toggleAgent(a.id)}
                  >
                    <span className="ap-chip-name">{a.name}</span>
                    <span className="ap-chip-cli">{cliLabel(a.cliId)}{a.readOnly ? ' · 只读' : ''}</span>
                    {on && mode === 'agents' && <span className="ap-chip-ord">{idx + 1}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
