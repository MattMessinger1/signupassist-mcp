import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../src/integrations/supabase/types.js';
import { launchBrowserbaseSession, closeBrowserbaseSession, BrowserbaseSession } from '../lib/browserbase-skiclubpro.js';
import { lookupCredentialsById } from '../lib/credentials.js';
import { discoverFieldsSerially } from '../lib/serial_field_discovery.js';
import { runChecks } from '../prereqs/registry.js';
import { getProvider } from './registry.js';
import { isAuthenticated, performLogin } from './blackhawk/login.js';
import { scrapeProgramList } from './blackhawk/scrapeProgramList.js';
import { telemetry } from '../lib/telemetry.js';

// Supabase client for cache writes (using service role)
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey);

/**
 * Fetches and caches all programs for Blackhawk Ski Club.
 * Logs in via service credentials, scrapes program data, and upserts into cached_programs.
 */
export async function refreshBlackhawkPrograms(): Promise<void> {
  const orgRef = 'blackhawk-ski-club';
  const providerId = 'skiclubpro';
  console.log(`[${orgRef}] 🔄 Starting full program feed refresh...`);

    // Launch headless browser session
    let session: BrowserbaseSession | null = null;
    try {
      session = await launchBrowserbaseSession();
      const { page, browser } = session;

      // Build base URL for Blackhawk (uses custom domain if available)
      const providerConfig = getProvider(providerId);
      const baseUrl: string = providerConfig.buildBaseUrl(orgRef);

    // Fetch service credentials and login
    const serviceCredId = process.env.SCP_SERVICE_CRED_ID;
    if (!serviceCredId) {
      throw new Error('SCP_SERVICE_CRED_ID not configured');
    }
    
    console.log(`[${orgRef}] 🔐 Fetching service credentials...`);
    const credentials = await lookupCredentialsById(serviceCredId);
    
    // Verify if session is already authenticated
    console.log(`[${orgRef}] 🔍 Verifying existing session authentication...`);
    await page.goto(`${baseUrl}/registration`, { waitUntil: 'networkidle' });
    let authenticated = await isAuthenticated(page);
    
    telemetry.record("auth_check", {
      provider: "blackhawk",
      result: authenticated ? "session_valid" : "session_stale"
    });
    
    if (!authenticated) {
      console.log(`[${orgRef}] ⚠️ Pre-authenticated session is NOT actually logged in. Performing fresh login...`);
      
      telemetry.record("login_repair", { provider: "blackhawk", status: "performed" });
      
      const loginResult = await performLogin(page, browser, baseUrl, credentials);
      if (!loginResult.success) {
        telemetry.record("login_repair", { provider: "blackhawk", status: "failed", error: loginResult.error });
        throw new Error(`Login failed: ${loginResult.error}`);
      }
      
      // Re-check auth with small grace window
      await page.goto(`${baseUrl}/registration`, { waitUntil: 'networkidle' });
      authenticated = await isAuthenticated(page);
      if (!authenticated) {
        telemetry.record("login_repair", { provider: "blackhawk", status: "failed", error: "verification_failed" });
        throw new Error('Login failed - authentication verification failed after login attempt');
      }
      
      telemetry.record("login_repair", { provider: "blackhawk", status: "success" });
      console.log(`[${orgRef}] ✅ Fresh login succeeded; session is authenticated.`);
    } else {
      console.log(`[${orgRef}] ✅ Session is authenticated. Proceeding with program scrape.`);
    }

    // 2. Scrape all program entries from the registration page
    console.log(`[${orgRef}] 📋 Scraping program list...`);
    const programsList = await scrapeProgramList(page, baseUrl);
    console.log(`[${orgRef}] ✅ Found ${programsList.length} programs total.`);

    if (programsList.length === 0) {
      console.warn(`[${orgRef}] ⚠️ No programs found on listing page. Exiting without cache update.`);
      return;
    }

    // 3. Determine theme for each program and prepare detailed schemas
    const programsByTheme: Record<string, any[]> = {};
    const prerequisitesSchema: Record<string, any> = {};
    const questionsSchema: Record<string, any> = {};
    const deepLinks: Record<string, any> = {};

    // Get theme categorization and deep link generators from provider config
    const determineTheme = providerConfig.determineTheme;
    const generateDeepLinks = providerConfig.generateDeepLinks;

    console.log(`[${orgRef}] 🔍 Running prerequisite checks (membership, waivers, etc.)...`);
    const prereqResults: any = await runChecks(providerId, { page, baseUrl, orgRef });
    // Build a PrerequisiteCheck schema object for one program (all programs share the same requirements)
    const basePrereqChecks: Record<string, { required: boolean; check: string; message: string }> = {};
    if (Array.isArray(prereqResults)) {
      for (const result of prereqResults) {
        const checkId: string = result.id || '';
        if (checkId.includes('membership')) {
          basePrereqChecks['membership'] = { required: true, check: checkId, message: 'Active club membership required.' };
        } else if (checkId.includes('waiver')) {
          basePrereqChecks['waiver'] = { required: true, check: checkId, message: 'Parent/guardian waiver must be signed.' };
        } else if (checkId.includes('payment')) {
          basePrereqChecks['payment_method'] = { required: true, check: checkId, message: 'Credit card on file required.' };
        } else if (result.label && result.label.toLowerCase().includes('child profile')) {
          // Child profile prerequisite (ensure at least one child/participant)
          basePrereqChecks['child_profile'] = { required: true, check: checkId || 'family.children', message: 'Child name, DOB, emergency contact required.' };
        }
      }
    }

    // For each program, navigate to its page to extract signup questions
    for (const program of programsList) {
      const progRef: string = program.program_ref;
      try {
        // Assign theme via provider's categorization logic
        const theme = determineTheme(program.title);
        program.theme = theme;
        // Group programs by theme
        if (!programsByTheme[theme]) programsByTheme[theme] = [];
        programsByTheme[theme].push({ ...program });

        // Prepare prerequisites schema entry for this program
        prerequisitesSchema[progRef] = { ...(basePrereqChecks || {}) };

        // Deep links for this program (registration start, account creation, details)
        deepLinks[progRef] = generateDeepLinks(orgRef, progRef);

        // Load the program's registration page to discover signup form fields
        console.log(`[${orgRef}] 🔎 Extracting form fields for "${program.title}"...`);
        if (program.url) {
          await page.goto(program.url, { waitUntil: 'domcontentloaded' });
        } else {
          // Construct direct URL if not present (should not normally happen if listing had URL)
          await page.goto(`${baseUrl}/registration/${progRef}`, { waitUntil: 'domcontentloaded' });
        }
        // Small delay to ensure form elements rendered
        await page.waitForTimeout(1500);
        const formDiscovery = await discoverFieldsSerially(page, progRef);
        questionsSchema[progRef] = {
          fields: formDiscovery.fields || [],
          metadata: {
            ...formDiscovery.metadata,
            // Mark partial schema if not all questions were captured
            partial_schema: formDiscovery.fields?.length ? undefined : true
          }
        };
        console.log(`[${orgRef}] ✅ Processed program "${program.title}" (${progRef}).`);
      } catch (progErr: any) {
        console.error(`[${orgRef}] ⚠️ Error processing program "${program.title}":`, progErr.message);
        // Remove any partially added data for this program
        if (program.theme && programsByTheme[program.theme]) {
          programsByTheme[program.theme] = programsByTheme[program.theme].filter(p => p.program_ref !== progRef);
        }
        delete prerequisitesSchema[progRef];
        delete questionsSchema[progRef];
        delete deepLinks[progRef];
        // Continue with next program
      }
    }

    // 4. Upsert the aggregated cache entry into the database
    const programsCount = Object.values(programsByTheme).reduce((count, list) => count + list.length, 0);
    console.log(`[${orgRef}] 💾 Caching ${programsCount} programs across ${Object.keys(programsByTheme).length} themes...`);
    const { data, error } = await supabase.rpc('upsert_cached_programs_enhanced', {
      p_org_ref: orgRef,
      p_category: 'all',
      p_programs_by_theme: programsByTheme,
      p_provider: providerId,
      p_prerequisites_schema: prerequisitesSchema,
      p_questions_schema: questionsSchema,
      p_deep_links: deepLinks,
      p_metadata: {
        cached_by: 'service_refresh',
        programs_count: programsCount,
        cached_timestamp: new Date().toISOString()
      }
    });
    if (error) {
      throw new Error(`Cache upsert failed: ${error.message}`);
    }
    console.log(`[${orgRef}] ✅ Program cache updated (Entry ID: ${data}).`);
    console.log(`[${orgRef}] 🎉 Refresh complete: ${programsCount} programs cached under ${Object.keys(programsByTheme).length} themes.`);
  } catch (err: any) {
    console.error(`[${orgRef}] ❌ Pipeline error:`, err.message);
    // (No partial writes on error; cache remains unchanged if failure occurs before upsert)
  } finally {
    if (session) {
      await closeBrowserbaseSession(session);
    }
  }
}
