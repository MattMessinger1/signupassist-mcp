import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OrgConfig {
  orgRef: string;
  categories: string[];
  priority: 'high' | 'normal' | 'low';
}

// Organizations to scrape (ordered by priority)
const ORGS_TO_SCRAPE: OrgConfig[] = [
  { orgRef: 'blackhawk-ski', categories: ['all', 'lessons', 'teams'], priority: 'high' },
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

  console.log('[refresh-program-cache] Starting nightly cache refresh...');
  
  // Initialize Supabase client with service role for RPC access
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Get MCP server URL and mandate
  const mcpServerUrl = Deno.env.get('MCP_SERVER_URL');
  const devMandateJws = Deno.env.get('DEV_MANDATE_JWS');

  if (!mcpServerUrl) {
    const error = 'MCP_SERVER_URL not configured';
    console.error(`[refresh-program-cache] ${error}`);
    return new Response(JSON.stringify({ error }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const results: ScrapeResult[] = [];
  let totalSuccesses = 0;
  let totalFailures = 0;

  // Scrape each organization and category
  for (const org of ORGS_TO_SCRAPE) {
    for (const category of org.categories) {
      const startTime = Date.now();
      console.log(`[refresh-program-cache] Scraping ${org.orgRef}:${category}...`);

      try {
        // Call MCP server to find programs
        const mcpResponse = await fetch(`${mcpServerUrl}/tools/call`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tool: 'scp.find_programs',
            args: {
              org_ref: org.orgRef,
              category: category,
              mandate_jws: devMandateJws,
              cache_mode: 'bypass', // Force fresh scrape for cache population
            }
          })
        });

        if (!mcpResponse.ok) {
          throw new Error(`MCP server returned ${mcpResponse.status}: ${mcpResponse.statusText}`);
        }

        const mcpData = await mcpResponse.json();
        
        if (!mcpData.success || !mcpData.programs_by_theme) {
          throw new Error(mcpData.error || 'No programs returned from MCP');
        }

        const programsByTheme = mcpData.programs_by_theme;
        const themes = Object.keys(programsByTheme);
        const programCount = Object.values(programsByTheme).flat().length;

        console.log(`[refresh-program-cache] Scraped ${programCount} programs in ${themes.length} themes`);

        // Store in database cache via RPC
        const { data: cacheId, error: cacheError } = await supabase.rpc('upsert_cached_programs', {
          p_org_ref: org.orgRef,
          p_category: category,
          p_programs_by_theme: programsByTheme,
          p_metadata: {
            scrape_type: 'nightly_scraper',
            program_count: programCount,
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
        
        console.log(`[refresh-program-cache] ✅ Cached ${org.orgRef}:${category} (${programCount} programs, ${durationMs}ms)`);

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
    results
  };

  console.log(`[refresh-program-cache] 🏁 Complete: ${totalSuccesses}/${results.length} successful, ${totalPrograms} programs cached`);

  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
});
