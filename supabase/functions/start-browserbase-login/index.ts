import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.74.0';
import { startLoginAudit, finishLoginAudit } from '../_shared/auditLogin.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Map provider slugs to their MCP tool prefixes
const PROVIDER_PREFIX_MAP: Record<string, string> = {
  'skiclubpro': 'scp',
  'campminder': 'cm',
  'daysmart': 'ds',
};

function getToolName(provider: string, toolName: string): string {
  const prefix = PROVIDER_PREFIX_MAP[provider] || provider;
  return `${prefix}.${toolName}`;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { provider, org_ref, email, password, mandate_id } = await req.json();

    if (!provider || !org_ref || !email || !password) {
      throw new Error('Missing required parameters: provider, org_ref, email, password');
    }

    if (!mandate_id) {
      throw new Error('Missing mandate_id - user must authorize access first');
    }

    console.log(`[BrowserbaseLogin] Starting login for ${email} at ${org_ref}`);

    // Start audit trail
    const auditId = await startLoginAudit({
      provider,
      org_ref,
      tool: 'start-browserbase-login',
      user_id: user.id,
      login_strategy: 'fresh'
    });

    // Call MCP server to initiate browserbase login
    const mcpServerUrl = Deno.env.get('MCP_SERVER_URL');
    if (!mcpServerUrl) {
      throw new Error('MCP_SERVER_URL not configured');
    }

    const mcpAccessToken = Deno.env.get('MCP_ACCESS_TOKEN');
    if (!mcpAccessToken) {
      throw new Error('MCP_ACCESS_TOKEN not configured');
    }

    // Check for existing credential using the actual unique constraint
    const { data: existingCred } = await supabase
      .from('stored_credentials')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', provider)
      .maybeSingle();

    console.log(`[BrowserbaseLogin] Existing credential lookup: ${existingCred ? existingCred.id : 'none'}`);

    // Invoke provider's login through the MCP server (dynamic tool name)
    const mcpResponse = await fetch(`${mcpServerUrl}/tools/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mcpAccessToken}`, // Use MCP access token, not user JWT
      },
      body: JSON.stringify({
        tool: getToolName(provider, 'login'),
        args: {
          ...(existingCred?.id ? { credential_id: existingCred.id } : { email, password }), // Use stored credential_id OR email+password
          org_ref,
          user_jwt: token, // Pass user JWT for authentication
          user_id: user.id,
          mandate_jws: mandate_id, // ✅ Rename to mandate_jws for MCP verification
          return_session_data: true
        }
      })
    });

    if (!mcpResponse.ok) {
      const errorText = await mcpResponse.text();
      console.error('[BrowserbaseLogin] MCP error:', errorText);
      
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
    console.log('[BrowserbaseLogin] MCP result:', JSON.stringify(mcpResult, null, 2));

    // Check for 2FA requirement
    const requires2FA = mcpResult.requires_2fa || mcpResult.twoFactorRequired;
    
    if (requires2FA) {
      // Return 2FA challenge to user
      return new Response(
        JSON.stringify({
          status: 'requires_2fa',
          message: '🔐 It looks like your provider sent a verification code. Please enter that code on the provider site to continue.',
          session_id: mcpResult.session_id,
          browserbase_url: mcpResult.browserbase_url
        }),
        { 
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Check login success
    if (mcpResult.success || mcpResult.logged_in) {
      let credentialId = existingCred?.id;
      
      // Only store credentials if they don't already exist
      if (!existingCred && email && password) {
        const { data: storeResult, error: storeError } = await supabase.functions.invoke('store-credentials', {
          body: {
            alias: `${org_ref}-account`,
            provider: provider,
            email,
            password,
            user_id: user.id
          }
        });

        if (storeError) {
          console.error('[BrowserbaseLogin] Failed to store credentials:', storeError);
        } else {
          console.log('[BrowserbaseLogin] Credentials stored successfully');
          credentialId = storeResult?.credential_id;
        }
      }

      // Log mandate/authorization event
      console.log(`[BrowserbaseLogin] Logged authorization for user ${user.id} with provider ${provider}`);

      await finishLoginAudit({
        audit_id: auditId,
        result: 'success',
        details: {
          authentication_status: 'success',
          authentication_message: 'Login successful ✅',
          credential_stored: !!credentialId,
          credential_id: credentialId,
          session_token: mcpResult.session_token
        }
      });

      // AUTO-CONTINUE: Call provider's find_programs with the session token
      if (mcpResult.session_token) {
        console.log('[BrowserbaseLogin] Auto-continuing to program discovery...');
        
        const findProgramsTool = getToolName(provider, 'find_programs');
        
        console.log('[EdgeFunction] Preparing to call find_programs with:', {
          org_ref,
          credential_id: credentialId,
          session_token: mcpResult.session_token,
          user_jwt: token ? 'present' : 'missing',
          mandate_id
        });
        
        const programsResponse = await fetch(`${mcpServerUrl}/tools/call`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${mcpAccessToken}`,
          },
          body: JSON.stringify({
            tool: findProgramsTool,
            args: {
              org_ref,
              session_token: mcpResult.session_token,
              credential_id: credentialId,
              user_jwt: token,
              mandate_jws: mandate_id // ✅ Rename to mandate_jws for MCP verification
            }
          })
        });
        
        console.log('[EdgeFunction] Received programsResponse status:', programsResponse.status);
        
        if (!programsResponse.ok) {
          console.error('[BrowserbaseLogin] Failed to fetch programs:', await programsResponse.text());
          // Fall back to success-but-no-programs response
          return new Response(
            JSON.stringify({
              status: 'success',
              message: 'Login successful ✅',
              credential_stored: !!credentialId,
              credential_id: credentialId,
              cookies: mcpResult.cookies || [],
              next_step: 'manual_program_selection'
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        const programsResult = await programsResponse.json();
        console.log('[BrowserbaseLogin] Programs fetched:', programsResult);
        
        // Return login success + programs in one response
        return new Response(
          JSON.stringify({
            status: 'success',
            message: 'Login successful ✅',
            credential_stored: !!credentialId,
            credential_id: credentialId,
            programs: programsResult.data?.programs || [],
            session_token: mcpResult.session_token,
            cookies: mcpResult.cookies || [],  // Pass cookies from Session A
            next_step: 'program_selection'
          }),
          { 
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }

      // Fallback if no session_token (shouldn't happen)
      return new Response(
        JSON.stringify({
          status: 'success',
          message: 'Login successful ✅',
          credential_stored: !!credentialId,
          credential_id: credentialId,
          cookies: mcpResult.cookies || [],  // Pass cookies from Session A
          next_step: 'Session token missing - please try again'
        }),
        { 
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Login failed
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
        message: 'Hmm, it looks like that didn\'t go through. Please check your credentials and try again.',
        error: mcpResult.error || 'Invalid credentials'
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in start-browserbase-login function:', error);
    
    return new Response(
      JSON.stringify({ 
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Hmm, something unexpected happened. Let\'s try that again.'
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
