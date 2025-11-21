/**
 * Refresh Provider Details Edge Function
 * 
 * Scheduled edge function (via pg_cron) to nightly pre-hydrate all uncached program details.
 * Calls the MCP server's /hydrate-program-details endpoint after cleaning up Browserbase sessions.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[refresh-provider-details] Starting scheduled detail hydration...');
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const mcpServerUrl = Deno.env.get('MCP_SERVER_URL')!;
    const mcpAccessToken = Deno.env.get('MCP_ACCESS_TOKEN')!;

    if (!supabaseUrl || !supabaseServiceKey || !mcpServerUrl || !mcpAccessToken) {
      throw new Error('Missing required environment variables');
    }

    // Step 1: Clean up Browserbase sessions to avoid limits
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    console.log('[refresh-provider-details] Cleaning up Browserbase sessions...');
    
    const { data: cleanupData, error: cleanupError } = await supabase.functions.invoke(
      'cleanup-browserbase-sessions'
    );
    
    if (cleanupError) {
      console.error('[refresh-provider-details] ⚠️ Session cleanup failed:', cleanupError);
    } else {
      console.log(`[refresh-provider-details] ✅ Cleanup complete: ${cleanupData?.terminated || 0} sessions terminated`);
    }

    // Wait for cleanup to fully complete
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 2: Determine orgs to refresh (default: Blackhawk)
    let orgsToRefresh = [
      { org_ref: 'blackhawk-ski-club', category: 'all', provider: 'skiclubpro' }
    ];

    try {
      const body = await req.json();
      if (body.orgs && Array.isArray(body.orgs)) {
        orgsToRefresh = body.orgs;
      }
    } catch {
      // Use default orgs if body parsing fails
    }

    // Step 3: Hydrate details for each org
    console.log(`[refresh-provider-details] Refreshing ${orgsToRefresh.length} org(s)...`);
    const results: any[] = [];

    for (const config of orgsToRefresh) {
      try {
        console.log(`[refresh-provider-details] Processing ${config.org_ref}...`);
        
        const resp = await fetch(`${mcpServerUrl}/hydrate-program-details`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${mcpAccessToken}`
          },
          body: JSON.stringify({ provider: 'blackhawk' })
        });

        if (!resp.ok) {
          const errorMsg = await resp.text();
          console.error(`[refresh-provider-details] Error for ${config.org_ref}:`, errorMsg);
          
          // Stop if Browserbase session limit hit
          if (errorMsg.includes('session limit')) {
            console.error('[refresh-provider-details] 🚨 Browserbase session limit reached. Aborting.');
            results.push({ org_ref: config.org_ref, success: false, error: 'session_limit' });
            break;
          }
          
          results.push({ org_ref: config.org_ref, success: false, error: errorMsg });
          continue;
        }

        const data = await resp.json();
        console.log(`[refresh-provider-details] ✅ Refreshed ${config.org_ref}: ${data.hydrated || 0} programs`);
        results.push({ org_ref: config.org_ref, success: true, hydrated: data.hydrated || 0 });

      } catch (err) {
        console.error(`[refresh-provider-details] Error processing ${config.org_ref}:`, err);
        results.push({ 
          org_ref: config.org_ref, 
          success: false, 
          error: err instanceof Error ? err.message : 'Unknown error' 
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const totalHydrated = results.reduce((sum, r) => sum + (r.hydrated || 0), 0);
    
    console.log(`[refresh-provider-details] Completed: ${successCount}/${results.length} orgs, ${totalHydrated} programs hydrated`);

    return new Response(JSON.stringify({
      success: true,
      message: `Hydrated ${successCount}/${results.length} organizations`,
      total_programs: totalHydrated,
      orgs_hydrated: successCount,
      results,
      timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (err) {
    console.error('[refresh-provider-details] Fatal error:', err);
    return new Response(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});
