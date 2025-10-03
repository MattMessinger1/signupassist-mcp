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

    const { 
      program_ref, 
      child_id, 
      opens_at,
      mandate_id,
      provider = 'skiclubpro',
      answers = null,
      max_provider_charge_cents,
      service_fee_cents,
      notes,
      reminders
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

    // Build meta object
    const meta: any = {};
    if (answers) meta.answers = answers;
    if (max_provider_charge_cents !== undefined || service_fee_cents !== undefined) {
      meta.caps = { max_provider_charge_cents, service_fee_cents };
    }
    if (notes) meta.notes = notes;
    if (reminders) meta.reminders = reminders;

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
        meta: Object.keys(meta).length > 0 ? meta : null,
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