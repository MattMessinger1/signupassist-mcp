/**
 * Mandate Signing & Verification Utility
 * Provides functions to issue and verify signed mandate tokens (JWS)
 */

import { SignJWT, jwtVerify, importJWK } from 'jose';
import { createHash } from 'crypto';

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
 * Issues a signed mandate token (JWS or VC) from the given payload
 */
export async function issueMandate(
  payload: MandatePayload, 
  options: { credential_type?: 'jws' | 'vc' } = {}
): Promise<string> {
  const credentialType = options.credential_type || 'jws';
  const mandatePayload = { ...payload, credential_type: credentialType };

  if (credentialType === 'vc') {
    // VC implementation placeholder
    return JSON.stringify({ vc: 'not-implemented', ...mandatePayload });
  }
  const signingKey = process.env.MANDATE_SIGNING_KEY;
  if (!signingKey) {
    throw new Error('MANDATE_SIGNING_KEY environment variable is required');
  }

  try {
    // Decode the base64 signing key
    const keyBuffer = Buffer.from(signingKey, 'base64');
    
    // Create JWK from the raw key
    const jwk = {
      kty: 'oct',
      k: keyBuffer.toString('base64url'),
    };

    const secret = await importJWK(jwk, 'HS256');

    // Create and sign JWT
    const jwt = await new SignJWT(mandatePayload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer('signupassist-platform')
      .setAudience('signupassist-mcp')
      .setExpirationTime(mandatePayload.time_period)
      .sign(secret);

    return jwt;
  } catch (error) {
    throw new Error(`Failed to issue mandate: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Verifies a mandate JWS token and checks constraints
 */
export async function verifyMandate(
  jws: string, 
  requiredScope: string, 
  context: VerificationContext = {}
): Promise<VerifiedMandate> {
  const signingKey = process.env.MANDATE_SIGNING_KEY;
  if (!signingKey) {
    throw new Error('MANDATE_SIGNING_KEY environment variable is required');
  }

  try {
    // Check if this is a VC credential (not implemented yet)
    try {
      const parsed = JSON.parse(jws);
      if (parsed.vc === 'not-implemented') {
        throw new Error('VC verification not yet implemented');
      }
    } catch (e) {
      // Not JSON, continue with JWS verification
    }

    // Decode the base64 signing key
    const keyBuffer = Buffer.from(signingKey, 'base64');
    
    // Create JWK from the raw key
    const jwk = {
      kty: 'oct',
      k: keyBuffer.toString('base64url'),
    };

    const secret = await importJWK(jwk, 'HS256');

    // Verify JWT signature and decode payload
    const { payload } = await jwtVerify(jws, secret, {
      issuer: 'signupassist-platform',
      audience: 'signupassist-mcp',
    });

    const mandatePayload = payload as unknown as MandatePayload;
    console.log('[mandates] ✅ Verified mandate for', mandatePayload.provider, 'with scopes:', mandatePayload.scope);

    // Ensure credential_type is set (for backward compatibility)
    if (!mandatePayload.credential_type) {
      mandatePayload.credential_type = 'jws';
    }

    // Check validity window
    const now = context.now || new Date();
    const validFrom = new Date(mandatePayload.valid_from);
    const validUntil = new Date(mandatePayload.valid_until);

    if (now < validFrom) {
      throw new Error('Mandate is not yet valid');
    }

    if (now > validUntil) {
      throw new Error('Mandate has expired');
    }

    // Check required scope
    if (!mandatePayload.scope.includes(requiredScope)) {
      throw new Error(`Mandate does not include required scope: ${requiredScope}`);
    }

    // Check amount constraint if provided
    if (context.amount_cents !== undefined && mandatePayload.max_amount_cents !== undefined) {
      if (context.amount_cents > mandatePayload.max_amount_cents) {
        throw new Error(`Amount ${context.amount_cents} cents exceeds mandate limit of ${mandatePayload.max_amount_cents} cents`);
      }
    }

    return {
      ...mandatePayload,
      verified: true,
    };
  } catch (error) {
    console.error('[mandates] ❌ Mandate verification failed:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to verify mandate: ${error}`);
  }
}

// ============= Mandate Scope Configuration =============

export const MANDATE_SCOPES = {
  AUTHENTICATE: 'scp:authenticate',
  READ_LISTINGS: 'scp:read:listings',
  REGISTER: 'scp:register',
  PAY: 'scp:pay',
  DISCOVER_FIELDS: 'scp:discover:fields'
} as const;

export const SCOPE_REQUIREMENTS: Record<string, string[]> = {
  'scp.login': [MANDATE_SCOPES.AUTHENTICATE],
  'scp.find_programs': [MANDATE_SCOPES.AUTHENTICATE, MANDATE_SCOPES.READ_LISTINGS],
  'scp.discover_required_fields': [MANDATE_SCOPES.AUTHENTICATE, MANDATE_SCOPES.DISCOVER_FIELDS],
  'scp.register': [MANDATE_SCOPES.AUTHENTICATE, MANDATE_SCOPES.REGISTER],
  'scp.pay': [MANDATE_SCOPES.AUTHENTICATE, MANDATE_SCOPES.PAY]
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