import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../store/AppProvider';
import { type Workflow, type WorkflowStep, type CustomAgent, newWorkflowTemplate, newStepTemplate, cliLabel } from '../../lib/custom-agents';

/** 取智能体角色提示词的前若干字，用作下拉框里区分同名智能体的副标识。 */
function roleSnippet(a: CustomAgent): string {
  const s = (a.systemPrompt || '').trim().replace(/\s+/g, ' ');
  return s.length > 24 ? s.slice(0, 24) + '…' : s || '无提示词';
}

/** 下拉框里每个智能体的展示文案：名称为主，角色为辅（不再以 CLI 作为区分依据）。 */
function agentOptionText(a: CustomAgent): string {
  const role = roleSnippet(a);
  return `${a.name || '未命名'}（${role}）`;
}

/** 步骤是否配置了非默认高级选项（用于摘要徽章）。 */
function stepHasAdvanced(s: WorkflowStep): boolean {
  return Boolean(
    (s.dependsOn && s.dependsOn.length > 0)
    || (s.condition && s.condition.trim())
    || (s.retry?.maxAttempts && s.retry.maxAttempts > 1)
    || (s.timeoutMs && s.timeoutMs > 0)
    || (s.fileScope && s.fileScope.length > 0)
    || s.readOnly
    || (s.onFailure && s.onFailure !== 'continue'),
  );
}

/** 高级编排摘要徽章文案。 */
function stepAdvancedBadges(s: WorkflowStep, _stepIndex: number, allSteps: WorkflowStep[]): string[] {
  const badges: string[] = [];
  if (s.readOnly) badges.push('只读·可并行');
  if (s.fileScope?.length) badges.push(`域 ${s.fileScope.length}`);
  if (s.dependsOn?.length) {
    const nums = s.dependsOn.map((id) => allSteps.findIndex((x) => x.id === id) + 1).filter((n) => n > 0);
    badges.push(nums.length ? `依赖 #${nums.join(', #')}` : '自定义依赖');
  }
  if (s.condition?.trim()) badges.push('条件');
  if ((s.retry?.maxAttempts ?? 1) > 1) badges.push(`重试×${s.retry!.maxAttempts}`);
  if (s.timeoutMs && s.timeoutMs > 0) badges.push(`${Math.round(s.timeoutMs / 1000)}s`);
  if (s.onFailure && s.onFailure !== 'continue') {
    badges.push(s.onFailure === 'abort' ? '失败中止' : '失败跳过下游');
  }
  return badges;
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
              const steps = d.steps ?? w.steps;
              return (
                <div
                  key={w.id}
                  className={`agent-row ${w.id === selectedId ? 'active' : ''}`}
                  onClick={() => setSelectedId(w.id)}
                >
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

              <div className="wf-steps">
                <div className="wf-steps-head">
                  <span>步骤序列</span>
                  <span className="wf-steps-sub">默认顺序执行；展开「高级编排」可配置依赖与并行</span>
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
                            <label className="wf-label-row">
                              <span>任务模板</span>
                              <span
                                className="wf-var-hint"
                                title="支持 {{input}}、{{prev}}、{{prev.files}}、{{nodes.x.contract.summary}}、{{workspace_files}}"
                              >
                                变量 ?
                              </span>
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
                            <span className="wf-step-meta-name">{agent.name}</span>
                            <span className="wf-step-meta-role">{roleSnippet(agent)}</span>
                            <span className="code-tag">{cliLabel(agent.cliId)}</span>
                          </div>
                        )}
                        <details className="wf-step-advanced">
                          <summary className="wf-adv-summary">
                            <span className="wf-adv-summary-title">高级编排</span>
                            <span className="wf-adv-badges">
                              {stepAdvancedBadges(s, i, selected.steps || []).map((b) => (
                                <span key={b} className="wf-adv-badge">{b}</span>
                              ))}
                              {!stepHasAdvanced(s) && (
                                <span className="wf-adv-badge muted">默认顺序执行</span>
                              )}
                            </span>
                          </summary>
                          <div className="wf-adv-panel">
                            <section className="wf-adv-section">
                              <div className="wf-adv-section-title">并行与文件域</div>
                              <div className="wf-adv-grid">
                                <div className="field grow">
                                  <label>写文件域</label>
                                  <input
                                    value={(s.fileScope || []).join(', ')}
                                    onChange={(e) => updateStep(selected.id, s.id, {
                                      fileScope: e.target.value.split(',').map((x) => x.trim()).filter(Boolean),
                                    })}
                                    placeholder="glob 前缀，逗号分隔；空 = 独占工作区"
                                  />
                                  <span className="field-hint">例：src/components, src/api</span>
                                </div>
                                <div className="field wf-adv-checks">
                                  <label className="check-line">
                                    <input
                                      type="checkbox"
                                      checked={s.readOnly === true}
                                      onChange={(e) => updateStep(selected.id, s.id, { readOnly: e.target.checked })}
                                    />
                                    只读步骤（可与其他步骤并行）
                                  </label>
                                </div>
                              </div>
                            </section>

                            <section className="wf-adv-section">
                              <div className="wf-adv-section-title">依赖关系</div>
                              <p className="wf-adv-desc">不选 = 等上一步完成；选中多个 = 仅等指定步骤，无依赖关系的步骤可并行。</p>
                              <div className="dep-chips">
                                {(selected.steps || []).map((other, j) => {
                                  if (other.id === s.id) return null;
                                  const deps = s.dependsOn || [];
                                  const on = deps.includes(other.id);
                                  const otherAgent = agents.find((a) => a.id === other.agentId);
                                  return (
                                    <button
                                      key={other.id}
                                      type="button"
                                      className={`dep-chip${on ? ' on' : ''}`}
                                      onClick={() => {
                                        const next = on ? deps.filter((d) => d !== other.id) : [...deps, other.id];
                                        updateStep(selected.id, s.id, { dependsOn: next });
                                      }}
                                      title={otherAgent?.name || `步骤 ${j + 1}`}
                                    >
                                      <span className="dep-chip-num">{j + 1}</span>
                                      {otherAgent && <span className="dep-chip-name">{otherAgent.name}</span>}
                                    </button>
                                  );
                                })}
                                {(selected.steps || []).length <= 1 && (
                                  <span className="wf-adv-empty">添加更多步骤后可配置依赖</span>
                                )}
                              </div>
                            </section>

                            <section className="wf-adv-section">
                              <div className="wf-adv-section-title">条件 · 重试 · 超时</div>
                              <div className="wf-adv-grid wf-adv-grid-3">
                                <div className="field grow span-2">
                                  <label>执行条件</label>
                                  <input
                                    value={s.condition || ''}
                                    onChange={(e) => updateStep(selected.id, s.id, { condition: e.target.value })}
                                    placeholder="留空 = 总是执行；例 nodes.s1.exitCode == 0"
                                  />
                                </div>
                                <div className="field">
                                  <label>失败后</label>
                                  <select
                                    value={s.onFailure || 'continue'}
                                    onChange={(e) => updateStep(selected.id, s.id, {
                                      onFailure: e.target.value as WorkflowStep['onFailure'],
                                    })}
                                  >
                                    <option value="continue">继续后续</option>
                                    <option value="skip-dependents">跳过依赖方</option>
                                    <option value="abort">中止工作流</option>
                                  </select>
                                </div>
                                <div className="field">
                                  <label>重试</label>
                                  <input
                                    type="number"
                                    min={1}
                                    max={5}
                                    value={s.retry?.maxAttempts ?? 1}
                                    onChange={(e) => updateStep(selected.id, s.id, {
                                      retry: {
                                        maxAttempts: Math.max(1, Math.min(5, Number(e.target.value) || 1)),
                                        backoffMs: s.retry?.backoffMs ?? 0,
                                      },
                                    })}
                                  />
                                </div>
                                <div className="field">
                                  <label>超时（秒）</label>
                                  <input
                                    type="number"
                                    min={0}
                                    value={Math.round((s.timeoutMs || 0) / 1000)}
                                    onChange={(e) => updateStep(selected.id, s.id, {
                                      timeoutMs: Math.max(0, Number(e.target.value) || 0) * 1000,
                                    })}
                                    placeholder="0 = 默认 5 分钟"
                                  />
                                </div>
                              </div>
                            </section>
                          </div>
                        </details>
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
