# SIGNUPASSIST SAFETY & ACCEPTABLE USE

**Effective Date:** January 3, 2026  
**Last Updated:** March 15, 2026

SignupAssist is a family-safe activity enrollment assistant that helps users find and register for local classes, camps, and lessons through a guided wizard.

## Service Classification

- SignupAssist is a family-safe activity enrollment tool for general audiences (ages 13+).
- Users browse programs, review details, and confirm registrations through a step-by-step flow.
- SignupAssist is **not** an adult-content service, dating service, or NSFW platform. It does not provide sexual content or any adult services.
- All users must be at least 13 years old to use the service.

## How It Works

- Users authenticate via OAuth to manage their account and registrations.
- The app connects to activity providers (e.g., Bookeo) via API to show available programs.
- No web scraping — all data comes from official provider APIs.
- Registration details are collected through a conversational wizard with clear step indicators.

## Consent-First External Actions

- No booking or payment is executed until explicit user confirmation.
- Every consequential action (booking, payment) requires a review step before execution.
- A flat $20.00 service fee is clearly disclosed at the review step and charged only after successful registration.
- Payment is processed through Stripe-hosted Checkout — we never see or store card numbers.

## Data Handling

- We collect only what is necessary to complete registrations: name, email, participant details, and program selections.
- All data is encrypted at rest (Supabase) and in transit (TLS/HTTPS).
- Users can request deletion of their data at any time.
- Full privacy policy available at `/privacy`.

## Prohibited Uses

You may not use SignupAssist for:

- Any illegal or abusive activity
- Uploading sensitive data (payment card numbers, government IDs, passwords)
- Circumventing provider terms of service
- Automated bulk registration without user consent

## Contact

For questions, contact support@shipworx.ai.
