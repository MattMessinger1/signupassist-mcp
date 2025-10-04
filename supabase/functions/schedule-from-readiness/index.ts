import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Schedule plan execution after prerequisites pass
 * 
 * Flow: Check prerequisites → Trigger execution → Return status
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const executionId = crypto.randomUUID();
  console.log(`[Edge] Starting schedule-from-readiness with execution_id: ${executionId}`);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { plan_id, credential_id, user_jwt } = await req.json();

    if (!plan_id || !credential_id) {
      console.error(`[Edge] Missing required fields:`, { plan_id, credential_id });
      return new Response(
        JSON.stringify({ 
          error: 'Missing plan_id or credential_id',
          execution_id: executionId
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`[Edge] Checking prerequisites for plan ${plan_id}`);

    // Fetch plan details
    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select('*, mandates(*)')
      .eq('id', plan_id)
      .single();

    if (planError || !plan) {
      console.error(`[Edge] Failed to fetch plan:`, planError);
      return new Response(
        JSON.stringify({ 
          error: 'Plan not found',
          execution_id: executionId
        }),
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Check prerequisites
    const { data: prereqResult, error: prereqError } = await supabase.functions.invoke('check-prerequisites', {
      headers: {
        Authorization: `Bearer ${user_jwt}`
      },
      body: {
        org_ref: 'blackhawk-ski-club',
        credential_id,
        user_jwt
      }
    });

    if (prereqError || !prereqResult?.data) {
      console.error(`[Edge] Prerequisites check failed:`, prereqError);
      return new Response(
        JSON.stringify({ 
          error: 'Prerequisites check failed',
          details: prereqError?.message,
          execution_id: executionId
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Check if prerequisites passed
    const requirements = prereqResult.data.requirements || [];
    const hasBlockingFailures = requirements.some(
      (req: any) => req.blocking && req.outcome === 'fail'
    );

    if (hasBlockingFailures) {
      console.log(`[Edge] Prerequisites failed - blocking issues detected`);
      return new Response(
        JSON.stringify({ 
          status: 'prerequisites_failed',
          requirements,
          execution_id: executionId
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`[Edge] Prerequisites passed - triggering execution`);

    // Create plan execution record
    const { data: planExecution, error: execError } = await supabase
      .from('plan_executions')
      .insert({
        id: executionId,
        plan_id,
        started_at: new Date().toISOString()
      })
      .select()
      .single();

    if (execError) {
      console.error(`[Edge] Failed to create plan execution:`, execError);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to create execution record',
          execution_id: executionId
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Trigger execution via mcp-executor (replaces Railway worker)
    console.log(`[Edge] Triggering mcp-executor for execution ${executionId}`);
    
    const { data: executionResult, error: executionError } = await supabase.functions.invoke('mcp-executor', {
      body: {
        plan_id,
        plan_execution_id: executionId,
        mandate_id: plan.mandate_id,
        credential_id,
        user_jwt
      }
    });

    if (executionError) {
      console.error(`[Edge] Execution trigger failed:`, executionError);
      
      // Update execution record with failure
      await supabase
        .from('plan_executions')
        .update({
          finished_at: new Date().toISOString(),
          result: 'failed'
        })
        .eq('id', executionId);

      return new Response(
        JSON.stringify({ 
          error: 'Execution failed',
          details: executionError.message,
          execution_id: executionId
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`[Edge] Execution triggered successfully: ${executionId}`);

    return new Response(
      JSON.stringify({ 
        status: 'execution_started',
        execution_id: executionId,
        result: executionResult
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error(`[Edge] Error in schedule-from-readiness:`, error);
    
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        execution_id: executionId
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
