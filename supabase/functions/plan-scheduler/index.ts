import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Plan scheduler starting...');

    // Create service role client for database operations
    const serviceSupabase = createClient(
      Deno.env.get("SB_URL")!,
      Deno.env.get("SB_SERVICE_ROLE_KEY")!
    );

    // Find plans that should open within the next 5 minutes
    const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    const { data: plans, error: plansError } = await serviceSupabase
      .from('plans')
      .select(`
        id,
        user_id,
        child_id,
        program_ref,
        provider,
        opens_at,
        mandate_id,
        status
      `)
      .eq('status', 'scheduled')
      .gte('opens_at', now)
      .lte('opens_at', fiveMinutesFromNow);

    if (plansError) {
      console.error('Error fetching plans:', plansError);
      throw new Error('Failed to fetch scheduled plans');
    }

    console.log(`Found ${plans?.length || 0} plans opening soon`);

    if (!plans || plans.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No plans ready for execution',
          processed: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results = [];

    // Process each plan
    for (const plan of plans) {
      try {
        console.log(`Triggering run-plan for plan ${plan.id}`);

        // Update plan status to 'running'
        await serviceSupabase
          .from('plans')
          .update({ status: 'running' })
          .eq('id', plan.id);

        // Call run-plan function
        const runResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/run-plan`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
          },
          body: JSON.stringify({
            plan_id: plan.id
          })
        });

        const runResult = await runResponse.json();
        
        results.push({
          plan_id: plan.id,
          success: runResponse.ok,
          result: runResult
        });

        console.log(`Plan ${plan.id} execution ${runResponse.ok ? 'started' : 'failed'}`);

      } catch (error) {
        console.error(`Error processing plan ${plan.id}:`, error);
        
        // Update plan status to 'failed'
        await serviceSupabase
          .from('plans')
          .update({ status: 'failed' })
          .eq('id', plan.id);

        results.push({
          plan_id: plan.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in plan-scheduler function:', error);
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