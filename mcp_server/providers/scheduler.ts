/**
 * Scheduler MCP Tools
 * Provides job scheduling for auto-registration with audit trails
 * Phase 4: ChatGPT App Store compliance
 */

import { createClient } from '@supabase/supabase-js';
import { auditToolCall } from '../middleware/audit.js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Schedule a signup job to run at a specific time
 * Creates a scheduled_registrations entry that will be picked up by the always-on worker.
 */
async function scheduleSignup(args: {
  user_id: string;
  mandate_id: string;
  org_ref: string;
  program_ref: string;
  program_name: string;
  event_id: string;
  scheduled_time: string;
  delegate_data: Record<string, any>;
  participant_data: Array<Record<string, any>>;
  /** Optional: store pricing metadata inside delegate_data for receipt accuracy */
  program_fee_cents?: number;
  success_fee_cents?: number;
}) {
  const {
    user_id,
    mandate_id,
    org_ref,
    program_ref,
    program_name,
    event_id,
    scheduled_time,
    delegate_data,
    participant_data,
    program_fee_cents,
    success_fee_cents
  } = args;

  console.log('[scheduler.schedule_signup] Scheduling registration:', {
    user_id,
    org_ref,
    program_ref,
    scheduled_time: new Date(scheduled_time).toISOString()
  });

  if (!user_id || !mandate_id || !org_ref || !program_ref || !program_name || !event_id || !scheduled_time) {
    throw new Error('Missing required scheduling fields');
  }

  const triggerDate = new Date(scheduled_time);
  const now = new Date();

  // Validate trigger time is in the future
  if (triggerDate <= now) {
    throw new Error('scheduled_time must be in the future');
  }

  // Persist the full execution payload so the worker can execute without a chat session.
  const delegateWithMeta = {
    ...delegate_data,
    _pricing: {
      program_fee_cents: program_fee_cents ?? delegate_data?._pricing?.program_fee_cents,
      success_fee_cents: success_fee_cents ?? delegate_data?._pricing?.success_fee_cents ?? 2000
    }
  };

  const { data: scheduled, error: insertError } = await supabase
    .from('scheduled_registrations')
    .insert({
      user_id,
      mandate_id,
      org_ref,
      program_ref,
      program_name,
      scheduled_time: triggerDate.toISOString(),
      event_id,
      delegate_data: delegateWithMeta,
      participant_data
    })
    .select()
    .single();

  if (insertError || !scheduled) {
    console.error('[scheduler.schedule_signup] Insert error:', insertError);
    throw new Error(`Failed to schedule registration: ${insertError?.message || 'unknown error'}`);
  }

  console.log('[scheduler.schedule_signup] ✅ Scheduled registration created:', scheduled.id);

  return {
    success: true,
    data: {
      scheduled_registration_id: scheduled.id,
      scheduled_time: scheduled.scheduled_time,
      status: 'scheduled',
      message: 'Registration will be executed at the scheduled time by the always-on worker'
    }
  };
}

// Export tools with audit wrapper
export const schedulerTools = [
  {
    name: 'scheduler.schedule_signup',
    description: 'Schedule an auto-registration job to execute at a specific time. Persists full execution payload in scheduled_registrations for the always-on worker.',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'Supabase user ID' },
        mandate_id: { type: 'string', description: 'Mandate ID authorizing booking + success fee' },
        org_ref: { type: 'string', description: 'Organization reference' },
        program_ref: { type: 'string', description: 'Program reference' },
        program_name: { type: 'string', description: 'Program display name' },
        event_id: { type: 'string', description: 'Bookeo slot eventId OR productId/program_ref (worker will resolve to the next available slot at execution time)' },
        scheduled_time: { type: 'string', description: 'ISO 8601 timestamp when registration should execute' },
        delegate_data: { type: 'object', description: 'Responsible delegate information' },
        participant_data: { type: 'array', items: { type: 'object' }, description: 'Participant array' },
        program_fee_cents: { type: 'number', description: 'Optional cached program fee in cents (for receipts)' },
        success_fee_cents: { type: 'number', description: 'Optional success fee in cents (default 2000)' }
      },
      required: ['user_id', 'mandate_id', 'org_ref', 'program_ref', 'program_name', 'event_id', 'scheduled_time', 'delegate_data', 'participant_data']
    },
    handler: async (args: any) => {
      return auditToolCall(
        { 
          plan_execution_id: args.plan_execution_id || null,
          mandate_id: args.mandate_id,
          mandate_jws: args.mandate_jws,
          tool: 'scheduler.schedule_signup'
        },
        args,
        () => scheduleSignup(args)
      );
    }
  }
];
