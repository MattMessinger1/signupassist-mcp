import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authentication Required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Session Expired' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { job_id } = await req.json();

    if (!job_id) {
      return new Response(
        JSON.stringify({ error: 'Missing job_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch job status
    const { data: job, error } = await supabase
      .from('discovery_jobs')
      .select('*')
      .eq('id', job_id)
      .eq('user_id', user.id)
      .single();

    if (error) {
      console.error('Error fetching job:', error);
      return new Response(
        JSON.stringify({ error: 'Job not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ✅ Defensive normalization for completed jobs
    if (job.status === 'completed') {
      const prereqChecks = job.prerequisite_checks || [];
      const currentStatus = job.metadata?.prerequisite_status;
      
      // If stage was 'prereq' and no checks found, force status to 'complete'
      if (job.mode === 'prerequisites_only' || job.metadata?.stage === 'prereq') {
        if (prereqChecks.length === 0) {
          job.metadata = {
            ...job.metadata,
            prerequisite_status: 'complete'
          };
          console.log(`[check-discovery-job] Normalized prerequisite_status → complete (0 checks found)`);
        }
      }
    }

    return new Response(
      JSON.stringify(job),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
