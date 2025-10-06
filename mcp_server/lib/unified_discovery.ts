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

export interface UnifiedDiscoveryResult {
  prerequisites: DiscoveredField[];
  prerequisite_status: 'complete' | 'required' | 'unknown';
  prerequisite_message?: string;
  program_questions: DiscoveredField[];
  metadata: {
    prerequisitesConfidence: number;
    programConfidence: number;
    prerequisitesLoops: number;
    programLoops: number;
  };
}

interface PrerequisiteDiscoveryResult {
  fields: DiscoveredField[];
  status: 'complete' | 'required' | 'unknown';
  message: string;
  confidence: number;
  loopCount: number;
}

const PREREQUISITE_PATHS = ['/membership', '/waiver', '/user/payment-methods'];
const MAX_LOOPS_PER_PATH = 10;

/**
 * Main orchestrator: Discover prerequisites first, then program fields
 */
export async function discoverAll(
  page: Page,
  programRef: string,
  orgRef: string,
  warmHintsPrereqs: Record<string, any> = {},
  warmHintsProgram: Record<string, any> = {}
): Promise<UnifiedDiscoveryResult> {
  
  console.log('[UnifiedDiscovery] Starting two-stage discovery...');
  console.log('[UnifiedDiscovery] Stage 1: Prerequisites');
  
  // STAGE 1: Prerequisites Discovery with custom guardrails
  const prereqResult = await discoverPrerequisites(
    page,
    orgRef,
    warmHintsPrereqs
  );
  
  console.log(`[UnifiedDiscovery] Prerequisites status: ${prereqResult.status}`);
  console.log(`[UnifiedDiscovery] Prerequisites fields found: ${prereqResult.fields.length}`);
  
  // STAGE 2: Program Fields Discovery (existing logic)
  console.log('[UnifiedDiscovery] Stage 2: Program Questions');
  await navigateToProgramForm(page, programRef, orgRef);
  const programResult = await discoverFieldsSerially(page, programRef, warmHintsProgram);
  
  console.log(`[UnifiedDiscovery] Program questions found: ${programResult.fields.length}`);
  
  return {
    prerequisites: prereqResult.fields,
    prerequisite_status: prereqResult.status,
    prerequisite_message: prereqResult.message,
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
  warmHints: Record<string, any>
): Promise<PrerequisiteDiscoveryResult> {
  
  const allFields = new Map<string, DiscoveredField>();
  let overallStatus: 'complete' | 'required' | 'unknown' = 'unknown';
  let totalLoops = 0;
  const baseUrl = `https://${orgRef.replace('-ski-club', '')}.skiclubpro.team`;
  
  console.log('[PrereqDiscovery] Checking prerequisite paths...');
  
  for (const path of PREREQUISITE_PATHS) {
    const url = `${baseUrl}${path}`;
    
    try {
      console.log(`[PrereqDiscovery] Navigating to ${path}...`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await humanPause(300, 600);
      
      // GUARDRAIL 1: Check for immediate redirect to programs (GREEN LIGHT)
      const currentUrl = page.url().toLowerCase();
      if (currentUrl.includes('/programs') || currentUrl.includes('/register')) {
        console.log(`✓ ${path} prerequisite complete (redirected to ${currentUrl})`);
        overallStatus = 'complete';
        continue; // Skip to next path
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
        console.log(`✓ ${path} prerequisite complete (completion message found)`);
        overallStatus = 'complete';
        continue; // Skip to next path
      }
      
      // GUARDRAIL 3: Run serial loop to discover form fields (YELLOW LIGHT)
      console.log(`⚠ ${path} prerequisite check: running serial discovery...`);
      const result = await discoverFieldsSerially(page, `prereq_${path}`, warmHints);
      
      if (result.fields.length > 0) {
        console.log(`⚠ ${path} prerequisite required (${result.fields.length} fields discovered)`);
        for (const field of result.fields) {
          const enhancedField: DiscoveredField = {
            ...field,
            category: 'prerequisite',
            // @ts-ignore - add custom property
            prerequisite_type: path.replace('/', '')
          };
          allFields.set(field.id, enhancedField);
        }
        overallStatus = 'required'; // At least one prerequisite needs completion
        totalLoops += result.loopCount;
      }
      
      // GUARDRAIL 4: Check for redirect after discovery (GREEN LIGHT)
      if (page.url().includes('/programs')) {
        console.log(`✓ Redirected to programs after ${path}, stopping prerequisite discovery`);
        break;
      }
      
    } catch (err: any) {
      console.warn(`Could not check ${path}:`, err.message);
      // Continue to next path (don't fail entire discovery)
    }
  }
  
  // FINAL STATUS DETERMINATION
  const fieldsArray = Array.from(allFields.values());
  
  if (overallStatus === 'complete' && fieldsArray.length === 0) {
    return {
      fields: [],
      status: 'complete',
      message: 'All prerequisites complete! ✓',
      confidence: 1.0,
      loopCount: totalLoops
    };
  } else if (fieldsArray.length > 0) {
    return {
      fields: fieldsArray,
      status: 'required',
      message: `${fieldsArray.length} prerequisite field(s) must be completed`,
      confidence: 0.8,
      loopCount: totalLoops
    };
  } else {
    return {
      fields: [],
      status: 'unknown',
      message: 'Could not determine prerequisite status',
      confidence: 0.0,
      loopCount: totalLoops
    };
  }
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
