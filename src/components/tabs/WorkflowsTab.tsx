import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../store/AppProvider';
import { type Workflow, type WorkflowStep, type CustomAgent, AGENT_EMOJIS, AGENT_COLORS, newWorkflowTemplate, newStepTemplate, cliLabel } from '../../lib/custom-agents';

/** 取智能体角色提示词的前若干字，用作下拉框里区分同名智能体的副标识。 */
function roleSnippet(a: CustomAgent): string {
  const s = (a.systemPrompt || '').trim().replace(/\s+/g, ' ');
  return s.length > 24 ? s.slice(0, 24) + '…' : s || '无提示词';
}

/** 下拉框里每个智能体的展示文案：名称为主，角色为辅（不再以 CLI 作为区分依据）。 */
function agentOptionText(a: CustomAgent): string {
  const role = roleSnippet(a);
  return `${a.emoji} ${a.name || '未命名'}（${role}）`;
}

/**
 * 工作流编排 Tab。
 * 一个工作流 = 有序步骤序列，每步绑定一个自定义智能体 + 任务模板。
 * 任务模板支持 {{input}}（用户输入）与 {{prev}}（上一步产出）插值。
 * 执行时按顺序运行，把每步产出带入下一步，最终统一扫描文件 + 预览。
 */
export default function WorkflowsTab() {
  const app = useApp();
  const workflows = app.workflows;
  const agents = app.customAgents;
  const [selectedId, setSelectedId] = useState<string>('');
  const [drafts, setDrafts] = useState<Record<string, Partial<Workflow>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runText, setRunText] = useState('');

  useEffect(() => {
    if (!selectedId && workflows.length > 0) setSelectedId(workflows[0].id);
  }, [workflows, selectedId]);

  const selected = useMemo(() => {
    const base = workflows.find((w) => w.id === selectedId) || workflows[0];
    if (!base) return null;
    return { ...base, ...(drafts[base.id] || {}) };
  }, [workflows, selectedId, drafts]);

  const patch = (id: string, changes: Partial<Workflow>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...changes } }));
  };

  const isDirty = (id: string) => Boolean(drafts[id]);

  // 步骤编辑：直接改 draft 里的 steps 数组。
  const patchSteps = (id: string, steps: WorkflowStep[]) => {
    patch(id, { steps });
  };

  const addStep = (id: string) => {
    const base = selected;
    if (!base) return;
    const steps = [...(base.steps || []), newStepTemplate()];
    patchSteps(id, steps);
  };

  const updateStep = (id: string, stepId: string, changes: Partial<WorkflowStep>) => {
    const base = selected;
    if (!base) return;
    patchSteps(id, (base.steps || []).map((s) => (s.id === stepId ? { ...s, ...changes } : s)));
  };

  const removeStep = (id: string, stepId: string) => {
    const base = selected;
    if (!base) return;
    patchSteps(id, (base.steps || []).filter((s) => s.id !== stepId));
  };

  const moveStep = (id: string, stepId: string, dir: -1 | 1) => {
    const base = selected;
    if (!base) return;
    const steps = [...(base.steps || [])];
    const i = steps.findIndex((s) => s.id === stepId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    patchSteps(id, steps);
  };

  const handleAdd = async () => {
    setError(null);
    try {
      const created = await app.saveWorkflow(newWorkflowTemplate());
      setSelectedId(created.id);
      setDrafts({});
    } catch (err) {
      setError((err as Error).message || '新建工作流失败');
    }
  };

  const handleSave = async (id: string) => {
    const base = workflows.find((w) => w.id === id);
    if (!base) return;
    setSaving(id);
    setError(null);
    try {
      await app.saveWorkflow({ ...base, ...(drafts[id] || {}) });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setError((err as Error).message || '保存工作流失败');
    } finally {
      setSaving(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该工作流？')) return;
    setError(null);
    try {
      await app.removeWorkflow(id);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (selectedId === id) setSelectedId(workflows[0]?.id || '');
    } catch (err) {
      setError((err as Error).message || '删除工作流失败');
    }
  };

  // 直接运行该工作流：输入任务文本后按预定义步骤编排执行。
  // 步骤为空或含未配置智能体的步骤时给出提示，不阻断但提醒。
  const handleRun = () => {
    if (!selected) return;
    const text = runText.trim();
    if (!text) {
      setError('请输入任务描述再运行');
      return;
    }
    const steps = selected.steps || [];
    if (steps.length === 0) {
      setError('工作流还没有步骤，请先添加');
      return;
    }
    if (steps.some((s) => !s.agentId)) {
      setError('有步骤未选择智能体，请先配置');
      return;
    }
    setError(null);
    app.runWorkflow(selected.id, text);
    setRunText('');
  };

  return (
    <div className="tab-pane">
      <div className="pane-toolbar">
        <span className="pane-title">🧩 工作流编排</span>
        <span className="pane-sub">按顺序串联多个智能体，可复用</span>
        <div className="pane-actions">
          <button className="btn ghost" onClick={handleAdd}>＋ 新建</button>
        </div>
      </div>
      <div className="pane-body" style={{ padding: 0, overflow: 'hidden' }}>
        {error && <div className="ca-error">⚠️ {error}</div>}
        <div className="agents-body">
          <div className="agents-list">
            {workflows.length === 0 && (
              <div className="ca-empty">
                <p>还没有工作流</p>
                <span>新建一个，编排多个智能体依次协作</span>
              </div>
            )}
            {workflows.map((w) => {
              const d = drafts[w.id] || {};
              const name = d.name ?? w.name;
              const emoji = d.emoji ?? w.emoji;
              const color = d.color ?? w.color;
              const steps = d.steps ?? w.steps;
              return (
                <div
                  key={w.id}
                  className={`agent-row ${w.id === selectedId ? 'active' : ''}`}
                  onClick={() => setSelectedId(w.id)}
                >
                  <span className="agent-emoji" style={{ background: color + '22', color }}>
                    {emoji}
                  </span>
                  <div className="agent-row-text">
                    <span className="agent-row-name">
                      {name || '未命名'}
                      <span className="code-tag">{steps.length} 步</span>
                      {isDirty(w.id) && <span className="code-tag dirty">未保存</span>}
                    </span>
                    <span className="agent-row-goal">{w.description || '点击编辑步骤'}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {selected && (
            <div className="agent-editor ca-editor">
              <div className="field-row">
                <div className="field">
                  <label>名称</label>
                  <input
                    value={selected.name}
                    onChange={(e) => patch(selected.id, { name: e.target.value })}
                  />
                </div>
                <div className="field grow">
                  <label>描述</label>
                  <input
                    value={selected.description}
                    onChange={(e) => patch(selected.id, { description: e.target.value })}
                    placeholder="这个工作流做什么？"
                  />
                </div>
              </div>

              <div className="field-row">
                <div className="field">
                  <label>图标</label>
                  <div className="emoji-picker">
                    {AGENT_EMOJIS.map((e) => (
                      <button
                        key={e}
                        className={selected.emoji === e ? 'sel' : ''}
                        onClick={() => patch(selected.id, { emoji: e })}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label>主题色</label>
                  <div className="color-picker">
                    {AGENT_COLORS.map((col) => (
                      <button
                        key={col}
                        className={selected.color === col ? 'sel' : ''}
                        style={{ background: col }}
                        onClick={() => patch(selected.id, { color: col })}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="wf-steps">
                <div className="wf-steps-head">
                  <span>步骤序列（从上到下依次执行）</span>
                </div>

                {(selected.steps || []).length === 0 && (
                  <div className="wf-step-empty">还没有步骤，点下方添加</div>
                )}

                {(selected.steps || []).map((s, i) => {
                  const agent = agents.find((a) => a.id === s.agentId);
                  return (
                    <div className="wf-step" key={s.id}>
                      <div className="wf-step-idx">{i + 1}</div>
                      <div className="wf-step-body">
                        <div className="field-row">
                          <div className="field">
                            <label>选择已创建的智能体</label>
                            <select
                              value={s.agentId}
                              onChange={(e) => updateStep(selected.id, s.id, { agentId: e.target.value })}
                            >
                              <option value="">— 选择智能体 —</option>
                              {agents.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {agentOptionText(a)}
                                </option>
                              ))}
                            </select>
                            {agents.length === 0 && (
                              <span className="wf-no-agent-hint">还没有智能体，请先到「智能体」tab 创建</span>
                            )}
                          </div>
                          <div className="field grow">
                            <label>
                              任务模板（<code>{'{{input}}'}</code> 用户输入 · <code>{'{{prev}}'}</code> 上步产出）
                            </label>
                            <input
                              value={s.taskTemplate}
                              onChange={(e) => updateStep(selected.id, s.id, { taskTemplate: e.target.value })}
                              placeholder="留空 = 首步用用户输入，后续自动带前序产出"
                            />
                          </div>
                        </div>
                        {agent && (
                          <div className="wf-step-meta">
                            <span className="agent-emoji sm" style={{ background: agent.color + '22', color: agent.color }}>
                              {agent.emoji}
                            </span>
                            <span className="wf-step-meta-name">{agent.name}</span>
                            <span className="wf-step-meta-role">{roleSnippet(agent)}</span>
                            <span className="code-tag">{cliLabel(agent.cliId)}</span>
                          </div>
                        )}
                      </div>
                      <div className="wf-step-ctl">
                        <button className="mini" title="上移" onClick={() => moveStep(selected.id, s.id, -1)} disabled={i === 0}>↑</button>
                        <button className="mini" title="下移" onClick={() => moveStep(selected.id, s.id, 1)} disabled={i === (selected.steps || []).length - 1}>↓</button>
                        <button className="mini danger" title="删除步骤" onClick={() => removeStep(selected.id, s.id)}>✕</button>
                      </div>
                    </div>
                  );
                })}

                <button className="add-agent" onClick={() => addStep(selected.id)}>＋ 添加步骤</button>
              </div>

              <div className="wf-run">
                <div className="wf-run-head">▶ 运行此工作流</div>
                <div className="wf-run-row">
                  <input
                    value={runText}
                    onChange={(e) => setRunText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleRun(); } }}
                    placeholder="输入任务描述，回车运行（将按上述步骤依次执行）"
                  />
                  <button
                    className="btn primary"
                    onClick={handleRun}
                    disabled={app.running}
                    title={app.running ? '有任务正在运行' : '按步骤顺序运行'}
                  >
                    运行
                  </button>
                </div>
              </div>

              <div className="ca-editor-actions">
                <button
                  className="btn primary"
                  onClick={() => handleSave(selected.id)}
                  disabled={!isDirty(selected.id) || saving === selected.id}
                >
                  {saving === selected.id ? '保存中…' : '💾 保存工作流'}
                </button>
                <button className="del-agent" onClick={() => handleDelete(selected.id)}>
                  删除工作流
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
