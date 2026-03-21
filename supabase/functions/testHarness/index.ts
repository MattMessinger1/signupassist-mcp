import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.74.0';
import { startLoginAudit, finishLoginAudit } from '../_shared/auditLogin.ts';
import { v4 as uuidv4 } from 'https://esm.sh/uuid@9.0.0';

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
    console.log('[TestHarness] Starting test harness execution');
    
    const body = await req.json();
    const user_id = body.user_id || uuidv4();
    const provider_id = body.provider_id || "bookeo";
    const org_ref = body.org_ref || "aim-design";

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    console.log('[TestHarness] Environment check:', {
      hasUrl: !!supabaseUrl,
      hasServiceRole: !!supabaseServiceRole,
      userIdType: typeof user_id,
      userId: user_id
    });
    
    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL not configured');
    }
    if (!supabaseServiceRole) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY secret not configured');
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceRole);

    console.log(`[TestHarness] Checking credentials for user: ${user_id}, provider: ${provider_id}`);

    // 1) Check for existing stored credentials using Supabase client
    const { data: existingCreds, error: credError } = await supabase
      .from('stored_credentials')
      .select('*')
      .eq('user_id', user_id)
      .eq('provider', provider_id);

    if (credError) {
      console.error('[TestHarness] Error checking credentials:', credError);
      throw new Error(`Failed to check credentials: ${credError.message}`);
    }

    if (existingCreds && existingCreds.length > 0) {
      console.log('[TestHarness] Credentials already exist');
      return new Response(
        JSON.stringify({
          status: 'connected',
          message: `✅ You're already connected to ${provider_id}!`,
          credential_id: existingCreds[0].id
        }),
        { 
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('[TestHarness] No credentials found, running Bookeo API smoke check');

    // 2) Start audit trail
    const auditId = await startLoginAudit({
      provider: provider_id,
      org_ref,
      tool: 'testHarness',
      user_id,
      login_strategy: 'test_api'
    });

    const mcpServerUrl = Deno.env.get('MCP_SERVER_URL');
    const mcpAccessToken = Deno.env.get('MCP_ACCESS_TOKEN');

    if (!mcpServerUrl) {
      throw new Error('MCP_SERVER_URL not configured');
    }

    console.log('[TestHarness] Calling bookeo.test_connection via MCP');

    const mcpResponse = await fetch(`${mcpServerUrl}/tools/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mcpAccessToken?.trim() ?? ''}`
      },
      body: JSON.stringify({
        tool: 'bookeo.test_connection',
        args: {}
      })
    });

    if (!mcpResponse.ok) {
      const errorText = await mcpResponse.text();
      console.error('[TestHarness] MCP test_connection failed:', errorText);
      
      await finishLoginAudit({
        audit_id: auditId,
        result: 'failure',
        details: {
          error_type: 'mcp_error',
          error_message: errorText,
          authentication_status: 'failed'
        }
      });

      throw new Error(`MCP test_connection failed: ${errorText}`);
    }

    const mcpResult = await mcpResponse.json();
    console.log('[TestHarness] MCP result:', JSON.stringify(mcpResult, null, 2));

    if (mcpResult?.success === true || mcpResult?.data?.success === true) {
      console.log('[TestHarness] API check OK, storing test credential record');

      const mockEncrypted = btoa(JSON.stringify({
        provider: 'bookeo',
        note: 'test_harness_placeholder'
      }));

      const { data: storedCred, error: storeError } = await supabase
        .from('stored_credentials')
        .insert({
          user_id,
          provider: provider_id,
          alias: `${org_ref}-test-account`,
          encrypted_data: mockEncrypted
        })
        .select()
        .single();

      if (storeError) {
        console.error('[TestHarness] Failed to store credentials:', storeError);
      } else {
        console.log('[TestHarness] Credentials stored successfully:', storedCred.id);
      }

      await finishLoginAudit({
        audit_id: auditId,
        result: 'success',
        details: {
          authentication_status: 'success',
          authentication_message: 'Test harness Bookeo API check successful ✅',
          credential_stored: !storeError,
          test_mode: true,
        }
      });

      return new Response(
        JSON.stringify({
          status: 'login_success',
          message: 'Bookeo API reachable and test credential saved ✅',
          credential_id: storedCred?.id,
          test_data: {
            provider: provider_id,
            org_ref
          }
        }),
        { 
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('[TestHarness] API check did not report success');
    
    await finishLoginAudit({
      audit_id: auditId,
      result: 'failure',
      details: {
        error_type: 'api_check_failed',
        error_message: mcpResult?.message || 'Bookeo API check failed',
        authentication_status: 'failed'
      }
    });

    return new Response(
      JSON.stringify({
        status: 'failure',
        message: 'Bookeo API check failed',
        error: mcpResult?.message || 'Unknown error',
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('[TestHarness] Error:', error);
    
    return new Response(
      JSON.stringify({ 
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Test harness encountered an error'
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
