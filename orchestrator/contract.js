/**
 * 产出契约：把 CLI 的原始输出解析为结构化产物。
 *
 * 约定智能体可在输出末尾用 fenced code block 声明结构化产物（可选）：
 *
 *   ```agent-output
 *   { "summary": "已完成登录页", "files": ["src/Login.tsx"], "notes": "用了 JWT" }
 *   ```
 *
 * 找不到契约块则降级：全文截断当 summary，files 为空。
 * 这样旧智能体无需改动即可参与编排，新智能体可主动声明结构化产物。
 */

/** @typedef {{summary:string, files:string[], notes:string, raw:string}} AgentContract */

/**
 * 从 CLI 原始输出抽取结构化产物。
 * @param {string} raw
 * @returns {AgentContract}
 */
export function parseAgentOutput(raw) {
  const text = typeof raw === 'string' ? raw : '';
  const m = text.match(/```agent-output\s*\n([\s\S]*?)\n```/);
  if (m) {
    try {
      const parsed = JSON.parse(m[1]);
      return {
        summary: String(parsed.summary || '').slice(0, 2000),
        files: Array.isArray(parsed.files)
          ? parsed.files.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 100)
          : [],
        notes: String(parsed.notes || '').slice(0, 2000),
        raw: text,
      };
    } catch {
      /* 契约块解析失败，降级 */
    }
  }
  // 降级：无有效契约块，用全文当 summary，并尝试从输出中提取文件路径
  const extracted = extractFilePaths(text);
  return {
    summary: text.length > 2000 ? text.slice(0, 2000) + '…' : text,
    files: extracted,
    notes: '',
    raw: text,
  };
}

/** 从输出文本中提取可能的文件路径（降级用）。 */
function extractFilePaths(text) {
  const re = /(?:^|[\s`'"])([\w.-]+(?:\/[\w.-]+)+\.(?:tsx?|jsx?|css|html|json|md|py|go|rs|vue|svelte))\b/gim;
  const found = new Set();
  let m;
  while ((m = re.exec(text)) !== null) {
    found.add(m[1].replace(/\\/g, '/'));
    if (found.size >= 50) break;
  }
  return [...found];
}

/**
 * 从 raw 中剥离 agent-output 契约块，得到"展示用"的纯净输出。
 * @param {string} raw
 * @returns {string}
 */
export function stripContractBlock(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/```agent-output\s*\n[\s\S]*?\n```/g, '').trim();
}
