import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SignJWT } from 'https://esm.sh/jose@5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Mandate configuration
const ALG = 'HS256';
const ISS = 'signupassist-platform';
const AUD = 'signupassist-mcp';

interface MandatePayload {
  mandate_id: string;
  user_id: string;
  provider: string;
  scope: string[];
  valid_from: string;
  valid_until: string;
  time_period: string;
  credential_type: 'jws';
  child_id?: string;
  program_ref?: string;
  max_amount_cents?: number;
}

/**
 * Get signing key from environment
 */
function getSigningKey(): Uint8Array {
  const secret = Deno.env.get('MANDATE_SIGNING_KEY') || Deno.env.get('MANDATE_SIGNING_SECRET');
  if (!secret) {
    throw new Error('MANDATE_SIGNING_KEY or MANDATE_SIGNING_SECRET not set');
  }
  
  // If base64-encoded, decode it
  if (secret.match(/^[A-Za-z0-9+/=]+$/)) {
    try {
      return Uint8Array.from(atob(secret), c => c.charCodeAt(0));
    } catch {
      return new TextEncoder().encode(secret);
    }
  }
  
  return new TextEncoder().encode(secret);
}

/**
 * Create a signed JWS mandate
 */
async function createMandateJWS(payload: MandatePayload, ttlMinutes: number): Promise<string> {
  const keyBytes = getSigningKey();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const jws = await new SignJWT({
    mandate_id: payload.mandate_id,
    user_id: payload.user_id,
    provider: payload.provider,
    scope: payload.scope,
    valid_from: payload.valid_from,
    valid_until: payload.valid_until,
    time_period: payload.time_period,
    credential_type: payload.credential_type,
    child_id: payload.child_id,
    program_ref: payload.program_ref,
    max_amount_cents: payload.max_amount_cents
  })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setIssuer(ISS)
    .setAudience(AUD)
    .setExpirationTime(`${ttlMinutes}m`)
    .sign(cryptoKey);

  return jws;
}

/**
 * Create or refresh a mandate (reuses existing active mandates with matching scopes)
 */
async function createOrRefreshMandate(
  supabase: any,
  userId: string,
  provider: string,
  orgRef: string,
  scopes: string[],
  validDurationMinutes: number
): Promise<{ mandate_id: string; mandate_jws: string }> {
  // Check for existing active mandate with matching scopes
  const { data: existing } = await supabase
    .from('mandates')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('status', 'active')
    .gt('valid_until', new Date().toISOString())
    .single();
  
  // If found and scopes match, return it
  if (existing && scopes.every(s => existing.scope.includes(s))) {
    console.log('[create-system-mandate] ✅ Reusing existing mandate:', existing.id);
    return {
      mandate_id: existing.id,
      mandate_jws: existing.jws_compact
    };
  }
  
  // Create new mandate
  console.log('[create-system-mandate] 🔄 Creating new mandate for', provider);
  
  const now = new Date();
  const validFrom = now.toISOString();
  const validUntil = new Date(now.getTime() + validDurationMinutes * 60 * 1000).toISOString();
  
  const mandateId = crypto.randomUUID();
  
  const payload: MandatePayload = {
    mandate_id: mandateId,
    user_id: userId,
    provider,
    scope: scopes,
    valid_from: validFrom,
    valid_until: validUntil,
    time_period: `${validDurationMinutes}m`,
    credential_type: 'jws'
  };
  
  const jws = await createMandateJWS(payload, validDurationMinutes);
  
  // Store in database
  const { data: mandate, error } = await supabase
    .from('mandates')
    .insert({
      user_id: userId,
      provider,
      scope: scopes,
      jws_compact: jws,
      valid_from: validFrom,
      valid_until: validUntil,
      status: 'active',
      credential_type: 'jws'
    })
    .select()
    .single();
  
  if (error) {
    throw new Error(`Failed to store mandate: ${error.message}`);
  }
  
  console.log('[create-system-mandate] ✅ New mandate created:', mandate.id);
  return {
    mandate_id: mandate.id,
    mandate_jws: jws
  };
}

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

    // Create or refresh mandate (reuses existing if scopes match)
    const result = await createOrRefreshMandate(
      supabase,
      user_id,
      'skiclubpro',
      'system', // org_ref for system-level operations
      mandateScopes,
      validDuration
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
