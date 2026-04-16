# SignupAssist Chrome Helper

This is the V1 desktop helper for supervised autopilot. It is intentionally isolated from the Vite app and MCP server builds.

## Scope

- Fills known, low-risk family profile fields.
- Imports a supervised run packet from the web app with provider, child, target session, price cap, readiness, and pause rules.
- Highlights safe non-final navigation buttons.
- Highlights final submit, registration, checkout, purchase, payment, login, password, CAPTCHA, waiver, medical, allergy, card, and PHI-like fields as pause conditions.
- Pauses for provider mismatch, sold-out/waitlist language, and visible prices above the parent cap.
- Never clicks final submit, payment confirmation, waiver acceptance, or unknown required fields.

## First Provider Slice

The first MVP provider focus is DaySmart / Dash, grounded in Keva Sports Center:

`https://pps.daysmartrecreation.com/dash/index.php?action=Auth/login&company=keva`

The helper detects the Keva/DaySmart login page but does not log in for the parent. Login, password managers, CAPTCHA, waivers, payment, and final submit remain parent-controlled steps.

## Local Install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose "Load unpacked".
4. Select this `chrome-helper` folder.

The helper stores local test profile data and the copied run packet in Chrome extension storage. The production V1 app creates the supervised run record and keeps billing/profile state in Supabase. Provider program fees stay on the provider site; SignupAssist Stripe billing is only for the $9/month membership in V1.
