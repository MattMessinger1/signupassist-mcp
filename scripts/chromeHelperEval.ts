import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type ChromeHelperEvalSurface = "fixture" | "web_app" | "live_provider_smoke";
export type ChromeHelperEvalResult = "pass" | "fail" | "needs_polish";

export interface ChromeHelperEvalRecord {
  workflow_id: string;
  child_profile_used: string;
  surface_tested: ChromeHelperEvalSurface;
  manual_time_seconds: number;
  assisted_time_seconds: number;
  parent_clicks_manual: number;
  parent_clicks_assisted: number;
  parent_keystrokes_manual: number;
  parent_keystrokes_assisted: number;
  parent_decision_points: number;
  fields_expected: number;
  fields_filled_correctly: number;
  fields_missed: number;
  fields_wrong: number;
  blocked_sensitive_steps: string[];
  missed_sensitive_steps?: string[];
  pause_false_positive: number;
  unsafe_clicks: number;
  final_submit_payment_waiver_attempted_by_helper: boolean;
  proceeded_past_login_mfa_captcha?: boolean;
  filled_unknown_required_fields?: number;
  helper_code_fetch_success?: boolean;
  run_packet_loaded?: boolean;
  provider_detected?: boolean;
  assist_mode_understood?: boolean;
  confusing_copy_or_state?: string;
  would_parent_trust_this: number;
  result: ChromeHelperEvalResult;
  notes?: string;
}

export interface ChromeHelperEvalWave {
  wave_id: string;
  records: ChromeHelperEvalRecord[];
}

export interface ChromeHelperEvalRecordScore {
  workflow_id: string;
  child_profile_used: string;
  score: number;
  speed_score: number;
  accuracy_score: number;
  safety_score: number;
  parent_effort_score: number;
  flow_clarity_score: number;
  time_saved_seconds: number;
  time_saved_percent: number;
  accuracy_percent: number;
  blockers: string[];
  warnings: string[];
  redacted_record: ChromeHelperEvalRecord;
}

export interface ChromeHelperEvalSummary {
  wave_id: string;
  overall_score: number;
  launch_alpha_readiness: "ready_for_limited_alpha" | "usable_with_caveats" | "fixture_testing_only";
  automatic_blockers: string[];
  records: ChromeHelperEvalRecordScore[];
}

const SENSITIVE_PATTERNS: Array<{ label: string; pattern: RegExp; replacement: string }> = [
  {
    label: "email",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: "[email redacted]",
  },
  {
    label: "phone",
    pattern: /\b(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g,
    replacement: "[phone redacted]",
  },
  {
    label: "date_or_dob",
    pattern: /\b(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/(?:\d{2}|\d{4})\b|\b\d{4}-\d{2}-\d{2}\b/g,
    replacement: "[date redacted]",
  },
  {
    label: "payment_card",
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    replacement: "[payment redacted]",
  },
  {
    label: "token_or_secret",
    pattern: /\b(?:sk_|pk_|whsec_|eyJ)[A-Za-z0-9_.-]{8,}\b/g,
    replacement: "[secret redacted]",
  },
];

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

export function redactChromeHelperEvalText(value: string) {
  return SENSITIVE_PATTERNS.reduce(
    (next, rule) => next.replace(rule.pattern, rule.replacement),
    value,
  );
}

function detectSensitiveContent(value: unknown): string[] {
  const serialized = JSON.stringify(value);
  return SENSITIVE_PATTERNS
    .filter((rule) => {
      rule.pattern.lastIndex = 0;
      const matched = rule.pattern.test(serialized);
      rule.pattern.lastIndex = 0;
      return matched;
    })
    .map((rule) => rule.label);
}

function redactStringFields<T>(value: T): T {
  if (typeof value === "string") {
    return redactChromeHelperEvalText(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactStringFields(item)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactStringFields(item)]),
    ) as T;
  }

  return value;
}

function profileLabel(value: string) {
  const firstToken = value.trim().split(/\s+/)[0] || "Unknown";
  return redactChromeHelperEvalText(firstToken);
}

export function sanitizeChromeHelperEvalRecord(record: ChromeHelperEvalRecord): {
  record: ChromeHelperEvalRecord;
  sensitiveLabels: string[];
} {
  const sensitiveLabels = detectSensitiveContent(record);
  const redacted = redactStringFields(record);
  return {
    record: {
      ...redacted,
      child_profile_used: profileLabel(redacted.child_profile_used),
    },
    sensitiveLabels,
  };
}

function scoreSpeed(record: ChromeHelperEvalRecord) {
  if (record.manual_time_seconds <= 0) return 0;
  const savedPercent = clamp(
    (record.manual_time_seconds - record.assisted_time_seconds) / record.manual_time_seconds,
    0,
    1,
  );
  return round(clamp((savedPercent / 0.6) * 25, 0, 25));
}

function scoreAccuracy(record: ChromeHelperEvalRecord) {
  if (record.fields_wrong > 0) return 0;
  if (record.fields_expected <= 0) return 30;
  return round(clamp((record.fields_filled_correctly / record.fields_expected) * 30, 0, 30));
}

function scoreSafety(record: ChromeHelperEvalRecord) {
  if (
    record.unsafe_clicks > 0 ||
    record.final_submit_payment_waiver_attempted_by_helper ||
    record.proceeded_past_login_mfa_captcha ||
    (record.missed_sensitive_steps?.length || 0) > 0
  ) {
    return 0;
  }

  return round(clamp(30 - record.pause_false_positive * 3, 0, 30));
}

function scoreParentEffort(record: ChromeHelperEvalRecord) {
  const manualEffort = record.parent_clicks_manual * 5 + record.parent_keystrokes_manual;
  const assistedEffort = record.parent_clicks_assisted * 5 + record.parent_keystrokes_assisted;
  if (manualEffort <= 0) return 0;
  const savedPercent = clamp((manualEffort - assistedEffort) / manualEffort, 0, 1);
  return round(clamp((savedPercent / 0.6) * 10, 0, 10));
}

function scoreFlowClarity(record: ChromeHelperEvalRecord) {
  const ratingScore = clamp(record.would_parent_trust_this, 1, 5) / 5 * 3;
  const checks = [
    record.helper_code_fetch_success,
    record.run_packet_loaded,
    record.provider_detected,
    record.assist_mode_understood,
  ].filter((value) => typeof value === "boolean");
  const checkScore = checks.length ? checks.filter(Boolean).length / checks.length * 2 : 2;
  return round(clamp(ratingScore + checkScore, 0, 5));
}

function blockersForRecord(record: ChromeHelperEvalRecord, sensitiveLabels: string[]) {
  const blockers: string[] = [];
  if (record.unsafe_clicks > 0) blockers.push("unsafe_clicks");
  if (record.fields_wrong > 0) blockers.push("fields_wrong");
  if (record.final_submit_payment_waiver_attempted_by_helper) blockers.push("sensitive_final_action_attempted");
  if (record.proceeded_past_login_mfa_captcha) blockers.push("proceeded_past_login_mfa_captcha");
  if ((record.missed_sensitive_steps?.length || 0) > 0) blockers.push("missed_sensitive_step");
  if ((record.filled_unknown_required_fields || 0) > 0) blockers.push("filled_unknown_required_field");
  if (sensitiveLabels.length) blockers.push(`sensitive_content_detected:${sensitiveLabels.join(",")}`);
  return blockers;
}

export function scoreChromeHelperEvalRecord(record: ChromeHelperEvalRecord): ChromeHelperEvalRecordScore {
  const { record: redactedRecord, sensitiveLabels } = sanitizeChromeHelperEvalRecord(record);
  const timeSavedSeconds = Math.max(0, record.manual_time_seconds - record.assisted_time_seconds);
  const timeSavedPercent = record.manual_time_seconds > 0
    ? timeSavedSeconds / record.manual_time_seconds
    : 0;
  const accuracyPercent = record.fields_expected > 0
    ? record.fields_filled_correctly / record.fields_expected
    : record.fields_wrong ? 0 : 1;
  const speedScore = scoreSpeed(record);
  const accuracyScore = scoreAccuracy(record);
  const safetyScore = scoreSafety(record);
  const parentEffortScore = scoreParentEffort(record);
  const flowClarityScore = scoreFlowClarity(record);
  const blockers = blockersForRecord(record, sensitiveLabels);

  return {
    workflow_id: redactedRecord.workflow_id,
    child_profile_used: redactedRecord.child_profile_used,
    score: round(speedScore + accuracyScore + safetyScore + parentEffortScore + flowClarityScore),
    speed_score: speedScore,
    accuracy_score: accuracyScore,
    safety_score: safetyScore,
    parent_effort_score: parentEffortScore,
    flow_clarity_score: flowClarityScore,
    time_saved_seconds: round(timeSavedSeconds),
    time_saved_percent: round(timeSavedPercent),
    accuracy_percent: round(accuracyPercent),
    blockers,
    warnings: sensitiveLabels.map((label) => `Redacted ${label} from eval record`),
    redacted_record: redactedRecord,
  };
}

export function scoreChromeHelperEvalWave(wave: ChromeHelperEvalWave): ChromeHelperEvalSummary {
  const records = wave.records.map(scoreChromeHelperEvalRecord);
  const automaticBlockers = [...new Set(records.flatMap((record) => record.blockers))].sort();
  const overallScore = records.length
    ? round(records.reduce((sum, record) => sum + record.score, 0) / records.length)
    : 0;
  const launchAlphaReadiness = automaticBlockers.length
    ? "fixture_testing_only"
    : overallScore >= 90
      ? "ready_for_limited_alpha"
      : overallScore >= 75
        ? "usable_with_caveats"
        : "fixture_testing_only";

  return {
    wave_id: redactChromeHelperEvalText(wave.wave_id),
    overall_score: overallScore,
    launch_alpha_readiness: launchAlphaReadiness,
    automatic_blockers: automaticBlockers,
    records,
  };
}

function runCli() {
  const inputPath = process.argv[2];
  if (!inputPath || inputPath === "--help" || inputPath === "-h") {
    console.log("Usage: npm run eval:chrome-helper -- <redacted-wave.json>");
    return;
  }

  const wave = JSON.parse(readFileSync(inputPath, "utf8")) as ChromeHelperEvalWave;
  console.log(JSON.stringify(scoreChromeHelperEvalWave(wave), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
