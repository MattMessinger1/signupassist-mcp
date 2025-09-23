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
  discoverProgramRequiredFields,
  performSkiClubProRegistration,
  performSkiClubProPayment,
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
  session_ref?: string;
  program_ref: string;
  child_id: string;
  answers?: Record<string, any>;
  mandate_id: string;
  plan_execution_id: string;
}

export interface PayArgs {
  session_ref?: string;
  registration_ref: string;
  amount_cents: number;
  payment_method?: {
    type: 'stored' | 'vgs_alias';
    card_alias?: string;
    vgs_alias?: string;
  };
  mandate_id: string;
  plan_execution_id: string;
}

export interface CaptureEvidenceArgs {
  plan_execution_id: string;
  mandate_id: string;
  kind: string;
}

export interface DiscoverRequiredFieldsArgs {
  program_ref: string;
  mandate_id: string;
  plan_execution_id: string;
}

export interface FieldQuestion {
  id: string;
  label: string;
  type: 'text' | 'select' | 'radio' | 'checkbox' | 'date' | 'number';
  required: boolean;
  options?: string[];
}

export interface FieldBranch {
  choice: string;
  questions: FieldQuestion[];
}

export interface FieldSchema {
  program_ref: string;
  branches: FieldBranch[];
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
 * Register a child for a program with dynamic question handling
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
      await verifyMandate(args.mandate_id, 'scp:enroll');

      try {
        // Get mandate details including pre-answered questions
        const { data: mandate, error: mandateError } = await supabase
          .from('mandates')
          .select('user_id, scope, program_ref')
          .eq('id', args.mandate_id)
          .single();

        if (mandateError || !mandate) {
          throw new Error('Could not retrieve mandate details');
        }

        // Get child details
        const { data: child, error: childError } = await supabase
          .from('children')
          .select('*')
          .eq('id', args.child_id)
          .eq('user_id', mandate.user_id)
          .single();

        if (childError || !child) {
          throw new Error('Could not retrieve child details');
        }

        // Launch or connect to Browserbase session
        let session;
        if (args.session_ref) {
          session = await connectToBrowserbaseSession(args.session_ref);
        } else {
          session = await launchBrowserbaseSession();
          
          // Login first if new session
          const credentials = await lookupCredentials('skiclubpro-default', mandate.user_id);
          await performSkiClubProLogin(session, credentials);
        }

        try {
          // Capture pre-registration screenshot
          const preScreenshot = await captureScreenshot(session, 'pre-registration.png');
          await captureScreenshotEvidence(
            args.plan_execution_id,
            preScreenshot,
            'pre-registration'
          );

          // Perform registration with dynamic question handling
          const registrationResult = await performSkiClubProRegistration(session, {
            program_ref: args.program_ref,
            child: child,
            answers: args.answers || {},
            mandate_scope: mandate.scope
          });

          // Capture post-registration screenshot
          const postScreenshot = await captureScreenshot(session, 'post-registration.png');
          await captureScreenshotEvidence(
            args.plan_execution_id,
            postScreenshot,
            'registration-completed'
          );

          // Only close session if we created it
          if (!args.session_ref) {
            await closeBrowserbaseSession(session);
          }

          return { registration_ref: registrationResult.registration_ref };

        } catch (registrationError) {
          // Capture error screenshot
          try {
            const errorScreenshot = await captureScreenshot(session, 'registration-failed.png');
            await captureScreenshotEvidence(
              args.plan_execution_id,
              errorScreenshot,
              'failed-registration'
            );
          } catch (screenshotError) {
            console.error('Could not capture error screenshot:', screenshotError);
          }

          if (!args.session_ref) {
            await closeBrowserbaseSession(session);
          }
          throw registrationError;
        }

      } catch (error) {
        throw new Error(`SkiClubPro registration failed: ${error.message}`);
      }
    }
  );
}

/**
 * Process payment for registration with card handling
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

      try {
        // Get mandate details
        const { data: mandate, error: mandateError } = await supabase
          .from('mandates')
          .select('user_id')
          .eq('id', args.mandate_id)
          .single();

        if (mandateError || !mandate) {
          throw new Error('Could not retrieve mandate details');
        }

        // Launch or connect to Browserbase session
        let session;
        if (args.session_ref) {
          session = await connectToBrowserbaseSession(args.session_ref);
        } else {
          session = await launchBrowserbaseSession();
          
          // Login first if new session
          const credentials = await lookupCredentials('skiclubpro-default', mandate.user_id);
          await performSkiClubProLogin(session, credentials);
        }

        try {
          // Capture pre-payment screenshot
          const preScreenshot = await captureScreenshot(session, 'pre-payment.png');
          await captureScreenshotEvidence(
            args.plan_execution_id,
            preScreenshot,
            'pre-payment'
          );

          // Perform payment processing
          const paymentResult = await performSkiClubProPayment(session, {
            registration_ref: args.registration_ref,
            amount_cents: args.amount_cents,
            payment_method: args.payment_method
          });

          // Capture confirmation screenshot
          const confirmationScreenshot = await captureScreenshot(session, 'payment-confirmation.png');
          await captureScreenshotEvidence(
            args.plan_execution_id,
            confirmationScreenshot,
            'payment-confirmation'
          );

          // Only close session if we created it
          if (!args.session_ref) {
            await closeBrowserbaseSession(session);
          }

          return paymentResult;

        } catch (paymentError) {
          // Capture error screenshot
          try {
            const errorScreenshot = await captureScreenshot(session, 'payment-failed.png');
            await captureScreenshotEvidence(
              args.plan_execution_id,
              errorScreenshot,
              'failed-payment'
            );
          } catch (screenshotError) {
            console.error('Could not capture error screenshot:', screenshotError);
          }

          if (!args.session_ref) {
            await closeBrowserbaseSession(session);
          }
          throw paymentError;
        }

      } catch (error) {
        throw new Error(`SkiClubPro payment failed: ${error.message}`);
      }
    }
  );
}

/**
 * Discover required fields for a program with branching support
 */
export async function scpDiscoverRequiredFields(args: DiscoverRequiredFieldsArgs): Promise<FieldSchema> {
  return auditToolCall(
    {
      plan_execution_id: args.plan_execution_id,
      mandate_id: args.mandate_id,
      tool: 'scp.discover_required_fields'
    },
    async () => {
      // Verify mandate has required scope
      await verifyMandate(args.mandate_id, 'scp:read:listings');

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

        // Launch Browserbase session
        const session = await launchBrowserbaseSession();

        try {
          // Login first to access program forms
          const credentials = await lookupCredentials('skiclubpro-default', mandate.user_id);
          await performSkiClubProLogin(session, credentials);

          // Discover required fields with branching support
          const fieldSchema = await discoverProgramRequiredFields(session, args.program_ref);

          // Capture screenshot evidence for each branch explored
          const screenshot = await captureScreenshot(session, 'field-discovery.png');
          await captureScreenshotEvidence(
            args.plan_execution_id,
            screenshot,
            'discovery'
          );

          await closeBrowserbaseSession(session);

          return fieldSchema;

        } catch (discoveryError) {
          // Capture screenshot of failed discovery for debugging
          try {
            const errorScreenshot = await captureScreenshot(session, 'discovery-failed.png');
            await captureScreenshotEvidence(
              args.plan_execution_id,
              errorScreenshot,
              'failed-field-discovery'
            );
          } catch (screenshotError) {
            console.error('Could not capture error screenshot:', screenshotError);
          }

          await closeBrowserbaseSession(session);
          throw discoveryError;
        }

      } catch (error) {
        throw new Error(`SkiClubPro field discovery failed: ${error.message}`);
      }
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
  'scp.discover_required_fields': scpDiscoverRequiredFields,
  'scp.register': scpRegister,
  'scp.pay': scpPay,
  'evidence.capture': captureEvidence
};