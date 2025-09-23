/**
 * SkiClubPro Provider - Blackhawk Ski Club
 * MCP tools for automated registration and payment
 */

import { verifyMandate } from '../lib/mandates';
import { auditToolCall, logEvidence } from '../middleware/audit';
import { lookupCredentials } from '../lib/credentials';
import { 
  launchBrowserbaseSession, 
  connectToBrowserbaseSession,
  performSkiClubProLogin,
  scrapeSkiClubProPrograms,
  captureScreenshot,
  closeBrowserbaseSession 
} from '../lib/browserbase';
import { captureScreenshotEvidence } from '../lib/evidence';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Types
export interface Program {
  program_ref: string;
  title: string;
  opens_at: string;
}

export interface LoginArgs {
  credential_alias: string;
  mandate_id: string;
  plan_execution_id: string;
}

export interface FindProgramsArgs {
  org_ref: string;
  query?: string;
  mandate_id: string;
  plan_execution_id: string;
}

export interface RegisterArgs {
  session_ref: string;
  program_ref: string;
  child_id: string;
  answers?: Record<string, any>;
  mandate_id: string;
  plan_execution_id: string;
}

export interface PayArgs {
  session_ref: string;
  registration_ref: string;
  amount_cents: number;
  mandate_id: string;
  plan_execution_id: string;
}

export interface CaptureEvidenceArgs {
  plan_execution_id: string;
  mandate_id: string;
  kind: string;
}

/**
 * Login to SkiClubPro using stored credentials
 */
export async function scpLogin(args: LoginArgs): Promise<{ session_ref: string }> {
  return auditToolCall(
    {
      plan_execution_id: args.plan_execution_id,
      mandate_id: args.mandate_id,
      tool: 'scp.login'
    },
    async () => {
      // Verify mandate has required scope
      await verifyMandate(args.mandate_id, 'scp:login');

      try {
        // Get user ID from mandate
        const { data: mandate, error: mandateError } = await supabase
          .from('mandates')
          .select('user_id')
          .eq('id', args.mandate_id)
          .single();

        if (mandateError || !mandate) {
          throw new Error('Could not retrieve mandate details');
        }

        // Look up stored credentials
        const credentials = await lookupCredentials(args.credential_alias, mandate.user_id);

        // Launch Browserbase session
        const session = await launchBrowserbaseSession();

        try {
          // Perform login automation
          await performSkiClubProLogin(session, credentials);

          // Capture screenshot after successful login
          const screenshot = await captureScreenshot(session, 'login-success.png');
          await captureScreenshotEvidence(
            args.plan_execution_id,
            screenshot,
            'successful-login'
          );

          return { session_ref: session.sessionId };

        } catch (loginError) {
          // Capture screenshot of failed login for debugging
          try {
            const errorScreenshot = await captureScreenshot(session, 'login-failed.png');
            await captureScreenshotEvidence(
              args.plan_execution_id,
              errorScreenshot,
              'failed-login'
            );
          } catch (screenshotError) {
            console.error('Could not capture error screenshot:', screenshotError);
          }

          await closeBrowserbaseSession(session);
          throw loginError;
        }

      } catch (error) {
        throw new Error(`SkiClubPro login failed: ${error.message}`);
      }
    }
  );
}

/**
 * Find available programs for registration
 */
export async function scpFindPrograms(args: FindProgramsArgs): Promise<{ programs: Program[] }> {
  return auditToolCall(
    {
      plan_execution_id: args.plan_execution_id,
      mandate_id: args.mandate_id,
      tool: 'scp.find_programs'
    },
    async () => {
      // Verify mandate has required scope
      await verifyMandate(args.mandate_id, 'scp:read:listings');

      try {
        // Connect to existing Browserbase session
        // Note: In practice, session_ref would be passed in args or stored in context
        // For now, we'll launch a new session and perform login first
        const session = await launchBrowserbaseSession();

        try {
          // Get user ID from mandate to lookup credentials
          const { data: mandate, error: mandateError } = await supabase
            .from('mandates')
            .select('user_id')
            .eq('id', args.mandate_id)
            .single();

          if (mandateError || !mandate) {
            throw new Error('Could not retrieve mandate details');
          }

          // Note: In a full implementation, we'd store session state and reuse it
          // For now, we'll perform a fresh login for program discovery
          const credentials = await lookupCredentials('skiclubpro-default', mandate.user_id);
          await performSkiClubProLogin(session, credentials);

          // Scrape programs from SkiClubPro
          const programs = await scrapeSkiClubProPrograms(session, args.org_ref, args.query);

          // Capture screenshot after scraping programs
          const screenshot = await captureScreenshot(session, 'programs-scraped.png');
          await captureScreenshotEvidence(
            args.plan_execution_id,
            screenshot,
            'programs-listing'
          );

          await closeBrowserbaseSession(session);

          return { programs };

        } catch (scrapingError) {
          // Capture screenshot of failed scraping for debugging
          try {
            const errorScreenshot = await captureScreenshot(session, 'scraping-failed.png');
            await captureScreenshotEvidence(
              args.plan_execution_id,
              errorScreenshot,
              'failed-program-scraping'
            );
          } catch (screenshotError) {
            console.error('Could not capture error screenshot:', screenshotError);
          }

          await closeBrowserbaseSession(session);
          throw scrapingError;
        }

      } catch (error) {
        throw new Error(`SkiClubPro program discovery failed: ${error.message}`);
      }
    }
  );
}

/**
 * Register a child for a program
 */
export async function scpRegister(args: RegisterArgs): Promise<{ registration_ref: string }> {
  return auditToolCall(
    {
      plan_execution_id: args.plan_execution_id,
      mandate_id: args.mandate_id,
      tool: 'scp.register'
    },
    async () => {
      // Verify mandate has required scope
      await verifyMandate(args.mandate_id, 'scp:register');

      // TODO: Replace with actual Playwright automation
      // Stub: simulate successful registration
      const registrationRef = `reg_${randomUUID()}`;

      return { registration_ref: registrationRef };
    }
  );
}

/**
 * Process payment for registration
 */
export async function scpPay(args: PayArgs): Promise<{ confirmation_ref: string; final_url: string }> {
  return auditToolCall(
    {
      plan_execution_id: args.plan_execution_id,
      mandate_id: args.mandate_id,
      tool: 'scp.pay'
    },
    async () => {
      // Verify mandate has required scope and amount
      await verifyMandate(args.mandate_id, 'scp:pay', { 
        amount_cents: args.amount_cents 
      });

      // TODO: Replace with actual payment processing
      // Stub: simulate successful payment
      const confirmationRef = `pay_${randomUUID()}`;
      const finalUrl = `https://skiclubpro.com/confirmation/${confirmationRef}`;

      return { 
        confirmation_ref: confirmationRef,
        final_url: finalUrl
      };
    }
  );
}

/**
 * Capture evidence (screenshot, page source, etc.)
 */
export async function captureEvidence(args: CaptureEvidenceArgs): Promise<{ asset_url: string; sha256: string }> {
  return auditToolCall(
    {
      plan_execution_id: args.plan_execution_id,
      mandate_id: args.mandate_id,
      tool: 'evidence.capture'
    },
    async () => {
      // Verify mandate (any scope is sufficient for evidence capture)
      await verifyMandate(args.mandate_id, 'scp:login');

      try {
        // Launch session for evidence capture
        const session = await launchBrowserbaseSession();

        try {
          // Navigate to current page or specific URL for evidence
          // For now, capture a basic screenshot
          const screenshot = await captureScreenshot(session, `evidence-${args.kind}.png`);
          
          // Store evidence
          const evidence = await captureScreenshotEvidence(
            args.plan_execution_id,
            screenshot,
            args.kind
          );

          await closeBrowserbaseSession(session);

          return evidence;

        } catch (captureError) {
          await closeBrowserbaseSession(session);
          throw captureError;
        }

      } catch (error) {
        throw new Error(`Evidence capture failed: ${error.message}`);
      }
    }
  );
}

// Export all tools
export const skiClubProTools = {
  'scp.login': scpLogin,
  'scp.find_programs': scpFindPrograms,
  'scp.register': scpRegister,
  'scp.pay': scpPay,
  'evidence.capture': captureEvidence
};