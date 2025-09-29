/**
 * SkiClubPro Provider - MCP Tools for SkiClubPro automation
 */

import { verifyMandate } from '../lib/mandates.js';
import { auditToolCall } from '../middleware/audit.js';
import { lookupCredentials } from '../lib/credentials.js';
import { launchBrowserbaseSession, discoverProgramRequiredFields, captureScreenshot, closeBrowserbaseSession } from '../lib/browserbase.js';
import { captureScreenshotEvidence } from '../lib/evidence.js';
import { getAvailablePrograms } from '../config/program_mapping.js';

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
  
  // Inline program mapping to avoid import issues
  const PROGRAM_MAPPINGS = {
    'blackhawk-ski-club': [
      {
        text_ref: 'blackhawk_winter',
        actual_id: '309',
        title: 'Nordic Kids Wednesday',
        description: 'Wednesday Nordic Kids Program',
        org_ref: 'blackhawk-ski-club'
      },
      {
        text_ref: 'blackhawk_beginner_sat', 
        actual_id: '310',
        title: 'Beginner Skiing - Saturday Morning',
        description: 'Perfect for first-time skiers ages 4-8',
        org_ref: 'blackhawk-ski-club'
      }
    ]
  };
  
  const getProgramId = (textRef: string, orgRef: string = 'blackhawk-ski-club'): string => {
    const mappings = PROGRAM_MAPPINGS[orgRef] || PROGRAM_MAPPINGS['blackhawk-ski-club'];
    const mapping = mappings.find(m => m.text_ref === textRef || m.title === textRef);
    
    if (mapping) {
      return mapping.actual_id;
    }
    
    console.warn(`No program mapping found for ${textRef} in ${orgRef}, using as-is`);
    return textRef;
  };

  return await auditToolCall(
    {
      tool: 'scp.discover_required_fields',
      mandate_id: args.mandate_id || '',
      plan_execution_id: args.plan_execution_id || ''
    },
    args,
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
    const orgRef = args.org_ref || 'blackhawk-ski-club';
    
    // Get real program mappings with current data
    const availablePrograms = getAvailablePrograms(orgRef);
    
    // Convert to the expected format using data from program mappings
    const allPrograms = availablePrograms.map(mapping => ({
      id: mapping.text_ref,
      program_ref: mapping.text_ref,
      title: mapping.title,
      description: mapping.description || `${mapping.title} program`,
      schedule: mapping.schedule,
      age_range: mapping.age_range,
      skill_level: mapping.skill_level,
      price: mapping.price,
      actual_id: mapping.actual_id,
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

    console.log('MCP scp.find_programs returning:', {
      programs: filteredPrograms,
      total: filteredPrograms.length,
      query: args.query || '',
      success: true,
      timestamp: new Date().toISOString()
    });

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