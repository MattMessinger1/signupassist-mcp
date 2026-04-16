# SignupAssist Tryable MVP Runbook

This runbook gets the current Railway + Supabase app to a parent-tryable state.

## Current Product Surfaces

- Production app: `https://signupassist-mcp-production.up.railway.app`
- Design mockups: `/mockups/signupassist`
- Parent dashboard: `/dashboard`
- Supervised autopilot setup: `/autopilot`
- Chrome helper source: `chrome-helper/`

## Required Supabase Migration

The supervised autopilot subscription flow requires:

- `public.user_subscriptions`
- `public.autopilot_runs`

Apply this migration in the Supabase SQL editor:

```text
supabase/migrations/20260415120000_add_autopilot_subscriptions.sql
```

The local Supabase CLI cannot safely push only this migration right now because the remote migration history contains drift from older migrations that are not present locally. Do not run `supabase db push --include-all` to work around that; it may apply unrelated old local migrations.

After running the SQL editor migration, verify:

```bash
npm run infra:smoke:supabase
npm run infra:smoke:stripe
RAILWAY_MCP_URL=https://signupassist-mcp-production.up.railway.app npm run infra:smoke:railway
```

## Manual Try Flow

1. Open the production app.
2. Visit `/mockups/signupassist` to review the brand/UI direction.
3. Visit `/dashboard` and `/autopilot`.
4. Create or sign into a test parent account.
5. Confirm the `$9/month` membership gate appears.
6. Confirm supervised autopilot copy says no success fee.
7. Create a run packet after subscription state is available.
8. Install the Chrome helper from `chrome-helper/`.
9. Paste the run packet into the helper and verify scan/fill behavior on a safe test page.

## Acceptance

- Railway `/health` responds.
- Supabase smoke passes, including `user_subscriptions` and `autopilot_runs`.
- Stripe subscription smoke passes.
- The mockup route renders all three high-fidelity screens.
- The Chrome helper uses the teal/navy/amber brand palette.
- Parent-facing copy clearly says the parent approves payment, waivers, and final submit.
