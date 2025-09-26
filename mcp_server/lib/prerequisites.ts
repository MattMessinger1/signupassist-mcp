/**
 * Prerequisites & Membership Verification Utility
 * Provides functions to check account requirements before plan execution
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface PrerequisiteCheck {
  type: 'membership' | 'account_status' | 'payment_method' | 'child_info' | 'membership_status';
  status: 'passed' | 'failed' | 'warning';
  message: string;
  blocking: boolean;
}

export interface PrerequisiteResult {
  overall_status: 'ready' | 'blocked' | 'warnings';
  checks: PrerequisiteCheck[];
  can_proceed: boolean;
}

/**
 * Check membership status for SkiClubPro
 */
export async function checkSkiClubProMembership(userId: string): Promise<PrerequisiteCheck> {
  try {
    // Check if user has valid credentials for SkiClubPro
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

/**
 * Check if child information is complete
 */
export async function checkChildInformation(userId: string, childId: string): Promise<PrerequisiteCheck> {
  try {
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

    // Check required fields
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

/**
 * Check account status and payment readiness
 */
export async function checkAccountStatus(userId: string): Promise<PrerequisiteCheck> {
  try {
    // Check for any failed plan executions that might indicate account issues
    const { data: recentFailures, error } = await supabase
      .from('plan_executions')
      .select(`
        *,
        plans!inner(user_id)
      `)
      .eq('plans.user_id', userId)
      .eq('result', 'failed')
      .gte('started_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()) // Last 7 days
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

/**
 * Check SkiClubPro account status (separate from credentials)
 */
export async function checkSkiClubProAccountStatus(userId: string): Promise<PrerequisiteCheck> {
  try {
    // Look up stored credentials to get email
    const { data: credentials, error } = await supabase
      .from('stored_credentials')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'skiclubpro')
      .single();

    if (error || !credentials) {
      return {
        type: 'account_status',
        status: 'failed',
        message: 'No SkiClubPro credentials found. Account setup required (not billable).',
        blocking: true
      };
    }

    // If credentials exist, assume account exists
    // In production, this would use the scp.check_account_status tool
    return {
      type: 'account_status',
      status: 'passed',
      message: 'SkiClubPro account credentials are stored and available.',
      blocking: false
    };

  } catch (error) {
    console.error('Error checking SkiClubPro account status:', error);
    return {
      type: 'account_status',
      status: 'failed',
      message: 'Unable to verify account status',
      blocking: true
    };
  }
}

/**
 * Check SkiClubPro membership status  
 */
export async function checkSkiClubProMembershipStatus(userId: string): Promise<PrerequisiteCheck> {
  try {
    // Check if user has SkiClubPro credentials first
    const { data: credentials, error } = await supabase
      .from('stored_credentials')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'skiclubpro')
      .single();

    if (error || !credentials) {
      return {
        type: 'membership_status',
        status: 'failed',
        message: 'Cannot check membership - SkiClubPro account required first.',
        blocking: true
      };
    }

    // For now, this returns a warning requiring manual verification
    // In production, this would use the scp.check_membership_status tool
    return {
      type: 'membership_status',
      status: 'warning',
      message: 'Membership status needs verification. You must be a member of Blackhawk Ski Club.',
      blocking: false
    };

  } catch (error) {
    console.error('Error checking SkiClubPro membership status:', error);
    return {
      type: 'membership_status',
      status: 'failed',
      message: 'Unable to verify membership status',
      blocking: true
    };
  }
}

/**
 * Run all prerequisite checks for a plan
 */
export async function checkAllPrerequisites(
  userId: string,
  provider: string,
  childId?: string
): Promise<PrerequisiteResult> {
  const checks: PrerequisiteCheck[] = [];

  // Provider-specific checks
  if (provider === 'skiclubpro') {
    checks.push(await checkSkiClubProMembership(userId));
    checks.push(await checkSkiClubProAccountStatus(userId));
    checks.push(await checkSkiClubProMembershipStatus(userId));
  }

  // Child information check
  if (childId) {
    checks.push(await checkChildInformation(userId, childId));
  }

  // General account status
  checks.push(await checkAccountStatus(userId));

  // Determine overall status
  const failedChecks = checks.filter(c => c.status === 'failed');
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