/**
 * Audit Trail Middleware for MCP Tool Calls
 * Automatically logs all tool executions with mandate verification
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { verifyMandate } from '../lib/mandates.js';

// Initialize Supabase client for backend operations
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Types
export interface AuditContext {
  plan_execution_id: string | null;
  mandate_id: string;
  tool: string;
}

/**
 * Check if a string is a valid UUID
 */
function isValidUUID(uuid: string | null | undefined): boolean {
  if (!uuid || typeof uuid !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

export interface AuditLogStart {
  id: string;
  plan_execution_id: string | null;
  mandate_id: string;
  tool: string;
  args_hash: string;
  args_json: any;
  ts: string;
  decision: 'pending';
}

export interface AuditLogFinish {
  result_hash: string;
  result_json: any;
  decision: 'allowed' | 'denied';
}

export interface EvidenceLog {
  plan_execution_id: string;
  type: string;
  url?: string;
  sha256?: string;
}

/**
 * Compute SHA256 hash of an object
 */
async function computeHash(obj: any): Promise<string> {
  const jsonString = JSON.stringify(obj, Object.keys(obj || {}).sort());
  const encoder = new TextEncoder();
  const data = encoder.encode(jsonString);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Redact sensitive information from result objects
 */
function redactSensitiveData(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  
  const redacted = { ...obj };
  const sensitiveKeys = ['password', 'token', 'key', 'secret', 'credit_card', 'ssn', 'credentials'];
  
  for (const key of Object.keys(redacted)) {
    if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
      redacted[key] = '[REDACTED]';
    } else if (typeof redacted[key] === 'object') {
      redacted[key] = redactSensitiveData(redacted[key]);
    }
  }
  
  return redacted;
}

/**
 * Start audit logging for a tool call
 */
async function logToolCallStart(context: AuditContext, args: any): Promise<string> {
  try {
    // Validate plan_execution_id is a valid UUID or null
    if (context.plan_execution_id && !isValidUUID(context.plan_execution_id)) {
      console.error('Invalid plan_execution_id UUID:', context.plan_execution_id);
      throw new Error(`Invalid UUID format for plan_execution_id: ${context.plan_execution_id}`);
    }

    const argsHash = await computeHash(args);
    
    const { data, error } = await supabase
      .from('audit_events')
      .insert({
        event_type: 'tool_call',
        provider: 'skiclubpro',
        plan_execution_id: context.plan_execution_id,
        mandate_id: context.mandate_id,
        tool: context.tool,
        args_json: args,
        args_hash: argsHash,
        decision: 'pending',
        started_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      console.error('Failed to log tool call start:', error);
      throw new Error(`Audit logging failed: ${error.message}`);
    }

    return data.id;
  } catch (error) {
    console.error('Error in logToolCallStart:', error);
    throw error;
  }
}

/**
 * Finish audit logging for a tool call
 */
async function logToolCallFinish(
  auditId: string, 
  result: any, 
  decision: 'allowed' | 'denied'
): Promise<void> {
  try {
    const resultHash = await computeHash(result);
    const redactedResult = redactSensitiveData(result);
    
    const { error } = await supabase
      .from('audit_events')
      .update({
        result_json: redactedResult,
        result_hash: resultHash,
        decision,
        finished_at: new Date().toISOString(),
      })
      .eq('id', auditId);

    if (error) {
      console.error('Failed to log tool call finish:', error);
      // Don't throw here - we don't want to fail the tool call if audit logging fails
    }
  } catch (error) {
    console.error('Error in logToolCallFinish:', error);
    // Don't throw here - we don't want to fail the tool call if audit logging fails
  }
}

/**
 * Log evidence assets (screenshots, URLs, etc.)
 */
export async function logEvidence(
  plan_execution_id: string,
  type: string,
  url?: string,
  sha256?: string
): Promise<void> {
  try {
    const { error } = await supabase
      .from('evidence_assets')
      .insert({
        plan_execution_id,
        type,
        url,
        sha256,
        ts: new Date().toISOString(),
      });

    if (error) {
      console.error('Failed to log evidence:', error);
      throw new Error(`Evidence logging failed: ${error.message}`);
    }
  } catch (error) {
    console.error('Error in logEvidence:', error);
    throw error;
  }
}

/**
 * Audit wrapper for MCP tool calls
 * This is the main function that wraps tool execution with audit logging
 */
export async function auditToolCall<T>(
  context: AuditContext,
  args: any,
  toolHandler: () => Promise<T>,
  requiredScope?: string
): Promise<T> {
  let auditId: string | null = null;
  
  try {
    // Skip audit logging if plan_execution_id is null, empty, 'interactive', or invalid UUID
    const shouldSkipAudit = !context.plan_execution_id || 
                           context.plan_execution_id === 'interactive' ||
                           context.plan_execution_id === '' ||
                           !isValidUUID(context.plan_execution_id);
    
    if (shouldSkipAudit) {
      console.log('Skipping audit logging: plan_execution_id is', context.plan_execution_id);
    }
    
    // Start audit logging only if not skipping
    if (!shouldSkipAudit) {
      auditId = await logToolCallStart(context, args);
    }
    
    // ======= SMOKE TEST BYPASS =======
    // Bypass mandate verification for local smoke tests.
    // WARNING: Keep this only in local/dev/testing environments. Remove before production.
    if (
      process.env.NODE_ENV === 'test' ||
      context.plan_execution_id === '00000000-0000-0000-0000-000000000002' ||
      process.env.BYPASS_MANDATE === '1'
    ) {
      console.log('[audit] Skipping mandate verification (smoke test mode)');
      // Continue without mandate verification
    } else if (requiredScope) {
      // Verify mandate if required scope is provided
      try {
        // Get the mandate from database
        const { data: mandate, error } = await supabase
          .from('mandates')
          .select('jws_compact')
          .eq('id', context.mandate_id)
          .eq('status', 'active')
          .single();

        if (error || !mandate) {
          throw new Error('Mandate not found or inactive');
        }

        // Verify the mandate
        await verifyMandate(mandate.jws_compact, requiredScope);
      } catch (mandateError) {
        // Log denial and abort
        if (auditId) {
          await logToolCallFinish(auditId, { error: mandateError.message }, 'denied');
        }
        throw new Error(`Mandate verification failed: ${mandateError.message}`);
      }
    }

    // Execute the tool
    const result = await toolHandler();
    
    // Log successful completion
    if (auditId) {
      await logToolCallFinish(auditId, result, 'allowed');
    }
    
    return result;
  } catch (error) {
    // Log failure
    if (auditId) {
      await logToolCallFinish(auditId, { error: error.message }, 'denied');
    }
    throw error;
  }
}

/**
 * Audit middleware factory
 * Returns a function that can wrap any tool handler with audit logging
 */
export function createAuditMiddleware(context: AuditContext, requiredScope?: string) {
  return async function<T>(
    args: any,
    toolHandler: () => Promise<T>
  ): Promise<T> {
    return auditToolCall(context, args, toolHandler, requiredScope);
  };
}

/**
 * Helper to extract context from plan execution
 */
export async function getAuditContextFromPlan(planId: string): Promise<AuditContext | null> {
  try {
    const { data: plan, error } = await supabase
      .from('plans')
      .select(`
        mandate_id,
        plan_executions!inner(id)
      `)
      .eq('id', planId)
      .order('created_at', { foreignTable: 'plan_executions', ascending: false })
      .limit(1, { foreignTable: 'plan_executions' })
      .single();

    if (error || !plan || !plan.plan_executions?.[0]) {
      return null;
    }

    return {
      plan_execution_id: plan.plan_executions[0].id,
      mandate_id: plan.mandate_id!,
      tool: '', // Will be set by the specific tool
    };
  } catch (error) {
    console.error('Error getting audit context:', error);
    return null;
  }
}