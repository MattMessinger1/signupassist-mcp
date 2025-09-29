/**
 * SkiClubPro Provider - MCP Tools for SkiClubPro automation
 */

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
  mandate_id?: string;
  plan_execution_id?: string;
}

export interface FieldSchema {
  program_ref: string;
  branches: Array<{
    choice: string;
    questions: Array<{
      id: string;
      label: string;
      type: string;
      required: boolean;
      options?: string[];
      category?: string;
    }>;
  }>;
}

/**
 * Real implementation of SkiClubPro field discovery
 */
export async function scpDiscoverRequiredFields(args: DiscoverRequiredFieldsArgs): Promise<FieldSchema> {
  const { verifyMandate } = require('../lib/mandates');
  const { auditToolCall } = require('../middleware/audit');
  const { lookupCredentials } = require('../lib/credentials');
  const { launchBrowserbaseSession, discoverProgramRequiredFields, captureScreenshot, closeBrowserbaseSession } = require('../lib/browserbase');
  const { captureScreenshotEvidence } = require('../lib/evidence');
  const { getProgramId } = require('../config/program_mapping');

  return await auditToolCall(
    {
      tool: 'scp.discover_required_fields',
      args,
      mandate_id: args.mandate_id,
      plan_execution_id: args.plan_execution_id
    },
    async () => {
      // Verify mandate has required scope
      if (args.mandate_id) {
        await verifyMandate(args.mandate_id, 'scp:read:listings');
      }

      let session = null;
      try {
        // Launch browser session
        session = await launchBrowserbaseSession();
        
        // Convert text reference to actual program ID using program mapping
        const orgRef = 'blackhawk-ski-club'; // Default org
        const programId = getProgramId(args.program_ref, orgRef);
        
        console.log(`Converting program_ref "${args.program_ref}" to ID "${programId}" for org "${orgRef}"`);
        
        // Discover program fields using real browser automation with converted ID
        const fieldSchema = await discoverProgramRequiredFields(session, programId, orgRef);
        
        // Capture evidence screenshot
        if (args.plan_execution_id) {
          const screenshot = await captureScreenshot(session);
          await captureScreenshotEvidence(args.plan_execution_id, screenshot, 'discovery');
        }
        
        console.log('Field discovery result:', fieldSchema);
        return fieldSchema;
        
      } catch (error) {
        console.error('SkiClubPro field discovery failed:', error);
        
        // Capture error screenshot if session exists
        if (session && args.plan_execution_id) {
          try {
            const errorScreenshot = await captureScreenshot(session, 'discovery-failed.png');
            await captureScreenshotEvidence(args.plan_execution_id, errorScreenshot, 'failed-field-discovery');
          } catch (evidenceError) {
            console.error('Failed to capture error evidence:', evidenceError);
          }
        }
        
        throw new Error(`SkiClubPro field discovery failed: ${error.message}`);
      } finally {
        if (session) {
          await closeBrowserbaseSession(session);
        }
      }
    }
  );
}

export const skiClubProTools = {
  'scp.discover_required_fields': scpDiscoverRequiredFields,

  'scp.check_account_status': async (args: { credential_id: string; org_ref?: string; email?: string; mandate_id?: string; plan_execution_id?: string }) => {
    // Stub implementation
    return {
      status: 'ok',
      account_exists: true,
      verified: true,
      credential_id: args.credential_id,
      timestamp: new Date().toISOString()
    };
  },

  'scp.check_membership_status': async (args: { org_ref: string; mandate_id?: string; plan_execution_id?: string }) => {
    // Stub implementation
    return {
      membership: 'active',
      expires_at: '2024-12-31',
      plan_type: 'family',
      org_ref: args.org_ref,
      timestamp: new Date().toISOString()
    };
  },

  'scp.check_payment_method': async (args: { mandate_id: string; plan_execution_id?: string }) => {
    // Stub implementation
    return {
      payment_method: 'valid',
      card_last_four: '4242',
      card_type: 'visa',
      mandate_id: args.mandate_id,
      timestamp: new Date().toISOString()
    };
  },

  'scp.login': async (args: any) => {
    // Stub implementation
    return {
      success: true,
      session_id: 'mock_session_' + Date.now(),
      message: 'Login successful',
      timestamp: new Date().toISOString()
    };
  },

  'scp.register': async (args: any) => {
    // Stub implementation
    return {
      success: true,
      registration_id: 'reg_' + Date.now(),
      message: 'Registration successful',
      program_ref: args.program_ref,
      timestamp: new Date().toISOString()
    };
  },

  'scp.find_programs': async (args: { org_ref?: string; query?: string; mandate_id?: string; plan_execution_id?: string }) => {
    const { getAvailablePrograms } = require('../config/program_mapping');
    const orgRef = args.org_ref || 'blackhawk-ski-club';
    
    // Get real program mappings
    const availablePrograms = getAvailablePrograms(orgRef);
    
    // Convert to the expected format with realistic data
    const allPrograms = availablePrograms.map(mapping => ({
      id: mapping.text_ref,
      program_ref: mapping.text_ref,
      title: mapping.title,
      description: mapping.description || `${mapping.title} program`,
      schedule: 'Registration opens December 1st, 2024',
      age_range: '6-12 years',
      skill_level: 'All levels',
      price: '$150/session',
      actual_id: mapping.actual_id, // Include the real SkiClubPro ID
      org_ref: mapping.org_ref
    }));

    // Filter by query if provided
    let filteredPrograms = allPrograms;
    if (args.query) {
      const query = args.query.toLowerCase();
      filteredPrograms = allPrograms.filter(program => 
        program.title.toLowerCase().includes(query) ||
        program.description.toLowerCase().includes(query) ||
        program.skill_level.toLowerCase().includes(query) ||
        program.schedule.toLowerCase().includes(query)
      );
    }

    return {
      programs: filteredPrograms,
      total: filteredPrograms.length,
      query: args.query || '',
      success: true,
      timestamp: new Date().toISOString()
    };
  },

  'scp.pay': async (args: any) => {
    // Stub implementation
    return {
      success: true,
      payment_id: 'pay_' + Date.now(),
      amount: args.amount,
      status: 'completed',
      timestamp: new Date().toISOString()
    };
  }
};