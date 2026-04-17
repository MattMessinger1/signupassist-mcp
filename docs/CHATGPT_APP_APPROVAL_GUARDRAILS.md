# ChatGPT App Approval Guardrails

## Current Flow Map

SignupAssist is configured as an MCP-based ChatGPT app.

1. ChatGPT discovers the app through `public/.well-known/chatgpt-apps-manifest.json` and related public assets.
2. The manifest points to the MCP server at `https://signupassist.shipworx.ai/sse`.
3. OAuth/Auth0 discovery and token exchange are served through the MCP server routes:
   - `/oauth/authorize`
   - `/oauth/token`
   - `/.well-known/oauth-protected-resource`
   - `/.well-known/oauth-authorization-server`
   - `/.well-known/openid-configuration`
   - `/.well-known/jwks.json`
4. ChatGPT connects through SSE or Streamable HTTP routes:
   - `/sse`
   - `/messages`
   - `/sse/messages`
   - `/mcp`
   - `/mcp/`
5. `ListTools` exposes only the public V1 tools by default.
6. Tool calls run through server-side auth and protected action checks.
7. User-facing registration flows follow explain -> card/text -> confirm before any consequential action.

## Public And Private Tool Posture

The public ChatGPT MCP surface is intentionally small:

- `search_activities`
- `register_for_activity`

Lower-level provider, payment, user, mandate, scheduler, registration, and registry tools may be registered internally but are hidden/private by default. They must not appear in public ChatGPT tool listings, app descriptors, reviewer docs, or public schema snapshots unless explicitly approved.

`MCP_LISTTOOLS_INCLUDE_PRIVATE=true` is an internal diagnostic posture only. It must not be enabled for public ChatGPT approval or production reviewer flows.

## Public MCP Tools

### `search_activities`

Purpose:

- Search for activity options and signup paths.
- Return parent-readable choices and context.
- Stay read-only.

Approval expectations:

- No writes.
- No registration attempts.
- No payment, waiver, login, hold, or final submit.
- Treat provider data and signup URLs as untrusted.

### `register_for_activity`

Purpose:

- Continue the existing ChatGPT-native registration preparation flow.
- Explain required details and produce the parent review/confirmation step.
- Perform consequential work only after explicit confirmation and deterministic policy checks.

Approval expectations:

- Preserve existing descriptor/schema/annotation behavior.
- Preserve consequential-action labeling.
- No surprise writes.
- No hidden escalation from search or explanation into signup, payment, waiver, login, or final submit.

## Approval-Sensitive Files

Do not change these without explicit approval and an updated approval impact log:

- `mcp/manifest.json`
- `mcp/openapi.json`
- `public/.well-known/*`
- `public/logo-512.*`
- `mcp_server/index.ts`
- `mcp_server/middleware/auth0.ts`
- `mcp_server/config/protectedActions.ts`
- `mcp_server/providers/*`
- `mcp_server/ai/APIOrchestrator.ts`
- `docs/CHATGPT_SUBMISSION_CHECKLIST.md`
- `docs/OPENAI_REVIEWER_TEST_CASES.md`
- `docs/REVIEW_TEST_ACCOUNT.md`
- `docs/SAFETY_POLICY.md`
- `docs/PRIVACY_POLICY.md`
- MCP smoke scripts, including `scripts/smokeMcpSse.ts` and related smoke coverage

Review harness files such as `src/pages/ChatTestHarness.tsx`, `src/pages/MCPChatTest.tsx`, `src/components/MCPChat.tsx`, `src/lib/chatMcpClient.ts`, and `src/lib/orchestratorClient.ts` are not public MCP descriptors, but changes can affect review testing and should be handled carefully.

## Tool Descriptor, Schema, And Annotation Requirements

- Public tool names remain `search_activities` and `register_for_activity`.
- Public input schemas must remain backward compatible.
- Public output shape and user-facing instructions must remain reviewer-safe.
- Tool descriptors must accurately describe read/write behavior.
- Tool annotations must preserve read-only vs consequential-action semantics.
- Internal/private tools must stay private unless explicitly approved.
- Any schema or descriptor change requires a compatibility snapshot update and reviewer prompt update.

## Auth And OAuth Requirements

- Production tool calls require verified auth unless an explicitly allowed read-only discovery path applies.
- Auth0 JWTs and/or server-side sessions determine user identity.
- Backend code must overwrite or ignore client-sent `userId` for user-specific writes.
- OAuth authorize/token/discovery routes must remain stable for ChatGPT approval.
- Protected action rules must not be weakened without explicit approval.
- Adding user-specific data exposure or writes requires OAuth/Auth0 coverage, RLS review, and reviewer test updates.

## No-Widget V1 Bridge Posture

The current V1 ChatGPT app posture avoids widget templates to reduce CSP and iframe review risk. The ChatGPT experience is native text/card confirmation rather than a custom iframe widget.

Do not introduce iframe widgets, resource templates, widget bridge code, or custom ChatGPT UI resources without explicit approval. If a future widget is added, update CSP metadata, resource templates, screenshots, reviewer prompts, and compatibility tests in the same phase.

## CSP Implications

Because the current V1 flow does not rely on widget templates, CSP/domain requirements should remain minimal and stable. Do not change CSP metadata, manifest domains, `.well-known` files, resource URIs, or public asset URLs unless explicitly instructed.

Any future iframe/widget work must define:

- Allowed connect domains.
- Allowed resource domains.
- Frame ancestors and embedding constraints.
- Widget resource URIs.
- UI bridge message contract.
- Screenshot and reviewer coverage.

## Explain -> Card/Text -> Confirm UX Pattern

The ChatGPT-native approval-safe UX is:

1. Explain the search result, registration status, or prepared action.
2. Present a concise card/text summary of provider, activity, child, schedule, price, required fields, and next step.
3. Ask for explicit parent confirmation before any consequential action.
4. Pause for parent review at login, waiver, payment, checkout, unknown required field, medical/allergy data, and final submit.

This pattern protects the parent and makes reviewer behavior predictable.

## No Surprise Writes

SignupAssist must not write, register, hold, charge, submit, accept, log in, or send provider data unless the user clearly asks for that action and the server passes deterministic policy checks.

Search and explanation flows are read-only. Preparation flows may create safe internal drafts or supervised run packets only when that behavior is clearly represented to the parent and protected by auth/audit controls.

## Privacy And Security Submission Checklist

- Public privacy policy is current.
- Safety policy is current.
- Reviewer test account instructions are current.
- OAuth/Auth0 scopes are minimal and documented.
- User identity is derived server-side.
- RLS and auth checks protect family data.
- No raw credentials, child data, tokens, payment data, or medical/allergy details are exposed through MCP tool results.
- Internal tools remain hidden from public ChatGPT listing.
- Consequential actions require confirmation.
- Audit trail behavior is documented.

## Screenshots And Test Prompts Checklist

Maintain reviewer evidence for:

- App discovery and OAuth flow.
- Search-only prompt using `search_activities`.
- Registration preparation prompt using `register_for_activity`.
- Confirmation prompt before a consequential action.
- Parent pause at payment, waiver, login, medical/allergy, or final submit boundary.
- Error handling for missing info or unavailable provider.
- Public tool list showing only `search_activities` and `register_for_activity`.
- Privacy/safety policy links and test account instructions.

## Compatibility Snapshot Test Plan

Before changing approval-sensitive behavior:

1. Snapshot public `ListTools` response.
2. Confirm only `search_activities` and `register_for_activity` are public.
3. Snapshot public tool schemas, descriptors, and annotations.
4. Compare `mcp/manifest.json` and public `.well-known` files.
5. Run MCP SSE smoke coverage.
6. Run OpenAI reviewer smoke prompts if available.
7. Verify OAuth discovery and token routes.
8. Verify no widget/resource template/CSP changes occurred unless explicitly approved.
9. Append results to `docs/APPROVAL_IMPACT_LOG.md`.

## What Cannot Change Without Explicit Approval

- Public MCP tool names.
- Public MCP tool schemas.
- Public MCP tool descriptors or annotations.
- Public/private tool visibility posture.
- MCP manifest.
- OpenAPI compatibility document.
- `.well-known` files.
- OAuth/Auth0 behavior.
- CSP metadata or widget resource templates.
- Protected action rules.
- Public logo or app identity assets.
- Reviewer test prompts, accounts, privacy docs, or safety docs.
- ChatGPT explain -> card/text -> confirm flow.
- Any behavior that changes search from read-only to consequential.
