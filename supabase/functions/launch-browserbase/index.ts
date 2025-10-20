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

    const resp = await fetch('https://api.browserbase.com/v1/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${browserbaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sessionBody),
    });

    // Handle non-JSON responses safely
    const text = await resp.text();
    if (!resp.ok) {
      console.error('[launch-browserbase] Browserbase error response:', text.slice(0, 200));
      return new Response(
        JSON.stringify({ error: `Browserbase responded ${resp.status}`, details: text }),
        { status: resp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse JSON only if response was OK
    const sessionData = JSON.parse(text);
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
