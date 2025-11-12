/**
 * Unified Serial Discovery Loop - Phase 2.5
 * Pure serial loops with stage-specific guardrails for Prerequisites and Program Fields
 * 
 * This replaces hardcoded semantic checkers with dynamic serial discovery loops.
 * Each stage has custom guardrails for safety and accuracy.
 */

import { Page } from 'playwright-core';
import { discoverFieldsSerially, SerialDiscoveryResult, DiscoveredField } from './serial_field_discovery.js';
import { humanPause } from './humanize.js';
import { getPrerequisitePaths, PrerequisitePath } from '../config/prerequisite_paths.js';
import { isPaymentButton, pageIndicatesPayment, capturePaymentEvidence, PaymentStopEvidence } from './guardrails.js';
import { extractSingleStep } from '../agent/htmlToJsonSchema.js';
import { annotatePrice } from './pricing/annotatePrice.js';

export interface PrerequisiteCheckResult {
  id: string;           // 'membership', 'waiver', etc.
  label: string;        // 'Membership Status', 'Required Waivers'
  status: 'pass' | 'fail' | 'unknown';
  message: string;      // Human-readable status message
  fields: DiscoveredField[];  // Empty if complete, populated if form found
}

export interface UnifiedDiscoveryResult {
  prerequisite_checks: PrerequisiteCheckResult[];
  prerequisite_status: 'complete' | 'required' | 'unknown';
  program_questions: DiscoveredField[];
  metadata: {
    prerequisitesConfidence: number;
    programConfidence: number;
    prerequisitesLoops: number;
    programLoops: number;
    urlsVisited: string[];
    stops?: {
      reason: 'payment_detected' | 'success' | 'max_iterations' | 'no_new_errors';
      evidence?: PaymentStopEvidence;
    };
    fieldsFound: number;
  };
}

interface PrerequisiteDiscoveryResult {
  checks: PrerequisiteCheckResult[];
  overallStatus: 'complete' | 'required' | 'unknown';
  confidence: number;
  loopCount: number;
}

/**
 * Main orchestrator: Discover prerequisites first, then program fields
 */
export async function discoverAll(
  page: Page,
  programRef: string,
  orgRef: string,
  baseDomain: string,  // Unified domain (e.g., 'blackhawk.skiclubpro.team')
  provider: string,
  warmHintsPrereqs: Record<string, any> = {},
  warmHintsProgram: Record<string, any> = {},
  childName: string = ''  // Selected child name from PlanBuilder
): Promise<UnifiedDiscoveryResult> {
  
  console.log('[UnifiedDiscovery] Starting two-stage discovery...');
  
  console.log('[UnifiedDiscovery] Stage 1: Prerequisites');
  
  // STAGE 1: Prerequisites Discovery with custom guardrails
  const prereqResult = await discoverPrerequisites(
    page,
    orgRef,
    baseDomain,
    provider,
    warmHintsPrereqs
  );
  
  console.log(`[UnifiedDiscovery] Prerequisites status: ${prereqResult.overallStatus}`);
  console.log(`[UnifiedDiscovery] Prerequisites checks: ${prereqResult.checks.length}`);
  
  // STAGE 2: Program Fields Discovery with multi-step walking
  console.log('[UnifiedDiscovery] Stage 2: Program Questions');
  await navigateToProgramForm(page, programRef, baseDomain);
  const programResult = await discoverProgramFieldsMultiStep(page, programRef, warmHintsProgram);
  
  console.log(`[UnifiedDiscovery] Program questions found: ${programResult.fields.length}`);
  console.log(`[UnifiedDiscovery] URLs visited: ${programResult.urlsVisited.length}`);
  
  return {
    prerequisite_checks: prereqResult.checks,
    prerequisite_status: prereqResult.overallStatus,
    program_questions: programResult.fields,
    metadata: {
      prerequisitesConfidence: prereqResult.confidence,
      programConfidence: programResult.confidence,
      prerequisitesLoops: prereqResult.loopCount,
      programLoops: programResult.loopCount,
      urlsVisited: programResult.urlsVisited,
      stops: programResult.stops,
      fieldsFound: programResult.fields.length
    }
  };
}

/**
 * Discover prerequisites with stage-specific guardrails:
 * - GREEN LIGHT: Redirect to /programs or completion messages
 * - YELLOW LIGHT: Form fields discovered via serial loop
 * - SAFETY: Never click payment buttons
 */
export async function discoverPrerequisites(
  page: Page,
  orgRef: string,
  baseDomain: string,  // Unified domain
  provider: string,
  warmHints: Record<string, any>
): Promise<PrerequisiteDiscoveryResult> {
  
  const prerequisitePaths = getPrerequisitePaths(provider);
  const checks: PrerequisiteCheckResult[] = [];
  let overallStatus: 'complete' | 'required' | 'unknown' = 'complete'; // Start optimistic
  let totalLoops = 0;
  const baseUrl = `https://${baseDomain}`;
  
  console.log(`[PrereqDiscovery] Using unified domain: ${baseDomain}, baseUrl: ${baseUrl}`);
  console.log(`[PrereqDiscovery] Checking ${prerequisitePaths.length} prerequisite paths for provider: ${provider}`);
  
  for (const prereqPath of prerequisitePaths) {
    console.log(`[PrereqDiscovery] Checking ${prereqPath.label} (${prereqPath.id})...`);
    
    let checkStatus: 'pass' | 'fail' | 'unknown' = 'unknown';
    let checkMessage = '';
    const discoveredFields: DiscoveredField[] = [];
    
    // Try each possible path for this prerequisite
    for (const path of prereqPath.paths) {
      const url = `${baseUrl}${path}`;
      
      try {
        console.log(`[PrereqDiscovery] Navigating to ${path}...`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await humanPause(300, 600);
        
        // GUARDRAIL 1: Check for immediate redirect to programs (GREEN LIGHT)
        const currentUrl = page.url().toLowerCase();
        if (currentUrl.includes('/programs') || currentUrl.includes('/register')) {
          console.log(`✓ ${prereqPath.label} complete (redirected to ${currentUrl})`);
          checkStatus = 'pass';
          checkMessage = 'No form found - already complete';
          break; // Found answer for this prerequisite
        }
        
        // GUARDRAIL 2: Check for completion message (GREEN LIGHT)
        const bodyText = await page.textContent('body').catch(() => '');
        const completionPatterns = [
          /membership.*active/i,
          /current.*membership/i,
          /waiver.*signed/i,
          /waiver.*on\s+file/i,
          /payment.*on\s+file/i,
          /card\s+ending/i
        ];
        
        if (completionPatterns.some(rx => rx.test(bodyText))) {
          console.log(`✓ ${prereqPath.label} complete (completion message found)`);
          checkStatus = 'pass';
          checkMessage = 'Completion message detected - already active';
          break; // Found answer for this prerequisite
        }
        
        // GUARDRAIL 3: Run serial loop to discover form fields (YELLOW LIGHT)
        console.log(`⚠ ${prereqPath.label} check: running serial discovery...`);
        const result = await discoverFieldsSerially(page, `prereq_${prereqPath.id}`, warmHints);
        
        if (result.fields.length > 0) {
          console.log(`⚠ ${prereqPath.label} required (${result.fields.length} fields discovered)`);
          checkStatus = 'fail';
          checkMessage = `Action required - ${result.fields.length} field(s) found`;
          
          for (const field of result.fields) {
            const enhancedField: DiscoveredField = {
              ...field,
              category: 'prerequisite',
              // @ts-ignore - add custom property
              prerequisite_type: prereqPath.id
            };
            discoveredFields.push(enhancedField);
          }
          totalLoops += result.loopCount;
          break; // Found answer for this prerequisite
        } else {
          // No fields found = no form present = complete
          console.log(`✓ ${prereqPath.label} complete (no form found)`);
          checkStatus = 'pass';
          checkMessage = 'No form found - already complete';
          break; // Found answer for this prerequisite
        }
        
      } catch (err: any) {
        console.warn(`Could not check ${path}:`, err.message);
        // Try next path for this prerequisite
      }
    }
    
    // If still unknown after trying all paths, mark as pass (assume complete)
    if (checkStatus === 'unknown') {
      checkStatus = 'pass';
      checkMessage = 'Could not verify - assuming complete';
    }
    
    // Add this check to results
    checks.push({
      id: prereqPath.id,
      label: prereqPath.label,
      status: checkStatus,
      message: checkMessage,
      fields: discoveredFields
    });
    
    // Update overall status
    if (checkStatus === 'fail') {
      overallStatus = 'required';
    }
  }
  
  console.log(`[PrereqDiscovery] Completed ${checks.length} checks. Overall status: ${overallStatus}`);
  
  return {
    checks,
    overallStatus,
    confidence: checks.every(c => c.status === 'pass') ? 1.0 : 0.8,
    loopCount: totalLoops
  };
}

/**
 * Navigate to program registration form
 * For SkiClubPro, try /registration listing with scrolling first
 */
export async function navigateToProgramForm(
  page: Page,
  programRef: string,
  baseDomain: string,  // Unified domain
  programUrl?: string  // Direct URL to program (from cta_href)
): Promise<void> {
  // If direct URL provided, use it immediately
  if (programUrl) {
    console.log(`[ProgramNav] Using direct URL: ${programUrl}`);
    await page.goto(programUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanPause(500, 800);
    return;
  }
  
  const baseUrl = `https://${baseDomain}`;
  
  console.log(`[ProgramNav] Using unified domain: ${baseDomain}, url: ${baseUrl}`);
  
  // For SkiClubPro, try /registration listing first (with scrolling to load all programs)
  if (baseDomain.includes('skiclubpro')) {
    try {
      const registrationUrl = `${baseUrl}/registration`;
      console.log(`[ProgramNav] Opening /registration listing: ${registrationUrl}`);
      await page.goto(registrationUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await humanPause(500, 800);
      
      // Scroll to load all rows/cards (many sites lazy-load)
      console.log('[ProgramNav] Scrolling to load all programs...');
      await page.evaluate(async () => {
        for (let i = 0; i < 10; i++) {
          window.scrollBy(0, window.innerHeight);
          await new Promise(r => setTimeout(r, 500));
        }
      });
      await humanPause(500, 800);
      
      // Try finding program by ID in href first
      let link = page.locator(`a[href*="/registration/${programRef}/"], a[href*="/registration/${programRef}"]`).first();
      let linkCount = await link.count();
      
      // If not found by ID, try by program name (for program 309 = "Wednesday Nordic Kids")
      if (!linkCount) {
        console.log(`[ProgramNav] Program ${programRef} not found by ID, trying by text...`);
        const programNames: Record<string, string> = {
          '309': 'Wednesday Nordic Kids'
        };
        
        if (programNames[programRef]) {
          link = page.locator(`a:has-text("${programNames[programRef]}")`).first();
          linkCount = await link.count();
        }
      }
      
      if (linkCount > 0) {
        console.log(`[ProgramNav] Found program ${programRef} on /registration listing — clicking link...`);
        await link.click({ timeout: 10000 });
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await humanPause(800, 1200);
        
        // Check if we landed on registration form
        const hasForm = await page.$([
          'form[action*="register"]',
          'form[id*="register"]',
          'form[action*="registration"]',
          'form[id*="registration"]',
          '.webform-submission-form',
          '[id*="registration"]'
        ].join(', '));
        
        if (hasForm) {
          console.log(`[ProgramNav] ✓ Successfully navigated to program ${programRef} registration form`);
          return;
        }
      } else {
        console.warn(`[ProgramNav] Could not find program ${programRef} on /registration listing`);
      }
    } catch (err: any) {
      console.warn(`[ProgramNav] /registration navigation failed:`, err.message);
    }
  }
  
  // Fallback: Try common program registration paths
  const programPaths = [
    `/programs/${programRef}/register`,
    `/register/${programRef}`,
    `/programs/${programRef}`,
    `/programs`
  ];
  
  for (const path of programPaths) {
    try {
      const url = `${baseUrl}${path}`;
      console.log(`[UnifiedDiscovery] Trying program URL: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await humanPause(300, 600);
      
      // Stricter: only treat as registration if the form looks like "register" / "registration"
      const hasRegistrationForm = await page.$([
        'form[action*="register"]',
        'form[id*="register"]',
        'form[action*="registration"]',
        'form[id*="registration"]',
        '.webform-submission-form',
        '[id*="registration"]'
      ].join(', '));
      if (hasRegistrationForm) {
        console.log(`[UnifiedDiscovery] Found registration form at: ${path}`);
        return;
      }
      
      // If we're on the listing, drill into the specific program and then Register
      if (path === '/programs') {
        console.log(`[ProgramNav] On /programs listing, searching for program ${programRef}…`);
        await page.waitForLoadState('networkidle').catch(() => {});
        await humanPause(500, 800);

        // 1) Try direct, specific selectors first
        const programLinkSelectors = [
          `a[href*="/programs/${programRef}"]`,
          `a[href*="/program/${programRef}"]`,
          `[data-program-id="${programRef}"] a`,
          `.program-card a[href*="${programRef}"]`
        ];

        let clicked = false;
        for (const sel of programLinkSelectors) {
          console.log(`[ProgramNav] Trying selector: ${sel}`);
          clicked = await page.locator(sel).first().click({ timeout: 5000 }).then(() => true).catch(() => false);
          if (clicked) {
            console.log(`[ProgramNav] ✓ Clicked into program ${programRef}`);
            await page.waitForLoadState('networkidle').catch(() => {});
            await humanPause(700, 1000);
            break;
          }
        }

        // 2) Fallback: enumerate anchors; click the one whose href contains the programRef
        if (!clicked) {
          // SkiClubPro uses /registration/{id} format, not /program or /programs
          const links = await page.locator('a[href*="/registration/"]').all();
          console.log(`[ProgramNav] Found ${links.length} registration links; scanning for /registration/${programRef}`);
          for (const a of links) {
            const href = (await a.getAttribute('href').catch(() => '')) || '';
            if (href.includes(`/registration/${programRef}`) || href.match(new RegExp(`/registration/${programRef}(?:/|$)`))) {
              console.log(`[ProgramNav] Fallback click: ${href}`);
              clicked = await a.click({ timeout: 5000 }).then(() => true).catch(() => false);
              if (clicked) {
                await page.waitForLoadState('networkidle').catch(() => {});
                await humanPause(700, 1000);
                break;
              }
            }
          }
        }

        // 3) If we're inside a program page, click Register if present
        if (clicked) {
          const registerClicked = await page
            .locator('a:has-text("Register"), button:has-text("Register"), a[href*="/register"]')
            .first()
            .click({ timeout: 5000 })
            .then(() => true)
            .catch(() => false);
          if (registerClicked) {
            console.log(`[ProgramNav] ✓ Clicked Register`);
            await page.waitForLoadState('networkidle').catch(() => {});
            await humanPause(500, 900);
            return;
          }
        } else {
          console.log(`[ProgramNav] ⚠ Could not find program ${programRef} on listing page`);
        }
      }
    } catch (err: any) {
      console.warn(`Could not navigate to ${path}:`, err.message);
    }
  }
  
  console.warn('[UnifiedDiscovery] Could not find program registration form');
}

/**
 * Multi-step program field discovery with payment guardrails
 */
export async function discoverProgramFieldsMultiStep(
  page: Page,
  programRef: string,
  warmHints: Record<string, any>
): Promise<{
  fields: DiscoveredField[];
  loopCount: number;
  confidence: number;
  urlsVisited: string[];
  stops?: { reason: 'payment_detected' | 'success' | 'max_iterations' | 'no_new_errors'; evidence?: PaymentStopEvidence };
}> {
  const urlsVisited: string[] = [page.url()];
  const allFields = new Map<string, DiscoveredField & { seenAtSteps: number[] }>();
  let loopCount = 0;
  let noNewErrorsCount = 0;
  const MAX_ITERATIONS = 10;
  
  console.log('[ProgramMultiStep] Starting multi-step discovery...');
  
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    loopCount++;
    const prevUrl = page.url();
    console.log(`[ProgramMultiStep] Iteration ${i + 1}/${MAX_ITERATIONS}, URL: ${prevUrl}`);
    
    // Wait for network idle + settle time for dynamic JS rendering
    await Promise.race([
      page.waitForLoadState('networkidle').catch(() => {}),
      page.waitForTimeout(2000)
    ]);
    await humanPause(1200, 1400);
    
    // Check payment page guard (post-navigation)
    if (await pageIndicatesPayment(page)) {
      console.log('[ProgramMultiStep] 🛑 Payment page detected - stopping');
      const evidence = await capturePaymentEvidence(page, 'payment_page');
      return {
        fields: Array.from(allFields.values()).map(f => {
          const { seenAtSteps, ...field } = f;
          return field;
        }),
        loopCount,
        confidence: 0.7,
        urlsVisited,
        stops: { reason: 'payment_detected', evidence }
      };
    }
    
    // === FAST EXTRACTION ATTEMPT (PRIMARY PATH) ===
    let newFieldsThisStep = 0;
    let fieldsFoundThisStep = 0; // Track total fields found (including duplicates)
    
    try {
      console.log(`[ProgramMultiStep] Trying fast extraction (htmlToJsonSchema)...`);
      const quickSchema = await extractSingleStep(page, `step${i + 1}`);
      const quickFields = Object.entries(quickSchema.properties).map(([id, prop]: [string, any]) => ({
        id,
        label: prop.title || id,
        type: inferFieldType(prop),
        required: quickSchema.required.includes(id),
        options: prop.enum ? prop.enum.map((v: string, idx: number) => ({
          value: v,
          label: prop['x-enumNames']?.[idx] || v
        })) : undefined
      }));
      
      fieldsFoundThisStep = quickFields.length;
      
      if (quickFields.length > 0) {
        console.log(`[ProgramMultiStep] ✅ Fast extraction found ${quickFields.length} fields`);
        
        // Annotate price-bearing fields
        const annotatedFields = quickFields.map(f => annotatePrice(f));
        
        // Merge into allFields map
        for (const field of annotatedFields) {
          const existing = allFields.get(field.id);
          if (existing) {
            existing.seenAtSteps.push(i + 1);
          } else {
            allFields.set(field.id, { ...field, seenAtSteps: [i + 1], label: field.label || field.id });
            newFieldsThisStep++;
          }
        }
        
        console.log(`[ProgramMultiStep] Found ${newFieldsThisStep} new fields (total: ${allFields.size})`);
      } else {
        console.log('[ProgramMultiStep] Fast extraction found no fields');
      }
    } catch (err) {
      console.log('[ProgramMultiStep] Fast extraction failed:', err);
    }
    
    // === SERIAL DISCOVERY (FALLBACK PATH) ===
    // Only run if fast extraction found NOTHING (not just no new fields)
    if (fieldsFoundThisStep === 0) {
      console.log('[ProgramMultiStep] Running serial field discovery (fallback)...');
      
      // Collect all visible *form* fields only (no generic [name]/[id])
      const selector = 'input, select, textarea, [contenteditable="true"], button[type="submit"]';
      const elements = await page.locator(selector).all();
      
      for (const el of elements) {
        // Skip if not visible
        const isVisible = await el.isVisible().catch(() => false);
        if (!isVisible) continue;
        
        // Identify tag/type to exclude non-controls and non-submit buttons
        const tagName = await el.evaluate((node) => node.tagName.toLowerCase()).catch(() => '');
        const type = await el.getAttribute('type').catch(() => 'text');
        
        // Allow inputs, selects, textareas, submit buttons, or contenteditable nodes only
        if (!['input', 'select', 'textarea', 'button'].includes(tagName)) {
          const isContentEditable = (await el.getAttribute('contenteditable').catch(() => '')) === 'true';
          if (!isContentEditable) continue;
        }
        if (tagName === 'button' && type !== 'submit') continue;
        if (tagName === 'input' && type === 'hidden') continue;
        
        const name = await el.getAttribute('name').catch(() => '');
        const id = await el.getAttribute('id').catch(() => '');
        const ariaLabel = await el.getAttribute('aria-label').catch(() => '');
        const placeholder = await el.getAttribute('placeholder').catch(() => '');
        
        // Try to get label by ID
        let labelText = '';
        if (id) {
          const label = await page.locator(`label[for="${id}"]`).first().textContent().catch(() => '');
          labelText = label || '';
        }
        
        const rawKey = name || id || ariaLabel || labelText;
        if (!rawKey) continue;
        
        // Filter obvious layout/navigation keys that occasionally sneak in
        const layoutKeywords = ['sidebar', 'menu', 'block', 'wrapper', 'container', 'collapse', 'dashboard', 'nav'];
        if (layoutKeywords.some(kw => rawKey.toLowerCase().includes(kw))) continue;
        
        const fieldKey = normalizeFieldKey(rawKey);
        
        if (!allFields.has(fieldKey)) {
          newFieldsThisStep++;
          
          const label = labelText || ariaLabel || placeholder || humanizeFieldKey(fieldKey);
          
          allFields.set(fieldKey, {
            id: fieldKey,
            type: inferFieldType(type),
            label,
            required: await el.getAttribute('required').catch(() => null) !== null,
            seenAtSteps: [i + 1]
          });
          
          console.log(`[ProgramMultiStep] New field: ${fieldKey} (${label})`);
        } else {
          // Field seen again, track step
          const existing = allFields.get(fieldKey)!;
          if (!existing.seenAtSteps.includes(i + 1)) {
            existing.seenAtSteps.push(i + 1);
          }
        }
      }
    } // End of serial discovery fallback
    
    console.log(`[ProgramMultiStep] Found ${newFieldsThisStep} new fields (total: ${allFields.size})`);
    
    // Track no-new-errors iterations
    if (newFieldsThisStep === 0) {
      noNewErrorsCount++;
    } else {
      noNewErrorsCount = 0;
    }
    
    // Early exit: no new fields for 2 iterations
    if (newFieldsThisStep === 0 && i > 0 && noNewErrorsCount >= 2) {
      console.log('[ProgramMultiStep] No new fields for 2 iterations - stopping');
      return {
        fields: Array.from(allFields.values()).map(f => {
          const { seenAtSteps, ...field } = f;
          return field;
        }),
        loopCount,
        confidence: 0.85,
        urlsVisited,
        stops: { reason: 'no_new_errors' }
      };
    }
    
    // Check for success indicators
    const bodyText = await page.textContent('body').catch(() => '');
    if (/thank\s*you|success|confirmation|complete/i.test(bodyText)) {
      console.log('[ProgramMultiStep] Success indicators detected - stopping');
      return {
        fields: Array.from(allFields.values()).map(f => {
          const { seenAtSteps, ...field } = f;
          return field;
        }),
        loopCount,
        confidence: 0.9,
        urlsVisited,
        stops: { reason: 'success' }
      };
    }
    
    // Find Next/Continue/Confirm button with broad candidates
    const nextCandidates = [
      'button[type="submit"]:visible',
      'button:has-text("Next"):visible',
      'button:has-text("Continue"):visible',
      'a:has-text("Next"):visible',
      'button:has-text("Confirm"):visible',
      'button:has-text("Proceed"):visible',
      'button:has-text("Register"):visible',
      'button:has-text("Submit"):visible'
    ];
    
    let clickedNext = false;
    
    for (const selector of nextCandidates) {
      const candidates = await page.locator(selector).all();
      
      for (const candidate of candidates) {
        const isVisible = await candidate.isVisible().catch(() => false);
        if (!isVisible) continue;
        
        const text = await candidate.textContent().catch(() => '');
        
        // Pre-click payment guard
        if (await isPaymentButton(candidate)) {
          console.log('[ProgramMultiStep] 🛑 Payment button detected - stopping');
          const buttonText = text || '';
          const evidence = await capturePaymentEvidence(page, 'payment_button', buttonText);
          return {
            fields: Array.from(allFields.values()).map(f => {
              const { seenAtSteps, ...field } = f;
              return field;
            }),
            loopCount,
            confidence: 0.7,
            urlsVisited,
            stops: { reason: 'payment_detected', evidence }
          };
        }
        
        // Safe to click
        console.log(`[ProgramMultiStep] Clicking: "${text}" (selector: ${selector})`);
        await candidate.click().catch(() => {});
        clickedNext = true;
        await humanPause(500, 800);
        
        // Wait for navigation/rendering with Promise.race
        await Promise.race([
          page.waitForURL((url: URL) => url.toString() !== prevUrl, { timeout: 8000 }).catch(() => {}),
          page.waitForLoadState('networkidle').catch(() => {}),
          page.waitForTimeout(1200)
        ]);
        
        // Track new URL if changed
        const newUrl = page.url();
        if (!urlsVisited.includes(newUrl)) {
          urlsVisited.push(newUrl);
          console.log('[ProgramMultiStep] Navigated to new URL:', newUrl);
        }
        
        // Post-click payment guard
        if (await pageIndicatesPayment(page)) {
          console.log('[ProgramMultiStep] 🛑 Payment page detected after click - stopping');
          const evidence = await capturePaymentEvidence(page, 'payment_page');
          return {
            fields: Array.from(allFields.values()).map(f => {
              const { seenAtSteps, ...field } = f;
              return field;
            }),
            loopCount,
            confidence: 0.7,
            urlsVisited,
            stops: { reason: 'payment_detected', evidence }
          };
        }
        
        break;
      }
      
      if (clickedNext) break;
    }
    
    // If we didn't click anything, we're done
    if (!clickedNext) {
      console.log('[ProgramMultiStep] No next button found - stopping');
      return {
        fields: Array.from(allFields.values()).map(f => {
          const { seenAtSteps, ...field } = f;
          return field;
        }),
        loopCount,
        confidence: 0.8,
        urlsVisited,
        stops: { reason: 'no_new_errors' }
      };
    }
  }
  
  // Max iterations reached
  console.log('[ProgramMultiStep] Max iterations reached');
  return {
    fields: Array.from(allFields.values()).map(f => {
      const { seenAtSteps, ...field } = f;
      return field;
    }),
    loopCount,
    confidence: 0.75,
    urlsVisited,
    stops: { reason: 'max_iterations' }
  };
}

// Helper functions
function normalizeFieldKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function humanizeFieldKey(key: string): string {
  return key
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function inferFieldType(prop: any): 'select' | 'radio' | 'checkbox' | 'text' | 'date' | 'textarea' | 'number' {
  const type = prop.type || 'string';
  
  // JSON Schema uses type:"string" + enum for selects/radios
  if (prop.enum && prop.enum.length > 0) {
    // Check if it's radio or select based on metadata
    const metadata = prop['x-metadata'];
    if (metadata?.selector?.includes('[type="radio"]')) return 'radio';
    return 'select';  // Default to select for enum fields
  }
  
  if (type === 'boolean' || prop.type === 'checkbox') return 'checkbox';
  if (type === 'number') return 'number';
  if (prop['x-metadata']?.selector?.includes('textarea')) return 'textarea';
  if (prop['x-metadata']?.selector?.includes('[type="date"]')) return 'date';
  
  return 'text';
}
