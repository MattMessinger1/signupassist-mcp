// Trigger rebuild: 2025-11-11 - Two-phase accuracy-optimized cache refresh
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { invokeMCPToolDirect } from '../_shared/mcpClient.ts';
import pLimit from 'npm:p-limit@5';

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
      provider: 'skiclubpro',
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

// Helper: Determine theme from program title
function determineTheme(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('lesson') || t.includes('class')) return 'Lessons & Classes';
  if (t.includes('camp') || t.includes('clinic')) return 'Camps & Clinics';
  if (t.includes('race') || t.includes('team') || t.includes('competition')) return 'Races & Teams';
  return 'All Programs';
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

// PHASE 1: Dynamic Program Discovery using Three Phase Extractor
async function discoverProgramsForCategory(
  systemMandateJws: string,
  credentialId: string,
  orgRef: string,
  category: string
): Promise<Array<{ program_ref: string; title: string; category: string }>> {
  console.log(`[Phase 1] 🔍 Discovering programs for ${orgRef}:${category}...`);
  
  try {
    const result = await invokeMCPToolDirect(
      'scp.find_programs',
      {
        credential_id: credentialId,
        org_ref: orgRef,
        category: category,
        mandate_jws: systemMandateJws
      },
      systemMandateJws
    );
    
    if (!result.success || !result.programs) {
      console.warn(`[Phase 1] ⚠️ No programs found for ${category}`);
      return [];
    }
    
    const programs = result.programs.map((p: any) => ({
      program_ref: p.program_id || p.program_ref,
      title: p.title,
      category: category
    }));
    
    console.log(`[Phase 1] ✅ Found ${programs.length} programs`);
    return programs;
    
  } catch (error: any) {
    console.error(`[Phase 1] ❌ Failed to discover programs:`, error.message);
    return []; // Defensive: don't crash entire refresh
  }
}

// PHASE 2: Field Discovery with Retry Logic
async function discoverFieldsForProgram(
  systemMandateJws: string,
  credentialId: string,
  orgRef: string,
  programRef: string,
  category: string,
  maxRetries: number = 5
): Promise<{
  success: boolean;
  program_ref: string;
  prerequisite_checks?: any[];
  program_questions?: any[];
  error?: string;
}> {
  console.log(`[Phase 2] 📋 Discovering fields for ${programRef}...`);
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await invokeMCPToolDirect(
        'scp.discover_required_fields',
        {
          credential_id: credentialId,
          org_ref: orgRef,
          program_ref: programRef,
          mode: 'full', // Both prereqs + questions
          mandate_jws: systemMandateJws
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

  const results: ScrapeResult[] = [];
  let totalSuccesses = 0;
  let totalFailures = 0;

  // Concurrency control: Sequential processing for maximum accuracy
  const limit = pLimit(1);

  // STEP 4: Scrape each organization/category
  for (const org of ORGS_TO_SCRAPE) {
    for (const category of org.categories) {
      const startTime = Date.now();
      console.log(`\n[refresh-program-cache] === ${org.orgRef}:${category} ===`);

      try {
        // PHASE 1: Discover all programs in category (using Three Phase Extractor)
        const programs = await discoverProgramsForCategory(
          systemMandateJws,
          credentialId,
          org.orgRef,
          category
        );
        
        if (programs.length === 0) {
          console.warn(`[refresh-program-cache] ⚠️ No programs found, skipping ${category}`);
          await logAuditEntry(supabase, org.orgRef, category, 'no_programs', null);
          
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
        
        // PHASE 2: Discover fields for each program (using Serial Discovery)
        const discoveries = await Promise.allSettled(
          programs.map(p => 
            limit(() => discoverFieldsForProgram(
              systemMandateJws,
              credentialId,
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
            
            // Add to programs_by_theme
            const theme = determineTheme(program.title);
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
            
            // Add deep links
            deepLinksSchema[program.program_ref] = generateDeepLinks(org.orgRef, program.program_ref);
            
            console.log(`[refresh-program-cache] ✅ ${program.title} (${program.program_ref})`);
          } else {
            failureCount++;
            const error = discovery.status === 'rejected' ? discovery.reason : discovery.value.error;
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
            p_prerequisites_schema: prerequisitesSchema,
            p_questions_schema: questionsSchema,
            p_deep_links: deepLinksSchema,
            p_metadata: {
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
    totalOrgs: ORGS_TO_SCRAPE.length,
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
