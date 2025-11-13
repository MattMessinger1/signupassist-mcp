/**
 * Phase 3: Cache-First Helpers for MCP Server
 * Reads from cached_programs table populated by refresh-program-cache edge function
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export interface CachedProgram {
  id: string;
  org_ref: string;
  provider: string;
  category: string;
  program_ref: string;
  title: string;
  description: string;
  price: string;
  schedule: string;
  age_range: string;
  skill_level: string;
  status: string;
  theme: string;
  deep_links: any[];
  prerequisites_schema: any;
  questions_schema: any;
  metadata: any;
  cached_at: string;
  expires_at: string;
}

/**
 * Check if cached programs exist and are fresh
 * @param maxAgeHours - Maximum age in hours before cache is considered stale (default: 48h)
 */
export async function getCachedPrograms(
  orgRef: string,
  category: string = 'all',
  provider: string = 'skiclubpro',
  maxAgeHours: number = 48
): Promise<{ programs: CachedProgram[]; fromCache: boolean; cacheAge?: number }> {
  
  console.log(`[CacheHelper] Checking cache for ${orgRef}:${category} (${provider})`);
  
  try {
    // Calculate cache age limit
    const cacheAgeLimit = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();
    
    // Query cached programs
    const { data, error } = await supabase
      .from('cached_programs')
      .select('*')
      .eq('org_ref', orgRef)
      .eq('category', category)
      .eq('provider', provider)
      .gt('expires_at', new Date().toISOString())  // Not expired
      .gt('cached_at', cacheAgeLimit)              // Not too old
      .order('cached_at', { ascending: false });
    
    if (error) {
      console.error('[CacheHelper] Cache query error:', error);
      return { programs: [], fromCache: false };
    }
    
    if (!data || data.length === 0) {
      console.log('[CacheHelper] ❌ No cache found or cache is stale');
      return { programs: [], fromCache: false };
    }
    
    const cacheAge = Math.round((Date.now() - new Date(data[0].cached_at).getTime()) / (60 * 60 * 1000));
    console.log(`[CacheHelper] ✅ Found ${data.length} cached programs (age: ${cacheAge}h)`);
    
    return {
      programs: data as CachedProgram[],
      fromCache: true,
      cacheAge
    };
    
  } catch (error) {
    console.error('[CacheHelper] Unexpected error:', error);
    return { programs: [], fromCache: false };
  }
}

/**
 * Get cached field schema for a specific program
 */
export async function getCachedFieldSchema(
  orgRef: string,
  programRef: string,
  provider: string = 'skiclubpro',
  maxAgeHours: number = 48
): Promise<{
  found: boolean;
  prerequisites?: any;
  questions?: any;
  cacheAge?: number;
}> {
  
  console.log(`[CacheHelper] Checking field schema cache for ${orgRef}/${programRef}`);
  
  try {
    const cacheAgeLimit = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();
    
    const { data, error } = await supabase
      .from('cached_programs')
      .select('prerequisites_schema, questions_schema, cached_at')
      .eq('org_ref', orgRef)
      .eq('program_ref', programRef)
      .eq('provider', provider)
      .gt('expires_at', new Date().toISOString())
      .gt('cached_at', cacheAgeLimit)
      .single();
    
    if (error || !data) {
      console.log('[CacheHelper] ❌ No field schema cache found');
      return { found: false };
    }
    
    const cacheAge = Math.round((Date.now() - new Date(data.cached_at).getTime()) / (60 * 60 * 1000));
    console.log(`[CacheHelper] ✅ Found cached field schema (age: ${cacheAge}h)`);
    
    return {
      found: true,
      prerequisites: data.prerequisites_schema,
      questions: data.questions_schema,
      cacheAge
    };
    
  } catch (error) {
    console.error('[CacheHelper] Unexpected error:', error);
    return { found: false };
  }
}

/**
 * Transform cached programs into MCP tool response format
 */
export function transformCachedProgramsToResponse(
  programs: CachedProgram[],
  cacheAge?: number
): any {
  // Group by theme
  const programsByTheme: Record<string, any[]> = {};
  
  for (const program of programs) {
    const theme = program.theme || 'All Programs';
    
    if (!programsByTheme[theme]) {
      programsByTheme[theme] = [];
    }
    
    programsByTheme[theme].push({
      program_ref: program.program_ref,
      title: program.title,
      description: program.description,
      price: program.price,
      schedule: program.schedule,
      age_range: program.age_range,
      skill_level: program.skill_level,
      status: program.status,
      deep_links: program.deep_links,
      theme: program.theme,
      metadata: program.metadata
    });
  }
  
  // Flatten to array format as well
  const programsArray = Object.values(programsByTheme).flat();
  
  return {
    success: true,
    programs: programsArray,
    programs_by_theme: programsByTheme,
    metadata: {
      source: 'cache',
      cache_age_hours: cacheAge,
      program_count: programs.length,
      themes: Object.keys(programsByTheme),
      cached_at: programs[0]?.cached_at
    },
    timestamp: new Date().toISOString()
  };
}
