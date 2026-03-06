# Safety Evidence (Reviewer Quick Links)

This note is a reviewer-focused map of where safety behavior is enforced and how to verify it quickly.

## 1) Guardrail behavior + boundary location (`/orchestrator/chat`)

- Guardrails are intentionally applied at the HTTP boundary for deterministic behavior, called out directly in the server header comments. See [`mcp_server/index.ts`](../../mcp_server/index.ts).
- The boundary route is `POST /orchestrator/chat`, and the child-scope guardrail runs before orchestrator/tool dispatch. See [`mcp_server/index.ts`](../../mcp_server/index.ts).
- Blocking behavior:
  - evaluates user message + payload via `evaluateChildRegistrationScope`
  - records `guardrail_blocked_request`
  - increments counters
  - returns out-of-scope envelope immediately (HTTP 200)

Quick verification links:
- Guardrail-at-boundary comment: [`mcp_server/index.ts#L11`](../../mcp_server/index.ts#L11)
- `/orchestrator/chat` route: [`mcp_server/index.ts#L4059`](../../mcp_server/index.ts#L4059)
- Guardrail evaluation + block path: [`mcp_server/index.ts#L4100-L4129`](../../mcp_server/index.ts#L4100-L4129)
- Matching logic (adult vs child cues + multilingual/obfuscation handling): [`mcp_server/lib/childScopeGuardrail.ts`](../../mcp_server/lib/childScopeGuardrail.ts)

## 2) Out-of-scope envelope contract

Canonical out-of-scope response shape is built by `buildChildScopeOutOfScopeResponse()`:

- `message: string`
- `metadata.suppressWizardHeader: true`
- `metadata.outOfScope: true`
- `metadata.reason: 'adult_signup_request'`
- `context.step: 'BROWSE'`

Contract source:
- Interface + builder: [`mcp_server/lib/childScopeGuardrail.ts#L11-L23`](../../mcp_server/lib/childScopeGuardrail.ts#L11-L23), [`mcp_server/lib/childScopeGuardrail.ts#L170-L180`](../../mcp_server/lib/childScopeGuardrail.ts#L170-L180)

Contract tests:
- Unit envelope contract: [`tests/orchestratorBoundaryOutOfScope.test.ts`](../../tests/orchestratorBoundaryOutOfScope.test.ts)
- Guardrail unit suite (including `outOfScope=true` envelope expectation): [`tests/childScopeGuardrail.test.ts`](../../tests/childScopeGuardrail.test.ts)
- Integration (`/orchestrator/chat`) response shape: [`tests/orchestratorChat.outOfScope.integration.test.ts`](../../tests/orchestratorChat.outOfScope.integration.test.ts)

## 3) Telemetry counters and where to inspect them

Counters emitted on block:

- `guardrail.child_scope.blocked_total`
- `guardrail.child_scope.blocked_adult_signup_total`

Emission points:
- Counter increment calls at boundary: [`mcp_server/index.ts#L4119-L4122`](../../mcp_server/index.ts#L4119-L4122)

Telemetry plumbing:
- Counter/event storage API: [`mcp_server/lib/telemetry.ts`](../../mcp_server/lib/telemetry.ts)
- Debug endpoint (opt-in): `GET /debug/telemetry`
- Clear endpoint (opt-in): `POST /debug/telemetry/clear`
- Endpoint response contains `counters` and `events.blockedRequests`

Inspection points:
- Debug endpoint implementation + payload fields: [`mcp_server/index.ts#L2907-L2937`](../../mcp_server/index.ts#L2907-L2937)
- Debug endpoint access controls (disabled / 403 / token-authorized): [`tests/telemetryDebugAccess.integration.test.ts`](../../tests/telemetryDebugAccess.integration.test.ts)
- Counter behavior unit test: [`tests/telemetryCounters.test.ts`](../../tests/telemetryCounters.test.ts)
- End-to-end blocked counter assertion: [`tests/orchestratorChat.outOfScope.integration.test.ts#L111-L117`](../../tests/orchestratorChat.outOfScope.integration.test.ts#L111-L117)

## 4) Parental consent + PII protections

### Parental consent / age guardrails

Evidence tests (reviewer-facing):
- Under-18 delegate profile rejection + child-write gating by parental consent + allow-path when consent true:
  - [`mcp_server/tests/user_parental_consent.test.ts`](../../mcp_server/tests/user_parental_consent.test.ts)

Runtime age protection in child creation:
- Child create rejects participants age `>= 18` with explicit recovery guidance:
  - [`mcp_server/providers/user.ts#L255-L264`](../../mcp_server/providers/user.ts#L255-L264)

### PII handling protections

Application-layer encryption for PII fields:
- AES-256-GCM envelope (`v`, `alg`, `kid`, `iv`, `ciphertext`, `tag`): [`mcp_server/utils/piiCrypto.ts`](../../mcp_server/utils/piiCrypto.ts)
- Key loading from env (`PII_ENCRYPTION_KEY`, optional keyring JSON): [`mcp_server/utils/piiCrypto.ts#L31-L55`](../../mcp_server/utils/piiCrypto.ts#L31-L55)

Provider integration points:
- Delegate/child decrypt-on-read helpers: [`mcp_server/providers/user.ts#L25-L58`](../../mcp_server/providers/user.ts#L25-L58)
- Child write encrypts `first_name`, `last_name`, `dob`: [`mcp_server/providers/user.ts#L277-L287`](../../mcp_server/providers/user.ts#L277-L287)
- Child update re-encrypts changed PII fields: [`mcp_server/providers/user.ts#L413-L426`](../../mcp_server/providers/user.ts#L413-L426)
- Delegate profile update encrypts profile PII (`first_name`, `last_name`, `phone`, `email`, `date_of_birth`): [`mcp_server/providers/user.ts#L543-L566`](../../mcp_server/providers/user.ts#L543-L566)

## 5) Key tests and commands

Suggested reviewer command sequence (fast confidence path):

```bash
npm run mcp:build
npx vitest run tests/childScopeGuardrail.test.ts tests/orchestratorBoundaryOutOfScope.test.ts tests/telemetryCounters.test.ts
npx vitest run tests/orchestratorChat.outOfScope.integration.test.ts tests/telemetryDebugAccess.integration.test.ts
npx vitest run mcp_server/tests/user_parental_consent.test.ts
```

Test files linked above:
- [`tests/childScopeGuardrail.test.ts`](../../tests/childScopeGuardrail.test.ts)
- [`tests/orchestratorBoundaryOutOfScope.test.ts`](../../tests/orchestratorBoundaryOutOfScope.test.ts)
- [`tests/telemetryCounters.test.ts`](../../tests/telemetryCounters.test.ts)
- [`tests/orchestratorChat.outOfScope.integration.test.ts`](../../tests/orchestratorChat.outOfScope.integration.test.ts)
- [`tests/telemetryDebugAccess.integration.test.ts`](../../tests/telemetryDebugAccess.integration.test.ts)
- [`mcp_server/tests/user_parental_consent.test.ts`](../../mcp_server/tests/user_parental_consent.test.ts)
