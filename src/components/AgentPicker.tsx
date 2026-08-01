import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppProvider';
import { cliLabel } from '../lib/custom-agents';
import type { MultiAgentMode } from '../lib/custom-agents';

interface Props {
  disabled?: boolean;
}

/**
 * 聊天级智能体选择器（本地 / 云端通用）。
 * - 顺序模式：按选择顺序执行（可并行，取决于工作流 dependsOn / fileScope）
 * - Supervisor 模式：开放任务，监督者动态调度所选智能体池
 * - 工作流模式：选中预定义 DAG，聊天发送即按工作流编排执行
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
  const workflows = app.workflows;
  const selectedIds = app.selectedAgentIds;
  const mode = app.multiAgentMode;
  const activeWorkflowId = app.activeWorkflowId;
  const activeWorkflow = activeWorkflowId
    ? workflows.find((w) => w.id === activeWorkflowId)
    : null;

  const selectedAgents = selectedIds
    .map((id) => agents.find((a) => a.id === id))
    .filter(Boolean) as typeof agents;

  const active = selectedAgents.length > 0 || mode === 'supervisor' || Boolean(activeWorkflow);
  const summary = activeWorkflow
    ? `工作流 · ${activeWorkflow.name}`
    : mode === 'supervisor'
      ? (selectedAgents.length > 0 ? `Supervisor · ${selectedAgents.length}` : 'Supervisor')
      : (selectedAgents.length > 0 ? `${selectedAgents.length} 个智能体` : '默认模式');

  const toggleAgent = (id: string) => {
    if (disabled) return;
    app.setActiveWorkflowId(null);
    app.toggleSelectedAgent(id);
  };

  const setMode = (m: MultiAgentMode) => {
    if (disabled) return;
    app.setActiveWorkflowId(null);
    app.setMultiAgentMode(m);
  };

  const pickWorkflow = (id: string) => {
    if (disabled) return;
    if (activeWorkflowId === id) {
      app.setActiveWorkflowId(null);
      return;
    }
    app.clearSelectedAgents();
    app.setActiveWorkflowId(id);
  };

  const openAgentsTab = () => {
    setOpen(false);
    app.setActiveTab('agents');
  };

  const openWorkflowsTab = () => {
    setOpen(false);
    app.setActiveTab('workflows');
  };

  return (
    <div className={`agent-picker-wrap${disabled ? ' is-locked' : ''}`} ref={ref}>
      <button
        type="button"
        className={`agent-picker-btn${active ? ' active' : ''}${mode === 'supervisor' ? ' supervisor' : ''}${activeWorkflow ? ' workflow' : ''}`}
        title={disabled ? '运行中，暂不可切换' : '选择智能体、工作流与编排模式'}
        onClick={() => { if (!disabled) setOpen((v) => !v); }}
      >
        <span className="ap-ico">{activeWorkflow ? '⚡' : mode === 'supervisor' ? '🧭' : '🤖'}</span>
        <span className="ap-summary">{summary}</span>
        <span className="ap-caret">{open ? '▴' : '▾'}</span>
      </button>

      {open && !disabled && (
        <div className="agent-picker-pop">
          {workflows.length > 0 && (
            <div className="ap-section">
              <div className="ap-section-head">
                <span>工作流</span>
                {activeWorkflowId && (
                  <button className="ap-link" onClick={() => app.setActiveWorkflowId(null)}>清除</button>
                )}
              </div>
              <div className="ap-wf-list">
                {workflows.map((w) => {
                  const on = activeWorkflowId === w.id;
                  const stepCount = w.steps.filter((s) => s.agentId).length;
                  return (
                    <button
                      key={w.id}
                      type="button"
                      className={`ap-wf${on ? ' on' : ''}`}
                      onClick={() => pickWorkflow(w.id)}
                    >
                      <span className="ap-wf-text">
                        <span className="ap-wf-name">{w.name}</span>
                        <span className="ap-wf-meta">
                          {stepCount > 0 ? `${stepCount} 步` : '未配置步骤'}
                          {w.description ? ` · ${w.description}` : ''}
                        </span>
                      </span>
                      {on && <span className="ap-wf-check">✓</span>}
                    </button>
                  );
                })}
              </div>
              <div className="ap-hint">选中工作流后，聊天发送将按 DAG 编排执行（与本地模式相同）。</div>
            </div>
          )}

          <div className="ap-section">
            <div className="ap-section-head">
              <span>编排模式</span>
            </div>
            <div className="ap-mode-row">
              <button
                type="button"
                className={`ap-mode-btn${mode === 'agents' && !activeWorkflow ? ' on' : ''}`}
                onClick={() => setMode('agents')}
                disabled={Boolean(activeWorkflow)}
              >
                顺序 / 并行
              </button>
              <button
                type="button"
                className={`ap-mode-btn${mode === 'supervisor' ? ' on' : ''}`}
                onClick={() => setMode('supervisor')}
                disabled={Boolean(activeWorkflow)}
              >
                开放任务
              </button>
            </div>
            <div className="ap-hint">
              {activeWorkflow
                ? '已选工作流时由工作流编排；清除工作流后可切换模式。'
                : mode === 'supervisor'
                  ? 'Supervisor 会根据任务动态调用下方选中的智能体；至少选 1 个。'
                  : '选中智能体按顺序协作；复杂并行请在「工作流」里配置 dependsOn 与 fileScope。'}
            </div>
          </div>

          <div className="ap-section">
            <div className="ap-section-head">
              <span>{mode === 'supervisor' ? '智能体池' : '智能体（执行顺序）'}</span>
              {selectedIds.length > 0 && (
                <button className="ap-link" onClick={() => app.clearSelectedAgents()}>清除</button>
              )}
            </div>
            {agents.length === 0 ? (
              <div className="ap-empty">
                <p>{app.authEmail ? '暂无可用智能体。' : '请先登录，然后在「智能体」tab 创建。'}</p>
                <button type="button" className="ap-link-btn" onClick={openAgentsTab}>
                  前往智能体 tab →
                </button>
              </div>
            ) : (
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
                      disabled={Boolean(activeWorkflow)}
                    >
                      <span className="ap-chip-name">{a.name}</span>
                      <span className="ap-chip-cli">{cliLabel(a.cliId)}{a.readOnly ? ' · 只读' : ''}</span>
                      {on && mode === 'agents' && !activeWorkflow && <span className="ap-chip-ord">{idx + 1}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {workflows.length === 0 && (
            <div className="ap-section ap-section-foot">
              <button type="button" className="ap-link-btn" onClick={openWorkflowsTab}>
                在「工作流」tab 创建编排 →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
