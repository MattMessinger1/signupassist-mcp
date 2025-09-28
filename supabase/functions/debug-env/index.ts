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
    // List ALL environment variables that might be relevant
    const envVars = {
      // Supabase URL variants
      SUPABASE_URL: Deno.env.get('SUPABASE_URL') ? 'SET' : 'MISSING',
      SB_URL: Deno.env.get('SB_URL') ? 'SET' : 'MISSING',
      
      // Service keys
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ? 'SET' : 'MISSING',
      SB_SERVICE_ROLE_KEY: Deno.env.get('SB_SERVICE_ROLE_KEY') ? 'SET' : 'MISSING',
      
      // Anon/Publishable keys
      SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY') ? 'SET' : 'MISSING',
      SUPABASE_PUBLISHABLE_KEY: Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ? 'SET' : 'MISSING',
      
      // Other keys we see in the project
      CRED_SEAL_KEY: Deno.env.get('CRED_SEAL_KEY') ? 'SET' : 'MISSING',
    }

    // Also show the actual first 10 characters of each key for verification
    const keyPreviews = {
      SUPABASE_URL: Deno.env.get('SUPABASE_URL')?.substring(0, 30) || 'MISSING',
      SB_URL: Deno.env.get('SB_URL')?.substring(0, 30) || 'MISSING',
      SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY')?.substring(0, 10) || 'MISSING',
      SUPABASE_PUBLISHABLE_KEY: Deno.env.get('SUPABASE_PUBLISHABLE_KEY')?.substring(0, 10) || 'MISSING',
      CRED_SEAL_KEY: Deno.env.get('CRED_SEAL_KEY') ? `${Deno.env.get('CRED_SEAL_KEY')!.substring(0, 5)}...` : 'MISSING',
    }

    return new Response(
      JSON.stringify({ 
        envVars, 
        keyPreviews,
        message: 'Environment variable diagnostic'
      }, null, 2),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: 'Diagnostic failed',
        details: error instanceof Error ? error.message : String(error)
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
