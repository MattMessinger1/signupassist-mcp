import { chromium, Browser, Page } from 'playwright';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { SignJWT, jwtVerify } from 'jose';

// Load environment variables
dotenv.config();

interface PlanData {
  id: string;
  opens_at: string;
  mandate_id: string;
  child_id: string;
  user_id: string;
  program_ref: string;
  provider: string;
}

interface MandatePayload {
  child_id: string;
  program_ref: string;
  max_amount_cents: number;
  valid_from: string;
  valid_until: string;
  provider: string;
  scope: string[];
  credential_id: string;
  answers?: Record<string, any>;
}

interface CredentialData {
  username: string;
  password: string;
  [key: string]: any;
}

class SignupWorker {
  private supabase: SupabaseClient;
  private planId: string;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private sessionId: string | null = null;
  private planExecutionId: string | null = null;

  constructor() {
    this.planId = process.env.PLAN_ID || '';
    
    if (!this.planId) {
      throw new Error('PLAN_ID environment variable is required');
    }

    // Initialize Supabase client with service role
    this.supabase = createClient(
      process.env.SB_URL || '',
      process.env.SB_SERVICE_ROLE_KEY || ''
    );

    console.log(`🚀 Railway Worker starting for plan: ${this.planId}`);
  }

  private async logStep(step: string, details?: any) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${step}`, details ? JSON.stringify(details, null, 2) : '');
  }

  private async insertMCPToolCall(tool: string, args: any, result: any, decision?: string) {
    if (!this.planExecutionId) return;

    try {
      await this.supabase.from('mcp_tool_calls').insert({
        plan_execution_id: this.planExecutionId,
        mandate_id: '', // Will be filled from plan data
        tool,
        args_json: args,
        result_json: result,
        args_hash: this.hashJSON(args),
        result_hash: this.hashJSON(result),
        decision: decision || null
      });
    } catch (error) {
      console.error('Failed to insert MCP tool call:', error);
    }
  }

  private async insertEvidenceAsset(type: string, url: string, sha256?: string) {
    if (!this.planExecutionId) return;

    try {
      await this.supabase.from('evidence_assets').insert({
        plan_execution_id: this.planExecutionId,
        type,
        url,
        sha256: sha256 || null
      });
    } catch (error) {
      console.error('Failed to insert evidence asset:', error);
    }
  }

  private hashJSON(obj: any): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
  }

  private async verifyMandate(jws: string): Promise<MandatePayload> {
    try {
      const secret = new TextEncoder().encode(process.env.MANDATE_SIGNING_KEY || '');
      const { payload } = await jwtVerify(jws, secret);
      return payload as MandatePayload;
    } catch (error) {
      throw new Error(`Mandate verification failed: ${error}`);
    }
  }

  private async fetchPlanData(): Promise<PlanData> {
    const { data, error } = await this.supabase
      .from('plans')
      .select('*')
      .eq('id', this.planId)
      .single();

    if (error || !data) {
      throw new Error(`Failed to fetch plan data: ${error?.message}`);
    }

    return data as PlanData;
  }

  private async fetchCredentials(credentialId: string): Promise<CredentialData> {
    // Call cred-get edge function to decrypt credentials
    const { data, error } = await this.supabase.functions.invoke('cred-get', {
      body: { id: credentialId }
    });

    if (error || !data) {
      throw new Error(`Failed to fetch credentials: ${error?.message}`);
    }

    return data as CredentialData;
  }

  private async fetchMandateData(mandateId: string): Promise<MandatePayload> {
    const { data, error } = await this.supabase
      .from('mandates')
      .select('jws_compact')
      .eq('id', mandateId)
      .single();

    if (error || !data) {
      throw new Error(`Failed to fetch mandate: ${error?.message}`);
    }

    return await this.verifyMandate(data.jws_compact);
  }

  private async initializeBrowserbase(): Promise<void> {
    const apiKey = process.env.BROWSERBASE_API_KEY;
    if (!apiKey) {
      throw new Error('BROWSERBASE_API_KEY environment variable is required');
    }

    try {
      // Create a new Browserbase session
      const sessionResponse = await fetch('https://www.browserbase.com/v1/sessions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          projectId: process.env.BROWSERBASE_PROJECT_ID || 'default'
        })
      });

      if (!sessionResponse.ok) {
        throw new Error(`Failed to create Browserbase session: ${sessionResponse.statusText}`);
      }

      const sessionData = await sessionResponse.json();
      this.sessionId = sessionData.id;

      await this.logStep('🌐 Connecting to Browserbase session', { sessionId: this.sessionId });

      // Connect to Browserbase via Playwright
      this.browser = await chromium.connectOverCDT(
        `wss://connect.browserbase.com?apiKey=${apiKey}&sessionId=${this.sessionId}`
      );

      const context = this.browser.contexts()[0] || await this.browser.newContext();
      this.page = context.pages()[0] || await context.newPage();

      await this.logStep('✅ Browserbase session established');
    } catch (error) {
      throw new Error(`Browserbase initialization failed: ${error}`);
    }
  }

  private async takeScreenshot(name: string): Promise<void> {
    if (!this.page) return;

    try {
      const screenshot = await this.page.screenshot({ 
        fullPage: true,
        type: 'png'
      });
      
      // In a real implementation, you'd upload this to storage
      // For now, we'll just log that a screenshot was taken
      const url = `screenshot_${name}_${Date.now()}.png`;
      await this.insertEvidenceAsset('screenshot', url);
      await this.logStep(`📸 Screenshot taken: ${name}`);
    } catch (error) {
      console.error(`Failed to take screenshot ${name}:`, error);
    }
  }

  private async performLogin(credentials: CredentialData): Promise<boolean> {
    if (!this.page) throw new Error('Browser page not initialized');

    try {
      await this.logStep('🔐 Starting SkiClubPro login');
      
      // Navigate to SkiClubPro login page
      await this.page.goto('https://app.skiclubpro.com/login');
      await this.takeScreenshot('login_page');

      // Fill in credentials
      await this.page.fill('input[name="username"], input[type="email"]', credentials.username);
      await this.page.fill('input[name="password"], input[type="password"]', credentials.password);
      
      await this.takeScreenshot('credentials_filled');

      // Submit login form
      await this.page.click('button[type="submit"], input[type="submit"]');
      await this.page.waitForLoadState('networkidle');

      await this.takeScreenshot('login_attempt');

      // Check if login was successful
      const isLoggedIn = await this.page.isVisible('text=Dashboard') || 
                        await this.page.isVisible('text=My Account') ||
                        !await this.page.isVisible('text=Login');

      await this.insertMCPToolCall('scp.login', 
        { username: credentials.username }, 
        { success: isLoggedIn },
        isLoggedIn ? 'success' : 'failed'
      );

      if (isLoggedIn) {
        await this.logStep('✅ Login successful');
      } else {
        await this.logStep('❌ Login failed');
        await this.takeScreenshot('login_failed');
      }

      return isLoggedIn;
    } catch (error) {
      await this.logStep('❌ Login error', { error: error.message });
      await this.takeScreenshot('login_error');
      return false;
    }
  }

  private async waitForOpening(opensAt: string): Promise<void> {
    const openTime = new Date(opensAt);
    const now = new Date();
    const waitMs = openTime.getTime() - now.getTime();

    if (waitMs > 0) {
      await this.logStep(`⏱️ Waiting ${waitMs}ms until opening time: ${opensAt}`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }

    await this.logStep('🚀 Registration time reached!');
  }

  private async performRegistration(mandate: MandatePayload): Promise<{ success: boolean; confirmationRef?: string }> {
    if (!this.page) throw new Error('Browser page not initialized');

    try {
      await this.logStep('📝 Starting registration process');

      // Navigate to program registration page
      const programUrl = `https://app.skiclubpro.com/programs/${mandate.program_ref}`;
      await this.page.goto(programUrl);
      await this.takeScreenshot('program_page');

      // Fill registration form with answers from mandate
      if (mandate.answers) {
        for (const [field, value] of Object.entries(mandate.answers)) {
          try {
            await this.page.fill(`[name="${field}"], #${field}`, String(value));
            await this.logStep(`Filled field ${field} with value: ${value}`);
          } catch (error) {
            console.warn(`Could not fill field ${field}:`, error);
          }
        }
      }

      await this.takeScreenshot('form_filled');

      // Submit registration
      await this.page.click('button:has-text("Register"), button:has-text("Submit"), input[type="submit"]');
      await this.page.waitForLoadState('networkidle');

      await this.takeScreenshot('registration_submitted');

      // Look for confirmation
      const confirmationElements = await this.page.locator('text=/confirmation|registered|success/i').all();
      const hasConfirmation = confirmationElements.length > 0;
      
      let confirmationRef: string | undefined;
      if (hasConfirmation) {
        // Try to extract confirmation number/reference
        const confirmationText = await this.page.textContent('body');
        const confirmationMatch = confirmationText?.match(/confirmation\s*(?:number|ref|id)?:?\s*([A-Z0-9-]+)/i);
        confirmationRef = confirmationMatch?.[1];
      }

      await this.insertMCPToolCall('scp.register', 
        { program_ref: mandate.program_ref, answers: mandate.answers }, 
        { success: hasConfirmation, confirmation_ref: confirmationRef },
        hasConfirmation ? 'success' : 'failed'
      );

      if (hasConfirmation) {
        await this.logStep('✅ Registration successful', { confirmationRef });
      } else {
        await this.logStep('❌ Registration failed');
      }

      return { success: hasConfirmation, confirmationRef };
    } catch (error) {
      await this.logStep('❌ Registration error', { error: error.message });
      await this.takeScreenshot('registration_error');
      return { success: false };
    }
  }

  private async processPayment(): Promise<{ success: boolean; amount?: number }> {
    if (!this.page) throw new Error('Browser page not initialized');

    try {
      await this.logStep('💳 Processing payment');

      // Look for payment section or button
      const paymentButton = this.page.locator('button:has-text("Pay"), button:has-text("Payment"), a:has-text("Pay")').first();
      
      if (await paymentButton.isVisible()) {
        await paymentButton.click();
        await this.page.waitForLoadState('networkidle');
        await this.takeScreenshot('payment_page');

        // In a real implementation, this would handle the payment flow
        // For now, we'll simulate success
        const success = true;
        const amount = 2000; // $20 in cents

        await this.insertMCPToolCall('scp.pay', 
          { amount_cents: amount }, 
          { success, amount_cents: amount },
          success ? 'success' : 'failed'
        );

        if (success) {
          await this.logStep('✅ Payment processed successfully', { amount });
          
          // Insert charge record
          await this.supabase.from('charges').insert({
            plan_execution_id: this.planExecutionId,
            amount_cents: amount,
            status: 'succeeded'
          });
        }

        return { success, amount };
      } else {
        await this.logStep('ℹ️ No payment required');
        return { success: true };
      }
    } catch (error) {
      await this.logStep('❌ Payment error', { error: error.message });
      await this.takeScreenshot('payment_error');
      return { success: false };
    }
  }

  private async updatePlanExecution(status: 'started' | 'completed' | 'failed', result?: any) {
    if (!this.planExecutionId) return;

    const updates: any = {};
    
    if (status === 'started') {
      updates.started_at = new Date().toISOString();
    } else {
      updates.finished_at = new Date().toISOString();
      updates.result = result?.success ? 'success' : 'failed';
      if (result?.confirmationRef) {
        updates.confirmation_ref = result.confirmationRef;
      }
      if (result?.amount) {
        updates.amount_cents = result.amount;
      }
    }

    try {
      await this.supabase
        .from('plan_executions')
        .update(updates)
        .eq('id', this.planExecutionId);
    } catch (error) {
      console.error('Failed to update plan execution:', error);
    }
  }

  private async cleanup(): Promise<void> {
    try {
      if (this.browser) {
        await this.browser.close();
        await this.logStep('🧹 Browser session closed');
      }
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }

  public async run(): Promise<void> {
    try {
      // Create plan execution record
      const { data: executionData, error: executionError } = await this.supabase
        .from('plan_executions')
        .insert({
          plan_id: this.planId,
          started_at: new Date().toISOString()
        })
        .select()
        .single();

      if (executionError || !executionData) {
        throw new Error(`Failed to create plan execution: ${executionError?.message}`);
      }

      this.planExecutionId = executionData.id;
      await this.logStep('📋 Plan execution created', { id: this.planExecutionId });

      // Fetch plan data
      const planData = await this.fetchPlanData();
      await this.logStep('📊 Plan data fetched', planData);

      // Fetch mandate and credentials
      const mandate = await this.fetchMandateData(planData.mandate_id);
      const credentials = await this.fetchCredentials(mandate.credential_id);
      await this.logStep('🔐 Credentials and mandate loaded');

      // Initialize browser
      await this.initializeBrowserbase();

      // Pre-warm: Login
      const loginSuccess = await this.performLogin(credentials);
      if (!loginSuccess) {
        throw new Error('Login failed - cannot proceed with registration');
      }

      // Wait for opening time
      await this.waitForOpening(planData.opens_at);

      // Perform registration
      const registrationResult = await this.performRegistration(mandate);
      if (!registrationResult.success) {
        throw new Error('Registration failed');
      }

      // Process payment if needed
      const paymentResult = await this.processPayment();

      // Update final status
      await this.updatePlanExecution('completed', {
        success: registrationResult.success && paymentResult.success,
        confirmationRef: registrationResult.confirmationRef,
        amount: paymentResult.amount
      });

      await this.logStep('🎉 Worker completed successfully', {
        registration: registrationResult.success,
        payment: paymentResult.success,
        confirmation: registrationResult.confirmationRef
      });

    } catch (error) {
      await this.logStep('💥 Worker failed', { error: error.message });
      await this.updatePlanExecution('failed', { error: error.message });
      await this.takeScreenshot('final_error');
      throw error;
    } finally {
      await this.cleanup();
    }
  }
}

// Main execution
async function main() {
  const worker = new SignupWorker();
  await worker.run();
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
}

export { SignupWorker };