import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

// CORS headers to allow cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Worker service token for authorization (safer than service role key)
const workerToken = Deno.env.get('WORKER_SERVICE_TOKEN');
const workerUrl = Deno.env.get('WORKER_URL');

// Handle incoming requests
Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auto-detect worker URL if not explicitly set
    let effectiveWorkerUrl = workerUrl;
    if (!effectiveWorkerUrl) {
      console.log('[refresh-feed] WORKER_URL not set, auto-detecting from MCP_SERVER_URL...');
      const mcpServerUrl = Deno.env.get('MCP_SERVER_URL');
      if (mcpServerUrl) {
        // Fetch /identity to get the canonical worker URL
        const identityResponse = await fetch(`${mcpServerUrl}/identity`);
        if (identityResponse.ok) {
          const identityData = await identityResponse.json();
          effectiveWorkerUrl = identityData.worker_url;
          console.log('[refresh-feed] Auto-detected worker URL:', effectiveWorkerUrl);
        } else {
          throw new Error('Failed to auto-detect worker URL from /identity endpoint');
        }
      } else {
        throw new Error('Neither WORKER_URL nor MCP_SERVER_URL is set');
      }
    }

    if (!workerToken) {
      throw new Error('Missing WORKER_SERVICE_TOKEN configuration');
    }

    console.log('[refresh-feed] Proxying refresh request to Worker at', effectiveWorkerUrl);

    // Forward request to worker /refresh-feed with worker token auth
    const response = await fetch(`${effectiveWorkerUrl}/refresh-feed`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${workerToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[refresh-feed] Worker error:', errorText || response.status);
      return new Response(JSON.stringify({
        success: false,
        error: errorText || `Worker request failed with status ${response.status}`,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Relay successful JSON result from worker
    const result = await response.json();
    console.log(`[refresh-feed] Success: refreshed ${result.refreshed || 0} programs`);

    return new Response(JSON.stringify({
      success: true,
      refreshed: result.refreshed || 0,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err: any) {
    console.error('[refresh-feed] Fatal error:', err);
    return new Response(JSON.stringify({
      success: false,
      error: err.message || 'Unknown error',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
