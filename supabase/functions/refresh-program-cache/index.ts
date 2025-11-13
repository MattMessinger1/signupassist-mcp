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
      const orgConfig = getOrganization(org.orgRef);
      if (!orgConfig) {
        console.warn(`[refresh-program-cache] ⚠️ No config for ${org.orgRef}, skipping`);
        continue;
      }
      
      const provider = orgConfig.provider;
      const categories = orgConfig.categories || ['all'];
      
      console.log(`\n[refresh-program-cache] === ${org.orgRef} (${provider}) ===`);
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
          const programs = await scrapePrograms(page, org.orgRef, category, provider);
          
          if (programs.length === 0) {
            console.warn(`[refresh-program-cache] ⚠️ No programs found for ${org.orgRef}:${category}`);
            await logAuditEntry(supabase, org.orgRef, category, 'no_programs', { provider });
            continue;
          }
          
          totalProgramsScraped += programs.length;
          
          // PHASE 2: Discover fields for each program (sequential to avoid overwhelming Browserbase)
          console.log(`[refresh-program-cache] 🔍 Discovering fields for ${programs.length} programs...`);
          
          for (const program of programs) {
            const { prereqs, questions } = await scrapeFieldsForProgram(page, program, org.orgRef);
            
            totalFieldsDiscovered += questions.length;
            
            // Prepare cache entry
            const deepLinks = generateDeepLinks(provider, org.orgRef, program.program_ref);
            const theme = determineTheme(provider, program.title);
            
            const cacheEntry = {
              org_ref: org.orgRef,
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
          await logAuditEntry(supabase, org.orgRef, category, 'success', {
            provider,
            programs_scraped: programs.length,
            fields_discovered: totalFieldsDiscovered
          });
          
          results.push({
            org_ref: org.orgRef,
            category,
            programs_scraped: programs.length,
            status: 'success'
          });
          
        } catch (error: any) {
          console.error(`[refresh-program-cache] ❌ Failed for ${org.orgRef}:${category}:`, error.message);
          
          await logAuditEntry(supabase, org.orgRef, category, 'failed', {
            provider,
            error: error.message
          });
          
          results.push({
            org_ref: org.orgRef,
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
