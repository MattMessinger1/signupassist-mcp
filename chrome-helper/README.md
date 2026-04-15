# SignupAssist Chrome Helper

This is the V1 desktop helper for supervised autopilot. It is intentionally isolated from the Vite app and MCP server builds.

## Scope

- Fills known, low-risk family profile fields.
- Highlights safe non-final navigation buttons.
- Highlights final submit, registration, checkout, purchase, payment, login, password, CAPTCHA, waiver, medical, allergy, and PHI-like fields as pause conditions.
- Never clicks final submit, payment confirmation, waiver acceptance, or unknown required fields.

## Local Install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose "Load unpacked".
4. Select this `chrome-helper` folder.

The helper stores local test profile data in Chrome extension storage. The production V1 app creates the supervised run record and keeps billing/profile state in Supabase.
