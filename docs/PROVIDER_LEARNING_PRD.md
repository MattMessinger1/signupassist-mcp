# Provider Learning PRD

## Long-Term Set-And-Forget Vision

SignupAssist should eventually let parents delegate full signup under a signed mandate. The agent should be able to find the exact activity, navigate the provider flow, fill approved information, respect constraints, pause when required, and complete signup only when provider readiness, policy gates, and mandate terms all agree.

The same-day MVP does not provide full set-and-forget signup. It prepares the foundation through supervised runs, redacted observations, fixtures, provider playbooks, and promotion reviews.

## Why Provider Learning Is Required

Activity providers vary widely. Their pages, forms, inventory states, login requirements, waiver steps, checkout behavior, and error messages change over time. A generic browser agent cannot safely infer when it is allowed to register a child, accept a waiver, enter sensitive medical data, or submit payment.

Provider learning turns repeated supervised observations into tested, provider-specific playbooks. This is required before increasing automation levels.

## Existing Foundation To Use First

Use existing infrastructure before adding new tables or services:

- Provider playbooks for Active / ActiveNet, DaySmart / Dash, Amilia, CivicRec / RecDesk, CampMinder, and Generic beta.
- Chrome helper fixtures under `chrome-helper/*`.
- `discovery_runs`
- `discovery_hints`
- `program_fingerprints`
- `get_best_hints`
- `upsert_discovery_run`
- cached provider/program tables, including `cached_provider_feed` and `cached_programs`
- `program_discovery_status`
- `activity_finder_searches`
- supervised `autopilot_runs`

Do not propose or create duplicate provider learning tables without first checking whether existing tables can be adapted safely.

## Initial Providers

- Active / ActiveNet
- DaySmart / Dash
- Amilia
- CivicRec / RecDesk
- CampMinder
- Generic beta

Generic beta remains conservative and should not advance into verified submit/payment behavior without fixture evidence and promotion review.

## Provider Readiness Levels

### Level 0: Unknown Provider

- Provider/domain is not recognized.
- SignupAssist may show search context and provider link.
- No automation beyond parent-directed browsing.
- Must pause for all provider interactions.

### Level 1: Recognized Provider/Domain

- Provider/domain is recognized by registry, cache, hint, or playbook.
- SignupAssist may explain known patterns and collect parent intent.
- No field-fill or navigation unless a playbook permits it.

### Level 2: Field-Fill Safe Mode

- Safe low-risk fields can be identified.
- Helper may fill non-sensitive fields from approved profile data.
- Must not enter credentials, payment data, waiver acceptance, medical/allergy details, or final submit.
- Parent remains in control.

### Level 3: Verified Navigation And Selection

- Provider-specific fixtures verify navigation and activity selection.
- Exact program matching uses fingerprints, cached programs, and deterministic checks.
- Helper may navigate non-final steps and select the verified activity.
- Must pause at unsafe or unknown boundaries.

### Level 4: Verified Registration Submit With Parent Pre-Authorization

- Provider-specific tests verify the registration submit boundary.
- Parent has explicitly pre-authorized the exact activity/program under current constraints.
- Deterministic checks confirm child, provider, program, schedule, and price cap.
- Submit may proceed only in the approved mode and must audit all decisions.

### Level 5: Verified Checkout/Payment Handoff

- Checkout behavior is verified by provider-specific fixtures and tests.
- Price cap, fee tolerance, refund/fee disclosures, and payment handoff are deterministic.
- Parent remains involved for payment method choice and final payment authorization unless future mandate rules permit otherwise.
- No raw payment data enters provider learning artifacts.

### Level 6: Full Delegated Signup Under Signed Mandate And Provider-Specific Tests

- Signed mandate covers exact child, provider, activity/program, schedule, price cap, allowed actions, expiration, revocation, and audit scope.
- Provider readiness is verified and current.
- Provider-specific tests pass.
- Exact activity/program match is deterministic.
- Sensitive action policies pass.
- Complete audit trail is written.

Level 6 is future-gated and is not part of the same-day MVP.

## Data Model Proposal

Adapt existing tables first. Candidate future tables should be introduced only if existing discovery, cache, fingerprint, and autopilot tables cannot represent the required data cleanly.

Candidate tables:

- `provider_registry`: canonical provider/domain records, aliases, ownership, status, and readiness level.
- `provider_playbook_versions`: immutable playbook versions, fixture references, rollout status, and compatibility notes.
- `provider_capabilities`: supported automation capabilities by provider/readiness level.
- `provider_flow_observations`: redacted observations from supervised runs and discovery.
- `provider_fixture_runs`: fixture execution history, pass/fail status, and evidence pointers.
- `provider_field_mappings`: safe field selectors, labels, confidence, sensitivity, and data source mapping.
- `provider_learning_runs`: aggregate learning runs that connect observations, fixtures, hints, and promotion candidates.
- `provider_promotion_reviews`: human/operator review records for beta-to-verified promotion.

Adaptation guidance:

- Extend `discovery_runs` and `discovery_hints` for redacted observations and confidence signals where practical.
- Extend `program_fingerprints` for deterministic program matching.
- Extend cached provider/program tables for recognized provider/domain and inventory context.
- Extend `autopilot_runs` for supervised run packet outcomes and pause reasons.
- Add new tables only when lifecycle, permissions, or audit requirements are materially different.

## Redaction Requirements

Provider learning artifacts must not expose:

- child names
- child birthdates
- addresses
- phone numbers
- emails
- credentials
- auth tokens
- payment data
- medical details
- allergy details
- waiver text tied to a specific child
- provider account identifiers that can identify a family

Allowed learning artifacts should be redacted, structural, and provider-focused:

- field labels and selectors
- required/optional status
- page type
- non-sensitive validation hints
- pause reason
- provider/domain fingerprint
- fixture result
- anonymized confidence signal

## Fixture Requirements

Provider readiness promotion requires fixture coverage that represents real provider flow states without using sensitive family data.

Fixtures should cover:

- search result or program detail page
- activity selection
- participant information page
- login-required state
- waiver-required state
- payment/checkout boundary
- sold-out/waitlist state when available
- unknown required field
- provider error state

Fixtures must be redacted and safe to store in the repo. They must not contain real credentials, tokens, child data, payment data, or medical/allergy details.

## Promotion Criteria From Beta To Verified

A provider or playbook can move from beta/generic to verified only when:

- Provider/domain identity is deterministic.
- Supported flow states have fixture coverage.
- Provider-specific tests pass.
- Exact activity/program matching uses deterministic fingerprints or provider IDs.
- Sensitive fields are classified and unsafe actions pause.
- Promotion evidence is reviewed by a human/operator.
- Model output is treated as advisory only.
- Audit and rollback behavior are documented.

Provider readiness cannot be promoted by model output alone.

## Learning Boundaries

- Learning must not expose child data, credentials, tokens, payment data, or medical/allergy details.
- Learning must not authorize registration, payment, waiver acceptance, provider login, final submit, or readiness promotion.
- Learning must not alter the public ChatGPT app approval flow.
- Learning must not expose hidden/private/internal MCP tools.
- Learning must not weaken auth, RLS, protected actions, or parent confirmation requirements.

## ChatGPT App Approval Isolation

Provider learning is a web/admin and backend readiness track. It must not change the current ChatGPT public tool surface, public schemas, descriptors, annotations, manifest, OAuth behavior, CSP posture, or no-widget V1 posture unless explicitly approved in a later phase.
