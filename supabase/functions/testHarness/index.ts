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
    const provider_id = body.provider_id || "skiclubpro";
    const org_ref = body.org_ref || "mock-org";

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

    console.log('[TestHarness] No credentials found, initiating login flow');

    // 2) Start audit trail
    const auditId = await startLoginAudit({
      provider: provider_id,
      org_ref,
      tool: 'testHarness',
      user_id,
      login_strategy: 'test_automated'
    });

    // 3) Check required environment variables
    const browserbaseApiKey = Deno.env.get('BROWSERBASE_API_KEY');
    const browserbaseProjectId = Deno.env.get('BROWSERBASE_PROJECT_ID');
    const mcpServerUrl = Deno.env.get('MCP_SERVER_URL');

    if (!browserbaseApiKey) {
      throw new Error('BROWSERBASE_API_KEY not configured');
    }
    if (!browserbaseProjectId) {
      throw new Error('BROWSERBASE_PROJECT_ID not configured');
    }
    if (!mcpServerUrl) {
      throw new Error('MCP_SERVER_URL not configured');
    }

    console.log('[TestHarness] Creating Browserbase session for mock provider login');

    // 4) Launch Browserbase session pointing at mock provider
    const sessionResponse = await fetch('https://www.browserbase.com/v1/sessions', {
      method: 'POST',
      headers: {
        'X-BB-API-Key': browserbaseApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectId: browserbaseProjectId,
        browserSettings: {
          fingerprint: {
            browsers: ['chrome'],
            operatingSystems: ['windows'],
            locales: ['en-US'],
          },
        },
      }),
    });

    if (!sessionResponse.ok) {
      const errorText = await sessionResponse.text();
      console.error('[TestHarness] Browserbase session creation failed:', errorText);
      throw new Error(`Failed to create Browserbase session: ${errorText}`);
    }

    const sessionData = await sessionResponse.json();
    console.log('[TestHarness] Browserbase session created:', sessionData.id);

    // 5) Call MCP server to perform the automated login
    // The MCP server has the Playwright/Browserbase integration
    console.log('[TestHarness] Calling MCP server to perform automated login');
    
    const mcpResponse = await fetch(`${mcpServerUrl}/tools/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tool: 'scp.login',
        args: {
          org_ref,
          email: 'parent@example.com',
          password: 'password123',
          user_id,
          session_id: sessionData.id,
          test_mode: true, // Flag to indicate test harness mode
          mock_provider_url: 'http://localhost:4321/user/login'
        }
      })
    });

    if (!mcpResponse.ok) {
      const errorText = await mcpResponse.text();
      console.error('[TestHarness] MCP login failed:', errorText);
      
      await finishLoginAudit({
        audit_id: auditId,
        result: 'failure',
        details: {
          error_type: 'mcp_error',
          error_message: errorText,
          authentication_status: 'failed'
        }
      });

      throw new Error(`MCP login failed: ${errorText}`);
    }

    const mcpResult = await mcpResponse.json();
    console.log('[TestHarness] MCP result:', JSON.stringify(mcpResult, null, 2));

    // 6) Check if 2FA is required
    if (mcpResult.requires_2fa || mcpResult.twoFactorRequired) {
      console.log('[TestHarness] 2FA required, simulating code entry');
      
      // In a real test, you'd automate the 2FA code entry
      // For now, return the status and session info
      return new Response(
        JSON.stringify({
          status: 'requires_2fa',
          message: '🔐 2FA challenge detected. Code: 654321',
          session_id: sessionData.id,
          browserbase_url: `https://www.browserbase.com/sessions/${sessionData.id}`,
          next_step: 'Automated 2FA handling would occur here'
        }),
        { 
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // 7) If login successful, store the credential
    if (mcpResult.success || mcpResult.logged_in) {
      console.log('[TestHarness] Login successful, storing test credentials');

      // Store mock encrypted credentials
      const mockEncrypted = btoa(JSON.stringify({
        email: 'parent@example.com',
        password: 'password123'
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

      // Finish audit trail
      await finishLoginAudit({
        audit_id: auditId,
        result: 'success',
        details: {
          authentication_status: 'success',
          authentication_message: 'Test harness login successful ✅',
          credential_stored: !storeError,
          test_mode: true,
          browserbase_session: sessionData.id
        }
      });

      return new Response(
        JSON.stringify({
          status: 'login_success',
          message: 'Login simulated and credential saved ✅',
          credential_id: storedCred?.id,
          browserbase_session: sessionData.id,
          browserbase_url: `https://www.browserbase.com/sessions/${sessionData.id}`,
          test_data: {
            email: 'parent@example.com',
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

    // 8) Login failed
    console.log('[TestHarness] Login failed');
    
    await finishLoginAudit({
      audit_id: auditId,
      result: 'failure',
      details: {
        error_type: 'login_failed',
        error_message: mcpResult.error || 'Invalid credentials',
        authentication_status: 'failed'
      }
    });

    return new Response(
      JSON.stringify({
        status: 'failure',
        message: 'Login attempt failed',
        error: mcpResult.error || 'Invalid credentials',
        browserbase_session: sessionData.id
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
