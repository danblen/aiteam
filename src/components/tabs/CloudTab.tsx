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

  const bind = useCallback(
    async (project: RemoteProject) => {
      setBusy(true);
      setError(null);
      try {
        await app.bindSessionProject(s.id, project);
      } catch (e) {
        setError((e as Error).message || '绑定项目失败');
      } finally {
        setBusy(false);
      }
    },
    [app, s.id],
  );

  const create = useCallback(async () => {
    const n = name.trim();
    setBusy(true);
    setError(null);
    try {
      const project = await createProject(n);
      setName('');
      setProjects((prev) => [project, ...prev]);
      await app.bindSessionProject(s.id, project, true);
    } catch (e) {
      setError((e as Error).message || '新建项目失败');
    } finally {
      setBusy(false);
    }
  }, [app, name, s.id]);

  const handleDelete = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      if (!window.confirm('确定要删除该项目吗？项目目录及所有数据将被永久删除，不可恢复。')) return;
      setDeletingId(id);
      setError(null);
      try {
        await deleteProject(id);
        setProjects((prev) => prev.filter((p) => p.id !== id));
      } catch (err) {
        setError((err as Error).message || '删除项目失败');
      } finally {
        setDeletingId(null);
      }
    },
    [],
  );

  const fmtDate = (ts: number) => {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // 已绑定项目 → 显示当前项目信息
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
                  style={{ cursor: p.id === s.projectId ? 'default' : 'pointer', opacity: busy ? 0.5 : 1 }}
                  onClick={() => p.id !== s.projectId && bind(p)}
                >
                  <span className="project-item-ico">📦</span>
                  <span className="project-item-name">{p.name}</span>
                  <span className="project-item-meta">{fmtDate(p.updatedAt)}</span>
                  {p.id === s.projectId ? (
                    <span className="project-item-meta" style={{ color: 'var(--accent)' }}>当前</span>
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

  // 未登录
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

  // 项目列表
  return (
    <div className="tab-pane">
      <div className="pane-toolbar">
        <span className="pane-title">云端项目</span>
        <span className="cloud-badge connected">已登录</span>
      </div>

      <div className="pane-body cloud-body">
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
            {busy ? '创建中…' : '新建项目'}
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
                onClick={() => bind(p)}
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
