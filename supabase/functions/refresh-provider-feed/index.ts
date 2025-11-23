/**
 * Scheduled Provider Feed Refresh (API-Only)
 * 
 * This edge function refreshes the cached_provider_feed table for API-based
 * providers only. Scraping-based providers (e.g., SkiClubPro) are excluded
 * to avoid burning Browserbase sessions.
 * 
 * What it does:
 * 1. Auto-discovers organizations that support automated sync
 * 2. Calls appropriate sync method (edge function or MCP tool)
 * 3. Only syncs API-based providers (Bookeo, CampMinder, etc.)
 * 
 * Scraping providers remain manual-refresh only.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { 
  getProvider, 
  getOrganizationsForAutomatedSync 
} from '../_shared/providerRegistry.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};


Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[refresh-provider-feed] Starting API-based provider sync...');
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get only organizations that support automated sync (API-based)
    const orgsToRefresh = getOrganizationsForAutomatedSync();
    
    console.log(`[refresh-provider-feed] Found ${orgsToRefresh.length} API-based organizations to sync`);
    
    if (orgsToRefresh.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No API-based organizations configured for automated sync',
        timestamp: new Date().toISOString()
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      });
    }
    
    const results = [];
    
    for (const orgConfig of orgsToRefresh) {
      try {
        const provider = getProvider(orgConfig.providerId);
        
        if (!provider) {
          console.error(`[refresh-provider-feed] Provider ${orgConfig.providerId} not found`);
          continue;
        }
        
        console.log(`[refresh-provider-feed] Syncing ${orgConfig.orgRef} (${provider.name})...`);
        
        let data, error;
        
        if (provider.syncConfig.method === 'edge-function') {
          // Direct edge function call (e.g., sync-bookeo)
          const response = await supabase.functions.invoke(
            provider.syncConfig.functionName!,
            { body: { org_ref: orgConfig.orgRef } }
          );
          data = response.data;
          error = response.error;
        }
        
        if (error) {
          console.error(`[refresh-provider-feed] Error: ${error.message}`);
          results.push({
            org_ref: orgConfig.orgRef,
            provider: provider.name,
            success: false,
            error: error.message
          });
          continue;
        }
        
        console.log(`[refresh-provider-feed] ✅ Synced ${orgConfig.orgRef}`);
        results.push({
          org_ref: orgConfig.orgRef,
          provider: provider.name,
          success: true,
          synced: data?.synced || 0
        });
        
      } catch (err) {
        console.error(`[refresh-provider-feed] Error:`, err);
        results.push({
          org_ref: orgConfig.orgRef,
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error'
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const totalSynced = results.reduce((sum, r) => sum + (r.synced || 0), 0);
    
    console.log(`[refresh-provider-feed] Complete: ${successCount}/${results.length} orgs, ${totalSynced} programs`);
    
    return new Response(JSON.stringify({
      success: true,
      message: `Synced ${successCount}/${results.length} API-based organizations`,
      total_programs: totalSynced,
      orgs_synced: successCount,
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
