# Orchestrator Notes: Program Discovery Flow

**ORCHESTRATOR_NOTES__PROGRAM_DISCOVERY (Block 11)**

This document outlines the under-the-hood behavior Lovable/AIOrchestrator should follow for the program discovery flow.

## Flow Sequence

### 1. Provider Confirmation
After the user confirms the provider, immediately proceed to program discovery.

### 2. Session Management
- **Attempt** `scp.find_programs` with existing `session_token` (if available)
- **If session_token is missing/invalid:**
  1. Run `scp.login` with saved credentials
  2. Capture the new `session_token`
  3. Call `scp.find_programs` with the fresh session
- **Persist** the `session_token` in context for 5 minutes (session reuse)

### 3. Navigation Target
**CRITICAL:** Ensure `scp.find_programs` navigates directly to `/registration` for the org.
- **DO NOT** route via `/dashboard`
- This ensures the extractor sees the canonical program list

### 4. Program Extraction
Call `EXTRACTOR_PROMPT__PROGRAMS_ONLY` to get structured program data:
```typescript
{
  programs: [
    {
      program_id: string,
      title: string,
      brief: string,
      age_range: string,
      schedule: string,
      season?: string,
      price: string,
      status: "open" | "waitlist" | "full" | "closed",
      cta_label: string,
      cta_href?: string
    }
  ]
}
```

### 5. Program Grouping
Call `GROUPING_PROMPT__PROGRAM_THEMES` to:
- Bucket programs into themes ("Lessons & Classes", "Camps & Clinics", "Race Team & Events", "Other")
- Sort within each theme by status (open first), soonest schedule, shortest title
- Trim to ≤4 programs per theme for first render

### 6. Response Assembly
**Emit in this exact order:**
1. **ASSISTANT__PROGRAMS_READY** message
2. **UI_PAYLOAD__GROUPED_CARDS** with the grouped results
3. Optional CTA chips for "Show more [Theme]"

### 7. Edge Cases

#### Empty Results
- **Emit:** `ASSISTANT__NO_PROGRAMS_FALLBACK`
- **Offer:** Retry button, category change, or nearby club search
- **Note:** Session is still active; don't force re-login

#### Auth Failure
- **Emit:** `ASSISTANT__SESSION_EXPIRED`
- **Action:** Provide "Reconnect" button
- **Note:** Reassure that password is not stored

#### Extraction Errors
- **Emit:** `ASSISTANT__ERROR_RECOVERY` (polite, actionable)
- **Action:** Provide "Retry" button
- **Note:** Never show stack traces or technical error codes

## Design DNA Enforcement

This sequencing enforces our Design DNA principles:

### Message → Cards → CTA
Every response follows the predictable rhythm:
1. Short assistant message explaining what's happening
2. Visual cards (grouped by theme)
3. Clear next-step CTA or chips

### Minimal Friction
- Session reuse eliminates redundant logins
- Direct `/registration` navigation skips unnecessary page hops
- Grouped display (max 4 per theme) prevents overwhelming parents

### Transparency
- Post-login message reassures about security
- Loading messages set expectations during extraction
- Error messages explain what happened and how to recover

### Audit-Friendly
- Every tool call is logged with session_id and user_id
- Session tokens are persisted for correlation
- All parent-facing actions require explicit confirmation

## Implementation Checklist

- [ ] `scp.find_programs` navigates to `/registration` (not `/dashboard`)
- [ ] Session token is reused when valid (≤5 min old)
- [ ] Three-Pass Extractor is called for program discovery
- [ ] Grouping classifier buckets programs by theme
- [ ] Max 4 cards per theme on first render
- [ ] Empty groups are hidden
- [ ] All messages follow template wording exactly
- [ ] Error states use parent-friendly language
- [ ] Session expiration triggers gentle re-login prompt
- [ ] Audit logs capture every step with metadata

## Tool Call Examples

### Finding Programs (with session reuse)
```typescript
const result = await callTool('scp.find_programs', {
  credential_id: context.credential_id,
  session_token: context.provider_session_token, // Reuse if valid
  org_ref: context.provider.orgRef,
  user_jwt: context.user_jwt,
  category: "lessons" // or "all"
});
```

### Login (when session expired)
```typescript
const loginResult = await callTool('scp.login', {
  credential_id: context.credential_id,
  org_ref: context.provider.orgRef,
  user_jwt: context.user_jwt
});

// Capture new session token
const sessionToken = loginResult.session_token;
```

### Grouping Programs
```typescript
import { groupProgramsByTheme } from '../lib/programGrouping.js';

const grouped = await groupProgramsByTheme(programs, 4); // Max 4 per theme
// Returns: { groups: [...], counts: { total, by_theme } }
```

### Building Card Payload
```typescript
import { buildGroupedCardsPayload } from './cardPayloadBuilder.js';

const payload = buildGroupedCardsPayload(grouped.groups, 4);
// Returns: { type: "cards-grouped", groups: [...], cta: {...} }
```

## Testing Strategy

1. **Happy Path:** Provider → Login → Programs → Grouped Cards
2. **Session Reuse:** Second request reuses token, no re-login
3. **Empty Results:** No programs triggers fallback message
4. **Session Expiry:** Expired token triggers re-login prompt
5. **Navigation:** Verify `/registration` is target (not `/dashboard`)
6. **Grouping:** Verify ≤4 cards per theme, empty groups hidden
7. **Message Accuracy:** All templates match exact wording from prompts

## References

- System Prompt: `SYSTEM__PROGRAM_DISCOVERY`
- Tool Guidance: `TOOL_GUIDANCE__SESSION_REUSE_AND_FIND_PROGRAMS`
- Extractor: `EXTRACTOR_PROMPT__PROGRAMS_ONLY`
- Grouping: `GROUPING_PROMPT__PROGRAM_THEMES`
- Messages: `ASSISTANT__*` templates in `messageTemplates.ts`
- Cards: `UI_PAYLOAD__GROUPED_CARDS` in `cardPayloadBuilder.ts`
