import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.74.0';

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
    // Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { provider, org_ref, scope, mandate_tier, valid_duration_minutes, child_id, program_ref, max_amount_cents } = await req.json();

    if (!provider || !org_ref || !scope || !mandate_tier) {
      throw new Error('Missing required parameters: provider, org_ref, scope, mandate_tier');
    }

    console.log(`[create-mandate] Creating ${mandate_tier} mandate for user ${user.id}`);

    // Call MCP server to create mandate
    const mcpServerUrl = Deno.env.get('MCP_SERVER_URL');
    if (!mcpServerUrl) {
      throw new Error('MCP_SERVER_URL not configured');
    }

    const mcpAccessToken = Deno.env.get('MCP_ACCESS_TOKEN');
    if (!mcpAccessToken) {
      throw new Error('MCP_ACCESS_TOKEN not configured');
    }

    // Invoke scp.create_mandate through the MCP server with proper authentication
    const mcpResponse = await fetch(`${mcpServerUrl}/tools/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mcpAccessToken}`, // Use MCP access token
      },
      body: JSON.stringify({
        tool: 'scp.create_mandate',
        args: {
          user_jwt: token, // Pass user JWT for mandate signing
          provider,
          org_ref,
          scope,
          mandate_tier,
          valid_duration_minutes: valid_duration_minutes || 1440,
          child_id,
          program_ref,
          max_amount_cents
        }
      })
    });

    if (!mcpResponse.ok) {
      const errorText = await mcpResponse.text();
      console.error('[create-mandate] MCP error:', errorText);
      throw new Error(`MCP mandate creation failed: ${errorText}`);
    }

    const mcpResult = await mcpResponse.json();
    console.log('[create-mandate] Mandate created:', mcpResult.mandate_id);

    return new Response(
      JSON.stringify(mcpResult),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in create-mandate function:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
