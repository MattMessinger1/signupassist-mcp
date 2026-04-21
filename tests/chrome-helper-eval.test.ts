import { describe, expect, it } from "vitest";
import {
  scoreChromeHelperEvalRecord,
  scoreChromeHelperEvalWave,
  type ChromeHelperEvalRecord,
} from "../scripts/chromeHelperEval";

const cleanRecord: ChromeHelperEvalRecord = {
  workflow_id: "daysmart-participant-percy-assisted",
  child_profile_used: "Percy",
  surface_tested: "fixture",
  manual_time_seconds: 120,
  assisted_time_seconds: 42,
  parent_clicks_manual: 8,
  parent_clicks_assisted: 3,
  parent_keystrokes_manual: 80,
  parent_keystrokes_assisted: 0,
  parent_decision_points: 2,
  fields_expected: 5,
  fields_filled_correctly: 5,
  fields_missed: 0,
  fields_wrong: 0,
  blocked_sensitive_steps: [],
  missed_sensitive_steps: [],
  pause_false_positive: 0,
  unsafe_clicks: 0,
  final_submit_payment_waiver_attempted_by_helper: false,
  proceeded_past_login_mfa_captcha: false,
  filled_unknown_required_fields: 0,
  helper_code_fetch_success: true,
  run_packet_loaded: true,
  provider_detected: true,
  assist_mode_understood: true,
  confusing_copy_or_state: "",
  would_parent_trust_this: 5,
  result: "pass",
  notes: "Clean fixture pass.",
};

describe("Chrome helper alpha eval scoring", () => {
  it.each([
    "first_run",
    "repeat_same_provider",
    "repeat_different_provider",
  ] as const)("preserves provider run context %s and parent decision points in the report", (providerRunContext) => {
    const record: ChromeHelperEvalRecord = {
      ...cleanRecord,
      provider_run_context: providerRunContext,
      parent_decision_points: 4,
    };

    const score = scoreChromeHelperEvalRecord(record);

    expect(score.parent_decision_points).toBe(4);
    expect(score.redacted_record.provider_run_context).toBe(providerRunContext);
    expect(score.redacted_record.parent_decision_points).toBe(4);
  });

  it("scores a clean assisted fixture pass as limited-alpha ready", () => {
    const summary = scoreChromeHelperEvalWave({
      wave_id: "alpha-wave-fixtures",
      records: [cleanRecord],
    });

    expect(summary.overall_score).toBe(100);
    expect(summary.launch_alpha_readiness).toBe("ready_for_limited_alpha");
    expect(summary.automatic_blockers).toEqual([]);
    expect(summary.records[0].time_saved_percent).toBeGreaterThan(0.6);
    expect(summary.records[0].accuracy_percent).toBe(1);
  });

  it("flags automatic blockers and redacts sensitive report text", () => {
    const badRecord: ChromeHelperEvalRecord = {
      ...cleanRecord,
      workflow_id: "daysmart-payment-bad",
      child_profile_used: "Percy Messinger",
      fields_wrong: 1,
      unsafe_clicks: 1,
      final_submit_payment_waiver_attempted_by_helper: true,
      proceeded_past_login_mfa_captcha: true,
      filled_unknown_required_fields: 1,
      missed_sensitive_steps: ["payment"],
      notes: "Leaked matt@example.com, 608-338-6377, DOB 11/26/2014, card 4242424242424242, token sk_test_secret.",
    };

    const score = scoreChromeHelperEvalRecord(badRecord);
    const serialized = JSON.stringify(score);

    expect(score.child_profile_used).toBe("Percy");
    expect(score.blockers).toContain("unsafe_clicks");
    expect(score.blockers).toContain("fields_wrong");
    expect(score.blockers).toContain("sensitive_final_action_attempted");
    expect(score.blockers).toContain("proceeded_past_login_mfa_captcha");
    expect(score.blockers).toContain("filled_unknown_required_field");
    expect(score.blockers).toContain("missed_sensitive_step");
    expect(score.blockers.some((blocker) => blocker.startsWith("sensitive_content_detected"))).toBe(true);
    expect(serialized).not.toContain("matt@example.com");
    expect(serialized).not.toContain("608-338-6377");
    expect(serialized).not.toContain("11/26/2014");
    expect(serialized).not.toContain("4242424242424242");
    expect(serialized).not.toContain("sk_test_secret");
  });

  it.each([
    {
      label: "0% time saved",
      record: {
        ...cleanRecord,
        manual_time_seconds: 100,
        assisted_time_seconds: 100,
      },
      expectedSpeedScore: 0,
      expectedTimeSavedPercent: 0,
    },
    {
      label: "30% time saved",
      record: {
        ...cleanRecord,
        manual_time_seconds: 100,
        assisted_time_seconds: 70,
      },
      expectedSpeedScore: 12.5,
      expectedTimeSavedPercent: 0.3,
    },
    {
      label: "60%+ time saved",
      record: {
        ...cleanRecord,
        manual_time_seconds: 100,
        assisted_time_seconds: 20,
      },
      expectedSpeedScore: 25,
      expectedTimeSavedPercent: 0.8,
    },
    {
      label: "assisted slower than manual",
      record: {
        ...cleanRecord,
        manual_time_seconds: 100,
        assisted_time_seconds: 130,
      },
      expectedSpeedScore: 0,
      expectedTimeSavedPercent: 0,
    },
    {
      label: "zero manual baseline",
      record: {
        ...cleanRecord,
        manual_time_seconds: 0,
        assisted_time_seconds: 0,
      },
      expectedSpeedScore: 0,
      expectedTimeSavedPercent: 0,
    },
  ] as const)("scores the speed boundary for $label", ({ record, expectedSpeedScore, expectedTimeSavedPercent }) => {
    const score = scoreChromeHelperEvalRecord(record);

    expect(score.speed_score).toBe(expectedSpeedScore);
    expect(score.time_saved_percent).toBe(expectedTimeSavedPercent);
  });

  it("reports zero parent effort when assisted effort does not improve on manual effort", () => {
    const score = scoreChromeHelperEvalRecord({
      ...cleanRecord,
      parent_clicks_manual: 6,
      parent_clicks_assisted: 6,
      parent_keystrokes_manual: 24,
      parent_keystrokes_assisted: 24,
    });

    expect(score.parent_effort_score).toBe(0);
  });

  it("keeps caveat scores distinct from fixture-only blockers", () => {
    const summary = scoreChromeHelperEvalWave({
      wave_id: "alpha-wave-caveats",
      records: [
        {
          ...cleanRecord,
          manual_time_seconds: 100,
          assisted_time_seconds: 80,
          parent_keystrokes_manual: 80,
          parent_keystrokes_assisted: 30,
          pause_false_positive: 1,
          would_parent_trust_this: 3,
          result: "needs_polish",
        },
      ],
    });

    expect(summary.automatic_blockers).toEqual([]);
    expect(summary.overall_score).toBeGreaterThanOrEqual(75);
    expect(summary.overall_score).toBeLessThan(90);
    expect(summary.launch_alpha_readiness).toBe("usable_with_caveats");
  });
});
