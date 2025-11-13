/**
 * Phase 3: Authenticated Cache Warming with System Mandate
 * 
 * This function uses the system mandate (SYSTEM_MANDATE_JWS) and system credentials
 * (SCP_SERVICE_CRED_ID) to perform authenticated cache warming operations.
 * 
 * It can:
 * - Log in to provider systems using system credentials
 * - Scrape program data while authenticated
 * - Access member-only information for better cache quality
 * - Create comprehensive audit trail of all operations
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-mandate-jws',
};

interface CacheWarmRequest {
  org_ref?: string;           // Optional: specific org to warm, or all if omitted
  category?: string;          // Optional: specific category, or 'all'
  force_refresh?: boolean;    // Force refresh even if cache is fresh
}

interface AuditMetadata {
  org_ref: string;
  category: string;
  programs_discovered?: number;
  fields_discovered?: number;
  cache_hit?: boolean;
  error?: string;
  duration_ms?: number;
}

// ============================================================================
// AUDIT LOGGING
// ============================================================================

async function logMandateAudit(
  supabase: any,
  action: string,
  orgRef: string,
  metadata: AuditMetadata
) {
  try {
    const { error } = await supabase.from('mandate_audit').insert({
      user_id: '00000000-0000-0000-0000-000000000000', // System user
      action,
      provider: 'skiclubpro',
      org_ref: orgRef,
      metadata
    });

    if (error) {
      console.error('[Audit] Failed to log mandate audit:', error);
    } else {
      console.log(`[Audit] Logged: ${action} for ${orgRef}`);
    }
  } catch (err) {
    console.error('[Audit] Exception logging audit:', err);
  }
}

// ============================================================================
// SYSTEM CREDENTIAL RETRIEVAL
// ============================================================================

async function getSystemCredentials(supabase: any): Promise<any> {
  const credentialId = Deno.env.get('SCP_SERVICE_CRED_ID');
  
  if (!credentialId) {
    throw new Error('SCP_SERVICE_CRED_ID not configured in environment');
  }

  console.log(`[Credentials] Fetching system credential: ${credentialId}`);

  const { data, error } = await supabase
    .from('stored_credentials')
    .select('*')
    .eq('id', credentialId)
    .single();

  if (error) {
    throw new Error(`Failed to fetch system credentials: ${error.message}`);
  }

  if (!data) {
    throw new Error(`System credential not found: ${credentialId}`);
  }

  return data;
}

// ============================================================================
// DECRYPT CREDENTIALS
// ============================================================================

async function decryptCredentials(encryptedData: string): Promise<{ email: string; password: string }> {
  const credSealKey = Deno.env.get('CRED_SEAL_KEY');
  
  if (!credSealKey) {
    throw new Error('CRED_SEAL_KEY not configured');
  }

  try {
    // Parse the encrypted data
    const parsed = JSON.parse(encryptedData);
    const { email_iv, email_data, password_iv, password_data } = parsed;

    // Import the key
    const keyData = Uint8Array.from(atob(credSealKey), c => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    // Decrypt email
    const emailDecrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: Uint8Array.from(atob(email_iv), c => c.charCodeAt(0))
      },
      cryptoKey,
      Uint8Array.from(atob(email_data), c => c.charCodeAt(0))
    );

    // Decrypt password
    const passwordDecrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: Uint8Array.from(atob(password_iv), c => c.charCodeAt(0))
      },
      cryptoKey,
      Uint8Array.from(atob(password_data), c => c.charCodeAt(0))
    );

    const decoder = new TextDecoder();
    return {
      email: decoder.decode(emailDecrypted),
      password: decoder.decode(passwordDecrypted)
    };
  } catch (error: any) {
    throw new Error(`Failed to decrypt credentials: ${error.message}`);
  }
}

// ============================================================================
// AUTHENTICATED CACHE WARMING
// ============================================================================

async function warmCacheForOrg(
  supabase: any,
  orgRef: string,
  category: string,
  credentials: { email: string; password: string },
  mandate: string
): Promise<void> {
  const startTime = Date.now();
  
  console.log(`[CacheWarm] Starting authenticated cache warm for ${orgRef}:${category}`);
  
  await logMandateAudit(supabase, 'cache_warm_start', orgRef, {
    org_ref: orgRef,
    category
  });

  try {
    // Call the MCP server's find_programs tool with authentication
    const mcpServerUrl = Deno.env.get('MCP_SERVER_URL');
    const mcpAccessToken = Deno.env.get('MCP_ACCESS_TOKEN');

    if (!mcpServerUrl || !mcpAccessToken) {
      throw new Error('MCP server configuration missing');
    }

    const response = await fetch(`${mcpServerUrl}/tools/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mcpAccessToken}`,
        'X-Mandate-JWS': mandate
      },
      body: JSON.stringify({
        name: 'scp_find_programs',
        arguments: {
          org_ref: orgRef,
          category,
          use_cache: false, // Force fresh scraping
          email: credentials.email,
          password: credentials.password
        }
      })
    });

    if (!response.ok) {
      throw new Error(`MCP server returned ${response.status}: ${await response.text()}`);
    }

    const result = await response.json();
    
    if (result.isError) {
      throw new Error(`MCP tool error: ${result.content?.[0]?.text || 'Unknown error'}`);
    }

    const programsData = result.content?.[0]?.text;
    const programsCount = programsData ? JSON.parse(programsData).length : 0;

    const duration = Date.now() - startTime;

    console.log(`[CacheWarm] ✅ Completed for ${orgRef}:${category} - ${programsCount} programs (${duration}ms)`);

    await logMandateAudit(supabase, 'cache_warm_success', orgRef, {
      org_ref: orgRef,
      category,
      programs_discovered: programsCount,
      duration_ms: duration
    });

  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    console.error(`[CacheWarm] ❌ Failed for ${orgRef}:${category}:`, error.message);

    await logMandateAudit(supabase, 'cache_warm_failed', orgRef, {
      org_ref: orgRef,
      category,
      error: error.message,
      duration_ms: duration
    });

    throw error;
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[warm-cache-authenticated] 🚀 Starting authenticated cache warming...');

    // Initialize Supabase
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get request body
    const body: CacheWarmRequest = await req.json().catch(() => ({}));
    const { org_ref, category = 'all', force_refresh = false } = body;

    // Verify SYSTEM_MANDATE_JWS is available
    const systemMandate = Deno.env.get('SYSTEM_MANDATE_JWS');
    if (!systemMandate) {
      throw new Error('SYSTEM_MANDATE_JWS not configured. Run setup first.');
    }

    console.log('[warm-cache-authenticated] ✅ System mandate verified');

    // Get system credentials
    const credentialRecord = await getSystemCredentials(supabase);
    const credentials = await decryptCredentials(credentialRecord.encrypted_data);
    
    console.log(`[warm-cache-authenticated] ✅ System credentials retrieved for ${credentials.email.substring(0, 3)}***`);

    // Determine which orgs/categories to warm
    const orgsToWarm: Array<{ org_ref: string; categories: string[] }> = [];

    if (org_ref) {
      // Warm specific org
      orgsToWarm.push({
        org_ref,
        categories: [category]
      });
    } else {
      // Warm all configured orgs (default: blackhawk-ski-club)
      orgsToWarm.push({
        org_ref: 'blackhawk-ski-club',
        categories: ['all', 'lessons', 'teams', 'races']
      });
    }

    // Warm cache for each org/category
    const results: Array<{ org_ref: string; category: string; status: string; error?: string }> = [];

    for (const org of orgsToWarm) {
      for (const cat of org.categories) {
        try {
          await warmCacheForOrg(supabase, org.org_ref, cat, credentials, systemMandate);
          results.push({
            org_ref: org.org_ref,
            category: cat,
            status: 'success'
          });
        } catch (error: any) {
          results.push({
            org_ref: org.org_ref,
            category: cat,
            status: 'failed',
            error: error.message
          });
        }
      }
    }

    const successCount = results.filter(r => r.status === 'success').length;
    const failCount = results.filter(r => r.status === 'failed').length;

    console.log(`[warm-cache-authenticated] ✅ Cache warming complete: ${successCount} success, ${failCount} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        summary: {
          total: results.length,
          success: successCount,
          failed: failCount
        },
        results
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error: any) {
    console.error('[warm-cache-authenticated] 💥 Fatal error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
