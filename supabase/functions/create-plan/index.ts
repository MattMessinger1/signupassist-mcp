import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { invokeMCPTool } from '../_shared/mcpClient.ts';

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

    const requestBody = await req.json();
    console.log('create-plan received body:', JSON.stringify(requestBody));
    
    const { 
      program_ref, 
      child_id, 
      opens_at, 
      mandate_id,
      provider = 'skiclubpro',
      answers = null
    } = requestBody;
    
    // Validate required fields with detailed logging
    const missingFields = [];
    if (!program_ref) missingFields.push('program_ref');
    if (!child_id) missingFields.push('child_id');
    if (!opens_at) missingFields.push('opens_at');
    if (!mandate_id) missingFields.push('mandate_id');
    
    if (missingFields.length > 0) {
      console.error('Missing fields:', missingFields, 'Received:', { program_ref, child_id, opens_at, mandate_id });
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
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
        answers,
        status: 'scheduled'
      })
      .select()
      .single();

    if (planError) {
      console.error('Error creating plan:', planError);
      throw new Error('Failed to create plan');
    }

    console.log(`Plan created successfully: ${plan.id}`);

    // Record MCP audit log for plan creation using shared client
    try {
      await invokeMCPTool('plan.create', {
        program_ref,
        child_id,
        opens_at,
        provider
      }, {
        mandate_id: mandate_id,
        plan_execution_id: plan.id
      });
    } catch (auditErr) {
      console.error('Error logging plan creation audit:', auditErr);
      // Don't fail the plan creation if audit logging fails
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
        error: `Plan Creation Failed: ${error instanceof Error ? error.message : 'Unable to create registration plan'}`
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});