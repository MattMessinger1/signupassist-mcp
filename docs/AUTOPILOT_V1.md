# SignupAssist V1 Autopilot

SignupAssist V1 introduces a supervised Chrome desktop autopilot for parent signups.

## Public Promise

Move fast when registration opens. SignupAssist fills the tedious parts, you approve the important parts, and cancellation is always one click away.

## Pricing

- Plan: SignupAssist Autopilot
- Price: $9/month
- Real supervised autopilot runs require an active subscription.
- Existing $20 success-fee logic remains separate for API-backed, scheduled, or premium completion flows.

## Trust-First Cancellation

Cancellation is part of the product promise:

- The dashboard shows billing status and renewal timing.
- Parents can cancel monthly renewal immediately after subscribing.
- The post-run billing surface keeps cancellation visible.
- Canceling renewal does not delete profiles or run history.
- Access continues through the paid period when Stripe reports a current period end.

Cancellation confirmation copy:

> You won't be charged again. Access continues until [date].

## Supervised Autopilot Rules

The helper may:

- Fill known family profile fields.
- Select a matched child or participant.
- Select an exact matched program/session.
- Click safe non-final navigation buttons.
- Record every pause and approval.

The helper must pause for:

- Login, 2FA, CAPTCHA, or password manager prompts.
- Waiver, legal release, consent, or policy acceptance.
- Payment screens or payment confirmation.
- Final submit, register, checkout, or purchase buttons.
- Unknown required fields.
- Medical, allergy, disability, insurance, or PHI-like fields.
- Price above cap or changed total.
- Program/session mismatch.
- Sold-out, waitlist, or substitution states.

Final submit always requires explicit parent approval with provider, child, program/session, price, and submitted details visible.

## Provider Playbooks

Verified V1 playbooks:

- ACTIVE / ActiveNet
- DaySmart / Dash
- Amilia
- CivicRec / RecDesk
- CampMinder

Other providers run in generic beta mode with conservative pauses. Speed claims apply only to verified providers with fixture coverage.
