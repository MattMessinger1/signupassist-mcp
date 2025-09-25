import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  program_ref: string;
  credential_id: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    // Check authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization header required' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authentication' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const { program_ref, credential_id }: RequestBody = await req.json();

    if (!program_ref || !credential_id) {
      return new Response(
        JSON.stringify({ error: 'program_ref and credential_id are required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Interactive field discovery for program ${program_ref}, credential ${credential_id}`);

    // Load and decrypt the credential - pass through the Authorization header
    const { data: credentialData, error: credError } = await supabase.functions.invoke('cred-get', {
      headers: {
        Authorization: authHeader
      },
      body: { id: credential_id }
    });

    if (credError) {
      console.error('Failed to load credential:', credError);
      return new Response(
        JSON.stringify({ error: 'Failed to load credential' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Build temporary mandate request for field discovery
    const validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    const mandateBody = {
      provider: 'skiclubpro',
      scope: ['scp:read:listings'],
      max_amount_cents: 0,
      program_ref,
      valid_from: new Date().toISOString(),
      valid_until: validUntil.toISOString(),
      credential_id
    };

    console.log('Creating temporary mandate for field discovery:', mandateBody);

    const { data: mandateData, error: mandateError } = await supabase.functions.invoke('mandate-issue', {
      headers: {
        Authorization: authHeader
      },
      body: mandateBody
    });

    if (mandateError || !mandateData) {
      console.error('Failed to issue mandate:', mandateError);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to issue mandate',
          details: mandateError?.message || 'Unknown error'
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const mandate_id = mandateData.mandate_id;
    console.log(`Issued mandate ${mandate_id} for interactive field discovery`);

    // Call the MCP provider tool for field discovery
    const { data: mcpResponse, error: mcpError } = await supabase.functions.invoke('skiclubpro-tools', {
      body: {
        tool: 'scp.discover_required_fields',
        args: { 
          program_ref, 
          mandate_id, 
          plan_execution_id: 'interactive' 
        }
      }
    });

    if (mcpError) {
      console.error('MCP tool error:', mcpError);
      return new Response(
        JSON.stringify({ 
          error: 'Field discovery failed',
          details: mcpError?.message || 'Unknown error'
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('Field discovery completed:', mcpResponse);

    // Return schema JSON with proper structure
    const response = {
      program_ref,
      branches: mcpResponse?.branches || [],
      common_questions: mcpResponse?.common_questions || []
    };

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in discover-fields-interactive function:', error);
    
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});