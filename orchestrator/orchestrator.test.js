import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileGraph, renderTask, DEFAULT_STEP_TIMEOUT_MS } from './graph.js';
import { validateGraph, topologicalLevels } from './validate.js';
import { scopesOverlap, pickParallelBatch } from './scope.js';
import { evaluateCondition } from './conditions.js';
import { parseAgentOutput } from './contract.js';

describe('compileGraph', () => {
  it('defaults to sequential chain when dependsOn empty', () => {
    const plan = [
      { agent: { id: 'a1' }, taskTemplate: '', step: { id: 's1', agentId: 'a1', dependsOn: [] } },
      { agent: { id: 'a2' }, taskTemplate: '', step: { id: 's2', agentId: 'a2', dependsOn: [] } },
    ];
    const g = compileGraph({ plan, workflow: null });
    assert.equal(g.nodes[0].dependsOn.length, 0);
    assert.deepEqual(g.nodes[1].dependsOn, ['s1']);
  });

  it('inherits agent readOnly and defaultFileScope', () => {
    const plan = [{
      agent: { id: 'a1', readOnly: true, defaultFileScope: ['src/api'] },
      taskTemplate: '',
      step: { id: 's1', agentId: 'a1', dependsOn: [] },
    }];
    const g = compileGraph({ plan, workflow: null });
    assert.equal(g.nodes[0].readOnly, true);
    assert.deepEqual(g.nodes[0].fileScope, ['src/api']);
  });

  it('applies default timeout', () => {
    const plan = [{
      agent: { id: 'a1' },
      taskTemplate: '',
      step: { id: 's1', agentId: 'a1', dependsOn: [], timeoutMs: 0 },
    }];
    const g = compileGraph({ plan, workflow: null });
    assert.equal(g.nodes[0].timeoutMs, DEFAULT_STEP_TIMEOUT_MS);
  });
});

describe('validateGraph', () => {
  it('detects cycle', () => {
    const graph = {
      nodes: [
        { id: 'a', dependsOn: ['b'], readOnly: true, fileScope: [] },
        { id: 'b', dependsOn: ['a'], readOnly: true, fileScope: [] },
      ],
    };
    const v = validateGraph(graph);
    assert.equal(v.ok, false);
    assert.match(v.errors[0], /循环依赖/);
  });
});

describe('scope', () => {
  it('empty scopes overlap', () => {
    assert.equal(scopesOverlap([], ['src/a']), true);
  });

  it('disjoint prefixes do not overlap', () => {
    assert.equal(scopesOverlap(['src/api'], ['src/components']), false);
  });

  it('pickParallelBatch allows readOnly with writer', () => {
    const ready = [
      { id: 'w', readOnly: false, fileScope: ['src/a'] },
      { id: 'r', readOnly: true, fileScope: [] },
    ];
    const batch = pickParallelBatch(ready, []);
    assert.equal(batch.length, 2);
  });

  it('pickParallelBatch blocks conflicting writers', () => {
    const ready = [
      { id: 'w1', readOnly: false, fileScope: [] },
      { id: 'w2', readOnly: false, fileScope: [] },
    ];
    const batch = pickParallelBatch(ready, []);
    assert.equal(batch.length, 1);
  });
});

describe('renderTask', () => {
  it('interpolates workspace_files', () => {
    const out = renderTask('files:\n{{workspace_files}}', {
      input: 'hi',
      prevContract: null,
      blackboardView: { input: 'hi', nodes: {} },
      workspaceFiles: ['src/App.tsx'],
    });
    assert.match(out, /src\/App\.tsx/);
  });
});

describe('parseAgentOutput', () => {
  it('parses agent-output block', () => {
    const raw = 'done\n```agent-output\n{"summary":"ok","files":["a.ts"]}\n```';
    const c = parseAgentOutput(raw);
    assert.equal(c.summary, 'ok');
    assert.deepEqual(c.files, ['a.ts']);
  });
});

describe('evaluateCondition', () => {
  it('empty condition is true', () => {
    assert.equal(evaluateCondition('', { input: 'x', nodes: {} }), true);
  });

  it('contains on summary', () => {
    const view = {
      input: '',
      nodes: {
        s1: { contract: { summary: 'build complete' }, exitCode: 0 },
      },
    };
    assert.equal(evaluateCondition('nodes.s1.contract.summary contains "complete"', view), true);
  });
});

describe('executeGraph', () => {
  it('requires executeNode in ctx', async () => {
    const { executeGraph } = await import('./executor.js');
    const graph = {
      nodes: [{
        id: 's1', agentId: 'a1', taskTemplate: '', dependsOn: [],
        condition: '', retry: { maxAttempts: 1, backoffMs: 0 },
        timeoutMs: 1000, fileScope: [], readOnly: true, onFailure: 'continue',
      }],
    };
    await assert.rejects(
      () => executeGraph(graph, { input: 'x', getAgent: () => ({ id: 'a1' }) }, {}),
      /executeNode/,
    );
  });
});
