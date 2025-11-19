/**
 * Cleanup Browserbase Sessions
 * 
 * This edge function terminates all active Browserbase sessions to recover
 * from session limit issues. Use this when refresh operations are failing
 * due to "Too Many Requests" errors.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[cleanup-browserbase] Starting session cleanup...');
    
    const browserbaseApiKey = Deno.env.get('BROWSERBASE_API_KEY');
    const browserbaseProjectId = Deno.env.get('BROWSERBASE_PROJECT_ID');
    
    if (!browserbaseApiKey || !browserbaseProjectId) {
      throw new Error('Browserbase credentials not configured');
    }

    // List all sessions
    const listResponse = await fetch(
      `https://www.browserbase.com/v1/sessions?projectId=${browserbaseProjectId}`,
      {
        headers: {
          'X-BB-API-Key': browserbaseApiKey,
        },
      }
    );

    if (!listResponse.ok) {
      const error = await listResponse.text();
      throw new Error(`Failed to list sessions: ${error}`);
    }

    const sessions = await listResponse.json();
    console.log(`[cleanup-browserbase] Found ${sessions.length} sessions`);

    // Batch terminate sessions to avoid worker limits (5 at a time)
    const results = [];
    const BATCH_SIZE = 5;
    
    for (let i = 0; i < sessions.length; i += BATCH_SIZE) {
      const batch = sessions.slice(i, i + BATCH_SIZE);
      console.log(`[cleanup-browserbase] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(sessions.length / BATCH_SIZE)}`);
      
      const batchPromises = batch.map(async (session: any) => {
        try {
          const response = await fetch(
            `https://www.browserbase.com/v1/sessions/${session.id}`,
            {
              method: 'DELETE',
              headers: {
                'X-BB-API-Key': browserbaseApiKey,
              },
            }
          );
          
          if (response.ok) {
            console.log(`[cleanup-browserbase] ✅ Terminated ${session.id}`);
            return { id: session.id, success: true };
          } else {
            const error = await response.text();
            console.error(`[cleanup-browserbase] ❌ Failed ${session.id}: ${error}`);
            return { id: session.id, success: false, error };
          }
        } catch (err) {
          console.error(`[cleanup-browserbase] ❌ Error ${session.id}:`, err);
          return { id: session.id, success: false, error: err instanceof Error ? err.message : 'Unknown error' };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Small delay between batches to avoid overwhelming the worker
      if (i + BATCH_SIZE < sessions.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    const successCount = results.filter(r => r.success).length;

    console.log(`[cleanup-browserbase] Cleanup complete: ${successCount}/${results.length} sessions terminated`);

    return new Response(JSON.stringify({
      success: true,
      message: `Terminated ${successCount}/${results.length} sessions`,
      total_sessions: sessions.length,
      terminated: successCount,
      results,
      timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (err) {
    console.error('[cleanup-browserbase] Fatal error:', err);
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
