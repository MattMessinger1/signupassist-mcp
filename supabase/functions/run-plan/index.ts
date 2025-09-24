import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// MCP Tool execution simulation
async function executeMCPTool(toolName: string, args: any, planExecutionId: string, mandateId: string, supabase: any) {
  console.log(`Executing MCP tool: ${toolName} with args:`, JSON.stringify(args));

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

  // Simulate tool execution based on tool name
  let result;
  let success = true;

  try {
    switch (toolName) {
      case 'scp:login':
        // Simulate login
        result = {
          success: true,
          session_id: `session_${Date.now()}`,
          message: 'Login successful'
        };
        break;

      case 'scp:register':
        // Simulate registration
        result = {
          success: true,
          registration_id: `reg_${Date.now()}`,
          confirmation_number: `CONF${Math.floor(Math.random() * 1000000)}`,
          message: 'Registration successful'
        };
        break;

      case 'scp:pay':
        // Simulate payment
        result = {
          success: true,
          transaction_id: `txn_${Date.now()}`,
          amount_cents: args.amount_cents || 15000, // $150 default
          message: 'Payment successful'
        };
        break;

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }

    // Capture evidence (screenshot simulation)
    const { error: evidenceError } = await supabase
      .from('evidence_assets')
      .insert({
        plan_execution_id: planExecutionId,
        type: 'screenshot',
        url: `https://evidence.example.com/${toolName}_${Date.now()}.png`,
        sha256: generateHash(`${toolName}_evidence_${Date.now()}`)
      });

    if (evidenceError) {
      console.warn('Failed to create evidence record:', evidenceError);
    }

  } catch (error) {
    success = false;
    result = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }

  // Update audit record with result
  await supabase
    .from('mcp_tool_calls')
    .update({
      result_json: result,
      result_hash: generateHash(JSON.stringify(result))
    })
    .eq('id', auditRecord.id);

  if (!success) {
    throw new Error(`Tool ${toolName} failed: ${result.error}`);
  }

  return result;
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
    const { plan_id } = await req.json();
    
    if (!plan_id) {
      throw new Error('plan_id is required');
    }

    console.log(`Starting plan execution for plan ${plan_id}`);

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

    try {
      // Step 1: Login
      console.log('Step 1: Executing scp:login');
      const loginResult = await executeMCPTool(
        'scp:login',
        {
          program_ref: plan.program_ref,
          credential_type: 'stored'
        },
        planExecution.id,
        plan.mandate_id,
        serviceSupabase
      );

      // Step 2: Register
      console.log('Step 2: Executing scp:register');
      const registerResult = await executeMCPTool(
        'scp:register',
        {
          program_ref: plan.program_ref,
          child_id: plan.child_id,
          session_id: loginResult.session_id
        },
        planExecution.id,
        plan.mandate_id,
        serviceSupabase
      );

      confirmationRef = registerResult.confirmation_number;

      // Step 3: Pay
      console.log('Step 3: Executing scp:pay');
      const payResult = await executeMCPTool(
        'scp:pay',
        {
          registration_id: registerResult.registration_id,
          session_id: loginResult.session_id
        },
        planExecution.id,
        plan.mandate_id,
        serviceSupabase
      );

      totalAmount = payResult.amount_cents;

      // Step 4: Charge success fee
      console.log('Step 4: Charging success fee');
      const chargeResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/stripe-charge-success`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
        },
        body: JSON.stringify({
          plan_execution_id: planExecution.id,
          user_id: plan.user_id
        })
      });

      const chargeResult = await chargeResponse.json();
      
      if (!chargeResponse.ok || !chargeResult.success) {
        console.error('Success fee charge failed:', chargeResult);
        // Don't fail the whole process if just the fee charge fails
      } else {
        console.log('Success fee charged successfully');
      }

      // Update plan status to completed
      await serviceSupabase
        .from('plans')
        .update({ status: 'completed' })
        .eq('id', plan.id);

      console.log(`Plan execution completed successfully: ${planExecution.id}`);

    } catch (error) {
      console.error('Plan execution failed:', error);
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
        confirmation_ref: confirmationRef
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in run-plan function:', error);
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