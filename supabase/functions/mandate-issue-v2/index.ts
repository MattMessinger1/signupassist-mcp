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
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    
    console.log('[mandate-issue-v2] Supabase URL:', supabaseUrl);
    
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      }
    });

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

    console.log('[mandate-issue-v2] User authenticated:', user.id);

    const body = await req.json();
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

    // Normalize scope field
    const normalizedScope = scope ?? scopes;

    // Validate required fields
    const requiredFields = { 
      user_id: user.id, 
      provider, 
      scope: normalizedScope, 
      valid_until,
      child_id,
      program_ref,
      credential_id
    };
    
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

    if (max_amount_cents === undefined) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: max_amount_cents' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Verify the credential belongs to the user
    console.log('[mandate-issue-v2] Verifying credential:', {
      credential_id,
      user_id: user.id,
      provider,
    });

    const { data: credential, error: credError } = await supabase
      .from('stored_credentials')
      .select('*')
      .eq('id', credential_id)
      .eq('user_id', user.id)
      .eq('provider', provider)
      .maybeSingle();

    if (credError) {
      console.error('[mandate-issue-v2] Credential lookup error:', credError);
      throw new Error(`Credential lookup failed: ${credError.message}`);
    }
    
    if (!credential) {
      throw new Error(`No credential found with id=${credential_id}, user_id=${user.id}, provider=${provider}`);
    }

    console.log('[mandate-issue-v2] Credential verified successfully');

    // Create JWT payload for the mandate
    const payload = {
      iss: 'signupassist',
      sub: user.id,
      aud: provider,
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

    console.log('[mandate-issue-v2] Generated JWS mandate');

    // Store the mandate in the database
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
      console.error('[mandate-issue-v2] Error inserting mandate:', insertError);
      throw new Error('Failed to create mandate: ' + insertError.message);
    }

    if (!mandate) {
      throw new Error('Mandate created but no data returned');
    }

    console.log('[mandate-issue-v2] Mandate created with ID:', mandate.id);

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
    console.error('[mandate-issue-v2] Error:', error);
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
