/**
 * Discover Plan Fields - Daily Cron Job
 * Runs daily to discover required fields for scheduled plans
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface Plan {
  id: string;
  user_id: string;
  program_ref: string;
  opens_at: string;
  mandate_id: string;
  provider: string;
}

interface FieldSchema {
  program_ref: string;
  branches: Array<{
    choice: string;
    questions: Array<{
      id: string;
      label: string;
      type: string;
      required: boolean;
      options?: string[];
    }>;
  }>;
}

/**
 * Discover required fields for a plan
 */
async function discoverPlanFields(plan: Plan): Promise<FieldSchema | null> {
  try {
    console.log(`Discovering fields for plan ${plan.id}, program ${plan.program_ref}`);
    
    // Create a new plan execution for field discovery
    const { data: planExecution, error: executionError } = await supabase
      .from('plan_executions')
      .insert({
        plan_id: plan.id,
        started_at: new Date().toISOString(),
        result: 'field_discovery_started'
      })
      .select()
      .single();
    
    if (executionError || !planExecution) {
      console.error('Failed to create plan execution:', executionError);
      return null;
    }
    
    // Call the SkiClubPro discover fields tool via function invocation
    const { data: discoveryResult, error: discoveryError } = await supabase.functions.invoke('skiclubpro-tools', {
      body: {
        tool: 'scp.discover_required_fields',
        args: {
          program_ref: plan.program_ref,
          mandate_id: plan.mandate_id,
          plan_execution_id: planExecution.id
        }
      }
    });
    
    if (discoveryError) {
      console.error('Field discovery failed:', discoveryError);
      
      // Update plan execution with failure
      await supabase
        .from('plan_executions')
        .update({
          finished_at: new Date().toISOString(),
          result: `field_discovery_failed: ${discoveryError.message}`
        })
        .eq('id', planExecution.id);
      
      return null;
    }
    
    // Update plan execution with success
    await supabase
      .from('plan_executions')
      .update({
        finished_at: new Date().toISOString(),
        result: 'field_discovery_completed'
      })
      .eq('id', planExecution.id);
    
    return discoveryResult as FieldSchema;
    
  } catch (error) {
    console.error('Error in discoverPlanFields:', error);
    return null;
  }
}

/**
 * Check if field schema has changed and notify user if needed
 */
async function checkSchemaChanges(plan: Plan, newSchema: FieldSchema): Promise<void> {
  try {
    // In a full implementation, we would:
    // 1. Store the discovered schema in a dedicated table
    // 2. Compare with previously stored schema
    // 3. Send notification if schema differs significantly
    
    console.log(`Schema discovered for plan ${plan.id}:`, JSON.stringify(newSchema, null, 2));
    
    // For now, just log the schema
    // TODO: Implement schema storage and comparison logic
    // TODO: Implement notification system for parents
    
  } catch (error) {
    console.error('Error checking schema changes:', error);
  }
}

/**
 * Main function to process scheduled plans
 */
async function processScheduledPlans(): Promise<{ processed: number; failed: number }> {
  const sevenDaysFromNow = new Date();
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
  
  try {
    // Get plans scheduled for the next 7 days
    const { data: plans, error: plansError } = await supabase
      .from('plans')
      .select('*')
      .eq('status', 'scheduled')
      .eq('provider', 'skiclubpro')
      .gte('opens_at', new Date().toISOString())
      .lte('opens_at', sevenDaysFromNow.toISOString());
    
    if (plansError) {
      console.error('Failed to fetch scheduled plans:', plansError);
      return { processed: 0, failed: 1 };
    }
    
    if (!plans || plans.length === 0) {
      console.log('No scheduled SkiClubPro plans found for the next 7 days');
      return { processed: 0, failed: 0 };
    }
    
    console.log(`Found ${plans.length} scheduled plans to process`);
    
    let processed = 0;
    let failed = 0;
    
    // Process each plan
    for (const plan of plans) {
      try {
        const schema = await discoverPlanFields(plan);
        
        if (schema) {
          await checkSchemaChanges(plan, schema);
          processed++;
        } else {
          failed++;
        }
        
        // Add delay between requests to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (planError) {
        console.error(`Failed to process plan ${plan.id}:`, planError);
        failed++;
      }
    }
    
    return { processed, failed };
    
  } catch (error) {
    console.error('Error in processScheduledPlans:', error);
    return { processed: 0, failed: 1 };
  }
}

/**
 * Supabase Edge Function handler
 */
Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    console.log('Starting daily field discovery job');
    
    const result = await processScheduledPlans();
    
    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      processed: result.processed,
      failed: result.failed,
      message: `Processed ${result.processed} plans, ${result.failed} failed`
    };
    
    console.log('Field discovery job completed:', response);
    
    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
    
  } catch (error) {
    console.error('Field discovery job failed:', error);
    
    const errorResponse = {
      success: false,
      timestamp: new Date().toISOString(),
      error: error.message,
      message: 'Field discovery job failed'
    };
    
    return new Response(JSON.stringify(errorResponse), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});