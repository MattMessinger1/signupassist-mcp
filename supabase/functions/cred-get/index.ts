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

    const sealKey = Deno.env.get('CRED_SEAL_KEY')
    if (!sealKey) {
      return new Response(
        JSON.stringify({ error: 'Missing CRED_SEAL_KEY' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseClient = createClient(
      sbUrl,
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
    const { id } = body

    if (!id) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Use service role client for database operations
    const supabase = createClient(sbUrl, sbServiceKey)

    try {
      const { data, error } = await supabase
        .from('stored_credentials')
        .select('id, alias, provider, encrypted_data')
        .eq('id', id)
        .eq('user_id', user.id)
        .single()

      if (error) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (!data) {
        return new Response(
          JSON.stringify({ error: 'Credential not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // PHASE 4: Log credential access to audit trail
      try {
        await supabase
          .from('mandate_audit')
          .insert({
            user_id: user.id,
            action: 'credentials_accessed',
            provider: data.provider,
            credential_id: data.id,
            metadata: { 
              accessed_at: new Date().toISOString(),
              credential_alias: data.alias
            }
          });
      } catch (auditError) {
        console.error('Failed to log credential access:', auditError);
        // Don't fail the request if audit logging fails
      }

      // Decrypt the credentials
      try {
        const [encryptedBase64, ivBase64] = data.encrypted_data.split(':')
        
        // Convert base64 back to binary
        const encryptedData = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0))
        const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0))
        
        // Import the key
        const keyData = Uint8Array.from(atob(sealKey), c => c.charCodeAt(0))
        const cryptoKey = await crypto.subtle.importKey(
          'raw',
          keyData,
          { name: 'AES-GCM' },
          false,
          ['decrypt']
        )

        // Decrypt
        const decrypted = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv },
          cryptoKey,
          encryptedData
        )

        const decoder = new TextDecoder()
        const credentials = JSON.parse(decoder.decode(decrypted))

        return new Response(
          JSON.stringify({
            id: data.id,
            alias: data.alias,
            provider: data.provider,
            email: credentials.email,
            password: credentials.password
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      } catch (decryptError) {
        console.error('Decryption error:', decryptError)
        return new Response(
          JSON.stringify({ error: 'Failed to decrypt credentials' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err instanceof Error ? err.message : 'Database error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

  } catch (error) {
    console.error('Error in cred-get function:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})