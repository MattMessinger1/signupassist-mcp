/**
 * Scheduled Provider Feed Refresh
 * 
 * This edge function refreshes the cached_provider_feed table by calling
 * scp.find_programs with the service credential. It's designed to be
 * triggered by pg_cron on a daily schedule.
 * 
 * What it does:
 * 1. Authenticates with the service credential (SCP_SERVICE_CRED_ID)
 * 2. Triggers full program scraping + prerequisite checks + form discovery
 * 3. Caches all data in cached_provider_feed table
 * 
 * This keeps the cache fresh so users get instant program loading.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RefreshConfig {
  org_ref: string;
  category: string;
  provider?: string;
}

// Organizations to refresh (can be expanded)
const DEFAULT_ORGS: RefreshConfig[] = [
  {
    org_ref: 'blackhawk-ski-club',
    category: 'all',
    provider: 'skiclubpro'
  }
];

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[refresh-provider-feed] Starting scheduled feed refresh...');
    
    // Get environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const serviceCredId = Deno.env.get('SCP_SERVICE_CRED_ID');
    
    if (!serviceCredId) {
      throw new Error('SCP_SERVICE_CRED_ID not configured');
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Parse request body for custom orgs (optional)
    let orgsToRefresh = DEFAULT_ORGS;
    try {
      const body = await req.json();
      if (body.orgs && Array.isArray(body.orgs)) {
        orgsToRefresh = body.orgs;
      }
    } catch {
      // Use defaults if no body provided
    }
    
    console.log(`[refresh-provider-feed] Refreshing ${orgsToRefresh.length} organization(s)...`);
    
    const results = [];
    
    // Refresh each organization
    for (const config of orgsToRefresh) {
      try {
        console.log(`[refresh-provider-feed] Processing ${config.org_ref}...`);
        
        // Call skiclubpro-tools with service credential
        const { data, error } = await supabase.functions.invoke('skiclubpro-tools', {
          body: {
            tool: 'scp.find_programs',
            args: {
              credential_id: serviceCredId,
              org_ref: config.org_ref,
              category: config.category,
              user_jwt: 'system.cron.refresh' // Special marker for cron jobs
            }
          }
        });
        
        if (error) {
          console.error(`[refresh-provider-feed] Error refreshing ${config.org_ref}:`, error);
          results.push({
            org_ref: config.org_ref,
            success: false,
            error: error.message
          });
          continue;
        }
        
        console.log(`[refresh-provider-feed] ✅ Refreshed ${config.org_ref}`);
        results.push({
          org_ref: config.org_ref,
          success: true,
          refreshed: data?.refreshed || data?.programs?.length || 0
        });
        
      } catch (err) {
        console.error(`[refresh-provider-feed] Error processing ${config.org_ref}:`, err);
        results.push({
          org_ref: config.org_ref,
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error'
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const totalRefreshed = results.reduce((sum, r) => sum + (r.refreshed || 0), 0);
    
    console.log(`[refresh-provider-feed] Completed: ${successCount}/${results.length} orgs, ${totalRefreshed} programs refreshed`);
    
    return new Response(JSON.stringify({
      success: true,
      message: `Refreshed ${successCount}/${results.length} organizations`,
      total_programs: totalRefreshed,
      results,
      timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });
    
  } catch (err) {
    console.error('[refresh-provider-feed] Fatal error:', err);
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
