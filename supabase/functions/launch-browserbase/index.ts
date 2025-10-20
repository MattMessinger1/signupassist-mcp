import { createClient } from 'jsr:@supabase/supabase-js@2';

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
    const browserbaseKey = Deno.env.get('BROWSERBASE_API_KEY');
    const browserbaseProjectId = Deno.env.get('BROWSERBASE_PROJECT_ID');
    
    if (!browserbaseKey) {
      console.error('[launch-browserbase] Missing BROWSERBASE_API_KEY');
      return new Response(
        JSON.stringify({ error: 'Missing Browserbase API key configuration' }), 
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const requestBody = await req.json().catch(() => ({}));
    const { headless = true, projectId } = requestBody;

    const finalProjectId = projectId || browserbaseProjectId;
    
    console.log('[launch-browserbase] Creating new session', { 
      headless, 
      projectId: finalProjectId ? 'configured' : 'none' 
    });

    // Call Browserbase API to create session
    const sessionBody: any = { headless };
    if (finalProjectId) {
      sessionBody.projectId = finalProjectId;
    }

    const resp = await fetch('https://www.browserbase.com/v1/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${browserbaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sessionBody),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error('[launch-browserbase] Browserbase API error:', errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to create Browserbase session', details: errorText }),
        { status: resp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const sessionData = await resp.json();
    console.log('[launch-browserbase] Session created:', sessionData.id);

    return new Response(
      JSON.stringify({ session: sessionData }), 
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (err) {
    console.error('[launch-browserbase] Error:', err);
    return new Response(
      JSON.stringify({ 
        error: err instanceof Error ? err.message : 'Unknown error',
        details: err instanceof Error ? err.stack : undefined
      }), 
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
