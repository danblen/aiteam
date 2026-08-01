import { useMemo } from 'react';
import { useApp } from '../../store/AppProvider';
import ProjectPicker from '../ProjectPicker';
import {
  deriveProductOverview,
  detectTechStack,
  primaryFrameworkBadge,
} from '../../lib/project-overview';

function fmtDate(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function OverviewTab() {
  const app = useApp();
  const s = app.current;

  const product = useMemo(() => deriveProductOverview(s), [s]);
  const techStack = useMemo(() => detectTechStack(s.files, s.framework), [s.files, s.framework]);
  const frameworkBadge = useMemo(
    () => primaryFrameworkBadge(s.files, s.framework),
    [s.files, s.framework],
  );

  const history = useMemo(
    () => s.messages.filter((m) => m.kind === 'user').map((m) => m.content),
    [s.messages],
  );

  const componentCount = s.files.filter((f) => /\.(jsx|tsx|vue|svelte)$/i.test(f.path)).length;
  const hasActivity = s.files.length > 0 || s.messages.length > 0;

  if (!hasActivity) {
    return (
      <div className="tab-pane">
        <div className="pane-toolbar">
          <span className="pane-title">项目概览</span>
        </div>
        <div className="pane-body overview-body">
          <ProjectPicker />
          <div className="ov-empty-hint">
            <div className="pane-empty-glyph">📋</div>
            <p>项目概览</p>
            <span>在左侧描述你的需求，这里会根据对话与生成文件汇总产品说明与技术栈。</span>
          </div>
        </div>
      </div>
    );
  }

  const descriptionBlocks = product.description.split('\n\n').filter(Boolean);

  return (
    <div className="tab-pane">
      <div className="pane-toolbar">
        <span className="pane-title">项目概览</span>
        <span className="pane-sub">更新于 {fmtDate(s.updatedAt)}</span>
      </div>
      <div className="pane-body overview-body">
        <div className="ov-hero">
          <h2>{s.title}</h2>
          <div className="ov-badges">
            {s.files.length > 0 && (
              <span className="ov-badge">{frameworkBadge}</span>
            )}
            {s.files.length > 0 && (
              <span className="ov-badge">{s.files.length} 个文件</span>
            )}
            {componentCount > 0 && <span className="ov-badge">{componentCount} 个组件</span>}
            <span className={`ov-badge ${s.previewUrl ? 'ok' : ''}`}>
              {s.previewUrl ? '● 已构建' : s.files.length > 0 ? '未构建' : '尚无代码'}
            </span>
          </div>
        </div>

        <div className="ov-grid">
          {s.messages.length === 0 && s.files.length === 0 && <ProjectPicker />}
          <section className="ov-card">
            <h3>产品描述</h3>
            {product.description ? (
              <div className="ov-summary">
                {descriptionBlocks.map((block, i) => (
                  <p key={i}>{block}</p>
                ))}
              </div>
            ) : (
              <p className="ov-muted">还没有对话或产出，发送需求后会根据你的描述自动汇总。</p>
            )}
            {product.features.length > 0 && (
              <ul className="ov-features">
                {product.features.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            )}
            {product.source === 'conversation' && history.length > 0 && product.features.length === 0 && (
              <p className="ov-muted ov-source-hint">基于 {history.length} 轮用户需求</p>
            )}
          </section>

          <section className="ov-card">
            <h3>技术栈</h3>
            {techStack.length > 0 ? (
              <ul className="ov-stack">
                {techStack.map((item) => (
                  <li key={item.label}>{item.icon} {item.label}</li>
                ))}
              </ul>
            ) : s.messages.length > 0 ? (
              <p className="ov-muted">代码尚未生成；发送任务后将根据项目文件自动识别技术栈。</p>
            ) : (
              <p className="ov-muted">暂无项目文件。</p>
            )}
          </section>

          <section className="ov-card">
            <h3>统计</h3>
            <div className="ov-stats">
              <div className="ov-stat">
                <strong>{history.length}</strong>
                <span>需求轮次</span>
              </div>
              <div className="ov-stat">
                <strong>{s.files.length}</strong>
                <span>文件</span>
              </div>
              <div className="ov-stat">
                <strong>{app.customAgents.filter((a) => a.enabled).length}</strong>
                <span>启用智能体</span>
              </div>
              <div className="ov-stat">
                <strong>{s.messages.length}</strong>
                <span>消息</span>
              </div>
            </div>
            <p className="ov-muted ov-created">创建于 {fmtDate(s.createdAt)}</p>
          </section>

          <section className="ov-card ov-card-wide">
            <h3>历史工作 / 记忆</h3>
            {history.length === 0 ? (
              <p className="ov-muted">还没有历史需求。</p>
            ) : (
              <ol className="ov-history">
                {history.map((h, i) => (
                  <li key={i}>
                    <span className="ov-step">{i + 1}</span>
                    <span className="ov-step-text">{h}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
