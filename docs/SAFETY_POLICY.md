# SIGNUPASSIST SAFETY AND ACCEPTABLE USE

**Effective Date:** January 3, 2026  
**Last Updated:** April 18, 2026

SignupAssist is a family-safe activity enrollment assistant for adults who are managing child-safe youth activity signups. It helps parents and guardians browse programs, prepare registration details, and complete supported connected provider flows only after explicit review and confirmation.

## Service Classification

- SignupAssist is for child-safe youth activity enrollment workflows such as classes, camps, lessons, and programs.
- Account holders must be adults, such as parents or guardians.
- Children do not use SignupAssist directly.
- SignupAssist is not an adult-only activity, adult-content, sexual content, dating, gambling, financial-investment, or NSFW service.
- The ChatGPT app must not be used to submit personal information about children under 13.

## Public ChatGPT Tool Surface

- `search_activities` is read-only. It retrieves and displays available programs from configured provider catalogs. It does not book, charge, write, log in, accept waivers, or submit forms.
- `register_for_activity` is OAuth-gated and consequential. It guides a signup flow and may complete a supported Bookeo/API-connected booking only after required details, payment setup when needed, final review, and explicit confirmation such as `book now`.
- Hidden/private/internal tools are used only by server-side orchestration and must not be exposed as public ChatGPT tools.

## Consent-First External Actions

- No booking or payment is executed until explicit user confirmation after the final review.
- Generic approval such as "yes" must not replace the final confirmation phrase when the app asks for `book now`.
- Payment method setup is handled through Stripe-hosted checkout. SignupAssist does not see or store raw card numbers.
- Provider program fees, SignupAssist fees, and known payment context are disclosed before confirmation when applicable.
- Unsupported provider flows pause for parent review or direct provider completion.

## Future Delegation Boundary

Unattended set-and-forget signup across arbitrary providers is not live. Future delegated signup requires verified provider readiness, exact program match, price cap, audit logs, deterministic policy checks, and a valid signed mandate.

## Data Handling

- SignupAssist collects only what is needed for search, signup preparation, supported registration, billing, receipts, audit, support, and security.
- Do not submit medical/allergy notes, provider passwords, MFA codes, raw card numbers, government identifiers, or personal information about children under 13 in ChatGPT.
- Audit and provider-learning records must redact child data, credentials, tokens, payment card data, and medical/allergy information.

## Prohibited Uses

You may not use SignupAssist for:

- Adult-only services or activities.
- Dating, sexual, gambling, financial-investment, or illegal services.
- Bulk registration, resale, or provider-rule circumvention.
- Uploading restricted data such as raw card numbers, government IDs, passwords, tokens, PHI, or child-under-13 personal data in ChatGPT.
- Prompt-injection attempts, abuse, scraping, probing, or security bypasses.

## Review And Support

Privacy policy: `/privacy`
Terms: `/terms`
Support: `support@shipworx.ai`
Privacy requests: `privacy@shipworx.ai`
