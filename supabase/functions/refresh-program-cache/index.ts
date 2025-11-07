import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper: Generate deep links for a program
function generateDeepLinks(orgRef: string, programRef: string): Record<string, string> {
  const baseUrl = `https://${orgRef}.skiclubpro.team`;
  const registrationUrl = `${baseUrl}/registration/${programRef}/start`;
  const accountUrl = `${baseUrl}/user/register`;
  const detailsUrl = `${baseUrl}/programs/${programRef}`;
  
  return {
    registration_start: `${registrationUrl}?ref=signupassist&utm_source=chatgpt_app`,
    account_creation: `${accountUrl}?ref=signupassist&prefill=guardian`,
    program_details: `${detailsUrl}?ref=signupassist`
  };
}

// Helper: Transform discovered prerequisite fields to schema format
function transformPrereqFields(discoveredSchema: any): Record<string, any> {
  if (!discoveredSchema?.fields) return {};
  
  const prereqs: Record<string, any> = {};
  
  for (const field of discoveredSchema.fields) {
    const fieldKey = field.name || field.id || field.label?.toLowerCase().replace(/\s+/g, '_');
    if (!fieldKey) continue;
    
    // Detect prerequisite type from field characteristics
    if (field.type === 'checkbox' && (field.label?.toLowerCase().includes('waiver') || field.label?.toLowerCase().includes('agree'))) {
      prereqs.waiver = {
        key: fieldKey,
        label: field.label || 'Waiver acceptance',
        type: 'checkbox',
        required: field.required || true
      };
    } else if (field.label?.toLowerCase().includes('membership')) {
      prereqs.membership = {
        key: fieldKey,
        label: field.label || 'Membership',
        type: field.type || 'select',
        required: field.required || false,
        options: field.options || []
      };
    } else if (field.label?.toLowerCase().includes('rental')) {
      prereqs.rental = {
        key: fieldKey,
        label: field.label || 'Equipment rental',
        type: field.type || 'select',
        required: field.required || false,
        options: field.options || ['Yes', 'No']
      };
    }
  }
  
  return prereqs;
}

// Helper: Transform discovered question fields to schema format
function transformQuestionFields(discoveredSchema: any): Record<string, any> {
  if (!discoveredSchema?.fields) return { fields: [] };
  
  const fields = discoveredSchema.fields.map((field: any) => ({
    key: field.name || field.id || field.label?.toLowerCase().replace(/\s+/g, '_') || 'unknown',
    label: field.label || field.name || 'Unknown field',
    type: field.type || 'text',
    required: field.required || false,
    options: field.options || undefined,
    placeholder: field.placeholder || undefined
  }));
  
  return { fields };
}

interface OrgConfig {
  orgRef: string;
  categories: string[];
  priority: 'high' | 'normal' | 'low';
}

// Organizations to scrape (ordered by priority)
const ORGS_TO_SCRAPE: OrgConfig[] = [
  { orgRef: 'blackhawk-ski-club', categories: ['all', 'lessons', 'teams'], priority: 'high' },
  // Add more organizations as needed
];

interface ScrapeResult {
  orgRef: string;
  category: string;
  success: boolean;
  programCount: number;
  themes: string[];
  error?: string;
  durationMs: number;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('[refresh-program-cache] Starting nightly cache refresh...');
  
  // Initialize Supabase client with service role for RPC access
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const results: ScrapeResult[] = [];
  let totalSuccesses = 0;
  let totalFailures = 0;

  // Get a valid credential for skiclubpro provider and decrypt it
  console.log('[refresh-program-cache] Looking up stored credentials...');
  const { data: credentials, error: credError } = await supabase
    .from('stored_credentials')
    .select('id, encrypted_data')
    .eq('provider', 'skiclubpro')
    .limit(1);

  if (credError || !credentials || credentials.length === 0) {
    const error = 'No stored credentials found for skiclubpro provider';
    console.error(`[refresh-program-cache] ${error}`);
    return new Response(JSON.stringify({ error }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const credentialId = credentials[0].id;
  const encryptedData = credentials[0].encrypted_data;
  
  // Decrypt the credential directly (service role context)
  console.log(`[refresh-program-cache] Decrypting credential: ${credentialId}`);
  
  const sealKey = Deno.env.get('CRED_SEAL_KEY');
  if (!sealKey) {
    console.error('[refresh-program-cache] Missing CRED_SEAL_KEY');
    return new Response(JSON.stringify({ error: 'Missing CRED_SEAL_KEY' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  let decryptedCreds: { email: string; password: string };
  
  try {
    const [encryptedBase64, ivBase64] = encryptedData.split(':');
    
    // Convert base64 back to binary
    const encryptedBytes = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
    const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));
    
    // Import the key
    const keyData = Uint8Array.from(atob(sealKey), c => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      encryptedBytes
    );

    const decoder = new TextDecoder();
    decryptedCreds = JSON.parse(decoder.decode(decrypted));
    
    console.log(`[refresh-program-cache] Credential decrypted successfully (email: ${decryptedCreds.email?.substring(0, 3)}***)`);
  } catch (decryptError) {
    console.error(`[refresh-program-cache] Failed to decrypt credential:`, decryptError);
    return new Response(JSON.stringify({ error: 'Failed to decrypt credential' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Get development mandate if available
  const devMandateJws = Deno.env.get('DEV_MANDATE_JWS');

  // Scrape each organization and category using Supabase edge function invocation
  for (const org of ORGS_TO_SCRAPE) {
    for (const category of org.categories) {
      const startTime = Date.now();
      console.log(`[refresh-program-cache] Scraping ${org.orgRef}:${category}...`);

      try {
        // Call MCP server directly to find programs
        const { invokeMCPToolDirect } = await import('../_shared/mcpClient.ts');
        
        const mcpResult = await invokeMCPToolDirect('scp.find_programs', {
          org_ref: org.orgRef,
          category: category,
          email: decryptedCreds.email,
          password: decryptedCreds.password,
          user_id: 'system',
          force_login: true
        });

        console.log(`[refresh-program-cache] MCP result for ${org.orgRef}:${category}:`, JSON.stringify(mcpResult, null, 2));

        // Check for MCP errors
        if (!mcpResult.success || mcpResult.error) {
          throw new Error(`MCP server error: ${mcpResult.error || 'Unknown error'}`);
        }

        if (!mcpResult.programs_by_theme) {
          throw new Error(`No programs_by_theme in response`);
        }

        const programsByTheme = mcpResult.programs_by_theme;
        const themes = Object.keys(programsByTheme);
        const programCount = Object.values(programsByTheme).flat().length;

        console.log(`[refresh-program-cache] Scraped ${programCount} programs in ${themes.length} themes`);

        // Discover real form fields for each program
        const prerequisitesSchema: Record<string, any> = {};
        const questionsSchema: Record<string, any> = {};
        const deepLinksSchema: Record<string, any> = {};

        for (const [theme, programs] of Object.entries(programsByTheme) as [string, any[]][]) {
          for (const program of programs) {
            const programRef = program.program_ref || program.id;
            if (!programRef) continue;

            console.log(`[refresh-program-cache] Discovering fields for ${programRef}...`);

            try {
              // Discover prerequisites
              const prereqResult = await invokeMCPToolDirect('scp.discover_required_fields', {
                org_ref: org.orgRef,
                program_ref: programRef,
                stage: 'prereq',
                email: decryptedCreds.email,
                password: decryptedCreds.password,
                user_id: 'system',
                mode: 'prerequisites_only'
              });

              if (prereqResult.success && prereqResult.schema) {
                prerequisitesSchema[programRef] = transformPrereqFields(prereqResult.schema);
                console.log(`[refresh-program-cache] ✓ Prerequisites discovered for ${programRef}`);
              }

              // Discover program questions
              const questionResult = await invokeMCPToolDirect('scp.discover_required_fields', {
                org_ref: org.orgRef,
                program_ref: programRef,
                stage: 'program',
                email: decryptedCreds.email,
                password: decryptedCreds.password,
                user_id: 'system',
                mode: 'full'
              });

              if (questionResult.success && questionResult.schema) {
                questionsSchema[programRef] = transformQuestionFields(questionResult.schema);
                console.log(`[refresh-program-cache] ✓ Questions discovered for ${programRef}`);
              }

              // Generate deep links
              deepLinksSchema[programRef] = generateDeepLinks(org.orgRef, programRef);

            } catch (fieldError: any) {
              console.error(`[refresh-program-cache] ⚠️ Failed to discover fields for ${programRef}:`, fieldError.message);
              // Continue with other programs even if one fails
            }

            // Small delay to avoid overwhelming the provider
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }

        console.log(`[refresh-program-cache] Field discovery complete: ${Object.keys(prerequisitesSchema).length}/${programCount} programs`);

        // Store in database cache via enhanced RPC
        const { data: cacheId, error: cacheError } = await supabase.rpc('upsert_cached_programs_enhanced', {
          p_org_ref: org.orgRef,
          p_category: category,
          p_programs_by_theme: programsByTheme,
          p_prerequisites_schema: prerequisitesSchema,
          p_questions_schema: questionsSchema,
          p_deep_links: deepLinksSchema,
          p_metadata: {
            scrape_type: 'real_scraper',
            source: 'nightly_scraper',
            program_count: programCount,
            fields_scraped: Object.keys(prerequisitesSchema).length,
            themes: themes,
            scraped_at: new Date().toISOString(),
            priority: org.priority
          },
          p_ttl_hours: 24 // 24-hour cache TTL
        });

        if (cacheError) {
          throw new Error(`Cache upsert failed: ${cacheError.message}`);
        }

        const durationMs = Date.now() - startTime;
        
        results.push({
          orgRef: org.orgRef,
          category,
          success: true,
          programCount,
          themes,
          durationMs
        });

        totalSuccesses++;
        
        console.log(`[refresh-program-cache] ✅ Cached ${org.orgRef}:${category} (${programCount} programs, ${durationMs}ms, cache_id: ${cacheId})`);

        // Small delay between scrapes to avoid overwhelming the provider
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error: any) {
        const durationMs = Date.now() - startTime;
        
        results.push({
          orgRef: org.orgRef,
          category,
          success: false,
          programCount: 0,
          themes: [],
          error: error.message,
          durationMs
        });

        totalFailures++;
        
        console.error(`[refresh-program-cache] ❌ Failed ${org.orgRef}:${category}: ${error.message}`);
      }
    }
  }

  // Calculate summary statistics
  const totalDurationMs = results.reduce((sum, r) => sum + r.durationMs, 0);
  const totalPrograms = results.reduce((sum, r) => sum + r.programCount, 0);
  const avgDurationMs = totalDurationMs / results.length;

  const summary = {
    timestamp: new Date().toISOString(),
    totalOrgs: ORGS_TO_SCRAPE.length,
    totalScrapesAttempted: results.length,
    totalSuccesses,
    totalFailures,
    totalPrograms,
    totalDurationMs,
    avgDurationMs: Math.round(avgDurationMs),
    results
  };

  console.log(`[refresh-program-cache] 🏁 Complete: ${totalSuccesses}/${results.length} successful, ${totalPrograms} programs cached`);

  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
});
