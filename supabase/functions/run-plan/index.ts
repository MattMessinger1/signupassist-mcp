import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Forward to MCP executor
async function executePlanViaMCP(planId: string, planExecutionId: string, mandateId: string, supabase: any) {
  console.log(`Forwarding plan ${planId} to MCP executor with execution ${planExecutionId}`);
  
  const mcpResult = await supabase.functions.invoke('mcp-executor', {
    body: { 
      plan_id: planId,
      plan_execution_id: planExecutionId,
      mandate_id: mandateId
    }
  });

  if (mcpResult.error) {
    throw new Error(`MCP execution failed: ${mcpResult.error.message}`);
  }

  return mcpResult.data;
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

    try {
      // Execute plan via MCP
      console.log('Executing plan via MCP executor');
      const mcpResult = await executePlanViaMCP(plan.id, planExecution.id, plan.mandate_id, serviceSupabase);

      // Update plan status to completed
      await serviceSupabase
        .from('plans')
        .update({ status: 'completed' })
        .eq('id', plan.id);

      console.log(`MCP plan execution completed successfully: ${planExecution.id}`);

      return new Response(
        JSON.stringify(mcpResult),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } catch (error) {
      console.error('Plan execution failed:', error);

      // Update plan status to failed  
      await serviceSupabase
        .from('plans')
        .update({ status: 'failed' })
        .eq('id', plan.id);

      // Update plan execution with error
      await serviceSupabase
        .from('plan_executions')
        .update({
          finished_at: new Date().toISOString(),
          result: 'failed'
        })
        .eq('id', planExecution.id);

      return new Response(
        JSON.stringify({ 
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          plan_execution_id: planExecution.id
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

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