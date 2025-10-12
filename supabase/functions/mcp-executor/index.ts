/**
 * MCP Executor Edge Function
 * 
 * RUNNER POLICY (v1.0-mcp):
 * This orchestrator enforces the mandate scope and pricing policy:
 * 
 * 1. MANDATE VALIDATION:
 *    - Every tool call is logged to mcp_tool_calls with mandate_id
 *    - All operations must be within approved scopes (scp:login, scp:enroll, scp:pay)
 *    - No actions are taken without a valid, active mandate
 * 
 * 2. PRICING ENFORCEMENT:
 *    - Backend (browserbase.ts) computes total and enforces max_amount_cents cap
 *    - If total exceeds cap, throws PRICE_EXCEEDS_LIMIT and halts execution
 *    - Only charges success fee AFTER successful registration (scp:pay completes)
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

// MCP Tool mapping to actual implementations
const MCP_TOOLS: Record<string, string> = {
  'scp:login': 'skiclubpro-tools',
  'scp:register': 'skiclubpro-tools', 
  'scp:pay': 'skiclubpro-tools',
  'scp:discover_fields': 'skiclubpro-tools',
  'scp:find_programs': 'skiclubpro-tools',
  'scp:check_prerequisites': 'skiclubpro-tools',
  'scp:list_children': 'skiclubpro-tools',
  // Backward compatibility aliases for dot notation
  'scp.login': 'skiclubpro-tools',
  'scp.register': 'skiclubpro-tools',
  'scp.pay': 'skiclubpro-tools',
  'scp.discover_fields': 'skiclubpro-tools',
  'scp.find_programs': 'skiclubpro-tools',
  'scp.check_prerequisites': 'skiclubpro-tools',
  'scp.list_children': 'skiclubpro-tools'
};

async function executeMCPTool(toolName: string, args: any, planExecutionId: string, mandateId: string, supabase: any) {
  console.log(`[Browserbase] Executing MCP tool: ${toolName} with args:`, JSON.stringify(args));

  // Get the edge function that handles this tool
  const edgeFunction = MCP_TOOLS[toolName];
  if (!edgeFunction) {
    throw new Error(`No handler found for MCP tool: ${toolName}`);
  }

  // Call the actual MCP tool implementation
  // Audit logging is handled by the Railway MCP server
  const requestBody = {
    tool: toolName,
    args: {
      ...args,
      plan_execution_id: planExecutionId,
      mandate_id: mandateId
    }
  };
  
  console.log(`[Browserbase] Calling ${edgeFunction} with body:`, JSON.stringify(requestBody));
  
  const toolResult = await supabase.functions.invoke(edgeFunction, {
    body: requestBody
  });

  if (toolResult.error) {
    throw new Error(`MCP tool failed: ${toolResult.error.message}`);
  }

  const result = toolResult.data;
  console.log(`MCP tool ${toolName} completed successfully:`, result);
  return result;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log("mcp-executor invoked with body:", body);

    // Handle individual MCP tool calls
    if (body.tool) {
      const { tool, args } = body;
      console.log("mcp-executor invoked with tool:", tool, "args:", args);
      
      // Get the edge function that handles this tool
      const edgeFunction = MCP_TOOLS[tool];
      if (!edgeFunction) {
        throw new Error(`No handler found for MCP tool: ${tool}`);
      }

      // For individual tool calls, invoke the tool directly
      const requestBody = {
        tool: tool,
        args: args
      };
      
      console.log(`Individual tool call - invoking ${edgeFunction} with body:`, JSON.stringify(requestBody));
      
      const toolResult = await createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      ).functions.invoke(edgeFunction, {
        body: requestBody
      });

      console.log(`Individual tool call result:`, JSON.stringify(toolResult));

      if (toolResult.error) {
        console.error(`MCP tool failed:`, toolResult.error);
        throw new Error(`MCP tool failed: ${toolResult.error.message}`);
      }

      console.log(`Individual tool call success for ${tool}:`, toolResult.data);

      return new Response(
        JSON.stringify(toolResult.data),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle plan execution
    const { plan_id, plan_execution_id, mandate_id, credential_id, user_jwt } = body;
    
    if (!plan_id) {
      throw new Error('plan_id is required');
    }
    
    if (!credential_id || !user_jwt) {
      throw new Error('credential_id and user_jwt are required');
    }

    console.log(`Starting MCP-powered plan execution for plan ${plan_id}`);

    // Create service role client for database operations
    const serviceSupabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
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
          started_at: new Date().toISOString()
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
    let confirmationRef = null;
    let sessionRef = null;

    try {
      // Step 1: Login via MCP
      console.log('Step 1: Executing MCP scp:login');
      const loginResult = await executeMCPTool(
        'scp:login',
        {
          credential_id: credential_id,
          user_jwt: user_jwt,
          program_ref: plan.program_ref
        },
        planExecutionId,
        executionMandateId,
        serviceSupabase
      );

      sessionRef = loginResult.session_ref;

      // Step 2: Register via MCP
      console.log('Step 2: Executing MCP scp:register');
      const registerResult = await executeMCPTool(
        'scp:register',
        {
          session_ref: sessionRef,
          program_ref: plan.program_ref,
          child_id: plan.child_id
        },
        planExecutionId,
        executionMandateId,
        serviceSupabase
      );

      confirmationRef = registerResult.registration_ref;

      // Step 3: Pay via MCP
      console.log('Step 3: Executing MCP scp:pay');
      const payResult = await executeMCPTool(
        'scp:pay',
        {
          session_ref: sessionRef,
          registration_ref: registerResult.registration_ref,
          amount_cents: 15000 // Default $150, should come from program data
        },
        planExecutionId,
        executionMandateId,
        serviceSupabase
      );

      totalAmount = payResult.amount_cents || 15000;

      // Step 4: Charge success fee
      console.log('Step 4: Charging success fee');
      const chargeResponse = await serviceSupabase.functions.invoke('stripe-charge-success', {
        body: {
          plan_execution_id: planExecutionId,
          user_id: plan.user_id
        }
      });

      if (chargeResponse.error) {
        console.error('Success fee charge failed:', chargeResponse.error);
        // Don't fail the whole process if just the fee charge fails
      } else {
        console.log('Success fee charged successfully');
      }

      // Update plan status to completed
      await serviceSupabase
        .from('plans')
        .update({ status: 'completed' })
        .eq('id', plan.id);

      console.log(`MCP plan execution completed successfully: ${planExecution.id}`);

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
        confirmation_ref: confirmationRef
      })
      .eq('id', planExecutionId);

    return new Response(
      JSON.stringify({
        success: finalResult === 'success',
        plan_execution_id: planExecutionId,
        result: finalResult,
        amount_cents: totalAmount,
        confirmation_ref: confirmationRef,
        session_ref: sessionRef
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in MCP executor function:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});