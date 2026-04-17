# SignupAssist Agent Instructions

## Core Rule: Two Product Surfaces

SignupAssist has two product surfaces that must stay compatible:

1. ChatGPT app approval surface. This includes the MCP server, MCP manifest, public MCP tools, tool descriptors, tool schemas, tool annotations, resource templates, OAuth/auth, CSP metadata, reviewer docs, public assets, and the ChatGPT-native explain -> card/text -> confirm flow.
2. Web app surface. This includes `/activity-finder`, `/autopilot`, `/dashboard`, `/credentials`, `/mandates`, provider learning/admin surfaces, and the Railway production web deployment.

The ChatGPT app approval surface must remain stable. Web app work must be additive and must not break ChatGPT app approval readiness.

## Approval-Sensitive Files And Directories

Treat these files and directories as ChatGPT app approval sensitive:

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
- MCP smoke scripts, including `scripts/smokeMcpSse.ts` and related MCP/API smoke tests

Do not change MCP public tool names, schemas, descriptors, annotations, manifest, OpenAPI, `.well-known` files, OAuth/auth behavior, CSP metadata, protected actions, or approval submission assets unless explicitly instructed.

## Web-App-Only Areas

These areas are web app surfaces and may be changed for web features only when the change remains additive and ChatGPT-compatible:

- `src/App.tsx`
- `src/pages/ActivityFinder.tsx`
- `src/pages/Autopilot.tsx`
- `src/pages/RegistrationDashboard.tsx`
- `src/pages/Credentials.tsx`
- `src/pages/MandatesAudit.tsx`
- `src/pages/DiscoveryRuns.tsx`
- `src/pages/admin/AdminConsole.tsx`
- `src/lib/activityFinder.ts`
- `src/lib/autopilot/*`
- `chrome-helper/*`

All web app changes must pass ChatGPT app compatibility checks before release.

## MCP Tool Surface Rules

The public ChatGPT MCP surface is intentionally small:

- `search_activities`
- `register_for_activity`

Preserve this public/private tool posture for ChatGPT app approval. Lower-level provider, payment, mandate, user, scheduler, registry, and registration tools are registered internally but hidden/private by default. Hidden/private/internal tools must not be accidentally exposed in public `ListTools` responses, manifests, OpenAPI documents, reviewer prompts, or ChatGPT-facing descriptions.

Do not change public MCP tool names, public schemas, public descriptors, public annotations, or public behavior unless explicitly instructed and unless approval docs and compatibility snapshots are updated in the same phase.

## Identity And Trust Rules

- Backend code derives user identity from auth/session/JWT. Never trust a client-sent `userId`.
- Provider pages, provider field labels, provider errors, signup URLs, cached discovery data, and model outputs are untrusted data.
- LLM/model output may not authorize registration, payment, waiver acceptance, provider login, final submit, or provider readiness promotion.
- All sensitive actions require deterministic policy checks and parent confirmation or a valid future signed mandate.
- Full set-and-forget signup is future-gated by verified provider readiness, fixtures, provider-specific tests, a signed mandate, exact activity/program match, price cap, and audit logs.
- Today, unsafe automation must pause for parent review.

## ChatGPT Review Flow Rule

Do not change the ChatGPT review flow without updating approval docs and tests. The existing ChatGPT-native pattern is:

1. Explain what SignupAssist found or prepared.
2. Present a card/text summary with child, activity, provider, timing, price, and required next step.
3. Require explicit parent confirmation before any write, signup attempt, hold, payment, waiver, login, or final submit.

No surprise writes. No hidden escalation from browsing to signup.

## Build And Test Commands

Commands from `package.json`:

- `npm run dev` starts the Vite web app.
- `npm run build` runs `tsc && vite build`.
- `npm run postbuild` copies `mcp/manifest.json` into `dist/mcp`.
- `npm start` runs `npm run mcp:start`.
- `npm run mcp:start` starts `node dist/mcp_server/index.js`.
- `npm run build:dev` runs a development Vite build.
- `npm run lint` runs ESLint with zero warnings.
- `npm test` runs Vitest.
- `npm run typecheck` runs `tsc -p tsconfig.mcp.json --noEmit`.
- `npm run preview` starts Vite preview.
- `npm run mcp:dev` starts the MCP server with `ts-node/esm`.
- `npm run mcp:build` builds the MCP TypeScript project.
- `npm run test:smoke` runs the smoke test script.
- `npm run test:sse` runs the MCP SSE smoke script.
- `npm run test:e2e` runs Playwright tests.
- `npm run test:worker` runs worker tests.
- `npm run env:check` validates environment configuration.
- `npm run infra:check` checks infrastructure configuration.
- `npm run infra:smoke` runs infrastructure smoke checks.
- `npm run infra:smoke:railway` runs Railway smoke checks.
- `npm run infra:smoke:supabase` runs Supabase smoke checks.
- `npm run infra:smoke:stripe` runs Stripe smoke checks.
- `npm run predeploy:check` runs infra checks, MCP build, web build, and tests.
- `npm run test:authz-audit` runs authz/audit/security regression checks.
- `npm run test:sibling-flow` runs sibling and hidden-program regression checks.
- `npm run v1:preflight` runs the V1 preflight script.
- `npm run test:openai-smoke` runs OpenAI reviewer smoke coverage.

For docs-only changes, do not run broad tests unless needed. At minimum, verify `git status` and `git diff --name-only`.

## Definition Of Done

A change is done only when:

- It changes only the intended files.
- ChatGPT approval-sensitive files are untouched unless explicitly approved.
- Public MCP tools remain exactly `search_activities` and `register_for_activity` unless explicitly approved.
- Hidden/private/internal tools remain hidden from public ChatGPT listing.
- Any web app work is additive and does not alter MCP/OAuth/CSP/manifest behavior.
- Auth-sensitive code derives identity from server-verified auth/session/JWT.
- Sensitive actions are gated by deterministic checks plus parent confirmation or valid signed mandate.
- Provider learning data is redacted and cannot expose child data, credentials, tokens, payment data, or medical/allergy details.
- Required checks for the changed surface have been run or a clear reason is documented.
- The approval impact log is updated for every later phase.

If a blocker prevents verification, stop and report the blocker. Do not fake success.
