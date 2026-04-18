# SHIPWORX LLC PRIVACY POLICY FOR SIGNUPASSIST

**Effective Date:** December 19, 2025  
**Last Updated:** April 18, 2026

This Privacy Policy explains how Shipworx LLC ("Shipworx," "we," "us," or "our") collects, uses, discloses, and protects information when you use SignupAssist, including the SignupAssist ChatGPT app, the SignupAssist MCP server, and related web services (collectively, the "Services").

When SignupAssist is used inside ChatGPT, OpenAI may also process your messages and app responses under OpenAI's own terms and privacy policy. This Privacy Policy covers what Shipworx receives and processes.

## 1. Who We Are

SignupAssist is an independent service operated by Shipworx LLC. We are not affiliated with, endorsed by, or sponsored by OpenAI.

Contact:

- Privacy requests: `privacy@shipworx.ai`
- Support: `support@shipworx.ai`
- Legal: `legal@shipworx.ai`

## 2. Scope And Eligibility

The Services are intended for users located in the United States. SignupAssist is used by adults, such as parents and guardians, to browse and prepare child-safe youth activity registrations. Account holders must be at least 18 years old.

SignupAssist is not directed to children. Children must not use the Services directly. SignupAssist is not for adult-only activities, dating, gambling, adult content, financial/investment services, or other non-youth registration services.

For the ChatGPT app, do not submit personal information about children under 13. You may use general age, grade, activity, and location information to search for programs, but do not provide a child under 13's name, date of birth, address, contact information, medical information, or other personal information in ChatGPT. If a provider requires information about a child under 13, complete that step directly with the provider or through a non-ChatGPT flow that is appropriate for that information.

## 3. Information We Collect

We aim to collect only what is reasonably necessary to provide the Services.

### Account And Authentication Information

If you authenticate or create an account, we may collect:

- Name and email address.
- Authentication identifiers, such as Auth0 user ID or related login metadata.
- Account preferences and settings.

### ChatGPT App Requests And Responses

When you use SignupAssist inside ChatGPT:

- ChatGPT sends app requests to our MCP server, including your prompt, selected tool, tool arguments, and conversation/session context needed to respond.
- We return app responses, such as program search results, signup wizard instructions, review summaries, confirmation status, and safe error messages.
- We may process prompt text to understand activity, provider, age/grade, location, signup intent, and safety boundaries.

We do not intentionally return unnecessary internal identifiers, debug logs, auth secrets, tokens, provider API keys, passwords, raw payment data, or raw medical/allergy information in ChatGPT app responses.

### Activity Search And Program Information

For read-only browsing, we may process:

- Activity type or search text.
- Age or grade range.
- City/state or provider name.
- Program titles, schedules, prices, availability, provider metadata, and signup path information returned by provider catalogs.

### Signup And Registration Information

For authenticated signup flows, we may collect and process:

- Account-holder name, email, and phone number if required by the provider.
- Participant name and date of birth only when appropriate for the provider flow and permitted for the channel being used.
- Program selection, session time, provider, price, confirmation number, receipt summary, and registration status.
- Review/confirmation decisions, cancellation requests, and support requests.

### Payment Information

SignupAssist uses Stripe-hosted payment setup and payment processing. We do not collect, receive, maintain, or store raw payment card numbers, CVV, or other PCI-regulated card data.

We may store limited payment metadata returned by Stripe, such as:

- Stripe customer or payment method identifiers.
- Card brand and last four digits.
- Payment status, amount, currency, timestamp, and success-fee receipt information.

### Audit, Mandate, And Safety Information

We may collect:

- Audit events showing what action was requested, when it happened, the policy decision, and the result.
- Time-limited authorization or mandate metadata, including allowed action, provider, program, price cap, expiration time, and confirmation status.
- Security, rate-limit, abuse-prevention, and operational logs.

### Automatically Collected Information

When you use our website, MCP server, or API, we may collect:

- IP address, approximate region, browser/device data, timestamps, requested endpoint, response status, and error events.
- Security signals used to protect the Services.

## 4. Restricted Data We Do Not Want You To Submit

Do not submit the following through SignupAssist:

- Raw payment card numbers, CVV, or other PCI-regulated payment card data.
- Protected health information (PHI), medical records, diagnoses, allergy notes, or medical accommodations.
- Government identifiers such as Social Security numbers or passport numbers.
- Provider passwords, MFA codes, one-time passcodes, API keys, auth tokens, or secrets.
- Personal information about children under 13 in the ChatGPT app.

If we become aware that Restricted Data was submitted, we may delete, redact, or de-identify it unless retention is required for legal, security, or dispute-resolution reasons.

## 5. How We Use Information

We use information to:

- Search provider catalogs and return relevant activity options.
- Run the authenticated signup wizard for supported providers.
- Prepare registration details and final review summaries.
- Complete a supported Bookeo/API-connected booking only after explicit user confirmation.
- Set up and process payments through Stripe-hosted flows.
- Maintain receipts, registration history, and audit trails.
- Authenticate users and protect accounts.
- Provide customer support.
- Monitor reliability, prevent abuse, and enforce safety boundaries.
- Improve the Services using aggregated, redacted, or de-identified data where practical.
- Comply with law and enforce our terms.

SignupAssist does not sell personal information and does not use personal information for third-party targeted advertising.

## 6. How We Share Information

We share information only as needed to operate the Services, follow your instructions, or comply with law.

| Category | Provider | Purpose | Data Shared |
|---|---|---|---|
| ChatGPT platform | OpenAI | App requests, app responses, and ChatGPT app operation | Prompt text, tool arguments, app responses |
| Activity registration | Bookeo/API-connected providers | Program search and supported bookings | Account-holder details, participant details when permitted, program selection |
| Payment processing | Stripe | Hosted payment setup and success-fee processing | Payment tokens/metadata, amount, status; not raw card numbers |
| Authentication | Auth0 | OAuth login and account security | Email, user identifier, auth metadata |
| Database/storage | Supabase | Store account, registration, audit, and operational records | Service data stored for your account |
| Hosting/operations | Railway and other infrastructure providers | Operate the server and monitor reliability | Logs and operational metadata |

We do not authorize service providers to use your information for their own marketing.

## 7. Provider Learning And Redaction

SignupAssist may use redacted learning signals to improve provider readiness, such as provider key, flow step names, non-PII field signatures, stop condition, outcome, and fixture coverage.

Provider learning must not store child names, dates of birth, addresses, phone numbers, medical/allergy details, credentials, tokens, raw payment data, or raw provider page content. Provider readiness cannot be promoted by model output or provider page text alone.

## 8. External Actions, Confirmation, And Future Delegation

SignupAssist is parent-controlled. The ChatGPT app can complete a supported Bookeo/API-connected booking only after OAuth, required registration details, Stripe-hosted payment setup when needed, final review, and explicit confirmation such as `book now`.

Unattended set-and-forget delegation across arbitrary providers is not live. Future delegated signup would require verified provider readiness, exact program match, price cap, audit logs, deterministic policy checks, and a valid signed mandate.

## 9. Data Retention

We retain information only as long as reasonably necessary:

| Data Type | Typical Retention |
|---|---|
| Account profile | Until deletion is requested or account is closed |
| Participant records | Until deleted or no longer needed for authorized registrations |
| Mandate/confirmation records | At least while active; historical records typically up to 90 days |
| Audit logs | Typically 90 days, longer if needed for disputes, compliance, or security |
| Registration confirmations | Typically up to 2 years |
| API/security logs | Typically 30 days, longer for security investigations |
| Stripe metadata | As needed for billing, receipts, refunds, disputes, and tax/accounting records |

## 10. Security

We use reasonable administrative, technical, and organizational safeguards, including TLS/HTTPS, encrypted storage, access controls, row-level security where applicable, audit logging, rate limits, and restricted internal access.

No method of transmission or storage is completely secure. If you believe your account or data is at risk, contact `support@shipworx.ai`.

## 11. Your Privacy Choices

You may request to:

- Access personal information associated with your account.
- Correct inaccurate information.
- Delete your account or participant records.
- Export audit or registration records where available.
- Ask questions about processing or retention.

Contact `privacy@shipworx.ai`. We may need to verify your identity before fulfilling requests.

## 12. State Privacy Rights

Depending on your state of residence, you may have additional rights to know, access, correct, delete, or opt out of certain processing. We do not sell personal information and do not share personal information for cross-context behavioral advertising.

## 13. Changes To This Policy

We may update this Privacy Policy from time to time. If we make material changes, we will update the "Last Updated" date and may provide additional notice.

## 14. Contact

Privacy requests: `privacy@shipworx.ai`
Support: `support@shipworx.ai`
Legal: `legal@shipworx.ai`

Mailing address:

```text
Shipworx LLC
Attn: Privacy
2800 E Enterprise Ave, Suite 333
Appleton, WI 54913
United States
```
