import { useMemo } from 'react';
import type { CustomAgent, WorkflowStep } from '../../lib/multi-agent/types';
import {
  type WorkflowNodeStatus,
  layoutWorkflowGraph,
  edgePath,
  type WorkflowGraphValidation,
} from '../../lib/multi-agent/workflow-graph';

export interface WorkflowRunOverlay {
  running: boolean;
  nodeStatus: Record<string, WorkflowNodeStatus>;
  activeNodeId: string | null;
}

interface Props {
  steps: WorkflowStep[];
  agents: CustomAgent[];
  run?: WorkflowRunOverlay | null;
  onSelectStep?: (stepId: string) => void;
  selectedStepId?: string | null;
  validation?: WorkflowGraphValidation | null;
  onLinkSteps?: (fromId: string, toId: string) => void;
}

const STATUS_LABEL: Record<WorkflowNodeStatus, string> = {
  pending: '待执行',
  running: '运行中',
  done: '已完成',
  skipped: '已跳过',
  error: '失败',
};

export default function WorkflowGraph({
  steps, agents, run, onSelectStep, selectedStepId, validation, onLinkSteps,
}: Props) {
  const layout = useMemo(() => layoutWorkflowGraph(steps, agents), [steps, agents]);
  const canLink = Boolean(onLinkSteps && selectedStepId);

  if (steps.length === 0) {
    return (
      <div className="wf-graph wf-graph-empty">
        <span>添加步骤后，这里会显示 DAG 结构预览</span>
        <span className="wf-graph-empty-sub">支持并行分支、多前驱汇聚、条件跳过</span>
      </div>
    );
  }

  const showRun = Boolean(run && Object.keys(run.nodeStatus).length > 0);
  const parallelLayers = (validation?.levels || []).filter((l) => l.length > 1).length;

  return (
    <div className="wf-graph-wrap">
      <div className="wf-graph-head">
        <span className="wf-graph-title">DAG 结构预览</span>
        {parallelLayers > 0 && (
          <span className="wf-graph-meta">{parallelLayers} 层并行</span>
        )}
        {canLink && (
          <span className="wf-graph-hint">Shift+点击目标节点连线</span>
        )}
        {showRun && (
          <span className={`wf-graph-run-badge${run!.running ? ' live' : ''}`}>
            {run!.running ? '● 运行中' : '● 上次运行'}
          </span>
        )}
        {showRun && (
          <div className="wf-graph-legend">
            {(Object.keys(STATUS_LABEL) as WorkflowNodeStatus[]).map((k) => (
              <span key={k} className={`wf-leg wf-leg-${k}`}>{STATUS_LABEL[k]}</span>
            ))}
          </div>
        )}
      </div>
      {(validation?.errors.length || validation?.warnings.length) ? (
        <div className="wf-graph-issues">
          {validation!.errors.map((e) => (
            <div key={e} className="wf-graph-issue err">⚠ {e}</div>
          ))}
          {validation!.warnings.map((w) => (
            <div key={w} className="wf-graph-issue warn">◦ {w}</div>
          ))}
        </div>
      ) : null}
      <div className="wf-graph-scroll">
        <svg
          className="wf-graph-svg"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label="工作流结构图"
        >
          <defs>
            <marker id="wf-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="var(--text-faint)" />
            </marker>
          </defs>

          {layout.edges.map((e) => (
            <path
              key={`${e.from}-${e.to}`}
              className="wf-edge"
              d={edgePath(layout, e.from, e.to)}
              markerEnd="url(#wf-arrow)"
            />
          ))}

          {layout.nodes.map((n) => {
            const status: WorkflowNodeStatus | null = showRun
              ? (run!.nodeStatus[n.id] ?? 'pending')
              : null;
            const isActive = run?.activeNodeId === n.id;
            const isSelected = selectedStepId === n.id;
            return (
              <g
                key={n.id}
                className={`wf-node-g${status ? ` st-${status}` : ''}${isActive ? ' active' : ''}${isSelected ? ' selected' : ''}`}
                transform={`translate(${n.x}, ${n.y})`}
                onClick={(ev) => {
                  if (ev.shiftKey && selectedStepId && onLinkSteps && n.id !== selectedStepId) {
                    ev.stopPropagation();
                    onLinkSteps(selectedStepId, n.id);
                    return;
                  }
                  onSelectStep?.(n.id);
                }}
                style={{ cursor: onSelectStep ? 'pointer' : undefined }}
              >
                <rect
                  className="wf-node-rect"
                  width={n.width}
                  height={n.height}
                  rx={10}
                />
                <text className="wf-node-idx" x={12} y={20}>{n.index}</text>
                {status && (
                  <text className={`wf-node-status wf-node-status-${status}`} x={n.width - 10} y={18} textAnchor="end">
                    {status === 'running' ? '…' : status === 'done' ? '✓' : status === 'skipped' ? '⏭' : status === 'error' ? '✕' : '○'}
                  </text>
                )}
                <text className="wf-node-name" x={12} y={40}>{truncate(n.agentName, 18)}</text>
                <text className="wf-node-cli" x={12} y={58}>{n.cliLabel}</text>
                {n.condition ? (
                  <text className="wf-node-cond" x={12} y={74}>{truncate(`⚡ ${n.condition}`, 20)}</text>
                ) : n.badges.length > 0 ? (
                  <text className="wf-node-badges" x={12} y={74}>{truncate(n.badges.join(' · '), 22)}</text>
                ) : null}
                {(n.condition || n.taskPreview) && (
                  <title>{[n.condition && `条件: ${n.condition}`, n.taskPreview && `任务: ${n.taskPreview}`].filter(Boolean).join('\n')}</title>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}
