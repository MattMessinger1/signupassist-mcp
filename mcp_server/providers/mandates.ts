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
          tool: 'mandates.create',
          user_id: args.user_id,
          provider: args.provider,
          org_ref: args.org_ref
        },
        args,
        () => createMandate(args)
      );
    }
  }
];
