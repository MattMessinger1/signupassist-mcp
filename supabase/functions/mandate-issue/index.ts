import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { SignJWT } from 'https://esm.sh/jose@5.9.6';

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
    // Create Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        }
      }
    );

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const body = await req.json();
    console.log("mandate-issue body keys:", Object.keys(body));
    
    const {
      child_id,
      program_ref,
      max_amount_cents,
      valid_from,
      valid_until,
      provider,
      scope,
      scopes,
      credential_id,
      jws_compact,
      caps
    } = body;

    // Normalize scope field - accept either scope or scopes
    const normalizedScope = scope ?? scopes;

    console.log(`Creating mandate for user ${user.id}, program ${program_ref}`);

    // Validate required fields with specific error messages (excluding jws_compact since we generate it)
    const requiredFields = { user_id: user.id, provider, scope: normalizedScope, valid_until };
    for (const [field, value] of Object.entries(requiredFields)) {
      if (!value) {
        return new Response(
          JSON.stringify({ error: `Missing required field: ${field}` }),
          { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
    }
    
    if (!Array.isArray(normalizedScope)) {
      return new Response(
        JSON.stringify({ error: "scope must be an array" }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Also validate mandate-specific fields
    if (!child_id || !program_ref || max_amount_cents === undefined || !valid_from || !credential_id) {
      const missingField = !child_id ? 'child_id' : 
                          !program_ref ? 'program_ref' : 
                          max_amount_cents === undefined ? 'max_amount_cents' :
                          !valid_from ? 'valid_from' : 'credential_id';
      return new Response(
        JSON.stringify({ error: `Missing required field: ${missingField}` }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Verify the credential belongs to the user
    console.log('[DEBUG] searching stored_credentials', {
      credential_id,
      user_id: user.id,
      provider,
    });

    // Create service role client for credential lookup (bypasses RLS)
    const serviceSupabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        }
      }
    );

    const { data: credential, error: credError } = await serviceSupabase
      .from('stored_credentials')
      .select('*')
      .eq('id', credential_id)
      .eq('user_id', user.id)
      .eq('provider', provider)
      .maybeSingle();

    if (credError) {
      console.error('Credential lookup error:', credError);
      throw new Error(`Credential lookup failed: ${credError.message}`);
    }
    
    if (!credential) {
      throw new Error(`No credential found with id=${credential_id}, user_id=${user.id}, provider=${provider}`);
    }

    // Create JWT payload for the mandate
    const payload = {
      iss: 'signupassist-platform',
      sub: user.id,
      aud: 'signupassist-mcp',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(new Date(valid_until).getTime() / 1000),
      child_id,
      program_ref,
      max_amount_cents,
      scope: normalizedScope,
      credential_id,
      ...(caps ? { caps } : {})
    };

    // Sign the JWT with the mandate signing key
    const signingKey = Deno.env.get('MANDATE_SIGNING_KEY');
    if (!signingKey) {
      throw new Error('Mandate signing key not configured');
    }

    const secret = new TextEncoder().encode(signingKey);
    const jws = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .sign(secret);

    console.log('Generated JWS mandate:', jws.substring(0, 50) + '...');

    // Store the mandate in the database - use provided jws_compact if available, otherwise use generated jws
    const { data: mandate, error: insertError } = await supabase
      .from('mandates')
      .insert([{
        user_id: user.id,
        child_id,
        program_ref,
        max_amount_cents,
        valid_from,
        valid_until,
        provider,
        scope: normalizedScope,
        jws_compact: jws_compact || jws,
        status: 'active',
        details: caps ? { caps } : null
      }])
      .select()
      .maybeSingle();

    if (insertError) {
      console.error('Error inserting mandate:', insertError);
      throw new Error('Failed to create mandate');
    }

    if (!mandate) {
      throw new Error('Mandate created but no data returned');
    }

    console.log(`Mandate created with ID: ${mandate.id}`);

    return new Response(
      JSON.stringify({
        mandate_id: mandate.id,
        jws_compact: jws
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in mandate-issue function:', error);
    return new Response(
      JSON.stringify({ 
        error: `Mandate Creation Failed: ${error instanceof Error ? error.message : 'Unable to create authorization mandate'}`
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});