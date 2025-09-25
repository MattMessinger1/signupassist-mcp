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
    // Create Supabase client for auth
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        }
      }
    );

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const { 
      program_ref, 
      child_id, 
      opens_at, 
      mandate_id,
      provider = 'skiclubpro'
    } = await req.json();
    
    // Validate required fields
    if (!program_ref || !child_id || !opens_at || !mandate_id) {
      throw new Error('Missing required fields: program_ref, child_id, opens_at, mandate_id');
    }

    // Validate opens_at is in the future
    const opensAtDate = new Date(opens_at);
    if (opensAtDate <= new Date()) {
      throw new Error('opens_at must be in the future');
    }

    console.log(`Creating plan for user ${user.id}: ${program_ref} opening at ${opens_at}`);

    // Create service role client for database operations
    const serviceSupabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify mandate exists and belongs to user
    const { data: mandate, error: mandateError } = await serviceSupabase
      .from('mandates')
      .select('id, user_id, status')
      .eq('id', mandate_id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single();

    if (mandateError || !mandate) {
      throw new Error('Invalid or inactive mandate');
    }

    // Insert plan
    const { data: plan, error: planError } = await serviceSupabase
      .from('plans')
      .insert({
        user_id: user.id,
        child_id,
        program_ref,
        provider,
        opens_at,
        mandate_id,
        status: 'scheduled'
      })
      .select()
      .single();

    if (planError) {
      console.error('Error creating plan:', planError);
      throw new Error('Failed to create plan');
    }

    console.log(`Plan created successfully: ${plan.id}`);

    // Record MCP audit log for plan creation
    try {
      const auditData = {
        plan_execution_id: plan.id, // Use plan ID as execution ID for tracking
        mandate_id: mandate_id,
        tool: 'plan.create',
        args_json: {
          program_ref,
          child_id,
          opens_at,
          provider
        },
        result_json: {
          plan_id: plan.id,
          status: 'scheduled'
        },
        args_hash: await generateHash(JSON.stringify({ program_ref, child_id, opens_at, provider })),
        result_hash: await generateHash(JSON.stringify({ plan_id: plan.id, status: 'scheduled' })),
        decision: 'allowed'
      };

      const { error: auditError } = await serviceSupabase
        .from('mcp_tool_calls')
        .insert(auditData);

      if (auditError) {
        console.error('Failed to create audit log:', auditError);
        // Don't fail the plan creation if audit logging fails
      }
    } catch (auditErr) {
      console.error('Error creating audit log:', auditErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        plan_id: plan.id,
        status: 'scheduled',
        opens_at: plan.opens_at
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in create-plan function:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

// Helper function to generate hash for audit logging
async function generateHash(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}