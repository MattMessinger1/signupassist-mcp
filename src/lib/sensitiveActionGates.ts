import {
  PROVIDER_READINESS_LEVELS,
  type ProviderReadinessLevel,
} from "./providerLearning";

export const SENSITIVE_ACTION_STATES = [
  "packet_prepared",
  "awaiting_parent_review",
  "registration_review_required",
  "registration_approved",
  "registration_submitted",
  "payment_review_required",
  "payment_approved",
  "payment_submitted",
  "waiver_review_required",
  "waiver_approved",
  "provider_login_required",
  "provider_login_approved",
  "final_submit_review_required",
  "final_submit_approved",
  "paused_for_parent",
  "delegated_signup_ready",
  "delegated_signup_running",
  "completed",
  "manual_fallback",
  "failed",
  "cancelled",
] as const;

export type SensitiveActionState = (typeof SENSITIVE_ACTION_STATES)[number];

export const SENSITIVE_ACTION_TYPES = [
  "register",
  "pay",
  "provider_login",
  "accept_waiver",
  "submit_final",
  "delegate_signup",
] as const;

export type SensitiveActionType = (typeof SENSITIVE_ACTION_TYPES)[number];

export type SensitiveActionResultStatus =
  | "requires_parent_confirmation"
  | "registration_submitted"
  | "payment_review_required"
  | "payment_submitted"
  | "delegated_signup_ready"
  | "manual_fallback"
  | "failed";

export type AuthorizationSource =
  | "parent_confirmation"
  | "delegation_mandate"
  | "model_output"
  | "provider_page"
  | "none";

export interface ParentActionConfirmationSnapshot {
  id: string;
  user_id: string;
  signup_intent_id?: string | null;
  autopilot_run_id?: string | null;
  mandate_id?: string | null;
  action_type: SensitiveActionType;
  action_summary?: unknown;
  amount_cents?: number | null;
  provider_key?: string | null;
  provider_readiness_level?: string | null;
  target_url?: string | null;
  exact_program?: string | null;
  expires_at: string;
  confirmed_at?: string | null;
  consumed_at?: string | null;
  idempotency_key: string;
}

export interface AgentDelegationMandateSnapshot {
  id: string;
  user_id: string;
  signup_intent_id?: string | null;
  autopilot_run_id?: string | null;
  child_id?: string | null;
  provider_key: string;
  provider_readiness_required: ProviderReadinessLevel | string;
  target_program: string;
  max_total_cents: number;
  allowed_actions: unknown;
  stop_conditions?: unknown;
  expires_at: string;
  revoked_at?: string | null;
  status: string;
}

export interface SensitiveActionGateRequest {
  userId: string;
  actionType: SensitiveActionType;
  signupIntentId?: string | null;
  autopilotRunId?: string | null;
  mandateId?: string | null;
  providerKey?: string | null;
  providerReadinessLevel?: ProviderReadinessLevel | string | null;
  targetUrl?: string | null;
  exactProgram?: string | null;
  amountCents?: number | null;
  maxTotalCents?: number | null;
  idempotencyKey?: string | null;
  authorizationSource?: AuthorizationSource;
  now?: Date;
}

export interface SensitiveActionGateContext {
  confirmations?: ParentActionConfirmationSnapshot[];
  mandates?: AgentDelegationMandateSnapshot[];
}

export interface SensitiveActionGateResult {
  allowed: boolean;
  status: SensitiveActionResultStatus;
  state: SensitiveActionState;
  reason: string;
  confirmationId?: string;
  mandateId?: string;
  idempotent?: boolean;
  auditEvent: {
    action_type: SensitiveActionType;
    decision: "approved" | "denied" | "idempotent_replay";
    reason: string;
  };
}

const ACTION_REVIEW_STATE: Record<SensitiveActionType, SensitiveActionState> = {
  register: "registration_review_required",
  pay: "payment_review_required",
  provider_login: "provider_login_required",
  accept_waiver: "waiver_review_required",
  submit_final: "final_submit_review_required",
  delegate_signup: "awaiting_parent_review",
};

const ACTION_APPROVED_STATE: Record<SensitiveActionType, SensitiveActionState> = {
  register: "registration_approved",
  pay: "payment_approved",
  provider_login: "provider_login_approved",
  accept_waiver: "waiver_approved",
  submit_final: "final_submit_approved",
  delegate_signup: "delegated_signup_ready",
};

const SENSITIVE_KEY_PATTERN =
  /(child|participant|first.?name|last.?name|full.?name|dob|birth|age|grade|email|phone|address|credential|password|token|secret|session|cookie|auth|payment|card|cvv|cvc|medical|allerg|insurance|doctor|waiver|signature|ssn|social)/i;

const SENSITIVE_VALUE_PATTERN =
  /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})|(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})|(\d{13,19})/i;

function readinessRank(level?: ProviderReadinessLevel | string | null) {
  if (!level) return -1;
  return PROVIDER_READINESS_LEVELS.indexOf(level as ProviderReadinessLevel);
}

export function isProviderReadinessAtLeast(
  actual: ProviderReadinessLevel | string | null | undefined,
  required: ProviderReadinessLevel | string,
) {
  const actualRank = readinessRank(actual);
  const requiredRank = readinessRank(required);
  return actualRank >= 0 && requiredRank >= 0 && actualRank >= requiredRank;
}

function reviewStatusForAction(actionType: SensitiveActionType): SensitiveActionResultStatus {
  if (actionType === "pay") return "payment_review_required";
  return "requires_parent_confirmation";
}

function approvedStatusForAction(actionType: SensitiveActionType): SensitiveActionResultStatus {
  if (actionType === "pay") return "payment_submitted";
  if (actionType === "delegate_signup") return "delegated_signup_ready";
  return "registration_submitted";
}

function result(
  request: SensitiveActionGateRequest,
  allowed: boolean,
  status: SensitiveActionResultStatus,
  state: SensitiveActionState,
  reason: string,
  extras: Partial<Pick<SensitiveActionGateResult, "confirmationId" | "mandateId" | "idempotent">> = {},
): SensitiveActionGateResult {
  return {
    allowed,
    status,
    state,
    reason,
    ...extras,
    auditEvent: {
      action_type: request.actionType,
      decision: extras.idempotent ? "idempotent_replay" : allowed ? "approved" : "denied",
      reason,
    },
  };
}

function matchesOptional(expected?: string | null, actual?: string | null) {
  return !expected || expected === actual;
}

function isFresh(timestamp: string, now: Date) {
  return new Date(timestamp).getTime() > now.getTime();
}

function confirmationMatches(
  confirmation: ParentActionConfirmationSnapshot,
  request: SensitiveActionGateRequest,
) {
  if (confirmation.user_id !== request.userId) return "wrong_user";
  if (confirmation.action_type !== request.actionType) return "wrong_action";
  if (!matchesOptional(confirmation.signup_intent_id, request.signupIntentId)) return "wrong_signup_intent";
  if (!matchesOptional(confirmation.autopilot_run_id, request.autopilotRunId)) return "wrong_autopilot_run";
  if (!matchesOptional(confirmation.mandate_id, request.mandateId)) return "wrong_mandate";
  if (!matchesOptional(confirmation.provider_key, request.providerKey)) return "wrong_provider";
  if (!matchesOptional(confirmation.target_url, request.targetUrl)) return "wrong_target_url";
  if (!matchesOptional(confirmation.exact_program, request.exactProgram)) return "wrong_program";

  if (request.actionType === "pay") {
    if (typeof request.amountCents !== "number") return "payment_amount_missing";
    if (typeof confirmation.amount_cents !== "number") return "confirmation_amount_missing";
    if (confirmation.amount_cents !== request.amountCents) return "payment_amount_mismatch";
    if (request.maxTotalCents !== null && request.maxTotalCents !== undefined && request.amountCents > request.maxTotalCents) {
      return "payment_over_price_cap";
    }
  }

  if (
    confirmation.provider_readiness_level &&
    request.providerReadinessLevel &&
    !isProviderReadinessAtLeast(request.providerReadinessLevel, confirmation.provider_readiness_level)
  ) {
    return "provider_readiness_too_low";
  }

  return null;
}

function mandateAllowedActions(mandate: AgentDelegationMandateSnapshot) {
  return Array.isArray(mandate.allowed_actions)
    ? mandate.allowed_actions.filter((action): action is string => typeof action === "string")
    : [];
}

function mandateMatches(
  mandate: AgentDelegationMandateSnapshot,
  request: SensitiveActionGateRequest,
  now: Date,
) {
  if (mandate.user_id !== request.userId) return "wrong_user";
  if (mandate.status !== "active") return "mandate_not_active";
  if (mandate.revoked_at) return "mandate_revoked";
  if (!isFresh(mandate.expires_at, now)) return "mandate_expired";
  if (!matchesOptional(mandate.signup_intent_id, request.signupIntentId)) return "wrong_signup_intent";
  if (!matchesOptional(mandate.autopilot_run_id, request.autopilotRunId)) return "wrong_autopilot_run";
  if (mandate.provider_key !== request.providerKey) return "wrong_provider";
  if (mandate.target_program !== request.exactProgram) return "wrong_program";
  if (!mandateAllowedActions(mandate).includes(request.actionType)) return "action_not_in_mandate";
  if (!isProviderReadinessAtLeast(request.providerReadinessLevel, mandate.provider_readiness_required)) {
    return "provider_readiness_too_low";
  }

  if (request.amountCents !== null && request.amountCents !== undefined) {
    if (request.amountCents > mandate.max_total_cents) return "payment_over_price_cap";
    if (request.maxTotalCents !== null && request.maxTotalCents !== undefined && request.amountCents > request.maxTotalCents) {
      return "payment_over_run_cap";
    }
  }

  if (
    request.actionType === "pay" &&
    !isProviderReadinessAtLeast(request.providerReadinessLevel, "delegated_signup_verified")
  ) {
    return "delegated_payment_requires_verified_provider";
  }

  if (
    (request.actionType === "delegate_signup" || request.actionType === "submit_final") &&
    !isProviderReadinessAtLeast(request.providerReadinessLevel, "delegated_signup_candidate")
  ) {
    return "delegated_signup_requires_verified_provider";
  }

  return null;
}

export function validateSensitiveActionGate(
  request: SensitiveActionGateRequest,
  context: SensitiveActionGateContext = {},
): SensitiveActionGateResult {
  const now = request.now ?? new Date();

  if (request.authorizationSource === "model_output" || request.authorizationSource === "provider_page") {
    return result(
      request,
      false,
      reviewStatusForAction(request.actionType),
      ACTION_REVIEW_STATE[request.actionType],
      `${request.authorizationSource}_cannot_authorize_sensitive_action`,
    );
  }

  if (request.actionType === "pay") {
    if (typeof request.amountCents !== "number") {
      return result(request, false, "payment_review_required", "payment_review_required", "payment_amount_missing");
    }

    if (request.maxTotalCents !== null && request.maxTotalCents !== undefined && request.amountCents > request.maxTotalCents) {
      return result(request, false, "payment_review_required", "payment_review_required", "payment_over_price_cap");
    }
  }

  const duplicateConfirmation = context.confirmations?.find(
    (confirmation) =>
      confirmation.user_id === request.userId &&
      confirmation.action_type === request.actionType &&
      confirmation.idempotency_key === request.idempotencyKey &&
      Boolean(confirmation.consumed_at),
  );

  if (duplicateConfirmation && request.actionType === "pay") {
    return result(
      request,
      false,
      "payment_submitted",
      "payment_submitted",
      "duplicate_payment_request_idempotently_replayed",
      { confirmationId: duplicateConfirmation.id, idempotent: true },
    );
  }

  const matchingConfirmation = context.confirmations?.find((confirmation) => {
    const mismatch = confirmationMatches(confirmation, request);
    return mismatch === null;
  });

  if (matchingConfirmation) {
    if (!matchingConfirmation.confirmed_at) {
      return result(
        request,
        false,
        reviewStatusForAction(request.actionType),
        ACTION_REVIEW_STATE[request.actionType],
        "parent_confirmation_not_confirmed",
      );
    }

    if (!isFresh(matchingConfirmation.expires_at, now)) {
      return result(
        request,
        false,
        reviewStatusForAction(request.actionType),
        ACTION_REVIEW_STATE[request.actionType],
        "parent_confirmation_expired",
      );
    }

    if (matchingConfirmation.consumed_at) {
      return result(
        request,
        false,
        reviewStatusForAction(request.actionType),
        ACTION_REVIEW_STATE[request.actionType],
        "parent_confirmation_already_consumed",
      );
    }

    return result(
      request,
      true,
      approvedStatusForAction(request.actionType),
      ACTION_APPROVED_STATE[request.actionType],
      "parent_confirmation_valid",
      { confirmationId: matchingConfirmation.id },
    );
  }

  const activeMandate = context.mandates?.find((mandate) => mandateMatches(mandate, request, now) === null);

  if (activeMandate) {
    return result(
      request,
      true,
      request.actionType === "delegate_signup" ? "delegated_signup_ready" : approvedStatusForAction(request.actionType),
      request.actionType === "delegate_signup" ? "delegated_signup_ready" : ACTION_APPROVED_STATE[request.actionType],
      "delegation_mandate_valid",
      { mandateId: activeMandate.id },
    );
  }

  return result(
    request,
    false,
    reviewStatusForAction(request.actionType),
    ACTION_REVIEW_STATE[request.actionType],
    "parent_confirmation_or_valid_mandate_required",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function redactSensitiveAuditPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveAuditPayload(item));
  }

  if (!isRecord(value)) {
    if (typeof value === "string" && SENSITIVE_VALUE_PATTERN.test(value)) return "[redacted]";
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) return [key, "[redacted]"];
      return [key, redactSensitiveAuditPayload(child)];
    }),
  );
}
