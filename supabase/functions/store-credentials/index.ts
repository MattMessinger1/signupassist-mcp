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
    const sealKey = Deno.env.get('CRED_SEAL_KEY')
    if (!sealKey) {
      return new Response(
        JSON.stringify({ error: 'Missing CRED_SEAL_KEY' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    // Get current user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const body = await req.json()
    
    // Validate payload
    const { alias, provider_slug, email, password } = body
    if (!alias) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: alias' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (!provider_slug) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: provider_slug' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (!email) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: email' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (!password) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: password' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Simple encryption using Web Crypto API
    const encoder = new TextEncoder()
    
    // Import the base64 key
    const keyData = Uint8Array.from(atob(sealKey), c => c.charCodeAt(0))
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    )

    // Encrypt the credentials
    const credentials = JSON.stringify({ email, password })
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      encoder.encode(credentials)
    )

    // Properly encode binary data as base64
    const encryptedArray = new Uint8Array(encrypted)
    const encryptedBase64 = btoa(String.fromCharCode(...encryptedArray))
    const ivBase64 = btoa(String.fromCharCode(...iv))
    const ciphertext = encryptedBase64 + ':' + ivBase64

    const supabase = createClient(
      Deno.env.get("SB_URL")!,
      Deno.env.get("SB_SERVICE_ROLE_KEY")!
    )

    const row = {
      alias,
      provider: provider_slug,
      user_id: user.id,
      encrypted_data: ciphertext,
    }

    try {
      const { data, error } = await supabase
        .from('stored_credentials')
        .insert(row)
        .select('id, alias, provider')
        .single()

      if (error) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ id: data.id, alias: data.alias, provider: data.provider }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err instanceof Error ? err.message : 'Database error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})