/**
 * Phase 2: Refresh Program Cache (MCP-Independent)
 * Uses direct Browserbase scraping with shared helpers
 * No MCP server dependencies
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getAllActiveOrganizations, getOrganization } from '../_shared/organizations.ts';
import { getProvider } from '../_shared/providerRegistry.ts';
import { 
  scrapeProgramList, 
  discoverFieldsSerially, 
  navigateToProgramForm,
  type ProgramData,
  type DiscoveredField 
} from '../_shared/scraping.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// AUDIT LOGGING
// ============================================================================

async function logAuditEntry(
  supabase: any,
  orgRef: string,
  category: string,
  status: 'success' | 'failed' | 'no_programs',
  metadata: Record<string, any> | null
) {
  try {
    await supabase.from('mandate_audit').insert({
      user_id: '00000000-0000-0000-0000-000000000000',
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

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateDeepLinks(provider: string, orgRef: string, programRef: string): Record<string, string> {
  const providerConfig = getProvider(provider);
  if (!providerConfig) {
    const baseUrl = `https://${orgRef}.skiclubpro.team`;
    return {
      registration_start: `${baseUrl}/registration/${programRef}/start?ref=signupassist`,
      account_creation: `${baseUrl}/user/register?ref=signupassist`,
      program_details: `${baseUrl}/programs/${programRef}?ref=signupassist`
    };
  }
  
  return providerConfig.generateDeepLinks(orgRef, programRef);
}

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

function transformProgramQuestions(programQuestions: DiscoveredField[]): Record<string, any> {
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

function determineTheme(provider: string, title: string): string {
  const providerConfig = getProvider(provider);
  if (!providerConfig) {
    const t = title.toLowerCase();
    if (t.includes('lesson') || t.includes('class')) return 'Lessons & Classes';
    if (t.includes('camp') || t.includes('clinic')) return 'Camps & Clinics';
    if (t.includes('race') || t.includes('team')) return 'Races & Teams';
    return 'All Programs';
  }
  
  return providerConfig.determineTheme(title);
}

// ============================================================================
// BROWSERBASE SESSION MANAGEMENT
// ============================================================================

interface BrowserbaseSession {
  session: {
    id: string;
    connectUrl: string;
  };
}

async function createBrowserbaseSession(supabase: any): Promise<BrowserbaseSession> {
  console.log('[Browserbase] Creating new session...');
  
  const { data, error } = await supabase.functions.invoke('launch-browserbase', {
    body: { headless: true }
  });
  
  if (error) {
    throw new Error(`Failed to launch Browserbase: ${error.message}`);
  }
  
  console.log(`[Browserbase] Session created: ${data.session.id}`);
  return data;
}

// ============================================================================
// PHASE 1: PROGRAM LIST SCRAPING
// ============================================================================

async function scrapePrograms(
  page: any,
  orgRef: string,
  category: string,
  provider: string
): Promise<ProgramData[]> {
  console.log(`[Phase 1] 🔍 Scraping programs for ${orgRef}:${category}...`);
  
  // Navigate to registration page
  const registrationUrl = `https://${orgRef}.skiclubpro.team/registration`;
  await page.goto(registrationUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  
  // Use scraping helper with provider-specific selectors
  const selectors = {
    container: ['.program-row', '[data-program]', 'tr[data-id]', '.program-card'],
    title: ['.program-title', 'h3', 'h4', 'a.program-link'],
    price: ['.price', '.cost', '[class*="price"]'],
    schedule: ['.schedule', '.dates', '[class*="schedule"]']
  };
  
  const programs = await scrapeProgramList(page, orgRef, selectors);
  
  console.log(`[Phase 1] ✅ Scraped ${programs.length} programs for ${orgRef}:${category}`);
  return programs.map(p => ({
    ...p,
    category,
    org_ref: orgRef
  }));
}

// ============================================================================
// PHASE 2: FIELD DISCOVERY FOR PROGRAMS
// ============================================================================

async function scrapeFieldsForProgram(
  page: any,
  program: ProgramData,
  orgRef: string
): Promise<{ prereqs: DiscoveredField[]; questions: DiscoveredField[] }> {
  console.log(`[Phase 2] 📋 Discovering fields for ${program.program_ref}...`);
  
  try {
    // Navigate to program registration form
    const programUrl = program.url || `https://${orgRef}.skiclubpro.team/registration/${program.program_ref}/start`;
    await navigateToProgramForm(page, program.program_ref, `${orgRef}.skiclubpro.team`, programUrl);
    
    // Discover fields using serial discovery
    const result = await discoverFieldsSerially(page, program.program_ref);
    
    console.log(`[Phase 2] ✅ Found ${result.fields.length} fields for ${program.program_ref}`);
    
    // Separate prerequisites from program questions
    // (For now, treat all as program questions - prerequisites discovery can be added later)
    return {
      prereqs: [],
      questions: result.fields
    };
    
  } catch (error: any) {
    console.error(`[Phase 2] ❌ Failed to discover fields for ${program.program_ref}:`, error.message);
    return { prereqs: [], questions: [] };
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
    console.log('[refresh-program-cache] 🚀 Starting MCP-independent cache refresh...');
    
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Load organizations
    const organizations = getAllActiveOrganizations();
    console.log(`[refresh-program-cache] 📋 Loaded ${organizations.length} active organizations`);
    
    const results: any[] = [];
    let totalProgramsScraped = 0;
    let totalFieldsDiscovered = 0;
    
    // Process each organization
    for (const org of organizations) {
      const orgConfig = getOrganization(org.ref);
      if (!orgConfig) {
        console.warn(`[refresh-program-cache] ⚠️ No config for ${org.ref}, skipping`);
        continue;
      }
      
      const provider = orgConfig.provider;
      const categories = orgConfig.categories || ['all'];
      
      console.log(`\n[refresh-program-cache] === ${org.ref} (${provider}) ===`);
      console.log(`   Categories: ${categories.join(', ')}`);
      
      // Process each category
      for (const category of categories) {
        let session: BrowserbaseSession | null = null;
        let browser: any = null;
        
        try {
          // Create Browserbase session
          session = await createBrowserbaseSession(supabase);
          
          // Import Playwright dynamically (Deno-compatible)
          const { chromium } = await import('https://deno.land/x/playwright@0.4501.1/index.ts');
          
          // Connect to Browserbase
          browser = await chromium.connectOverCDP(session.session.connectUrl);
          const context = browser.contexts()[0];
          const page = await context.newPage();
          
          // PHASE 1: Scrape program list
          const programs = await scrapePrograms(page, org.ref, category, provider);
          
          if (programs.length === 0) {
            console.warn(`[refresh-program-cache] ⚠️ No programs found for ${org.ref}:${category}`);
            await logAuditEntry(supabase, org.ref, category, 'no_programs', { provider });
            continue;
          }
          
          totalProgramsScraped += programs.length;
          
          // PHASE 2: Discover fields for each program (sequential to avoid overwhelming Browserbase)
          console.log(`[refresh-program-cache] 🔍 Discovering fields for ${programs.length} programs...`);
          
          for (const program of programs) {
            const { prereqs, questions } = await scrapeFieldsForProgram(page, program, org.ref);
            
            totalFieldsDiscovered += questions.length;
            
            // Prepare cache entry
            const deepLinks = generateDeepLinks(provider, org.ref, program.program_ref);
            const theme = determineTheme(provider, program.title);
            
            const cacheEntry = {
              org_ref: org.ref,
              category,
              program_ref: program.program_ref,
              title: program.title,
              description: program.description || '',
              price: program.price || 'TBD',
              schedule: program.schedule || '',
              age_range: program.age_range || '',
              skill_level: program.skill_level || '',
              status: program.status || 'open',
              theme,
              deep_links: [deepLinks],
              prerequisites_schema: transformPrereqChecks(prereqs),
              questions_schema: transformProgramQuestions(questions),
              provider,
              cached_at: new Date().toISOString(),
              metadata: {
                prerequisite_count: prereqs.length,
                question_count: questions.length,
                scrape_source: 'direct_browserbase',
                scrape_method: 'phase2_independent'
              }
            };
            
            // Upsert to cache
            const { error: upsertError } = await supabase
              .from('cached_programs')
              .upsert(cacheEntry, {
                onConflict: 'org_ref,category,program_ref'
              });
            
            if (upsertError) {
              console.error(`[refresh-program-cache] ❌ Failed to upsert ${program.program_ref}:`, upsertError);
            } else {
              console.log(`[refresh-program-cache] ✅ Cached ${program.program_ref}`);
            }
          }
          
          // Log success
          await logAuditEntry(supabase, org.ref, category, 'success', {
            provider,
            programs_scraped: programs.length,
            fields_discovered: totalFieldsDiscovered
          });
          
          results.push({
            org_ref: org.ref,
            category,
            programs_scraped: programs.length,
            status: 'success'
          });
          
        } catch (error: any) {
          console.error(`[refresh-program-cache] ❌ Failed for ${org.ref}:${category}:`, error.message);
          
          await logAuditEntry(supabase, org.ref, category, 'failed', {
            provider,
            error: error.message
          });
          
          results.push({
            org_ref: org.ref,
            category,
            error: error.message,
            status: 'failed'
          });
          
        } finally {
          // Clean up Browserbase session
          if (browser) {
            try {
              await browser.close();
              console.log('[Browserbase] Session closed');
            } catch (closeError) {
              console.error('[Browserbase] Failed to close session:', closeError);
            }
          }
        }
      }
    }
    
    console.log('\n[refresh-program-cache] ✅ Cache refresh complete');
    console.log(`   Total programs: ${totalProgramsScraped}`);
    console.log(`   Total fields: ${totalFieldsDiscovered}`);
    
    return new Response(
      JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        summary: {
          organizations_processed: organizations.length,
          programs_scraped: totalProgramsScraped,
          fields_discovered: totalFieldsDiscovered
        },
        results
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
    
  } catch (error: any) {
    console.error('[refresh-program-cache] 💥 Fatal error:', error);
    
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
        
        // PHASE 2: Check discovery status and filter out programs that should be skipped
        const { data: discoveryStatuses } = await supabase
          .from('program_discovery_status')
          .select('program_ref, discovery_status, consecutive_failures, last_attempt_at')
          .eq('org_ref', org.orgRef)
          .eq('provider', org.provider)
          .in('program_ref', programs.map(p => p.program_ref));
        
        const statusMap = new Map(
          (discoveryStatuses || []).map(s => [s.program_ref, s])
        );
        
        // Filter programs: skip not_discoverable and recently failed (3+ failures within 1 hour)
        const programsToDiscover = programs.filter(p => {
          const status = statusMap.get(p.program_ref);
          
          // Skip if marked as not_discoverable
          if (status?.discovery_status === 'not_discoverable') {
            console.log(`[Phase 2] ⏭️  Skipping ${p.program_ref} (marked not_discoverable: ${status.last_error})`);
            return false;
          }
          
          // Skip if 3+ consecutive failures within last hour
          if (status?.consecutive_failures >= 3 && status?.last_attempt_at) {
            const lastAttempt = new Date(status.last_attempt_at);
            const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
            if (lastAttempt > hourAgo) {
              const minutesAgo = Math.round((Date.now() - lastAttempt.getTime()) / 60000);
              console.log(`[Phase 2] ⏭️  Skipping ${p.program_ref} (3+ failures, last attempt ${minutesAgo}m ago)`);
              return false;
            }
          }
          
          return true;
        });
        
        console.log(`[refresh-program-cache] 🔍 Attempting discovery for ${programsToDiscover.length}/${programs.length} programs (${programs.length - programsToDiscover.length} skipped)`);
        
        // PHASE 2: Discover fields for filtered programs (provider-aware)
        const discoveries = await Promise.allSettled(
          programsToDiscover.map(p => 
            limit(() => discoverFieldsForProgram(
              org.provider,
              providerConfig.tools.discoverFields,
              systemMandateJws,
              credentialIdToUse,
              org.orgRef,
              p.program_ref,
              category,
              p.cta_href,  // Pass direct URL from Phase 1 discovery
              p.skill_level // NEW: Pass skill_level from Phase 1
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
          const program = programsToDiscover[i]; // Use filtered list
          
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
            
            // Add questions with metadata
            if (result.program_questions && result.program_questions.length > 0) {
              questionsSchema[program.program_ref] = {
                fields: transformProgramQuestions(result.program_questions),
                metadata: result.metadata || {} // NEW: Store metadata
              };
              metrics.total_questions_found += result.program_questions.length;
              
              if (result.metadata?.password_protected) {
                console.log(`[refresh-program-cache] ✅ Stored partial schema for password-protected program: ${program.program_ref}`);
              }
            }
            
            // Add deep links (provider-aware)
            deepLinksSchema[program.program_ref] = generateDeepLinks(org.provider, org.orgRef, program.program_ref);
            
            // === UPDATE DISCOVERY STATUS: SUCCESS ===
            await supabase
              .from('program_discovery_status')
              .upsert({
                org_ref: org.orgRef,
                provider: org.provider,
                program_ref: program.program_ref,
                discovery_status: 'ok',
                consecutive_failures: 0,
                last_error: null,
                last_attempt_at: new Date().toISOString()
              }, {
                onConflict: 'org_ref,provider,program_ref'
              });
            
            console.log(`[refresh-program-cache] ✅ ${program.title} (${program.program_ref})`);
          } else {
            failureCount++;
            const error = discovery.status === 'rejected' 
              ? (discovery.reason || 'Unknown rejection reason')
              : (discovery.value?.error || 'Unknown discovery error');
            console.error(`[refresh-program-cache] ❌ ${program.title}: ${error}`);
            
            // === UPDATE DISCOVERY STATUS: FAILURE ===
            const resultValue = discovery.status === 'fulfilled' ? discovery.value : null;
            const should_mark_not_discoverable = resultValue?.metadata?.should_mark_not_discoverable || false;
            
            if (should_mark_not_discoverable) {
              // Permanent failure (404, etc.) - mark as not_discoverable
              console.log(`[refresh-program-cache] 🚫 Marking ${program.program_ref} as not_discoverable (${error})`);
              await supabase
                .from('program_discovery_status')
                .upsert({
                  org_ref: org.orgRef,
                  provider: org.provider,
                  program_ref: program.program_ref,
                  discovery_status: 'not_discoverable',
                  consecutive_failures: 5, // Max out
                  last_error: error,
                  last_attempt_at: new Date().toISOString()
                }, {
                  onConflict: 'org_ref,provider,program_ref'
                });
            } else {
              // Temporary error - increment failures
              const currentStatus = statusMap.get(program.program_ref);
              const currentFailures = currentStatus?.consecutive_failures || 0;
              
              await supabase
                .from('program_discovery_status')
                .upsert({
                  org_ref: org.orgRef,
                  provider: org.provider,
                  program_ref: program.program_ref,
                  discovery_status: 'temporary_error',
                  consecutive_failures: currentFailures + 1,
                  last_error: error,
                  last_attempt_at: new Date().toISOString()
                }, {
                  onConflict: 'org_ref,provider,program_ref'
                });
            }
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
