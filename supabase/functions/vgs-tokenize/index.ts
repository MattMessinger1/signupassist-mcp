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

    // Build VGS tokenization request
    const dataToTokenize = [];
    if (email) {
      dataToTokenize.push({ value: email, format: 'UUID', storage: 'PERSISTENT' });
    }
    if (phone) {
      dataToTokenize.push({ value: phone, format: 'UUID', storage: 'PERSISTENT' });
    }

    const authHeader = `Basic ${btoa(`${VGS_USERNAME}:${VGS_PASSWORD}`)}`;

    const vgsResponse = await fetch(`${VGS_PROXY_HOST}/post`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify({ data: dataToTokenize }),
    });

    if (!vgsResponse.ok) {
      const errorText = await vgsResponse.text();
      console.error('[VGS] Tokenization failed:', vgsResponse.status, errorText);
      return new Response(
        JSON.stringify({ error: 'VGS tokenization failed', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const vgsResult = await vgsResponse.json();
    
    // Map VGS response to our format
    const response: TokenizeResponse = {};
    let index = 0;
    
    if (email && vgsResult.data?.[index]) {
      response.email_alias = vgsResult.data[index].aliases?.[0]?.alias || vgsResult.data[index].value;
      index++;
    }
    if (phone && vgsResult.data?.[index]) {
      response.phone_alias = vgsResult.data[index].aliases?.[0]?.alias || vgsResult.data[index].value;
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
