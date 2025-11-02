# Program Discovery Prompts - Implementation Summary

This document summarizes the implementation of all 12 prompt blocks for the SignupAssist program discovery flow.

## ✅ Implementation Status

All 12 prompt blocks have been implemented and integrated into the AIOrchestrator system.

### Block 1: System Prompt (SYSTEM__PROGRAM_DISCOVERY)
**File:** `mcp_server/ai/AIOrchestrator.ts` (lines 15-38)
**Purpose:** Defines SignupAssist's voice, tone, and Design DNA principles

**Key Points:**
- Chat rhythm: message → grouped cards → CTA
- Post-login: immediately fetch programs (no re-prompting)
- Group programs by theme (max 4 per group)
- Parent-friendly, warm, practical tone
- Security transparency built-in

### Block 2: Tool Guidance (TOOL_GUIDANCE__SESSION_REUSE_AND_FIND_PROGRAMS)
**File:** `mcp_server/ai/toolGuidance.ts`
**Purpose:** Session reuse logic and tool calling workflow

**Key Points:**
- Reuse valid `session_token` to avoid re-login
- Navigate directly to `/registration` (skip dashboard)
- Call Three-Pass Extractor for structured data
- Group and limit to 4 programs per theme
- Compose "message → cards → CTA"

### Block 3: Extractor Prompt (EXTRACTOR_PROMPT__PROGRAMS_ONLY)
**File:** `mcp_server/lib/threePassExtractor.ts`
**Purpose:** Three-pass AI extraction for program discovery

**Pass 1 (Vision):** Identify program containers from screenshot
**Pass 2 (HTML→Structured):** Extract fields (program_id, title, brief, age_range, schedule, season, price, status, cta_label, cta_href)
**Pass 3 (Validate):** Normalize IDs, currency, char limits (title ≤60, brief ≤90)

**Key Points:**
- Programs-only (not prerequisites or waivers)
- Extract exact text (no paraphrasing)
- Leave null if missing (never invent values)

### Block 4: Grouping Prompt (GROUPING_PROMPT__PROGRAM_THEMES)
**File:** `mcp_server/lib/programGrouping.ts`
**Purpose:** Classify programs into themes and rank

**Themes:**
- "Lessons & Classes"
- "Camps & Clinics"
- "Race Team & Events"
- "Other"

**Ranking:**
- "open" before "waitlist" before "full/closed"
- Soonest upcoming schedule first
- Shorter title wins ties

**Output:** Max 4 programs per theme

### Block 5: Post-Login Message (ASSISTANT__POST_LOGIN_STATUS)
**File:** `mcp_server/ai/messageTemplates.ts` (getPostLoginMessage)
**Usage:** `mcp_server/ai/AIOrchestrator.ts` (credentials_submitted handler)

**Template:**
```
🎿 You're securely logged in to {{provider_name}}. I'm pulling the latest programs now and sorting them by theme (lessons, camps, teams) so it's easy to browse. This uses your active session with the club—no extra logins needed. ⏳

(Your personal info stays private with {{provider_name}}; SignupAssist never stores card numbers.)
```

### Block 6: Loading Message (ASSISTANT__LOADING_STATUS)
**File:** `mcp_server/ai/messageTemplates.ts` (getLoadingMessage)
**Usage:** `mcp_server/ai/AIOrchestrator.ts` (handleProgramSearch - logged during fetch)

**Template:**
```
⏳ Grabbing the class list from the registration page and organizing it for you… one moment!
```

### Block 7: Programs Ready Message (ASSISTANT__PROGRAMS_READY)
**File:** `mcp_server/ai/messageTemplates.ts` (getProgramsReadyMessage)
**Usage:** `mcp_server/ai/AIOrchestrator.ts` (handleProgramSearch - before showing cards)

**Template:**
```
✅ I found {{counts.total}} program(s) at {{provider_name}}. I've grouped a few to get you started—tap any card to explore or enroll. If you'd like a different category, just say the word.
```

### Block 8: Grouped Cards Payload (UI_PAYLOAD__GROUPED_CARDS)
**File:** `mcp_server/ai/cardPayloadBuilder.ts`
**Purpose:** Structured card payload for UI rendering

**Structure:**
```json
{
  "type": "cards-grouped",
  "groups": [
    {
      "title": "Lessons & Classes",
      "cards": [
        {
          "title": "...",
          "subtitle": "schedule • age_range",
          "caption": "price • status",
          "body": "brief",
          "actions": [
            { "type": "link", "label": "Register", "href": "..." },
            { "type": "postback", "label": "Details", "payload": {...} }
          ]
        }
      ]
    }
  ],
  "cta": {
    "type": "chips",
    "options": [...]
  }
}
```

**Guidelines:**
- Max 4 cards per group on first render
- Hide groups with zero items
- "Show more" chips for long lists
- Visual rhythm: message → cards → CTA chips

### Block 9: No Programs Fallback (ASSISTANT__NO_PROGRAMS_FALLBACK)
**File:** `mcp_server/ai/messageTemplates.ts` (getNoProgramsMessage)
**Usage:** `mcp_server/ai/AIOrchestrator.ts` (handleProgramSearch - when programs.length === 0)

**Template:**
```
I couldn't find open programs at {{provider_name}} right now. That usually means signups haven't opened yet or everything's full.

• Want me to check a different category or nearby club?
• I can also keep an eye out and let you know when new sessions appear.

(Your login is still active—we won't ask you to re‑enter it.)
```

### Block 10: Session Expired Message (ASSISTANT__SESSION_EXPIRED)
**File:** `mcp_server/ai/messageTemplates.ts` (getSessionExpiredMessage)
**Usage:** `mcp_server/ai/AIOrchestrator.ts` (handleProgramSearch - when session token invalid)

**Template:**
```
Hmm, it looks like your provider login expired. Let's reconnect securely and I'll fetch the programs again. 🔐

(You'll sign in directly with {{provider_name}}; we don't store your password.)
```

### Block 11: Orchestrator Notes (ORCHESTRATOR_NOTES__PROGRAM_DISCOVERY)
**File:** `docs/ORCHESTRATOR_PROGRAM_DISCOVERY.md`
**Purpose:** Developer documentation for flow implementation

**Key Sequences:**
1. Provider confirmation → program discovery
2. Session reuse (if token valid) → `scp.find_programs`
3. Session expired → `scp.login` → `scp.find_programs`
4. Navigate to `/registration` (NOT `/dashboard`)
5. Call Three-Pass Extractor
6. Call Grouping Classifier
7. Emit: message → cards → CTA

**Edge Cases:**
- Empty results → No programs fallback
- Auth failure → Session expired message
- Extraction errors → Error recovery message

### Block 12: Selection Acknowledgement (ASSISTANT__ACK_SELECTION)
**File:** `mcp_server/ai/messageTemplates.ts` (getSelectionAckMessage)
**Usage:** `mcp_server/ai/AIOrchestrator.ts` (select_program handler)

**Template:**
```
Great choice! I'll pull the registration details for "{{program_title}}." If anything's required before sign‑up (like membership or a waiver), I'll let you know and help you through it. 🙌

(We'll confirm everything before submitting anything.)
```

## File Organization

```
mcp_server/ai/
├── AIOrchestrator.ts              # Main orchestrator (uses all prompts)
├── messageTemplates.ts            # Blocks 5-7, 9-10, 12 (assistant messages)
├── toolGuidance.ts                # Block 2 (session reuse logic)
└── cardPayloadBuilder.ts          # Block 8 (grouped cards structure)

mcp_server/lib/
├── threePassExtractor.ts          # Block 3 (program extraction)
└── programGrouping.ts             # Block 4 (theme classification)

docs/
└── ORCHESTRATOR_PROGRAM_DISCOVERY.md  # Block 11 (dev notes)
```

## Design DNA Compliance

All prompts enforce the SignupAssist Design DNA:

✅ **Message → Card → CTA Pattern**
- Every response follows predictable rhythm
- Assistant message first, then visual cards, then next-step CTA

✅ **Minimal Friction**
- Session reuse eliminates redundant logins
- Direct `/registration` navigation skips page hops
- Grouped display (max 4 per theme) prevents overwhelm

✅ **Transparency**
- Post-login security reassurance
- Loading messages set expectations
- Error messages explain and offer recovery

✅ **Parent-Friendly Tone**
- Warm, practical, encouraging
- No technical jargon or stack traces
- Light emoji usage for clarity

✅ **Audit-Friendly**
- All tool calls logged with session_id and user_id
- Session tokens persisted for correlation
- Explicit confirmation required before actions

## Testing Checklist

- [ ] Provider → Login → Programs flow works end-to-end
- [ ] Session reuse works (no re-login on second request)
- [ ] Empty results trigger fallback message
- [ ] Expired session triggers re-login prompt
- [ ] Programs grouped by theme (max 4 per group)
- [ ] Empty groups hidden
- [ ] All messages match exact template wording
- [ ] Selection acknowledgement shows before field probe
- [ ] Navigation goes to `/registration` not `/dashboard`
- [ ] Cards show correct structure (title, subtitle, caption, body, actions)

## Integration Points

### Frontend Integration
The grouped cards payload is designed to be rendered by React components:
- `groups[].cards[]` → Individual `ProgramCard` components
- `cta.options[]` → CTA chip buttons
- `actions[]` → Card action buttons (Register, Details)

### Backend Integration
The AIOrchestrator automatically:
- Calls `scp.find_programs` with session reuse
- Invokes Three-Pass Extractor on page HTML
- Classifies programs via GPT-5-mini
- Assembles message + cards + CTA response

### Audit Integration
Every step is logged via `mcp_server/lib/auditLogger.ts`:
- Login events
- Program search events
- Selection events
- Error events

## Next Steps

To extend this system:

1. **Add More Themes:** Update `ProgramTheme` type in `programGrouping.ts`
2. **Customize Card Layout:** Modify `buildProgramCard()` in `cardPayloadBuilder.ts`
3. **Add More Messages:** Extend `messageTemplates.ts` with new states
4. **Adjust Grouping Logic:** Tweak ranking criteria in `GROUPING_PROMPT__PROGRAM_THEMES`
5. **Session TTL:** Adjust session token expiry in `toolGuidance.ts` (currently 5 min)

## Credits

All prompt blocks designed to align with SignupAssist's ACP (Agentic Commerce Protocol) principles and Design DNA. Implemented for MCP-compatible orchestration with full audit trail support.
