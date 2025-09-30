/**
 * SkiClubPro Provider - MCP Tools for SkiClubPro automation
 */

import { verifyMandate } from '../lib/mandates.js';
import { auditToolCall } from '../middleware/audit.js';
import { lookupCredentialsById } from '../lib/credentials.js';
import { launchBrowserbaseSession, discoverProgramRequiredFields, captureScreenshot, closeBrowserbaseSession } from '../lib/browserbase.js';
import { captureScreenshotEvidence } from '../lib/evidence.js';
import { getAvailablePrograms } from '../config/program_mapping.js';
import { createClient } from '@supabase/supabase-js';
import { loginWithCredentials, logoutIfLoggedIn } from '../lib/login.js';
import { skiClubProConfig } from '../config/skiclubproConfig.js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
  credential_id: string;
  user_jwt: string;
  mandate_id?: string;
  plan_execution_id?: string;
}

export interface FieldSchema {
  program_ref: string;
  prerequisites?: Array<{
    id: string;
    label: string;
    type: string;
    required: boolean;
    options?: string[];
    category?: string;
  }>;
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
 * Helper: Ensure user is logged in using config-based login system
 */
async function ensureLoggedIn(session: any, credential_id: string, user_jwt: string) {
  const creds = await lookupCredentialsById(credential_id, user_jwt);
  const { page } = session;

  console.log('DEBUG: Using credentials from cred-get:', creds.email);
  console.log('DEBUG: Attempting login to SkiClubPro...');
  
  // Use the new config-based login helper and capture proof
  const proof = await loginWithCredentials(page, skiClubProConfig, creds);
  
  console.log('DEBUG: Logged in as', creds.email);
  return proof;
}

/**
 * Helper: Ensure user is logged out using config-based logout system
 */
async function ensureLoggedOut(session: any) {
  const { page } = session;
  
  try {
    console.log('DEBUG: Attempting logout...');
    await logoutIfLoggedIn(page, skiClubProConfig.postLoginCheck);
  } catch (error) {
    console.log('DEBUG: Logout not needed or already logged out');
  }
}

/**
 * Real implementation of SkiClubPro field discovery with login/logout handling
 */
export async function scpDiscoverRequiredFields(args: DiscoverRequiredFieldsArgs): Promise<FieldSchema> {
  
  // Validate user JWT is provided
  if (!args.user_jwt) {
    throw new Error('Missing user_jwt for credential lookup');
  }
  
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
      plan_execution_id: args.plan_execution_id || null
    },
    args,
    async () => {
      let session = null;
      try {
        // Launch browser session
        session = await launchBrowserbaseSession();
        
        // ✅ Login first and capture proof
        const proof = await ensureLoggedIn(session, args.credential_id, args.user_jwt);
        
        // For now, just return proof of login
        return {
          status: "ok",
          message: "Login successful",
          proof
        } as any;
        
      } catch (error) {
        console.error('SkiClubPro field discovery failed:', error);
        throw new Error(`SkiClubPro field discovery failed: ${error.message}`);
      } finally {
        // ✅ Logout after scraping
        if (session) {
          await ensureLoggedOut(session);
          await closeBrowserbaseSession(session);
        }
      }
    },
    'scp:read:listings' // Required scope for mandate verification
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