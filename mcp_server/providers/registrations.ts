/**
 * Registrations Provider - MCP Tools for receipt/registration operations
 * Handles creating and listing registration records for audit trail display
 */

import { auditToolCall } from '../middleware/audit.js';
import { createClient } from '@supabase/supabase-js';
import type { ProviderResponse, ParentFriendlyError } from '../types.js';
import { tokenize, isVGSConfigured } from '../lib/vgsClient.js';
import { Logger } from '../utils/logger.js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export interface RegistrationTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
  handler: (args: any) => Promise<any>;
}

/**
 * Registration record structure
 */
export interface RegistrationRecord {
  id: string;
  user_id: string;
  mandate_id?: string;
  charge_id?: string;
  program_name: string;
  program_ref: string;
  provider: string;
  org_ref: string;
  start_date?: string;
  booking_number?: string;
  amount_cents: number;
  success_fee_cents: number;
  delegate_name: string;
  delegate_email: string;
  participant_names: string[];
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'failed';
  scheduled_for?: string;
  executed_at?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Tool: registrations.create
 * Create a registration record after successful booking
 * 
 * PII Tokenization: delegate_email is tokenized via VGS before storage.
 * Both raw delegate_email and delegate_email_alias are stored for backward compat.
 */
async function createRegistration(args: {
  user_id: string;
  mandate_id?: string;
  charge_id?: string;
  program_name: string;
  program_ref: string;
  provider: string;
  org_ref: string;
  start_date?: string;
  booking_number?: string;
  amount_cents: number;
  success_fee_cents?: number;
  delegate_name: string;
  delegate_email: string;
  participant_names: string[];
  scheduled_for?: string; // null = immediate booking, set = scheduled
}): Promise<ProviderResponse<RegistrationRecord>> {
  const {
    user_id,
    mandate_id,
    charge_id,
    program_name,
    program_ref,
    provider,
    org_ref,
    start_date,
    booking_number,
    amount_cents,
    success_fee_cents = 2000,
    delegate_name,
    delegate_email,
    participant_names,
    scheduled_for
  } = args;
  
  // Determine status: pending for scheduled, confirmed for immediate
  const status = scheduled_for ? 'pending' : 'confirmed';
  
  Logger.info('[Registrations] Creating registration', { 
    program_name, 
    delegate_name, 
    status,
    has_scheduled_for: !!scheduled_for 
  });
  
  try {
    // Build insert payload
    // Build insert payload - start with masked email for VGS compliance
    const insertPayload: any = {
      user_id,
      mandate_id,
      charge_id,
      program_name,
      program_ref,
      provider,
      org_ref,
      start_date,
      booking_number,
      amount_cents,
      success_fee_cents,
      delegate_name,
      delegate_email: null, // VGS compliance: never store raw PII
      participant_names,
      status,
      scheduled_for,
      executed_at: scheduled_for ? null : new Date().toISOString()
    };
    
    // Tokenize delegate_email - REQUIRED for App Store compliance
    if (delegate_email && isVGSConfigured()) {
      try {
        const tokenized = await tokenize({ email: delegate_email });
        if (tokenized.email_alias) {
          insertPayload.delegate_email_alias = tokenized.email_alias;
          insertPayload.delegate_email = '[TOKENIZED]'; // Placeholder for display
          Logger.info('[Registrations] Delegate email tokenized successfully');
        } else {
          Logger.error('[Registrations] VGS returned no alias');
          insertPayload.delegate_email = '[TOKENIZATION_FAILED]';
        }
      } catch (tokenizeError) {
        Logger.error('[Registrations] VGS tokenization failed for email', { error: tokenizeError });
        insertPayload.delegate_email = '[TOKENIZATION_FAILED]';
      }
    } else if (!isVGSConfigured()) {
      Logger.warn('[Registrations] VGS not configured - COMPLIANCE VIOLATION: raw email would be exposed');
      // In production, fail the operation if VGS is not configured
      insertPayload.delegate_email = '[VGS_NOT_CONFIGURED]';
    }
    
    const { data, error } = await supabase
      .from('registrations')
      .insert(insertPayload)
      .select()
      .single();
    
    if (error) {
      Logger.error('[Registrations] Database error', { error });
      const friendlyError: ParentFriendlyError = {
        display: 'Unable to save registration record',
        recovery: 'Your booking may have succeeded. Please check your email for confirmation.',
        severity: 'low',
        code: 'REGISTRATION_CREATE_FAILED'
      };
      return {
        success: false,
        error: friendlyError
      };
    }
    
    Logger.info('[Registrations] Registration created successfully', { id: data.id });
    
    return {
      success: true,
      data: data as RegistrationRecord
    };
    
  } catch (error: any) {
    Logger.error('[Registrations] Error creating registration', { error });
    const friendlyError: ParentFriendlyError = {
      display: 'Registration record error',
      recovery: 'Your booking may have succeeded. Please check your email for confirmation.',
      severity: 'low',
      code: 'REGISTRATION_API_ERROR'
    };
    return {
      success: false,
      error: friendlyError
    };
  }
}

/**
 * Tool: registrations.list
 * List user's registrations, grouped by category for receipts display
 */
async function listRegistrations(args: {
  user_id: string;
  category?: 'upcoming' | 'scheduled' | 'past' | 'all';
}): Promise<ProviderResponse<{
  upcoming: RegistrationRecord[];
  scheduled: RegistrationRecord[];
  past: RegistrationRecord[];
  payment_method?: {
    last4: string;
    brand: string;
  };
}>> {
  const { user_id, category = 'all' } = args;
  
  console.log(`[Registrations] Listing registrations for user: ${user_id}, category: ${category}`);
  
  try {
    const now = new Date().toISOString();
    
    // Fetch all registrations for user
    const { data: registrations, error: regError } = await supabase
      .from('registrations')
      .select('*')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false });
    
    if (regError) {
      console.error('[Registrations] Database error:', regError);
      const friendlyError: ParentFriendlyError = {
        display: 'Unable to fetch your registrations',
        recovery: 'Please try again in a moment.',
        severity: 'low',
        code: 'REGISTRATION_LIST_FAILED'
      };
      return {
        success: false,
        error: friendlyError
      };
    }
    
    // Fetch payment method info for display
    const { data: billing } = await supabase
      .from('user_billing')
      .select('payment_method_last4, payment_method_brand')
      .eq('user_id', user_id)
      .maybeSingle();
    
    const allRegs = (registrations || []) as RegistrationRecord[];
    
    // Categorize registrations:
    // - upcoming: status = 'confirmed' AND start_date > now
    // - scheduled: status = 'pending' (scheduled_for is NOT NULL, not yet executed)
    // - past: status IN ('confirmed', 'completed') AND start_date <= now, OR status = 'cancelled'/'failed'
    
    const upcoming: RegistrationRecord[] = [];
    const scheduled: RegistrationRecord[] = [];
    const past: RegistrationRecord[] = [];
    
    for (const reg of allRegs) {
      if (reg.status === 'pending') {
        // Scheduled (waiting to execute)
        scheduled.push(reg);
      } else if (reg.status === 'confirmed' && reg.start_date && new Date(reg.start_date) > new Date(now)) {
        // Confirmed and start date in future
        upcoming.push(reg);
      } else {
        // Past: completed, cancelled, failed, or confirmed with past start_date
        past.push(reg);
      }
    }
    
    // Update status for past confirmed items to 'completed' (optional auto-update)
    // This could be a background job, but for now we just categorize
    
    console.log(`[Registrations] Found: ${upcoming.length} upcoming, ${scheduled.length} scheduled, ${past.length} past`);
    
    return {
      success: true,
      data: {
        upcoming,
        scheduled,
        past,
        payment_method: billing?.payment_method_last4 ? {
          last4: billing.payment_method_last4,
          brand: billing.payment_method_brand || 'Card'
        } : undefined
      }
    };
    
  } catch (error: any) {
    console.error('[Registrations] Error listing registrations:', error);
    const friendlyError: ParentFriendlyError = {
      display: 'Unable to fetch your registrations',
      recovery: 'Please try again in a moment.',
      severity: 'low',
      code: 'REGISTRATION_API_ERROR'
    };
    return {
      success: false,
      error: friendlyError
    };
  }
}

/**
 * Tool: registrations.cancel
 * Cancel a scheduled (pending) registration before it executes
 */
async function cancelRegistration(args: {
  registration_id: string;
  user_id: string;
}): Promise<ProviderResponse<{ cancelled: boolean; registration_id: string }>> {
  const { registration_id, user_id } = args;
  
  console.log(`[Registrations] Cancelling registration: ${registration_id}`);
  
  try {
    // First verify ownership and status
    const { data: existing, error: fetchError } = await supabase
      .from('registrations')
      .select('id, status, user_id')
      .eq('id', registration_id)
      .eq('user_id', user_id)
      .maybeSingle();
    
    if (fetchError || !existing) {
      console.error('[Registrations] Registration not found or access denied');
      const friendlyError: ParentFriendlyError = {
        display: 'Registration not found',
        recovery: 'This registration may have already been processed or cancelled.',
        severity: 'low',
        code: 'REGISTRATION_NOT_FOUND'
      };
      return {
        success: false,
        error: friendlyError
      };
    }
    
    if (existing.status !== 'pending') {
      console.error(`[Registrations] Cannot cancel registration with status: ${existing.status}`);
      const friendlyError: ParentFriendlyError = {
        display: 'Cannot cancel this registration',
        recovery: existing.status === 'confirmed' 
          ? 'This registration has already been completed. Contact the provider to make changes.'
          : 'This registration cannot be cancelled in its current state.',
        severity: 'low',
        code: 'REGISTRATION_CANNOT_CANCEL'
      };
      return {
        success: false,
        error: friendlyError
      };
    }
    
    // Update status to cancelled
    const { error: updateError } = await supabase
      .from('registrations')
      .update({ 
        status: 'cancelled',
        updated_at: new Date().toISOString()
      })
      .eq('id', registration_id)
      .eq('user_id', user_id);
    
    if (updateError) {
      console.error('[Registrations] Update error:', updateError);
      const friendlyError: ParentFriendlyError = {
        display: 'Unable to cancel registration',
        recovery: 'Please try again or contact support.',
        severity: 'medium',
        code: 'REGISTRATION_CANCEL_FAILED'
      };
      return {
        success: false,
        error: friendlyError
      };
    }
    
    console.log(`[Registrations] ✅ Registration cancelled: ${registration_id}`);
    
    return {
      success: true,
      data: {
        cancelled: true,
        registration_id
      }
    };
    
  } catch (error: any) {
    console.error('[Registrations] Error cancelling registration:', error);
    const friendlyError: ParentFriendlyError = {
      display: 'Unable to cancel registration',
      recovery: 'Please try again or contact support.',
      severity: 'medium',
      code: 'REGISTRATION_API_ERROR'
    };
    return {
      success: false,
      error: friendlyError
    };
  }
}

/**
 * Export Registration tools for MCP server registration
 */
export const registrationTools: RegistrationTool[] = [
  {
    name: 'registrations.create',
    description: 'Create a registration record after successful booking (for receipts/audit trail)',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'Supabase user ID'
        },
        mandate_id: {
          type: 'string',
          description: 'Mandate ID authorizing the registration'
        },
        charge_id: {
          type: 'string',
          description: 'Charge ID if success fee was charged'
        },
        program_name: {
          type: 'string',
          description: 'Display name of the program'
        },
        program_ref: {
          type: 'string',
          description: 'Provider-specific program reference'
        },
        provider: {
          type: 'string',
          description: 'Provider ID (e.g., bookeo)'
        },
        org_ref: {
          type: 'string',
          description: 'Organization reference'
        },
        start_date: {
          type: 'string',
          description: 'Program start date (ISO 8601)'
        },
        booking_number: {
          type: 'string',
          description: 'Booking confirmation number from provider'
        },
        amount_cents: {
          type: 'number',
          description: 'Program cost in cents'
        },
        success_fee_cents: {
          type: 'number',
          description: 'SignupAssist success fee in cents (default: 2000)'
        },
        delegate_name: {
          type: 'string',
          description: 'Name of responsible delegate'
        },
        delegate_email: {
          type: 'string',
          description: 'Email of responsible delegate'
        },
        participant_names: {
          type: 'array',
          items: { type: 'string' },
          description: 'Names of participants'
        },
        scheduled_for: {
          type: 'string',
          description: 'Scheduled execution time for Set-and-Forget (ISO 8601), null for immediate'
        }
      },
      required: ['user_id', 'program_name', 'program_ref', 'provider', 'org_ref', 'amount_cents', 'delegate_name', 'delegate_email', 'participant_names']
    },
    handler: async (args: any) => {
      return auditToolCall(
        { plan_execution_id: null, tool: 'registrations.create' },
        args,
        () => createRegistration(args)
      );
    }
  },
  {
    name: 'registrations.list',
    description: 'List user registrations for receipts display, categorized by upcoming/scheduled/past',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'Supabase user ID'
        },
        category: {
          type: 'string',
          enum: ['upcoming', 'scheduled', 'past', 'all'],
          description: 'Filter by category (default: all)'
        }
      },
      required: ['user_id']
    },
    handler: async (args: any) => {
      return auditToolCall(
        { plan_execution_id: null, tool: 'registrations.list' },
        args,
        () => listRegistrations(args)
      );
    }
  },
  {
    name: 'registrations.cancel',
    description: 'Cancel a scheduled (pending) registration before it executes',
    inputSchema: {
      type: 'object',
      properties: {
        registration_id: {
          type: 'string',
          description: 'Registration ID to cancel'
        },
        user_id: {
          type: 'string',
          description: 'Supabase user ID (for ownership verification)'
        }
      },
      required: ['registration_id', 'user_id']
    },
    handler: async (args: any) => {
      return auditToolCall(
        { plan_execution_id: null, tool: 'registrations.cancel' },
        args,
        () => cancelRegistration(args)
      );
    }
  }
];
