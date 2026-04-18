# SignupAssist - Review Team Test Account Guide

This document provides the review-team orientation for the ChatGPT App Store submission.

## Quick Start

### Public Submission URLs

- **Website:** `https://signupassist.shipworx.ai/`
- **Privacy policy:** `https://signupassist.shipworx.ai/privacy`
- **Terms:** `https://signupassist.shipworx.ai/terms`
- **Support email:** `support@shipworx.ai`
- **Production SSE endpoint:** `https://signupassist.shipworx.ai/sse`
- **Health check:** `https://signupassist.shipworx.ai/health`
- **Manifest:** `https://signupassist.shipworx.ai/mcp/manifest.json`
- **Safety/security page:** `https://signupassist.shipworx.ai/safety`

### OAuth Authentication

- **Authorization URL:** `https://signupassist.shipworx.ai/oauth/authorize`
- **Token URL:** `https://signupassist.shipworx.ai/oauth/token`
- **Scopes:** `openid profile email`

### Test Credentials

Reviewer credentials are provided directly in the OpenAI Platform submission form.

```text
Email: [paste reviewer test email in platform.openai.com]
Password: [paste reviewer test password in platform.openai.com]
```

The reviewer account should not require MFA, SMS verification, email verification loops, or access from a private network. Do not commit reviewer passwords or live credentials to git.

## What To Test

SignupAssist is for adult parents and guardians managing child-safe youth activity signups. It is not child-directed and is not for adult-only activities.

### Read-Only Browsing

The `search_activities` tool is read-only:

```text
Use SignupAssist to show me programs at AIM Design.
```

Expected:

- Returns available AIM Design programs from the Bookeo-connected catalog.
- Does not require booking details.
- Does not create a booking, collect payment, or charge anything.

Age-filtered browse should also use `search_activities`:

```text
Use SignupAssist to find robotics classes for my 9 year old at AIM Design.
```

Expected:

- Returns AIM Design robotics or youth-program results appropriate for the requested age when available.
- If no exact match exists, explains closest available programs or asks a narrow follow-up.
- Does not start the signup wizard unless the reviewer asks to sign up.
- Does not create a booking, collect payment, or charge anything.

### Connected Bookeo Signup

The `register_for_activity` tool requires OAuth for the signup flow:

```text
Use SignupAssist to sign my child up for a class at AIM Design.
```

Expected flow:

1. Step 1/5: Shows available programs and asks the reviewer to select one.
2. Step 2/5: Collects account-holder and participant information required by Bookeo.
3. Payment setup: Directs to Stripe-hosted checkout for payment method setup when required.
4. Review: Shows a final summary with program, participant, schedule, program fee, SignupAssist fee, and payment context.
5. Confirmation: Creates the supported Bookeo booking only after the reviewer explicitly types `book now`.

No booking or charge occurs before the explicit final confirmation.

### Cancel Flow

```text
Actually, cancel this signup.
```

Expected:

- Stops the active signup flow.
- Does not create a booking or charge if final confirmation has not happened.

### Future Set-And-Forget Boundary

```text
Set it and forget it. Register automatically later without asking me again.
```

Expected:

- Explains that unattended delegated signup is not live for arbitrary provider flows.
- Keeps parent confirmation requirements in place.

## Sample Data

### Available Programs

Programs are fetched live from the AIM Design Bookeo API. Typical program categories may include:

- Robotics classes
- STEM camps
- Coding workshops

Actual titles, prices, schedules, and availability may change because they come from the live provider catalog.

### Payment Method Setup

Payment method setup is handled by Stripe-hosted checkout. SignupAssist does not see raw card numbers.

For review/testing, use the dedicated reviewer account and payment instructions supplied in the OpenAI Platform submission. Do not use real family data, production payment cards, or production credentials in review tests.

Prefer a synthetic participant age 13 or older for review tests when the selected program supports it. If the provider-selected program requires a different age range, use synthetic data that matches the provider rules and do not use real child data. Do not submit personal information about children under 13 in ChatGPT.

If the reviewer completes a final booking, record the booking number, cancellation/refund evidence, and Stripe/test-payment evidence in the submission notes.

## Safety Annotations

| Tool | readOnlyHint | destructiveHint | Expected posture |
|---|---:|---:|---|
| `search_activities` | true | false | Read-only browse; no booking, payment, or writes. |
| `register_for_activity` | false | true | OAuth-gated signup wizard; can create supported Bookeo bookings only after explicit final confirmation. |

Hidden/private/internal tools remain private and should not appear in public `ListTools` responses.

## Privacy And Child Safety

- Account holders must be adults.
- Children do not interact with the service directly.
- Participant information is provided by the authenticated adult.
- SignupAssist does not see raw card numbers.
- Privacy policy: `https://signupassist.shipworx.ai/privacy`
- Terms: `https://signupassist.shipworx.ai/terms`
- Safety/security page: `https://signupassist.shipworx.ai/safety`

## Support

- **Email:** `support@shipworx.ai`
- **Privacy questions:** `privacy@shipworx.ai`
- **Response time:** Within 1 business day for review team requests.
