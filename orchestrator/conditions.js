/**
 * 条件求值器 —— 安全的受限表达式（不使用 eval）。
 *
 * 支持的语法（针对 blackboard.view() 求值）：
 *   <path> contains "<string>"        子串包含
 *   <path> contains <string>          同上（无引号）
 *   <path> == <number>                数值相等
 *   <path> != <number>                数值不等
 *   <path> exists                     路径有值
 *
 * <path> 是点号分隔的黑板路径，例如：
 *   input                              用户原始输入
 *   nodes.step1.exitCode               节点 step1 的退出码
 *   nodes.step1.contract.summary       节点 step1 的产物摘要
 *   nodes.step1.contract.files         节点 step1 的产物文件清单（数组）
 *
 * 空条件视为恒真（总是执行）。语法不合法或求值出错时返回 true（保守：宁可执行）。
 */

/**
 * @param {string} expr
 * @param {{input:string, nodes:Record<string,any>}} view - blackboard.view()
 * @returns {boolean}
 */
export function evaluateCondition(expr, view) {
  const e = String(expr || '').trim();
  if (!e) return true;

  // contains "<string>"
  let m = e.match(/^(.+?)\s+contains\s+"(.+)"$/);
  if (m) return strContains(resolvePath(m[1].trim(), view), m[2]);

  // contains <bareword>
  m = e.match(/^(.+?)\s+contains\s+(\S+)$/);
  if (m) return strContains(resolvePath(m[1].trim(), view), m[2]);

  // exists
  m = e.match(/^(.+?)\s+exists$/);
  if (m) return resolvePath(m[1].trim(), view) !== undefined;

  // == number
  m = e.match(/^(.+?)\s*==\s*(-?\d+)$/);
  if (m) return Number(resolvePath(m[1].trim(), view)) === Number(m[2]);

  // != number
  m = e.match(/^(.+?)\s*!=\s*(-?\d+)$/);
  if (m) return Number(resolvePath(m[1].trim(), view)) !== Number(m[2]);

  // 不识别的表达式：保守返回 true（执行）
  return true;
}

/** 按点号路径取值；路径不存在返回 undefined。 */
function resolvePath(pathStr, view) {
  const parts = pathStr.split('.').map((s) => s.trim()).filter(Boolean);
  let cur = view;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/** contains：支持数组（成员包含）与字符串（子串包含）。 */
function strContains(value, needle) {
  if (Array.isArray(value)) {
    return value.some((v) => String(v).includes(needle));
  }
  if (value == null) return false;
  return String(value).includes(needle);
}
