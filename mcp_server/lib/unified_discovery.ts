/**
 * Unified Serial Discovery Loop - Phase 2.5
 * Pure serial loops with stage-specific guardrails for Prerequisites and Program Fields
 * 
 * This replaces hardcoded semantic checkers with dynamic serial discovery loops.
 * Each stage has custom guardrails for safety and accuracy.
 */

import { Page } from 'playwright';
import { discoverFieldsSerially, SerialDiscoveryResult, DiscoveredField } from './serial_field_discovery.js';
import { humanPause } from './humanize.js';
import { getPrerequisitePaths, PrerequisitePath } from '../config/prerequisite_paths.js';
import { isPaymentButton, pageIndicatesPayment, capturePaymentEvidence, PaymentStopEvidence } from './guardrails.js';

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
  warmHintsProgram: Record<string, any> = {}
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
async function discoverPrerequisites(
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
 */
async function navigateToProgramForm(
  page: Page,
  programRef: string,
  baseDomain: string  // Unified domain
): Promise<void> {
  const baseUrl = `https://${baseDomain}`;
  
  console.log(`[ProgramNav] Using unified domain: ${baseDomain}, url: ${baseUrl}`);
  
  // Try common program registration paths
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
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await humanPause(300, 600);
      
      // Check if we're on a registration form
      const hasForm = await page.$('form, [role="form"]');
      if (hasForm) {
        console.log(`[UnifiedDiscovery] Found program form at: ${path}`);
        return;
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
async function discoverProgramFieldsMultiStep(
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
    console.log(`[ProgramMultiStep] Iteration ${i + 1}/${MAX_ITERATIONS}`);
    
    // Wait for network idle + settle time
    await page.waitForLoadState('networkidle').catch(() => {});
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
    
    // Collect all visible inputs
    const selector = 'input:visible, select:visible, textarea:visible, [contenteditable="true"]:visible, [name]:visible, [id]:visible, [data-drupal-selector]:visible';
    const elements = await page.locator(selector).all();
    
    let newFieldsThisStep = 0;
    for (const el of elements) {
      const name = await el.getAttribute('name').catch(() => '');
      const id = await el.getAttribute('id').catch(() => '');
      const type = await el.getAttribute('type').catch(() => 'text');
      
      const rawKey = name || id;
      if (!rawKey) continue;
      
      const fieldKey = normalizeFieldKey(rawKey);
      
      if (!allFields.has(fieldKey)) {
        newFieldsThisStep++;
        
        const label = await el.getAttribute('aria-label').catch(() => '') ||
                     await el.getAttribute('placeholder').catch(() => '') ||
                     humanizeFieldKey(fieldKey);
        
        allFields.set(fieldKey, {
          id: fieldKey,
          type: inferFieldType(type),
          label,
          required: await el.getAttribute('required').catch(() => null) !== null,
          seenAtSteps: [i + 1]
        });
      } else {
        // Field seen again, track step
        const existing = allFields.get(fieldKey)!;
        if (!existing.seenAtSteps.includes(i + 1)) {
          existing.seenAtSteps.push(i + 1);
        }
      }
    }
    
    console.log(`[ProgramMultiStep] Found ${newFieldsThisStep} new fields (total: ${allFields.size})`);
    
    // Track no-new-errors iterations
    if (newFieldsThisStep === 0) {
      noNewErrorsCount++;
    } else {
      noNewErrorsCount = 0;
    }
    
    // Stop if no new fields for 2 iterations
    if (noNewErrorsCount >= 2) {
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
    
    // Find Next/Continue/Confirm button
    const nextCandidates = await page.locator('button, input[type="submit"], a').all();
    let clickedNext = false;
    
    for (const candidate of nextCandidates) {
      const text = await candidate.textContent().catch(() => '');
      const lowerText = (text || '').toLowerCase();
      
      // Match Next/Continue/Confirm but NOT payment buttons
      if (/(next|continue|confirm|proceed|submit)/.test(lowerText)) {
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
        console.log(`[ProgramMultiStep] Clicking: "${text}"`);
        await candidate.click().catch(() => {});
        clickedNext = true;
        await humanPause(500, 800);
        
        // Track new URL if changed
        const newUrl = page.url();
        if (!urlsVisited.includes(newUrl)) {
          urlsVisited.push(newUrl);
        }
        
        break;
      }
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

function inferFieldType(type: string): 'select' | 'radio' | 'checkbox' | 'text' | 'date' | 'textarea' {
  if (type === 'select') return 'select';
  if (type === 'radio') return 'radio';
  if (type === 'checkbox') return 'checkbox';
  if (type === 'date') return 'date';
  if (type === 'textarea') return 'textarea';
  return 'text';
}
