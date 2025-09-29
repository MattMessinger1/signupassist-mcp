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
  // Backward compatibility aliases for dot notation
  'scp.login': 'skiclubpro-tools',
  'scp.register': 'skiclubpro-tools',
  'scp.pay': 'skiclubpro-tools',
  'scp.discover_fields': 'skiclubpro-tools',
  'scp.find_programs': 'skiclubpro-tools'
};

async function executeMCPTool(toolName: string, args: any, planExecutionId: string, mandateId: string, supabase: any) {
  console.log(`Executing MCP tool: ${toolName} with args:`, JSON.stringify(args));

  // Get the edge function that handles this tool
  const edgeFunction = MCP_TOOLS[toolName];
  if (!edgeFunction) {
    throw new Error(`No handler found for MCP tool: ${toolName}`);
  }

  // Create audit record
  const { data: auditRecord, error: auditError } = await supabase
    .from('mcp_tool_calls')
    .insert({
      plan_execution_id: planExecutionId,
      mandate_id: mandateId,
      tool: toolName,
      args_json: args,
      args_hash: generateHash(JSON.stringify(args)),
      decision: 'approved' // Since mandate is pre-approved
    })
    .select()
    .single();

  if (auditError) {
    throw new Error(`Failed to create audit record: ${auditError.message}`);
  }

  try {
    // Call the actual MCP tool implementation
    const toolResult = await supabase.functions.invoke(edgeFunction, {
      body: {
        action: toolName,
        ...args,
        plan_execution_id: planExecutionId,
        mandate_id: mandateId
      }
    });

    if (toolResult.error) {
      throw new Error(`MCP tool failed: ${toolResult.error.message}`);
    }

    const result = toolResult.data;

    // Update audit record with result
    await supabase
      .from('mcp_tool_calls')
      .update({
        result_json: result,
        result_hash: generateHash(JSON.stringify(result))
      })
      .eq('id', auditRecord.id);

    console.log(`MCP tool ${toolName} completed successfully:`, result);
    return result;

  } catch (error) {
    const errorResult = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };

    // Update audit record with error
    await supabase
      .from('mcp_tool_calls')
      .update({
        result_json: errorResult,
        result_hash: generateHash(JSON.stringify(errorResult))
      })
      .eq('id', auditRecord.id);

    throw error;
  }
}

function generateHash(data: string): string {
  // Simple hash function for demo - in production use proper crypto
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16);
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
      const { tool, ...args } = body;
      console.log("mcp-executor invoked with tool:", tool, "args:", args);
      
      // Get the edge function that handles this tool
      const edgeFunction = MCP_TOOLS[tool];
      if (!edgeFunction) {
        throw new Error(`No handler found for MCP tool: ${tool}`);
      }

      // For individual tool calls, invoke the tool directly
      const toolResult = await createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      ).functions.invoke(edgeFunction, {
        body: {
          action: tool,
          ...args
        }
      });

      if (toolResult.error) {
        throw new Error(`MCP tool failed: ${toolResult.error.message}`);
      }

      return new Response(
        JSON.stringify(toolResult.data),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle plan execution
    const { plan_id } = body;
    
    if (!plan_id) {
      throw new Error('plan_id is required');
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

    // Create plan execution record
    const { data: planExecution, error: executionError } = await serviceSupabase
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

    console.log(`Plan execution created: ${planExecution.id}`);

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
          credential_alias: 'skiclubpro-default',
          program_ref: plan.program_ref
        },
        planExecution.id,
        plan.mandate_id,
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
        planExecution.id,
        plan.mandate_id,
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
        planExecution.id,
        plan.mandate_id,
        serviceSupabase
      );

      totalAmount = payResult.amount_cents || 15000;

      // Step 4: Charge success fee
      console.log('Step 4: Charging success fee');
      const chargeResponse = await serviceSupabase.functions.invoke('stripe-charge-success', {
        body: {
          plan_execution_id: planExecution.id,
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
      .eq('id', planExecution.id);

    return new Response(
      JSON.stringify({
        success: finalResult === 'success',
        plan_execution_id: planExecution.id,
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