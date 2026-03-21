/**
 * Refresh Provider Details Edge Function
 *
 * Scheduled edge function (via pg_cron) to refresh program metadata via API sync.
 * Uses the Bookeo sync edge function (no browser automation).
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
    console.log('[refresh-provider-details] Starting API-based program refresh...');
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing required environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Default: Bookeo orgs (API sync)
    let orgsToRefresh = [
      { org_ref: 'aim-design', provider: 'bookeo' }
    ];

    try {
      const body = await req.json();
      if (body.orgs && Array.isArray(body.orgs)) {
        orgsToRefresh = body.orgs;
      }
    } catch {
      // Use default orgs if body parsing fails
    }

    console.log(`[refresh-provider-details] Refreshing ${orgsToRefresh.length} org(s)...`);
    const results: any[] = [];

    for (const config of orgsToRefresh) {
      try {
        console.log(`[refresh-provider-details] Syncing ${config.org_ref} (${config.provider})...`);

        const { data, error } = await supabase.functions.invoke('sync-bookeo', {
          body: { org_ref: config.org_ref }
        });

        if (error) {
          console.error(`[refresh-provider-details] Error for ${config.org_ref}:`, error.message);
          results.push({ org_ref: config.org_ref, success: false, error: error.message });
          continue;
        }

        const synced = data?.synced ?? data?.syncedCount ?? 0;
        console.log(`[refresh-provider-details] ✅ Refreshed ${config.org_ref}:`, data);
        results.push({ org_ref: config.org_ref, success: true, hydrated: synced, synced });

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
    const totalHydrated = results.reduce((sum, r) => sum + (r.hydrated || r.synced || 0), 0);
    
    console.log(`[refresh-provider-details] Completed: ${successCount}/${results.length} orgs, ${totalHydrated} programs synced`);

    return new Response(JSON.stringify({
      success: true,
      message: `Synced ${successCount}/${results.length} organizations`,
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
