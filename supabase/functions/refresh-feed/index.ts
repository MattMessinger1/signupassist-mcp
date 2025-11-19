import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

// CORS headers to allow cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Supabase service key for authorization
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const workerUrl = Deno.env.get('WORKER_URL');

if (!workerUrl) {
  console.error('Environment variable WORKER_URL is not set');
}

// Handle incoming requests
Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!workerUrl || !supabaseServiceKey) {
      throw new Error('Missing configuration for worker URL or service key');
    }

    console.log('[refresh-feed] Proxying refresh request to Worker at', workerUrl);

    // Forward request to worker /refresh-feed with service role auth
    const response = await fetch(`${workerUrl}/refresh-feed`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
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
