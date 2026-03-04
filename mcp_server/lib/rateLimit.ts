import crypto from 'crypto';

export type RateBucket = { resetAt: number; count: number };

const rateBuckets: Map<string, RateBucket> = new Map();

function normalizeIp(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.startsWith('::ffff:')) return s.slice('::ffff:'.length);
  return s;
}

export function getClientIp(req: any): string {
  const xff = String(req?.headers?.['x-forwarded-for'] || '');
  const first = xff.split(',')[0]?.trim();
  const real = String(req?.headers?.['x-real-ip'] || '').trim();
  const remote = req?.socket?.remoteAddress ? String(req.socket.remoteAddress) : '';
  return normalizeIp(first || real || remote) || 'unknown';
}

function decodeJwtPayload(token: string): Record<string, any> | null {
  const parts = String(token || '').split('.');
  if (parts.length < 2) return null;
  const payload = parts[1];
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLen);
  const json = Buffer.from(padded, 'base64').toString('utf8');
  const parsed = JSON.parse(json);
  return parsed && typeof parsed === 'object' ? parsed : null;
}

function hashKey(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export function getStableRateLimitKey(req: any): string {
  const headerUserId = String(
    req?.headers?.['x-user-id'] || req?.headers?.['x-userid'] || req?.headers?.['x-auth-request-user'] || ''
  ).trim();
  if (headerUserId) return `uid_${hashKey(headerUserId)}`;

  const authHeader = String(req?.headers?.['authorization'] || '').trim();
  const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  if (token) {
    const claims = decodeJwtPayload(token);
    const stableUserId = String(claims?.user_id || claims?.sub || '').trim();
    if (stableUserId) return `uid_${hashKey(stableUserId)}`;
    return `tok_${hashKey(token)}`;
  }

  return `ip_${hashKey(getClientIp(req))}`;
}

function pruneRateBuckets(nowMs: number) {
  if (rateBuckets.size < 5000) return;
  for (const [k, v] of rateBuckets) {
    if (nowMs >= v.resetAt) rateBuckets.delete(k);
  }
  if (rateBuckets.size > 20000) rateBuckets.clear();
}

export function consumeRateLimit(key: string, max: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  pruneRateBuckets(now);

  let b = rateBuckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(key, b);
  }

  b.count += 1;
  const allowed = b.count <= max;
  const retryAfterSec = allowed ? 0 : Math.max(1, Math.ceil((b.resetAt - now) / 1000));
  return { allowed, retryAfterSec };
}

export function resetRateLimitBuckets(): void {
  rateBuckets.clear();
}
