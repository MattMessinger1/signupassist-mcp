import crypto from 'crypto';

type RateBucket = { resetAt: number; count: number };

const rateBuckets: Map<string, RateBucket> = new Map();

function normalizeIp(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  // Common Node format: ::ffff:1.2.3.4
  if (s.startsWith('::ffff:')) return s.slice('::ffff:'.length);
  return s;
}

function getClientIp(req: any): string {
  const xff = String(req?.headers?.['x-forwarded-for'] || '');
  const first = xff.split(',')[0]?.trim();
  const real = String(req?.headers?.['x-real-ip'] || '').trim();
  const remote = req?.socket?.remoteAddress ? String(req.socket.remoteAddress) : '';
  return normalizeIp(first || real || remote) || 'unknown';
}

function pruneRateBuckets(nowMs: number): void {
  // Opportunistic cleanup to avoid unbounded growth (Auth0 JWTs are high-cardinality).
  if (rateBuckets.size < 5000) return;
  for (const [k, v] of rateBuckets) {
    if (nowMs >= v.resetAt) rateBuckets.delete(k);
  }
  if (rateBuckets.size > 20000) rateBuckets.clear();
}

export function getStableRateLimitKey(req: any): string {
  const authHeader = String(req?.headers?.authorization || '').trim();
  const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';

  if (token) {
    // Never store raw tokens; hash to reduce sensitivity and cardinality.
    const h = crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
    return `tok_${h}`;
  }

  return `ip_${getClientIp(req)}`;
}

export function consumeRateLimit(key: string, max: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  pruneRateBuckets(now);

  const bucketKey = `${key}`;
  let b = rateBuckets.get(bucketKey);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(bucketKey, b);
  }

  b.count += 1;
  const allowed = b.count <= max;
  const retryAfterSec = allowed ? 0 : Math.max(1, Math.ceil((b.resetAt - now) / 1000));
  return { allowed, retryAfterSec };
}
