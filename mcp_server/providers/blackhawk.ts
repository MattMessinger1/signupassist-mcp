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
import { getSession, storeSession, generateToken } from '../lib/sessionManager.js';
import { resolveSkiClubProUrl } from './utils/resolveSkiClubProUrl.js';

// Supabase client for cache writes (using service role)
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey);

/**
 * Fetches and caches all programs for Blackhawk Ski Club.
 * Logs in via service credentials, scrapes program data, and upserts into cached_programs.
 */
export async function refreshBlackhawkPrograms(): Promise<number> {
  const orgRef = 'blackhawk-ski-club';
  const providerId = 'skiclubpro';
  console.log(`[${orgRef}] 🔄 Starting full program feed refresh...`);
  telemetry.record("feed_refresh", { provider: "blackhawk", action: "start" });

    // Try to reuse existing session or launch new one
    let session: BrowserbaseSession | null = null;
    let sessionToken: string | null = null;
    let sessionReused = false;
    
    try {
      // Attempt to get existing session from cache
      const existingSession = await getSession();
      
      if (existingSession) {
        console.log(`[${orgRef}] ♻️ Reusing cached Browserbase session`);
        session = existingSession.session;
        sessionToken = existingSession.newToken;
        sessionReused = true;
        telemetry.record("browserbase_session", { 
          provider: "blackhawk", 
          action: "reused",
          session_id: session.sessionId 
        });
      } else {
        // No valid session, launch new one
        console.log(`[${orgRef}] 🚀 Launching new Browserbase session...`);
        session = await launchBrowserbaseSession();
        sessionToken = generateToken();
        telemetry.record("browserbase_session", { 
          provider: "blackhawk", 
          action: "launched",
          session_id: session.sessionId 
        });
      }
      
      const { page, browser } = session;

      // Build base URL for Blackhawk (uses custom domain if available)
      const providerConfig = getProvider(providerId);
      const baseUrl: string = providerConfig.buildBaseUrl(orgRef);

      // If session was reused, verify it's still authenticated
      if (sessionReused) {
        console.log(`[${orgRef}] 🔍 Verifying cached session authentication...`);
        await page.goto(`${baseUrl}/registration`, { waitUntil: 'networkidle' });
        const authenticated = await isAuthenticated(page);
        
        if (!authenticated) {
          console.log(`[${orgRef}] ⚠️ Cached session lost authentication, will re-authenticate...`);
          sessionReused = false; // Mark as new session flow
          telemetry.record("session_reauth", { provider: "blackhawk", reason: "auth_lost" });
        } else {
          console.log(`[${orgRef}] ✅ Cached session still authenticated`);
          telemetry.record("session_reauth", { provider: "blackhawk", status: "valid" });
        }
      }

      // Authenticate if not already authenticated (new session or lost auth)
      if (!sessionReused) {
        // Fetch service credentials
        const serviceCredId = process.env.SCP_SERVICE_CRED_ID;
        if (!serviceCredId) {
          throw new Error('SCP_SERVICE_CRED_ID not configured');
        }
        
        console.log(`[${orgRef}] 🔐 Fetching service credentials...`);
        const credentials = await lookupCredentialsById(serviceCredId);
        
        console.log(`[${orgRef}] 🔓 Performing login...`);
        const loginResult = await performLogin(page, browser, baseUrl, credentials);
        if (!loginResult.success) {
          telemetry.record("login_failed", { provider: "blackhawk", error: loginResult.error });
          throw new Error(`Login failed: ${loginResult.error}`);
        }
        console.log(`[${orgRef}] ✅ Login successful`);
        telemetry.record("login_success", { provider: "blackhawk" });
        
        // Store the newly authenticated session for future reuse
        if (sessionToken) {
          storeSession(sessionToken, session);
          console.log(`[${orgRef}] 📦 Stored authenticated session for reuse`);
        }
        
        // Re-check auth after login
        await page.goto(`${baseUrl}/registration`, { waitUntil: 'networkidle' });
        // Give the page time to fully render authenticated UI
        await page.waitForTimeout(3000);
        const authenticated = await isAuthenticated(page);
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

        // OPTIMIZATION: Skip form discovery for clearly closed/full programs
        const statusText = (program.status || '').toLowerCase();
        const isClosedOrFull = /full|sold out|closed|waitlist only/i.test(statusText);
        
        if (isClosedOrFull) {
          console.log(
            `[${orgRef}] ⏭️ Skipping form discovery for closed program "${program.title}" (status=${program.status})`
          );
          
          // Mark as closed in metadata for UI/AAP awareness
          questionsSchema[progRef] = {
            fields: [],
            metadata: {
              registration_open: false,
              skip_reason: 'program_closed',
              status: program.status
            }
          };
          
          console.log(`[${orgRef}] ✅ Processed program "${program.title}" (${progRef}) - SKIPPED`);
          continue; // Skip to next program
        }

        // Load the program's registration page to discover signup form fields
        console.log(`[${orgRef}] 🔎 Extracting form fields for "${program.title}"...`);
        
        // Resolve to absolute URL (handles relative paths from AI extractor)
        const targetUrl = program.url 
          ? resolveSkiClubProUrl(orgRef, program.url)
          : resolveSkiClubProUrl(orgRef, `/registration/${progRef}`);

        console.log(`[${orgRef}] 🌐 Navigating to: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

        // Small delay to ensure form elements rendered
        await page.waitForTimeout(1500);
        const formDiscovery = await discoverFieldsSerially(page, progRef);
        
        questionsSchema[progRef] = {
          fields: formDiscovery.fields || [],
          metadata: {
            ...formDiscovery.metadata,
            registration_open: true,
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
    
    // Validation logging before cache write
    console.log(`[${orgRef}] 📊 Cache validation:`, {
      programs_count: programsCount,
      themes: Object.keys(programsByTheme),
      prerequisites_programs: Object.keys(prerequisitesSchema).length,
      questions_programs: Object.keys(questionsSchema).length,
      deep_links_programs: Object.keys(deepLinks).length
    });
    
    // Build raw payload object
    const rawPayload = {
      org_ref: orgRef,
      category: 'all',
      provider: providerId,
      programs_by_theme: programsByTheme,
      prerequisites_schema: prerequisitesSchema,
      questions_schema: questionsSchema,
      deep_links: deepLinks,
      metadata: {
        cached_by: 'service_refresh',
        programs_count: programsCount,
        cached_timestamp: new Date().toISOString()
      }
    };

    // Log a sample program for debugging
    if (programsCount > 0) {
      const sampleTheme = Object.keys(programsByTheme)[0];
      const sampleProgram = programsByTheme[sampleTheme]?.[0];
      if (sampleProgram) {
        console.log(`[${orgRef}] 🔎 Sample program at cache upsert:`, {
          title: sampleProgram.title,
          status: sampleProgram.status,
          program_ref: sampleProgram.program_ref,
          descriptionPreview: (sampleProgram.description || '').slice(0, 200)
        });
      }
    }

    // Sanitize: JSON round-trip removes unserializable values and normalizes Unicode
    const sanitizedPayload = JSON.parse(JSON.stringify(rawPayload));

    // Call RPC with sanitized data
    const { data, error } = await supabase.rpc('upsert_cached_programs_enhanced', {
      p_org_ref: sanitizedPayload.org_ref,
      p_category: sanitizedPayload.category,
      p_programs_by_theme: sanitizedPayload.programs_by_theme,
      p_provider: sanitizedPayload.provider,
      p_prerequisites_schema: sanitizedPayload.prerequisites_schema,
      p_questions_schema: sanitizedPayload.questions_schema,
      p_deep_links: sanitizedPayload.deep_links,
      p_metadata: sanitizedPayload.metadata
    });

    if (error) {
      console.error(`[${orgRef}] ❌ Cache upsert failed:`, {
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw new Error(`Cache upsert failed: ${error.message}`);
    }
    console.log(`[${orgRef}] ✅ Program cache updated (Entry ID: ${data}).`);
    
    // Post-write verification
    const { data: verifyData, error: verifyError } = await supabase
      .from('cached_programs')
      .select('programs_by_theme, prerequisites_schema, questions_schema, deep_links, cached_at')
      .eq('id', data)
      .single();
      
    if (verifyError) {
      console.error(`[${orgRef}] ⚠️ Cache verification failed:`, verifyError);
    } else {
      const cachedProgramsCount = Object.values(verifyData.programs_by_theme as Record<string, any[]>)
        .reduce((count, list) => count + list.length, 0);
      console.log(`[${orgRef}] ✅ Cache verified: ${cachedProgramsCount} programs written successfully`);
      telemetry.record("cache_write", { 
        provider: "blackhawk", 
        programs_count: cachedProgramsCount,
        cache_id: data 
      });
    }
    
    console.log(`[${orgRef}] 🎉 Refresh complete: ${programsCount} programs cached under ${Object.keys(programsByTheme).length} themes.`);
    telemetry.record("feed_refresh", { provider: "blackhawk", status: "complete", programs_count: programsCount });
    return programsCount;
  } catch (err: any) {
    console.error(`[${orgRef}] ❌ Pipeline error:`, err.message);
    
    // Track specific error types in telemetry
    if (err.message?.includes('429') || err.message?.includes('concurrent sessions')) {
      telemetry.record("feed_refresh_error", { 
        provider: "blackhawk", 
        error_type: "browserbase_session_limit",
        error: err.message 
      });
      console.error(`[${orgRef}] 🚨 Browserbase session limit reached. Run cleanup before retrying.`);
    } else if (err.message?.includes('invalid JSON')) {
      telemetry.record("feed_refresh_error", { 
        provider: "blackhawk", 
        error_type: "parse_error",
        error: err.message 
      });
    } else {
      telemetry.record("feed_refresh_error", { 
        provider: "blackhawk", 
        error_type: "unknown",
        error: err.message 
      });
    }
    
    // Rethrow to propagate error to caller (HTTP 500)
    throw err;
  } finally {
    // Session lifecycle management with caching
    if (session && sessionToken) {
      if (sessionReused) {
        // Session was reused successfully, refresh its TTL
        console.log(`[${orgRef}] 🔄 Refreshing cached session TTL`);
        storeSession(sessionToken, session);
        telemetry.record("browserbase_session", { 
          provider: "blackhawk", 
          action: "ttl_refreshed",
          session_id: session.sessionId 
        });
      } else {
        // New session was created and authenticated, keep it alive for reuse
        console.log(`[${orgRef}] 🔄 Keeping session ${session.sessionId} alive for reuse`);
        telemetry.record("browserbase_session", { 
          provider: "blackhawk", 
          action: "stored_for_reuse",
          session_id: session.sessionId 
        });
      }
    } else if (session) {
      // Session failed or wasn't stored, close it
      console.log(`[${orgRef}] 🔒 Closing failed session ${session.sessionId}`);
      telemetry.record("browserbase_session", { 
        provider: "blackhawk", 
        action: "closing",
        session_id: session.sessionId 
      });
      await closeBrowserbaseSession(session);
    }
  }
}
