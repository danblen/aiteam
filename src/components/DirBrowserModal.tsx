import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { listLocalDirs } from '../lib/api';
import type { LocalDirEntry } from '../lib/api';

interface Props {
  /** 初始展示的目录（可选，缺省为后端家目录）。 */
  initialPath?: string;
  onPick: (absPath: string) => void;
  onClose: () => void;
}

export default function DirBrowserModal({ initialPath, onPick, onClose }: Props) {
  const [cwd, setCwd] = useState(initialPath || '');
  const [parent, setParent] = useState<string | null>(null);
  const [dirs, setDirs] = useState<LocalDirEntry[]>([]);
  const [scoped, setScoped] = useState(false);
  const [scopeRoot, setScopeRoot] = useState<string | null>(null);
  const [manual, setManual] = useState(initialPath || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (p?: string) => {
    setLoading(true);
    setError(null);
    listLocalDirs(p)
      .then((res) => {
        setCwd(res.path);
        setParent(res.parent);
        setDirs(res.dirs);
        setScoped(Boolean(res.scoped));
        setScopeRoot(res.root ?? null);
        setManual(res.path);
      })
      .catch((err) => setError((err as Error).message || '读取目录失败'))
      .finally(() => setLoading(false));
  };

  // 首次加载。
  useEffect(() => {
    load(initialPath || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ESC 关闭。
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const dialog = (
    <div className="env-modal-wrap" onClick={onClose}>
      <div className="modal dir-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>选择工作目录</h2>
          <button className="icon-btn" title="关闭" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="dir-path-row">
          {!scoped && (
            <>
              <input
                className="env-input"
                value={manual}
                placeholder="直接输入绝对路径，回车跳转"
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    load(manual.trim() || undefined);
                  }
                }}
              />
              <button className="btn-ghost" onClick={() => load(manual.trim() || undefined)}>
                跳转
              </button>
            </>
          )}
          {scoped && scopeRoot && (
            <span className="env-hint" title={scopeRoot}>工作空间：{scopeRoot}</span>
          )}
        </div>

        <div className="dir-body">
          {error && <p className="env-hint warn">{error}</p>}
          {loading ? (
            <p className="env-hint">加载中…</p>
          ) : (
            <div className="dir-list">
              {parent && (
                <button className="dir-item up" onClick={() => load(parent)}>
                  <span className="dir-ico">📁</span>
                  <span className="dir-name">.. 返回上级</span>
                </button>
              )}
              {dirs.length === 0 && !parent ? (
                <p className="env-hint">该目录下没有可进入的子目录。</p>
              ) : (
                dirs.map((d) => (
                  <button key={d.path} className="dir-item" onClick={() => load(d.path)}>
                    <span className="dir-ico">📁</span>
                    <span className="dir-name">{d.name}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <span className="env-foot-hint" title={cwd}>
            当前：{cwd || '—'}
          </span>
          <div className="foot-right">
            <button className="btn-ghost" onClick={onClose}>
              取消
            </button>
            <button
              className="btn-primary"
              disabled={!cwd}
              onClick={() => {
                if (cwd) onPick(cwd);
              }}
            >
              选择此目录
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
