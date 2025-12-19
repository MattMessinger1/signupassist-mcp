/**
 * Auth0 JWT Verification Middleware
 * 
 * Production-ready middleware for ChatGPT App Store compliance.
 * Verifies Auth0 JWTs using JWKS (JSON Web Key Set).
 */

import * as jose from 'jose';

// Auth0 configuration from environment
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN || 'dev-xha4aa58ytpvlqyl.us.auth0.com';
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE || 'https://shipworx.ai/api';

// Cache JWKS (refresh every 6 hours per Auth0 best practice)
let jwksCache: jose.JWTVerifyGetKey | null = null;
let jwksCacheTime = 0;
const JWKS_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours in ms

function getJWKS(): jose.JWTVerifyGetKey {
  const now = Date.now();
  if (!jwksCache || now - jwksCacheTime > JWKS_CACHE_TTL) {
    console.log('[AUTH0] Refreshing JWKS cache from:', `https://${AUTH0_DOMAIN}/.well-known/jwks.json`);
    jwksCache = jose.createRemoteJWKSet(
      new URL(`https://${AUTH0_DOMAIN}/.well-known/jwks.json`)
    );
    jwksCacheTime = now;
  }
  return jwksCache;
}

export interface Auth0TokenPayload {
  sub: string;           // User ID (Auth0 user_id)
  email?: string;
  email_verified?: boolean;
  iss: string;
  aud: string | string[];
  iat: number;
  exp: number;
  [key: string]: any;    // Allow additional claims
}

/**
 * Verify an Auth0 JWT access token
 * @param token - The raw JWT token (without "Bearer " prefix)
 * @returns Verified token payload with user_id in `sub` claim
 * @throws Error if token is invalid, expired, or doesn't match audience/issuer
 */
export async function verifyAuth0Token(token: string): Promise<Auth0TokenPayload> {
  const JWKS = getJWKS();
  
  try {
    const { payload } = await jose.jwtVerify(token, JWKS, {
      issuer: `https://${AUTH0_DOMAIN}/`,
      audience: AUTH0_AUDIENCE,
    });
    
    console.log('[AUTH0] JWT verified successfully, sub:', payload.sub);
    return payload as Auth0TokenPayload;
  } catch (error: any) {
    // Provide specific error messages for common JWT issues
    if (error.code === 'ERR_JWT_EXPIRED') {
      throw new Error('JWT expired');
    }
    if (error.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
      throw new Error(`JWT claim validation failed: ${error.message}`);
    }
    if (error.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
      throw new Error('JWT signature verification failed');
    }
    throw new Error(`JWT verification failed: ${error.message}`);
  }
}

/**
 * Extract Bearer token from Authorization header
 * @param authHeader - The full Authorization header value
 * @returns The token string without "Bearer " prefix, or null if not present
 */
export function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader || typeof authHeader !== 'string') return null;
  if (!authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7).trim();
}

/**
 * Get Auth0 configuration for logging/debugging
 */
export function getAuth0Config() {
  return {
    domain: AUTH0_DOMAIN,
    audience: AUTH0_AUDIENCE,
    jwksUrl: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`
  };
}
