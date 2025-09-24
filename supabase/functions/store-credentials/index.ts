import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { z } from "https://deno.land/x/zod@v3.16.1/mod.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const requestSchema = z.object({
  alias: z.string().min(1).max(100),
  provider: z.literal('skiclubpro'),
  email: z.string().email(),
  password: z.string().min(1),
})

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
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
    const { alias, provider, email, password } = requestSchema.parse(body)

    // Get encryption key from secrets
    const sealKey = Deno.env.get('CRED_SEAL_KEY')
    if (!sealKey) {
      throw new Error('CRED_SEAL_KEY not configured')
    }

    // Simple encryption using Web Crypto API (more secure than the basic example)
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    
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
    const encryptedData = encryptedBase64 + ':' + ivBase64

    // Store in database using service role
    const supabaseService = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data, error } = await supabaseService
      .from('stored_credentials')
      .insert({
        alias,
        provider,
        user_id: user.id,
        encrypted_data: encryptedData,
      })
      .select('id, alias')
      .single()

    if (error) {
      console.error('Database error:', error)
      return new Response(
        JSON.stringify({ error: 'Failed to store credentials' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ id: data.id, alias: data.alias }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})