// Trigger rebuild: 2025-11-11 - Provider registry system
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { invokeMCPToolDirect } from '../_shared/mcpClient.ts';
import pLimit from 'npm:p-limit@5';
import { getAllActiveOrganizations, getOrganization } from '../_shared/organizations.ts';
import { getProvider } from '../_shared/providerRegistry.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper: Log audit entry for cache refresh operations
async function logAuditEntry(
  supabase: any,
  orgRef: string,
  category: string,
  status: 'success' | 'failed' | 'no_programs',
  metadata: Record<string, any> | null
) {
  try {
    await supabase.from('mandate_audit').insert({
      user_id: '00000000-0000-0000-0000-000000000000', // System user
      action: 'cache_refresh_scrape',
      org_ref: orgRef,
      provider: metadata?.provider || 'skiclubpro',
      metadata: {
        status,
        category,
        ...(metadata || {})
      }
    });
  } catch (error) {
    console.error('[refresh-program-cache] Failed to log audit entry:', error);
  }
}

// Helper: Generate deep links for a program (provider-aware)
function generateDeepLinks(provider: string, orgRef: string, programRef: string): Record<string, string> {
  const providerConfig = getProvider(provider);
  if (!providerConfig) {
    console.warn(`[generateDeepLinks] Unknown provider '${provider}', using fallback`);
    // Fallback for unknown providers
    const baseUrl = `https://${orgRef}.skiclubpro.team`;
    return {
      registration_start: `${baseUrl}/registration/${programRef}/start?ref=signupassist`,
      account_creation: `${baseUrl}/user/register?ref=signupassist`,
      program_details: `${baseUrl}/programs/${programRef}?ref=signupassist`
    };
  }
  
  return providerConfig.generateDeepLinks(orgRef, programRef);
}

// Helper: Transform prerequisite_checks to prerequisites_schema format
function transformPrereqChecks(prereqChecks: any[]): Record<string, any> {
  if (!prereqChecks || prereqChecks.length === 0) return {};
  
  const prereqs: Record<string, any> = {};
  
  for (const check of prereqChecks) {
    const key = check.key || check.id || check.label?.toLowerCase().replace(/\s+/g, '_');
    if (!key) continue;
    
    prereqs[key] = {
      key: check.key,
      label: check.label,
      type: check.type || 'checkbox',
      required: check.required !== undefined ? check.required : true,
      status: check.status,
      options: check.options
    };
  }
  
  return prereqs;
}

// Helper: Transform program_questions to questions_schema format
function transformProgramQuestions(programQuestions: any[]): Record<string, any> {
  if (!programQuestions || programQuestions.length === 0) return { fields: [] };
  
  const fields = programQuestions.map((question: any) => ({
    key: question.id || question.key || question.label?.toLowerCase().replace(/\s+/g, '_'),
    label: question.label || question.id || 'Unknown field',
    type: question.type || 'text',
    required: question.required || false,
    options: question.options,
    placeholder: question.placeholder,
    description: question.description
  }));
  
  return { fields };
}

// Helper: Determine theme from program title (provider-aware)
function determineTheme(provider: string, title: string): string {
  const providerConfig = getProvider(provider);
  if (!providerConfig) {
    console.warn(`[determineTheme] Unknown provider '${provider}', using fallback`);
    // Fallback theme detection
    const t = title.toLowerCase();
    if (t.includes('lesson') || t.includes('class')) return 'Lessons & Classes';
    if (t.includes('camp') || t.includes('clinic')) return 'Camps & Clinics';
    if (t.includes('race') || t.includes('team')) return 'Races & Teams';
    return 'All Programs';
  }
  
  return providerConfig.determineTheme(title);
}

// Helper: Validate program data completeness
function validateProgramData(program: any): string[] {
  const issues: string[] = [];
  
  if (!program.program_ref) issues.push('missing_program_ref');
  if (!program.title) issues.push('missing_title');
  if (!program.prerequisite_checks || program.prerequisite_checks.length === 0) {
    issues.push('no_prerequisites_found');
  }
  if (!program.program_questions || program.program_questions.length === 0) {
    issues.push('no_questions_found');
  }
  
  return issues;
}

// PHASE 1: Dynamic Program Discovery using Three Phase Extractor (Provider-aware)
async function discoverProgramsForCategory(
  provider: string,
  findProgramsTool: string,
  systemMandateJws: string,
  credentialId: string,
  orgRef: string,
  category: string
): Promise<Array<{ program_ref: string; title: string; category: string }>> {
  console.log(`[Phase 1] 🔍 Discovering programs for ${orgRef}:${category} (provider: ${provider})...`);
  
  try {
    const result = await invokeMCPToolDirect(
      findProgramsTool, // Use provider-specific tool
      {
        credential_id: credentialId,
        org_ref: orgRef,
        category: category,
        mandate_jws: systemMandateJws,
        skipCache: true // Force fresh scraping during nightly refresh
      },
      systemMandateJws
    );
    
    // PATCH #1: Enhanced debug logging for MCP tool results
    console.log(`\n[Phase 1][DEBUG] ────────────────`);
    console.log(`[Phase 1][DEBUG] Raw MCP result for ${orgRef}:${category}:`);
    console.log(JSON.stringify(result, null, 2));
    
    if (result?.debugNavigationSteps) {
      console.log(`[Phase 1][DEBUG] Navigation trace (${result.debugNavigationSteps.length} steps):`);
      result.debugNavigationSteps.forEach((s: any, i: number) =>
        console.log(`  ${i + 1}. ${s.url} → ${s.status}`)
      );
    }
    
    if (result?.pageUrl) {
      console.log(`[Phase 1][DEBUG] Final page URL: ${result.pageUrl}`);
    }
    if (result?.html) {
      console.log(`[Phase 1][DEBUG] HTML length: ${result.html.length}`);
    }
    if (result?.screenshots) {
      console.log(`[Phase 1][DEBUG] Screenshots captured: ${result.screenshots.length}`);
    }
    console.log(`[Phase 1][DEBUG] ────────────────\n`);
    
    // Legacy debug summary (keep for backward compatibility)
    console.log(`[Phase 1] Raw result for ${orgRef}:${category}:`, JSON.stringify({
      success: result.success,
      programCount: result.programs?.length || 0,
      error: result.error,
      hasPrograms: !!result.programs
    }));
    
    if (!result.success) {
      console.error(`[Phase 1] ❌ Tool failed for ${orgRef}:${category}:`, result.error || 'Unknown error');
      return [];
    }
    
    if (!result.programs || !Array.isArray(result.programs)) {
      console.error(`[Phase 1] ❌ Invalid response for ${orgRef}:${category} - programs is not an array:`, typeof result.programs);
      return [];
    }
    
    if (result.programs.length === 0) {
      console.warn(`[Phase 1] ⚠️ No programs found for ${orgRef}:${category} (valid response, but empty)`);
      return [];
    }
    
    const programs = result.programs.map((p: any) => ({
      program_ref: p.program_id || p.program_ref,
      title: p.title,
      category: category
    }));
    
    console.log(`[Phase 1] ✅ Found ${programs.length} programs for ${orgRef}:${category}`);
    return programs;
    
  } catch (error: any) {
    console.error(`[Phase 1] ❌ Exception for ${orgRef}:${category}:`, {
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 3).join('\n')
    });
    return []; // Defensive: don't crash entire refresh
  }
}

// PHASE 2: Field Discovery with Retry Logic (Provider-aware)
async function discoverFieldsForProgram(
  provider: string,
  discoverFieldsTool: string,
  systemMandateJws: string,
  credentialId: string,
  orgRef: string,
  programRef: string,
  category: string,
  programUrl?: string, // Direct URL from cta_href
  maxRetries: number = 5
): Promise<{
  success: boolean;
  program_ref: string;
  prerequisite_checks?: any[];
  program_questions?: any[];
  error?: string;
}> {
  console.log(`[Phase 2] 📋 Discovering fields for ${programRef} (provider: ${provider})...`);
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await invokeMCPToolDirect(
        discoverFieldsTool, // Use provider-specific tool
        {
          credential_id: credentialId,
          org_ref: orgRef,
          program_ref: programRef,
          mode: 'full', // Both prereqs + questions
          mandate_jws: systemMandateJws,
          program_url: programUrl // Pass direct URL if available
        },
        systemMandateJws
      );
      
      if (!result.success) {
        throw new Error(result.error || 'Discovery failed');
      }
      
      return {
        success: true,
        program_ref: programRef,
        prerequisite_checks: result.prerequisite_checks || [],
        program_questions: result.program_questions || []
      };
      
    } catch (error: any) {
      const backoffMs = Math.pow(2, attempt - 1) * 1000; // Exponential backoff
      console.error(`[Phase 2] ❌ Attempt ${attempt}/${maxRetries} failed: ${error.message}`);
      
      if (attempt === maxRetries) {
        return {
          success: false,
          program_ref: programRef,
          error: error.message
        };
      }
      
      console.log(`[Phase 2] ⏳ Retrying in ${backoffMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }
  
  return { success: false, program_ref: programRef, error: 'Max retries exceeded' };
}

// Organizations are now loaded from the registry (no hardcoded config needed)

interface ScrapeResult {
  orgRef: string;
  category: string;
  success: boolean;
  programCount: number;
  themes: string[];
  error?: string;
  durationMs: number;
  metrics?: any;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('[refresh-program-cache] 🚀 Starting accuracy-optimized two-phase cache refresh...');
  console.log('[refresh-program-cache] 🎯 Mode: Sequential processing with GPT-4o models');
  
  // Initialize Supabase client with service role key
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // STEP 1: Get and validate system mandate
  const systemMandateJws = Deno.env.get('SYSTEM_MANDATE_JWS');
  if (!systemMandateJws) {
    return new Response(JSON.stringify({ error: 'SYSTEM_MANDATE_JWS not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  console.log('[refresh-program-cache] ✅ System mandate loaded');

  // STEP 2: Extract user_id from mandate JWT
  const payload = JSON.parse(atob(systemMandateJws.split('.')[1]));
  const userId = payload.user_id;
  console.log('[refresh-program-cache] Mandate user:', userId);
  
  // STEP 3: Get credential_id from environment
  const credentialId = Deno.env.get('SCP_SERVICE_CRED_ID');
  if (!credentialId) {
    return new Response(JSON.stringify({ error: 'SCP_SERVICE_CRED_ID not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  console.log('[refresh-program-cache] ✅ Using service credential:', credentialId);

  // STEP 3.5: Validate MCP server is accessible
  try {
    console.log('[refresh-program-cache] 🔍 Validating MCP server connection...');
    const mcpServerUrl = Deno.env.get('MCP_SERVER_URL');
    const mcpAccessToken = Deno.env.get('MCP_ACCESS_TOKEN');
    
    if (!mcpServerUrl || !mcpAccessToken) {
      throw new Error('MCP_SERVER_URL or MCP_ACCESS_TOKEN not configured');
    }
    
    const healthCheck = await fetch(`${mcpServerUrl}/health`, {
      headers: {
        'Authorization': `Bearer ${mcpAccessToken}`
      }
    });
    
    if (!healthCheck.ok) {
      throw new Error(`MCP health check failed: ${healthCheck.status}`);
    }
    
    console.log('[refresh-program-cache] ✅ MCP server is accessible');
    
    // PATCH #2: Verify organization registry is accessible
    console.log('[refresh-program-cache][DEBUG] 🔍 Checking MCP organization registry...');
    try {
      const manifestRes = await fetch(`${mcpServerUrl}/mcp/manifest.json`);
      if (manifestRes.ok) {
        const manifest = await manifestRes.json();
        console.log('[refresh-program-cache][DEBUG] ✅ MCP manifest keys:', Object.keys(manifest));
      } else {
        console.warn('[refresh-program-cache][DEBUG] ⚠️ Could not fetch manifest:', manifestRes.status);
      }
    } catch (manifestError: any) {
      console.error('[refresh-program-cache][DEBUG] ❌ Manifest fetch error:', manifestError.message);
    }
  } catch (error: any) {
    console.error('[refresh-program-cache] ❌ Cannot reach MCP server:', error.message);
    return new Response(JSON.stringify({ 
      error: 'MCP server not accessible',
      details: error.message 
    }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const results: ScrapeResult[] = [];
  let totalSuccesses = 0;
  let totalFailures = 0;

  // Concurrency control: Sequential processing for maximum accuracy
  const limit = pLimit(1);

  // STEP 4: Load organizations from registry
  const orgsToScrape = getAllActiveOrganizations();
  console.log(`[refresh-program-cache] 📋 Loaded ${orgsToScrape.length} active organizations from registry`);
  
  // PATCH #2: Log what organizations we're about to scrape
  console.log('[refresh-program-cache][DEBUG] 📋 Organizations to scrape:');
  orgsToScrape.forEach(org => {
    console.log(`  - ${org.name} (${org.orgRef}) - Provider: ${org.provider}`);
    console.log(`    Categories: ${org.categories?.join(', ') || 'all'}`);
  });
  
  if (orgsToScrape.length === 0) {
    console.warn('[refresh-program-cache] ⚠️ No active organizations found in registry');
    return new Response(JSON.stringify({ error: 'No active organizations configured' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // STEP 5: Scrape each organization/category
  for (const org of orgsToScrape) {
    // Get provider configuration
    const providerConfig = getProvider(org.provider);
    if (!providerConfig) {
      console.error(`[refresh-program-cache] ❌ Unknown provider: ${org.provider}, skipping ${org.orgRef}`);
      continue;
    }
    
    console.log(`[refresh-program-cache] 🔧 Using provider: ${providerConfig.name} (${providerConfig.id})`);
    
    // Use provider-specific credential if org doesn't have one
    const credentialIdToUse = org.credentialId || credentialId;
    for (const category of org.categories) {
      const startTime = Date.now();
      console.log(`\n[refresh-program-cache] === ${org.orgRef}:${category} ===`);

      try {
        // PHASE 1: Discover all programs in category (provider-aware)
        const programs = await discoverProgramsForCategory(
          org.provider,
          providerConfig.tools.findPrograms,
          systemMandateJws,
          credentialIdToUse,
          org.orgRef,
          category
        );
        
        if (programs.length === 0) {
          console.warn(`[refresh-program-cache] ⚠️ No programs found, skipping ${category}`);
          await logAuditEntry(supabase, org.orgRef, category, 'no_programs', { provider: org.provider });
          
          results.push({
            orgRef: org.orgRef,
            category,
            success: false,
            programCount: 0,
            themes: [],
            error: 'No programs discovered',
            durationMs: Date.now() - startTime
          });
          
          continue;
        }
        
        console.log(`[refresh-program-cache] 📊 Found ${programs.length} programs to scrape`);
        
        // PHASE 2: Discover fields for each program (provider-aware)
        const discoveries = await Promise.allSettled(
          programs.map(p => 
            limit(() => discoverFieldsForProgram(
              org.provider,
              providerConfig.tools.discoverFields,
              systemMandateJws,
              credentialIdToUse,
              org.orgRef,
              p.program_ref,
              category
            ))
          )
        );
        
        // PHASE 3: Aggregate results
        const programsByTheme: Record<string, any[]> = {};
        const prerequisitesSchema: Record<string, any> = {};
        const questionsSchema: Record<string, any> = {};
        const deepLinksSchema: Record<string, any> = {};
        
        let successCount = 0;
        let failureCount = 0;
        let incompleteCount = 0;
        
        const metrics = {
          programs_discovered: programs.length,
          programs_scraped_successfully: 0,
          programs_failed: 0,
          programs_incomplete: 0,
          total_prereqs_found: 0,
          total_questions_found: 0,
          start_time: startTime,
          end_time: 0
        };
        
        for (let i = 0; i < discoveries.length; i++) {
          const discovery = discoveries[i];
          const program = programs[i];
          
          if (discovery.status === 'fulfilled' && discovery.value.success) {
            const result = discovery.value;
            
            // Validate completeness
            const issues = validateProgramData(result);
            if (issues.length > 0) {
              console.warn(`[refresh-program-cache] ⚠️ ${program.title}: incomplete (${issues.join(', ')})`);
              incompleteCount++;
            } else {
              successCount++;
            }
            
            // Add to programs_by_theme (provider-aware theme detection)
            const theme = determineTheme(org.provider, program.title);
            if (!programsByTheme[theme]) programsByTheme[theme] = [];
            programsByTheme[theme].push({
              program_ref: program.program_ref,
              title: program.title,
              category: category
            });
            
            // Add prerequisites
            if (result.prerequisite_checks && result.prerequisite_checks.length > 0) {
              prerequisitesSchema[program.program_ref] = transformPrereqChecks(result.prerequisite_checks);
              metrics.total_prereqs_found += result.prerequisite_checks.length;
            }
            
            // Add questions
            if (result.program_questions && result.program_questions.length > 0) {
              questionsSchema[program.program_ref] = transformProgramQuestions(result.program_questions);
              metrics.total_questions_found += result.program_questions.length;
            }
            
            // Add deep links (provider-aware)
            deepLinksSchema[program.program_ref] = generateDeepLinks(org.provider, org.orgRef, program.program_ref);
            
            console.log(`[refresh-program-cache] ✅ ${program.title} (${program.program_ref})`);
          } else {
            failureCount++;
            const error = discovery.status === 'rejected' 
              ? (discovery.reason || 'Unknown rejection reason')
              : (discovery.value?.error || 'Unknown discovery error');
            console.error(`[refresh-program-cache] ❌ ${program.title}: ${error}`);
          }
        }
        
        metrics.programs_scraped_successfully = successCount;
        metrics.programs_failed = failureCount;
        metrics.programs_incomplete = incompleteCount;
        metrics.end_time = Date.now();
        
        console.log(`[refresh-program-cache] 📈 Summary: ✅ ${successCount} complete, ⚠️ ${incompleteCount} incomplete, ❌ ${failureCount} failed of ${programs.length} total`);
        
        // PHASE 4: Upsert to cache
        try {
          const { data, error } = await supabase.rpc('upsert_cached_programs_enhanced', {
            p_org_ref: org.orgRef,
            p_category: category,
            p_programs_by_theme: programsByTheme,
            p_provider: org.provider,
            p_prerequisites_schema: prerequisitesSchema,
            p_questions_schema: questionsSchema,
            p_deep_links: deepLinksSchema,
            p_metadata: {
              provider: org.provider,
              scrape_type: 'dynamic_two_phase_accuracy_optimized',
              accuracy_mode: 'maximum',
              models: {
                vision: 'gpt-4o',
                extractor: 'gpt-4o',
                validator: 'gpt-4o'
              },
              ...metrics,
              scraped_at: new Date().toISOString()
            },
            p_ttl_hours: 24
          });
          
          if (error) throw error;
          
          await logAuditEntry(supabase, org.orgRef, category, 'success', {
            provider: org.provider,
            programs_discovered: programs.length,
            programs_scraped: successCount,
            programs_incomplete: incompleteCount,
            programs_failed: failureCount
          });
          
          results.push({
            orgRef: org.orgRef,
            category,
            success: true,
            programCount: successCount,
            themes: Object.keys(programsByTheme),
            durationMs: Date.now() - startTime,
            metrics
          });
          
          totalSuccesses++;
          
        } catch (cacheError: any) {
          console.error(`[refresh-program-cache] ❌ Failed to cache ${category}:`, cacheError);
          await logAuditEntry(supabase, org.orgRef, category, 'failed', { 
            provider: org.provider,
            error: cacheError.message,
            programs_discovered: programs.length
          });
          
          results.push({
            orgRef: org.orgRef,
            category,
            success: false,
            programCount: 0,
            themes: [],
            error: `Cache error: ${cacheError.message}`,
            durationMs: Date.now() - startTime
          });
          
          totalFailures++;
        }

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

        await logAuditEntry(supabase, org.orgRef, category, 'failed', {
          provider: org.provider,
          error: error.message,
          duration_ms: durationMs,
          scraped_at: new Date().toISOString()
        });
      }
    }
  }

  // Calculate summary statistics
  const totalDurationMs = results.reduce((sum, r) => sum + r.durationMs, 0);
  const totalPrograms = results.reduce((sum, r) => sum + r.programCount, 0);
  const avgDurationMs = totalDurationMs / results.length;

  const summary = {
    timestamp: new Date().toISOString(),
    totalOrgs: orgsToScrape.length,
    totalScrapesAttempted: results.length,
    totalSuccesses,
    totalFailures,
    totalPrograms,
    totalDurationMs,
    totalDurationMinutes: Math.round(totalDurationMs / 60000),
    avgDurationMs: Math.round(avgDurationMs),
    results,
    flow: 'Two-phase accuracy-optimized discovery',
    mode: 'sequential_processing_gpt4o',
    auth_method: 'system_mandate_jws'
  };

  console.log(`\n[refresh-program-cache] 🏁 Complete: ${totalSuccesses}/${results.length} successful, ${totalPrograms} programs cached`);
  console.log(`[refresh-program-cache] ⏱️ Total time: ${Math.round(totalDurationMs / 60000)} minutes`);

  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
});
