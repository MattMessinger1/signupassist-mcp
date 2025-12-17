import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DetokenizeRequest {
  email_alias?: string;
  phone_alias?: string;
}

interface DetokenizeResponse {
  email?: string;
  phone?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify user is authenticated before allowing detokenization
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization required for detokenization' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authorization token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const VGS_VAULT_ID = Deno.env.get('VGS_VAULT_ID');
    const VGS_PROXY_HOST = Deno.env.get('VGS_PROXY_HOST');
    const VGS_USERNAME = Deno.env.get('VGS_USERNAME');
    const VGS_PASSWORD = Deno.env.get('VGS_PASSWORD');
    const VGS_PROXY_ENABLED = Deno.env.get('VGS_PROXY_ENABLED') === 'true';

    const body: DetokenizeRequest = await req.json();
    const { email_alias, phone_alias } = body;

    if (!email_alias && !phone_alias) {
      return new Response(
        JSON.stringify({ error: 'At least one alias is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle passthrough aliases (development mode)
    const response: DetokenizeResponse = {};
    
    if (email_alias?.startsWith('passthrough:')) {
      response.email = atob(email_alias.replace('passthrough:', ''));
    }
    if (phone_alias?.startsWith('passthrough:')) {
      response.phone = atob(phone_alias.replace('passthrough:', ''));
    }

    // If all aliases are passthrough or VGS is disabled, return early
    if (!VGS_PROXY_ENABLED || !VGS_VAULT_ID || !VGS_PROXY_HOST) {
      console.warn('[VGS] Detokenization disabled - decoding passthrough values');
      return new Response(
        JSON.stringify(response),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Collect non-passthrough aliases for VGS lookup
    const aliasesToReveal = [];
    if (email_alias && !email_alias.startsWith('passthrough:')) {
      aliasesToReveal.push(email_alias);
    }
    if (phone_alias && !phone_alias.startsWith('passthrough:')) {
      aliasesToReveal.push(phone_alias);
    }

    if (aliasesToReveal.length === 0) {
      return new Response(
        JSON.stringify(response),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Call VGS to reveal aliases using the correct API endpoint
    // Environment-aware: sandbox for dev, live for production
    // URL format: https://{vault_id}.{environment}.verygoodvault.com/aliases/{alias}
    const vgsEnv = Deno.env.get('VGS_ENVIRONMENT') || 'sandbox';
    const authHeaderVgs = `Basic ${btoa(`${VGS_USERNAME}:${VGS_PASSWORD}`)}`;

    // Reveal each alias individually using the VGS Aliases API
    if (email_alias && !email_alias.startsWith('passthrough:')) {
      const revealUrl = `https://${VGS_VAULT_ID}.${vgsEnv}.verygoodvault.com/aliases/${email_alias}`;
      const emailRes = await fetch(revealUrl, {
        method: 'GET',
        headers: { 'Authorization': authHeaderVgs },
      });

      if (emailRes.ok) {
        const emailResult = await emailRes.json();
        response.email = emailResult.value;
      } else {
        console.error('[VGS] Email reveal failed:', emailRes.status, await emailRes.text());
      }
    }

    if (phone_alias && !phone_alias.startsWith('passthrough:')) {
      const revealUrl = `https://${VGS_VAULT_ID}.${vgsEnv}.verygoodvault.com/aliases/${phone_alias}`;
      const phoneRes = await fetch(revealUrl, {
        method: 'GET',
        headers: { 'Authorization': authHeaderVgs },
      });

      if (phoneRes.ok) {
        const phoneResult = await phoneRes.json();
        response.phone = phoneResult.value;
      } else {
        console.error('[VGS] Phone reveal failed:', phoneRes.status, await phoneRes.text());
      }
    }

    // Audit log the detokenization request
    const serviceClient = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    await serviceClient.from('mandate_audit').insert({
      user_id: user.id,
      action: 'pii_detokenize',
      metadata: {
        email_revealed: !!email_alias,
        phone_revealed: !!phone_alias,
        timestamp: new Date().toISOString(),
      }
    });

    console.log('[VGS] Detokenization successful for user:', user.id);

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[VGS] Detokenization error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal error during detokenization', message: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
