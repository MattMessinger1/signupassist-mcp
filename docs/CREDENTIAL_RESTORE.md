# Credential Restore Guide

When you get decryption errors like "Unsupported state or unable to authenticate data", it usually means the credentials were encrypted with a different key than the current `CRED_SEAL_KEY`.

## Solution: Re-store Credentials

Use the `/tools/cred-store` endpoint to re-encrypt and store credentials with the current key.

### Method 1: Using the TypeScript Script (Recommended)

```bash
npx tsx scripts/restoreServiceCredential.ts
```

This will prompt you for:
- Provider (default: skiclubpro)
- Alias (default: Blackhawk Service Credential)
- Email
- Password

The script will:
1. Encrypt the credentials using the current `CRED_SEAL_KEY`
2. Store them in the database
3. Return the new credential ID

**Important:** Update your `SCP_SERVICE_CRED_ID` secret with the returned ID.

### Method 2: Using Bash Script

```bash
chmod +x scripts/restoreServiceCredential.sh
./scripts/restoreServiceCredential.sh
```

Requires:
- `MCP_SERVER_URL` environment variable
- `MCP_ACCESS_TOKEN` environment variable
- `jq` installed for JSON parsing

### Method 3: Direct cURL

```bash
curl -X POST https://signupassist-mcp-production.up.railway.app/tools/cred-store \
  -H "Authorization: Bearer YOUR_MCP_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "skiclubpro",
    "alias": "Blackhawk Service Credential",
    "email": "your-email@example.com",
    "password": "your-password"
  }'
```

Response:
```json
{
  "success": true,
  "id": "uuid-of-stored-credential",
  "alias": "Blackhawk Service Credential",
  "provider": "skiclubpro",
  "created_at": "2025-11-10T..."
}
```

## Update Environment Variable

After storing the credential, update your Supabase secret:

```bash
# In Supabase Dashboard → Settings → Edge Functions
# Update: SCP_SERVICE_CRED_ID = <new-credential-id>
```

Or using the Supabase CLI:
```bash
supabase secrets set SCP_SERVICE_CRED_ID=<new-credential-id>
```

## How It Works

1. **Encryption**: Uses Web Crypto API with AES-256-GCM
   - Same algorithm as Supabase Edge Functions
   - Random IV generated for each credential
   - Format: `base64(encrypted):base64(iv)`

2. **Storage**: Stored in `stored_credentials` table
   - Linked to system user (for service credentials)
   - Can be linked to regular users (for user credentials)

3. **Decryption**: The `credentials.ts` library handles decryption
   - Supports both system and user credentials
   - System credentials bypass JWT requirements
   - User credentials require valid JWT token

## Troubleshooting

### "CRED_SEAL_KEY not configured"
- Ensure `CRED_SEAL_KEY` is set in Railway environment variables
- The key must be a base64-encoded 256-bit key (32 bytes)

### "Unauthorized - Invalid or missing token"
- Check that `MCP_ACCESS_TOKEN` is correct
- Verify it matches the token configured in Railway

### "Database error"
- Check Supabase connection variables:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Verify RLS policies allow service role access

## Security Notes

- **Never commit credentials to git**
- Use environment variables or secure prompts
- The `/tools/cred-store` endpoint requires authentication
- Credentials are encrypted at rest in the database
- Only the service role can decrypt system credentials
