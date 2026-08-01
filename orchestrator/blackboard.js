/**
 * 黑板（Blackboard）—— 编排过程中各节点共享的上下文。
 *
 * 每个节点执行完后，其结构化产物（contract）+ 元信息（exitCode、status、耗时）
 * 写入 blackboard.nodes[nodeId]。任务模板与条件表达式都从黑板取值，实现
 * 节点间的结构化数据交接，而非原始文本拼接。
 */

export class Blackboard {
  /**
   * @param {string} input - 用户原始输入
   */
  constructor(input) {
    this.input = input || '';
    /** @type {Record<string, NodeResult>} */
    this.nodes = {};
  }

  /** 记录一个节点的完成结果。 */
  setNode(nodeId, result) {
    this.nodes[nodeId] = result;
  }

  /** 取某节点的产物契约（可能为 undefined）。 */
  contract(nodeId) {
    return this.nodes[nodeId]?.contract;
  }

  /** 取某节点退出码。 */
  exitCode(nodeId) {
    return this.nodes[nodeId]?.exitCode;
  }

  /** 所有已完成节点 id。 */
  completedNodeIds() {
    return Object.keys(this.nodes);
  }

  /** 序列化为可插值的扁平视图（供 renderTask / 条件求值用）。 */
  view() {
    return {
      input: this.input,
      nodes: this.nodes,
    };
  }
}

/**
 * @typedef {Object} NodeResult
 * @property {number} exitCode
 * @property {string} output
 * @property {AgentContract} contract
 * @property {'done'|'skipped'|'error'} status
 * @property {number} durationMs
 */
