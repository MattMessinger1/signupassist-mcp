# ChatGPT App Store Compliance Checklist

## 🚨 REQUIRED FOR APP STORE APPROVAL

### 1. Legal Assets (CRITICAL)
- [ ] **Privacy Policy** at `https://signupassist.ai/privacy`
  - Must describe data collection, usage, and storage
  - Must explain how user consent works (Responsible Delegate model)
  - Must detail Stripe payment processing and success fee
  - Must explain mandate/authorization system
  
- [ ] **Logo Asset** at `https://signupassist.ai/logo.png`
  - Must be 512x512 pixels
  - Must be PNG format
  - Currently specified in `mcp/manifest.json` line 18

### 2. Auth0 Production Configuration (REQUIRED)
- [ ] Add `AUTH0_CLIENT_ID` to Railway environment variables
- [ ] Add `AUTH0_CLIENT_SECRET` to Railway environment variables
- [ ] Implement JWT verification middleware in `mcp_server/index.ts`
- [ ] Extract `user_id` from Auth0 JWT `sub` claim for ChatGPT requests
- [ ] Update Auth0 Dashboard with correct callback URLs

### 3. OAuth Configuration (ALREADY DONE ✅)
- ✅ OAuth authorization URL configured in manifest
- ✅ OAuth token URL configured in manifest
- ✅ Redirect URLs set for ChatGPT OAuth flow
- ✅ Manifest available at `mcp/manifest.json`

### 4. Audit Trail Compliance (ALREADY DONE ✅)
- ✅ All API calls route through MCP tools
- ✅ `auditToolCall()` wraps every external service call
- ✅ Audit events stored in `audit_events` table
- ✅ Mandate system tracks all authorizations
- ✅ Responsible Delegate footer on all payment screens

### 5. Testing Before Submission
**Test with ChatGPT App Store Preview:**
1. OAuth flow works (user can authenticate via Auth0)
2. MCP tools are callable from ChatGPT
3. Audit trail populates correctly
4. Payment authorization creates mandate
5. Success fee charges correctly after booking
6. Privacy policy link works
7. Logo displays correctly

## Current Implementation Status

### ✅ Completed
- User ID pipeline fixed (frontend → MCP server → orchestrator)
- Mock authentication toggle in test harness
- Stripe payment processing with audit compliance
- Bookeo booking integration with audit compliance
- Responsible Delegate proof of concept
- Two-tier form (delegate + participants)
- Set and Forget scheduled registrations

### ⚠️ Missing for Production
1. Privacy policy content and hosting
2. Logo asset at public URL
3. Auth0 secrets in Railway
4. JWT verification middleware

## Next Steps

1. **Create Privacy Policy** (legal requirement)
2. **Upload logo to signupassist.ai** (512x512px PNG)
3. **Configure Auth0 in Railway** (add secrets)
4. **Implement JWT middleware** (extract user_id from ChatGPT requests)
5. **Test OAuth flow** with ChatGPT App Store preview
6. **Submit for review**

## Reference Files
- Manifest: `mcp/manifest.json`
- Auth0 integration: `mcp_server/index.ts` (needs JWT middleware)
- Audit compliance: `mcp_server/middleware/audit.ts`
- User ID pipeline: `mcp_server/index.ts` lines 1203, 1315, 1416
- APIOrchestrator: `mcp_server/ai/APIOrchestrator.ts` line 120
