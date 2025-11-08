import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Make this function public (no auth required)
// Configure in supabase/config.toml

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // First, list all cron jobs
    const { data: jobs, error: listError } = await supabase.rpc('query_cron_jobs' as any, {
      query: 'SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid'
    });

    if (listError) {
      throw new Error(`Failed to list jobs: ${listError.message}`);
    }

    console.log('Current cron jobs:', jobs);

    // Delete job #3 by ID
    const { data: deleteResult, error: deleteError } = await supabase.rpc('delete_cron_job' as any, {
      query: 'SELECT cron.unschedule(3)'
    });

    if (deleteError) {
      throw new Error(`Failed to delete job: ${deleteError.message}`);
    }

    // Verify deletion
    const { data: afterJobs, error: afterError } = await supabase.rpc('query_cron_jobs' as any, {
      query: 'SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid'
    });

    if (afterError) {
      throw new Error(`Failed to verify deletion: ${afterError.message}`);
    }

    console.log('Jobs after deletion:', afterJobs);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Test cron job deleted successfully',
        beforeCount: jobs?.length || 0,
        afterCount: afterJobs?.length || 0,
        remainingJobs: afterJobs,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error deleting cron job:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
