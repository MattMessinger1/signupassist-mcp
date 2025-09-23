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
  scopes: string[];
  child_id?: string;
  program_ref?: string;
  max_amount_cents?: number;
  valid_from: string;
  valid_until: string;
}

export interface VerifiedMandate extends MandatePayload {
  verified: true;
}

export interface VerificationContext {
  amount_cents?: number;
  now?: Date;
}

/**
 * Issues a signed mandate token (JWS) from the given payload
 */
export async function issueMandate(payload: MandatePayload): Promise<string> {
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
    const jwt = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer('signupassist-platform')
      .setAudience('signupassist-mcp')
      .setExpirationTime(payload.valid_until)
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
    if (!mandatePayload.scopes.includes(requiredScope)) {
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
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to verify mandate: ${error}`);
  }
}

/**
 * Utility function to hash JSON objects for audit trail
 */
export function hashJSON(obj: any): string {
  const jsonString = JSON.stringify(obj, Object.keys(obj).sort());
  return createHash('sha256').update(jsonString).digest('hex');
}