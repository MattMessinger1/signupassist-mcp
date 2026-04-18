import {
  DEFAULT_ALLOWED_ACTIONS,
  DEFAULT_STOP_CONDITIONS,
  PROVIDER_PLAYBOOKS,
  findPlaybookByKey,
  type ProviderPlaybook,
} from "./autopilot/playbooks";

export const PROVIDER_READINESS_LEVELS = [
  "unknown",
  "recognized",
  "fill_safe",
  "navigation_verified",
  "registration_submit_verified",
  "checkout_handoff_verified",
  "delegated_signup_candidate",
  "delegated_signup_verified",
] as const;

export type ProviderReadinessLevel = (typeof PROVIDER_READINESS_LEVELS)[number];

export const SET_AND_FORGET_LADDER = [
  "Today: supervised run packet",
  "Next: verified provider fill/navigation",
  "Later: signed-mandate delegated signup for verified providers only",
];

export interface ProviderFixtureCoverage {
  paths: string[];
  count: number;
  hasCoverage: boolean;
  coverageLabel: string;
}

export interface ProviderPromotionPolicy {
  automaticPromotionAllowed: false;
  requiresFixtures: true;
  requiresProviderSpecificTests: true;
  requiresAdminReview: true;
  modelOutputCanPromote: false;
  providerPageContentCanPromote: false;
}

export interface ProviderReadinessSummary {
  key: string;
  name: string;
  domains: string[];
  readinessLevel: ProviderReadinessLevel;
  confidence: ProviderPlaybook["confidence"] | "unknown";
  confidenceScore: number;
  activePlaybookVersion: string;
  supportedActions: string[];
  stopConditions: string[];
  fixtureCoverage: ProviderFixtureCoverage;
  promotionStatus: "not_requested" | "needs_fixture_review" | "review_required";
  promotionPolicy: ProviderPromotionPolicy;
}

export interface ProviderRegistryEntry extends ProviderReadinessSummary {
  aliases: string[];
  source: "playbook";
}

export interface AutopilotRunLearningSource {
  id?: string | null;
  provider_key?: string | null;
  provider_name?: string | null;
  target_url?: string | null;
  target_program?: string | null;
  status?: string | null;
  confidence?: string | null;
  caps?: unknown;
  allowed_actions?: unknown;
  stop_conditions?: unknown;
  audit_events?: unknown;
  created_at?: string | null;
}

export interface RedactedProviderObservation {
  version: 1;
  provider_key: string;
  provider_name: string;
  readiness_level: ProviderReadinessLevel;
  confidence: number;
  target_domain: string | null;
  source_run_signature: string | null;
  program_signature: string | null;
  steps_attempted: string[];
  stop_condition: string | null;
  non_pii_field_signatures: string[];
  outcome: string;
  fixture_coverage: ProviderFixtureCoverage;
  redaction: {
    child_pii: "excluded";
    credentials: "excluded";
    tokens: "excluded";
    payment_data: "excluded";
    medical_or_allergy_notes: "excluded";
    raw_provider_page_content: "excluded";
  };
  promotion: {
    automatic: false;
    requires_fixtures_tests_and_admin_review: true;
  };
  created_at: string | null;
}

export interface DiscoveryRunPayloadFromObservation {
  p_provider: string;
  p_program: string;
  p_fingerprint: string;
  p_stage: "program";
  p_errors: Array<{ code: string }>;
  p_meta: {
    source: "supervised_autopilot_redacted_observation";
    observation_version: 1;
    hints: {
      readiness_level: ProviderReadinessLevel;
      steps_attempted: string[];
      stop_condition: string | null;
      non_pii_field_signatures: string[];
      outcome: string;
      fixture_coverage: ProviderFixtureCoverage;
      promotion_requires_admin_review: true;
    };
    redaction: RedactedProviderObservation["redaction"];
  };
  p_run_conf: number;
  p_run_id: string | null;
}

const PROMOTION_POLICY: ProviderPromotionPolicy = {
  automaticPromotionAllowed: false,
  requiresFixtures: true,
  requiresProviderSpecificTests: true,
  requiresAdminReview: true,
  modelOutputCanPromote: false,
  providerPageContentCanPromote: false,
};

const READINESS_CONFIDENCE: Record<ProviderReadinessLevel, number> = {
  unknown: 0,
  recognized: 0.35,
  fill_safe: 0.55,
  navigation_verified: 0.7,
  registration_submit_verified: 0.8,
  checkout_handoff_verified: 0.85,
  delegated_signup_candidate: 0.9,
  delegated_signup_verified: 0.95,
};

const SENSITIVE_KEY_PATTERN =
  /(child|participant|first.?name|last.?name|full.?name|dob|birth|age|grade|email|phone|address|credential|password|token|secret|session|cookie|auth|payment|card|cvv|cvc|medical|allerg|insurance|doctor|waiver|signature|ssn|social)/i;

const SENSITIVE_VALUE_PATTERN =
  /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})|(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})|(\d{13,19})/i;

function fixturePathsForPlaybook(playbook: ProviderPlaybook) {
  const paths = new Set<string>();
  if (playbook.fixturePath) paths.add(playbook.fixturePath);
  playbook.fixturePaths?.forEach((path) => paths.add(path));
  return [...paths].sort();
}

export function getProviderFixtureCoverage(playbook: ProviderPlaybook): ProviderFixtureCoverage {
  const paths = fixturePathsForPlaybook(playbook);
  return {
    paths,
    count: paths.length,
    hasCoverage: paths.length > 0,
    coverageLabel: paths.length === 0 ? "No fixtures mapped yet" : `${paths.length} fixture${paths.length === 1 ? "" : "s"} mapped`,
  };
}

function readinessLevelForPlaybook(playbook: ProviderPlaybook, isKnown: boolean): ProviderReadinessLevel {
  if (!isKnown) return "unknown";
  if (playbook.key === "generic") return "recognized";
  if (playbook.confidence === "beta") return "fill_safe";
  if (getProviderFixtureCoverage(playbook).hasCoverage) return "navigation_verified";
  return "fill_safe";
}

function activePlaybookVersion(playbook: ProviderPlaybook) {
  const fixtureSignature = fixturePathsForPlaybook(playbook)
    .map((path) => path.replace(/^chrome-helper\/fixtures\//, ""))
    .join("+");
  return `playbook:${playbook.key}:v1${fixtureSignature ? `:${stableHash(fixtureSignature)}` : ""}`;
}

function aliasesForPlaybook(playbook: ProviderPlaybook) {
  const aliases = new Set<string>([
    playbook.key,
    playbook.name,
    ...playbook.domains,
  ]);

  if (playbook.key === "active") aliases.add("activenet");
  if (playbook.key === "daysmart") aliases.add("dash");
  if (playbook.key === "civicrec-recdesk") {
    aliases.add("civicrec");
    aliases.add("recdesk");
  }

  return [...aliases].sort();
}

export function getProviderReadinessSummary(providerKey?: string | null): ProviderReadinessSummary {
  const isKnown = Boolean(providerKey && PROVIDER_PLAYBOOKS.some((playbook) => playbook.key === providerKey));
  const playbook = isKnown ? findPlaybookByKey(providerKey!) : findPlaybookByKey("generic");
  const readinessLevel = readinessLevelForPlaybook(playbook, isKnown);
  const fixtureCoverage = getProviderFixtureCoverage(playbook);

  return {
    key: isKnown ? playbook.key : "unknown",
    name: isKnown ? playbook.name : "Unknown provider",
    domains: isKnown ? playbook.domains : [],
    readinessLevel,
    confidence: isKnown ? playbook.confidence : "unknown",
    confidenceScore: READINESS_CONFIDENCE[readinessLevel],
    activePlaybookVersion: isKnown ? activePlaybookVersion(playbook) : "unmapped",
    supportedActions: isKnown ? playbook.allowedActions : DEFAULT_ALLOWED_ACTIONS,
    stopConditions: isKnown ? playbook.stopConditions : DEFAULT_STOP_CONDITIONS,
    fixtureCoverage,
    promotionStatus: fixtureCoverage.hasCoverage ? "review_required" : "needs_fixture_review",
    promotionPolicy: PROMOTION_POLICY,
  };
}

export const PROVIDER_REGISTRY: ProviderRegistryEntry[] = PROVIDER_PLAYBOOKS.map((playbook) => ({
  ...getProviderReadinessSummary(playbook.key),
  aliases: aliasesForPlaybook(playbook),
  source: "playbook",
}));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `h${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function targetDomainFromUrl(urlValue?: string | null) {
  if (!urlValue) return null;
  try {
    return new URL(urlValue).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function normalizeSignaturePart(value: string) {
  return value
    .replace(/[^a-z0-9_:-]+/gi, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function safeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function auditEventTypes(auditEvents: unknown) {
  if (!Array.isArray(auditEvents)) return [];
  return auditEvents
    .map((event) => (isRecord(event) && typeof event.type === "string" ? event.type : null))
    .filter((eventType): eventType is string => Boolean(eventType))
    .map(normalizeSignaturePart)
    .filter(Boolean);
}

function collectFieldSignatures(value: unknown, prefix = "", output = new Set<string>()) {
  if (output.size >= 40) return output;

  if (Array.isArray(value)) {
    value.slice(0, 20).forEach((item, index) => collectFieldSignatures(item, `${prefix}[${index}]`, output));
    return output;
  }

  if (!isRecord(value)) return output;

  Object.entries(value).forEach(([key, child]) => {
    if (output.size >= 40) return;
    if (SENSITIVE_KEY_PATTERN.test(key)) return;

    const nextPrefix = prefix ? `${prefix}.${key}` : key;

    if (isRecord(child) || Array.isArray(child)) {
      collectFieldSignatures(child, nextPrefix, output);
      return;
    }

    if (typeof child === "string" && SENSITIVE_VALUE_PATTERN.test(child)) return;
    output.add(normalizeSignaturePart(nextPrefix));
  });

  return output;
}

function inferStopCondition(run: AutopilotRunLearningSource) {
  const caps = isRecord(run.caps) ? run.caps : {};
  const providerLearning = isRecord(caps.provider_learning) ? caps.provider_learning : {};
  if (typeof providerLearning.stop_condition === "string") {
    return normalizeSignaturePart(providerLearning.stop_condition);
  }

  const status = (run.status || "").toLowerCase();
  if (status === "paused") return "parent_review_required";
  if (status === "failed") return "run_failed";
  if (status === "cancelled") return "run_cancelled";

  return null;
}

function inferOutcome(run: AutopilotRunLearningSource) {
  const status = normalizeSignaturePart(run.status || "unknown");
  if (!status || status === "ready") return "supervised_packet_ready";
  return status;
}

export function buildRedactedProviderObservation(
  run: AutopilotRunLearningSource,
): RedactedProviderObservation {
  const summary = getProviderReadinessSummary(run.provider_key || "unknown");
  const stepsAttempted = auditEventTypes(run.audit_events);
  const allowedActionSignatures = safeStringArray(run.allowed_actions).map(
    (action) => `allowed_action:${stableHash(action)}`,
  );
  const stopConditionSignatures = safeStringArray(run.stop_conditions).map(
    (condition) => `stop_condition:${stableHash(condition)}`,
  );
  const capsSignatures = [...collectFieldSignatures(run.caps)].map(
    (signature) => `caps:${signature}`,
  );
  const fieldSignatures = [
    ...new Set([
      ...allowedActionSignatures,
      ...stopConditionSignatures,
      ...capsSignatures,
    ]),
  ].sort();
  const targetDomain = targetDomainFromUrl(run.target_url);

  return {
    version: 1,
    provider_key: summary.key,
    provider_name: summary.name,
    readiness_level: summary.readinessLevel,
    confidence: summary.confidenceScore,
    target_domain: targetDomain,
    source_run_signature: run.id ? stableHash(run.id) : null,
    program_signature: run.target_program ? stableHash(run.target_program) : null,
    steps_attempted: stepsAttempted,
    stop_condition: inferStopCondition(run),
    non_pii_field_signatures: fieldSignatures,
    outcome: inferOutcome(run),
    fixture_coverage: summary.fixtureCoverage,
    redaction: {
      child_pii: "excluded",
      credentials: "excluded",
      tokens: "excluded",
      payment_data: "excluded",
      medical_or_allergy_notes: "excluded",
      raw_provider_page_content: "excluded",
    },
    promotion: {
      automatic: false,
      requires_fixtures_tests_and_admin_review: true,
    },
    created_at: run.created_at || null,
  };
}

export function buildDiscoveryRunPayloadFromObservation(
  observation: RedactedProviderObservation,
): DiscoveryRunPayloadFromObservation {
  const fingerprint = stableHash(
    [
      observation.provider_key,
      observation.readiness_level,
      ...observation.non_pii_field_signatures,
      ...observation.steps_attempted,
    ].join("|"),
  );

  return {
    p_provider: observation.provider_key,
    p_program: observation.program_signature || "program_unset",
    p_fingerprint: fingerprint,
    p_stage: "program",
    p_errors: observation.stop_condition ? [{ code: observation.stop_condition }] : [],
    p_meta: {
      source: "supervised_autopilot_redacted_observation",
      observation_version: 1,
      hints: {
        readiness_level: observation.readiness_level,
        steps_attempted: observation.steps_attempted,
        stop_condition: observation.stop_condition,
        non_pii_field_signatures: observation.non_pii_field_signatures,
        outcome: observation.outcome,
        fixture_coverage: observation.fixture_coverage,
        promotion_requires_admin_review: true,
      },
      redaction: observation.redaction,
    },
    p_run_conf: observation.confidence,
    p_run_id: null,
  };
}
