import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.74.0';
import { SignJWT } from 'https://esm.sh/jose@5.10.0';

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

    const { provider, org_ref, scope, mandate_tier, valid_duration_minutes, child_id, program_ref, max_amount_cents, delegate, participants } = await req.json();

    if (!provider || !org_ref || !scope || !mandate_tier) {
      throw new Error('Missing required parameters: provider, org_ref, scope, mandate_tier');
    }
    
    // Validate delegate age if provided
    if (delegate?.delegate_dob) {
      const birthDate = new Date(delegate.delegate_dob);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      
      if (age < 18) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Delegate must be at least 18 years old to authorize registration'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400
        });
      }
    }

    console.log(`[create-mandate] Creating ${mandate_tier} mandate for user ${user.id}`);

    // Get mandate signing key
    const mandateSigningKey = Deno.env.get('MANDATE_SIGNING_KEY');
    if (!mandateSigningKey) {
      throw new Error('MANDATE_SIGNING_KEY not configured');
    }

    // Calculate validity period
    const validDurationMinutes = valid_duration_minutes || 1440; // Default 24 hours
    const now = new Date();
    const validFrom = now.toISOString();
    const validUntil = new Date(now.getTime() + validDurationMinutes * 60 * 1000).toISOString();

    // Create mandate payload with delegate and participants
    const mandatePayload: any = {
      user_id: user.id,
      provider,
      org_ref,
      scope: Array.isArray(scope) ? scope : [scope],
      mandate_tier,
      child_id,
      program_ref,
      max_amount_cents,
      valid_from: validFrom,
      valid_until: validUntil,
      credential_type: 'jws'
    };
    
    // Include delegate information if provided
    if (delegate) {
      mandatePayload.delegate = {
        name: `${delegate.delegate_firstName || ''} ${delegate.delegate_lastName || ''}`.trim(),
        email: delegate.delegate_email,
        phone: delegate.delegate_phone,
        dob: delegate.delegate_dob,
        relationship: delegate.delegate_relationship
      };
    }
    
    // Include participants if provided
    if (participants && Array.isArray(participants)) {
      mandatePayload.participants = participants.map((p: any) => ({
        name: `${p.firstName || ''} ${p.lastName || ''}`.trim(),
        dob: p.dob,
        grade: p.grade,
        allergies: p.allergies
      }));
    }

    // Sign mandate JWS using Deno-compatible crypto
    const keyBytes = Uint8Array.from(atob(mandateSigningKey), c => c.charCodeAt(0));
    
    const secret = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );

    const jws_token = await new SignJWT(mandatePayload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer('signupassist-platform')
      .setAudience('signupassist-mcp')
      .setExpirationTime(`${validDurationMinutes}m`)
      .sign(secret);

    // Store mandate in database for audit trail
    const { data: mandateRecord, error: insertError } = await supabase
      .from('mandates')
      .insert({
        user_id: user.id,
        provider,
        scope: Array.isArray(scope) ? scope : [scope],
        jws_compact: jws_token,
        child_id,
        program_ref,
        max_amount_cents,
        valid_from: validFrom,
        valid_until: validUntil,
        status: 'active',
        credential_type: 'jws'
      })
      .select()
      .single();

    if (insertError) {
      console.error('[create-mandate] Database insert error:', insertError);
      throw new Error(`Failed to store mandate: ${insertError.message}`);
    }

    console.log('[create-mandate] ✅ Mandate created and signed:', mandateRecord.id);

    return new Response(
      JSON.stringify({
        success: true,
        mandate_id: mandateRecord.id,
        mandate_jws: jws_token, // Return the signed JWS token
        jws_token, // Keep for backwards compatibility
        valid_until: validUntil
      }),
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
