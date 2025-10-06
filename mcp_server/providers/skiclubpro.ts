/**
 * SkiClubPro Provider - MCP Tools for SkiClubPro automation
 */

import { Page } from 'playwright';
import { verifyMandate } from '../lib/mandates.js';
import { auditToolCall } from '../middleware/audit.js';
import { lookupCredentialsById } from '../lib/credentials.js';
import { launchBrowserbaseSession, discoverProgramRequiredFields, captureScreenshot, closeBrowserbaseSession, performSkiClubProLogin, scrapeSkiClubProPrograms } from '../lib/browserbase.js';
import { captureScreenshotEvidence } from '../lib/evidence.js';
import { getAvailablePrograms } from '../config/program_mapping.js';
import { createClient } from '@supabase/supabase-js';
import { loginWithCredentials, logoutIfLoggedIn } from '../lib/login.js';
import { skiClubProConfig } from '../config/skiclubproConfig.js';
import { saveSessionState, restoreSessionState, generateSessionKey } from '../lib/session.js';
import { runChecks, buildBaseUrl } from '../prereqs/registry.js';
import { getOrgOverride } from '../prereqs/providers.js';
import type { ProviderResponse } from './types.js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export interface SkiClubProTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
  handler: (args: any) => Promise<any>;
}

// Define types for field discovery
export interface DiscoverRequiredFieldsArgs {
  program_ref: string;
  credential_id: string;
  user_jwt: string;
  org_ref?: string;
  mandate_id?: string;
  plan_execution_id?: string;
  plan_id?: string;
  user_id?: string;
  session_token?: string;
}

export interface FieldSchema {
  program_ref: string;
  questions: Array<{
    id: string;
    label: string;
    type: string;
    required: boolean;
    options?: string[];
    category?: string;
  }>;
  categories?: Record<string, any[]>;
  metadata?: {
    url: string;
    field_count: number;
    categories: string[];
    discovered_at: string;
  };
}

/**
 * Helper: Resolve base URL from org_ref or program_ref
 */
function resolveBaseUrl(args: any): string {
  // Extract org_ref from args (could be in different places)
  let orgRef = args?.org_ref || 'blackhawk-ski-club';
  
  // If we have program_ref instead, try to extract org from program mapping
  if (!args?.org_ref && args?.program_ref) {
    const programs = getAvailablePrograms('blackhawk-ski-club'); // Default org
    const program = programs.find(p => p.text_ref === args.program_ref);
    if (program?.org_ref) {
      orgRef = program.org_ref;
    }
  }
  
  // CRITICAL FIX: Map 'blackhawk-ski-club' to 'blackhawk' for correct domain
  // The actual domain is blackhawk.skiclubpro.team NOT blackhawk-ski-club.skiclubpro.team
  let domainSlug = orgRef.toLowerCase().replace(/[^a-z0-9-]/g, '');
  
  // Strip '-ski-club' suffix if present
  if (domainSlug.endsWith('-ski-club')) {
    domainSlug = domainSlug.replace('-ski-club', '');
  }
  
  const baseUrl = `https://${domainSlug}.skiclubpro.team`;
  
  console.log(`DEBUG: Corrected base URL: ${baseUrl} (from org_ref: ${orgRef})`);
  return baseUrl;
}

/**
 * Helper: Ensure user is logged in using dynamic base URL with optional session caching
 */
async function ensureLoggedIn(
  session: any, 
  credential_id: string, 
  user_jwt: string, 
  baseUrl: string,
  userId: string,
  orgRef: string,
  auditParams?: { 
    tool_name?: string; 
    mandate_id?: string;
    plan_id?: string;
    plan_execution_id?: string;
    session_token?: string;
  }
) {
  const creds = await lookupCredentialsById(credential_id, user_jwt);
  const { page } = session;

  console.log('DEBUG: Using credentials from cred-get:', creds.email);
  
  // Generate session key for caching
  const sessionKey = generateSessionKey(userId, credential_id, orgRef);
  
  // Try to restore cached session first
  const restored = await restoreSessionState(page, sessionKey);
  if (restored) {
    console.log('DEBUG: Session restored from cache, skipping login attempt');
    await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
    
    const currentUrl = await page.url();
    if (currentUrl.includes('/user/login')) {
      console.log('DEBUG: Cached session invalid (still on login page), clearing cookies and retrying fresh login');
      
      // Clear cookies + storage
      await page.context().clearCookies();
      try { 
        await page.context().clearPermissions(); 
      } catch (_) {
        // clearPermissions may not be available in all contexts
      }
      
      // Build dynamic config with resolved base URL
      const loginConfig = {
        loginUrl: `${baseUrl}/user/login?destination=/dashboard`,
        selectors: skiClubProConfig.selectors,
        postLoginCheck: skiClubProConfig.postLoginCheck,
        timeout: skiClubProConfig.timeout
      };
      
      // Retry full login with credentials
      const proof = await loginWithCredentials(page, loginConfig, creds, session.browser);
      const retryUrl = await page.url();
      if (retryUrl.includes('/user/login')) {
        throw new Error('Login failed after clearing session — still on login page');
      }
      
      await saveSessionState(page, sessionKey);
      return { ...proof, login_status: 'success' };
    } else {
      console.log('DEBUG: ✓ Cached session is valid');
      return { cached: true, email: creds.email, login_status: 'success' };
    }
  }
  
  console.log('DEBUG: Attempting login to SkiClubPro at:', baseUrl);
  
  // Build dynamic config with resolved base URL
  const loginConfig = {
    loginUrl: `${baseUrl}/user/login?destination=/dashboard`,
    selectors: skiClubProConfig.selectors,
    postLoginCheck: skiClubProConfig.postLoginCheck,
    timeout: skiClubProConfig.timeout
  };
  
  // Use the new robust login helper with credentials
  const proof = await loginWithCredentials(page, loginConfig, creds, session.browser);
  
  // Verify that we are not still on the login page
  const currentUrl = await page.url();
  if (currentUrl.includes('/user/login')) {
    console.log('DEBUG: Login failed - still on login page');
    return { ...proof, login_status: 'failed' };
  }
  
  // Save session state after successful login
  await saveSessionState(page, sessionKey);
  
  console.log('DEBUG: Logged in as', creds.email);
  return { ...proof, login_status: 'success' };
}

/**
 * Helper: Ensure user is logged out using config-based logout system
 */
async function ensureLoggedOut(session: any) {
  const { page } = session;
  
  try {
    console.log('DEBUG: Attempting logout...');
    await logoutIfLoggedIn(page, skiClubProConfig.postLoginCheck);
  } catch (error) {
    console.log('DEBUG: Logout not needed or already logged out');
  }
}

/**
 * Real implementation of SkiClubPro field discovery with login/logout handling
 */
export async function scpDiscoverRequiredFields(args: DiscoverRequiredFieldsArgs & { session_token?: string }): Promise<FieldSchema> {
  
  // Validate user JWT is provided
  if (!args.user_jwt) {
    throw new Error('Missing user_jwt for credential lookup');
  }
  
  // Inline program mapping to avoid import issues
  const PROGRAM_MAPPINGS = {
    'blackhawk-ski-club': [
      {
        text_ref: 'blackhawk_winter',
        actual_id: '309',
        title: 'Nordic Kids Wednesday',
        description: 'Wednesday Nordic Kids Program',
        org_ref: 'blackhawk-ski-club'
      },
      {
        text_ref: 'blackhawk_beginner_sat', 
        actual_id: '310',
        title: 'Beginner Skiing - Saturday Morning',
        description: 'Perfect for first-time skiers ages 4-8',
        org_ref: 'blackhawk-ski-club'
      }
    ]
  };
  
  const getProgramId = (textRef: string, orgRef: string = 'blackhawk-ski-club'): string => {
    const mappings = PROGRAM_MAPPINGS[orgRef] || PROGRAM_MAPPINGS['blackhawk-ski-club'];
    const mapping = mappings.find(m => m.text_ref === textRef || m.title === textRef);
    
    if (mapping) {
      return mapping.actual_id;
    }
    
    console.warn(`No program mapping found for ${textRef} in ${orgRef}, using as-is`);
    return textRef;
  };

  return await auditToolCall(
    {
      tool: 'scp.discover_required_fields',
      mandate_id: args.mandate_id || '',
      plan_execution_id: args.plan_execution_id || null
    },
    args,
    async () => {
      let session = null;
      
      try {
        // Resolve base URL from org_ref or program_ref
        const baseUrl = resolveBaseUrl(args);
        
        // Extract org_ref for field discovery
        const orgRef = args?.org_ref || 'blackhawk-ski-club';
        
        // Extract user_id from JWT for session caching
        const userId = args.user_jwt ? JSON.parse(atob(args.user_jwt.split('.')[1])).sub : 'anonymous';
        
        // Launch browser session (always fresh - no session reuse)
        session = await launchBrowserbaseSession();
        console.log('[Discover] Launched fresh Browserbase session');
        
        // ✅ Login first with dynamic base URL and optional session caching
        const loginResult = await ensureLoggedIn(
          session, 
          args.credential_id, 
          args.user_jwt, 
          baseUrl, 
          userId, 
          orgRef,
          { 
            tool_name: 'scp.discover_required_fields', 
            mandate_id: args.mandate_id,
            plan_id: args.plan_id,
            plan_execution_id: args.plan_execution_id,
            session_token: args.session_token
          }
        );
        console.log('DEBUG: Login successful, starting field discovery');
        
        // ✅ Discover program fields (credentials not needed since we're already logged in)
        const fieldSchema = await discoverProgramRequiredFields(
          session,
          args.program_ref,
          orgRef
        );
        
        console.log('DEBUG: Field discovery completed:', fieldSchema);
        
        return fieldSchema;
        
      } catch (error) {
        console.error('SkiClubPro field discovery failed:', error);
        
        // Try to parse structured error for better diagnostics
        let errorMessage = error.message;
        let diagnostics = null;
        
        try {
          const parsed = JSON.parse(error.message);
          errorMessage = parsed.message;
          diagnostics = parsed.diagnostics;
        } catch {
          // Not JSON, use as-is
        }
        
        const finalError: any = new Error(errorMessage);
        if (diagnostics) {
          finalError.diagnostics = diagnostics;
        }
        
        throw finalError;
      } finally {
        // ✅ Always close session (no reuse)
        if (session) {
          await ensureLoggedOut(session);
          await closeBrowserbaseSession(session);
          console.log('[Discover] Closed Browserbase session');
        }
      }
    },
    'scp:read:listings' // Required scope for mandate verification
  );
}

/**
 * Prerequisites check types and helpers
 */
type Check = { 
  ok: boolean | null; 
  summary?: string; 
  reason?: string; 
  confidence?: "high" | "medium" | "low"; 
  lastCheckedAt?: string; 
  evidenceSnippet?: string 
};

async function innerText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText || "");
}

// Robust nav helper: tries a list of candidate paths, stops at first success
async function go(page: Page, base: string, paths: string[], timeout = 15000) {
  for (const p of paths) {
    try {
      await page.goto(`${base}${p}`, { waitUntil: "domcontentloaded", timeout });
      return true;
    } catch {}
  }
  return false;
}

async function checkAccount(page: Page): Promise<Check> {
  const txt = (await innerText(page)).slice(0, 600);
  const signedIn =
    /dashboard|my account|log\s*out|welcome|profile/i.test(txt) ||
    await page.$('a[href*="/user/logout"], [data-user], nav .avatar, .user-menu');
  return {
    ok: !!signedIn,
    summary: signedIn ? "Logged in and on account area" : "Could not verify logged-in state",
    confidence: signedIn ? "high" : "low",
    lastCheckedAt: new Date().toISOString(),
    evidenceSnippet: txt
  };
}

async function checkMembership(page: Page, base: string): Promise<Check> {
  await go(page, base, ["/membership", "/user/membership", "/my-account", "/account"]);
  const txt = await innerText(page);
  // Keywords common across orgs
  const active = /(current|active)\s+(membership|member)/i.test(txt) || /renew/i.test(txt) && !/expired/i.test(txt);
  const expired = /expired/i.test(txt);
  return {
    ok: active && !expired,
    summary: active ? "Active membership detected" : (expired ? "Membership appears expired" : "Could not confirm membership"),
    reason: active ? undefined : "We didn't find 'Active/Current membership' language on the membership pages.",
    confidence: active ? "medium" : "low",
    lastCheckedAt: new Date().toISOString(),
    evidenceSnippet: txt.slice(0, 500)
  };
}

async function checkPayment(page: Page, base: string): Promise<Check> {
  // Stripe Customer Portal is cross‑origin. We can't read inside the iframe reliably.
  // Heuristic: confirm the portal/section loads and visible CTAs are present.
  await go(page, base, ["/user/payment-methods", "/billing", "/payments", "/customer-portal", "/account/payment"]);
  const txt = await innerText(page);
  const portalPresent =
    /payment methods|update card|manage payment|customer portal|card ending|visa|mastercard|amex/i.test(txt);
  return {
    ok: portalPresent, // mark success if portal is accessible (we'll rely on the portal at checkout)
    summary: portalPresent ? "Stripe payment portal accessible" : "No payment portal found",
    reason: portalPresent ? undefined : "Could not locate a payment method area. If your card is saved inside Stripe, this may still pass at checkout.",
    confidence: portalPresent ? "medium" : "low",
    lastCheckedAt: new Date().toISOString(),
    evidenceSnippet: txt.slice(0, 300)
  };
}

async function checkChild(page: Page, base: string, childName?: string): Promise<Check> {
  await go(page, base, ["/user/family", "/family", "/children", "/household"]);
  const txt = await innerText(page);
  if (!childName) {
    const anyChild = /(child|children|family member)/i.test(txt);
    return {
      ok: anyChild ? true : null,
      summary: anyChild ? "Family/child section found" : "Could not confirm child info",
      confidence: anyChild ? "low" : "low",
      lastCheckedAt: new Date().toISOString(),
      evidenceSnippet: txt.slice(0, 300)
    };
  }
  const found = new RegExp(childName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(txt);
  return {
    ok: found,
    summary: found ? `Found child profile: ${childName}` : `Could not find child profile: ${childName}`,
    confidence: found ? "high" : "low",
    lastCheckedAt: new Date().toISOString(),
    evidenceSnippet: txt.slice(0, 300)
  };
}

/**
 * List children from the family/children area
 */
async function listChildren(page: Page, base: string): Promise<Array<{ id?: string; name: string; raw?: string }>> {
  // Navigate to family/children area
  await go(page, base, ["/user/family", "/family", "/children", "/household", "/account/family"]);
  await page.waitForLoadState("networkidle").catch(() => {});

  const children: Array<{ id?: string; name: string; raw?: string }> = [];

  // Strategy 1: rows or cards with obvious labels
  const rowLike = page.locator('table tbody tr, .views-row, .family-member, li');
  const n = await rowLike.count();
  for (let i = 0; i < Math.min(n, 200); i++) {
    const el = rowLike.nth(i);
    const text = (await el.innerText().catch(() => ""))?.trim();
    if (!text) continue;
    // Common keywords hinting this row is a child profile block
    if (!/child|children|family|dob|grade|age|profile/i.test(text)) continue;

    // Try to extract a name (first non-empty line / bold heading)
    const name =
      (await el.locator('h2, h3, .title, .name, strong').first().innerText().catch(() => "")) ||
      text.split('\n').map(s => s.trim()).filter(Boolean)[0];

    if (name && name.length > 1 && name.length < 120) {
      // Try to find an id-ish attribute in links/inputs
      const href = await el.locator('a[href*="child"], a[href*="family"]').first().getAttribute('href').catch(() => null);
      const idMatch = href?.match(/(child|member|id)=(\d+)/i) || href?.match(/\/(child|member)\/(\d+)/i);
      children.push({ id: idMatch?.[2], name: name.trim(), raw: text.slice(0, 300) });
    }
  }

  // Strategy 2: fallback – scrape any obvious name fields from lists
  if (children.length === 0) {
    const txt = await page.evaluate(() => document.body.innerText || "");
    // very light heuristic – pick likely names from "Children" section
    const blocks = txt.split(/\n{2,}/).filter(b => /child|children|family/i.test(b));
    for (const b of blocks) {
      const firstLine = b.split('\n').map(s => s.trim()).filter(Boolean)[0];
      if (firstLine && firstLine.length < 120) children.push({ name: firstLine, raw: b.slice(0, 300) });
      if (children.length >= 5) break;
    }
  }

  return children;
}

export const skiClubProTools = {
  'scp.discover_required_fields': scpDiscoverRequiredFields,

  'scp.check_account_status': async (args: { credential_id: string; org_ref?: string; email?: string; mandate_id?: string; plan_execution_id?: string }) => {
    // Stub implementation
    return {
      status: 'ok',
      account_exists: true,
      verified: true,
      credential_id: args.credential_id,
      timestamp: new Date().toISOString()
    };
  },

  'scp.check_membership_status': async (args: { org_ref: string; mandate_id?: string; plan_execution_id?: string }) => {
    // Stub implementation
    return {
      membership: 'active',
      expires_at: '2024-12-31',
      plan_type: 'family',
      org_ref: args.org_ref,
      timestamp: new Date().toISOString()
    };
  },

  'scp.check_payment_method': async (args: { mandate_id: string; plan_execution_id?: string }) => {
    // Stub implementation
    return {
      payment_method: 'valid',
      card_last_four: '4242',
      card_type: 'visa',
      mandate_id: args.mandate_id,
      timestamp: new Date().toISOString()
    };
  },

  'scp.login': async (args: { credential_id: string; user_jwt: string; org_ref?: string; mandate_id?: string; plan_execution_id?: string }) => {
    return await auditToolCall(
      {
        tool: 'scp.login',
        mandate_id: args.mandate_id || '',
        plan_execution_id: args.plan_execution_id || null
      },
      args,
      async () => {
        let session = null;
        try {
          // Validate inputs
          if (!args.credential_id) throw new Error('credential_id is required');
          if (!args.user_jwt) throw new Error('user_jwt is required');
          
          const orgRef = args.org_ref || 'blackhawk-ski-club';
          const baseUrl = resolveBaseUrl({ org_ref: orgRef });
          
          // Extract user_id from JWT for session caching
          const userId = JSON.parse(atob(args.user_jwt.split('.')[1])).sub;
          
          console.log(`DEBUG: Starting real login for org: ${orgRef}, baseUrl: ${baseUrl}`);
          
          // Launch Browserbase session
          session = await launchBrowserbaseSession();
          console.log(`DEBUG: Browserbase session launched: ${session.sessionId}`);
          
          // Perform login using existing infrastructure
          const loginProof = await ensureLoggedIn(
            session,
            args.credential_id,
            args.user_jwt,
            baseUrl,
            userId,
            orgRef,
            { tool_name: 'scp.find_programs', mandate_id: args.mandate_id }
          );
          
          console.log('DEBUG: Login successful, proof:', loginProof);
          
          // Capture screenshot as evidence (if we have a plan_execution_id)
          if (args.plan_execution_id) {
            const screenshotBuffer = await captureScreenshot(session, `login_${orgRef}_${Date.now()}.png`);
            await captureScreenshotEvidence(args.plan_execution_id, screenshotBuffer, `login_${orgRef}`);
          }
          
          // Handle the different return types from ensureLoggedIn
          const email = typeof loginProof === 'object' && 'email' in loginProof ? loginProof.email : undefined;
          const cached = typeof loginProof === 'object' && 'cached' in loginProof ? loginProof.cached : false;
          const url = typeof loginProof === 'object' && 'url' in loginProof ? loginProof.url : undefined;
          
          return {
            success: true,
            session_id: session.sessionId,
            message: 'Login successful via Browserbase',
            email: email || url || 'logged in',
            cached: cached,
            url: url || baseUrl,
            timestamp: new Date().toISOString()
          };
          
        } catch (error) {
          console.error('Real login failed:', error);
          throw new Error(`Login failed: ${error.message}`);
        } finally {
          // Close the Browserbase session (cached cookies will persist)
          if (session) {
            await closeBrowserbaseSession(session);
            console.log('DEBUG: Browserbase session closed');
          }
        }
      },
      'scp:authenticate' // Required scope for mandate verification
    );
  },

  'scp.register': async (args: any) => {
    // Stub implementation
    return {
      success: true,
      registration_id: 'reg_' + Date.now(),
      message: 'Registration successful',
      program_ref: args.program_ref,
      timestamp: new Date().toISOString()
    };
  },

  'scp.find_programs': async (args: { 
    org_ref?: string; 
    query?: string; 
    mandate_id?: string; 
    plan_execution_id?: string; 
    plan_id?: string;
    credential_id?: string; 
    user_jwt?: string; 
    user_id?: string;
    session_token?: string;
    force_login?: boolean 
  }): Promise<ProviderResponse<{ programs: any[] }>> => {
    const orgRef = args.org_ref || 'blackhawk-ski-club';
    
    // If credentials provided, use live Browserbase scraping
    if (args.credential_id && args.user_jwt) {
      console.log('[scp.find_programs] Using live Browserbase scraping');
      
      let session: any = null;
      
      try {
        // Verify mandate includes required scope
        if (args.mandate_id) {
          try {
            await verifyMandate(args.mandate_id, 'scp:read:listings');
          } catch (mandateError) {
            console.error('[scp.find_programs] Mandate verification failed:', mandateError);
            return { 
              login_status: 'failed', 
              error: `Mandate verification failed: ${mandateError.message}`,
              timestamp: new Date().toISOString()
            };
          }
        }
        
        // Launch Browserbase session
        console.log('[scp.find_programs] Launching Browserbase session...');
        session = await launchBrowserbaseSession();
        
        // Login to SkiClubPro with optional force_login and audit context
        console.log('[scp.find_programs] Logging in...');
        const credentials = await lookupCredentialsById(args.credential_id, args.user_jwt);
        const loginResult = await performSkiClubProLogin(session, credentials, orgRef, {
          force_login: !!args.force_login,
          toolName: 'scp.find_programs',
          mandate_id: args.mandate_id,
          plan_id: args.plan_id,
          plan_execution_id: args.plan_execution_id,
          user_id: args.user_id,
          session_token: args.session_token,
          user_jwt: args.user_jwt
        });
        
        // ✅ Check login result
        if (loginResult.login_status === 'failed') {
          console.error('[scp.find_programs] Login failed');
          return { 
            login_status: 'failed', 
            error: 'Login failed - unable to authenticate. Try again with hard reset.',
            timestamp: new Date().toISOString()
          };
        }
        
        // Scrape programs from live site
        console.log('[scp.find_programs] ✓ Login verified, scraping programs...');
        const scrapedPrograms = await scrapeSkiClubProPrograms(session, orgRef, args.query);
        
        // Capture screenshot evidence if plan execution exists
        if (args.plan_execution_id) {
          try {
            const screenshot = await captureScreenshot(session);
            await captureScreenshotEvidence(args.plan_execution_id, screenshot, 'programs-listing');
            console.log('[scp.find_programs] Screenshot evidence captured');
          } catch (evidenceError) {
            console.warn('[scp.find_programs] Could not capture evidence:', evidenceError);
          }
        }
        
        // Map scraped programs to expected format
        const programs = scrapedPrograms.map(program => ({
          id: program.program_ref,
          program_ref: program.program_ref,
          title: program.title,
          description: `Opens at ${program.opens_at}`,
          schedule: `Registration opens ${new Date(program.opens_at).toLocaleDateString()}`,
          age_range: 'See program details',
          skill_level: 'All levels',
          price: 'See website',
          actual_id: program.program_ref,
          org_ref: orgRef
        }));
        
        console.log(`[scp.find_programs] ✓ Successfully scraped ${programs.length} programs`);
        
        return {
          login_status: 'success',
          data: {
            programs
          },
          timestamp: new Date().toISOString()
        };
        
      } catch (error) {
        console.error('[scp.find_programs] Live scraping failed:', error);
        
        return {
          login_status: 'failed',
          error: error.message || 'Unknown error during live scraping',
          timestamp: new Date().toISOString()
        };
        
      } finally {
        if (session) {
          try {
            await closeBrowserbaseSession(session);
          } catch (closeError) {
            console.warn('[scp.find_programs] Error closing session:', closeError);
          }
        }
      }
    }
    
    // No credentials - return static fallback data
    console.log('[scp.find_programs] No credentials provided, returning static data');
    const availablePrograms = getAvailablePrograms(orgRef);
    const fallbackPrograms = availablePrograms.map(mapping => ({
      id: mapping.text_ref,
      program_ref: mapping.text_ref,
      title: mapping.title,
      description: mapping.description || `${mapping.title} program`,
      schedule: mapping.schedule,
      age_range: mapping.age_range,
      skill_level: mapping.skill_level,
      price: mapping.price,
      actual_id: mapping.actual_id,
      org_ref: mapping.org_ref
    }));
    
    let filteredPrograms = fallbackPrograms;
    if (args.query) {
      const query = args.query.toLowerCase();
      filteredPrograms = fallbackPrograms.filter(program => 
        program.title.toLowerCase().includes(query) ||
        program.description.toLowerCase().includes(query)
      );
    }
    
    return {
      login_status: 'failed',
      data: {
        programs: filteredPrograms
      },
      error: 'No credentials provided - showing static fallback data',
      timestamp: new Date().toISOString()
    };
  },

  'scp.pay': async (args: any) => {
    // Stub implementation
    return {
      success: true,
      payment_id: 'pay_' + Date.now(),
      amount: args.amount,
      status: 'completed',
      timestamp: new Date().toISOString()
    };
  },

  'scp:list_children': async (args: {
    credential_id: string;
    user_jwt: string;
    org_ref: string;
    force_login?: boolean;
    mandate_id?: string;
    plan_execution_id?: string;
  }) => {
    return await auditToolCall(
      {
        tool: 'scp.list_children',
        mandate_id: args.mandate_id || '',
        plan_execution_id: args.plan_execution_id || null
      },
      args,
      async () => {
        let session = null;
        try {
          // Validate inputs
          if (!args.credential_id) throw new Error('credential_id is required');
          if (!args.user_jwt) throw new Error('user_jwt is required');
          
          const orgRef = args.org_ref || 'blackhawk-ski-club';
          const base = `https://${orgRef}.skiclubpro.team`;
          const baseUrl = resolveBaseUrl({ org_ref: orgRef });
          
          // Extract user_id from JWT for session caching
          const userId = JSON.parse(atob(args.user_jwt.split('.')[1])).sub;
          
          console.log(`[scp:list_children] Starting for org: ${orgRef}`);
          
          // Launch Browserbase session
          session = await launchBrowserbaseSession();
          const { page } = session;
          
          // Perform login if requested
          if (args.force_login) {
            await ensureLoggedIn(
              session,
              args.credential_id,
              args.user_jwt,
              baseUrl,
              userId,
              orgRef,
              { tool_name: 'scp.list_children', mandate_id: args.mandate_id }
            );
          }
          
          // List children
          console.log('[scp:list_children] Listing children...');
          const children = await listChildren(page, base);
          
          console.log(`[scp:list_children] Found ${children.length} children`);
          
          return { children };
          
        } catch (error) {
          console.error('[scp:list_children] Failed:', error);
          throw new Error(`List children failed: ${error.message}`);
        } finally {
          if (session) {
            try {
              await closeBrowserbaseSession(session);
            } catch (closeError) {
              console.warn('[scp:list_children] Error closing session:', closeError);
            }
          }
        }
      },
      'scp:read:account' // Required scope for mandate verification
    );
  },

  'scp:check_prerequisites': async (args: { 
    credential_id: string; 
    user_jwt: string; 
    org_ref: string; 
    program_ref?: string;
    force_login?: boolean; 
    child_name?: string;
    mandate_id?: string; 
    plan_execution_id?: string;
    plan_id?: string;
    user_id?: string;
    session_token?: string;
  }) => {
    // ✅ NO mandate enforcement for prerequisites check (pre-plan interactive)
    // ✅ Login is still audited via performSkiClubProLogin → audit-login
    let session = null;
    try {
      // Validate inputs
      if (!args.credential_id) throw new Error('credential_id is required');
      if (!args.user_jwt) throw new Error('user_jwt is required');
      
      const orgRef = args.org_ref || 'blackhawk-ski-club';
      const override = getOrgOverride(orgRef);
      const base = buildBaseUrl(orgRef, override.customDomain);
      
      console.log(`[scp:check_prerequisites] Starting checks for org: ${orgRef} (no mandate required)`);
      
      // Launch Browserbase session
      session = await launchBrowserbaseSession();
      const { page } = session;
      
      // Perform login - this internally calls audit-login via performSkiClubProLogin
      console.log('[scp:check_prerequisites] Logging in...');
      const credentials = await lookupCredentialsById(args.credential_id, args.user_jwt);
      const loginResult = await performSkiClubProLogin(session, credentials, orgRef, {
        force_login: !!args.force_login,
        toolName: 'scp.check_prerequisites',
        mandate_id: args.mandate_id,
        plan_id: args.plan_id,
        plan_execution_id: args.plan_execution_id,
        user_id: args.user_id,
        session_token: args.session_token,
        user_jwt: args.user_jwt
      });
      
      // Check login result
      if (loginResult.login_status === 'failed') {
        console.error('[scp:check_prerequisites] Login failed');
        return {
          login_status: 'failed',
          account: { ok: false, summary: 'Login failed' },
          membership: { ok: null, summary: 'Not checked - login failed' },
          payment: { ok: null, summary: 'Not checked - login failed' },
          child: { ok: null, summary: 'Not checked - login failed' },
          children: [],
          requirements: [],
          error: 'Login failed - unable to authenticate'
        };
      }
      
      // Run registry checkers
      console.log('[scp:check_prerequisites] Running prerequisite checks via registry...');
      const results = await runChecks('skiclubpro', {
        orgRef,
        programRef: args.program_ref,
        page,
        baseUrl: base,
        userId: args.user_id
      });
      
      // Map to legacy UI shape (account/membership/payment/child + children[])
      const byId = Object.fromEntries(results.map(r => [r.id, r]));
      const toCheck = (id: string) => {
        const r = byId[id];
        if (!r) return { ok: null, summary: 'Not checked' };
        return {
          ok: r.outcome === 'pass' ? true : r.outcome === 'fail' ? false : null,
          summary: r.explain + (r.evidence?.text_excerpt ? ` — ${r.evidence.text_excerpt.slice(0, 120)}` : '')
        };
      };
      
      const childExtra = (byId['child.profile']?.extra as any) || {};
      const children = childExtra.children || [];
      
      console.log(`[scp:check_prerequisites] Completed ${results.length} checks, found ${children.length} children`);
      
      // Capture screenshot evidence if plan execution exists
      if (args.plan_execution_id) {
        try {
          const screenshot = await captureScreenshot(session);
          await captureScreenshotEvidence(args.plan_execution_id, screenshot, 'prerequisites-check');
          console.log('[scp:check_prerequisites] Screenshot evidence captured');
        } catch (evidenceError) {
          console.warn('[scp:check_prerequisites] Could not capture evidence:', evidenceError);
        }
      }
      
      return {
        login_status: 'success',
        // Legacy shape for current UI:
        account: toCheck('account.login'),
        membership: toCheck('membership.active'),
        payment: toCheck('payment.method'),
        child: toCheck('child.profile'),
        waiver: toCheck('waiver.signed'),
        children,
        // New rich payload for future enhancements:
        requirements: results
      };
      
    } catch (error) {
      console.error('[scp:check_prerequisites] Failed:', error);
      return {
        login_status: 'failed',
        account: { ok: false, summary: 'Error occurred' },
        membership: { ok: null, summary: 'Not checked - error occurred' },
        payment: { ok: null, summary: 'Not checked - error occurred' },
        child: { ok: null, summary: 'Not checked - error occurred' },
        children: [],
        requirements: [],
        error: error.message
      };
    } finally {
      if (session) {
        try {
          await closeBrowserbaseSession(session);
        } catch (closeError) {
          console.warn('[scp:check_prerequisites] Error closing session:', closeError);
        }
      }
    }
  }

};