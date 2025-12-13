import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TokenizeRequest {
  email?: string;
  phone?: string;
}

interface TokenizeResponse {
  email_alias?: string;
  phone_alias?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const VGS_VAULT_ID = Deno.env.get('VGS_VAULT_ID');
    const VGS_PROXY_HOST = Deno.env.get('VGS_PROXY_HOST');
    const VGS_USERNAME = Deno.env.get('VGS_USERNAME');
    const VGS_PASSWORD = Deno.env.get('VGS_PASSWORD');
    const VGS_PROXY_ENABLED = Deno.env.get('VGS_PROXY_ENABLED') === 'true';

    const body: TokenizeRequest = await req.json();
    const { email, phone } = body;

    if (!email && !phone) {
      return new Response(
        JSON.stringify({ error: 'At least one of email or phone is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If VGS is disabled, return passthrough aliases for development
    if (!VGS_PROXY_ENABLED || !VGS_VAULT_ID || !VGS_PROXY_HOST) {
      console.warn('[VGS] Tokenization disabled - returning passthrough values');
      const response: TokenizeResponse = {};
      
      if (email) {
        response.email_alias = `passthrough:${btoa(email)}`;
      }
      if (phone) {
        response.phone_alias = `passthrough:${btoa(phone)}`;
      }

      return new Response(
        JSON.stringify(response),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use VGS Aliases API directly for tokenization
    // Environment-aware: sandbox for dev, live for production
    const vgsEnv = Deno.env.get('VGS_ENVIRONMENT') || 'sandbox';
    const authHeader = `Basic ${btoa(`${VGS_USERNAME}:${VGS_PASSWORD}`)}`;
    const aliasesUrl = `https://api.${vgsEnv}.verygoodvault.com/aliases`;

    const response: TokenizeResponse = {};

    // Tokenize email
    if (email) {
      const emailRes = await fetch(aliasesUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
        },
        body: JSON.stringify({
          data: [{ value: email, format: 'UUID', storage: 'PERSISTENT' }],
        }),
      });

      if (!emailRes.ok) {
        const errorText = await emailRes.text();
        console.error('[VGS] Email tokenization failed:', emailRes.status, errorText);
        return new Response(
          JSON.stringify({ error: 'VGS email tokenization failed', details: errorText }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const emailResult = await emailRes.json();
      response.email_alias = emailResult.data?.[0]?.aliases?.[0]?.alias;
    }

    // Tokenize phone
    if (phone) {
      const phoneRes = await fetch(aliasesUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
        },
        body: JSON.stringify({
          data: [{ value: phone, format: 'UUID', storage: 'PERSISTENT' }],
        }),
      });

      if (!phoneRes.ok) {
        const errorText = await phoneRes.text();
        console.error('[VGS] Phone tokenization failed:', phoneRes.status, errorText);
        return new Response(
          JSON.stringify({ error: 'VGS phone tokenization failed', details: errorText }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const phoneResult = await phoneRes.json();
      response.phone_alias = phoneResult.data?.[0]?.aliases?.[0]?.alias;
    }

    console.log('[VGS] Tokenization successful:', { 
      email_tokenized: !!email, 
      phone_tokenized: !!phone 
    });

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[VGS] Tokenization error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal error during tokenization', message: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
