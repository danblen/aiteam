import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../store/AppProvider';
import {
  type CustomAgent,
  type AgentCliId,
  CLI_OPTIONS,
  newCustomAgentTemplate,
  presetTeamTemplates,
  cliLabel,
} from '../../lib/multi-agent';

/**
 * 自定义智能体管理 Tab。
 * 每个智能体 = 一个 CLI + 自定义 system prompt + 可选 model，持久化到服务端。
 * 编辑采用「本地草稿 + 显式保存」：文本类字段先入草稿，点保存才落库，避免每次按键打 API。
 */
export default function AgentsTab() {
  const app = useApp();
  const agents = app.customAgents;
  const [selectedId, setSelectedId] = useState<string>('');
  const [drafts, setDrafts] = useState<Record<string, Partial<CustomAgent>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 首次进入或刷新后，自动选中第一个智能体。
  useEffect(() => {
    if (!selectedId && agents.length > 0) setSelectedId(agents[0].id);
  }, [agents, selectedId]);

  const selected = useMemo(() => {
    const base = agents.find((a) => a.id === selectedId) || agents[0];
    if (!base) return null;
    return { ...base, ...(drafts[base.id] || {}) };
  }, [agents, selectedId, drafts]);

  const patch = (id: string, changes: Partial<CustomAgent>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...changes } }));
  };

  const isDirty = (id: string) => Boolean(drafts[id]);

  const handleAdd = async () => {
    setError(null);
    try {
      const tpl = newCustomAgentTemplate();
      const created = await app.saveCustomAgent(tpl);
      setSelectedId(created.id);
      setDrafts({});
    } catch (err) {
      setError((err as Error).message || '新建智能体失败');
    }
  };

  const handleSave = async (id: string) => {
    const base = agents.find((a) => a.id === id);
    if (!base) return;
    setSaving(id);
    setError(null);
    try {
      await app.saveCustomAgent({ ...base, ...(drafts[id] || {}) });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setError((err as Error).message || '保存智能体失败');
    } finally {
      setSaving(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (agents.length <= 0) return;
    if (!confirm('确定删除该智能体？工作流中引用它的步骤会失效。')) return;
    setError(null);
    try {
      await app.removeCustomAgent(id);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (selectedId === id) setSelectedId(agents[0]?.id || '');
    } catch (err) {
      setError((err as Error).message || '删除智能体失败');
    }
  };

  const handleImportPreset = async () => {
    if (importing) return;
    setImporting(true);
    setError(null);
    try {
      const cliId = (app.envConfig.local.cliId || 'claude') as AgentCliId;
      let lastId = '';
      for (const tpl of presetTeamTemplates(cliId)) {
        const created = await app.saveCustomAgent(tpl);
        lastId = created.id;
      }
      if (lastId) setSelectedId(lastId);
      setDrafts({});
    } catch (err) {
      setError((err as Error).message || '导入示例团队失败');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="tab-pane">
      <div className="pane-toolbar">
        <span className="pane-title">🤖 智能体</span>
        <span className="pane-sub">绑定 CLI + 提示词，本地 / 云端均可运行</span>
        <div className="pane-actions">
          <button className="btn ghost" onClick={handleImportPreset} disabled={importing}>
            {importing ? '导入中…' : '导入示例团队'}
          </button>
          <button className="btn ghost" onClick={handleAdd}>＋ 新建</button>
        </div>
      </div>
      <div className="pane-body agents-pane">
        {error && <div className="ca-error">⚠️ {error}</div>}
        <div className="agents-body">
          <div className="agents-list">
            {agents.length === 0 && (
              <div className="ca-empty">
                <p>还没有智能体</p>
                <span>新建一个，或导入 PM → 设计 → 评审 → 工程师 示例团队</span>
              </div>
            )}
            {agents.map((a) => {
              const d = drafts[a.id] || {};
              const name = d.name ?? a.name;
              const enabled = d.enabled ?? a.enabled;
              const cliId = (d.cliId ?? a.cliId) as AgentCliId;
              return (
                <div
                  key={a.id}
                  className={`agent-row ${a.id === selectedId ? 'active' : ''} ${enabled ? '' : 'off'}`}
                  onClick={() => setSelectedId(a.id)}
                >
                  <div className="agent-row-text">
                    <span className="agent-row-name">
                      {name || '未命名'}
                      <span className="code-tag">{cliLabel(cliId)}</span>
                      {isDirty(a.id) && <span className="code-tag dirty">未保存</span>}
                    </span>
                    <span className="agent-row-goal">{a.systemPrompt.slice(0, 50) || '无提示词'}</span>
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
                <div className="field">
                  <label>绑定 CLI</label>
                  <select
                    value={selected.cliId}
                    onChange={(e) => patch(selected.id, { cliId: e.target.value as AgentCliId })}
                  >
                    {CLI_OPTIONS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="field">
                <label>角色系统提示词（定义该智能体的行为与职责）</label>
                <textarea
                  rows={7}
                  value={selected.systemPrompt}
                  onChange={(e) => patch(selected.id, { systemPrompt: e.target.value })}
                  placeholder="你是一名……，你的职责是……"
                />
              </div>

              <div className="field">
                <label>模型覆盖（留空走 CLI 默认；claude/aider 走 --model）</label>
                <input
                  value={selected.model}
                  onChange={(e) => patch(selected.id, { model: e.target.value })}
                  placeholder="例如 claude-sonnet-4-5、gpt-5"
                />
              </div>

              <label className="check-line">
                <input
                  type="checkbox"
                  checked={selected.producesCode}
                  onChange={(e) => patch(selected.id, { producesCode: e.target.checked })}
                />
                该智能体产出最终代码
              </label>

              <label className="check-line">
                <input
                  type="checkbox"
                  checked={selected.readOnly === true}
                  onChange={(e) => patch(selected.id, { readOnly: e.target.checked })}
                />
                只读智能体（review/test，可与其他步骤并行）
              </label>

              <div className="field">
                <label>默认写文件域（逗号分隔 glob；工作流步骤可覆盖）</label>
                <input
                  value={(selected.defaultFileScope || []).join(', ')}
                  onChange={(e) => patch(selected.id, {
                    defaultFileScope: e.target.value.split(',').map((x) => x.trim()).filter(Boolean),
                  })}
                  placeholder="例：src/components"
                />
              </div>

              <label className="check-line">
                <input
                  type="checkbox"
                  checked={selected.enabled}
                  onChange={(e) => patch(selected.id, { enabled: e.target.checked })}
                />
                启用（关闭后不在选择器中出现）
              </label>

              <div className="ca-editor-actions">
                <button
                  className="btn primary"
                  onClick={() => handleSave(selected.id)}
                  disabled={!isDirty(selected.id) || saving === selected.id}
                >
                  {saving === selected.id ? '保存中…' : '💾 保存修改'}
                </button>
                <button className="del-agent" onClick={() => handleDelete(selected.id)} disabled={agents.length === 0}>
                  删除
                </button>
              </div>

              <p className="ca-hint">
                {CLI_OPTIONS.find((c) => c.id === selected.cliId)?.desc}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
