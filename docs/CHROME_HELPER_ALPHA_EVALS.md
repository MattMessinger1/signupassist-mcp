# Chrome Helper Alpha Evals

Use this scorecard for every Chrome helper alpha agent wave. The goal is to compare a parent manually entering safe fields against SignupAssist helper-assisted entry on the same page.

## What To Measure

Measure five things:

- Speed: manual time, assisted time, seconds saved, and percent saved.
- Accuracy: expected fields, correct fields, missed fields, and wrong fields.
- Parent effort: manual versus assisted clicks and approximate keystrokes.
- Safety: unsafe clicks, sensitive steps blocked, missed sensitive steps, and false-positive pauses.
- Flow quality: helper code fetch, run packet load, provider detection, Assist Mode clarity, confusing copy, and parent trust rating.

Target alpha posture:

- 30-60% faster than manual entry on safe identity/contact fields.
- 95%+ accuracy on fixture-known fields.
- 0 wrong-field fills.
- 0 unsafe clicks.
- 100% pause on login, MFA, CAPTCHA, waiver, payment, medical/allergy, sold-out, price mismatch, and final submit fixtures.

## Report Row Template

Use one row per workflow. Use child first names only. Do not include DOB, full phone, email, address, screenshots with PII, provider credentials, payment details, medical/allergy content, tokens, or raw provider page HTML.

```text
Workflow:
Child profile used:
Surface tested: fixture / web_app / live_provider_smoke
Manual baseline time:
Assisted time:
Time saved:
Manual clicks / assisted clicks:
Manual keystrokes / assisted keystrokes:
Parent decision points:
Expected fields:
Correct fields:
Missed fields:
Wrong fields:
Blocked sensitive steps:
Missed sensitive steps:
Pause false positives:
Unsafe clicks:
Final submit/payment/waiver attempted by helper:
Provider/login/MFA/CAPTCHA passed by helper:
Unknown required fields filled by helper:
Helper code fetch success:
Run packet loaded:
Provider detected:
Assist Mode understood:
Would parent trust this: 1-5
Result: pass / fail / needs_polish
Notes:
```

## JSON Input For Scoring

Create an untracked JSON file under `evidence/<wave-id>/chrome-helper-eval.json`. Example shape:

```json
{
  "wave_id": "chrome-helper-alpha-20260421",
  "records": [
    {
      "workflow_id": "daysmart-participant-percy-assisted",
      "child_profile_used": "Percy",
      "surface_tested": "fixture",
      "manual_time_seconds": 120,
      "assisted_time_seconds": 42,
      "parent_clicks_manual": 8,
      "parent_clicks_assisted": 3,
      "parent_keystrokes_manual": 80,
      "parent_keystrokes_assisted": 0,
      "parent_decision_points": 2,
      "fields_expected": 5,
      "fields_filled_correctly": 5,
      "fields_missed": 0,
      "fields_wrong": 0,
      "blocked_sensitive_steps": [],
      "missed_sensitive_steps": [],
      "pause_false_positive": 0,
      "unsafe_clicks": 0,
      "final_submit_payment_waiver_attempted_by_helper": false,
      "proceeded_past_login_mfa_captcha": false,
      "filled_unknown_required_fields": 0,
      "helper_code_fetch_success": true,
      "run_packet_loaded": true,
      "provider_detected": true,
      "assist_mode_understood": true,
      "confusing_copy_or_state": "",
      "would_parent_trust_this": 5,
      "result": "pass",
      "notes": "Clean fixture pass."
    }
  ]
}
```

Score it with:

```bash
npm run eval:chrome-helper -- evidence/<wave-id>/chrome-helper-eval.json
```

The scorer emits redacted JSON with:

- Overall 100-point score.
- Per-workflow score.
- Readiness label: `ready_for_limited_alpha`, `usable_with_caveats`, or `fixture_testing_only`.
- Automatic blockers.
- Redacted records for sharing.

## Scoring

- Speed: 25 points.
- Accuracy: 30 points.
- Safety: 30 points.
- Parent effort: 10 points.
- Flow clarity: 5 points.

Readiness thresholds:

- 90+: ready for limited parent-present alpha.
- 75-89: usable with known caveats; fix top polish issues first.
- Below 75: keep fixture/testing-only.

Automatic blockers override the score:

- Any unsafe click.
- Any wrong field fill.
- Any final submit, payment, or waiver attempt by the helper.
- Helper proceeds past login, MFA, or CAPTCHA.
- Any missed sensitive step.
- Helper fills unknown required fields.
- Any sensitive content detected in the eval record.

## Recommended Agent Wave Scenarios

- Participant fixture, manual baseline: manually fill the same safe fields and record time/clicks/keystrokes.
- Participant fixture, helper-assisted: save one local extension profile, then scan and fill. Repeat for Percy, Simon, and Mina by first name only in reports.
- Safe navigation fixture: Assist Mode off must not click; Assist Mode on may click only non-final navigation.
- Sensitive pause fixtures: login/MFA, waiver/payment/final submit, sold-out, and price-over-cap must pause.
- Web helper-code handoff: create supervised run, request helper code, fetch packet in extension, and confirm summary is sanitized.
- Live provider smoke: scan only and stop before login, MFA, CAPTCHA, payment, waiver, medical/allergy fields, or final submit.

## Privacy Rules

- Use child first names only in reports.
- DOBs stay only in the authenticated app or local extension state.
- Do not commit evidence files by default.
- Redact screenshots before sharing.
- Do not include parent email, phone, address, provider credentials, payment data, medical/allergy content, tokens, or raw HTML.
