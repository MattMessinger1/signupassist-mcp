import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { invokeMCPTool } from '../_shared/mcpClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  credential_id: string;
  child_id?: string;
  provider?: string;
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

    // Get user from auth header
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
        JSON.stringify({ error: 'Not authenticated' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const { credential_id, child_id, provider }: RequestBody = await req.json();

    if (!credential_id) {
      return new Response(
        JSON.stringify({ error: 'credential_id is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Checking prerequisites for user ${user.id}, credential ${credential_id}`);

    // Load and decrypt the credential
    const { data: credentialData, error: credError } = await supabase.functions.invoke('cred-get', {
      headers: {
        Authorization: authHeader
      },
      body: { id: credential_id }
    });

    if (credError) {
      console.error('Failed to load credential:', credError);
      return new Response(
        JSON.stringify({ error: 'Failed to load credential' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Run MCP prerequisite checks using shared client
    const checks = [];

    try {
      // Check account status
      const accountStatus = await invokeMCPTool('scp.check_account_status', { 
        credential_data: credentialData 
      }, { skipAudit: true }); // Skip audit for prerequisite checks
      
      checks.push({
        check: 'Account Status',
        status: accountStatus.status === 'active' ? 'pass' : 'fail',
        message: accountStatus.message || 'Account status check completed'
      });
    } catch (error) {
      console.error('Account status check failed:', error);
      checks.push({
        check: 'Account Status',
        status: 'fail',
        message: 'Failed to check account status'
      });
    }

    try {
      // Check membership status
      const membershipStatus = await invokeMCPTool('scp.check_membership_status', { 
        credential_data: credentialData 
      }, { skipAudit: true });
      
      checks.push({
        check: 'Membership Status',
        status: membershipStatus.is_member ? 'pass' : 'fail',
        message: membershipStatus.message || 'Membership status check completed'
      });
    } catch (error) {
      console.error('Membership status check failed:', error);
      checks.push({
        check: 'Membership Status',
        status: 'fail',
        message: 'Failed to check membership status'
      });
    }

    try {
      // Check stored payment method
      const paymentStatus = await invokeMCPTool('scp.check_payment_method', { 
        credential_data: credentialData 
      }, { skipAudit: true });
      
      checks.push({
        check: 'Payment Method',
        status: paymentStatus.has_payment_method ? 'pass' : 'fail',
        message: paymentStatus.message || 'Payment method check completed'
      });
    } catch (error) {
      console.error('Payment method check failed:', error);
      checks.push({
        check: 'Payment Method',
        status: 'fail',
        message: 'Failed to check payment method'
      });
    }

    // If child_id provided, check child information
    if (child_id) {
      const childCheck = await checkChildInformation(user.id, child_id);
      checks.push({
        check: 'Child Information',
        status: childCheck.status === 'passed' ? 'pass' : 'fail',
        message: childCheck.message
      });
    }

    const overall_status = checks.every(c => c.status === 'pass') ? 'ready' : 'blocked';
    const can_proceed = checks.every(c => c.status === 'pass');

    const result = {
      checks,
      overall_status,
      can_proceed
    };

    console.log('Prerequisites check result:', result);

    return new Response(
      JSON.stringify(result),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in check-prerequisites function:', error);
    
    return new Response(
      JSON.stringify({ 
        error: `Prerequisites Check Failed: ${error instanceof Error ? error.message : 'Unable to verify prerequisites'}`
      }),
      { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

// Prerequisites checking logic (inline to avoid import issues)
interface PrerequisiteCheck {
  type: 'membership' | 'account_status' | 'payment_method' | 'child_info';
  status: 'passed' | 'failed' | 'warning';
  message: string;
  blocking: boolean;
}

interface PrerequisiteResult {
  overall_status: 'ready' | 'blocked' | 'warnings';
  checks: PrerequisiteCheck[];
  can_proceed: boolean;
}

async function checkSkiClubProMembership(userId: string): Promise<PrerequisiteCheck> {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: credentials, error } = await supabase
      .from('stored_credentials')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'skiclubpro')
      .eq('alias', 'main')
      .maybeSingle();

    if (error) {
      return {
        type: 'membership',
        status: 'failed',
        message: 'Unable to verify membership credentials',
        blocking: true
      };
    }

    if (!credentials) {
      return {
        type: 'membership',
        status: 'failed',
        message: 'No SkiClubPro credentials found. Please add your login details first.',
        blocking: true
      };
    }

    return {
      type: 'membership',
      status: 'passed',
      message: 'SkiClubPro credentials verified',
      blocking: false
    };
  } catch (error) {
    return {
      type: 'membership',
      status: 'failed',
      message: `Membership check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      blocking: true
    };
  }
}

async function checkChildInformation(userId: string, childId: string): Promise<PrerequisiteCheck> {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: child, error } = await supabase
      .from('children')
      .select('*')
      .eq('user_id', userId)
      .eq('id', childId)
      .maybeSingle();

    if (error) {
      return {
        type: 'child_info',
        status: 'failed',
        message: 'Unable to verify child information',
        blocking: true
      };
    }

    if (!child) {
      return {
        type: 'child_info',
        status: 'failed',
        message: 'Child not found',
        blocking: true
      };
    }

    const missingFields = [];
    if (!child.name) missingFields.push('name');
    if (!child.dob) missingFields.push('date of birth');

    if (missingFields.length > 0) {
      return {
        type: 'child_info',
        status: 'failed',
        message: `Missing required child information: ${missingFields.join(', ')}`,
        blocking: true
      };
    }

    return {
      type: 'child_info',
      status: 'passed',
      message: 'Child information complete',
      blocking: false
    };
  } catch (error) {
    return {
      type: 'child_info',
      status: 'failed',
      message: `Child information check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      blocking: true
    };
  }
}

async function checkAccountStatus(userId: string): Promise<PrerequisiteCheck> {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: recentFailures, error } = await supabase
      .from('plan_executions')
      .select(`
        *,
        plans!inner(user_id)
      `)
      .eq('plans.user_id', userId)
      .eq('result', 'failed')
      .gte('started_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .limit(5);

    if (error) {
      return {
        type: 'account_status',
        status: 'warning',
        message: 'Unable to check recent account activity',
        blocking: false
      };
    }

    if (recentFailures && recentFailures.length >= 3) {
      return {
        type: 'account_status',
        status: 'warning',
        message: `${recentFailures.length} failed registration attempts in the past week. Check your credentials.`,
        blocking: false
      };
    }

    return {
      type: 'account_status',
      status: 'passed',
      message: 'Account status looks good',
      blocking: false
    };
  } catch (error) {
    return {
      type: 'account_status',
      status: 'warning',
      message: `Account status check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      blocking: false
    };
  }
}

async function checkAllPrerequisites(
  userId: string,
  provider: string,
  childId?: string
): Promise<PrerequisiteResult> {
  const checks: PrerequisiteCheck[] = [];

  if (provider === 'skiclubpro') {
    checks.push(await checkSkiClubProMembership(userId));
  }

  if (childId) {
    checks.push(await checkChildInformation(userId, childId));
  }

  checks.push(await checkAccountStatus(userId));

  const blockingIssues = checks.filter(c => c.blocking && c.status === 'failed');
  const warnings = checks.filter(c => c.status === 'warning');

  let overall_status: 'ready' | 'blocked' | 'warnings';
  if (blockingIssues.length > 0) {
    overall_status = 'blocked';
  } else if (warnings.length > 0) {
    overall_status = 'warnings';
  } else {
    overall_status = 'ready';
  }

  return {
    overall_status,
    checks,
    can_proceed: blockingIssues.length === 0
  };
}