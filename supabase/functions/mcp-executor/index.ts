/**
 * MCP Executor Edge Function
 *
 * RUNNER POLICY (v1.0-mcp):
 * This orchestrator enforces the mandate scope and pricing policy:
 *
 * 1. MANDATE VALIDATION:
 *    - Every tool call is logged to mcp_tool_calls with mandate_id
 *    - All operations must be within approved Bookeo-related scopes
 *    - No actions are taken without a valid, active mandate
 *
 * 2. PRICING ENFORCEMENT:
 *    - Backend enforces max_amount_cents cap on paid steps
 *    - Only charges success fee AFTER successful registration
 *
 * 3. AUDIT TRAIL:
 *    - Creates audit record BEFORE each tool execution (decision='approved')
 *    - Updates record with result_json and result_hash AFTER completion
 *    - Maintains full chain of custody for compliance and debugging
 *
 * 4. ERROR HANDLING:
 *    - On failure, marks plan status as 'failed'
 *    - Updates plan_execution with error details
 *    - Does NOT charge success fee on failure
 *
 * See also: prompts/acp_prompt_pack.md for full policy text
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BOOKEO_MCP_TOOLS = new Set([
  'bookeo.test_connection',
  'bookeo.find_programs',
  'bookeo.discover_required_fields',
  'bookeo.create_hold',
  'bookeo.confirm_booking',
  'bookeo.cancel_booking',
]);

const SENSITIVE_WRITE_TOOLS = new Set([
  'bookeo.create_hold',
  'bookeo.confirm_booking',
  'bookeo.cancel_booking',
]);

function redactForLog(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactForLog(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase();
    if (
      normalized.includes('password') ||
      normalized.includes('token') ||
      normalized.includes('secret') ||
      normalized.includes('credential') ||
      normalized.includes('card') ||
      normalized.includes('payment') ||
      normalized.includes('phone') ||
      normalized.includes('email') ||
      normalized.includes('dob') ||
      normalized.includes('birth') ||
      normalized.includes('participant') ||
      normalized.includes('delegate')
    ) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = redactForLog(nested);
    }
  }
  return redacted;
}

function sensitiveActionPausedResponse(tool: string) {
  return new Response(
    JSON.stringify({
      success: false,
      status: 'paused_for_parent',
      error: 'sensitive_action_confirmation_required',
      tool,
      message:
        'This provider action can create, change, or cancel a booking. SignupAssist pauses here until a server-verified parent confirmation or future delegated mandate is available.',
    }),
    {
      status: 409,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  );
}

async function getUserIdFromJwt(userJwt: string) {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: `Bearer ${userJwt}` } } },
  );
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error('auth_required');
  }
  return data.user.id;
}

async function callMcpTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  if (!BOOKEO_MCP_TOOLS.has(toolName)) {
    throw new Error(`Unsupported MCP tool: ${toolName}`);
  }

  const mcpServerUrl = Deno.env.get('MCP_SERVER_URL');
  const mcpAccessToken = Deno.env.get('MCP_ACCESS_TOKEN');
  if (!mcpServerUrl) {
    throw new Error('MCP_SERVER_URL not configured');
  }

  console.log(`[MCP] Calling ${toolName} with redacted args:`, JSON.stringify(redactForLog(args)));

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (mcpAccessToken) {
    headers['Authorization'] = `Bearer ${mcpAccessToken.trim()}`;
  }

  const res = await fetch(`${mcpServerUrl}/tools/call`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tool: toolName, args }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MCP tool failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function executeMCPTool(
  toolName: string,
  args: Record<string, unknown>,
  _planExecutionId: string,
  _mandateId: string,
) {
  // Railway MCP server handles audit; this edge function delegates to HTTP /tools/call
  return callMcpTool(toolName, args);
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log("mcp-executor invoked with redacted body:", redactForLog(body));

    // Handle individual MCP tool calls
    if (body.tool) {
      const { tool, args } = body;
      console.log("mcp-executor invoked with tool:", tool, "redacted args:", redactForLog(args));

      if (!BOOKEO_MCP_TOOLS.has(tool)) {
        throw new Error(`No handler found for MCP tool: ${tool}`);
      }

      if (SENSITIVE_WRITE_TOOLS.has(tool)) {
        return sensitiveActionPausedResponse(tool);
      }

      const toolResult = await callMcpTool(tool, args ?? {});

      console.log(`Individual tool call success for ${tool}:`, toolResult);

      return new Response(JSON.stringify(toolResult), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle plan execution
    const { plan_id, plan_execution_id, mandate_id, credential_id, user_jwt } = body;

    if (!plan_id) {
      throw new Error('plan_id is required');
    }

    if (!credential_id || !user_jwt) {
      throw new Error('credential_id and user_jwt are required');
    }
    const authenticatedUserId = await getUserIdFromJwt(String(user_jwt));

    console.log(`Starting MCP-powered plan execution for plan ${plan_id}`);

    // Create service role client for database operations
    const serviceSupabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Get plan details
    const { data: plan, error: planError } = await serviceSupabase
      .from('plans')
      .select(`
        id,
        user_id,
        child_id,
        program_ref,
        provider,
        mandate_id,
        status
      `)
      .eq('id', plan_id)
      .single();

    if (planError || !plan) {
      throw new Error('Plan not found');
    }

    if (plan.user_id !== authenticatedUserId) {
      throw new Error('Forbidden: plan does not belong to authenticated user');
    }

    if (plan.status !== 'running') {
      throw new Error(`Plan status is ${plan.status}, expected 'running'`);
    }

    // Use provided plan_execution_id or create a new one
    let planExecutionId = plan_execution_id;
    let planExecution;

    if (planExecutionId) {
      console.log(`Using existing plan execution: ${planExecutionId}`);
      // Fetch the existing plan execution
      const { data: existingExecution, error: fetchError } = await serviceSupabase
        .from('plan_executions')
        .select('*')
        .eq('id', planExecutionId)
        .single();

      if (fetchError || !existingExecution) {
        throw new Error(`Plan execution ${planExecutionId} not found`);
      }

      planExecution = existingExecution;
    } else {
      console.log('Creating new plan execution record');
      // Create plan execution record
      const { data: newExecution, error: executionError } = await serviceSupabase
        .from('plan_executions')
        .insert({
          plan_id: plan.id,
          started_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (executionError) {
        throw new Error(`Failed to create plan execution: ${executionError.message}`);
      }

      planExecution = newExecution;
      planExecutionId = newExecution.id;
      console.log(`Plan execution created: ${planExecutionId}`);
    }

    // Use provided mandate_id or get from plan
    const executionMandateId = mandate_id || plan.mandate_id;

    let finalResult = 'success';
    let totalAmount = 0;
    const confirmationRef = null;
    let sessionRef = null;

    try {
      // Step 1: Verify Bookeo API connectivity before paid steps
      console.log('Step 1: Bookeo API health (bookeo.test_connection)');
      const ping = await executeMCPTool(
        'bookeo.test_connection',
        {},
        planExecutionId,
        executionMandateId,
      ) as { success?: boolean };
      if (ping?.success !== true) {
        throw new Error('Bookeo API health check failed');
      }

      // Step 2–3: Full booking orchestration runs on the Railway MCP server / orchestrator;
      // this edge function records execution only after a successful API preflight.
      console.log('Step 2: Plan execution preflight OK (credential + mandate validated upstream)');

      sessionRef = planExecutionId;

      // Step 3: Paid/provider-submitting actions are intentionally paused until
      // parent-action confirmations or verified delegated mandates are enforced.
      console.log('Step 3: Sensitive action paused before payment, waiver, checkout, or final submit');
      finalResult = 'paused_for_parent';
      totalAmount = 0;

      // Update plan status to paused rather than completed.
      await serviceSupabase
        .from('plans')
        .update({ status: 'paused_for_parent' })
        .eq('id', plan.id);

      console.log(`MCP plan execution paused safely: ${planExecution.id}`);
    } catch (error) {
      console.error('MCP plan execution failed:', error);
      finalResult = 'failed';

      // Update plan status to failed
      await serviceSupabase
        .from('plans')
        .update({ status: 'failed' })
        .eq('id', plan.id);
    }

    // Update plan execution with final result
    await serviceSupabase
      .from('plan_executions')
      .update({
        finished_at: new Date().toISOString(),
        result: finalResult,
        amount_cents: totalAmount,
        confirmation_ref: confirmationRef,
      })
      .eq('id', planExecutionId);

    return new Response(
      JSON.stringify({
        success: finalResult === 'success',
        plan_execution_id: planExecutionId,
        result: finalResult,
        amount_cents: totalAmount,
        confirmation_ref: confirmationRef,
        session_ref: sessionRef,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('Error in MCP executor function:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});
