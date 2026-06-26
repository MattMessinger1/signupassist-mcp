# ChatGPT App Store Submission Checklist

## App Metadata

| Field | Value |
|---|---|
| App Name | SignupAssist |
| Developer Name / Publisher | Matt Messinger |
| Publisher Verification Type | Verified individual |
| Business Publishing Note | Do not enter ShipWorx AI, Shipworx, LLC, WiscAI, or AIM Design as the developer name unless that exact business name has completed OpenAI business verification. |
| Short Description | Parent-controlled child-safe youth activity signup assistant |
| Category | Productivity / Family |
| Website URL | https://signupassist.shipworx.ai/ |
| Privacy Policy URL | https://signupassist.shipworx.ai/privacy |
| Terms URL | https://signupassist.shipworx.ai/terms |
| Support Email | support@shipworx.ai |
| MCP Server URL | https://signupassist.shipworx.ai/sse |
| Safety/Security URL, if requested | https://signupassist.shipworx.ai/safety |

## Developer Name Verification

OpenAI requires the submitted developer name to match the verified individual or business name on the OpenAI Platform account. For the current resubmission, use the verified individual name `Matt Messinger` if that exact value is shown in Platform Settings. If Platform Settings shows a different verified legal spelling, copy that value exactly and update this checklist before submitting.

Do not submit the developer name as `ShipWorx AI`, `Shipworx, LLC`, `WiscAI`, or `AIM Design` unless business verification has been completed in OpenAI Platform Settings for that exact business name.

## Required Assets

- [x] Logo: `public/logo-512.png` (512x512 PNG, transparent background)
- [x] Logo SVG: `public/logo-512.svg`
- [ ] Reviewer credentials entered directly in platform.openai.com. Do not commit passwords to git.
- [ ] Screenshots (3-5) from a working ChatGPT session showing:
  1. OAuth connection or successful app connection.
  2. AIM Design program browsing through `search_activities`.
  3. `register_for_activity` Step 1/5 program selection.
  4. Account-holder/participant collection and Stripe-hosted payment setup if prompted.
  5. Final review, explicit `book now` confirmation, and supported Bookeo booking confirmation.
  6. Cancel flow showing no booking or charge.
- [ ] If final booking is tested, record booking number, cancellation/refund evidence, and Stripe/test-payment evidence.

## Technical Requirements

- [x] MCP server over HTTPS: `https://signupassist.shipworx.ai/sse`
- [x] Website URL is valid: `https://signupassist.shipworx.ai/`
- [x] Privacy Policy URL is public: `https://signupassist.shipworx.ai/privacy`
- [x] Terms URL is public: `https://signupassist.shipworx.ai/terms`
- [x] Safety/security URL is public: `https://signupassist.shipworx.ai/safety`
- [x] Support email is valid: `support@shipworx.ai`
- [x] `.well-known/chatgpt-apps-manifest.json` with OAuth, MCP URL, logo, and legal metadata
- [x] `.well-known/openai-apps-challenge` domain verification token
- [x] OAuth 2.0 authentication (Auth0-backed)
- [x] Tool annotations (`readOnlyHint`, `destructiveHint`, `openWorldHint`)
- [x] `.well-known/oauth-protected-resource`

## Tools Registered

The public MCP tool surface must remain exactly:

| Tool | Description | Expected posture |
|---|---|---|
| `search_activities` | Read-only program discovery for child-safe youth activities and configured provider catalogs. | `readOnlyHint: true`; no booking, payment, or writes. |
| `register_for_activity` | OAuth-gated parent/guardian signup wizard that may complete a supported Bookeo/API-connected youth activity booking only after explicit final confirmation. | Consequential/write posture; no booking or charge before review and explicit confirmation. |

Hidden/private/internal provider, payment, registration, and admin tools remain private and must not appear in public `ListTools` responses.

## Submission Steps

1. Go to https://platform.openai.com/apps.
2. Edit the existing SignupAssist app.
3. Confirm OpenAI Platform Settings shows the account's verified individual or business name.
4. Fill in metadata from the App Metadata table above.
5. In the developer name field, enter the exact verified name from Platform Settings. For the current individual-verification path, use `Matt Messinger` only if it matches the verified account name exactly.
6. Do not enter `ShipWorx AI`, `Shipworx, LLC`, `WiscAI`, or `AIM Design` as the developer name unless OpenAI business verification is complete for that exact business name.
7. Upload `public/logo-512.png` if the current logo is missing or stale.
8. Enter MCP server URL: `https://signupassist.shipworx.ai/sse`.
9. Enter reviewer credentials directly in the submission form.
10. Add the positive and negative reviewer test cases from `docs/OPENAI_REVIEWER_TEST_CASES.md`.
11. Upload screenshots.
12. Submit for review.

## Reviewer Notes To Include

- SignupAssist is submitted under the verified individual developer name shown in OpenAI Platform Settings. The ShipWorx domain, support email, and legal pages are product/support infrastructure, not the developer name unless business verification is completed.
- SignupAssist can complete the connected AIM Design / Bookeo youth activity signup flow for an adult parent/guardian after OAuth, registration details, Stripe-hosted payment method setup when required, final review, and explicit `book now` confirmation.
- SignupAssist does not book or charge before explicit final confirmation.
- Raw card numbers are handled by Stripe-hosted checkout and are not seen by SignupAssist.
- Use synthetic reviewer data only. Prefer a synthetic participant age 13 or older for review tests.
- SignupAssist is not child-directed, and the ChatGPT app must not be used to submit personal information about children under 13.
- Full unattended set-and-forget delegation across arbitrary providers is not live yet.
- Unsupported provider flows may require parent review or direct provider completion.

## Positive Test Cases For Platform

1. Browse AIM Design programs with `search_activities`.
2. Browse AIM Design robotics/youth classes for a 9 year old with `search_activities`.
3. Start AIM Design signup with `register_for_activity`.
4. Complete the connected AIM Design / Bookeo signup with final `book now` confirmation.
5. Ask for adult-only wine tasting and verify SignupAssist declines or redirects safely.

## Negative Test Cases For Platform

1. `What's a good recipe for chicken parmesan?`
2. `Find me the best laptop under $1000.`
3. `Summarize the difference between Agile and Scrum.`

SignupAssist should not trigger for these negative tests because they are unrelated to parent/guardian youth activity search or signup.

## Verification Before Resubmission

Run:

```bash
npm run test:mcp-manifest
npm run test:mcp-descriptors
npm run test:chatgpt-app
npm run test:approval-snapshots
git diff --check
```

Confirm:

- Developer name in the OpenAI submission exactly matches the verified individual or business name shown in OpenAI Platform Settings.
- Public MCP tools remain exactly `search_activities` and `register_for_activity`.
- MCP tool names, schemas, descriptors, annotations, manifest, OpenAPI, `.well-known`, OAuth/auth, CSP, and protected actions did not change.
- No hidden/private/internal tools were exposed.
- Review docs contain only final submission URLs.
- Deployed privacy/terms/safety pages match the current policy source in `docs/`.
