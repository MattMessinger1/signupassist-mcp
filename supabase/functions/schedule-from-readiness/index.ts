import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { validateSchemaConsistency, getValidationHeaders } from '../_shared/validate-schema-consistency.ts';
import { logStructuredError } from '../_shared/errors.ts';

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
  
  // Validate schema consistency on startup
  const schemaValidation = await validateSchemaConsistency();
  if (!schemaValidation.valid) {
    console.warn('[Edge] Schema validation failed:', schemaValidation.mismatches);
  }
  
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

    // Extract provider from plan
    const provider = plan.provider || 'skiclubpro';

    // Helper function to add timeout to promises
    const PREREQ_TIMEOUT_MS = 30000; // 30 seconds
    async function invokeWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
      return Promise.race([
        promise,
        new Promise<T>((_, reject) => 
          setTimeout(() => reject(new Error('Operation timed out')), timeoutMs)
        )
      ]);
    }

    // Check prerequisites with timeout
    let prereqResult: any;
    let prereqError: any;
    
    try {
      const result = await invokeWithTimeout(
        supabase.functions.invoke('check-prerequisites', {
          headers: {
            Authorization: `Bearer ${user_jwt}`
          },
          body: {
            credential_id,
            provider,
            child_id: plan.child_id
          }
        }),
        PREREQ_TIMEOUT_MS
      );
      
      prereqResult = result.data;
      prereqError = result.error;
      
      // Enhanced logging
      console.log('[Edge] check-prerequisites response:', { 
        hasData: !!prereqResult, 
        hasError: !!prereqError,
        errorDetails: prereqError,
        dataType: typeof prereqResult,
        dataKeys: prereqResult ? Object.keys(prereqResult) : [],
        credential_id,
        provider,
        child_id: plan.child_id
      });
      
    } catch (timeoutError) {
      console.error('[Edge] Prerequisites check timed out after 30s:', {
        credential_id,
        provider,
        child_id: plan.child_id
      });
      
      return new Response(
        JSON.stringify({ 
          error: 'Prerequisites check timed out',
          details: 'The prerequisite check took too long to complete (>30s)',
          execution_id: executionId
        }),
        { 
          status: 408, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    if (prereqError || !prereqResult) {
      console.error(`[Edge] Prerequisites check failed:`, {
        error: prereqError,
        result: prereqResult,
        credential_id,
        provider,
        child_id: plan.child_id,
        hasError: !!prereqError,
        hasResult: !!prereqResult,
        errorMessage: prereqError?.message
      });
      
      return new Response(
        JSON.stringify({ 
          error: 'Prerequisites check failed',
          details: prereqError?.message || 'No result returned from check-prerequisites',
          debug: {
            hasError: !!prereqError,
            hasResult: !!prereqResult,
            errorMessage: prereqError?.message
          },
          execution_id: executionId
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Access correct response structure
    const checks = prereqResult.checks || [];
    const hasBlockingFailures = checks.some(
      (check: any) => check.status === 'fail'
    );

    if (hasBlockingFailures) {
      console.log(`[Edge] Prerequisites failed - blocking issues detected`);
      return new Response(
        JSON.stringify({ 
          status: 'prerequisites_failed',
          checks,
          execution_id: executionId
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`[Edge] Prerequisites passed - verifying mandate`);

    // Verify mandate is signed
    if (plan.mandate_id) {
      const { data: mandate, error: mandateError } = await supabase
        .from('mandates')
        .select('*')
        .eq('id', plan.mandate_id)
        .single();

      if (mandateError || !mandate) {
        console.error(`[Edge] Mandate not found:`, mandateError);
        
        await logStructuredError(supabase, {
          correlationId: executionId,
          stage: 'mandate_verification',
          error: 'Mandate not found',
          plan_id,
          mandate_id: plan.mandate_id,
          status: 'missing'
        });

        return new Response(
          JSON.stringify({ 
            error: 'MANDATE_MISSING',
            execution_id: executionId
          }),
          { 
            status: 412, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }

      if (mandate.status !== 'signed') {
        console.log(`[Edge] Mandate not signed - status: ${mandate.status}`);
        
        await logStructuredError(supabase, {
          correlationId: executionId,
          stage: 'mandate_verification',
          error: `Mandate not signed - status: ${mandate.status}`,
          plan_id,
          mandate_id: plan.mandate_id,
          status: mandate.status
        });

        return new Response(
          JSON.stringify({ 
            error: 'MANDATE_MISSING',
            current_status: mandate.status,
            execution_id: executionId
          }),
          { 
            status: 412, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }

      console.log(`[Edge] Mandate verified - status: signed`);
      
      // Log successful verification
      const { error: logError } = await supabase.rpc('insert_execution_log', {
        p_correlation_id: executionId,
        p_plan_id: plan_id,
        p_plan_execution_id: null,
        p_mandate_id: plan.mandate_id,
        p_stage: 'mandate_verification',
        p_status: 'success',
        p_attempt: 1,
        p_error_message: null,
        p_metadata: {
          mandate_status: mandate.status,
          timestamp: new Date().toISOString()
        }
      });

      if (logError) {
        console.warn('[Edge] Failed to log mandate verification:', logError);
      }
    } else {
      console.warn(`[Edge] Plan has no mandate_id - skipping verification`);
    }

    console.log(`[Edge] Triggering execution`);

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

    const responseHeaders = {
      ...corsHeaders,
      ...getValidationHeaders(schemaValidation),
      'Content-Type': 'application/json'
    };

    return new Response(
      JSON.stringify({ 
        status: 'execution_started',
        execution_id: executionId,
        result: executionResult
      }),
      { 
        status: 200, 
        headers: responseHeaders
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
