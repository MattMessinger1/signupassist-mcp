import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { SignJWT, importJWK } from 'https://esm.sh/jose@5.2.4';

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

    console.log("auth user id:", user.id);

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

    // Generate mandate with JWS
    const mandate_id = crypto.randomUUID();
    const validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    const validFrom = new Date();
    
    const mandatePayload = {
      mandate_id,
      user_id: user.id,
      provider: 'skiclubpro',
      scopes: ['scp:read:listings'],
      program_ref,
      max_amount_cents: 0,
      valid_from: validFrom.toISOString(),
      valid_until: validUntil.toISOString(),
      credential_type: 'jws' as const,
    };

    console.log('Creating temporary mandate for field discovery:', mandatePayload);
    console.log("mandate payload keys:", Object.keys(mandatePayload));

    // Generate JWS token
    const signingKey = Deno.env.get('MANDATE_SIGNING_KEY');
    if (!signingKey) {
      throw new Error('MANDATE_SIGNING_KEY environment variable is required');
    }

    // Decode the base64 signing key  
    const keyBytes = new Uint8Array(atob(signingKey).split('').map(c => c.charCodeAt(0)));
    
    // Create JWK from the raw key
    const jwk = {
      kty: 'oct',
      k: btoa(String.fromCharCode(...keyBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''),
    };

    const secret = await importJWK(jwk, 'HS256');

    // Create and sign JWT with NumericDate seconds
    const nbfSec = Math.floor(validFrom.getTime() / 1000);
    const expSec = Math.floor(validUntil.getTime() / 1000);
    
    const jws = await new SignJWT(mandatePayload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setNotBefore(nbfSec)
      .setIssuer('signupassist-platform')
      .setAudience('signupassist-mcp')
      .setExpirationTime(expSec)
      .sign(secret);

    // Insert mandate directly into database
    const supabaseService = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: mandateData, error: mandateError } = await supabaseService
      .from('mandates')
      .insert({
        id: mandate_id,
        user_id: user.id,
        provider: 'skiclubpro',
        scope: ['scp:read:listings'],  // Use singular 'scope' to match DB column
        program_ref,
        max_amount_cents: 0,
        valid_from: mandatePayload.valid_from,
        valid_until: mandatePayload.valid_until,
        credential_type: 'jws',
        jws_compact: jws,
        status: 'active'
      })
      .select()
      .single();

    if (mandateError || !mandateData) {
      console.error('Failed to insert mandate:', mandateError);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to create mandate',
          details: mandateError?.message || 'Unknown error'
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }
    console.log(`Issued mandate ${mandate_id} for interactive field discovery`);
    console.log("mandate id returned:", mandateData?.id, "error:", mandateError);

    // Call the MCP provider tool for field discovery
    console.log("invoking MCP with mandate_id:", mandate_id);
    
    try {
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
        throw mcpError;
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

    } catch (err) {
      console.error("MCP call failed:", err);
      const error = err as any;
      return new Response(
        JSON.stringify({ 
          error: error?.message || "MCP call failed"
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }


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