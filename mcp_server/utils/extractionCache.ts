/**
 * Extraction Cache Utility
 * 
 * In-memory cache for program extraction results with TTL expiration.
 * Reduces redundant LLM calls for repeated queries on the same page content.
 */

import { createHash } from "crypto";
import type { ProgramData } from "../lib/threePassExtractor.programs.js";

interface CacheEntry {
  data: ProgramData[];
  expiresAt: number;
}

// In-memory cache with expiration tracking
const cache = new Map<string, CacheEntry>();

/**
 * Generate SHA-1 hash of text content
 * @param text - Content to hash
 * @returns Hex-encoded hash
 */
export function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

/**
 * Retrieve cached extraction results
 * @param key - Cache key (format: org_ref:category:pageHash)
 * @returns Cached programs or null if miss/expired
 */
export async function getCached(key: string): Promise<ProgramData[] | null> {
  const entry = cache.get(key);
  
  if (!entry) {
    return null; // Cache miss
  }
  
  // Check if expired
  if (Date.now() >= entry.expiresAt) {
    cache.delete(key);
    console.log(`[ExtractionCache] Expired: ${key}`);
    return null;
  }
  
  console.log(`[ExtractionCache] Hit: ${key} (${entry.data.length} programs)`);
  return entry.data;
}

/**
 * Store extraction results in cache
 * @param key - Cache key (format: org_ref:category:pageHash)
 * @param items - Extracted programs to cache
 * @param ttlSec - Time-to-live in seconds
 */
export async function setCached(
  key: string,
  items: ProgramData[],
  ttlSec: number
): Promise<void> {
  const expiresAt = Date.now() + ttlSec * 1000;
  cache.set(key, { data: items, expiresAt });
  console.log(`[ExtractionCache] Set: ${key} (${items.length} programs, TTL: ${ttlSec}s)`);
}

/**
 * Clear all expired entries from cache
 * (Optional: Call periodically for cleanup)
 */
export function cleanupExpired(): void {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [key, entry] of cache.entries()) {
    if (now >= entry.expiresAt) {
      cache.delete(key);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`[ExtractionCache] Cleaned ${cleaned} expired entries`);
  }
}

/**
 * Clear entire cache (for testing/debugging)
 */
export function clearCache(): void {
  const size = cache.size;
  cache.clear();
  console.log(`[ExtractionCache] Cleared ${size} entries`);
}
