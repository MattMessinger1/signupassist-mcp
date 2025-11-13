/**
 * Phase 3: Cache-First Wrapper for MCP Tools
 * Intercepts tool calls and returns cached data when available
 */

import { getCachedPrograms, getCachedFieldSchema, transformCachedProgramsToResponse } from './cacheHelpers.js';

/**
 * Wraps scp.find_programs with cache-first logic
 * Falls back to live scraping if cache is missing or skipCache=true
 */
export async function findProgramsCacheFirst(
  args: any,
  originalHandler: (args: any) => Promise<any>
): Promise<any> {
  
  const orgRef = args.org_ref || 'blackhawk-ski-club';
  const category = args.category || 'all';
  const provider = 'skiclubpro';
  const skipCache = args.skipCache === true;
  
  console.log(`[CacheFirst][find_programs] orgRef=${orgRef}, category=${category}, skipCache=${skipCache}`);
  
  // If skipCache flag is set, always use live scraping
  if (skipCache) {
    console.log('[CacheFirst][find_programs] ⚡ skipCache=true, using live scraping');
    return await originalHandler(args);
  }
  
  // Check if this is a credential-based call (requires live scraping for personalized results)
  if (args.credential_id || args.session_token) {
    console.log('[CacheFirst][find_programs] 🔐 Credential-based call, using live scraping for personalized results');
    return await originalHandler(args);
  }
  
  // Try to get cached programs
  const cacheResult = await getCachedPrograms(orgRef, category, provider);
  
  if (cacheResult.fromCache && cacheResult.programs.length > 0) {
    console.log(`[CacheFirst][find_programs] ✅ Cache HIT! Returning ${cacheResult.programs.length} cached programs`);
    return transformCachedProgramsToResponse(cacheResult.programs, cacheResult.cacheAge);
  }
  
  // Cache miss - fall back to live scraping
  console.log('[CacheFirst][find_programs] ❌ Cache MISS, falling back to live scraping');
  return await originalHandler(args);
}

/**
 * Wraps scp.discover_required_fields with cache-first logic for field schemas
 * Falls back to live discovery if cache is missing or skipCache=true
 */
export async function discoverFieldsCacheFirst(
  args: any,
  originalHandler: (args: any) => Promise<any>
): Promise<any> {
  
  const orgRef = args.org_ref || 'blackhawk-ski-club';
  const programRef = args.program_ref;
  const provider = 'skiclubpro';
  const skipCache = args.skipCache === true;
  
  console.log(`[CacheFirst][discover_fields] orgRef=${orgRef}, programRef=${programRef}, skipCache=${skipCache}`);
  
  // If skipCache flag is set, always use live discovery
  if (skipCache) {
    console.log('[CacheFirst][discover_fields] ⚡ skipCache=true, using live discovery');
    return await originalHandler(args);
  }
  
  // Mode check: if mode is 'full', we want live discovery for accuracy
  if (args.mode === 'full') {
    console.log('[CacheFirst][discover_fields] 🔍 mode=full, using live discovery for maximum accuracy');
    return await originalHandler(args);
  }
  
  // Try to get cached field schema
  const cacheResult = await getCachedFieldSchema(orgRef, programRef, provider);
  
  if (cacheResult.found) {
    console.log(`[CacheFirst][discover_fields] ✅ Cache HIT! Returning cached field schema (age: ${cacheResult.cacheAge}h)`);
    
    // Transform cached data to match tool response format
    const prerequisites = cacheResult.prerequisites ? Object.values(cacheResult.prerequisites) : [];
    const questions = cacheResult.questions?.fields || [];
    
    return {
      success: true,
      program_ref: programRef,
      prerequisites,
      prerequisite_status: prerequisites.length > 0 ? 'required' : 'complete',
      program_questions: questions,
      metadata: {
        source: 'cache',
        cache_age_hours: cacheResult.cacheAge,
        field_count: questions.length + prerequisites.length,
        discovered_at: new Date().toISOString()
      }
    };
  }
  
  // Cache miss - fall back to live discovery
  console.log('[CacheFirst][discover_fields] ❌ Cache MISS, falling back to live discovery');
  return await originalHandler(args);
}

/**
 * Configuration for cache behavior
 */
export interface CacheConfig {
  maxAgeHours: number;
  enableForChatGPT: boolean;
  enableForManualCalls: boolean;
}

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  maxAgeHours: 48,           // Cache valid for 48 hours
  enableForChatGPT: true,     // Enable cache for ChatGPT (non-authenticated) calls
  enableForManualCalls: false // Disable cache for manual/authenticated calls
};

export function getCacheConfig(): CacheConfig {
  // Could be extended to read from environment variables
  return DEFAULT_CACHE_CONFIG;
}
