/**
 * Active Network System API Authentication
 *
 * The ActiveNet System API requires dual authentication:
 * - API Key: passed as `api_key` query parameter
 * - Dynamic Signature: HMAC-SHA256 of (api_key + timestamp) using shared secret
 *
 * The signature is a 64-character hex string passed as `sig` query parameter.
 */

import { createHmac } from 'crypto';

/**
 * Generate HMAC-SHA256 signature for ActiveNet System API
 * @param apiKey - The API key
 * @param sharedSecret - The shared secret provided by Active Network
 * @param timestamp - ISO 8601 timestamp (defaults to now)
 * @returns 64-character hex string signature
 */
export function generateSignature(
  apiKey: string,
  sharedSecret: string,
  timestamp?: string
): string {
  const ts = timestamp || new Date().toISOString();
  const message = apiKey + ts;
  return createHmac('sha256', sharedSecret)
    .update(message)
    .digest('hex');
}

/**
 * Build an authenticated URL for ActiveNet System API
 * @param baseUrl - Base URL including org ID (e.g., https://api.amp.active.com/anet-systemapi/{orgid}/api/v1)
 * @param path - API path (e.g., /flexregprograms)
 * @param params - Additional query parameters
 * @param apiKey - API key
 * @param sharedSecret - Shared secret for HMAC
 * @returns Full URL with api_key and sig parameters
 */
export function buildAuthenticatedUrl(
  baseUrl: string,
  path: string,
  params: Record<string, string | number | boolean>,
  apiKey: string,
  sharedSecret: string
): string {
  const timestamp = new Date().toISOString();
  const sig = generateSignature(apiKey, sharedSecret, timestamp);

  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('sig', sig);
  url.searchParams.set('timestamp', timestamp);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

/**
 * Determine which ActiveNet API key to use based on country/region
 */
export function getActiveNetApiKey(country: string = 'US'): { apiKey: string; secret: string } | null {
  const normalized = country.toUpperCase();

  if (normalized === 'CA') {
    const apiKey = process.env.ACTIVENET_API_KEY_CA;
    if (!apiKey) return null;
    return { apiKey, secret: process.env.ACTIVENET_SECRET_CA || '' };
  }

  // Default to US
  const apiKey = process.env.ACTIVENET_API_KEY_US;
  if (!apiKey) return null;
  return { apiKey, secret: process.env.ACTIVENET_SECRET_US || '' };
}
