# SignupAssist Chrome Helper

This is the V1 desktop helper for supervised autopilot. It is intentionally isolated from the Vite app and MCP server builds.

## Scope

- Fills known, low-risk family profile fields.
- Imports a supervised run packet from the web app or a fetched helper code with provider, child, target session, price cap, readiness, and pause rules.
- Highlights safe non-final navigation buttons.
- Safe navigation only runs when Assist Mode is enabled.
- Highlights final submit, registration, checkout, purchase, payment, login, MFA, password, CAPTCHA, waiver, medical, allergy, card, prompt injection, and PHI-like fields as pause conditions.
- Pauses for provider mismatch, sold-out/waitlist language, and visible prices above the parent cap.
- Never clicks final submit, payment confirmation, waiver acceptance, or unknown required fields.

## DaySmart / Keva Alpha

The first provider slice is grounded in Keva Sports Center and stays fixture-tested only.

- Login pause: `chrome-helper/fixtures/daysmart-login.html`
- Participant fill: `chrome-helper/fixtures/daysmart-participant.html`
- Safe navigation happy path: `chrome-helper/fixtures/daysmart-safe-navigation.html`
- Safe navigation and price-cap coverage: `chrome-helper/fixtures/daysmart.html`
- Waiver, payment, and final-submit pause: `chrome-helper/fixtures/daysmart-waiver-payment.html`
- Sold-out and waitlist pause: `chrome-helper/fixtures/daysmart-soldout.html`

This helper slice does not claim live delegated DaySmart support. Other providers remain fixture-only until a separate provider-specific review explicitly approves more.

## First Provider Slice

`https://pps.daysmartrecreation.com/dash/index.php?action=Auth/login&company=keva`

The helper detects the Keva/DaySmart login page but does not log in for the parent. Login, password managers, CAPTCHA, waivers, payment, and final submit remain parent-controlled steps.

## Alpha Controls

- Use `Fetch helper code` to pull the current helper packet into the popup.
- Use the Assist Mode toggle to allow safe continue clicks on non-final navigation.
- Use `Safe continue` only after checking the visible page and the run summary.

## Local Install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose "Load unpacked".
4. Select this `chrome-helper` folder.

The helper only requests page access on the signupassist.shipworx.ai app, DaySmart/Dash/Keva provider pages, and local development hosts.

The helper stores local test profile data and the copied run packet in Chrome extension storage. The production V1 app creates the supervised run record and keeps billing/profile state in Supabase. Provider program fees stay on the provider site; SignupAssist Stripe billing is only for the $9/month membership in V1.
