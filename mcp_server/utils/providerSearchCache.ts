/**
 * In-memory LRU cache for Google Places API responses
 * Dramatically reduces API calls and improves response time for repeated searches
 */

import { Provider } from "./providerSearch.js";

interface CacheEntry {
  providers: Provider[];
  timestamp: number;
}

class ProviderSearchCache {
  private cache = new Map<string, CacheEntry>();
  private TTL_MS = 60 * 60 * 1000; // 1 hour TTL
  private MAX_SIZE = 100; // Maximum cache entries

  /**
   * Get cached providers for a query
   * Returns null if not found or expired
   */
  get(query: string): Provider[] | null {
    const entry = this.cache.get(query.toLowerCase());
    if (!entry) return null;
    
    const age = Date.now() - entry.timestamp;
    if (age > this.TTL_MS) {
      this.cache.delete(query.toLowerCase());
      return null;
    }
    
    return entry.providers;
  }

  /**
   * Store providers in cache with LRU eviction
   * If cache is full, removes oldest entry
   */
  set(query: string, providers: Provider[]): void {
    // LRU eviction if cache is full
    if (this.cache.size >= this.MAX_SIZE) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(query.toLowerCase(), {
      providers,
      timestamp: Date.now()
    });
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.MAX_SIZE,
      ttlMs: this.TTL_MS
    };
  }
}

export const providerCache = new ProviderSearchCache();
