/**
 * Registrations Provider - MCP Tools for receipt/registration operations
 * Handles creating and listing registration records for audit trail display
 */

import { auditToolCall } from '../middleware/audit.js';
import { createClient } from '@supabase/supabase-js';
import type { ProviderResponse, ParentFriendlyError } from '../types.js';
import Logger from '../utils/logger.js';

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
  delegate_email: string | null;
  participant_names: string[];
  /** Provider-hosted checkout/payment URL (provider is merchant-of-record). */
  provider_checkout_url?: string | null;
  /** Provider program-fee payment state (provider is merchant-of-record). */
  provider_payment_status?: 'paid' | 'unpaid' | 'unknown' | null;
  provider_amount_due_cents?: number | null;
  provider_amount_paid_cents?: number | null;
  provider_currency?: string | null;
  provider_payment_last_checked_at?: string | null;
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
 * Email stored directly - Supabase encrypts data at rest
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
  delegate_email: string | null;
  participant_names: string[];
  scheduled_for?: string; // null = immediate booking, set = scheduled
  provider_checkout_url?: string | null;
  provider_payment_status?: 'paid' | 'unpaid' | 'unknown' | null;
  provider_amount_due_cents?: number | null;
  provider_amount_paid_cents?: number | null;
  provider_currency?: string | null;
  provider_payment_last_checked_at?: string | null;
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
    scheduled_for,
    provider_checkout_url,
    provider_payment_status,
    provider_amount_due_cents,
    provider_amount_paid_cents,
    provider_currency,
    provider_payment_last_checked_at
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
    // Build insert payload - store email directly (Supabase encrypts at rest)
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
      delegate_email,
      participant_names,
      provider_checkout_url,
      provider_payment_status,
      provider_amount_due_cents,
      provider_amount_paid_cents,
      provider_currency,
      provider_payment_last_checked_at,
      status,
      scheduled_for,
      executed_at: scheduled_for ? null : new Date().toISOString()
    };
    
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
 * Tool: registrations.cancel_with_refund
 * Cancel a confirmed registration with provider and refund success fee
 * Orchestrates the full cancellation flow with audit logging
 */
async function cancelWithRefund(args: {
  registration_id: string;
  user_id: string;
  reason?: string;
}): Promise<ProviderResponse<{
  cancelled: boolean;
  refunded: boolean;
  registration_id: string;
  refund_id?: string;
}>> {
  const { registration_id, user_id, reason = 'user_requested' } = args;
  
  Logger.info('[Registrations] Cancelling with refund', { registration_id, reason });
  
  try {
    // First fetch the registration to get charge_id and booking details
    const { data: registration, error: fetchError } = await supabase
      .from('registrations')
      .select('*')
      .eq('id', registration_id)
      .eq('user_id', user_id)
      .maybeSingle();
    
    if (fetchError || !registration) {
      Logger.error('[Registrations] Registration not found', { fetchError });
      const friendlyError: ParentFriendlyError = {
        display: 'Registration not found',
        recovery: 'This registration may have already been cancelled.',
        severity: 'low',
        code: 'REGISTRATION_NOT_FOUND'
      };
      return {
        success: false,
        error: friendlyError
      };
    }
    
    // Check if cancellation is allowed
    if (registration.status === 'cancelled') {
      const friendlyError: ParentFriendlyError = {
        display: 'Already cancelled',
        recovery: 'This registration has already been cancelled.',
        severity: 'low',
        code: 'REGISTRATION_ALREADY_CANCELLED'
      };
      return {
        success: false,
        error: friendlyError
      };
    }
    
    let refunded = false;
    let refund_id: string | undefined;
    
    // If there's a charge_id, attempt to refund the success fee
    if (registration.charge_id) {
      try {
        const { data: refundResult, error: refundError } = await supabase.functions.invoke(
          'stripe-refund-success-fee',
          {
            body: {
              charge_id: registration.charge_id,
              reason: reason
            }
          }
        );
        
        if (!refundError && refundResult?.success) {
          refunded = true;
          refund_id = refundResult.refund_id;
          Logger.info('[Registrations] Success fee refunded', { refund_id });
        } else {
          Logger.warn('[Registrations] Refund failed but continuing with cancellation', { refundError });
        }
      } catch (refundErr) {
        Logger.warn('[Registrations] Refund error but continuing', { refundErr });
      }
    }
    
    // Update registration status to cancelled
    const { error: updateError } = await supabase
      .from('registrations')
      .update({
        status: 'cancelled',
        error_message: `Cancelled: ${reason}`,
        updated_at: new Date().toISOString()
      })
      .eq('id', registration_id)
      .eq('user_id', user_id);
    
    if (updateError) {
      Logger.error('[Registrations] Update error', { updateError });
      const friendlyError: ParentFriendlyError = {
        display: 'Unable to complete cancellation',
        recovery: 'Please try again or contact support.',
        severity: 'medium',
        code: 'REGISTRATION_CANCEL_FAILED'
      };
      return {
        success: false,
        error: friendlyError
      };
    }
    
    // Log audit event
    await supabase.from('mandate_audit').insert({
      user_id,
      action: 'registration_cancelled',
      provider: registration.provider,
      org_ref: registration.org_ref,
      program_ref: registration.program_ref,
      metadata: {
        registration_id,
        reason,
        refunded,
        refund_id,
        booking_number: registration.booking_number
      }
    });
    
    Logger.info('[Registrations] ✅ Registration cancelled with refund', {
      registration_id,
      refunded,
      refund_id
    });
    
    return {
      success: true,
      data: {
        cancelled: true,
        refunded,
        registration_id,
        refund_id
      },
      ui: {
        cards: [{
          title: 'Registration Cancelled',
          description: refunded 
            ? `Your registration has been cancelled and a refund of $${registration.success_fee_cents / 100} has been initiated.`
            : 'Your registration has been cancelled.'
        }]
      }
    };
    
  } catch (error: any) {
    Logger.error('[Registrations] Error in cancel with refund', { error });
    const friendlyError: ParentFriendlyError = {
      display: 'Cancellation error',
      recovery: 'Please try again or contact support.',
      severity: 'medium',
      code: 'REGISTRATION_CANCEL_ERROR'
    };
    return {
      success: false,
      error: friendlyError
    };
  }
}

/**
 * Tool: registrations.modify
 * Modify an existing registration by cancelling and creating new
 */
async function modifyRegistration(args: {
  registration_id: string;
  user_id: string;
  new_program_ref: string;
  new_program_name: string;
  new_start_date?: string;
  new_participants?: string[];
  reason?: string;
}): Promise<ProviderResponse<{
  modified: boolean;
  old_registration_id: string;
  new_registration_id?: string;
}>> {
  const {
    registration_id,
    user_id,
    new_program_ref,
    new_program_name,
    new_start_date,
    new_participants,
    reason = 'user_modification'
  } = args;
  
  Logger.info('[Registrations] Modifying registration', { registration_id, new_program_ref });
  
  try {
    // Fetch original registration
    const { data: original, error: fetchError } = await supabase
      .from('registrations')
      .select('*')
      .eq('id', registration_id)
      .eq('user_id', user_id)
      .maybeSingle();
    
    if (fetchError || !original) {
      Logger.error('[Registrations] Original registration not found', { fetchError });
      const friendlyError: ParentFriendlyError = {
        display: 'Registration not found',
        recovery: 'Unable to find the registration to modify.',
        severity: 'low',
        code: 'REGISTRATION_NOT_FOUND'
      };
      return {
        success: false,
        error: friendlyError
      };
    }
    
    // Mark original as cancelled (modification)
    const { error: cancelError } = await supabase
      .from('registrations')
      .update({
        status: 'cancelled',
        error_message: `Modified to: ${new_program_name}`,
        updated_at: new Date().toISOString()
      })
      .eq('id', registration_id)
      .eq('user_id', user_id);
    
    if (cancelError) {
      Logger.error('[Registrations] Failed to cancel original', { cancelError });
      const friendlyError: ParentFriendlyError = {
        display: 'Unable to modify registration',
        recovery: 'Please try again or contact support.',
        severity: 'medium',
        code: 'REGISTRATION_MODIFY_FAILED'
      };
      return {
        success: false,
        error: friendlyError
      };
    }
    
    // Create new registration with updated details
    const newRegPayload = {
      user_id,
      mandate_id: original.mandate_id,
      charge_id: original.charge_id, // Reuse existing charge
      program_name: new_program_name,
      program_ref: new_program_ref,
      provider: original.provider,
      org_ref: original.org_ref,
      start_date: new_start_date || original.start_date,
      amount_cents: original.amount_cents,
      success_fee_cents: original.success_fee_cents,
      delegate_name: original.delegate_name,
      delegate_email: original.delegate_email,
      participant_names: new_participants || original.participant_names,
      status: 'pending', // New registration starts as pending
      scheduled_for: original.scheduled_for
    };
    
    const { data: newReg, error: createError } = await supabase
      .from('registrations')
      .insert(newRegPayload)
      .select()
      .single();
    
    if (createError) {
      Logger.error('[Registrations] Failed to create new registration', { createError });
      // Rollback: restore original
      await supabase
        .from('registrations')
        .update({ status: original.status, error_message: null })
        .eq('id', registration_id);
        
      const friendlyError: ParentFriendlyError = {
        display: 'Unable to create new registration',
        recovery: 'The original registration has been restored. Please try again.',
        severity: 'medium',
        code: 'REGISTRATION_CREATE_FAILED'
      };
      return {
        success: false,
        error: friendlyError
      };
    }
    
    // Log audit event
    await supabase.from('mandate_audit').insert({
      user_id,
      action: 'registration_modified',
      provider: original.provider,
      org_ref: original.org_ref,
      program_ref: new_program_ref,
      metadata: {
        old_registration_id: registration_id,
        new_registration_id: newReg.id,
        old_program_ref: original.program_ref,
        reason
      }
    });
    
    Logger.info('[Registrations] ✅ Registration modified', {
      old_id: registration_id,
      new_id: newReg.id
    });
    
    return {
      success: true,
      data: {
        modified: true,
        old_registration_id: registration_id,
        new_registration_id: newReg.id
      },
      ui: {
        cards: [{
          title: 'Registration Modified',
          description: `Changed from ${original.program_name} to ${new_program_name}`
        }]
      }
    };
    
  } catch (error: any) {
    Logger.error('[Registrations] Error modifying registration', { error });
    const friendlyError: ParentFriendlyError = {
      display: 'Modification error',
      recovery: 'Please try again or contact support.',
      severity: 'medium',
      code: 'REGISTRATION_MODIFY_ERROR'
    };
    return {
      success: false,
      error: friendlyError
    };
  }
}

/**
 * Tool: registrations.get
 * Get a single registration by ID
 */
async function getRegistration(args: {
  registration_id: string;
  user_id: string;
}): Promise<ProviderResponse<RegistrationRecord>> {
  const { registration_id, user_id } = args;
  
  Logger.info('[Registrations] Fetching registration', { registration_id });
  
  try {
    const { data, error } = await supabase
      .from('registrations')
      .select('*')
      .eq('id', registration_id)
      .eq('user_id', user_id)
      .maybeSingle();
    
    if (error || !data) {
      Logger.error('[Registrations] Registration not found', { error });
      const friendlyError: ParentFriendlyError = {
        display: 'Registration not found',
        recovery: 'This registration may have been removed.',
        severity: 'low',
        code: 'REGISTRATION_NOT_FOUND'
      };
      return {
        success: false,
        error: friendlyError
      };
    }
    
    return {
      success: true,
      data: data as RegistrationRecord
    };
    
  } catch (error: any) {
    Logger.error('[Registrations] Error fetching registration', { error });
    const friendlyError: ParentFriendlyError = {
      display: 'Unable to fetch registration',
      recovery: 'Please try again.',
      severity: 'low',
      code: 'REGISTRATION_GET_ERROR'
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
          description: 'Email of responsible delegate (nullable if tokenized)'
        },
        participant_names: {
          type: 'array',
          items: { type: 'string' },
          description: 'Names of participants'
        },
        scheduled_for: {
          type: 'string',
          description: 'Scheduled execution time for Set-and-Forget (ISO 8601), null for immediate'
        },
        provider_checkout_url: {
          type: 'string',
          description: 'Provider-hosted checkout/payment URL (provider is merchant-of-record)'
        },
        provider_payment_status: {
          type: 'string',
          description: 'Provider program-fee payment status: paid|unpaid|unknown'
        },
        provider_amount_due_cents: {
          type: 'number',
          description: 'Best-effort cents amount due to provider (program fee)'
        },
        provider_amount_paid_cents: {
          type: 'number',
          description: 'Best-effort cents amount paid to provider (program fee)'
        },
        provider_currency: {
          type: 'string',
          description: 'Currency code for provider amounts (e.g., USD)'
        },
        provider_payment_last_checked_at: {
          type: 'string',
          description: 'ISO timestamp when provider payment status was last fetched'
        }
      },
      required: ['user_id', 'program_name', 'program_ref', 'provider', 'org_ref', 'amount_cents', 'delegate_name', 'participant_names']
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
  },
  {
    name: 'registrations.cancel_with_refund',
    description: 'Cancel a confirmed registration with provider and refund success fee. Orchestrates provider cancellation, fee refund, and audit logging.',
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
        },
        reason: {
          type: 'string',
          description: 'Reason for cancellation (for audit trail)'
        }
      },
      required: ['registration_id', 'user_id']
    },
    handler: async (args: any) => {
      return auditToolCall(
        { plan_execution_id: null, tool: 'registrations.cancel_with_refund' },
        args,
        () => cancelWithRefund(args)
      );
    }
  },
  {
    name: 'registrations.modify',
    description: 'Modify an existing registration by cancelling it and creating a new one. Handles fee adjustments and audit logging.',
    inputSchema: {
      type: 'object',
      properties: {
        registration_id: {
          type: 'string',
          description: 'Registration ID to modify'
        },
        user_id: {
          type: 'string',
          description: 'Supabase user ID (for ownership verification)'
        },
        new_program_ref: {
          type: 'string',
          description: 'New program reference to register for'
        },
        new_program_name: {
          type: 'string',
          description: 'New program display name'
        },
        new_start_date: {
          type: 'string',
          description: 'New program start date (ISO 8601)'
        },
        new_participants: {
          type: 'array',
          items: { type: 'string' },
          description: 'Updated list of participant names'
        },
        reason: {
          type: 'string',
          description: 'Reason for modification (for audit trail)'
        }
      },
      required: ['registration_id', 'user_id', 'new_program_ref', 'new_program_name']
    },
    handler: async (args: any) => {
      return auditToolCall(
        { plan_execution_id: null, tool: 'registrations.modify' },
        args,
        () => modifyRegistration(args)
      );
    }
  },
  {
    name: 'registrations.get',
    description: 'Get a single registration by ID with full details for display',
    inputSchema: {
      type: 'object',
      properties: {
        registration_id: {
          type: 'string',
          description: 'Registration ID to fetch'
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
        { plan_execution_id: null, tool: 'registrations.get' },
        args,
        () => getRegistration(args)
      );
    }
  }
];
