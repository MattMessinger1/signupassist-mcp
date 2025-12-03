/**
 * Mandate Signing & Verification Utility
 * Provides functions to issue and verify signed mandate tokens (JWS)
 * PACK-B: Unified signing with clear error messages and scope verification
 */

import { createSecretKey } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { createHash } from 'crypto';

// PACK-B: Environment-driven configuration
const ALG = process.env.MANDATE_SIGNING_ALG || "HS256";
const SECRET = process.env.MANDATE_SIGNING_SECRET || process.env.MANDATE_SIGNING_KEY || "";
const ISS = process.env.MANDATE_ISSUER || "signupassist-platform";
const AUD = process.env.MANDATE_AUDIENCE || "signupassist-mcp";
const DEFAULT_SCOPES = (process.env.MANDATE_DEFAULT_SCOPES || "scp:authenticate,scp:read:listings")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);
const TTL_MIN = Number(process.env.MANDATE_TTL_MINUTES || 1440);

// Types
export interface MandatePayload {
  mandate_id: string;
  user_id: string;
  provider: string;
  scope: string[];
  child_id?: string;
  program_ref?: string;
  max_amount_cents?: number;
  valid_from: string;
  valid_until: string;
  time_period: string;
  credential_type: 'jws' | 'vc';
}

export interface VerifiedMandate extends MandatePayload {
  verified: true;
}

export interface VerificationContext {
  amount_cents?: number;
  now?: Date;
}

/**
 * Get the signing key (supports both MANDATE_SIGNING_SECRET and legacy MANDATE_SIGNING_KEY)
 */
function getKey() {
  if (!SECRET) {
    throw new Error("MANDATE_SIGNING_SECRET or MANDATE_SIGNING_KEY not set");
  }
  
  // If the secret looks like base64 (legacy format), decode it
  if (SECRET.match(/^[A-Za-z0-9+/=]+$/)) {
    try {
      const keyBuffer = Buffer.from(SECRET, 'base64');
      return createSecretKey(keyBuffer);
    } catch {
      // Fall back to raw string
      return createSecretKey(Buffer.from(SECRET));
    }
  }
  
  // Use raw string as secret
  return createSecretKey(Buffer.from(SECRET));
}

/**
 * PACK-B: Create a mandate with unified signing and clear scopes
 */
export async function createMandate(
  userId: string, 
  provider: "skiclubpro", 
  extraScopes: string[] = []
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const scopes = Array.from(new Set([...DEFAULT_SCOPES, ...extraScopes]));
  
  const jws = await new SignJWT({
    mandate_id: crypto.randomUUID(),
    user_id: userId,
    provider,
    scope: scopes,
    valid_from: new Date().toISOString(),
    valid_until: new Date(Date.now() + TTL_MIN * 60_000).toISOString(),
    time_period: `${TTL_MIN}m`,
    credential_type: "jws",
    max_amount_cents: 50000
  })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setIssuer(ISS)
    .setAudience(AUD)
    .setExpirationTime(`${TTL_MIN}m`)
    .sign(getKey());
  
  return jws;
}

/**
 * PACK-B: Verify mandate with multiple required scopes and clear error messages
 */
export async function verifyMandate(
  jws: string, 
  requiredScopes: string | string[]
): Promise<VerifiedMandate> {
  // Normalize to array
  const scopesArray = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes];
  
  try {
    const { payload } = await jwtVerify(jws, getKey(), { 
      issuer: ISS, 
      audience: AUD 
    });
    
    const granted = new Set<string>((payload as any).scope || []);
    
    // Check all required scopes
    for (const s of scopesArray) {
      if (!granted.has(s)) {
        const msg = `Mandate missing required scope: ${s}`;
        const err: any = new Error(msg);
        err.code = "ERR_SCOPE_MISSING";
        throw err;
      }
    }
    
    const mandatePayload = payload as unknown as MandatePayload;
    console.log('[mandates] ✅ Verified mandate for', mandatePayload.provider, 'with scopes:', mandatePayload.scope);
    
    return {
      ...mandatePayload,
      verified: true,
    };
  } catch (e: any) {
    // PACK-B: Surface clear error messages instead of generic "Invalid Compact JWS"
    if (e.code === 'ERR_SCOPE_MISSING') {
      throw e;
    }
    
    // Add context to JWT verification errors
    const contextMsg = `[MandateVerify] ${e.message || 'Verification failed'}`;
    const err: any = new Error(contextMsg);
    err.code = e.code || 'ERR_MANDATE_INVALID';
    err.cause = e;
    throw err;
  }
}

/**
 * Legacy issueMandate for backward compatibility - wraps createMandate
 */
export async function issueMandate(
  payload: MandatePayload, 
  options: { credential_type?: 'jws' | 'vc' } = {}
): Promise<string> {
  if (options.credential_type === 'vc') {
    return JSON.stringify({ vc: 'not-implemented', ...payload });
  }
  
  // Extract extra scopes beyond defaults
  const extraScopes = payload.scope.filter(s => !DEFAULT_SCOPES.includes(s));
  return createMandate(payload.user_id, payload.provider as "skiclubpro", extraScopes);
}

// ============= Mandate Scope Configuration =============

export const MANDATE_SCOPES = {
  // Platform scopes
  AUTHENTICATE: 'scp:authenticate',
  READ_LISTINGS: 'scp:read:listings',
  REGISTER: 'scp:register',
  PAY: 'scp:pay',
  DISCOVER_FIELDS: 'scp:discover:fields',
  PLATFORM_SUCCESS_FEE: 'platform:success_fee',
  
  // Provider-specific scopes (Bookeo)
  BOOKEO_CREATE_BOOKING: 'bookeo:create_booking',
  BOOKEO_READ_PRODUCTS: 'bookeo:read_products',
  BOOKEO_READ_SLOTS: 'bookeo:read_slots',
  
  // User data scopes (ChatGPT App Store compliance)
  READ_CHILDREN: 'user:read:children',
  WRITE_CHILDREN: 'user:write:children',
  READ_BILLING: 'user:read:billing',
  READ_PROFILE: 'user:read:profile',
  WRITE_PROFILE: 'user:write:profile'
} as const;

export const SCOPE_REQUIREMENTS: Record<string, string[]> = {
  'scp.login': [MANDATE_SCOPES.AUTHENTICATE],
  'scp.find_programs': [MANDATE_SCOPES.AUTHENTICATE, MANDATE_SCOPES.READ_LISTINGS],
  'scp.discover_required_fields': [MANDATE_SCOPES.AUTHENTICATE, MANDATE_SCOPES.DISCOVER_FIELDS],
  'scp.register': [MANDATE_SCOPES.AUTHENTICATE, MANDATE_SCOPES.REGISTER],
  'scp.pay': [MANDATE_SCOPES.AUTHENTICATE, MANDATE_SCOPES.PAY],
  // Bookeo tool mapping
  'bookeo.confirm_booking': [MANDATE_SCOPES.BOOKEO_CREATE_BOOKING],
  // User data tool mapping (ChatGPT App Store compliance)
  'user.list_children': [MANDATE_SCOPES.READ_CHILDREN],
  'user.create_child': [MANDATE_SCOPES.WRITE_CHILDREN],
  'user.update_child': [MANDATE_SCOPES.WRITE_CHILDREN],
  'user.check_payment_method': [MANDATE_SCOPES.READ_BILLING],
  'user.get_delegate_profile': [MANDATE_SCOPES.READ_PROFILE],
  'user.update_delegate_profile': [MANDATE_SCOPES.WRITE_PROFILE]
};

export function getScopesForTool(toolName: string): string[] {
  return SCOPE_REQUIREMENTS[toolName] || [];
}

// ============= Mandate Auto-Renewal =============

/**
 * Create or refresh a mandate for a user
 * Reuses existing active mandates with matching scopes, or creates new ones
 */
export async function createOrRefreshMandate(
  supabase: any,
  userId: string,
  provider: string,
  orgRef: string,
  scopes: string[],
  options: {
    childId?: string;
    programRef?: string;
    maxAmountCents?: number;
    validDurationMinutes?: number;
  } = {}
): Promise<{ mandate_id: string; mandate_jws: string }> {
  // Check for existing active mandate with matching scopes
  const { data: existing } = await supabase
    .from('mandates')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('status', 'active')
    .gt('valid_until', new Date().toISOString())
    .single();
  
  // If found and scopes match, return it
  if (existing && scopes.every(s => existing.scope.includes(s))) {
    console.log('[Mandates] ✅ Reusing existing mandate:', existing.id);
    return {
      mandate_id: existing.id,
      mandate_jws: existing.jws_compact
    };
  }
  
  // Otherwise create new mandate
  console.log('[Mandates] 🔄 Creating new mandate for', provider);
  
  const validDurationMinutes = options.validDurationMinutes || 1440; // 24 hours default
  const now = new Date();
  const validFrom = now.toISOString();
  const validUntil = new Date(now.getTime() + validDurationMinutes * 60 * 1000).toISOString();
  
  const payload: MandatePayload = {
    mandate_id: crypto.randomUUID(),
    user_id: userId,
    provider,
    scope: scopes,
    valid_from: validFrom,
    valid_until: validUntil,
    time_period: `${validDurationMinutes}m`,
    credential_type: 'jws',
    child_id: options.childId,
    program_ref: options.programRef,
    max_amount_cents: options.maxAmountCents
  };
  
  const jws = await issueMandate(payload);
  
  // Store in database
  const { data: mandate, error } = await supabase
    .from('mandates')
    .insert({
      user_id: userId,
      provider,
      scope: scopes,
      jws_compact: jws,
      child_id: options.childId,
      program_ref: options.programRef,
      max_amount_cents: options.maxAmountCents,
      valid_from: validFrom,
      valid_until: validUntil,
      status: 'active',
      credential_type: 'jws'
    })
    .select()
    .single();
  
  if (error) throw new Error(`Failed to store mandate: ${error.message}`);
  
  console.log('[Mandates] ✅ New mandate created:', mandate.id);
  return {
    mandate_id: mandate.id,
    mandate_jws: jws
  };
}

/**
 * Utility function to hash JSON objects for audit trail
 */
export function hashJSON(obj: any): string {
  const jsonString = JSON.stringify(obj, Object.keys(obj).sort());
  return createHash('sha256').update(jsonString).digest('hex');
}