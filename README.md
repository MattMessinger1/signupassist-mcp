# SignupAssist MCP

This repository implements the MCP (Mandated Control Protocol) agent for automating responsible delegate actions such as logging in, discovering fields, and submitting forms on behalf of parents with explicit mandates.

It provides:

- **Antibot-aware login flows**: Human-like typing, randomized delays, and detection of hidden honeypot fields (`antibot_key`) to mimic real user behavior.
- **Form submission helpers**: Functions that wait for Antibot JavaScript tokens to populate before submitting, to avoid rejection by Drupal-based providers like SkiClubPro.
- **Mandate + scope enforcement**: All actions are logged and tied to explicit parent mandates, creating a transparent audit trail.

## Future Build: Verifiable Credentials (VCs)

Looking ahead, we plan to extend MCP to use **W3C Verifiable Credentials** or **cryptographic client tokens** to bypass legacy Antibot measures responsibly.

- **Why?** Today, Antibot blocks legitimate delegate automation by treating all automation as bots.
- **How VCs help:** MCP can issue signed credentials proving:
  - Parent consent was granted.
  - Scope of action (login, registration, payment).
- **Provider integration:** Providers like SkiClubPro could add a Drupal module to validate MCP-issued tokens. This would allow them to **trust MCP clients** and skip Antibot/Honeypot checks when mandates are cryptographically verified.

This approach aligns with the **Responsible Delegate Mode (RDM)** vision: moving from mimicking humans to presenting cryptographic proof of authorization.

## Getting Started

- Clone this repo
- Deploy with Supabase Edge Functions + MCP server
- Configure provider credentials via `cred-get`
- **Set up Google Cloud API Key**: Enable the Places API in Google Cloud Console and add your API key to `.env` as `GOOGLE_PLACES_API_KEY` (required for provider search fallback)
- Run MCP server:
  ```bash
  npm run mcp:start
  ```

## Contributing

Future contributors should extend the `lib/login.ts` and `lib/formHelpers.ts` modules to:

- Add support for new providers.
- Integrate VC-based authentication once providers are ready.
- Expand Antibot detection and debugging capabilities.

## Discovery Learning Maintenance

The discovery learning system includes automatic maintenance to keep data fresh and efficient. A cron job runs the `maintenance-discovery` edge function to:

1. **Refresh best hints** - Updates the discovery hints cache (currently a no-op)
2. **Prune old runs** - Deletes discovery runs older than 90 days (keeps last 200 per provider/program/stage)
3. **Decay stale confidence** - Reduces confidence by 10% for hints not used in 45 days

### Setting up the Cron Job

To schedule the maintenance function to run daily at 2 AM UTC, execute this SQL in your Supabase SQL editor:

```sql
-- Enable required extensions (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule daily maintenance at 2 AM UTC
SELECT cron.schedule(
  'discovery-maintenance-daily',
  '0 2 * * *', -- Every day at 2 AM UTC
  $$
  SELECT
    net.http_post(
      url:='https://YOUR_PROJECT_REF.supabase.co/functions/v1/maintenance-discovery',
      headers:='{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb,
      body:='{}'::jsonb
    ) as request_id;
  $$
);

-- View scheduled jobs
SELECT * FROM cron.job;

-- To unschedule (if needed)
-- SELECT cron.unschedule('discovery-maintenance-daily');
```

**Important**: Replace `YOUR_PROJECT_REF` with your Supabase project reference and `YOUR_ANON_KEY` with your project's anon key.

### Manual Execution

You can also trigger maintenance manually via HTTP:

```bash
curl -X POST 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/maintenance-discovery' \
  -H 'Authorization: Bearer YOUR_ANON_KEY' \
  -H 'Content-Type: application/json'
```

The function returns a summary:

```json
{
  "timestamp": "2025-10-06T02:00:00.000Z",
  "hintsRefreshed": true,
  "runsDeleted": 42,
  "hintConfidenceDecayed": 7,
  "errors": []
}
```
