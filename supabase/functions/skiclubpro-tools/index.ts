import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { chromium } from 'npm:playwright@1.55.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Supabase client setup for edge function context
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);

// Types
interface FieldQuestion {
  question_id: string;
  label: string;
  type: 'text' | 'select' | 'radio' | 'checkbox' | 'date' | 'number' | 'email';
  required: boolean;
  options?: string[];
}

interface FieldBranch {
  branch_id: string;
  title: string;
  questions: FieldQuestion[];
}

interface FieldSchema {
  program_ref: string;
  branches: FieldBranch[];
  common_questions?: FieldQuestion[];
}

interface BrowserbaseSession {
  sessionId: string;
  browser: any;
  context: any;
  page: any;
}

// Evidence capture function adapted for edge function
async function captureEvidence(
  planExecutionId: string,
  evidenceType: string,
  data: string,
  filename?: string
): Promise<{ asset_url: string; sha256: string }> {
  const finalFilename = filename || `${evidenceType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.png`;
  
  // Calculate SHA256 hash
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const sha256 = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  // For now, simulate evidence storage (would upload to Supabase Storage in production)
  const assetUrl = `https://evidence.signupassist.com/${planExecutionId}/${finalFilename}`;
  
  // Log evidence to database
  const { error } = await supabaseClient
    .from('evidence_assets')
    .insert({
      plan_execution_id: planExecutionId,
      type: evidenceType,
      url: assetUrl,
      sha256,
      ts: new Date().toISOString(),
    });

  if (error) {
    throw new Error(`Failed to log evidence: ${error.message}`);
  }

  return { asset_url: assetUrl, sha256 };
}

// Audit logging function adapted for edge function
async function logToolCall(context: { plan_execution_id: string; mandate_id: string; tool: string }, args: any, result: any, decision: string): Promise<void> {
  try {
    const argsJson = JSON.stringify(args, Object.keys(args || {}).sort());
    const resultJson = JSON.stringify(result, Object.keys(result || {}).sort());
    
    const argsEncoder = new TextEncoder();
    const resultEncoder = new TextEncoder();
    const argsBuffer = await crypto.subtle.digest('SHA-256', argsEncoder.encode(argsJson));
    const resultBuffer = await crypto.subtle.digest('SHA-256', resultEncoder.encode(resultJson));
    
    const argsHashArray = Array.from(new Uint8Array(argsBuffer));
    const resultHashArray = Array.from(new Uint8Array(resultBuffer));
    const argsHash = argsHashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    const resultHash = resultHashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    await supabaseClient
      .from('mcp_tool_calls')
      .insert({
        plan_execution_id: context.plan_execution_id,
        mandate_id: context.mandate_id,
        tool: context.tool,
        args_json: args,
        args_hash: argsHash,
        result_json: result,
        result_hash: resultHash,
        decision,
        ts: new Date().toISOString(),
      });
  } catch (error) {
    console.error('Failed to log tool call:', error);
  }
}

// Enhanced Browserbase session management with real Playwright automation
async function launchBrowserbaseSession(): Promise<BrowserbaseSession> {
  try {
    const browserbaseApiKey = Deno.env.get('BROWSERBASE_API_KEY');
    const browserbaseProjectId = Deno.env.get('BROWSERBASE_PROJECT_ID');
    
    if (!browserbaseApiKey) {
      throw new Error('BROWSERBASE_API_KEY environment variable is required');
    }
    
    if (!browserbaseProjectId) {
      throw new Error('BROWSERBASE_PROJECT_ID environment variable is required');
    }

    console.log('Creating Browserbase session for field discovery...');
    
    // Create Browserbase session using REST API
    const response = await fetch('https://www.browserbase.com/v1/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${browserbaseApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectId: browserbaseProjectId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Browserbase API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const session = await response.json();
    console.log(`Browserbase session created: ${session.id}`);

    // Connect Playwright to Browserbase using CDP
    const wsUrl = `wss://connect.browserbase.com?apiKey=${browserbaseApiKey}&sessionId=${session.id}`;
    console.log('Connecting Playwright to Browserbase...');
    
    const browser = await chromium.connectOverCDP(wsUrl);
    const context = browser.contexts()[0] || await browser.newContext();
    const page = await context.newPage();
    
    // Set up page for form interaction
    await page.setViewportSize({ width: 1920, height: 1080 });

    return {
      sessionId: session.id,
      browser,
      context,
      page,
    };
    
  } catch (error) {
    console.error('Failed to launch Browserbase session:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to launch Browserbase session: ${errorMessage}`);
  }
}

async function closeBrowserbaseSession(session: BrowserbaseSession): Promise<void> {
  try {
    console.log(`Closing Browserbase session: ${session.sessionId}`);
    if (session.browser) {
      await session.browser.close();
    }
  } catch (error) {
    console.error('Error closing Browserbase session:', error);
  }
}

async function captureScreenshot(session: BrowserbaseSession, filename?: string): Promise<string> {
  try {
    const screenshot = await session.page.screenshot({ 
      fullPage: true,
      type: 'png'
    });
    
    // Convert screenshot to base64 for storage/evidence
    const base64Screenshot = btoa(String.fromCharCode(...new Uint8Array(screenshot)));
    return base64Screenshot;
  } catch (error) {
    console.error('Error capturing screenshot:', error);
    throw error;
  }
}

// Smart form filling utilities
function generateRealisticSampleData(field: any): string {
  const label = field.label.toLowerCase();
  
  if (field.type === 'email') return 'sample.user@example.com';
  if (field.type === 'date') {
    if (label.includes('birth') || label.includes('dob')) {
      return '2010-06-15'; // Child birthdate
    }
    return new Date().toISOString().split('T')[0];
  }
  if (field.type === 'number') {
    if (label.includes('age')) return '12';
    if (label.includes('phone')) return '5551234567';
    return '1';
  }
  if (label.includes('name')) return 'Sample Child';
  if (label.includes('phone')) return '(555) 123-4567';
  if (label.includes('address')) return '123 Main Street';
  if (label.includes('city')) return 'Denver';
  if (label.includes('zip')) return '80202';
  if (label.includes('state')) return 'Colorado';
  if (label.includes('emergency')) return 'Parent Guardian';
  if (label.includes('medical')) return 'No known allergies';
  if (label.includes('comment')) return 'Sample comment';
  
  return 'Sample Data';
}

async function fillRequiredFieldsWithSampleData(session: BrowserbaseSession, fields: any[]): Promise<void> {
  console.log(`Filling ${fields.length} required fields with sample data`);
  
  for (const field of fields) {
    if (!field.required) continue;
    
    try {
      const fillScript = `
        (() => {
          const element = document.getElementById('${field.element_info.id}') || 
                         document.querySelector('[name="${field.element_info.name}"]');
          
          if (!element) return false;
          
          if (element.tagName.toLowerCase() === 'select') {
            // Select the first non-empty option
            for (let i = 1; i < element.options.length; i++) {
              if (element.options[i].value && element.options[i].text.trim()) {
                element.selectedIndex = i;
                element.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              }
            }
          } else if (element.type === 'radio') {
            // Select the first radio option in the group
            const radios = document.querySelectorAll('[name="${field.element_info.name}"]');
            if (radios.length > 0) {
              radios[0].checked = true;
              radios[0].dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
          } else if (element.type === 'checkbox') {
            element.checked = true;
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          } else {
            // Text, email, date, etc.
            element.value = '${generateRealisticSampleData(field)}';
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
          return false;
        })();
      `;
      
      await session.page.evaluate(fillScript);
      await session.page.waitForTimeout(500); // Brief pause between fills
      
    } catch (error) {
      console.error(`Error filling field ${field.label}:`, error);
    }
  }
}

async function proceedToNextStep(session: BrowserbaseSession): Promise<{ success: boolean; stepType: string; url: string }> {
  const currentUrl = session.page.url();
  console.log('Attempting to proceed to next step from:', currentUrl);
  
  // Try different button selectors for proceeding
  const proceedButtons = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Next")',
    'button:has-text("Continue")',
    'button:has-text("Proceed")',
    'button:has-text("Submit")',
    '.btn-primary',
    '.next-button',
    '.continue-btn'
  ];
  
  for (const selector of proceedButtons) {
    try {
      const button = await session.page.locator(selector).first();
      
      if (await button.isVisible()) {
        console.log(`Found proceed button with selector: ${selector}`);
        
        await button.click();
        
        // Wait for navigation or URL change
        await session.page.waitForTimeout(3000);
        
        const newUrl = session.page.url();
        if (newUrl !== currentUrl) {
          console.log(`Successfully navigated from ${currentUrl} to ${newUrl}`);
          
          // Determine step type based on URL
          let stepType = 'unknown';
          if (newUrl.includes('payment') || newUrl.includes('billing')) {
            stepType = 'payment';
          } else if (newUrl.includes('confirm') || newUrl.includes('review')) {
            stepType = 'confirmation';
          } else if (newUrl.includes('waiver') || newUrl.includes('legal')) {
            stepType = 'waiver';
          } else if (newUrl.includes('emergency') || newUrl.includes('contact')) {
            stepType = 'emergency_contact';
          } else {
            stepType = 'additional_info';
          }
          
          return { success: true, stepType, url: newUrl };
        }
      }
    } catch (error) {
      // Continue trying other selectors
    }
  }
  
  console.log('No proceed button found or navigation failed');
  return { success: false, stepType: 'none', url: currentUrl };
}

async function discoverCurrentPageFields(session: BrowserbaseSession): Promise<any[]> {
  const fieldDiscoveryScript = `
    (() => {
      const forms = document.querySelectorAll('form');
      if (forms.length === 0) return [];
      
      function extractFieldInfo(input) {
        const style = window.getComputedStyle(input);
        if (input.type === 'hidden' || style.display === 'none' || style.visibility === 'hidden') {
          return null;
        }
        
        const label = document.querySelector('label[for="' + input.id + '"]')?.textContent?.trim() || 
                     input.getAttribute('placeholder') || 
                     input.getAttribute('name') || 
                     input.closest('.form-group, .field, .input-group, .form-field')?.querySelector('label')?.textContent?.trim() ||
                     input.closest('tr')?.querySelector('td:first-child')?.textContent?.trim() ||
                     'Unknown Field';
        
        const field = {
          question_id: input.id || input.name || 'field_' + Math.random().toString(36).substr(2, 9),
          label: label,
          type: input.type || input.tagName.toLowerCase(),
          required: input.hasAttribute('required') || input.getAttribute('aria-required') === 'true' || 
                   input.closest('.required, .mandatory')?.length > 0,
          options: [],
          element_info: {
            id: input.id,
            name: input.name,
            tagName: input.tagName,
            className: input.className
          }
        };
        
        // Capture options for select elements
        if (input.tagName.toLowerCase() === 'select') {
          field.options = Array.from(input.options || [])
            .map(option => option.text)
            .filter(text => text.trim() && text !== 'Select...' && text !== '-- Choose --' && text !== 'Please select');
        }
        
        // Handle radio buttons
        if (input.type === 'radio') {
          field.question_id = input.name;
          const radioLabel = input.nextElementSibling?.textContent?.trim() || 
                           input.closest('label')?.textContent?.trim() || 
                           input.value;
          field.options = [radioLabel || 'Option'];
        }
        
        return field;
      }
      
      const allFields = [];
      const radioGroups = new Map();
      
      forms.forEach(form => {
        const inputs = form.querySelectorAll('input, select, textarea');
        
        inputs.forEach(input => {
          const fieldInfo = extractFieldInfo(input);
          if (!fieldInfo) return;
          
          if (input.type === 'radio') {
            if (radioGroups.has(fieldInfo.question_id)) {
              const existing = radioGroups.get(fieldInfo.question_id);
              existing.options = existing.options.concat(fieldInfo.options);
            } else {
              radioGroups.set(fieldInfo.question_id, fieldInfo);
            }
          } else {
            allFields.push(fieldInfo);
          }
        });
      });
      
      // Add radio groups to fields
      radioGroups.forEach(group => allFields.push(group));
      
      return allFields;
    })();
  `;
  
  return await session.page.evaluate(fieldDiscoveryScript);
}

// Complete multi-step signup flow discovery
async function discoverCompleteSignupFlow(session: BrowserbaseSession, programRef: string, planExecutionId: string): Promise<FieldSchema> {
  console.log('Starting complete multi-step signup flow discovery');
  
  const allFlowPaths: Array<{
    pathId: string;
    title: string;
    steps: Array<{
      stepNumber: number;
      stepType: string;
      url: string;
      fields: any[];
    }>;
  }> = [];
  
  const commonFields: FieldQuestion[] = [];
  let stepNumber = 1;
  
  // Discover initial page fields
  const initialFields = await discoverCurrentPageFields(session);
  console.log(`Step ${stepNumber}: Found ${initialFields.length} fields on initial registration page`);
  
  // Take screenshot of initial step
  const initialScreenshot = await captureScreenshot(session, `step-${stepNumber}-initial`);
  await captureEvidence(planExecutionId, 'step_screenshot', initialScreenshot, `step-${stepNumber}-initial-${Date.now()}.png`);
  
  // Identify branching fields for path exploration
  const branchingFields = initialFields.filter(field => 
    (field.type === 'select' && field.options.length > 0) || 
    (field.type === 'radio' && field.options.length > 1)
  );
  
  console.log(`Found ${branchingFields.length} branching fields for path exploration`);
  
  // If no branching fields, explore a single linear path
  if (branchingFields.length === 0) {
    const singlePath = await exploreLinearPath(session, planExecutionId, 'default', 'Standard Flow');
    allFlowPaths.push(singlePath);
  } else {
    // Explore different paths based on branching choices
    let pathCount = 0;
    
    for (const branchField of branchingFields.slice(0, 2)) { // Limit to 2 main branching fields
      for (const option of branchField.options.slice(0, 3)) { // Test up to 3 options per field
        pathCount++;
        
        try {
          // Reset page to initial state (reload)
          await session.page.reload({ waitUntil: 'networkidle' });
          await session.page.waitForSelector('form', { timeout: 15000 });
          
          console.log(`Exploring path ${pathCount}: ${branchField.label} = ${option}`);
          
          // Select the branching option
          await selectBranchingOption(session, branchField, option);
          
          // Fill other required fields
          const currentFields = await discoverCurrentPageFields(session);
          await fillRequiredFieldsWithSampleData(session, currentFields.filter(f => f.required));
          
          // Explore this path through all steps
          const pathTitle = `${branchField.label}: ${option}`;
          const flowPath = await exploreLinearPath(session, planExecutionId, `path_${pathCount}`, pathTitle);
          allFlowPaths.push(flowPath);
          
        } catch (error) {
          console.error(`Error exploring path for ${branchField.label} = ${option}:`, error);
        }
        
        // Limit total paths explored
        if (pathCount >= 6) break;
      }
      if (pathCount >= 6) break;
    }
  }
  
  // Identify truly common fields across all paths
  if (allFlowPaths.length > 1) {
    const fieldCounts = new Map<string, number>();
    const fieldExamples = new Map<string, FieldQuestion>();
    
    allFlowPaths.forEach(path => {
      path.steps.forEach(step => {
        step.fields.forEach(field => {
          const key = `${field.question_id}_${field.label}`;
          fieldCounts.set(key, (fieldCounts.get(key) || 0) + 1);
          if (!fieldExamples.has(key)) {
            fieldExamples.set(key, {
              question_id: field.question_id,
              label: field.label,
              type: field.type,
              required: field.required,
              options: field.options
            });
          }
        });
      });
    });
    
    // Fields that appear in all paths are common
    fieldCounts.forEach((count, key) => {
      if (count === allFlowPaths.length) {
        const field = fieldExamples.get(key);
        if (field) {
          commonFields.push(field);
        }
      }
    });
  }
  
  // Convert flow paths to branches
  const branches: FieldBranch[] = allFlowPaths.map(path => ({
    branch_id: path.pathId,
    title: path.title,
    questions: path.steps.flatMap(step => 
      step.fields
        .filter(field => !commonFields.find(common => 
          common.question_id === field.question_id && common.label === field.label
        ))
        .map(field => ({
          question_id: field.question_id,
          label: field.label,
          type: field.type as any,
          required: field.required,
          options: field.options
        }))
    )
  }));
  
  console.log(`Complete flow discovery finished. Found ${allFlowPaths.length} paths, ${commonFields.length} common fields`);
  
  return {
    program_ref: programRef,
    branches: branches,
    common_questions: commonFields
  };
}

async function selectBranchingOption(session: BrowserbaseSession, branchField: any, option: string): Promise<void> {
  const selectionScript = `
    (() => {
      const field = document.getElementById('${branchField.element_info.id}') || 
                   document.querySelector('[name="${branchField.element_info.name}"]');
      
      if (!field) return false;
      
      if (field.tagName.toLowerCase() === 'select') {
        for (let i = 0; i < field.options.length; i++) {
          if (field.options[i].text === '${option}' || field.options[i].value === '${option}') {
            field.selectedIndex = i;
            field.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
      } else if (field.type === 'radio') {
        const radioElements = document.querySelectorAll('[name="${branchField.element_info.name}"]');
        for (const radio of radioElements) {
          const label = radio.nextElementSibling?.textContent?.trim() || radio.value;
          if (label === '${option}') {
            radio.checked = true;
            radio.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
      }
      return false;
    })();
  `;
  
  await session.page.evaluate(selectionScript);
  await session.page.waitForTimeout(2000); // Wait for dynamic changes
}

async function exploreLinearPath(session: BrowserbaseSession, planExecutionId: string, pathId: string, pathTitle: string): Promise<any> {
  console.log(`Exploring linear path: ${pathTitle}`);
  
  const steps: any[] = [];
  let stepNumber = 1;
  let maxSteps = 8; // Prevent infinite loops
  
  while (stepNumber <= maxSteps) {
    const currentUrl = session.page.url();
    console.log(`Step ${stepNumber}: Analyzing page at ${currentUrl}`);
    
    // Discover fields on current page
    const fields = await discoverCurrentPageFields(session);
    console.log(`Step ${stepNumber}: Found ${fields.length} fields`);
    
    // Take screenshot
    const stepScreenshot = await captureScreenshot(session, `${pathId}-step-${stepNumber}`);
    await captureEvidence(planExecutionId, 'step_screenshot', stepScreenshot, `${pathId}-step-${stepNumber}-${Date.now()}.png`);
    
    // Determine step type
    let stepType = 'form';
    if (currentUrl.includes('payment') || currentUrl.includes('billing')) stepType = 'payment';
    else if (currentUrl.includes('confirm') || currentUrl.includes('review')) stepType = 'confirmation';
    else if (currentUrl.includes('waiver') || currentUrl.includes('legal')) stepType = 'waiver';
    else if (currentUrl.includes('emergency') || currentUrl.includes('contact')) stepType = 'emergency_contact';
    
    steps.push({
      stepNumber,
      stepType,
      url: currentUrl,
      fields
    });
    
    // If this looks like a final step (payment/confirmation), stop here
    if (stepType === 'payment' || stepType === 'confirmation' || fields.length === 0) {
      console.log(`Reached final step: ${stepType}`);
      break;
    }
    
    // Fill required fields
    await fillRequiredFieldsWithSampleData(session, fields.filter(f => f.required));
    
    // Try to proceed to next step
    const nextStep = await proceedToNextStep(session);
    
    if (!nextStep.success) {
      console.log('Could not proceed further, ending path exploration');
      break;
    }
    
    stepNumber++;
    await session.page.waitForTimeout(2000); // Brief pause between steps
  }
  
  return {
    pathId,
    title: pathTitle,
    steps
  };
}

// Enhanced multi-step field discovery with complete flow navigation
async function discoverRequiredFields(args: any, planExecutionId: string): Promise<FieldSchema> {
  console.log('Starting enhanced multi-step field discovery for program:', args.program_ref);
  
  let session: BrowserbaseSession | null = null;
  
  try {
    // Launch real Browserbase session with Playwright
    session = await launchBrowserbaseSession();
    console.log('Browserbase session launched successfully');
    
    // Navigate to program registration page
    const registrationUrl = `https://app.skiclubpro.com/register/${args.program_ref}`;
    console.log(`Navigating to: ${registrationUrl}`);
    
    await session.page.goto(registrationUrl, { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    // Wait for form to load
    await session.page.waitForSelector('form', { timeout: 15000 });
    console.log('Registration form loaded');
    
    // Take initial screenshot for evidence
    const initialScreenshot = await captureScreenshot(session, `initial-${args.program_ref}`);
    await captureEvidence(planExecutionId, 'initial_screenshot', initialScreenshot, `initial-${args.program_ref}-${Date.now()}.png`);
    
    // Discover the complete signup flow with all steps
    const completeSchema = await discoverCompleteSignupFlow(session, args.program_ref, planExecutionId);
    
    console.log(`Enhanced field discovery completed for program: ${args.program_ref}`);
    console.log(`Schema includes ${completeSchema.branches.length} flow paths and ${completeSchema.common_questions?.length || 0} common questions`);
    
    return completeSchema;

  } catch (error) {
    console.error('Error during field discovery:', error);
    
    // Capture error screenshot if session exists
    if (session) {
      try {
        const errorScreenshot = await captureScreenshot(session, `error-${args.program_ref}`);
        await captureEvidence(planExecutionId, 'error_screenshot', errorScreenshot, `error-${args.program_ref}-${Date.now()}.png`);
      } catch (screenshotError) {
        console.error('Failed to capture error screenshot:', screenshotError);
      }
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to discover fields for program ${args.program_ref}: ${errorMessage}`);
    
  } finally {
    // Always close the session
    if (session) {
      await closeBrowserbaseSession(session);
    }
  }
}

async function checkAccountStatus(args: any, planExecutionId: string) {
  console.log('Checking account status for mandate:', args.mandate_id);
  
  // Launch browser session to verify account
  let session: BrowserbaseSession | null = null;
  
  try {
    session = await launchBrowserbaseSession();
    
    // Navigate to SkiClubPro login to check account status
    await session.page.goto('https://skiclubpro.com/login', { waitUntil: 'networkidle' });
    
    // Use provided credentials to test login
    const credentials = args.credential_data;
    if (credentials?.email && credentials?.password) {
      await session.page.fill('#email', credentials.email);
      await session.page.fill('#password', credentials.password);
      
      // Attempt login to verify account exists and is active
      await session.page.click('button[type="submit"]');
      await session.page.waitForTimeout(3000);
      
      const currentUrl = session.page.url();
      const isLoggedIn = !currentUrl.includes('login') && !currentUrl.includes('error');
      
      const result = {
        status: isLoggedIn ? 'active' : 'inactive',
        exists: isLoggedIn,
        verified: isLoggedIn,
        account_id: isLoggedIn ? `acc_${Date.now()}` : null,
        message: isLoggedIn ? 'Account is active and verified' : 'Unable to verify account access',
        browserbase_ready: true
      };
      
      // Capture evidence
      const screenshot = await captureScreenshot(session, `account-status-${Date.now()}`);
      await captureEvidence(planExecutionId, 'account_status', screenshot);
      
      return result;
    }
  } catch (error) {
    console.error('Account status check failed:', error);
    throw new Error(`Account verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    if (session) {
      await closeBrowserbaseSession(session);
    }
  }
  
  throw new Error('No valid credentials provided for account verification');
}

async function checkMembershipStatus(args: any, planExecutionId: string) {
  console.log('Checking membership status for mandate:', args.mandate_id);
  
  let session: BrowserbaseSession | null = null;
  
  try {
    session = await launchBrowserbaseSession();
    const credentials = args.credential_data;
    
    // Navigate to member portal and check membership status
    await session.page.goto('https://skiclubpro.com/member/dashboard', { waitUntil: 'networkidle' });
    
    // Login if not already authenticated
    if (session.page.url().includes('login')) {
      await session.page.fill('#email', credentials.email);
      await session.page.fill('#password', credentials.password);
      await session.page.click('button[type="submit"]');
      await session.page.waitForNavigation({ waitUntil: 'networkidle' });
    }
    
    // Check for membership information on dashboard
    const membershipInfo = await session.page.evaluate(() => {
      const membershipSection = (globalThis as any).document.querySelector('.membership-status, .member-info, .account-status');
      const isActive = membershipSection?.textContent?.toLowerCase().includes('active') || 
                      membershipSection?.textContent?.toLowerCase().includes('current');
      
      return {
        active: isActive,
        found_section: !!membershipSection,
        content: membershipSection?.textContent?.trim() || ''
      };
    });
    
    const result = {
      is_member: membershipInfo.active,
      active: membershipInfo.active,
      expires_at: membershipInfo.active ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() : null,
      membership_type: membershipInfo.active ? 'family' : 'none',
      message: membershipInfo.active ? 'Membership is current and active' : 'No active membership found'
    };
    
    // Capture evidence
    const screenshot = await captureScreenshot(session, `membership-status-${Date.now()}`);
    await captureEvidence(planExecutionId, 'membership_status', screenshot);
    
    return result;
    
  } catch (error) {
    console.error('Membership status check failed:', error);
    throw new Error(`Membership verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    if (session) {
      await closeBrowserbaseSession(session);
    }
  }
}

async function checkStoredPaymentMethod(args: any, planExecutionId: string) {
  console.log('Checking stored payment method for mandate:', args.mandate_id);
  
  let session: BrowserbaseSession | null = null;
  
  try {
    session = await launchBrowserbaseSession();
    const credentials = args.credential_data;
    
    // Navigate to billing/payment section
    await session.page.goto('https://skiclubpro.com/member/billing', { waitUntil: 'networkidle' });
    
    // Login if needed
    if (session.page.url().includes('login')) {
      await session.page.fill('#email', credentials.email);
      await session.page.fill('#password', credentials.password);
      await session.page.click('button[type="submit"]');
      await session.page.waitForNavigation({ waitUntil: 'networkidle' });
    }
    
    // Check for stored payment methods
    const paymentInfo = await session.page.evaluate(() => {
      const doc = (globalThis as any).document;
      const paymentSection = doc.querySelector('.payment-methods, .billing-info, .card-info');
      const hasCard = paymentSection?.textContent?.includes('ending in') || 
                     paymentSection?.textContent?.includes('**** ') ||
                     doc.querySelector('.credit-card, .payment-card');
      
      const cardNumber = paymentSection?.textContent?.match(/\*+\s*(\d{4})/)?.[1] || '****';
      
      return {
        has_payment_method: !!hasCard,
        found_section: !!paymentSection,
        card_info: cardNumber
      };
    });
    
    const result = {
      has_payment_method: paymentInfo.has_payment_method,
      on_file: paymentInfo.has_payment_method,
      payment_method_type: paymentInfo.has_payment_method ? 'card' : 'none',
      last_four: paymentInfo.has_payment_method ? paymentInfo.card_info : null,
      message: paymentInfo.has_payment_method ? 'Valid payment method on file' : 'No payment method found'
    };
    
    // Capture evidence
    const screenshot = await captureScreenshot(session, `payment-method-${Date.now()}`);
    await captureEvidence(planExecutionId, 'payment_method_status', screenshot);
    
    return result;
    
  } catch (error) {
    console.error('Payment method check failed:', error);
    throw new Error(`Payment method verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    if (session) {
      await closeBrowserbaseSession(session);
    }
  }
}

// Tool router
const tools: Record<string, (args: any, planExecutionId: string) => Promise<any>> = {
  'scp.discover_required_fields': discoverRequiredFields,
  'scp.check_account_status': checkAccountStatus,
  'scp.check_membership_status': checkMembershipStatus,
  'scp.check_stored_payment_method': checkStoredPaymentMethod,
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { tool, args } = await req.json();
    
    if (!tool || !args) {
      return new Response(
        JSON.stringify({ error: 'Missing tool or args' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Executing MCP tool: ${tool} with args:`, args);

    // Get the tool implementation
    const toolImpl = tools[tool];
    if (!toolImpl) {
      return new Response(
        JSON.stringify({ error: `Unknown tool: ${tool}` }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const planExecutionId = args.plan_execution_id || 'interactive';
    const mandateId = args.mandate_id || 'temp_mandate';

    // Create audit context
    const auditContext = {
      plan_execution_id: planExecutionId,
      mandate_id: mandateId,
      tool: tool
    };

    // Execute the tool with audit logging
    let result;
    let decision = 'allowed';
    
    try {
      result = await toolImpl(args, planExecutionId);
      console.log(`Tool ${tool} completed successfully`);
    } catch (toolError) {
      decision = 'denied';
      console.error(`Tool ${tool} failed:`, toolError);
      result = { 
        error: 'Tool execution failed',
        details: toolError instanceof Error ? toolError.message : 'Unknown error'
      };
    }

    // Log the tool call for audit trail
    await logToolCall(auditContext, args, result, decision);

    if (decision === 'denied') {
      return new Response(
        JSON.stringify(result),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    return new Response(
      JSON.stringify(result),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in skiclubpro-tools function:', error);
    
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});