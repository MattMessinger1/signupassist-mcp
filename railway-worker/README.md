# Railway Signup Worker

This worker handles automated SkiClubPro registrations using Browserbase and Playwright.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Environment variables:**
   Create a `.env` file with:
   ```env
   PLAN_ID=uuid-of-the-plan-to-execute
   SB_URL=https://your-project.supabase.co
   SB_SERVICE_ROLE_KEY=your-service-role-key
   BROWSERBASE_API_KEY=your-browserbase-api-key
   BROWSERBASE_PROJECT_ID=your-browserbase-project-id
   CRED_SEAL_KEY=encryption-key-for-credentials
   MANDATE_SIGNING_KEY=jwt-signing-key-for-mandates
   ```

3. **Build and run:**
   ```bash
   npm run build
   npm start
   ```

## How it works

1. **Plan Lookup**: Fetches plan data from Supabase using PLAN_ID
2. **Credential Decryption**: Uses cred-get to decrypt stored login credentials
3. **Mandate Verification**: Verifies JWT mandate and extracts registration answers
4. **Browserbase Session**: Launches automated browser session
5. **Pre-warming**: Logs into SkiClubPro with credentials
6. **Wait for Opening**: Sleeps until the registration opens_at time
7. **Registration**: Submits registration form with answers from mandate
8. **Payment**: Processes $20 signup fee if required
9. **Audit Trail**: Logs everything to plan_executions, mcp_tool_calls, evidence_assets, charges

## Railway Integration

This worker is designed to be deployed on Railway and triggered by the `start-signup-job` Supabase Edge Function.

### Railway Configuration

1. Connect your GitHub repository to Railway
2. Set up environment variables in Railway dashboard
3. Configure deployment triggers
4. Worker will be auto-deployed when jobs are started

### Monitoring

- Check Railway logs for worker output
- Monitor Supabase tables for audit trail:
  - `plan_executions`: Overall job status
  - `mcp_tool_calls`: Individual tool invocations
  - `evidence_assets`: Screenshots and evidence
  - `charges`: Payment records

## Error Handling

The worker includes comprehensive error handling:
- Screenshots on errors
- Detailed logging to console and database
- Graceful cleanup of browser sessions
- Proper status updates in plan_executions

## Security

- Credentials are encrypted at rest and decrypted only during execution
- Mandates are JWT-signed with expiration times
- All operations are audited in the database
- Sensitive data is not logged

## Testing

For local testing:
```bash
PLAN_ID=your-test-plan-id npm run dev
```

Make sure you have valid test credentials and a test plan in your Supabase database.