import { createClient } from 'jsr:@supabase/supabase-js@2';
import { invokeMCPTool } from '../_shared/mcpClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

  console.log('[refresh-program-cache] Starting cache refresh using PROVEN login flow...');
  
  // Initialize Supabase client with service role for RPC access
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const results: ScrapeResult[] = [];
  let totalSuccesses = 0;
  let totalFailures = 0;

  // Get system user credentials for skiclubpro provider
  console.log('[refresh-program-cache] Looking up system user credentials...');
  
  const SYSTEM_EMAIL = 'system@signupassist.internal';
  const { data: users } = await supabase.auth.admin.listUsers();
  const systemUser = users?.users.find((u: any) => u.email === SYSTEM_EMAIL);
  
  if (!systemUser) {
    const error = 'System user not found. Run setup-system-user edge function first.';
    console.error(`[refresh-program-cache] ${error}`);
    return new Response(JSON.stringify({ error }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  console.log(`[refresh-program-cache] Found system user: ${systemUser.id}`);
  
  const { data: credentials, error: credError } = await supabase
    .from('stored_credentials')
    .select('id')
    .eq('provider', 'skiclubpro')
    .eq('user_id', systemUser.id)
    .limit(1);

  if (credError || !credentials || credentials.length === 0) {
    const error = 'No stored credentials found for skiclubpro provider';
    console.error(`[refresh-program-cache] ${error}`);
    return new Response(JSON.stringify({ error }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const credentialId = credentials[0].id;
  console.log(`[refresh-program-cache] Found credential_id: ${credentialId}`);

  // Scrape each organization and category using the PROVEN discovery flow
  for (const org of ORGS_TO_SCRAPE) {
    for (const category of org.categories) {
      const startTime = Date.now();
      console.log(`[refresh-program-cache] Discovering ${org.orgRef}:${category} using PROVEN flow...`);

      try {
        // Call the PROVEN discovery tool that handles:
        // - Browserbase launch
        // - Antibot stealth context
        // - Login with credentials
        // - Session reuse
        // - Field discovery
        const result = await invokeMCPTool('scp.discover_required_fields', {
          org_ref: org.orgRef,
          category: category,
          credential_id: credentialId,
          mode: 'full', // Get both prerequisites AND program questions
          stage: 'program'
        }, {
          skipAudit: true // Skip audit logging for cache refresh
        });

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
            scrape_type: 'proven_discovery_flow',
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
    flow: 'PROVEN discovery flow (Browserbase + antibot + session reuse)'
  };

  console.log(`[refresh-program-cache] 🏁 Complete: ${totalSuccesses}/${results.length} successful, ${totalPrograms} programs cached`);

  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
});
