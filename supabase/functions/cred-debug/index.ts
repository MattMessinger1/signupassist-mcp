import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Check environment variables
    const sbUrl = Deno.env.get('SB_URL')
    const sbServiceKey = Deno.env.get('SB_SERVICE_ROLE_KEY')
    const sealKey = Deno.env.get('CRED_SEAL_KEY')

    // Check for missing variables
    if (!sbUrl) {
      return new Response(
        JSON.stringify({ error: 'Missing SB_URL' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!sbServiceKey) {
      return new Response(
        JSON.stringify({ error: 'Missing SB_SERVICE_ROLE_KEY' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!sealKey) {
      return new Response(
        JSON.stringify({ error: 'Missing CRED_SEAL_KEY' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Return masked values for security
    const response = {
      SB_URL: sbUrl.length > 60 ? sbUrl.substring(0, 60) + '...' : sbUrl,
      SB_SERVICE_ROLE_KEY: sbServiceKey.substring(0, 8) + '...',
      CRED_SEAL_KEY_present: true
    }

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in cred-debug function:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})