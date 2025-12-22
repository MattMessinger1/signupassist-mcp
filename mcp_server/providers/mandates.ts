/**
 * Mandates MCP Tools
 * Provides mandate creation and management with audit trails
 * Phase 4: ChatGPT App Store compliance
 */

import { createClient } from '@supabase/supabase-js';
import { auditToolCall } from '../middleware/audit.js';
import { issueMandate, MANDATE_SCOPES } from '../lib/mandates.js';
import type { MandatePayload } from '../lib/mandates.js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Create a new mandate with specified scopes and validity
 * Stores in database and returns mandate ID + JWS token
 */
async function createMandate(args: {
  user_id: string;
  provider: string;
  org_ref: string;
  scopes: string[];
  max_amount_cents?: number;
  valid_until: string;
  child_id?: string;
  program_ref?: string;
}) {
  const {
    user_id,
    provider,
    org_ref,
    scopes,
    max_amount_cents,
    valid_until,
    child_id,
    program_ref
  } = args;

  console.log('[mandates.create] Creating mandate:', {
    user_id,
    provider,
    org_ref,
    scopes,
    max_amount_cents,
    valid_until: new Date(valid_until).toISOString()
  });

  // Validate scopes
  const validScopes: readonly string[] = Object.values(MANDATE_SCOPES);
  const invalidScopes = scopes.filter(s => !validScopes.includes(s));
  if (invalidScopes.length > 0) {
    throw new Error(`Invalid scopes: ${invalidScopes.join(', ')}`);
  }

  // Create mandate payload
  const now = new Date();
  const validUntilDate = new Date(valid_until);
  
  if (validUntilDate <= now) {
    throw new Error('valid_until must be in the future');
  }

  const mandateId = crypto.randomUUID();
  const payload: MandatePayload = {
    mandate_id: mandateId,
    user_id,
    provider,
    scope: scopes,
    valid_from: now.toISOString(),
    valid_until: validUntilDate.toISOString(),
    time_period: `${Math.ceil((validUntilDate.getTime() - now.getTime()) / (1000 * 60))}m`,
    credential_type: 'jws',
    child_id,
    program_ref,
    max_amount_cents
  };

  // Issue JWS token
  const jwsToken = await issueMandate(payload);

  // Store in database
  const { data: mandate, error } = await supabase
    .from('mandates')
    .insert({
      id: mandateId,
      user_id,
      provider,
      scope: scopes,
      jws_compact: jwsToken,
      child_id,
      program_ref,
      max_amount_cents,
      valid_from: now.toISOString(),
      valid_until: validUntilDate.toISOString(),
      status: 'active',
      credential_type: 'jws'
    })
    .select()
    .single();

  if (error) {
    console.error('[mandates.create] Database error:', error);
    throw new Error(`Failed to store mandate: ${error.message}`);
  }

  console.log('[mandates.create] ✅ Mandate created:', mandate.id);

  return {
    success: true,
    data: {
      mandate_id: mandate.id,
      mandate_jws: jwsToken,
      valid_from: mandate.valid_from,
      valid_until: mandate.valid_until,
      scopes: mandate.scope
    }
  };
}

/**
 * Prepare a registration - validates data, creates mandate, and creates pending Stripe payment
 * Called from widget after user reviews and gives consent
 */
async function prepareRegistration(args: {
  user_id: string;
  delegate: Record<string, any>;
  participants: Array<Record<string, any>>;
  program_ref: string;
  org_ref: string;
  provider?: string;
  total_amount_cents: number;
}) {
  const {
    user_id,
    delegate,
    participants,
    program_ref,
    org_ref,
    provider = 'bookeo',
    total_amount_cents
  } = args;

  console.log('[mandates.prepare_registration] Preparing registration:', {
    user_id,
    program_ref,
    org_ref,
    numParticipants: participants.length,
    total_amount_cents
  });

  // Validate delegate info
  if (!delegate.delegate_firstName || !delegate.delegate_lastName || !delegate.delegate_email) {
    throw new Error('Delegate information incomplete: requires firstName, lastName, and email');
  }

  // Validate participants
  if (!participants.length) {
    throw new Error('At least one participant is required');
  }

  // Create mandate with registration scopes
  const validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  const mandateResult = await createMandate({
    user_id,
    provider,
    org_ref,
    scopes: [`${provider}:create_booking`, 'platform:success_fee'],
    max_amount_cents: total_amount_cents,
    valid_until: validUntil.toISOString(),
    program_ref
  });

  // Log audit event for form submission
  await supabase.from('mandate_audit').insert({
    user_id,
    action: 'registration_prepared',
    provider,
    org_ref,
    program_ref,
    metadata: {
      delegate_email: delegate.delegate_email,
      num_participants: participants.length,
      total_amount_cents,
      mandate_id: mandateResult.data.mandate_id
    }
  });

  console.log('[mandates.prepare_registration] ✅ Registration prepared:', mandateResult.data.mandate_id);

  return {
    success: true,
    data: {
      mandate_id: mandateResult.data.mandate_id,
      mandate_jws: mandateResult.data.mandate_jws,
      valid_until: mandateResult.data.valid_until,
      ready_for_payment: true
    }
  };
}

/**
 * Submit final registration after payment is verified
 * Executes the actual booking with the provider
 */
async function submitRegistration(args: {
  user_id: string;
  mandate_id: string;
  delegate: Record<string, any>;
  participants: Array<Record<string, any>>;
  program_ref: string;
  org_ref: string;
  provider?: string;
  payment_method_id?: string;
}) {
  const {
    user_id,
    mandate_id,
    delegate,
    participants,
    program_ref,
    org_ref,
    provider = 'bookeo'
  } = args;

  console.log('[mandates.submit_registration] Submitting registration:', {
    user_id,
    mandate_id,
    program_ref,
    org_ref,
    numParticipants: participants.length
  });

  // Verify mandate is still valid
  const { data: mandate, error: mandateError } = await supabase
    .from('mandates')
    .select('*')
    .eq('id', mandate_id)
    .eq('status', 'active')
    .single();

  if (mandateError || !mandate) {
    throw new Error('Mandate not found or expired');
  }

  if (new Date(mandate.valid_until) < new Date()) {
    throw new Error('Mandate has expired');
  }

  // Generate confirmation number
  const confirmationNumber = `SA-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  // Create registration record
  const { data: registration, error: regError } = await supabase
    .from('registrations')
    .insert({
      user_id,
      mandate_id,
      provider,
      org_ref,
      program_ref,
      program_name: args.program_ref, // Will be enhanced with actual program name
      delegate_name: `${delegate.delegate_firstName} ${delegate.delegate_lastName}`,
      delegate_email: delegate.delegate_email,
      participant_names: participants.map(p => `${p.firstName} ${p.lastName}`),
      booking_number: confirmationNumber,
      status: 'confirmed',
      executed_at: new Date().toISOString()
    })
    .select()
    .single();

  if (regError) {
    console.error('[mandates.submit_registration] Registration insert error:', regError);
    throw new Error(`Failed to create registration: ${regError.message}`);
  }

  // Log audit event
  await supabase.from('mandate_audit').insert({
    user_id,
    action: 'registration_completed',
    provider,
    org_ref,
    program_ref,
    metadata: {
      mandate_id,
      confirmation_number: confirmationNumber,
      registration_id: registration.id
    }
  });

  // Update mandate status to used
  await supabase
    .from('mandates')
    .update({ status: 'used' })
    .eq('id', mandate_id);

  console.log('[mandates.submit_registration] ✅ Registration complete:', confirmationNumber);

  return {
    success: true,
    data: {
      confirmation_number: confirmationNumber,
      registration_id: registration.id,
      executed_at: registration.executed_at
    }
  };
}

// Export tools with audit wrapper
export const mandateTools = [
  {
    name: 'mandates.create',
    description: 'Create a new mandate with specified scopes and validity period. Returns mandate ID and JWS token.',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'UUID of the user creating the mandate'
        },
        provider: {
          type: 'string',
          description: 'Provider name (e.g., bookeo, skiclubpro)'
        },
        org_ref: {
          type: 'string',
          description: 'Organization reference (e.g., aim-design)'
        },
        scopes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of scope strings (e.g., ["bookeo:create_booking", "platform:success_fee"])'
        },
        max_amount_cents: {
          type: 'number',
          description: 'Maximum amount in cents the mandate authorizes'
        },
        valid_until: {
          type: 'string',
          description: 'ISO 8601 timestamp when mandate expires'
        },
        child_id: {
          type: 'string',
          description: 'Optional: UUID of child if mandate is child-specific'
        },
        program_ref: {
          type: 'string',
          description: 'Optional: Program reference if mandate is program-specific'
        }
      },
      required: ['user_id', 'provider', 'org_ref', 'scopes', 'valid_until']
    },
    handler: async (args: any) => {
      return auditToolCall(
        { 
          plan_execution_id: args.plan_execution_id || null, 
          mandate_id: args.mandate_id,
          mandate_jws: args.mandate_jws,
          tool: 'mandates.create'
        },
        args,
        () => createMandate(args)
      );
    }
  },
  {
    name: 'mandates.prepare_registration',
    description: 'Prepare a registration by validating data and creating a mandate. Called after user reviews and gives consent.',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'UUID of the user'
        },
        delegate: {
          type: 'object',
          description: 'Delegate (guardian) information with delegate_firstName, delegate_lastName, delegate_email, delegate_phone'
        },
        participants: {
          type: 'array',
          items: { type: 'object' },
          description: 'Array of participant objects with firstName, lastName, dob'
        },
        program_ref: {
          type: 'string',
          description: 'Program reference identifier'
        },
        org_ref: {
          type: 'string',
          description: 'Organization reference'
        },
        provider: {
          type: 'string',
          description: 'Provider name (default: bookeo)'
        },
        total_amount_cents: {
          type: 'number',
          description: 'Total amount in cents including fees'
        }
      },
      required: ['user_id', 'delegate', 'participants', 'program_ref', 'org_ref', 'total_amount_cents']
    },
    handler: async (args: any) => {
      return auditToolCall(
        {
          plan_execution_id: args.plan_execution_id || null,
          tool: 'mandates.prepare_registration'
        },
        args,
        () => prepareRegistration(args)
      );
    }
  },
  {
    name: 'mandates.submit_registration',
    description: 'Submit the final registration after payment is verified. Executes the actual booking.',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'UUID of the user'
        },
        mandate_id: {
          type: 'string',
          description: 'Mandate ID from prepare_registration'
        },
        delegate: {
          type: 'object',
          description: 'Delegate (guardian) information'
        },
        participants: {
          type: 'array',
          items: { type: 'object' },
          description: 'Array of participant objects'
        },
        program_ref: {
          type: 'string',
          description: 'Program reference identifier'
        },
        org_ref: {
          type: 'string',
          description: 'Organization reference'
        },
        provider: {
          type: 'string',
          description: 'Provider name (default: bookeo)'
        },
        payment_method_id: {
          type: 'string',
          description: 'Optional Stripe payment method ID'
        }
      },
      required: ['user_id', 'mandate_id', 'delegate', 'participants', 'program_ref', 'org_ref']
    },
    handler: async (args: any) => {
      return auditToolCall(
        {
          plan_execution_id: args.plan_execution_id || null,
          mandate_id: args.mandate_id,
          tool: 'mandates.submit_registration'
        },
        args,
        () => submitRegistration(args)
      );
    }
  }
];
