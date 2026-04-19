import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const sensitiveActions = new Set([
  'register',
  'pay',
  'provider_login',
  'accept_waiver',
  'submit_final',
  'delegate_signup',
]);

const reviewStateByAction: Record<string, string> = {
  register: 'registration_review_required',
  pay: 'payment_review_required',
  provider_login: 'provider_login_required',
  accept_waiver: 'waiver_review_required',
  submit_final: 'final_submit_review_required',
  delegate_signup: 'awaiting_parent_review',
};

const readinessLevels = [
  'unknown',
  'recognized',
  'fill_safe',
  'navigation_verified',
  'registration_submit_verified',
  'checkout_handoff_verified',
  'delegated_signup_candidate',
  'delegated_signup_verified',
];

const liveAutomationAllowedPolicies = new Set([
  'api_authorized',
  'written_permission_received',
]);

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function readinessAtLeast(actual?: string | null, required?: string | null) {
  if (!actual || !required) return false;
  const actualRank = readinessLevels.indexOf(actual);
  const requiredRank = readinessLevels.indexOf(required);
  return actualRank >= 0 && requiredRank >= 0 && actualRank >= requiredRank;
}

function isFresh(expiresAt?: string | null) {
  return Boolean(expiresAt && new Date(expiresAt).getTime() > Date.now());
}

function matchesConstraint(expected: unknown, actual: unknown) {
  return expected === null || expected === undefined || expected === actual;
}

function providerAutomationPolicyAllowsLiveAction(parameters: Record<string, unknown>) {
  const status = parameters.provider_automation_policy_status;
  return typeof status === 'string' && liveAutomationAllowedPolicies.has(status);
}

function safeParameters(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error('auth_required');
  }
  return data.user;
}

async function logGateAudit(
  serviceSupabase: ReturnType<typeof createClient>,
  userId: string,
  action: string,
  decision: string,
  parameters: Record<string, unknown>,
) {
  await serviceSupabase.from('mandate_audit').insert({
    user_id: userId,
    action: `sensitive_action_${action}_${decision}`,
    provider: typeof parameters.provider_key === 'string' ? parameters.provider_key : null,
    program_ref: typeof parameters.exact_program === 'string' ? parameters.exact_program : null,
    metadata: {
      decision,
      action_type: action,
      signup_intent_id: parameters.signup_intent_id ?? null,
      autopilot_run_id: parameters.autopilot_run_id ?? null,
      payment_amount_present: typeof parameters.amount_cents === 'number',
      idempotency_key_present: typeof parameters.idempotency_key === 'string',
    },
  });
}

async function verifyParentConfirmation(
  serviceSupabase: ReturnType<typeof createClient>,
  userId: string,
  action: string,
  parameters: Record<string, unknown>,
) {
  const confirmationId = parameters.parent_action_confirmation_id;
  if (typeof confirmationId !== 'string') return { ok: false, reason: 'parent_confirmation_required' };

  const { data: confirmation, error } = await serviceSupabase
    .from('parent_action_confirmations')
    .select('*')
    .eq('id', confirmationId)
    .single();

  if (error || !confirmation) return { ok: false, reason: 'parent_confirmation_not_found' };
  if (confirmation.user_id !== userId) return { ok: false, reason: 'parent_confirmation_wrong_user' };
  if (confirmation.action_type !== action) return { ok: false, reason: 'parent_confirmation_wrong_action' };
  if (!matchesConstraint(confirmation.signup_intent_id, parameters.signup_intent_id)) {
    return { ok: false, reason: 'parent_confirmation_wrong_signup_intent' };
  }
  if (!matchesConstraint(confirmation.autopilot_run_id, parameters.autopilot_run_id)) {
    return { ok: false, reason: 'parent_confirmation_wrong_autopilot_run' };
  }
  if (!matchesConstraint(confirmation.mandate_id, parameters.mandate_id)) {
    return { ok: false, reason: 'parent_confirmation_wrong_mandate' };
  }
  if (!matchesConstraint(confirmation.provider_key, parameters.provider_key)) {
    return { ok: false, reason: 'parent_confirmation_wrong_provider' };
  }
  if (!matchesConstraint(confirmation.target_url, parameters.target_url)) {
    return { ok: false, reason: 'parent_confirmation_wrong_target_url' };
  }
  if (!matchesConstraint(confirmation.exact_program, parameters.exact_program)) {
    return { ok: false, reason: 'parent_confirmation_wrong_program' };
  }
  if (!matchesConstraint(confirmation.idempotency_key, parameters.idempotency_key)) {
    return { ok: false, reason: 'parent_confirmation_wrong_idempotency_key' };
  }
  if (
    confirmation.provider_readiness_level &&
    !readinessAtLeast(parameters.provider_readiness_level as string | null, confirmation.provider_readiness_level)
  ) {
    return { ok: false, reason: 'provider_readiness_too_low' };
  }
  if (!confirmation.confirmed_at) return { ok: false, reason: 'parent_confirmation_not_confirmed' };
  if (!isFresh(confirmation.expires_at)) return { ok: false, reason: 'parent_confirmation_expired' };
  if (confirmation.consumed_at) return { ok: false, reason: 'parent_confirmation_already_consumed' };

  if (action === 'pay') {
    const amountCents = parameters.amount_cents;
    const maxTotalCents = parameters.max_total_cents;
    if (typeof amountCents !== 'number') return { ok: false, reason: 'payment_amount_missing' };
    if (typeof confirmation.amount_cents !== 'number') return { ok: false, reason: 'confirmation_amount_missing' };
    if (confirmation.amount_cents !== amountCents) return { ok: false, reason: 'payment_amount_mismatch' };
    if (typeof maxTotalCents === 'number' && amountCents > maxTotalCents) {
      return { ok: false, reason: 'payment_over_price_cap' };
    }
  }

  return { ok: true, confirmation };
}

async function verifyDelegationMandate(
  serviceSupabase: ReturnType<typeof createClient>,
  userId: string,
  action: string,
  parameters: Record<string, unknown>,
) {
  const mandateId = parameters.agent_delegation_mandate_id ?? parameters.mandate_id;
  if (typeof mandateId !== 'string') return { ok: false, reason: 'delegation_mandate_required' };

  const { data: mandate, error } = await serviceSupabase
    .from('agent_delegation_mandates')
    .select('*')
    .eq('id', mandateId)
    .single();

  if (error || !mandate) return { ok: false, reason: 'delegation_mandate_not_found' };
  if (mandate.user_id !== userId) return { ok: false, reason: 'delegation_mandate_wrong_user' };
  if (mandate.status !== 'active') return { ok: false, reason: 'delegation_mandate_not_active' };
  if (mandate.revoked_at) return { ok: false, reason: 'delegation_mandate_revoked' };
  if (!isFresh(mandate.expires_at)) return { ok: false, reason: 'delegation_mandate_expired' };
  if (!matchesConstraint(mandate.signup_intent_id, parameters.signup_intent_id)) {
    return { ok: false, reason: 'delegation_mandate_wrong_signup_intent' };
  }
  if (!matchesConstraint(mandate.autopilot_run_id, parameters.autopilot_run_id)) {
    return { ok: false, reason: 'delegation_mandate_wrong_autopilot_run' };
  }
  if (mandate.provider_key !== parameters.provider_key) return { ok: false, reason: 'delegation_mandate_wrong_provider' };
  if (mandate.target_program !== parameters.exact_program) return { ok: false, reason: 'delegation_mandate_wrong_program' };
  if (!readinessAtLeast(parameters.provider_readiness_level as string | null, mandate.provider_readiness_required)) {
    return { ok: false, reason: 'provider_readiness_too_low' };
  }

  const allowedActions = Array.isArray(mandate.allowed_actions)
    ? mandate.allowed_actions.filter((item: unknown): item is string => typeof item === 'string')
    : [];
  if (!allowedActions.includes(action)) return { ok: false, reason: 'action_not_in_delegation_mandate' };

  const amountCents = parameters.amount_cents;
  if (typeof amountCents === 'number' && amountCents > mandate.max_total_cents) {
    return { ok: false, reason: 'payment_over_price_cap' };
  }

  if (action === 'pay' && !readinessAtLeast(parameters.provider_readiness_level as string | null, 'delegated_signup_verified')) {
    return { ok: false, reason: 'delegated_payment_requires_verified_provider' };
  }

  if (
    ['pay', 'submit_final', 'delegate_signup'].includes(action) &&
    !providerAutomationPolicyAllowsLiveAction(parameters)
  ) {
    return { ok: false, reason: 'provider_automation_permission_required' };
  }

  return { ok: true, mandate };
}

async function consumeParentConfirmation(
  serviceSupabase: ReturnType<typeof createClient>,
  confirmation: { id?: string } | null | undefined,
) {
  if (!confirmation?.id) return { ok: false, reason: 'parent_confirmation_missing' };
  const { data, error } = await serviceSupabase
    .from('parent_action_confirmations')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', confirmation.id)
    .is('consumed_at', null)
    .select('id')
    .maybeSingle();

  if (error || !data) return { ok: false, reason: 'confirmation_consumed_failed' };
  return { ok: true };
}

async function handleSensitiveAction(
  req: Request,
  serviceSupabase: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
) {
  const action = body.action;
  if (typeof action !== 'string' || !sensitiveActions.has(action)) {
    return jsonResponse({ success: false, error: 'unsupported_sensitive_action' }, 400);
  }

  const user = await getAuthenticatedUser(req);
  const parameters = safeParameters(body.parameters);
  const planId = typeof body.plan_id === 'string' ? body.plan_id : null;

  if (planId) {
    const { data: plan, error: planError } = await serviceSupabase
      .from('plans')
      .select('id,user_id,status,program_ref,provider')
      .eq('id', planId)
      .single();

    if (planError || !plan) return jsonResponse({ success: false, error: 'plan_not_found' }, 404);
    if (plan.user_id !== user.id) return jsonResponse({ success: false, error: 'forbidden' }, 403);
  }

  await logGateAudit(serviceSupabase, user.id, action, 'before', parameters);

  if (parameters.authorization_source === 'model_output' || parameters.authorization_source === 'provider_page') {
    await logGateAudit(serviceSupabase, user.id, action, 'denied', parameters);
    return jsonResponse({
      success: false,
      status: reviewStateByAction[action] ?? 'paused_for_parent',
      error: `${parameters.authorization_source}_cannot_authorize_sensitive_action`,
    }, 403);
  }

  const confirmationGate = await verifyParentConfirmation(serviceSupabase, user.id, action, parameters);
  const mandateGate = confirmationGate.ok
    ? { ok: false, reason: 'parent_confirmation_already_valid' }
    : await verifyDelegationMandate(serviceSupabase, user.id, action, parameters);
  const gateOk = confirmationGate.ok || mandateGate.ok;

  if (!gateOk) {
    const reason = confirmationGate.reason === 'parent_confirmation_required'
      ? mandateGate.reason
      : confirmationGate.reason;
    await logGateAudit(serviceSupabase, user.id, action, 'denied', parameters);

    return jsonResponse({
      success: false,
      status: reviewStateByAction[action] ?? 'paused_for_parent',
      error: reason,
    }, 403);
  }

  if (confirmationGate.ok) {
    const consumeResult = await consumeParentConfirmation(serviceSupabase, confirmationGate.confirmation as { id?: string });
    if (!consumeResult.ok) {
      await logGateAudit(serviceSupabase, user.id, action, 'denied', parameters);
      return jsonResponse({
        success: false,
        status: reviewStateByAction[action] ?? 'paused_for_parent',
        error: consumeResult.reason,
      }, 409);
    }
  }

  if (action === 'pay') {
    await logGateAudit(serviceSupabase, user.id, action, 'paused', parameters);
    return jsonResponse({
      success: false,
      status: 'payment_review_required',
      error: 'automated_payment_disabled_until_verified_provider_payment_gate',
    }, 409);
  }

  if (action !== 'register') {
    await logGateAudit(serviceSupabase, user.id, action, 'paused', parameters);
    return jsonResponse({
      success: false,
      status: reviewStateByAction[action] ?? 'paused_for_parent',
      error: 'sensitive_action_paused_for_parent_review',
    }, 409);
  }

  await logGateAudit(serviceSupabase, user.id, action, 'approved', parameters);

  return jsonResponse({
    success: false,
    status: 'registration_review_required',
    error: 'registration_submit_paused_until_confirmed_provider_executor_is_available',
  }, 409);
}

// Forward to MCP executor for legacy plan preflights only.
async function executePlanViaMCP(planId: string, planExecutionId: string, mandateId: string, supabase: ReturnType<typeof createClient>) {
  console.log(`Forwarding plan ${planId} to MCP executor with execution ${planExecutionId}`);

  const mcpResult = await supabase.functions.invoke('mcp-executor', {
    body: {
      plan_id: planId,
      plan_execution_id: planExecutionId,
      mandate_id: mandateId,
    },
  });

  if (mcpResult.error) {
    throw new Error(`MCP execution failed: ${mcpResult.error.message}`);
  }

  return mcpResult.data;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const serviceSupabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  try {
    const body = await req.json() as Record<string, unknown>;

    if (typeof body.action === 'string') {
      return await handleSensitiveAction(req, serviceSupabase, body);
    }

    const user = await getAuthenticatedUser(req);

    const planId = body.plan_id;
    if (typeof planId !== 'string') {
      throw new Error('plan_id is required');
    }

    console.log(`Starting legacy plan preflight for plan ${planId}`);

    const { data: plan, error: planError } = await serviceSupabase
      .from('plans')
      .select(`
        id,
        user_id,
        child_id,
        program_ref,
        provider,
        mandate_id,
        status
      `)
      .eq('id', planId)
      .single();

    if (planError || !plan) {
      throw new Error('Plan not found');
    }

    if (plan.user_id !== user.id) {
      return jsonResponse({ success: false, error: 'forbidden' }, 403);
    }

    if (plan.status !== 'running') {
      throw new Error(`Plan status is ${plan.status}, expected 'running'`);
    }

    const { data: planExecution, error: executionError } = await serviceSupabase
      .from('plan_executions')
      .insert({
        plan_id: plan.id,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (executionError) {
      throw new Error(`Failed to create plan execution: ${executionError.message}`);
    }

    console.log(`Plan execution created: ${planExecution.id}`);

    try {
      const mcpResult = await executePlanViaMCP(plan.id, planExecution.id, plan.mandate_id, serviceSupabase);

      await serviceSupabase
        .from('plans')
        .update({ status: 'paused_for_parent' })
        .eq('id', plan.id);

      return jsonResponse({
        ...mcpResult,
        success: false,
        status: 'paused_for_parent',
        error: 'legacy_plan_paused_before_sensitive_actions',
        plan_execution_id: planExecution.id,
      });
    } catch (error) {
      console.error('Plan execution failed:', error);

      await serviceSupabase
        .from('plans')
        .update({ status: 'failed' })
        .eq('id', plan.id);

      await serviceSupabase
        .from('plan_executions')
        .update({
          finished_at: new Date().toISOString(),
          result: 'failed',
        })
        .eq('id', planExecution.id);

      return jsonResponse({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        plan_execution_id: planExecution.id,
      }, 500);
    }
  } catch (error) {
    console.error('Error in run-plan function:', error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});
