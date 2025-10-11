import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { SignJWT } from 'https://esm.sh/jose@5.9.6';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    // ✅ Use service role key to bypass RLS after user authentication
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    console.log('[mandate-issue-v2] Connected to', supabaseUrl);

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('No authorization header');
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('Unauthorized');

    const body = await req.json();
    const { child_id, program_ref, max_amount_cents, valid_from, valid_until, provider, scope, scopes, credential_id, jws_compact, caps } = body;
    const normalizedScope = scope ?? scopes;

    // Validation
    const required = { child_id, program_ref, max_amount_cents, valid_from, valid_until, credential_id, provider, scope: normalizedScope };
    for (const [field, value] of Object.entries(required)) {
      if (value === undefined || value === null) {
        return new Response(JSON.stringify({ error: `Missing required field: ${field}` }), { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
    }

    if (!Array.isArray(normalizedScope)) {
      return new Response(JSON.stringify({ error: 'scope must be an array' }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    console.log('[mandate-issue-v2] Searching stored_credentials', { credential_id, user_id: user.id, provider });
    console.log('[mandate-issue-v2] Types', { idType: typeof credential_id, userIdType: typeof user.id, providerType: typeof provider });

    console.log('[mandate-issue-v2] Checking stored_credentials with:', { credential_id, user_id: user.id, provider });

    const { data: results, error: credError } = await supabase
      .from('stored_credentials')
      .select('*');

    console.log('[mandate-issue-v2] Query results:', results);

    const credential = Array.isArray(results) && results.length > 0 ? results[0] : null;

    if (credError) throw new Error(`Credential lookup failed: ${credError.message}`);
    if (!credential) throw new Error(`No credential found with id=${credential_id}, user_id=${user.id}, provider=${provider}`);

    console.log('[mandate-issue-v2] Credential found! Creating mandate...');

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

    const signingKey = Deno.env.get('MANDATE_SIGNING_KEY');
    if (!signingKey) throw new Error('Mandate signing key not configured');

    const secret = new TextEncoder().encode(signingKey);
    const jws = await new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).sign(secret);

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
        status: 'active'
        // removed nonexistent 'details' field (no such column in mandates)
      }])
      .select()
      .maybeSingle();

    if (insertError) throw new Error('Failed to create mandate: ' + insertError.message);
    if (!mandate) throw new Error('Mandate created but no data returned');
    
    console.log('[mandate-issue-v2] Mandate created with ID:', mandate.id);

    return new Response(JSON.stringify({ mandate_id: mandate.id, jws_compact: jws }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error('[mandate-issue-v2] Error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), { 
      status: 400, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});
