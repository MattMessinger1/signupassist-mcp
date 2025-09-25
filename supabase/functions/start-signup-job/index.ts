import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  plan_id: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    // Check authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization header required' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authentication' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const { plan_id }: RequestBody = await req.json();

    if (!plan_id) {
      return new Response(
        JSON.stringify({ error: 'plan_id is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Starting signup job for plan: ${plan_id}`);

    // Verify plan belongs to user and has valid mandate
    const { data: planData, error: planError } = await supabase
      .from('plans')
      .select(`
        *,
        mandates!inner(
          scope,
          max_amount_cents,
          valid_until,
          status
        )
      `)
      .eq('id', plan_id)
      .eq('user_id', user.id)
      .single();

    if (planError || !planData) {
      return new Response(
        JSON.stringify({ error: 'Plan not found or access denied' }),
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Validate mandate scope includes signup permissions
    const mandate = planData.mandates;
    if (!mandate.scope.includes('scp:write:register') || mandate.status !== 'active') {
      return new Response(
        JSON.stringify({ error: 'Invalid mandate scope or status for signup' }),
        { 
          status: 403, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Check if mandate is still valid
    if (new Date(mandate.valid_until) < new Date()) {
      return new Response(
        JSON.stringify({ error: 'Mandate has expired' }),
        { 
          status: 403, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Create plan execution record with scheduled status
    const { data: executionData, error: executionError } = await supabase
      .from('plan_executions')
      .insert({
        plan_id: plan_id,
        started_at: new Date().toISOString()
      })
      .select()
      .single();

    if (executionError || !executionData) {
      console.error('Failed to create plan execution:', executionError);
      return new Response(
        JSON.stringify({ error: 'Failed to create execution record' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const plan_execution_id = executionData.id;
    console.log(`Created plan execution: ${plan_execution_id}`);

    // Prepare Railway deployment environment variables
    const railwayEnvs = {
      PLAN_ID: plan_id,
      SB_URL: Deno.env.get('SUPABASE_URL'),
      SB_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      BROWSERBASE_API_KEY: Deno.env.get('BROWSERBASE_API_KEY'),
      CRED_SEAL_KEY: Deno.env.get('CRED_SEAL_KEY'),
      MANDATE_SIGNING_KEY: Deno.env.get('MANDATE_SIGNING_KEY'),
    };

    console.log('Railway environment variables prepared');

    // In a real implementation, you would trigger Railway deployment here
    // For now, we'll log the deployment request
    console.log('🚀 Railway deployment would be triggered with envs:', {
      PLAN_ID: plan_id,
      // Don't log sensitive keys
      envs_count: Object.keys(railwayEnvs).length
    });

    // Simulate Railway API call
    try {
      // This is where you'd make the actual Railway API call
      // const railwayResponse = await fetch('https://backboard.railway.app/v2/deploy', {
      //   method: 'POST',
      //   headers: {
      //     'Authorization': `Bearer ${Deno.env.get('RAILWAY_API_TOKEN')}`,
      //     'Content-Type': 'application/json'
      //   },
      //   body: JSON.stringify({
      //     projectId: Deno.env.get('RAILWAY_PROJECT_ID'),
      //     environmentId: Deno.env.get('RAILWAY_ENVIRONMENT_ID'),
      //     serviceId: Deno.env.get('RAILWAY_SERVICE_ID'),
      //     variables: railwayEnvs
      //   })
      // });

      console.log('✅ Railway job deployment simulated successfully');
      
      return new Response(
        JSON.stringify({ 
          status: 'job started',
          plan_execution_id,
          message: 'Signup worker has been scheduled and will run at the specified time'
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );

    } catch (railwayError) {
      console.error('Railway deployment failed:', railwayError);
      
      // Update plan execution to failed status
      await supabase
        .from('plan_executions')
        .update({ 
          finished_at: new Date().toISOString(),
          result: 'failed'
        })
        .eq('id', plan_execution_id);

      return new Response(
        JSON.stringify({ 
          error: 'Failed to start worker job',
          details: railwayError instanceof Error ? railwayError.message : 'Unknown error'
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

  } catch (error) {
    console.error('Error in start-signup-job function:', error);
    
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});