// Trigger rebuild: 2025-11-08 - Updated to use mandate authentication
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { invokeMCPToolDirect } from '../_shared/mcpClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper: Log audit entry for cache refresh operations
async function logAuditEntry(
  supabase: any,
  orgRef: string,
  category: string,
  status: 'success' | 'failed',
  metadata: Record<string, any>
) {
  try {
    await supabase.from('mandate_audit').insert({
      user_id: '00000000-0000-0000-0000-000000000000', // System user
      action: 'cache_refresh_scrape',
      org_ref: orgRef,
      provider: 'skiclubpro',
      metadata: {
        status,
        category,
        ...metadata
      }
    });
  } catch (error) {
    console.error('[refresh-program-cache] Failed to log audit entry:', error);
  }
}

// Helper: Generate deep links for a program
function generateDeepLinks(orgRef: string, programRef: string): Record<string, string> {
  const baseUrl = `https://${orgRef}.skiclubpro.team`;
  const registrationUrl = `${baseUrl}/registration/${programRef}/start`;
  const accountUrl = `${baseUrl}/user/register`;
  const detailsUrl = `${baseUrl}/programs/${programRef}`;
  
  return {
    registration_start: `${registrationUrl}?ref=signupassist&utm_source=chatgpt_app`,
    account_creation: `${accountUrl}?ref=signupassist&prefill=guardian`,
    program_details: `${detailsUrl}?ref=signupassist`
  };
}

// Helper: Transform prerequisite_checks to prerequisites_schema format
function transformPrereqChecks(prereqChecks: any[]): Record<string, any> {
  if (!prereqChecks || prereqChecks.length === 0) return {};
  
  const prereqs: Record<string, any> = {};
  
  for (const check of prereqChecks) {
    const key = check.key || check.id || check.label?.toLowerCase().replace(/\s+/g, '_');
    if (!key) continue;
    
    prereqs[key] = {
      key: check.key,
      label: check.label,
      type: check.type || 'checkbox',
      required: check.required !== undefined ? check.required : true,
      status: check.status,
      options: check.options
    };
  }
  
  return prereqs;
}

// Helper: Transform program_questions to questions_schema format
function transformProgramQuestions(programQuestions: any[]): Record<string, any> {
  if (!programQuestions || programQuestions.length === 0) return { fields: [] };
  
  const fields = programQuestions.map((question: any) => ({
    key: question.id || question.key || question.label?.toLowerCase().replace(/\s+/g, '_'),
    label: question.label || question.id || 'Unknown field',
    type: question.type || 'text',
    required: question.required || false,
    options: question.options,
    placeholder: question.placeholder,
    description: question.description
  }));
  
  return { fields };
}

// Helper: Extract programs by theme from discovery result
function extractProgramsByTheme(discoveryResult: any, category: string): Record<string, any[]> {
  // The discovery result may contain program info in different formats
  // For now, we'll create a simple structure based on the program_ref
  const programRef = discoveryResult.program_ref || 'unknown';
  
  // Create a simple theme grouping (can be enhanced later with real theme data)
  const theme = category === 'teams' ? 'Competitive Teams' : 
                category === 'lessons' ? 'Lessons & Clinics' : 
                'All Programs';
  
  return {
    [theme]: [{
      program_ref: programRef,
      title: discoveryResult.title || programRef,
      description: discoveryResult.description || '',
      category: category
    }]
  };
}

interface OrgConfig {
  orgRef: string;
  categories: string[];
  priority: 'high' | 'normal' | 'low';
}

// Organizations to scrape (ordered by priority)
const ORGS_TO_SCRAPE: OrgConfig[] = [
  { orgRef: 'blackhawk-ski-club', categories: ['all', 'lessons', 'teams'], priority: 'high' },
  // Add more organizations as needed
];

interface ScrapeResult {
  orgRef: string;
  category: string;
  success: boolean;
  programCount: number;
  themes: string[];
  error?: string;
  durationMs: number;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('[refresh-program-cache-v2] Starting cache refresh with mandate auth...');
  
  // Initialize Supabase client with service role key
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // STEP 1: Get and validate system mandate
  const systemMandateJws = Deno.env.get('SYSTEM_MANDATE_JWS');
  if (!systemMandateJws) {
    return new Response(JSON.stringify({ error: 'SYSTEM_MANDATE_JWS not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  console.log('[refresh-program-cache-v2] ✅ System mandate loaded');

  // STEP 2: Extract user_id from mandate JWT
  const payload = JSON.parse(atob(systemMandateJws.split('.')[1]));
  const userId = payload.user_id;
  console.log('[refresh-program-cache-v2] Mandate user:', userId);
  
  // STEP 3: Look up credential_id for this user
  const { data: cred, error: credError } = await supabase
    .from('stored_credentials')
    .select('id')
    .eq('user_id', userId)
    .eq('provider', 'skiclubpro')
    .single();
  
  if (credError || !cred) {
    return new Response(JSON.stringify({ error: `No credentials for user ${userId}` }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  const credentialId = cred.id;
  console.log('[refresh-program-cache-v2] ✅ Found credential:', credentialId);

  const results: ScrapeResult[] = [];
  let totalSuccesses = 0;
  let totalFailures = 0;

  // STEP 4: Scrape each organization/category
  for (const org of ORGS_TO_SCRAPE) {
    for (const category of org.categories) {
      const startTime = Date.now();
      console.log(`[refresh-program-cache-v2] Scraping ${org.orgRef}:${category}...`);

      try {
        // Call the PROVEN discovery tool that handles:
        // - Browserbase launch with antibot stealth
        // - Login with mandate authentication
        // - Session reuse after first successful login
        // - Field discovery
        // Uses invokeMCPToolDirect for server-to-server auth with MCP_ACCESS_TOKEN
        // Pass system mandate for authentication (no raw credentials)
        const result = await invokeMCPToolDirect(
          'scp.discover_required_fields', 
          {
            org_ref: org.orgRef,
            category: category,
            mode: 'full', // Get both prerequisites AND program questions
            stage: 'program',
            credential_id: credentialId  // Pass credential_id explicitly
          },
          systemMandateJws  // Mandate handles authentication
        );

        console.log(`[refresh-program-cache] Discovery result for ${org.orgRef}:${category}:`, JSON.stringify(result, null, 2));

        // Check for errors
        if (!result.success || result.error) {
          throw new Error(`Discovery failed: ${result.error || 'Unknown error'}`);
        }

        // Extract data from the discovery result
        const prerequisiteChecks = result.prerequisite_checks || [];
        const programQuestions = result.program_questions || [];
        
        // Transform to schema formats
        const prerequisitesSchema = transformPrereqChecks(prerequisiteChecks);
        const questionsSchema = transformProgramQuestions(programQuestions);
        
        // Extract programs (for now, single program discovery)
        // TODO: Enhance to discover multiple programs per category
        const programsByTheme = extractProgramsByTheme(result, category);
        const themes = Object.keys(programsByTheme);
        const programCount = Object.values(programsByTheme).flat().length;

        // Generate deep links
        const deepLinksSchema: Record<string, any> = {};
        for (const [theme, programs] of Object.entries(programsByTheme)) {
          for (const program of programs as any[]) {
            const programRef = program.program_ref;
            if (programRef) {
              deepLinksSchema[programRef] = generateDeepLinks(org.orgRef, programRef);
            }
          }
        }

        console.log(`[refresh-program-cache] Discovered ${programCount} programs in ${themes.length} themes`);

        // Store in database cache via enhanced RPC
        const { data: cacheId, error: cacheError } = await supabase.rpc('upsert_cached_programs_enhanced', {
          p_org_ref: org.orgRef,
          p_category: category,
          p_programs_by_theme: programsByTheme,
          p_prerequisites_schema: prerequisitesSchema,
          p_questions_schema: questionsSchema,
          p_deep_links: deepLinksSchema,
          p_metadata: {
            scrape_type: 'mandate_authenticated_discovery',
            auth_method: 'system_mandate_jws',
            source: 'nightly_cache_refresh',
            program_count: programCount,
            prereq_count: prerequisiteChecks.length,
            question_count: programQuestions.length,
            themes: themes,
            scraped_at: new Date().toISOString(),
            priority: org.priority
          },
          p_ttl_hours: 24 // 24-hour cache TTL
        });

        if (cacheError) {
          throw new Error(`Cache upsert failed: ${cacheError.message}`);
        }

        const durationMs = Date.now() - startTime;
        
        results.push({
          orgRef: org.orgRef,
          category,
          success: true,
          programCount,
          themes,
          durationMs
        });

        totalSuccesses++;
        
        console.log(`[refresh-program-cache] ✅ Cached ${org.orgRef}:${category} (${programCount} programs, ${durationMs}ms, cache_id: ${cacheId})`);

        // Log successful scrape to audit table
        await logAuditEntry(supabase, org.orgRef, category, 'success', {
          program_count: programCount,
          themes,
          duration_ms: durationMs,
          cache_id: cacheId,
          prereq_count: prerequisiteChecks.length,
          question_count: programQuestions.length,
          scraped_at: new Date().toISOString()
        });

        // Small delay between scrapes to avoid overwhelming the provider
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error: any) {
        const durationMs = Date.now() - startTime;
        
        results.push({
          orgRef: org.orgRef,
          category,
          success: false,
          programCount: 0,
          themes: [],
          error: error.message,
          durationMs
        });

        totalFailures++;
        
        console.error(`[refresh-program-cache] ❌ Failed ${org.orgRef}:${category}: ${error.message}`);

        // Log failed scrape to audit table
        await logAuditEntry(supabase, org.orgRef, category, 'failed', {
          error: error.message,
          duration_ms: durationMs,
          scraped_at: new Date().toISOString()
        });
      }
    }
  }

  // Calculate summary statistics
  const totalDurationMs = results.reduce((sum, r) => sum + r.durationMs, 0);
  const totalPrograms = results.reduce((sum, r) => sum + r.programCount, 0);
  const avgDurationMs = totalDurationMs / results.length;

  const summary = {
    timestamp: new Date().toISOString(),
    totalOrgs: ORGS_TO_SCRAPE.length,
    totalScrapesAttempted: results.length,
    totalSuccesses,
    totalFailures,
    totalPrograms,
    totalDurationMs,
    avgDurationMs: Math.round(avgDurationMs),
    results,
    flow: 'Mandate-authenticated discovery (Browserbase + antibot + session reuse)',
    auth_method: 'system_mandate_jws'
  };

  console.log(`[refresh-program-cache] 🏁 Complete: ${totalSuccesses}/${results.length} successful, ${totalPrograms} programs cached`);

  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
});
