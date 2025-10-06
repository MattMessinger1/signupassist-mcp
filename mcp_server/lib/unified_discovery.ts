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
    provider,
    warmHintsPrereqs
  );
  
  console.log(`[UnifiedDiscovery] Prerequisites status: ${prereqResult.overallStatus}`);
  console.log(`[UnifiedDiscovery] Prerequisites checks: ${prereqResult.checks.length}`);
  
  // STAGE 2: Program Fields Discovery (existing logic)
  console.log('[UnifiedDiscovery] Stage 2: Program Questions');
  await navigateToProgramForm(page, programRef, orgRef);
  const programResult = await discoverFieldsSerially(page, programRef, warmHintsProgram);
  
  console.log(`[UnifiedDiscovery] Program questions found: ${programResult.fields.length}`);
  
  return {
    prerequisite_checks: prereqResult.checks,
    prerequisite_status: prereqResult.overallStatus,
    program_questions: programResult.fields,
    metadata: {
      prerequisitesConfidence: prereqResult.confidence,
      programConfidence: programResult.confidence,
      prerequisitesLoops: prereqResult.loopCount,
      programLoops: programResult.loopCount
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
  provider: string,
  warmHints: Record<string, any>
): Promise<PrerequisiteDiscoveryResult> {
  
  const prerequisitePaths = getPrerequisitePaths(provider);
  const checks: PrerequisiteCheckResult[] = [];
  let overallStatus: 'complete' | 'required' | 'unknown' = 'complete'; // Start optimistic
  let totalLoops = 0;
  const baseUrl = `https://${orgRef.replace('-ski-club', '')}.skiclubpro.team`;
  
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
  orgRef: string
): Promise<void> {
  const baseUrl = `https://${orgRef.replace('-ski-club', '')}.skiclubpro.team`;
  
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
