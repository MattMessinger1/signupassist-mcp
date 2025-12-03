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
 * Creates a scheduled_registrations entry that will be picked up by the scheduler
 */
async function scheduleSignup(args: {
  registration_id: string;
  trigger_time: string;
}) {
  const { registration_id, trigger_time } = args;

  console.log('[scheduler.schedule_signup] Scheduling registration:', {
    registration_id,
    trigger_time: new Date(trigger_time).toISOString()
  });

  const triggerDate = new Date(trigger_time);
  const now = new Date();

  // Validate trigger time is in the future
  if (triggerDate <= now) {
    throw new Error('trigger_time must be in the future');
  }

  // Validate registration exists in unified registrations table
  const { data: registration, error: fetchError } = await supabase
    .from('registrations')
    .select('*')
    .eq('id', registration_id)
    .single();

  if (fetchError || !registration) {
    throw new Error(`Registration not found: ${registration_id}`);
  }

  // Only allow scheduling of pending registrations
  if (registration.status !== 'pending') {
    throw new Error(`Registration ${registration_id} is not in pending status: ${registration.status}`);
  }

  // Update scheduled_for if different
  if (registration.scheduled_for !== triggerDate.toISOString()) {
    const { error: updateError } = await supabase
      .from('registrations')
      .update({ scheduled_for: triggerDate.toISOString() })
      .eq('id', registration_id);

    if (updateError) {
      console.error('[scheduler.schedule_signup] Update error:', updateError);
      throw new Error(`Failed to update schedule: ${updateError.message}`);
    }
  }

  console.log('[scheduler.schedule_signup] ✅ Registration scheduled:', registration_id);

  // TODO: In production, integrate with cron job or worker queue
  // For now, the scheduled_registrations table acts as the job queue
  // A separate worker process will poll this table and execute registrations

  return {
    success: true,
    data: {
      registration_id,
      scheduled_time: triggerDate.toISOString(),
      status: 'scheduled',
      message: 'Registration will be executed at the scheduled time by the auto-registration worker'
    }
  };
}

// Export tools with audit wrapper
export const schedulerTools = [
  {
    name: 'scheduler.schedule_signup',
    description: 'Schedule an auto-registration job to execute at a specific time. The registration must already exist in scheduled_registrations table.',
    inputSchema: {
      type: 'object',
      properties: {
        registration_id: {
          type: 'string',
          description: 'UUID of the scheduled_registrations record'
        },
        trigger_time: {
          type: 'string',
          description: 'ISO 8601 timestamp when registration should execute'
        }
      },
      required: ['registration_id', 'trigger_time']
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
