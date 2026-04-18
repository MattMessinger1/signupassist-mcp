# ChatGPT App Review Package

This package is the copy/paste source of truth for the OpenAI Platform app submission. It reflects the current ChatGPT app surface, not the broader web app roadmap.

## Submission Fields

| Field | Value |
|---|---|
| App name | `SignupAssist` |
| Website URL | `https://signupassist.shipworx.ai/` |
| Privacy Policy URL | `https://signupassist.shipworx.ai/privacy` |
| Terms URL | `https://signupassist.shipworx.ai/terms` |
| Support contact email | `support@shipworx.ai` |
| MCP server URL | `https://signupassist.shipworx.ai/sse` |
| Safety/security URL, if requested | `https://signupassist.shipworx.ai/safety` |

Reviewer credentials must be entered directly in the OpenAI Platform submission form. Do not commit reviewer passwords, payment details, or live credentials to this repository.

## App Description

SignupAssist helps parents and guardians find youth activity programs and complete supervised signups through connected provider flows. The app can browse available programs, collect required registration details, guide payment-method setup through Stripe-hosted checkout, show a final review summary, and complete supported Bookeo/API-connected bookings only after explicit user confirmation.

SignupAssist is parent-controlled. It does not book or charge until the user reviews the details and gives explicit final confirmation such as `book now`. Unattended set-and-forget delegation is not live yet.

## App Purpose

SignupAssist helps parents:

- Search for youth activity options.
- Browse configured provider catalogs, including AIM Design via Bookeo.
- Start an OAuth-gated signup wizard for supported providers.
- Provide account-holder and participant details needed by the provider.
- Set up a payment method through Stripe-hosted checkout when required.
- Review the final program, participant, schedule, and fee summary.
- Complete a supported Bookeo/API-connected booking only after explicit final confirmation.
- Keep a clear audit trail for consequential actions.

## Public MCP Tools

The public ChatGPT MCP surface is intentionally small:

- `search_activities`: read-only activity/program discovery. It must not register, hold, charge, submit, accept waivers, or log in.
- `register_for_activity`: OAuth-gated guided signup wizard. It may complete a supported Bookeo/API-connected booking only after registration details are collected, payment method setup is handled through Stripe-hosted checkout when required, the review summary is shown, and the user gives explicit final confirmation such as `book now`.

Hidden/private/internal tools remain registered for orchestrator use but must not be exposed in public `ListTools` responses.

## Current Live Capabilities

- Read-only program browsing through `search_activities`.
- Guided AIM Design / Bookeo signup through `register_for_activity`.
- OAuth sign-in for authenticated signup actions.
- Stripe-hosted payment method setup; SignupAssist does not see raw card numbers.
- Explicit final confirmation before booking or charging.
- Bookeo/API-connected booking confirmation for supported configured providers.

## Known Limitations

- Full unattended set-and-forget signup across arbitrary providers is not live yet.
- Unsupported provider flows may require parent review or direct provider completion.
- Provider pages, model outputs, cached provider data, and signup URLs are untrusted.
- The public ChatGPT tool surface is limited to `search_activities` and `register_for_activity`.

## Screenshots Checklist

- [ ] App discovery/OAuth connection screen.
- [ ] Successful app connection state.
- [ ] `search_activities` result for AIM Design program browsing.
- [ ] `register_for_activity` Step 1/5 program selection.
- [ ] Account-holder and participant detail collection.
- [ ] Stripe-hosted payment method setup screen, if prompted.
- [ ] Final review and explicit confirmation request.
- [ ] Successful supported Bookeo booking confirmation with booking number or receipt summary.
- [ ] Cancel flow showing no booking or charge.
- [ ] Privacy policy page at `https://signupassist.shipworx.ai/privacy`.
- [ ] Terms page at `https://signupassist.shipworx.ai/terms`.
- [ ] Safety page at `https://signupassist.shipworx.ai/safety`.
- [ ] Public tool list evidence showing only `search_activities` and `register_for_activity`.

## Reviewer Test Prompts And Expected Outcomes

Use these in the OpenAI Platform Testing section. The first five are positive tests. The last three are negative tests where SignupAssist should not be invoked.

### Positive Test 1: Browse AIM Design Programs

Scenario:

```text
Browse AIM Design programs
```

User prompt:

```text
Use SignupAssist to show me programs at AIM Design.
```

Tool triggered:

```text
search_activities
```

Expected output:

```text
Returns available AIM Design programs from the Bookeo-connected catalog. Results may include title, age range, schedule, price, or availability when available. SignupAssist must not create a booking, collect payment, or charge anything.
```

### Positive Test 2: Age-Filtered Browse

Scenario:

```text
Age-filtered AIM Design program browse
```

User prompt:

```text
Use SignupAssist to find robotics classes for my 9 year old at AIM Design.
```

Tool triggered:

```text
search_activities
```

Expected output:

```text
Returns AIM Design robotics or youth-program results appropriate for the requested age when available. If no exact match exists, it should explain the closest available programs or ask a narrow follow-up. It must not create a booking, collect payment, or charge anything.
```

### Positive Test 3: Start Signup Flow

Scenario:

```text
Start AIM Design signup flow
```

User prompt:

```text
Use SignupAssist to sign my child up for a class at AIM Design.
```

Tool triggered:

```text
register_for_activity
```

Expected output:

```text
If the reviewer is not authenticated, SignupAssist starts OAuth sign-in. After sign-in, it shows Step 1/5 with available AIM Design programs, lists numbered options, and waits for the reviewer to select a program before collecting registration details.
```

### Positive Test 4: Complete Connected Bookeo Signup

Scenario:

```text
Complete connected AIM Design / Bookeo signup
```

User prompt:

```text
Use SignupAssist to sign my child up for a class at AIM Design. Then select an available program, provide synthetic parent/account-holder details, provide synthetic participant details for a participant age 13 or older, complete Stripe-hosted payment method setup if prompted, review the summary, and type: book now
```

Tool triggered:

```text
register_for_activity
```

Expected output:

```text
SignupAssist walks through Step 1/5 program selection, required account-holder and participant details, Stripe-hosted payment setup if required, and a final review summary. It must not book or charge before the explicit final confirmation. After the reviewer types "book now" at the final review step, it creates the supported Bookeo booking and returns confirmation details such as a booking number or receipt summary.
```

### Positive Test 5: Explicit Out-Of-Scope Safety

Scenario:

```text
Adult-only activity is outside SignupAssist scope
```

User prompt:

```text
Use SignupAssist to sign me up for a wine tasting class for adults only.
```

Tool triggered:

```text
register_for_activity
```

Expected output:

```text
If the reviewer is not already authenticated, ChatGPT may ask them to connect SignupAssist before invoking this consequential tool. After authentication if needed, SignupAssist declines or redirects because it is focused on parent-controlled youth activity registration. It must not start an adult-only signup, create a booking, collect payment, or charge anything.
```

### Negative Test 1: General Recipe Question

Scenario:

```text
General recipe question unrelated to activity signups
```

User prompt:

```text
What's a good recipe for chicken parmesan?
```

Expected output:

```text
SignupAssist should not trigger because the request is unrelated to youth activity search or signup.
```

### Negative Test 2: Product Shopping

Scenario:

```text
Shopping for a physical product, not activity registration
```

User prompt:

```text
Find me the best laptop under $1000.
```

Expected output:

```text
SignupAssist should not trigger because the request is unrelated to youth activity search or signup.
```

### Negative Test 3: General Business Education

Scenario:

```text
General education question unrelated to activity signups
```

User prompt:

```text
Summarize the difference between Agile and Scrum.
```

Expected output:

```text
SignupAssist should not trigger because the request is unrelated to youth activity search or signup.
```

## Reviewer Test Account

Use the dedicated reviewer account provided in the OpenAI Platform submission.

```text
Email: [paste reviewer test email in platform.openai.com]
Password: [paste reviewer test password in platform.openai.com]
```

The test account should not require MFA, SMS verification, email verification loops, or access from a private network.

## Reviewer Data Guidance

- Use synthetic account-holder data.
- Use a synthetic participant age 13 or older where possible.
- Do not use real child data, real provider credentials, or production payment cards.
- If a final booking is completed, record the booking number, cancellation/refund evidence, and Stripe/test-payment evidence for the submission notes.

## Compatibility Evidence

Run before submission or after approval-sensitive edits:

```bash
npm run test:mcp-manifest
npm run test:mcp-descriptors
npm run test:chatgpt-app
npm run test:approval-snapshots
```

These checks protect the manifest, OpenAPI route contract, public MCP descriptors, approval-sensitive file hashes, public/private tool posture, and auth/protected-action compatibility.
