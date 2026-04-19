import { describe, expect, it } from "vitest";
import {
  buildReleaseEvidence,
  redactEvidenceValue,
  summarizeAutopilotRunForEvidence,
  summarizeSignupIntentForEvidence,
} from "../scripts/releaseEvidence";
import type { Database } from "../src/integrations/supabase/types";

type SignupIntentRow = Database["public"]["Tables"]["signup_intents"]["Row"];
type SignupIntentEventRow = Database["public"]["Tables"]["signup_intent_events"]["Row"];
type AutopilotRunRow = Database["public"]["Tables"]["autopilot_runs"]["Row"];

const intent: SignupIntentRow = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "user-row-must-not-print",
  source: "activity_finder",
  original_query: "Find soccer for Percy at 8312 Forsythia Lane",
  parsed_activity: "Youth soccer",
  parsed_venue: "Madison Parks",
  parsed_city: "Madison",
  parsed_state: "WI",
  parsed_age_years: 11,
  parsed_grade: "5",
  selected_result: {
    status: "guided_autopilot",
    providerKey: "daysmart",
    providerName: "DaySmart / Dash",
    activityLabel: "Youth soccer",
    venueName: "Madison Parks",
    address: "8312 Forsythia Lane",
    targetUrl: "https://dash.example.com/register?child=Percy&token=secret",
    missingDetails: ["child DOB"],
    whyThisMatch: ["age fit"],
  },
  target_url: "https://dash.example.com/register?child=Percy&token=secret",
  provider_key: "daysmart",
  provider_name: "DaySmart / Dash",
  finder_status: "guided_autopilot",
  confidence: 0.86,
  source_freshness: "cached",
  selected_child_id: "child-row-must-not-print",
  autopilot_run_id: "22222222-2222-4222-8222-222222222222",
  status: "scheduled",
  created_at: "2026-04-18T18:00:00.000Z",
  updated_at: "2026-04-18T18:03:00.000Z",
};

const run: AutopilotRunRow = {
  id: "22222222-2222-4222-8222-222222222222",
  user_id: "user-row-must-not-print",
  child_id: "child-row-must-not-print",
  provider_key: "daysmart",
  provider_name: "DaySmart / Dash",
  target_url: "https://dash.example.com/register?child=Percy&token=secret",
  target_program: "Youth soccer",
  confidence: "beta",
  status: "ready",
  allowed_actions: ["prepare_fields", "pause_for_parent"],
  stop_conditions: ["payment_required", "waiver_required", "final_submit_required"],
  caps: {
    max_total_cents: 7500,
    billing_address: "8312 Forsythia Lane",
    card_number: "4242424242424242",
  },
  audit_events: [
    {
      type: "run_created",
      parent_email: "openai-reviewer@shipworx.ai",
      child_dob: "2014-11-26",
      phone: "608-338-6377",
      token: "secret-token",
      payment_card: "4242424242424242",
      medical_notes: "none",
    },
  ],
  created_at: "2026-04-18T18:05:00.000Z",
  updated_at: "2026-04-18T18:06:00.000Z",
};

const events: SignupIntentEventRow[] = [
  {
    id: "33333333-3333-4333-8333-333333333333",
    user_id: "user-row-must-not-print",
    signup_intent_id: intent.id,
    event_type: "created",
    event: {
      parent_email: "openai-reviewer@shipworx.ai",
      child_name: "Percy Messinger",
      child_dob: "2014-11-26",
      address: "8312 Forsythia Lane",
      target_url: "https://dash.example.com/register?token=secret",
    },
    created_at: "2026-04-18T18:00:00.000Z",
  },
];

describe("release evidence redaction", () => {
  it("prints useful release proof without user IDs, child IDs, target URL details, or sensitive fields", () => {
    const evidence = buildReleaseEvidence({
      signupIntent: intent,
      signupIntentEvents: events,
      autopilotRun: run,
    });
    const serialized = JSON.stringify(evidence);

    expect(evidence.signup_intent?.target_url_host).toBe("dash.example.com");
    expect(evidence.autopilot_run?.target_url_host).toBe("dash.example.com");
    expect(evidence.signup_intent?.selected_child_attached).toBe(true);
    expect(evidence.autopilot_run?.child_attached).toBe(true);
    expect(evidence.redaction_policy.omits_user_ids).toBe(true);
    expect(evidence.redaction_policy.omits_child_ids).toBe(true);
    expect(evidence.autopilot_run?.provider_readiness.model_output_can_promote).toBe(false);
    expect(evidence.autopilot_run?.redacted_provider_observation.redaction.child_pii).toBe("excluded");

    expect(serialized).not.toContain("user-row-must-not-print");
    expect(serialized).not.toContain("child-row-must-not-print");
    expect(serialized).not.toContain("openai-reviewer@shipworx.ai");
    expect(serialized).not.toContain("Percy Messinger");
    expect(serialized).not.toContain("2014-11-26");
    expect(serialized).not.toContain("8312 Forsythia");
    expect(serialized).not.toContain("608-338-6377");
    expect(serialized).not.toContain("4242424242424242");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("token=secret");
  });

  it("redacts nested sensitive keys recursively", () => {
    expect(
      redactEvidenceValue({
        safe: "program_ready",
      nested: {
        provider: "DaySmart",
        provider_name: "DaySmart / Dash",
        name: "Percy Messinger",
        label: "Percy account holder",
        title: "Percy registration",
        parent_name: "Matt Messinger",
        guardian_name: "Matt Messinger",
        contact_name: "Matt Messinger",
        emergency_contact_name: "Matt Messinger",
        child_first_name: "Percy",
        payment_card: "4242424242424242",
        target_url: "https://dash.example.com/path?token=secret",
        },
      }),
    ).toEqual({
      safe: "program_ready",
      nested: {
        provider: "DaySmart",
        provider_name: "DaySmart / Dash",
        name: "[redacted]",
        label: "[redacted]",
        title: "[redacted]",
        parent_name: "[redacted]",
        guardian_name: "[redacted]",
        contact_name: "[redacted]",
        emergency_contact_name: "[redacted]",
        child_first_name: "[redacted]",
        payment_card: "[redacted]",
        target_url_host: "dash.example.com",
      },
    });
  });

  it("summarizes intent and run records independently for docs and release notes", () => {
    expect(summarizeSignupIntentForEvidence(intent)?.parsed.age_years_present).toBe(true);
    expect(summarizeSignupIntentForEvidence(intent)?.selected_result.address_present).toBe(true);
    expect(summarizeAutopilotRunForEvidence(run)?.caps.max_total_cents).toBe(7500);
  });
});
