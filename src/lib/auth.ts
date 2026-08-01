/** 与 server/auth.js ADMIN_EMAIL 默认保持一致；部署可用环境变量覆盖服务端。 */
export const ADMIN_EMAIL = 'q@q.qq';

/** 历史超管账号，保留兼容。 */
const LEGACY_ADMIN_EMAILS = ['siplgo@siplgo.xyz'];

export function isAdminEmail(email: string | null | undefined): boolean {
  const e = (email || '').trim().toLowerCase();
  if (!e) return false;
  if (e === ADMIN_EMAIL) return true;
  return LEGACY_ADMIN_EMAILS.includes(e);
}
