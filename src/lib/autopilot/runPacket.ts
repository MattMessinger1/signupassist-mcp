import type { ProviderPlaybook } from "./playbooks";

export const SUPERVISED_AUTOPILOT_SUCCESS_FEE_CENTS = 0;
export const FUTURE_SET_AND_FORGET_SUCCESS_FEE_CENTS = 2000;

export const SUPERVISED_AUTOPILOT_BILLING_COPY = {
  membership: "SignupAssist membership is $9/month.",
  providerFee: "Program fees are paid directly to the provider.",
  noSuccessFee: "No success fee is charged for supervised autopilot.",
  futureSuccessFee:
    "Success fees may apply later for fully automated Set and Forget registrations.",
};

export type PreflightCheckKey =
  | "providerAccountReady"
  | "childProfileReady"
  | "paymentPrepared"
  | "helperInstalled"
  | "targetUrlConfirmed";

export type PreflightState = Record<PreflightCheckKey, boolean>;

export const PREFLIGHT_CHECKS: Array<{
  key: PreflightCheckKey;
  label: string;
  description: string;
}> = [
  {
    key: "providerAccountReady",
    label: "Provider login works",
    description: "The parent can sign into the provider account before registration opens.",
  },
  {
    key: "childProfileReady",
    label: "Child profile is ready",
    description: "The provider account already has the child or participant details available.",
  },
  {
    key: "paymentPrepared",
    label: "Provider payment is prepared",
    description: "Saved provider payment, browser autofill, wallet, or card is ready for checkout.",
  },
  {
    key: "helperInstalled",
    label: "Chrome helper is installed",
    description: "The desktop helper is available in the parent browser.",
  },
  {
    key: "targetUrlConfirmed",
    label: "Signup URL is confirmed",
    description: "The target page is the real registration flow, not a marketing or search page.",
  },
];

export const DEFAULT_PREFLIGHT_STATE: PreflightState = {
  providerAccountReady: false,
  childProfileReady: false,
  paymentPrepared: false,
  helperInstalled: false,
  targetUrlConfirmed: false,
};

export interface AutopilotRunPacketInput {
  playbook: ProviderPlaybook;
  targetUrl: string;
  targetProgram?: string | null;
  registrationOpensAt?: string | null;
  maxTotalCents?: number | null;
  participantAgeYears?: number | null;
  finder?: {
    query?: string | null;
    status?: string | null;
    venue?: string | null;
    address?: string | null;
    location?: string | null;
  } | null;
  reminder?: {
    minutesBefore: number;
    channels: string[];
    phoneNumber?: string | null;
  } | null;
  child?: {
    id: string;
    name: string;
  } | null;
  preflight: PreflightState;
}

export interface AutopilotRunPacket {
  version: 1;
  mode: "supervised_autopilot";
  billing: {
    subscription: "$9/month";
    successFeeCents: 0;
    futureSetAndForgetSuccessFeeCents: 2000;
    policy: string[];
  };
  payment: {
    providerFeeHandling: "provider_direct";
    helperPausesAtCheckout: true;
    instructions: string;
  };
  target: {
    providerKey: string;
    providerName: string;
    confidence: ProviderPlaybook["confidence"];
    url: string;
    program: string | null;
    registrationOpensAt: string | null;
    maxTotalCents: number | null;
    participantAgeYears: number | null;
    child: AutopilotRunPacketInput["child"];
  };
  reminder: {
    minutesBefore: number;
    channels: string[];
    phoneNumber: string | null;
  };
  finder: NonNullable<AutopilotRunPacketInput["finder"]> | null;
  safety: {
    allowedActions: string[];
    stopConditions: string[];
  };
  readiness: {
    score: number;
    checks: PreflightState;
    completed: string[];
    missing: string[];
  };
  setAndForgetFoundation: {
    capturesAuditTrail: true;
    capturesPauseReasons: true;
    capturesPriceCaps: true;
    finalSubmitRequiresParentApproval: true;
  };
}

export function buildPreflightState(overrides: Partial<PreflightState> = {}): PreflightState {
  return {
    ...DEFAULT_PREFLIGHT_STATE,
    ...overrides,
  };
}

export function calculateReadinessScore(preflight: PreflightState) {
  const completed = PREFLIGHT_CHECKS.filter((check) => preflight[check.key]).length;
  return Math.round((completed / PREFLIGHT_CHECKS.length) * 100);
}

export function getPreflightLabels(preflight: PreflightState) {
  const completed: string[] = [];
  const missing: string[] = [];

  PREFLIGHT_CHECKS.forEach((check) => {
    if (preflight[check.key]) {
      completed.push(check.label);
    } else {
      missing.push(check.label);
    }
  });

  return { completed, missing };
}

export function buildAutopilotRunPacket({
  playbook,
  targetUrl,
  targetProgram = null,
  registrationOpensAt = null,
  maxTotalCents = null,
  participantAgeYears = null,
  finder = null,
  reminder = null,
  child = null,
  preflight,
}: AutopilotRunPacketInput): AutopilotRunPacket {
  const readiness = getPreflightLabels(preflight);

  return {
    version: 1,
    mode: "supervised_autopilot",
    billing: {
      subscription: "$9/month",
      successFeeCents: SUPERVISED_AUTOPILOT_SUCCESS_FEE_CENTS,
      futureSetAndForgetSuccessFeeCents: FUTURE_SET_AND_FORGET_SUCCESS_FEE_CENTS,
      policy: [
        SUPERVISED_AUTOPILOT_BILLING_COPY.membership,
        SUPERVISED_AUTOPILOT_BILLING_COPY.providerFee,
        SUPERVISED_AUTOPILOT_BILLING_COPY.noSuccessFee,
        SUPERVISED_AUTOPILOT_BILLING_COPY.futureSuccessFee,
      ],
    },
    payment: {
      providerFeeHandling: "provider_direct",
      helperPausesAtCheckout: true,
      instructions:
        "The parent pays provider program fees on the provider site. SignupAssist pauses at checkout, payment confirmation, and final submit.",
    },
    target: {
      providerKey: playbook.key,
      providerName: playbook.name,
      confidence: playbook.confidence,
      url: targetUrl,
      program: targetProgram || null,
      registrationOpensAt: registrationOpensAt || null,
      maxTotalCents: typeof maxTotalCents === "number" ? maxTotalCents : null,
      participantAgeYears: typeof participantAgeYears === "number" ? participantAgeYears : null,
      child,
    },
    reminder: {
      minutesBefore: reminder?.minutesBefore || 10,
      channels: reminder?.channels?.length ? reminder.channels : ["email"],
      phoneNumber: reminder?.phoneNumber || null,
    },
    finder: finder || null,
    safety: {
      allowedActions: playbook.allowedActions,
      stopConditions: playbook.stopConditions,
    },
    readiness: {
      score: calculateReadinessScore(preflight),
      checks: preflight,
      completed: readiness.completed,
      missing: readiness.missing,
    },
    setAndForgetFoundation: {
      capturesAuditTrail: true,
      capturesPauseReasons: true,
      capturesPriceCaps: true,
      finalSubmitRequiresParentApproval: true,
    },
  };
}
