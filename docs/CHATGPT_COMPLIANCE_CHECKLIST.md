# ChatGPT App Store Compliance Checklist

## 🚨 REQUIRED FOR APP STORE APPROVAL

### 1. Legal Assets (CRITICAL)
- [ ] **Privacy Policy** at `https://signupassist.ai/privacy`
  - Must describe data collection, usage, and storage
  - Must explain how user consent works (Responsible Delegate model)
  - Must detail Stripe payment processing and success fee
  - Must explain mandate/authorization system
   
- [ ] **Logo Asset** at `https://signupassist-mcp-production.up.railway.app/logo-512.svg`
  - Must be reachable from the hosted ChatGPT Apps manifest
  - Currently specified in `public/.well-known/chatgpt-apps-manifest.json`

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

### 3b. ChatGPT Apps (MCP) Manifest Validity (REQUIRED)
- [x] `/.well-known/chatgpt-apps-manifest.json` must be **valid JSON** (single object)
- [x] `api.type` should be `mcp` with `api.server_url` pointing to `/sse` (apps via MCP)

### 4. Audit Trail Compliance (ALREADY DONE ✅)
- ✅ All API calls route through MCP tools
- ✅ `auditToolCall()` wraps every external service call
- ✅ Audit events stored in `audit_events` table
- ✅ Mandate system tracks all authorizations
- ✅ Responsible Delegate footer on all payment screens

### 5. PCI Compliance (FIXED ✅)
- ✅ **No in-app card input** - CardElement REMOVED
- ✅ **Stripe Checkout redirect** - Users redirected to Stripe-hosted page
- ✅ Card details never touch SignupAssist servers
- ✅ `SavePaymentMethod.tsx` now uses Stripe Checkout session
- ✅ `stripe-checkout-setup` edge function created
- ✅ `stripe-checkout-success` edge function created

### 6. Authentication Compliance (FIXED ✅)
- ✅ **No in-app password collection** - Password fields REMOVED
- ✅ **OAuth-first approach** - `OAuthConnectDialog.tsx` created
- ✅ API-first providers (Bookeo) don't need user credentials
- ✅ SignupAssist uses direct API access via API keys

### 7. PHI Compliance (FIXED ✅)
- ✅ **No medical/allergies data collection** - Fields REMOVED
- ✅ `sync-bookeo/index.ts` - allergies field removed from schema
- ✅ `ResponsibleDelegateForm.tsx` - no longer renders allergies field
- ✅ `APIOrchestrator.ts` - allergies removed from participant mapping
- ✅ `bookeo.ts` - allergies removed from interface and schema
- ✅ `fieldMapping.ts` - medical/allergies defaults removed
- ✅ `mockData.ts` - medical conditions mock data removed

### 8. Testing Before Submission
**Test with ChatGPT App Store Preview:**
1. OAuth flow works (user can authenticate via Auth0)
2. MCP tools are callable from ChatGPT
3. Audit trail populates correctly
4. Payment authorization creates mandate
5. Stripe Checkout redirect works (not in-app card input)
6. Registration form has no allergies/medical fields
7. No password input anywhere in the app
8. Privacy policy link works
9. Logo displays correctly

### 9. Natural Language Parsing (ChatGPT Compatibility) ✅
- ✅ **Program selection by title** - "The Coding Course" parsed and matched
- ✅ **Program selection by ordinal** - "the first one", "option 2" parsed
- ✅ **Child info parsing** - "Percy, 11" or "Percy Messinger, 11" extracted
- ✅ **Confirmation detection** - "Yes", "authorize", "go ahead" detected
- ✅ **Provider confirmation in BROWSE step** - "Yes" after clarification
- ✅ **Scheduled registration confirmation** - Handles scheduling flow
- ✅ **displayedPrograms context storage** - Enables title/ordinal matching
- ✅ **pendingProviderConfirmation tracking** - Enables "Yes" detection
- ✅ **Audit trail for NL actions** - All NL-parsed actions logged with `source: "natural_language"`

### 10. Multi-Participant & Secondary Actions (ChatGPT Flow) ✅
- ✅ **Multi-child parsing** - "Percy, 11 and Alice, 9" parsed into array
- ✅ **Sequential participant entry** - "Anyone else?" follow-up after each entry
- ✅ **Done detection** - "done", "that's all", "no more", "finished" recognized
- ✅ **Implicit done detection** - "ok", "proceed", "continue" with pending participants
- ✅ **Delegate email parsing** - "my email is x@y.com" extracted
- ✅ **Email collection flow** - Prompts for email when needed (unauthenticated users)
- ✅ **View registrations NL** - "show my registrations", "view bookings" detected
- ✅ **Cancel registration NL** - "cancel my booking", "remove registration" detected
- ✅ **View audit trail NL** - "show audit trail", "view history" detected
- ✅ **Enhanced location parsing** - "near Chicago", "Madison area" normalized before lookup
- ✅ **pendingParticipants context** - Tracks multi-participant collection state
- ✅ **pendingDelegateInfo context** - Tracks delegate info collection state
- ✅ **awaitingDelegateEmail context** - Tracks email collection step
- ✅ **All NL actions audit logged** - Secondary actions and participant parsing logged


## Current Implementation Status

### ✅ Completed
- User ID pipeline fixed (frontend → MCP server → orchestrator)
- Mock authentication toggle in test harness
- Stripe payment processing with audit compliance
- Bookeo booking integration with audit compliance
- Responsible Delegate proof of concept
- Two-tier form (delegate + participants)
- Set and Forget scheduled registrations
- **PCI Compliance: Stripe Checkout redirect (no CardElement)**
- **Auth Compliance: OAuth-first (no password fields)**
- **PHI Compliance: No allergies/medical data collection**
- **PII Storage: Supabase at-rest encryption (no VGS dependency)**

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

## Operational Requirement (V1)

### Scheduled execution worker (REQUIRED for Set-and-Forget)
- [ ] Deploy a separate always-on process that runs `npm run worker:scheduled`
- [ ] See: `docs/SCHEDULED_REGISTRATION_WORKER_RUNBOOK.md`

## Reference Files
- Manifest: `mcp/manifest.json`
- Auth0 integration: `mcp_server/index.ts` (needs JWT middleware)
- Audit compliance: `mcp_server/middleware/audit.ts`
- User ID pipeline: `mcp_server/index.ts` lines 1203, 1315, 1416
- APIOrchestrator: `mcp_server/ai/APIOrchestrator.ts` line 120
- Stripe Checkout: `supabase/functions/stripe-checkout-setup/index.ts`
- OAuth Dialog: `src/components/OAuthConnectDialog.tsx`
- Payment Method: `src/components/SavePaymentMethod.tsx` (Stripe Checkout redirect)
