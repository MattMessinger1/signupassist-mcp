import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// MCP Tool implementations (simplified versions for edge function)
async function discoverRequiredFields(args: any, planExecutionId: string) {
  console.log('Discovering required fields for program:', args.program_ref);
  
  // For now, return a mock schema - in production this would use Browserbase
  const mockSchema = {
    program_ref: args.program_ref,
    branches: [
      {
        branch_id: 'main',
        title: 'Standard Registration',
        questions: [
          {
            question_id: 'child_name',
            label: 'Child Full Name',
            type: 'text',
            required: true
          },
          {
            question_id: 'child_age',
            label: 'Child Age',
            type: 'number',
            required: true
          },
          {
            question_id: 'parent_email',
            label: 'Parent Email',
            type: 'email',
            required: true
          },
          {
            question_id: 'emergency_contact',
            label: 'Emergency Contact',
            type: 'text',
            required: true
          }
        ]
      }
    ],
    common_questions: [
      {
        question_id: 'waiver_agreement',
        label: 'I agree to the liability waiver',
        type: 'checkbox',
        required: true
      }
    ]
  };

  // Log this as evidence
  console.log('Generated mock schema for program:', args.program_ref);
  
  return mockSchema;
}

async function checkAccountStatus(args: any, planExecutionId: string) {
  console.log('Checking account status');
  return { status: 'active', message: 'Account is active' };
}

async function checkMembershipStatus(args: any, planExecutionId: string) {
  console.log('Checking membership status');
  return { status: 'active', message: 'Membership is current' };
}

async function checkStoredPaymentMethod(args: any, planExecutionId: string) {
  console.log('Checking stored payment method');
  return { status: 'valid', message: 'Payment method on file' };
}

// Tool router
const tools: Record<string, (args: any, planExecutionId: string) => Promise<any>> = {
  'scp.discover_required_fields': discoverRequiredFields,
  'scp.check_account_status': checkAccountStatus,
  'scp.check_membership_status': checkMembershipStatus,
  'scp.check_stored_payment_method': checkStoredPaymentMethod,
};

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

    const { tool, args } = await req.json();
    
    if (!tool || !args) {
      return new Response(
        JSON.stringify({ error: 'Missing tool or args' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Executing MCP tool: ${tool} with args:`, args);

    // Get the tool implementation
    const toolImpl = tools[tool];
    if (!toolImpl) {
      return new Response(
        JSON.stringify({ error: `Unknown tool: ${tool}` }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Execute the tool
    const result = await toolImpl(args, args.plan_execution_id || 'interactive');

    console.log(`Tool ${tool} completed successfully`);

    return new Response(
      JSON.stringify(result),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in skiclubpro-tools function:', error);
    
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