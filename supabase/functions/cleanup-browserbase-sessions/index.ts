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

    // Terminate ALL sessions regardless of status (fixes zombie session leak)
    const terminatePromises = sessions
      .map(async (session: any) => {
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
            console.log(`[cleanup-browserbase] ✅ Terminated session ${session.id}`);
            return { id: session.id, success: true };
          } else {
            const error = await response.text();
            console.error(`[cleanup-browserbase] ❌ Failed to terminate ${session.id}: ${error}`);
            return { id: session.id, success: false, error };
          }
        } catch (err) {
          console.error(`[cleanup-browserbase] ❌ Error terminating ${session.id}:`, err);
          return { id: session.id, success: false, error: err instanceof Error ? err.message : 'Unknown error' };
        }
      });

    const results = await Promise.all(terminatePromises);
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
