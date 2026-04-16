# SignupAssist V1 Autopilot

SignupAssist V1 introduces a supervised Chrome desktop autopilot for parent signups.

## Public Promise

Move fast when registration opens. SignupAssist fills the tedious parts, you approve the important parts, and cancellation is always one click away.

## Pricing

- Plan: SignupAssist Autopilot
- Price: $9/month
- Real supervised autopilot runs require an active subscription.
- Supervised autopilot does not charge a $20 success fee.
- Existing $20 success-fee logic remains in the codebase for the future fully automated Set and Forget product only.
- Program fees are paid directly to the activity provider on the provider site.

V1 billing copy:

- SignupAssist membership is $9/month.
- Program fees are paid directly to the provider.
- No success fee is charged for supervised autopilot.
- Success fees may apply later for fully automated Set and Forget registrations.

## Provider Payment

SignupAssist does not use Stripe to pay activity providers in V1. Stripe is only used for the SignupAssist membership.

The helper pauses at provider checkout, payment confirmation, and final submit. The parent uses the provider's saved payment method, browser autofill, wallet, or manual card entry directly on the provider site.

## Run Packet

The web app creates a supervised run packet for the Chrome helper. The packet includes:

- Provider playbook and target URL.
- Child/profile and target program/session.
- Registration open time and price cap.
- Preflight readiness checks.
- Allowed actions and stop conditions.
- Billing policy showing $0 supervised-autopilot success fee and the future Set and Forget success-fee amount.

The run packet is intentionally useful for V1 and future Set and Forget. V1 uses it for supervised filling and pause decisions. Future automation can use the same structure for scheduled launch, audit trails, price caps, and parent escalation.

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
