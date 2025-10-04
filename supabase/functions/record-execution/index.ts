import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Record execution results from Browserbase automation
 * 
 * Flow: Receive results → Update plan_executions → Return confirmation
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log(`[Edge:RecordExecution] Received execution result`);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { 
      execution_id, 
      plan_id,
      result, 
      amount_cents,
      confirmation_ref,
      error_message 
    } = await req.json();

    if (!execution_id) {
      console.error(`[Edge:RecordExecution] Missing execution_id`);
      return new Response(
        JSON.stringify({ error: 'execution_id is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`[Edge:RecordExecution] Recording result for execution ${execution_id}:`, {
      result,
      amount_cents,
      confirmation_ref
    });

    // Update plan execution
    const { data: updatedExecution, error: updateError } = await supabase
      .from('plan_executions')
      .update({
        finished_at: new Date().toISOString(),
        result,
        amount_cents,
        confirmation_ref
      })
      .eq('id', execution_id)
      .select()
      .single();

    if (updateError) {
      console.error(`[Edge:RecordExecution] Failed to update execution:`, updateError);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to update execution record',
          details: updateError.message
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Update plan status based on result
    if (plan_id) {
      const planStatus = result === 'success' ? 'completed' : 'failed';
      
      const { error: planUpdateError } = await supabase
        .from('plans')
        .update({ status: planStatus })
        .eq('id', plan_id);

      if (planUpdateError) {
        console.error(`[Edge:RecordExecution] Failed to update plan status:`, planUpdateError);
        // Don't fail the request - execution was recorded successfully
      } else {
        console.log(`[Edge:RecordExecution] Updated plan ${plan_id} status to ${planStatus}`);
      }
    }

    // Log to execution_logs
    await supabase.rpc('insert_execution_log', {
      p_correlation_id: execution_id,
      p_plan_id: plan_id || null,
      p_plan_execution_id: execution_id,
      p_stage: 'execution_complete',
      p_status: result === 'success' ? 'success' : 'failed',
      p_attempt: 1,
      p_error_message: error_message || null,
      p_metadata: {
        amount_cents,
        confirmation_ref,
        recorded_at: new Date().toISOString()
      }
    });

    console.log(`[Edge:RecordExecution] Successfully recorded execution ${execution_id}`);

    return new Response(
      JSON.stringify({ 
        success: true,
        execution_id,
        execution: updatedExecution
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error(`[Edge:RecordExecution] Error:`, error);
    
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
