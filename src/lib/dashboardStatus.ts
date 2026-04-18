export const RUN_STATUS_LABELS = [
  "draft",
  "ready",
  "scheduled",
  "waiting_for_registration_open",
  "running",
  "paused_for_parent",
  "registration_review_required",
  "registration_submitted",
  "payment_review_required",
  "payment_paused",
  "waiver_review_required",
  "final_submit_review_required",
  "provider_learning",
  "completed",
  "manual_fallback",
  "failed",
  "cancelled",
] as const;

export type RunStatusLabel = (typeof RUN_STATUS_LABELS)[number];

const STATUS_LABEL_COPY: Record<RunStatusLabel, string> = {
  draft: "Draft",
  ready: "Ready",
  scheduled: "Scheduled",
  waiting_for_registration_open: "Waiting for registration open",
  running: "Running",
  paused_for_parent: "Paused for parent",
  registration_review_required: "Registration review required",
  registration_submitted: "Registration submitted",
  payment_review_required: "Payment review required",
  payment_paused: "Payment paused",
  waiver_review_required: "Waiver review required",
  final_submit_review_required: "Final submit review required",
  provider_learning: "Provider learning",
  completed: "Completed",
  manual_fallback: "Manual fallback",
  failed: "Failed",
  cancelled: "Cancelled",
};

const PAUSED_STATUS_MAP: Record<string, RunStatusLabel> = {
  paused: "paused_for_parent",
  paused_for_parent: "paused_for_parent",
  registration_review_required: "registration_review_required",
  payment_review_required: "payment_review_required",
  payment_paused: "payment_paused",
  waiver_review_required: "waiver_review_required",
  final_submit_review_required: "final_submit_review_required",
};

export function normalizeRunStatus(status?: string | null): RunStatusLabel {
  const normalized = (status || "draft").trim().toLowerCase();

  if (normalized in PAUSED_STATUS_MAP) {
    return PAUSED_STATUS_MAP[normalized];
  }

  if ((RUN_STATUS_LABELS as readonly string[]).includes(normalized)) {
    return normalized as RunStatusLabel;
  }

  if (normalized === "ready_for_autopilot") return "ready";
  if (normalized === "submitted") return "registration_submitted";
  if (normalized === "manual") return "manual_fallback";

  return "draft";
}

export function runStatusLabel(status?: string | null) {
  return STATUS_LABEL_COPY[normalizeRunStatus(status)];
}

export function runStatusTone(status?: string | null): "default" | "secondary" | "destructive" | "outline" {
  const normalized = normalizeRunStatus(status);
  if (normalized === "completed" || normalized === "registration_submitted") return "default";
  if (normalized === "failed" || normalized === "manual_fallback" || normalized === "cancelled") return "destructive";
  if (
    normalized === "paused_for_parent" ||
    normalized === "registration_review_required" ||
    normalized === "payment_review_required" ||
    normalized === "payment_paused" ||
    normalized === "waiver_review_required" ||
    normalized === "final_submit_review_required"
  ) {
    return "secondary";
  }
  return "outline";
}

export function isPausedStatus(status?: string | null) {
  const normalized = normalizeRunStatus(status);
  return [
    "paused_for_parent",
    "registration_review_required",
    "payment_review_required",
    "payment_paused",
    "waiver_review_required",
    "final_submit_review_required",
  ].includes(normalized);
}

export function isFailedOrFallbackStatus(status?: string | null) {
  return ["failed", "manual_fallback", "cancelled"].includes(normalizeRunStatus(status));
}

export function isCompleteStatus(status?: string | null) {
  return ["completed", "registration_submitted"].includes(normalizeRunStatus(status));
}

export function redactAuditText(value?: string | null) {
  if (!value) return "";

  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email redacted]")
    .replace(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "[phone redacted]")
    .replace(/\b\d{13,19}\b/g, "[payment redacted]")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "[date redacted]")
    .replace(
      /\b\d{1,6}\s+[A-Za-z0-9 .'-]+(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Court|Ct|Boulevard|Blvd|Way)\b/gi,
      "[address redacted]",
    )
    .replace(/\b(?:password|token|secret|session|cookie|bearer)\s*[:=]\s*[^\s,;]+/gi, "[credential redacted]")
    .replace(/\b(?:cvv|cvc|card number|card_number|payment card)\s*[:=]?\s*[^\s,;]+/gi, "[payment redacted]")
    .replace(/\b(?:medical notes?|allergy notes?|allergies|diagnosis|insurance policy)\b[^.;\n]*/gi, "[sensitive health detail redacted]");
}

function humanizeToken(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readAuditType(event: unknown) {
  if (typeof event !== "object" || event === null || Array.isArray(event)) return "audit_event";
  const record = event as Record<string, unknown>;
  return typeof record.type === "string"
    ? record.type
    : typeof record.event_type === "string"
      ? record.event_type
      : "audit_event";
}

export function summarizeAuditEvent(event: unknown) {
  const summary = humanizeToken(readAuditType(event));
  return redactAuditText(summary) || "Audit event recorded";
}

export function summarizeAuditEvents(events: unknown, limit = 3) {
  if (!Array.isArray(events)) return [];

  return events
    .slice(-limit)
    .reverse()
    .map((event) => summarizeAuditEvent(event));
}
