/**
 * 多智能体 Run 事件日志 —— 支持 SSE 断线重连与显式中止。
 *
 * 内存 LRU：最多保留 MAX_RUNS 个 run，超出淘汰最旧的。
 */

const MAX_RUNS = 64;
const MAX_EVENTS_PER_RUN = 2000;

/** @type {Map<string, RunRecord>} */
const _runs = new Map();

function genRunId() {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function evictOldest() {
  if (_runs.size < MAX_RUNS) return;
  let oldestId = null;
  let oldestTs = Infinity;
  for (const [id, rec] of _runs) {
    if (rec.createdAt < oldestTs) {
      oldestTs = rec.createdAt;
      oldestId = id;
    }
  }
  if (oldestId) _runs.delete(oldestId);
}

/** @param {object} [meta] */
export function createRun(meta = {}) {
  evictOldest();
  const id = genRunId();
  const rec = {
    id,
    status: 'running',
    createdAt: Date.now(),
    meta,
    abortController: new AbortController(),
    events: [],
    nextEventId: 1,
  };
  _runs.set(id, rec);
  return rec;
}

/** @param {string} runId */
export function getRun(runId) {
  return _runs.get(runId) || null;
}

/** @param {string} runId */
export function getAbortSignal(runId) {
  return _runs.get(runId)?.abortController.signal;
}

/** @param {string} runId */
export function abortRun(runId) {
  const rec = _runs.get(runId);
  if (!rec || rec.status !== 'running') return false;
  rec.abortController.abort();
  rec.status = 'aborted';
  return true;
}

/** @param {string} runId @param {'done'|'failed'|'aborted'} status */
export function finishRun(runId, status) {
  const rec = _runs.get(runId);
  if (!rec) return;
  if (rec.status === 'running') rec.status = status;
}

/**
 * 追加事件并返回 SSE 帧（含 id: 字段）。
 * @returns {{ frame: string, eventId: number } | null}
 */
export function appendRunEvent(runId, event, data) {
  const rec = _runs.get(runId);
  if (!rec) return null;
  const eventId = rec.nextEventId++;
  rec.events.push({ id: eventId, event, data, ts: Date.now() });
  if (rec.events.length > MAX_EVENTS_PER_RUN) {
    rec.events.shift();
  }
  const frame = `id: ${eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  return { frame, eventId };
}

/**
 * 取 runId 下 id > since 的事件（用于 Last-Event-ID 重连）。
 * @param {string} runId
 * @param {number} since
 */
export function getEventsSince(runId, since) {
  const rec = _runs.get(runId);
  if (!rec) return null;
  return {
    status: rec.status,
    events: rec.events.filter((e) => e.id > since),
  };
}

/** 列出仍在运行的 run（调试/运维）。 */
export function listActiveRuns() {
  return [..._runs.values()].filter((r) => r.status === 'running').map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    meta: r.meta,
  }));
}
