import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createOrRefreshMandate } from '../../../mcp_server/lib/mandates.ts';

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
    console.log('[create-system-mandate] Received request');

    const { user_id, scopes, valid_duration_minutes } = await req.json();
    
    // Validate inputs
    if (!user_id) {
      console.error('[create-system-mandate] Missing user_id');
      return new Response(
        JSON.stringify({ error: 'user_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Default scopes for system mandate
    const mandateScopes = scopes || ['scp:authenticate', 'scp:discover:fields'];
    const validDuration = valid_duration_minutes || 10080; // 7 days default

    console.log('[create-system-mandate] Creating mandate for user:', user_id);
    console.log('[create-system-mandate] Scopes:', mandateScopes);
    console.log('[create-system-mandate] Valid duration (minutes):', validDuration);

    // Create Supabase client with service role for database access
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Use the existing createOrRefreshMandate utility
    // This will reuse an active mandate if one exists with matching scopes
    const result = await createOrRefreshMandate(
      supabase,
      user_id,
      'skiclubpro',
      'system', // org_ref for system-level operations
      mandateScopes,
      { validDurationMinutes: validDuration }
    );

    console.log('[create-system-mandate] ✅ Mandate created/refreshed:', result.mandate_id);

    return new Response(
      JSON.stringify({
        success: true,
        mandate_id: result.mandate_id,
        mandate_jws: result.mandate_jws,
        scopes: mandateScopes,
        valid_duration_minutes: validDuration,
        message: 'System mandate created/refreshed successfully. Store mandate_jws as SYSTEM_MANDATE_JWS secret.'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[create-system-mandate] Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        details: error instanceof Error ? error.stack : undefined
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
