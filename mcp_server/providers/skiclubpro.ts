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
// Import SkiClubPro configurable functions
import {
  checkAccountExists,
  createSkiClubProAccount,
  checkMembershipStatus,
  purchaseMembership
} from '../lib/browserbase-skiclubpro';
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
  credential_id?: string;
}

export interface FieldQuestion {
  id: string;
  label: string;
  type: 'text' | 'select' | 'radio' | 'checkbox' | 'date' | 'number';
  required: boolean;
  options?: string[];
}

export interface FieldBranch {
  id: string;
  title: string;
  questions: FieldQuestion[];
}

export interface FieldSchema {
  program_ref: string;
  branches: FieldBranch[];
  common_questions: FieldQuestion[];
}

export interface CheckAccountStatusArgs {
  email: string;
  mandate_id: string;
  plan_execution_id: string;
}

export interface CreateAccountArgs {
  email: string;
  password: string;
  child_info: any;
  mandate_id: string;
  plan_execution_id: string;
}

export interface CheckMembershipStatusArgs {
  session_ref?: string;
  mandate_id: string;
  plan_execution_id: string;
}

export interface PurchaseMembershipArgs {
  session_ref?: string;
  mandate_id: string;
  plan_execution_id: string;
}

export interface CheckAccountStatusArgs {
  email: string;
  mandate_id: string;
  plan_execution_id: string;
}

export interface CreateAccountArgs {
  email: string;
  password: string;
  child_info: any;
  mandate_id: string;
  plan_execution_id: string;
}

export interface CheckMembershipStatusArgs {
  session_ref?: string;
  mandate_id: string;
  plan_execution_id: string;
}

export interface PurchaseMembershipArgs {
  session_ref?: string;
  mandate_id: string;
  plan_execution_id: string;
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
    args,
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
    },
    'scp:login'
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
    args,
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
    },
    'scp:read:listings'
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
    args,
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
    },
    'scp:enroll'
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
    args,
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
    },
    'scp:pay'
  );
}

/**
 * Discover required fields for a program with branching support
 */
export async function scpDiscoverRequiredFields(args: DiscoverRequiredFieldsArgs): Promise<FieldSchema> {
  console.log('🔍 Starting field discovery with args:', JSON.stringify(args, null, 2));
  
  return auditToolCall(
    {
      plan_execution_id: args.plan_execution_id,
      mandate_id: args.mandate_id,
      tool: 'scp.discover_required_fields'
    },
    args,
    async () => {
      try {
        console.log('✅ Verifying mandate scope for scp:read:listings...');
        // Verify mandate has required scope
        await verifyMandate(args.mandate_id, 'scp:read:listings');
        console.log('✅ Mandate verified successfully');

        // Get user ID from mandate for credential lookup
        console.log('📋 Looking up mandate details...');
        const mandateResult = await supabase
          .from('mandates')
          .select('user_id')
          .eq('id', args.mandate_id)
          .single();

        if (mandateResult.error) {
          console.error('❌ Failed to get mandate:', mandateResult.error);
          throw new Error(`Failed to get mandate: ${mandateResult.error.message}`);
        }

        const userId = mandateResult.data.user_id;
        console.log('✅ Found user ID from mandate:', userId);

        // Decrypt credentials using credential_id
        console.log('🔐 Decrypting credentials for credential_id:', args.credential_id || 'default');
        const credentials = await lookupCredentials(args.credential_id || 'default', userId);
        console.log('✅ Credentials decrypted successfully for email:', credentials.email);
        
        // Launch Browserbase session
        console.log('🚀 Launching Browserbase session...');
        const session = await launchBrowserbaseSession();
        console.log(`✅ Browserbase session launched: ${session.sessionId}`);

        try {
          // Navigate to Blackhawk registration
          console.log('🌐 Navigating to Blackhawk registration...');
          await session.page.goto('https://register.blackhawkskiclub.org/', { waitUntil: 'networkidle' });
          console.log('✅ Navigation completed');
          
          // Login with credentials
          console.log('🔐 Performing login with email:', credentials.email);
          await performSkiClubProLogin(session, {
            email: credentials.email,
            password: credentials.password
          });
          console.log('✅ Login completed successfully');

          // Navigate directly to program registration page  
          console.log(`📋 Navigating to program ${args.program_ref}...`);
          const programUrl = `https://register.blackhawkskiclub.org/programs/${args.program_ref}`;
          await session.page.goto(programUrl, { waitUntil: 'networkidle' });
          console.log('✅ Program page loaded');
          
          // Wait for registration form to load
          console.log('⏳ Waiting for registration form to load...');
          await session.page.waitForSelector('form, .registration-form', { timeout: 10000 });
          console.log('✅ Registration form found');

          // Scrape form fields from the registration page
          console.log('🔍 Analyzing registration form fields...');
          const fieldSchema = await session.page.evaluate(() => {
            const form = document.querySelector('form') || document.querySelector('.registration-form') || document;
            const formFields: any[] = [];
            
            // Find all input, select, and textarea elements
            const elements = form.querySelectorAll('input, select, textarea');
            
            elements.forEach((element: any, index: number) => {
              const type = element.type || element.tagName.toLowerCase();
              
              // Skip non-user input fields
              if (['hidden', 'submit', 'button', 'reset'].includes(type)) {
                return;
              }

              // Get field identifier
              const id = element.id || element.name || `field_${index}`;
              
              // Find label text
              let label = '';
              if (element.labels && element.labels.length > 0) {
                label = element.labels[0].textContent?.trim() || '';
              } else {
                // Look for label by for attribute
                const labelEl = form.querySelector(`label[for="${element.id}"]`);
                if (labelEl) {
                  label = labelEl.textContent?.trim() || '';
                } else {
                  // Look for preceding label or text
                  const parent = element.parentElement;
                  const prevLabel = parent?.querySelector('label');
                  label = prevLabel?.textContent?.trim() || 
                         element.getAttribute('placeholder') ||
                         element.getAttribute('aria-label') ||
                         element.getAttribute('name') ||
                         'Unknown Field';
                }
              }

              // Check if required
              const required = element.hasAttribute('required') || 
                             element.getAttribute('aria-required') === 'true' ||
                             element.classList.contains('required');

              // Get options for select elements
              const options: string[] = [];
              if (type === 'select') {
                Array.from(element.options).forEach((option: any) => {
                  if (option.value && option.text) {
                    options.push(option.text);
                  }
                });
              }

              formFields.push({
                id,
                label: label || id,
                type,
                required,
                options: options.length > 0 ? options : undefined
              });
            });

            return formFields;
          });

          console.log(`✅ Found ${fieldSchema.length} form fields:`, fieldSchema.map(f => f.label));

          // Detect branching logic by looking for dynamic fields
          console.log('🔀 Analyzing form branching...');
          const branches: FieldBranch[] = [];
          
          // Create main branch with all discovered fields
          const mainBranch: FieldBranch = {
            id: 'default',
            title: 'Default Registration Path',
            questions: fieldSchema.map(field => ({
              id: field.id,
              label: field.label,
              type: field.type,
              required: field.required,
              options: field.options
            }))
          };
          
          branches.push(mainBranch);

          // Look for select fields that might trigger additional questions
          const selectFields = fieldSchema.filter(f => f.type === 'select' && f.options && f.options.length > 1);
          
          for (const selectField of selectFields.slice(0, 2)) { // Test first 2 select fields
            if (!selectField.options) continue;
            
            for (const option of selectField.options.slice(0, 3)) { // Test first 3 options
              try {
                console.log(`Testing option "${option}" for field "${selectField.label}"`);
                
                // Select the option
                await session.page.selectOption(`select[name="${selectField.id}"], select[id="${selectField.id}"]`, option);
                await session.page.waitForTimeout(1000); // Wait for potential DOM changes
                
                // Re-scan for new fields
                const updatedFields = await session.page.evaluate(() => {
                  const form = document.querySelector('form') || document.querySelector('.registration-form') || document;
                  const fields: any[] = [];
                  const elements = form.querySelectorAll('input:not([type="hidden"]), select, textarea');
                  
                  elements.forEach((element: any, index: number) => {
                    const type = element.type || element.tagName.toLowerCase();
                    if (['submit', 'button', 'reset'].includes(type)) return;
                    
                    const id = element.id || element.name || `field_${index}`;
                    const isVisible = element.offsetWidth > 0 && element.offsetHeight > 0;
                    
                    if (isVisible) {
                      let label = '';
                      if (element.labels && element.labels.length > 0) {
                        label = element.labels[0].textContent?.trim() || '';
                      } else {
                        const labelEl = form.querySelector(`label[for="${element.id}"]`);
                        label = labelEl?.textContent?.trim() || 
                               element.getAttribute('placeholder') ||
                               element.getAttribute('name') ||
                               id;
                      }
                      
                      fields.push({
                        id,
                        label: label || id,
                        type,
                        required: element.hasAttribute('required') || element.getAttribute('aria-required') === 'true'
                      });
                    }
                  });
                  
                  return fields;
                });

                // Create branch if fields are different
                if (updatedFields.length !== mainBranch.questions.length) {
                  branches.push({
                    id: `${selectField.id}_${option.replace(/\s+/g, '_').toLowerCase()}`,
                    title: `${selectField.label}: ${option}`,
                    questions: updatedFields.map(field => ({
                      id: field.id,
                      label: field.label,
                      type: field.type,
                      required: field.required
                    }))
                  });
                }
                
              } catch (error) {
                console.log(`Error testing option ${option}:`, error.message);
              }
            }
          }

          // Capture screenshot evidence
          console.log('📸 Capturing screenshot evidence...');
          const screenshot = await captureScreenshot(session, 'field-discovery.png');
          
          // Generate a proper plan execution ID if it's "interactive"
          let planExecId = args.plan_execution_id;
          if (planExecId === "interactive") {
            planExecId = crypto.randomUUID();
          }
          
          const evidence = await captureScreenshotEvidence(
            planExecId,
            screenshot,
            'field-discovery'
          );
          console.log(`✅ Screenshot captured: ${evidence.asset_url}`);

          await closeBrowserbaseSession(session);
          console.log('✅ Browserbase session closed');

          // Extract common questions (required fields)
          const commonQuestions = mainBranch.questions.filter(q => q.required);

          // Return discovered schema
          const result: FieldSchema = {
            program_ref: args.program_ref,
            branches,
            common_questions: commonQuestions
          };

          console.log(`✅ Field discovery completed for ${args.program_ref}: ${branches.length} branches, ${commonQuestions.length} common questions`);
          return result;

        } catch (error) {
          console.error('❌ Field discovery failed:', error);
          console.error('❌ Error stack:', error.stack);
          
          // Try to capture error screenshot
          try {
            console.log('📸 Capturing error screenshot...');
            const errorScreenshot = await captureScreenshot(session, 'field-discovery-error.png');
            let planExecId = args.plan_execution_id;
            if (planExecId === "interactive") {
              planExecId = crypto.randomUUID();
            }
            await captureScreenshotEvidence(
              planExecId,
              errorScreenshot,
              'field-discovery-error'
            );
            console.log('✅ Error screenshot captured');
          } catch (screenshotError) {
            console.error('❌ Could not capture error screenshot:', screenshotError);
          }

          await closeBrowserbaseSession(session);
          
          // Return structured error instead of throwing
          return {
            error: "discover_required_fields failed",
            details: error.message,
            program_ref: args.program_ref,
            branches: [],
            common_questions: []
          } as any;
        }

      } catch (error) {
        console.error('❌ Field discovery setup failed:', error);
        console.error('❌ Setup error stack:', error.stack);
        
        // Return structured error instead of throwing
        return {
          error: "discover_required_fields setup failed", 
          details: error.message,
          program_ref: args.program_ref,
          branches: [],
          common_questions: []
        } as any;
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
    },
    'scp:capture'
  );
}

/**
 * Check if an account exists for the given email
 */
export async function scpCheckAccountStatus(args: CheckAccountStatusArgs): Promise<{ exists: boolean; verified?: boolean }> {
  return auditToolCall(
    {
      plan_execution_id: args.plan_execution_id,
      mandate_id: args.mandate_id,
      tool: 'scp.check_account_status'
    },
    args,
    async () => {
      // Verify mandate has required scope
      await verifyMandate(args.mandate_id, 'scp:read:account');

      try {
        // Launch Browserbase session
        const session = await launchBrowserbaseSession();

        try {
          // Check account status by attempting login or probing
          const accountStatus = await checkAccountExists(session, 'blackhawk-ski-club', args.email);

          // Capture screenshot evidence
          const screenshot = await captureScreenshot(session, 'account-check.png');
          await captureScreenshotEvidence(
            args.plan_execution_id,
            screenshot,
            'account-status-check'
          );

          await closeBrowserbaseSession(session);

          return accountStatus;

        } catch (error) {
          await closeBrowserbaseSession(session);
          throw error;
        }

      } catch (error) {
        throw new Error(`Account status check failed: ${error.message}`);
      }
    },
    'scp:read:account'
  );
}

/**
 * Create a new account for the user
 */
export async function scpCreateAccount(args: CreateAccountArgs): Promise<{ account_id: string }> {
  return auditToolCall(
    {
      plan_execution_id: args.plan_execution_id,
      mandate_id: args.mandate_id,
      tool: 'scp.create_account'
    },
    args,
    async () => {
      // Verify mandate has required scope
      await verifyMandate(args.mandate_id, 'scp:create_account');

      try {
        // Launch Browserbase session
        const session = await launchBrowserbaseSession();

        try {
          // Perform account creation automation
          const accountResult = await createSkiClubProAccount(session, 'blackhawk-ski-club', {
            name: args.child_info.parent_name || args.email,
            email: args.email,
            phone: args.child_info.parent_phone,
            password: args.password
          });

          // Capture confirmation screenshot
          const screenshot = await captureScreenshot(session, 'account-created.png');
          await captureScreenshotEvidence(
            args.plan_execution_id,
            screenshot,
            'account-creation-confirmation'
          );

          await closeBrowserbaseSession(session);

          return accountResult;

        } catch (error) {
          // Capture error screenshot
          try {
            const errorScreenshot = await captureScreenshot(session, 'account-creation-failed.png');
            await captureScreenshotEvidence(
              args.plan_execution_id,
              errorScreenshot,
              'failed-account-creation'
            );
          } catch (screenshotError) {
            console.error('Could not capture error screenshot:', screenshotError);
          }

          await closeBrowserbaseSession(session);
          throw error;
        }

      } catch (error) {
        throw new Error(`Account creation failed: ${error.message}`);
      }
    },
    'scp:create_account'
  );
}

/**
 * Check membership status for logged-in user
 */
export async function scpCheckMembershipStatus(args: CheckMembershipStatusArgs): Promise<{ active: boolean; expires_at?: string }> {
  return auditToolCall(
    {
      plan_execution_id: args.plan_execution_id,
      mandate_id: args.mandate_id,
      tool: 'scp.check_membership_status'
    },
    args,
    async () => {
      // Verify mandate has required scope
      await verifyMandate(args.mandate_id, 'scp:read:membership');

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
          // Check membership status
          const membershipStatus = await checkMembershipStatus(session, 'blackhawk-ski-club');

          // Capture screenshot evidence
          const screenshot = await captureScreenshot(session, 'membership-check.png');
          await captureScreenshotEvidence(
            args.plan_execution_id,
            screenshot,
            'membership-status-check'
          );

          // Only close session if we created it
          if (!args.session_ref) {
            await closeBrowserbaseSession(session);
          }

          return membershipStatus;

        } catch (error) {
          if (!args.session_ref) {
            await closeBrowserbaseSession(session);
          }
          throw error;
        }

      } catch (error) {
        throw new Error(`Membership status check failed: ${error.message}`);
      }
    },
    'scp:read:membership'
  );
}

/**
 * Purchase membership for logged-in user (optional future feature)
 */
export async function scpPurchaseMembership(args: PurchaseMembershipArgs): Promise<{ membership_id: string }> {
  return auditToolCall(
    {
      plan_execution_id: args.plan_execution_id,
      mandate_id: args.mandate_id,
      tool: 'scp.purchase_membership'
    },
    args,
    async () => {
      // Verify mandate has required scope
      await verifyMandate(args.mandate_id, 'scp:pay:membership');

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
          // Perform membership purchase automation
          const membershipResult = await purchaseMembership(session, 'blackhawk-ski-club', { 
            plan: 'annual', 
            payment_method: { type: 'stored' } 
          });

          // Capture confirmation screenshot
          const screenshot = await captureScreenshot(session, 'membership-purchased.png');
          await captureScreenshotEvidence(
            args.plan_execution_id,
            screenshot,
            'membership-purchase-confirmation'
          );

          // Only close session if we created it
          if (!args.session_ref) {
            await closeBrowserbaseSession(session);
          }

          return membershipResult;

        } catch (error) {
          // Capture error screenshot
          try {
            const errorScreenshot = await captureScreenshot(session, 'membership-purchase-failed.png');
            await captureScreenshotEvidence(
              args.plan_execution_id,
              errorScreenshot,
              'failed-membership-purchase'
            );
          } catch (screenshotError) {
            console.error('Could not capture error screenshot:', screenshotError);
          }

          if (!args.session_ref) {
            await closeBrowserbaseSession(session);
          }
          throw error;
        }

      } catch (error) {
        throw new Error(`Membership purchase failed: ${error.message}`);
      }
    },
    'scp:pay:membership'
  );
}

/**
 * Check if user has stored payment method in SkiClubPro
 */
export async function scpCheckStoredPaymentMethod(args: { mandate_id: string; plan_execution_id?: string }): Promise<{ on_file: boolean; screenshot_evidence?: string }> {
  return auditToolCall(
    {
      plan_execution_id: args.plan_execution_id || '',
      mandate_id: args.mandate_id,
      tool: 'scp.check_stored_payment_method'
    },
    args,
    async () => {
      // Verify mandate has billing read scope
      await verifyMandate(args.mandate_id, 'scp:read:billing');

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

        // Launch Browserbase session
        const session = await launchBrowserbaseSession();

        try {
          // Login to SkiClubPro
          const credentials = await lookupCredentials('skiclubpro-default', mandate.user_id);
          await performSkiClubProLogin(session, credentials);

          // Navigate to billing/profile page to check for stored cards
          // TODO: Implement navigation to billing page and card detection
          
          // Capture screenshot of billing page
          const screenshot = await captureScreenshot(session, 'billing-page.png');
          const evidenceId = await captureScreenshotEvidence(
            args.plan_execution_id || '',
            screenshot,
            'billing-page-check'
          );

          await closeBrowserbaseSession(session);

          // TODO: Parse the page to detect stored payment methods
          return { 
            on_file: false, // Placeholder - will detect actual cards when implemented
            screenshot_evidence: evidenceId
          };

        } catch (error) {
          await closeBrowserbaseSession(session);
          throw error;
        }

      } catch (error) {
        throw new Error(`Payment method check failed: ${error.message}`);
      }
    }
  );
}

// Export all tools with proper array format and inputSchema syntax
export const skiClubProTools = {
  'scp.login': {
    name: 'scp.login',
    description: 'Login to SkiClubPro using stored credentials',
    inputSchema: {
      type: 'object',
      properties: {
        credential_alias: { type: 'string' },
        mandate_id: { type: 'string' },
        plan_execution_id: { type: 'string' }
      },
      required: ['credential_alias', 'mandate_id', 'plan_execution_id']
    },
    handler: scpLogin
  },
  'scp.find_programs': {
    name: 'scp.find_programs',
    description: 'Find available programs for registration',
    inputSchema: {
      type: 'object',
      properties: {
        org_ref: { type: 'string' },
        query: { type: 'string' },
        mandate_id: { type: 'string' },
        plan_execution_id: { type: 'string' }
      },
      required: ['org_ref', 'mandate_id', 'plan_execution_id']
    },
    handler: scpFindPrograms
  },
  'scp.check_account': {
    name: 'scp.check_account',
    description: 'Check if a SkiClubPro account exists for the given org_ref + email',
    inputSchema: {
      type: 'object',
      properties: {
        org_ref: { type: 'string' },
        email: { type: 'string' },
        mandate_id: { type: 'string' },
        plan_execution_id: { type: 'string' }
      },
      required: ['org_ref', 'email', 'mandate_id', 'plan_execution_id']
    },
    handler: scpCheckAccountStatus
  },
  'scp.create_account': {
    name: 'scp.create_account',
    description: 'Create a new SkiClubPro account',
    inputSchema: {
      type: 'object',
      properties: {
        org_ref: { type: 'string' },
        name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        password: { type: 'string' },
        mandate_id: { type: 'string' },
        plan_execution_id: { type: 'string' }
      },
      required: ['org_ref', 'name', 'email', 'password', 'mandate_id', 'plan_execution_id']
    },
    handler: scpCreateAccount
  },
  'scp.check_membership': {
    name: 'scp.check_membership',
    description: 'Check membership status for logged-in user',
    inputSchema: {
      type: 'object',
      properties: {
        org_ref: { type: 'string' },
        mandate_id: { type: 'string' },
        plan_execution_id: { type: 'string' }
      },
      required: ['org_ref', 'mandate_id', 'plan_execution_id']
    },
    handler: scpCheckMembershipStatus
  },
  'scp.purchase_membership': {
    name: 'scp.purchase_membership',
    description: 'Purchase a membership plan',
    inputSchema: {
      type: 'object',
      properties: {
        org_ref: { type: 'string' },
        plan: { type: 'string' },
        payment_method: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            vgs_alias: { type: 'string' }
          }
        },
        mandate_id: { type: 'string' },
        plan_execution_id: { type: 'string' }
      },
      required: ['org_ref', 'plan', 'payment_method', 'mandate_id', 'plan_execution_id']
    },
    handler: scpPurchaseMembership
  }
};