/**
 * SkiClubPro Provider - MCP Tools for SkiClubPro automation
 */

import { Page, ElementHandle } from 'playwright-core';
import { verifyMandate } from '../lib/mandates.js';
import { auditToolCall } from '../middleware/audit.js';
import { lookupCredentialsById } from '../lib/credentials.js';
import { launchBrowserbaseSession, captureScreenshot, closeBrowserbaseSession } from '../lib/browserbase-skiclubpro.js';
import { storeSession, generateToken, getSession } from '../lib/sessionManager.js';
import { captureScreenshotEvidence } from '../lib/evidence.js';
import { getAvailablePrograms } from '../config/program_mapping.js';
import { createClient } from '@supabase/supabase-js';
import { loginWithCredentials, logoutIfLoggedIn, ProviderLoginConfig } from '../lib/login.js';
import { skiClubProConfig } from '../config/skiclubproConfig.js';
import { saveSessionState, restoreSessionState, generateSessionKey } from '../lib/session.js';
import { runChecks, buildBaseUrl } from '../prereqs/registry.js';
import { getOrgOverride } from '../prereqs/providers.js';
import type { ProviderResponse } from './types.js';
import { PROMPT_VERSION } from '../ai/AIOrchestrator.js';
import { getReadiness } from './utils/pageReadinessRegistry.js';
import { UrlBuilder } from '../../providers/skiclubpro/lib/index.js';

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
  mandate_jws?: string;
  plan_execution_id?: string;
  plan_id?: string;
  user_id?: string;
  session_token?: string;
  child_name?: string;
  child_id?: string;
  warm_hints_prereqs?: Record<string, any>;
  warm_hints_program?: Record<string, any>;
  mode?: 'full' | 'prerequisites_only';
  _stage?: 'prereq' | 'program';
  _run_id?: string;
}

export interface FieldSchema {
  program_ref: string;
  prerequisites?: Array<{
    id: string;
    label: string;
    type: string;
    required: boolean;
    options?: Array<{ value: string; label: string }>;
    category?: string;
  }>;
  prerequisite_status?: 'complete' | 'required' | 'unknown';
  prerequisite_message?: string;
  program_questions?: Array<{
    id: string;
    label: string;
    type: string;
    required: boolean;
    options?: Array<{ value: string; label: string }>;
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
 * Returns both baseUrl and baseDomain for consistent URL construction
 */
function resolveBaseUrl(args: any): { baseUrl: string; baseDomain: string } {
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
  const baseDomain = (orgRef === 'blackhawk-ski-club') 
    ? 'blackhawk.skiclubpro.team' 
    : `${orgRef.replace(/[^a-z0-9-]/g, '').toLowerCase()}.skiclubpro.team`;
  
  const baseUrl = `https://${baseDomain}`;
  
  console.log(`DEBUG: Corrected base URL: ${baseUrl} (from org_ref: ${orgRef}, domain: ${baseDomain})`);
  return { baseUrl, baseDomain };
}

/**
 * Safely decode JWT without crashing on malformed tokens
 */
function safeDecodeJWT(token?: string): Record<string, any> | null {
  if (!token) {
    console.warn("[jwt] Missing token – will trigger full login");
    return null;
  }

  // Quick structural check: three Base64URL segments
  const parts = token.split(".");
  if (parts.length < 2) {
    console.warn("[jwt] Malformed token – expected 3 segments");
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
    console.log("[jwt] Valid payload decoded:", payload.sub ?? "anonymous");
    return payload;
  } catch (err) {
    console.warn("[jwt] Decode failed – invalid Base64:", (err as Error).message);
    return null;
  }
}

/**
 * Enable speed mode: block heavy resources during login/navigation
 */
async function enableSpeedMode(page: Page) {
  await page.route('**/*', route => {
    const t = route.request().resourceType();
    if (t === 'image' || t === 'media' || t === 'font' || t === 'stylesheet' || t === 'beacon') {
      return route.abort();
    }
    const url = route.request().url();
    if (/\b(googletagmanager|google-analytics|facebook|doubleclick|hotjar|clarity)\b/i.test(url)) {
      return route.abort();
    }
    return route.continue();
  });
  await page.setViewportSize({ width: 1280, height: 900 });
}

/**
 * Check if auth cookie exists
 */
async function hasAuthCookie(page: Page): Promise<boolean> {
  const cookies = await page.context().cookies();
  return cookies.some(c => /S?SESS/i.test(c.name));
}

/**
 * Wait for Drupal auth cookie to appear
 */
function waitForAuthCookie(page: Page, timeout = 10000): Promise<boolean> {
  return page.waitForFunction(() => {
    return document.cookie.includes('SSESS') || document.cookie.includes('SESS');
  }, { timeout }).then(() => true).catch(() => false);
}

/**
 * Probe /user endpoint to check if authenticated
 */
function probeUserEndpoint(page: Page, timeout = 10000): Promise<boolean> {
  return page.waitForFunction(async () => {
    try { 
      const r = await fetch('/user', { credentials: 'include' }); 
      return r.ok; 
    } catch { 
      return false; 
    }
  }, { timeout }).then(() => true).catch(() => false);
}

/**
 * Wait for login error message
 */
function waitForLoginError(page: Page, timeout = 8000): Promise<ElementHandle<HTMLElement | SVGElement>> {
  return page.waitForSelector('.messages--error, .alert-danger, .user-login-error', { timeout });
}

/**
 * Try to resume existing provider session
 */
async function tryResumeProviderSession(userId: string, credentialId: string | undefined, orgRef: string): Promise<{ isValid: true; session_token: string } | { isValid: false }> {
  // Skip if no credential_id (first-time login with email+password)
  if (!credentialId) {
    return { isValid: false };
  }
  
  try {
    const sessionKey = generateSessionKey(userId, credentialId, orgRef);
    const existing = await getSession();
    
    if (!existing?.newToken) {
      return { isValid: false as const };
    }

    console.log('[tryResumeProviderSession] Found existing session, validating...');
    
    // Get stored session data
    const { session } = existing;
    
    // Launch new browser session and try to restore state
    const newSession = await launchBrowserbaseSession();
    try {
      // Try to restore session state
      const restored = await restoreSessionState(newSession.page, sessionKey);
      if (!restored) {
        console.log('[tryResumeProviderSession] Could not restore session state');
        await closeBrowserbaseSession(newSession);
        return { isValid: false as const };
      }

      // Check for auth cookie
      const hasCookie = await hasAuthCookie(newSession.page);
      if (!hasCookie) {
        console.log('[tryResumeProviderSession] No auth cookie found');
        await closeBrowserbaseSession(newSession);
        return { isValid: false as const };
      }

      // Quick probe to verify session works
      const ok = await newSession.page.evaluate(async () => {
        try {
          const r = await fetch('/user', { method: 'GET', credentials: 'include' });
          return r.ok;
        } catch {
          return false;
        }
      });

      if (ok) {
        console.log('[tryResumeProviderSession] ✓ Session valid');
        // Keep session open and return token
        return { isValid: true as const, session_token: existing.newToken };
      }
      
      console.log('[tryResumeProviderSession] Session probe failed');
      await closeBrowserbaseSession(newSession);
      return { isValid: false as const };
    } catch (error) {
      await closeBrowserbaseSession(newSession);
      console.error('[tryResumeProviderSession] Validation error:', error);
      return { isValid: false as const };
    }
  } catch (error) {
    console.error('[tryResumeProviderSession] Error:', error);
    return { isValid: false as const };
  }
}

/**
 * Helper: Ensure user is logged in using dynamic base URL with FAST login detection
 */
async function ensureLoggedIn(
  session: any, 
  credential_id: string | undefined, 
  user_jwt: string, 
  baseUrl: string,
  userId: string,
  orgRef: string,
  email?: string,
  password?: string,
  auditParams?: { 
    tool_name?: string; 
    mandate_jws?: string;
    plan_id?: string;
    plan_execution_id?: string;
    session_token?: string;
  }
) {
  console.time('[login] total');
  
  // Handle both authentication methods
  let creds;
  
  if (credential_id) {
    console.log(`[ensureLoggedIn] Using stored credential_id=${credential_id}`);
    creds = await lookupCredentialsById(credential_id, user_jwt);
  } else if (email && password) {
    console.log(`[ensureLoggedIn] Using provided credentials for email=${email}`);
    creds = { email, password };
  } else {
    throw new Error('Must provide either credential_id OR email+password for login');
  }
  
  const { page } = session;

  console.log('DEBUG: Using credentials from cred-get:', creds.email);
  console.log('DEBUG: Attempting login to SkiClubPro at:', baseUrl);
  
  // Use UrlBuilder to resolve the correct login URL for this organization
  const urlBuilder = new UrlBuilder(orgRef);
  const loginUrl = urlBuilder.login(orgRef);
  
  console.log(`DEBUG: Resolved login URL via UrlBuilder: ${loginUrl}`);
  
  // Use the comprehensive login library with full anti-bot support
  const loginConfig: ProviderLoginConfig = {
    loginUrl,
    selectors: {
      username: ['#edit-name', 'input[name="name"]'],
      password: ['#edit-pass', 'input[name="pass"]'],
      submit: ['#edit-submit', 'button[type="submit"]', 'input[type="submit"]']
    },
    postLoginCheck: ['a:has-text("Log out")', 'a:has-text("Logout")'],
    timeout: 30000 // Use 30s timeout for anti-bot measures
  };

  // Call the proven login function that handles all anti-bot measures
  await loginWithCredentials(page, loginConfig, creds);

  console.timeEnd('[login] total');
  console.log(`DEBUG: Logged in as ${creds.email}`);
  return { email: creds.email, login_status: 'success' };
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
      mandate_jws: args.mandate_jws,
      plan_execution_id: args.plan_execution_id || null
    },
    args,
    async () => {
      // Resolve base URL and domain from org_ref or program_ref
      const { baseUrl, baseDomain } = resolveBaseUrl(args);
      
      // Extract org_ref for field discovery
      const orgRef = args?.org_ref || 'blackhawk-ski-club';
      
      // Extract user_id from JWT for session caching
      const userId = args.user_jwt ? JSON.parse(atob(args.user_jwt.split('.')[1])).sub : 'anonymous';
      
      const warmHintsPrereqs = args.warm_hints_prereqs || {};
      const warmHintsProgram = args.warm_hints_program || {};
      
      // Use _stage parameter (set by HTTP handler) or fall back to mode
      const stage = args._stage || args.mode || 'program';
      const runId = args._run_id || crypto.randomUUID();
      const P = stage === 'prereq' ? '[Prereq]' : '[Program]';
      
      console.log(`${P} run=${runId} start plan=${args.plan_id} base=${baseUrl} program=${args.program_ref}`);
      
      // STAGE: PREREQUISITES ONLY
      if (stage === 'prereq' || stage === 'prerequisites_only') {
        let prereqSession = null;
        
        try {
          console.log(`${P} Launching prerequisite-only session...`);
          prereqSession = await launchBrowserbaseSession();
          
          // Login for prerequisites
          const prereqLogin = await ensureLoggedIn(
            prereqSession, 
            args.credential_id, 
            args.user_jwt, 
            baseUrl, 
            userId, 
            orgRef,
            undefined,
            undefined,
            { 
              tool_name: 'scp.discover_required_fields (prereqs)', 
              mandate_jws: args.mandate_jws,
              plan_id: args.plan_id,
              plan_execution_id: args.plan_execution_id,
              session_token: args.session_token
            }
          );
          
          if (prereqLogin.login_status === 'failed') {
            throw new Error('Login failed for prerequisites - cannot proceed with discovery.');
          }
          
          // Import prerequisite discovery
          const { discoverPrerequisites } = await import('../lib/unified_discovery.js');
          
          const prereqResult = await discoverPrerequisites(
            prereqSession.page,
            orgRef,
            baseDomain,
            'skiclubpro',
            warmHintsPrereqs
          );
          
          console.log(`${P} Prerequisites complete: ${prereqResult.overallStatus} (${prereqResult.loopCount} loops)`);
          console.log(`${P} run=${runId} done status=${prereqResult.overallStatus}`);
          
          // Return prerequisites-only result matching FieldSchema
          return {
            program_ref: args.program_ref,
            prerequisite_status: prereqResult.overallStatus,
            program_questions: [],
            metadata: {
              url: baseUrl,
              field_count: 0,
              categories: [],
              discovered_at: new Date().toISOString(),
              // Additional metadata (not required by FieldSchema but useful)
              prerequisitesConfidence: prereqResult.confidence,
              prerequisitesLoops: prereqResult.loopCount,
              run: runId,
              stage: 'prereq'
            }
          } as FieldSchema;
          
        } catch (error) {
          console.error(`${P} Prerequisite stage failed:`, error);
          throw error;
        } finally {
          if (prereqSession) {
            await ensureLoggedOut(prereqSession);
            await closeBrowserbaseSession(prereqSession);
            console.log(`${P} Closed prerequisite session`);
          }
        }
      }
      
      // STAGE: PROGRAM QUESTIONS ONLY (full flow with child selection)
      let programSession = null;
      
      try {
        console.log(`${P} Launching program-only session...`);
        programSession = await launchBrowserbaseSession();
        
        // Login for program discovery
        const programLogin = await ensureLoggedIn(
          programSession,
          args.credential_id,
          args.user_jwt,
          baseUrl,
          userId,
          orgRef,
          undefined,
          undefined,
          { 
            tool_name: 'scp.discover_required_fields (program)', 
            mandate_jws: args.mandate_jws,
            plan_id: args.plan_id,
            plan_execution_id: args.plan_execution_id,
            session_token: args.session_token
          }
        );
        
        if (programLogin.login_status === 'failed') {
          throw new Error('Login failed for program discovery - cannot proceed.');
        }
        
        // Import program discovery functions
        const { navigateToProgramForm, discoverProgramFieldsMultiStep } = 
          await import('../lib/unified_discovery.js');
        
        // Navigate to program form (/registration/{program_id})
        await navigateToProgramForm(
          programSession.page,
          args.program_ref,
          baseDomain
        );
        
        // If child_name or child_id provided, try to select child (if selector exists)
        if (args.child_name || args.child_id) {
          console.log(`${P} Checking for child selection step: ${args.child_name || args.child_id}`);
          
          const page = programSession.page;
          
          // Check if child selection elements exist (with short timeout - may already be past this step)
          const childSelectorExists = await page.waitForSelector(
            'select[name*="child"], input[type="radio"][name*="child"]', 
            { timeout: 3000 }
          ).then(() => true).catch(() => false);
          
          if (childSelectorExists) {
            console.log(`${P} Child selector found - selecting child`);
            
            // Try to find and select child by ID or name
            if (args.child_id) {
              const childOption = await page.$(`option[value="${args.child_id}"]`);
              if (childOption) {
                await page.selectOption('select[name*="child"]', args.child_id);
                console.log(`${P} Selected child by ID: ${args.child_id}`);
              }
            } else if (args.child_name) {
              // Try selecting by visible text
              const selectElement = await page.$('select[name*="child"]');
              if (selectElement) {
                const options = await page.$$eval('select[name*="child"] option', (opts, name) => {
                  return opts.find(opt => opt.textContent?.includes(name));
                }, args.child_name);
                
                if (options) {
                  await page.selectOption('select[name*="child"]', { label: args.child_name });
                  console.log(`${P} Selected child by name: ${args.child_name}`);
                }
              }
            }
            
            // Click Next button to proceed to options page
            const nextButton = await page.$('button:has-text("Next"), input[type="submit"][value*="Next"]');
            if (nextButton) {
              await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }),
                nextButton.click()
              ]);
              console.log(`${P} Clicked Next, now on: ${page.url()}`);
            }
          } else {
            console.log(`${P} No child selector found - already on program questions page: ${page.url()}`);
          }
        }
        
        // Discover program fields (should now be on /registration/{program_id}/options or similar)
        const programResult = await discoverProgramFieldsMultiStep(
          programSession.page,
          args.program_ref,
          warmHintsProgram
        );
        
        console.log(`${P} Program fields found: ${programResult.fields.length} (${programResult.loopCount} loops)`);
        console.log(`${P} run=${runId} url=${programSession.page.url()} fields=${programResult.fields.length}`);
        
        // Return program-only result matching FieldSchema
        return {
          program_ref: args.program_ref,
          prerequisite_status: 'complete',
          program_questions: programResult.fields,
          metadata: {
            url: programSession.page.url(),
            field_count: programResult.fields.length,
            categories: [],
            discovered_at: new Date().toISOString(),
            // Additional metadata (not required by FieldSchema but useful)
            programConfidence: programResult.confidence,
            programLoops: programResult.loopCount,
            urlsVisited: programResult.urlsVisited,
            stops: programResult.stops,
            fieldsFound: programResult.fields.length,
            run: runId,
            stage: 'program'
          }
        } as FieldSchema;
        
      } catch (error) {
        console.error(`${P} Program discovery failed:`, error);
        
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
        if (programSession) {
          await ensureLoggedOut(programSession);
          await closeBrowserbaseSession(programSession);
          console.log(`${P} Closed program session`);
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

/**
 * Program Locator: Navigate from listing page to program form page
 * Based on proven patterns from old repos
 */
async function locateProgramPage(page: any, baseUrl: string, programName?: string): Promise<string> {
  const listPaths = ['/registration', '/programs', '/classes'];
  
  for (const path of listPaths) {
    const url = `${baseUrl}${path}`;
    try {
      console.log(`[ProgramLocator] Checking ${url} for programs...`);
      await page.goto(url, { waitUntil: "domcontentloaded" });
      
      // ✅ Check if Register buttons exist (non-blocking)
      const registerButtons = await page.locator("a.btn.btn-secondary.btn-sm:has-text('Register')").count();
      
      if (registerButtons === 0) {
        console.log(`[ProgramLocator] No Register buttons found on ${url} - staying on current page for Three-Pass Extractor`);
        return page.url(); // Stay here, let AI extractor handle it
      }
      
      const rows = await page.locator("table tr").all();
      console.log(`[ProgramLocator] Found ${rows.length} potential program rows`);
      
      for (const row of rows) {
        const title = await row.locator("td.views-field.views-field-title span.h5").textContent().catch(() => "");
        const price = await row.locator("td.views-field.views-field-price_number").textContent().catch(() => "");
        const link = row.locator("a.btn.btn-secondary.btn-sm:has-text('Register')");
        
        if (await link.count()) {
          const href = await link.getAttribute("href");
          if (href) {
            const dest = new URL(href, baseUrl).toString();
            console.log(`[ProgramLocator] ${title?.trim()} — ${price?.trim()} → ${dest}`);
            
            // If programName filter is set and matches, navigate to it
            if (!programName || title?.toLowerCase().includes(programName.toLowerCase())) {
              console.log(`[ProgramLocator] Found matching program, navigating to → ${dest}`);
              await page.goto(dest);
              return dest;
            }
          }
        }
      }
    } catch (e: any) {
      console.log(`[ProgramLocator] Could not load ${url}: ${e.message} - trying next path`);
    }
  }
  
  console.warn("[ProgramLocator] No program link found; staying on registration listing for extraction");
  return page.url();
}

/**
 * Get candidate registration paths based on user intent
 * Returns prioritized list of URLs to check for forms
 */
function getCandidatePathsForIntent(intent?: {
  category?: string;
  [key: string]: any;
}): string[] {
  if (!intent?.category) {
    return ['/registration', '/programs', '/classes'];
  }
  
  switch (intent.category) {
    case 'membership':
      return ['/membership', '/join', '/registration'];
    case 'lessons':
    case 'private':
      return ['/registration', '/programs', '/classes'];
    case 'camp':
    case 'race':
      return ['/camps', '/teams', '/programs', '/registration'];
    default:
      return ['/registration', '/programs', '/classes'];
  }
}

export const skiClubProTools = {
  'scp.discover_required_fields': scpDiscoverRequiredFields,

  'scp.check_account_status': async (args: { credential_id: string; org_ref?: string; email?: string; mandate_id?: string; plan_execution_id?: string }): Promise<ProviderResponse> => {
    // Stub implementation - returns expected format for edge function
    return {
      success: true,
      data: {
        status: 'active',
        account_exists: true,
        verified: true,
        credential_id: args.credential_id
      },
      meta: {
        tone_hints: "Be reassuring - the account exists and is ready to use.",
        next_actions: ["select_program"],
        prompt_version: PROMPT_VERSION
      },
      timestamp: new Date().toISOString()
    };
  },

  'scp.check_membership_status': async (args: { org_ref: string; mandate_id?: string; plan_execution_id?: string }): Promise<ProviderResponse> => {
    // Stub implementation - returns expected format for edge function
    return {
      success: true,
      data: {
        is_member: true,
        membership: 'active',
        expires_at: '2025-12-31',
        plan_type: 'family',
        org_ref: args.org_ref
      },
      meta: {
        tone_hints: "Celebrate - membership is active and ready! Use child's name if known.",
        next_actions: ["select_program"],
        prompt_version: PROMPT_VERSION
      },
      timestamp: new Date().toISOString()
    };
  },

  'scp.check_payment_method': async (args: { mandate_jws?: string; plan_execution_id?: string }): Promise<ProviderResponse> => {
    // Stub implementation - returns expected format for edge function
    return {
      success: true,
      data: {
        has_payment_method: true,
        payment_method: 'valid',
        card_last_four: '4242',
        card_type: 'visa',
        mandate_jws: args.mandate_jws
      },
      meta: {
        security_note: "Payment details are secure with the provider. We never see your full card number.",
        tone_hints: "Reassure parent that payment is set up and secure.",
        next_actions: ["proceed_to_registration"],
        prompt_version: PROMPT_VERSION
      },
      timestamp: new Date().toISOString()
    };
  },

  'scp.login': async (args: { 
    credential_id?: string; 
    user_jwt: string; 
    org_ref?: string; 
    email?: string; 
    password?: string; 
    mandate_jws?: string; 
    plan_execution_id?: string 
  }) => {
    return await auditToolCall(
      {
        tool: 'scp.login',
        mandate_jws: args.mandate_jws,
        plan_execution_id: args.plan_execution_id || null
      },
      args,
      async () => {
        let session = null;
        try {
          // Validate inputs - require either credential_id OR email+password
          if (!args.credential_id && (!args.email || !args.password)) {
            console.error("[scp.login] Missing authentication - must provide either credential_id OR email+password");
            throw new Error('credential_id or email+password is required for login');
          }
          if (!args.user_jwt) {
            console.error("[scp.login] Missing user_jwt in request");
            throw new Error('user_jwt is required');
          }
          
          if (args.credential_id) {
            console.log(`[scp.login] Launching Browserbase session with credential_id=${args.credential_id}`);
          } else {
            console.log(`[scp.login] Launching Browserbase session with email=${args.email}`);
          }
          
          const orgRef = args.org_ref || 'blackhawk-ski-club';
          const { baseUrl, baseDomain } = resolveBaseUrl({ org_ref: orgRef });
          
          // --- Hardened JWT handling (Lovable update) ---
          const jwtPayload = safeDecodeJWT(args.user_jwt);
          
          let userId: string;
          if (!jwtPayload) {
            console.log("[jwt] No valid JWT – proceeding with full login via Playwright");
            userId = '00000000-0000-0000-0000-000000000000'; // Fallback for smoke tests
          } else {
            console.log("[jwt] Using existing session for user:", jwtPayload.sub);
            userId = jwtPayload.sub;
          }
          
          console.log(`DEBUG: Starting login for org: ${orgRef}, baseUrl: ${baseUrl}`);
          
          // FAST-PATH: Check for reusable session first (only if credential_id provided)
          if (args.credential_id) {
            console.log('[scp.login] Checking for reusable session...');
            const resumed = await tryResumeProviderSession(userId, args.credential_id, orgRef);
            if (resumed.isValid) {
              console.log('[scp.login] ✓ Reusing existing session, skipping login');
              console.table({
                action: 'session_reused',
                user_id: userId,
                org_ref: orgRef,
                total_time: '~2s'
              });
              
              return {
              success: true,
              session_token: resumed.session_token,
              email: 'reused-session',
              login_status: 'success',
              cached: true,
              timestamp: new Date().toISOString(),
              message: 'Reused existing valid session'
            };
          }
            console.log('[scp.login] No reusable session, proceeding with login...');
          } else {
            console.log('[scp.login] First-time login (no credential_id), skipping session reuse');
          }
          
          console.log('[scp.login] Proceeding with fresh login');
          
          // Launch Browserbase session
          session = await launchBrowserbaseSession();
          console.log(`DEBUG: Browserbase session launched: ${session.sessionId}`);
          
          console.log("DEBUG: calling ensureLoggedIn with:", {
            credential_id: args.credential_id,
            user_jwt: args.user_jwt ? "[present]" : "[missing]",
            baseUrl,
            userId,
            orgRef,
          });

          // Perform login using FAST infrastructure
          const loginProof = await ensureLoggedIn(
            session,
            args.credential_id,
            args.user_jwt,
            baseUrl,
            userId,
            orgRef,
            args.email,
            args.password,
            { tool_name: 'scp.login', mandate_jws: args.mandate_jws }
          );
          
          console.log("✅ DEBUG: ensureLoggedIn result:", loginProof);
          console.log('DEBUG: Login successful, proof:', loginProof);
          console.log(`[scp.login] ✅ Login successful for ${orgRef}`);
          
          // Capture screenshot as evidence (if we have a plan_execution_id)
          if (args.plan_execution_id) {
            const screenshotBuffer = await captureScreenshot(session, `login_${orgRef}_${Date.now()}.png`);
            await captureScreenshotEvidence(args.plan_execution_id, screenshotBuffer, `login_${orgRef}`);
          }
          
          // Handle the different return types from ensureLoggedIn
          const email = typeof loginProof === 'object' && 'email' in loginProof ? loginProof.email : undefined;
          const cached = typeof loginProof === 'object' && 'cached' in loginProof ? loginProof.cached : false;
          const url = typeof loginProof === 'object' && 'url' in loginProof ? loginProof.url : undefined;
          
          // Extract cookies BEFORE closing Session A
          const cookies = await session.page.context().cookies();
          console.log(`[scp.login] Extracted ${cookies.length} cookies for Session B`);
          
          // Close Session A immediately
          console.log('[scp.login] Closing Session A...');
          await closeBrowserbaseSession(session);
          console.log('[scp.login] ✅ Session A closed');
          
          return {
            success: true,
            run_id: crypto.randomUUID(),
            login_status: 'success',
            message: 'Login successful via Browserbase',
            email: email || 'logged in',
            cached: cached,
            url: url || baseUrl,
            cookies: cookies,
            session_closed: true,
            timestamp: new Date().toISOString()
          };
          
        } catch (error) {
          console.error('Real login failed:', error);
          // Close session on error
          if (session) {
            await closeBrowserbaseSession(session);
          }
          throw new Error(`Login failed: ${error.message}`);
        }
      },
      'scp:authenticate' // Required scope for mandate verification
    );
  },

  'scp.program_field_probe': async (args: {
    org_ref: string;
    cookies: any[];
    intent?: {
      category?: string;
      day_pref?: string;
      time_pref?: string;
      level?: string;
      keywords?: string[];
    };
    user_jwt?: string;
  }): Promise<any> => {
    const runId = crypto.randomUUID();
    console.log(`[scp.program_field_probe] Starting Session B run_id=${runId}`);
    
    let session: any = null;
    
    try {
      // Launch Session B (field extraction only)
      console.log('[scp.program_field_probe] Launching Browserbase session (Session B)...');
      session = await launchBrowserbaseSession();
      const page = session.page;
      
      // Inject cookies from Session A
      console.log(`[scp.program_field_probe] Injecting ${args.cookies.length} cookies from Session A...`);
      await session.context.addCookies(args.cookies);
      console.log('[scp.program_field_probe] ✅ Authentication restored');
      
      const { baseUrl } = resolveBaseUrl({ org_ref: args.org_ref });
      
      // Navigate to registration page (authenticated)
      const candidatePaths = getCandidatePathsForIntent(args.intent);
      let targetUrl = '';
      
      for (const path of candidatePaths) {
        const url = `${baseUrl}${path}`;
        console.log(`[scp.program_field_probe] Checking ${url}...`);
        
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
          
          // Wait for page readiness
          const readiness = getReadiness('skiclubpro');
          await readiness(page);
          
          console.log(`[scp.program_field_probe] ✅ Page ready at ${url}`);
          targetUrl = url;
          break;
          
        } catch (err: any) {
          console.log(`[scp.program_field_probe] Page not ready at ${url}:`, err.message);
        }
      }
      
      if (!targetUrl) {
        throw new Error('Could not find ready program page');
      }
      
      // Run Three-Pass Extractor
      console.log('[scp.program_field_probe] Running Three-Pass Extractor...');
      const { runThreePassExtractor } = await import('../lib/threePassExtractor.js');
      
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY not configured');
      }
      
      const extractedData = await runThreePassExtractor(page, args.org_ref, 'skiclubpro');
      console.log(`[scp.program_field_probe] ✅ Extracted ${extractedData.length} programs`);
      
      // Capture screenshot
      const screenshot = await page.screenshot({ fullPage: true });
      
      // Close Session B
      console.log('[scp.program_field_probe] Closing Session B...');
      await closeBrowserbaseSession(session);
      console.log('[scp.program_field_probe] ✅ Session B closed');
      
      return {
        success: true,
        run_id: runId,
        target_url: targetUrl,
        extractor: {
          programs: extractedData,
          meta: {
            discovered_at: new Date().toISOString(),
            strategy: 'three-pass',
            readiness: 'affirmative'
          }
        },
        screenshot: screenshot.toString('base64')
      };
      
    } catch (error: any) {
      console.error(`[scp.program_field_probe] Failed:`, error);
      
      if (session) {
        await closeBrowserbaseSession(session).catch(err => 
          console.warn('[scp.program_field_probe] Error closing session:', err)
        );
      }
      
      return {
        success: false,
        run_id: runId,
        error: error.message
      };
    }
  },

  'scp.register': async (args: any): Promise<ProviderResponse> => {
    // Stub implementation
    return {
      success: true,
      data: {
        registration_id: 'reg_' + Date.now(),
        program_ref: args.program_ref
      },
      meta: {
        tone_hints: "Celebrate the success! Use child's name. Keep it brief and warm.",
        security_note: "All registration details have been confirmed with the provider.",
        next_actions: ["view_confirmation", "add_another_child"],
        prompt_version: PROMPT_VERSION
      },
      ui: {
        message: `✅ All set! ${args.child_name || 'Your child'} is registered for ${args.program_name || 'the program'}.`,
        cards: [{
          title: "Registration Complete",
          subtitle: args.program_name || "Program Registration",
          description: `Registration ID: reg_${Date.now()}`,
          metadata: { registration_id: 'reg_' + Date.now(), program_ref: args.program_ref },
          buttons: [
            { label: "View Details", action: "view_details", variant: "outline" }
          ]
        }]
      },
      timestamp: new Date().toISOString()
    };
  },

  /**
   * Create Mandate - Issues a signed mandate token for user authorization
   */
  'scp.create_mandate': async (args: {
    user_jwt: string;
    provider: string;
    org_ref: string;
    scope: string[];
    mandate_tier: 'discovery' | 'execution';
    valid_duration_minutes?: number;
    child_id?: string;
    program_ref?: string;
    max_amount_cents?: number;
  }) => {
    try {
      console.log('[scp.create_mandate] Creating mandate:', {
        provider: args.provider,
        org_ref: args.org_ref,
        mandate_tier: args.mandate_tier,
        scope: args.scope
      });

      // Decode JWT to get user_id
      const jwtPayload = safeDecodeJWT(args.user_jwt);
      if (!jwtPayload) {
        throw new Error('Invalid user_jwt - unable to decode');
      }
      const userId = jwtPayload.sub;

      // Import mandate functions
      const { issueMandate } = await import('../lib/mandates.js');

      // Generate mandate_id
      const mandateId = crypto.randomUUID();

      // Calculate validity period
      const validFrom = new Date();
      const durationMinutes = args.valid_duration_minutes || 1440;
      const validUntil = new Date(validFrom.getTime() + durationMinutes * 60 * 1000);

      // Calculate time_period based on duration (jose library expects '15m', '1h', '24h', etc.)
      const timePeriod = durationMinutes < 60 
        ? `${durationMinutes}m`
        : `${Math.floor(durationMinutes / 60)}h`;

      console.log(`[scp.create_mandate] Time period: ${timePeriod} (${durationMinutes} minutes)`);

      // Create mandate payload
      const mandatePayload = {
        mandate_id: mandateId,
        user_id: userId,
        provider: args.provider,
        scope: args.scope,
        child_id: args.child_id,
        program_ref: args.program_ref,
        max_amount_cents: args.max_amount_cents,
        valid_from: validFrom.toISOString(),
        valid_until: validUntil.toISOString(),
        time_period: timePeriod,
        credential_type: 'jws' as const
      };

      // Issue the JWS token
      const jws = await issueMandate(mandatePayload);

      // Store in mandates table (using existing schema columns only)
      const { error: insertError } = await supabase
        .from('mandates')
        .insert({
          id: mandateId,
          user_id: userId,
          provider: args.provider,
          scope: args.scope,
          status: 'active',
          credential_type: 'jws',
          jws_compact: jws, // Correct column name
          valid_from: validFrom.toISOString(),
          valid_until: validUntil.toISOString(),
          child_id: args.child_id,
          program_ref: args.program_ref,
          max_amount_cents: args.max_amount_cents
        });

      if (insertError) {
        console.error('[scp.create_mandate] Failed to store mandate:', insertError);
        throw new Error(`Failed to store mandate: ${insertError.message}`);
      }

      console.log(`[scp.create_mandate] Mandate issued for ${args.org_ref} (${timePeriod}, tier: ${args.mandate_tier || 'discovery'})`);

      // Return mandate details and consent message
      const consentMessage = args.mandate_tier === 'discovery'
        ? '🔍 Discovery Authorization: I authorize SignupAssist to access my account information, browse available programs, and check prerequisites. This authorization is read-only and does not permit any enrollments or payments.'
        : '⚡ Execution Authorization: I authorize SignupAssist to complete registrations and process payments on my behalf according to the parameters I specify. This is a secure, time-limited authorization.';

      return {
        success: true,
        mandate_id: mandateId,
        jws_token: jws,
        mandate_tier: args.mandate_tier, // Not stored in DB but returned for client
        valid_from: validFrom.toISOString(),
        valid_until: validUntil.toISOString(),
        scope: args.scope,
        consent_message: consentMessage,
        provider: args.provider,
        org_ref: args.org_ref,
        user_id: userId
      };
    } catch (error) {
      console.error('[scp.create_mandate] Error creating mandate:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create mandate'
      };
    }
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
      force_login?: boolean;
      category?: string;
    }): Promise<ProviderResponse<{ programs: any[] }>> => {
    const orgRef = args.org_ref || 'blackhawk-ski-club';
    
    console.log('[scp.find_programs] Incoming args:', {
      org_ref: args.org_ref,
      credential_id: args.credential_id,
      session_token: args.session_token,
      user_jwt: !!args.user_jwt
    });
    
    // If credentials or session token provided, use live Browserbase scraping
    if (args.credential_id || args.session_token) {
      console.log('[scp.find_programs] Using live Browserbase scraping');
      
      let session: any = null;
      let sessionToken = args.session_token;
      
      try {
        // Verify mandate includes required scope
        if (args.mandate_id) {
          try {
            await verifyMandate(args.mandate_id, 'scp:read:listings');
          } catch (mandateError) {
            console.error('[scp.find_programs] Mandate verification failed:', mandateError);
            return { 
              success: false,
              login_status: 'failed', 
              error: `Mandate verification failed: ${mandateError.message}`,
              timestamp: new Date().toISOString()
            };
          }
        }
        
        // Get base URL for organization
        const override = getOrgOverride(orgRef);
        const baseUrl = buildBaseUrl(orgRef, override.customDomain);
        
        // Try to restore session if token provided
        if (sessionToken) {
          console.log(`[scp.find_programs] 🔄 Attempting to reuse session from token: ${sessionToken}`);
          const restored = await getSession(sessionToken);
          if (restored && restored.session) {
            session = restored.session;
            sessionToken = restored.newToken;
            console.log(`[scp.find_programs] ✅ Successfully reused session (no new login needed)`);
          } else {
            console.log('[scp.find_programs] ⚠️ Session token not found or expired - will create new session');
          }
        }
        
        // If no session restored, launch new one and login
        if (!session) {
          console.log('[scp.find_programs] Launching new Browserbase session...');
          session = await launchBrowserbaseSession();
        
        // Login with credentials (only if new session)
          console.log('[scp.find_programs] Logging in...');
          const credentials = await lookupCredentialsById(args.credential_id, args.user_jwt);
          await session.page.goto(`${baseUrl}/user/login`, { waitUntil: 'networkidle' });
          await loginWithCredentials(session.page, skiClubProConfig, credentials, session.browser);
          
          // Wait for post-login redirect to settle (Drupal redirects to /dashboard)
          await session.page.waitForLoadState('networkidle');
          console.log(`[scp.find_programs] ✅ Login complete, page settled at: ${session.page.url()}`);
          
          // Store session for reuse
          sessionToken = generateToken();
          storeSession(sessionToken, session, 300000); // 5 min TTL
          console.log(`[scp.find_programs] 💾 Session stored with token: ${sessionToken} (valid for 5 min)`);
        }
        
        const loginResult = { login_status: 'success' };
        
        // ✅ Check login result
        if (loginResult.login_status === 'failed') {
          console.error('[scp.find_programs] Login failed');
          return { 
            success: false,
            login_status: 'failed', 
            error: 'Login failed - unable to authenticate. Try again with hard reset.',
            timestamp: new Date().toISOString()
          };
        }
        
        // ✅ Navigate to the correct programs listing page using UrlBuilder
        console.log('[scp.find_programs] Navigating to programs listing page...');
        const urlBuilder = new UrlBuilder(orgRef);
        const programsUrl = urlBuilder.programs(orgRef);
        console.log(`[scp.find_programs] Programs URL: ${programsUrl}`);
        
        await session.page.goto(programsUrl, { waitUntil: 'domcontentloaded' });
        
        // ✅ Wait for page to be fully ready with program table loaded
        console.log('[scp.find_programs] Waiting for page readiness...');
        const { waitForSkiClubProReady } = await import('./utils/skiclubproReadiness.js');
        await waitForSkiClubProReady(session.page);
        console.log('[scp.find_programs] ✅ Page ready, starting extraction...');
        
        const currentUrl = session.page.url();
        console.log(`[scp.find_programs] Current URL: ${currentUrl}`);
        
        // ✅ Three-Pass Extractor: AI-powered program extraction
        
        let scrapedPrograms: any[] = [];
        try {
          // Import the extractor
          const { runThreePassExtractor } = await import('../lib/threePassExtractor.js');
          
          // Verify OpenAI API key is configured
          if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY not configured for AI extraction');
          }
          
          // Run the Three-Pass Extractor on current page
          const page = session.page;
          scrapedPrograms = await runThreePassExtractor(page, orgRef, 'skiclubpro');
          
          console.log(`[scp.find_programs] ✅ Extracted ${scrapedPrograms.length} programs from ${page.url()}`);
          
          // Log warning if no programs found (should not happen after navigating to correct URL)
          if (scrapedPrograms.length === 0) {
            console.warn('[scp.find_programs] ⚠️ No programs found - this is unexpected after navigating to programs listing page');
          }
          
        } catch (extractorError) {
          console.error('[scp.find_programs] ❌ Three-Pass Extractor failed:', extractorError);
          // Continue with empty array if extraction fails
          scrapedPrograms = [];
        }
        
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
        
        // Programs already in expected format from Three-Pass Extractor
        let programs = scrapedPrograms;
        
        // Filter by category if provided
        if (args.category) {
          console.log(`[scp.find_programs] Filtering programs by category: ${args.category}`);
          const categoryLower = args.category.toLowerCase();
          programs = programs.filter(p => {
            const title = p.title?.toLowerCase() || '';
            const desc = p.description?.toLowerCase() || '';
            
            // Match category keywords
            if (categoryLower === 'lessons') {
              return title.includes('lesson') || title.includes('class') || desc.includes('instruction');
            }
            if (categoryLower === 'membership') {
              return title.includes('member') || desc.includes('membership');
            }
            if (categoryLower === 'camp') {
              return title.includes('camp') || desc.includes('summer');
            }
            if (categoryLower === 'race') {
              return title.includes('race') || title.includes('team');
            }
            if (categoryLower === 'private') {
              return title.includes('private');
            }
            return true;
          });
          console.log(`[scp.find_programs] Filtered to ${programs.length} programs matching "${args.category}"`);
        }
        
        console.log(`[scp.find_programs] ✓ Successfully scraped ${programs.length} programs`);
        
        return {
          success: true,
          login_status: 'success',
          session_token: sessionToken,
          data: {
            programs
          },
          timestamp: new Date().toISOString()
        };
        
      } catch (error) {
        console.error('[scp.find_programs] Live scraping failed:', error);
        
        return {
          success: false,
          login_status: 'failed',
          error: error.message || 'Unknown error during live scraping',
          timestamp: new Date().toISOString()
        };
        
      } finally {
        // Don't close session - keep it alive for next step (session will expire after 5 min)
        console.log('[scp.find_programs] Session kept alive for next step');
      }
    }
    
    // No credentials or session token - return static fallback data
    console.log('[scp.find_programs] No credential_id or session_token; returning static data');
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
      success: false,
      login_status: 'failed',
      data: {
        programs: filteredPrograms
      },
      error: 'No credentials provided - showing static fallback data',
      timestamp: new Date().toISOString()
    };
  },

  'scp.pay': async (args: any): Promise<ProviderResponse> => {
    // Stub implementation
    return {
      success: true,
      data: {
        payment_id: 'pay_' + Date.now(),
        amount: args.amount,
        status: 'completed'
      },
      meta: {
        security_note: "Payment processed securely through the provider. Card details never stored by SignupAssist.",
        tone_hints: "Confirm payment success clearly. Show amount and thank parent.",
        next_actions: ["complete_registration"],
        prompt_version: PROMPT_VERSION
      },
      ui: {
        message: `Payment of $${args.amount || '0.00'} processed successfully.`,
        cards: [{
          title: "Payment Confirmed",
          subtitle: `Amount: $${args.amount || '0.00'}`,
          description: "Your card has been charged. Receipt sent to email.",
          metadata: { payment_id: 'pay_' + Date.now(), amount: args.amount },
          buttons: []
        }]
      },
      timestamp: new Date().toISOString()
    };
  },

  'scp:list_children': async (args: {
    credential_id: string;
    user_jwt: string;
    org_ref: string;
    force_login?: boolean;
    mandate_jws?: string;
    plan_execution_id?: string;
  }) => {
    return await auditToolCall(
      {
        tool: 'scp.list_children',
        mandate_jws: args.mandate_jws,
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
          const { baseUrl, baseDomain } = resolveBaseUrl({ org_ref: orgRef });
          
          console.log(`[scp.login] Using unified domain: ${baseDomain}, baseUrl: ${baseUrl}`);
          
          // --- Hardened JWT handling ---
          const jwtPayload = safeDecodeJWT(args.user_jwt);
          
          let userId: string;
          if (!jwtPayload) {
            console.log("[jwt] No valid JWT for list_children – using fallback");
            userId = '00000000-0000-0000-0000-000000000000';
          } else {
            userId = jwtPayload.sub;
          }
          
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
              undefined,
              undefined,
              { tool_name: 'scp.list_children', mandate_jws: args.mandate_jws }
            );
          }
          
          // List children
          console.log('[scp:list_children] Listing children...');
          const children = await listChildren(page, baseUrl);
          
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
      const baseUrl = buildBaseUrl(orgRef, override.customDomain);
      
      console.log(`[scp:check_prerequisites] Starting checks for org: ${orgRef} (no mandate required)`);
      
      // Launch Browserbase session
      session = await launchBrowserbaseSession();
      const { page } = session;
      
      // Login with credentials
      console.log('[scp:check_prerequisites] Logging in...');
      const credentials = await lookupCredentialsById(args.credential_id, args.user_jwt);
      await session.page.goto(`${baseUrl}/user/login`, { waitUntil: 'networkidle' });
      await loginWithCredentials(session.page, skiClubProConfig, credentials, session.browser);
      const loginResult = { login_status: 'success' };
      
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
        baseUrl: baseUrl,
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