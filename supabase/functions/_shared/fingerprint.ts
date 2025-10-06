/**
 * Production-safe fingerprint generator using Web Crypto API.
 * 
 * Uses native `crypto.subtle.digest` for deterministic, cross-platform SHA-256 hashing.
 * Works in all Edge runtimes (Supabase, Railway, local Deno) without external dependencies.
 * 
 * @example
 * ```typescript
 * const fingerprint = await generateFormFingerprint("program_123|credential_456");
 * // Returns: "a1b2c3d4..." (64-char hex string)
 * ```
 */

/**
 * Generates a deterministic SHA-256 fingerprint from an input string.
 * 
 * @param input - The string to fingerprint (e.g., "program_ref|credential_id")
 * @returns A promise resolving to a lowercase hex string (64 characters)
 * 
 * Performance: <1ms for typical inputs (<1KB)
 * Deterministic: Identical inputs always produce identical outputs
 * Cross-platform: Uses Web Crypto API, works in all Edge runtimes
 */
export async function generateFormFingerprint(input: string): Promise<string> {
  // Encode input string to bytes
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  
  // Generate SHA-256 hash using Web Crypto API
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  
  // Convert ArrayBuffer to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
  
  return hashHex;
}

/**
 * Optional: Memoized version for performance optimization within a single invocation.
 * Caches results to avoid re-computing identical fingerprints.
 */
const fingerprintCache = new Map<string, string>();

export async function generateFormFingerprintMemoized(input: string): Promise<string> {
  const cached = fingerprintCache.get(input);
  if (cached) {
    return cached;
  }
  
  const fingerprint = await generateFormFingerprint(input);
  fingerprintCache.set(input, fingerprint);
  
  return fingerprint;
}
