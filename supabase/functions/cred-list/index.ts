import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
    if (!sbUrl) {
      return new Response(
        JSON.stringify({ error: 'Missing SB_URL' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const sbServiceKey = Deno.env.get('SB_SERVICE_ROLE_KEY')
    if (!sbServiceKey) {
      return new Response(
        JSON.stringify({ error: 'Missing SB_SERVICE_ROLE_KEY' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get the Authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      console.error('No Authorization header provided')
      return new Response(
        JSON.stringify({ error: 'Unauthorized - No auth header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Auth header present:', authHeader.substring(0, 20) + '...')

    const supabaseClient = createClient(
      sbUrl,
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    )

    // Get current user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    
    if (userError) {
      console.error('Error getting user:', userError.message)
      console.error('Error details:', JSON.stringify(userError, null, 2))
      return new Response(
        JSON.stringify({ 
          error: 'Session expired or invalid. Please log in again.',
          details: userError.message 
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    if (!user) {
      console.error('No user found in token')
      return new Response(
        JSON.stringify({ error: 'No user found. Please log in again.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('User authenticated:', user.id)

    // Use service role client for database operations
    const supabase = createClient(sbUrl, sbServiceKey)

    try {
      const { data, error } = await supabase
        .from('stored_credentials')
        .select('id, alias, provider, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (error) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ credentials: data || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err instanceof Error ? err.message : 'Database error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

  } catch (error) {
    console.error('Error in cred-list function:', error)
    console.error('Error details:', JSON.stringify(error, null, 2))
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        details: error instanceof Error ? error.stack : String(error)
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})