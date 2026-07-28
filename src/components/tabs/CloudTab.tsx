import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../store/AppProvider';
import { listProjects, createProject, deleteProject } from '../../lib/api';
import type { RemoteProject } from '../../lib/api';

export default function CloudTab() {
  const app = useApp();
  const s = app.current;
  const [projects, setProjects] = useState<RemoteProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loggedIn = Boolean(app.authEmail);
  // 新会话（未发过消息）→ 选项目时仅预选，首条消息发出时再绑定。
  const isFresh = s.messages.length === 0;

  const refresh = useCallback(() => {
    if (!loggedIn) return;
    setLoading(true);
    setError(null);
    listProjects()
      .then(setProjects)
      .catch((e) => setError((e as Error).message || '读取项目失败'))
      .finally(() => setLoading(false));
  }, [loggedIn]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 选择项目：新会话预选（待发消息时绑定），已有消息则立即绑定。
  const selectProject = useCallback(
    async (project: RemoteProject) => {
      setBusy(true);
      setError(null);
      try {
        if (isFresh) {
          app.setPendingProject(s.id, project, false);
        } else {
          await app.bindSessionProject(s.id, project);
        }
      } catch (e) {
        setError((e as Error).message || '绑定项目失败');
      } finally {
        setBusy(false);
      }
    },
    [app, s.id, isFresh],
  );

  // 新建项目：新会话仅预选，已有消息则立即绑定。
  const create = useCallback(async () => {
    const n = name.trim();
    setBusy(true);
    setError(null);
    try {
      const project = await createProject(n);
      setName('');
      setProjects((prev) => [project, ...prev]);
      if (isFresh) {
        app.setPendingProject(s.id, project, true);
      } else {
        await app.bindSessionProject(s.id, project, true);
      }
    } catch (e) {
      setError((e as Error).message || '新建项目失败');
    } finally {
      setBusy(false);
    }
  }, [app, name, s.id, isFresh]);

  const handleDelete = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      if (!window.confirm('确定要删除该项目吗？项目目录及所有数据将被永久删除，不可恢复。')) return;
      setDeletingId(id);
      setError(null);
      try {
        await deleteProject(id);
        setProjects((prev) => prev.filter((p) => p.id !== id));
        // 如果删的是已预选的项目，清除预选。
        if (s.pendingProjectId === id) app.clearPendingProject(s.id);
      } catch (err) {
        setError((err as Error).message || '删除项目失败');
      } finally {
        setDeletingId(null);
      }
    },
    [app, s.id, s.pendingProjectId],
  );

  const fmtDate = (ts: number) => {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // ── 已绑定项目 ──
  if (s.projectId || s.projectLocked) {
    return (
      <div className="tab-pane">
        <div className="pane-toolbar">
          <span className="pane-title">云端项目</span>
          <span className="cloud-badge connected">已绑定</span>
        </div>
        <div className="pane-body cloud-body">
          <div className="cloud-connected">
            <div className="cloud-connected-head">
              <span className="cloud-ico">📦</span>
              <div>
                <strong>{s.projectName || s.projectId}</strong>
                <p>当前会话已绑定此项目，可在概览页查看详情与合并操作。</p>
              </div>
            </div>
            <div className="cloud-ops">
              <button className="cloud-op" onClick={() => app.setActiveTab('overview')}>📋 查看概览</button>
              <button className="cloud-op" onClick={() => app.setActiveTab('code')}>💻 打开代码</button>
              <button className="cloud-op" onClick={() => app.setActiveTab('preview')}>👁 预览</button>
              <button className="cloud-op" onClick={refresh}>🔄 刷新项目列表</button>
            </div>
          </div>

          <div className="project-list" style={{ marginTop: 16 }}>
            <div className="project-list-label">所有项目</div>
            {loading ? (
              <p className="env-hint">加载中…</p>
            ) : projects.length === 0 ? (
              <p className="env-hint">还没有项目</p>
            ) : (
              projects.map((p) => (
                <div
                  key={p.id}
                  className={`project-item ${p.id === s.projectId ? 'active' : ''}`}
                  style={{ cursor: 'default', opacity: 0.6 }}
                >
                  <span className="project-item-ico">📦</span>
                  <span className="project-item-name">{p.name}</span>
                  <span className="project-item-meta">{fmtDate(p.updatedAt)}</span>
                  {p.id === s.projectId && (
                    <span className="project-item-meta" style={{ color: 'var(--accent)' }}>当前</span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── 已预选项目（新会话，等待发消息） ──
  if (s.pendingProjectId) {
    const isNew = s.pendingProjectIsNew;
    return (
      <div className="tab-pane">
        <div className="pane-toolbar">
          <span className="pane-title">云端项目</span>
          <span className="cloud-badge connecting">待绑定</span>
        </div>
        <div className="pane-body cloud-body">
          <div className="cloud-connected">
            <div className="cloud-connected-head">
              <span className="cloud-ico">📦</span>
              <div>
                <strong>{s.pendingProjectName || s.pendingProjectId}</strong>
                <p>
                  {isNew
                    ? '新项目已创建，发送第一条消息后将自动绑定到本会话。'
                    : '已选择此项目，发送第一条消息后将自动创建工作树并绑定。'}
                </p>
              </div>
            </div>
            <div className="cloud-ops">
              <button className="cloud-op" onClick={() => {
                app.clearPendingProject(s.id);
              }}>
                ↩ 更换项目
              </button>
            </div>
          </div>

          {error && <p className="env-hint warn" style={{ marginTop: 12 }}>{error}</p>}

          <div className="project-list" style={{ marginTop: 16 }}>
            <div className="project-list-label">所有项目</div>
            {loading ? (
              <p className="env-hint">加载中…</p>
            ) : projects.length === 0 ? (
              <p className="env-hint">还没有项目</p>
            ) : (
              projects.map((p) => (
                <div
                  key={p.id}
                  className={`project-item ${p.id === s.pendingProjectId ? 'active' : ''}`}
                  style={{ cursor: 'pointer', opacity: busy ? 0.5 : 1 }}
                  onClick={() => p.id !== s.pendingProjectId && selectProject(p)}
                >
                  <span className="project-item-ico">📦</span>
                  <span className="project-item-name">{p.name}</span>
                  <span className="project-item-meta">{fmtDate(p.updatedAt)}</span>
                  {p.id === s.pendingProjectId ? (
                    <span className="project-item-meta" style={{ color: 'var(--accent)' }}>已选</span>
                  ) : (
                    <span
                      className="project-item-del"
                      title="删除项目"
                      onClick={(e) => handleDelete(e, p.id)}
                    >
                      {deletingId === p.id ? '…' : '×'}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── 未登录 ──
  if (!loggedIn) {
    return (
      <div className="tab-pane">
        <div className="pane-toolbar">
          <span className="pane-title">云端项目</span>
          <span className="cloud-badge disconnected">未登录</span>
        </div>
        <div className="pane-body cloud-body">
          <div className="cloud-connected" style={{ textAlign: 'center', padding: '32px 16px' }}>
            <div className="cloud-ico" style={{ fontSize: 32, marginBottom: 12 }}>☁️</div>
            <p style={{ color: 'var(--muted)', margin: 0 }}>
              请先登录以查看和管理你的云端项目。
            </p>
            <p style={{ color: 'var(--muted)', margin: '8px 0 0', fontSize: 13 }}>
              点击左侧边栏底部的用户按钮进行登录 / 注册。
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── 项目列表（未选、非新会话则点击即绑定） ──
  const hint = isFresh
    ? '选择项目后将在发送第一条消息时自动绑定。'
    : '选择项目后将立即为本会话创建 Git 工作树分支。';

  return (
    <div className="tab-pane">
      <div className="pane-toolbar">
        <span className="pane-title">云端项目</span>
        <span className="cloud-badge connected">已登录</span>
      </div>

      <div className="pane-body cloud-body">
        <p className="env-hint">{hint}</p>
        {error && <p className="env-hint warn" style={{ marginBottom: 12 }}>{error}</p>}

        <div className="project-new">
          <input
            className="env-input"
            placeholder="项目名称（可选，留空自动命名）"
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                create();
              }
            }}
          />
          <button className="btn-primary" onClick={create} disabled={busy}>
            {busy ? '创建中…' : isFresh ? '新建并预选' : '新建并使用'}
          </button>
        </div>

        <div className="project-list" style={{ marginTop: 14 }}>
          {loading ? (
            <p className="env-hint">加载中…</p>
          ) : projects.length === 0 ? (
            <p className="env-hint">还没有项目，在上方新建一个开始吧。</p>
          ) : (
            projects.map((p) => (
              <button
                key={p.id}
                className="project-item"
                disabled={busy || deletingId === p.id}
                onClick={() => selectProject(p)}
              >
                <span className="project-item-ico">📦</span>
                <span className="project-item-name">{p.name}</span>
                <span className="project-item-meta">{fmtDate(p.updatedAt)}</span>
                <span
                  className="project-item-del"
                  title="删除项目"
                  onClick={(e) => handleDelete(e, p.id)}
                >
                  {deletingId === p.id ? '…' : '×'}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
