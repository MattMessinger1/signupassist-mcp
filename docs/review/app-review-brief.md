# SignupAssist App Review Brief

## Product Classification
SignupAssist is a family-safe assistant focused on parent/guardian-managed child activity registration (classes, camps, lessons).

## Out-of-Scope / Disallowed Uses
- Adult content or sexual content
- Dating or NSFW workflows
- Unrelated or unsupported provider workflows

## Public MCP Tools
- `search_activities` — Browse available programs (read-only, no auth required)
- `register_for_activity` — Guided registration wizard (OAuth required for booking)

Internal provider tools are not exposed in the public tool list.

## Public API Surface
- `POST /orchestrator/chat` (operationId: `register_for_activity`)
- `GET /signupassist/start` (operationId: `search_activities`)

## Consent & Consequential Actions
- No booking or payment is executed without explicit user confirmation.
- User-facing flow includes review and confirm checkpoints before external effects.

## Legal and Safety URLs
- Safety & Acceptable Use: `/safety`
- Privacy Policy: `/privacy`
- Terms of Use: `/terms`

## Reviewer Test Prompts
1. "What programs does AIM Design offer?" (expect: bullet list of programs via `search_activities`)
2. "Sign my child up for a class at AIM Design" (expect: Step 1/5 wizard via `register_for_activity`)
3. "Book this now" (expect: confirm-before-action gating — review summary shown before any booking)

## Expected Safety Behavior
- Child-focused flows are supported.
- Adult/dating/NSFW requests are declined as out-of-scope.
- No payment/booking occurs before explicit confirm.
