# SignupAssist MCP — Store Readiness Plan

## Executive Summary

SignupAssist MCP is ~90% ready for ChatGPT App Store submission. For the Claude Marketplace, the main gap is that the AI backend is OpenAI-only — we need to add Claude as an alternative AI provider. This plan covers both tracks.

---

## Track A: ChatGPT App Store Readiness

### Current Status: Nearly Ready

| Requirement | Status | Notes |
|---|---|---|
| MCP server over HTTPS | ✅ | Railway production endpoint |
| `.well-known/chatgpt-apps-manifest.json` | ✅ | Proper manifest with OAuth, MCP URL, logo |
| `.well-known/openai-apps-challenge` | ✅ | Domain verification token present |
| OAuth 2.0 authentication | ✅ | Auth0-backed, OpenAI callback URLs configured |
| Tool annotations (`readOnlyHint`, `destructiveHint`, `openWorldHint`) | ✅ | Both `signupassist.start` and `signupassist.chat` annotated |
| Privacy policy | ✅ | `/safety` endpoint + `PRIVACY_POLICY.md` |
| Contact email | ✅ | `support@shipworx.ai` |
| Logo (512×512 SVG) | ✅ | `public/logo-512.svg` |
| CI/CD + tests | ✅ | PR gatekeeper, OpenAI smoke tests, 23 test files |
| `.well-known/oauth-protected-resource` | ✅ | Implemented in server |

### Remaining Items (A1–A5)

#### A1. PNG Logo for Submission Form (REQUIRED)
OpenAI's submission form requires a 512×512 **PNG** icon. Currently only SVG exists.

**Action**: Convert `public/logo-512.svg` → `public/logo-512.png` (512×512, transparent background). Add to `public/` and reference in manifests.

**Files**: `public/logo-512.png` (new)

#### A2. Submission Metadata & Screenshots (REQUIRED)
OpenAI requires: app name (≤100 chars), description, 3–5 screenshots, privacy policy URL, support email, company info.

**Action**: Create a `docs/CHATGPT_SUBMISSION_CHECKLIST.md` with all required metadata pre-filled and note screenshot requirements. Screenshots need to be captured from a working ChatGPT session showing the app in action.

**Files**: `docs/CHATGPT_SUBMISSION_CHECKLIST.md` (new)

#### A3. Verify Tool Descriptions Compliance (RECOMMENDED)
OpenAI guidelines say: no promotional language, no comparative language, no overly-broad triggering. Current descriptions look clean but should be audited.

**Action**: Review tool name/description in `mcp_server/index.ts` against [OpenAI App Submission Guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines). Ensure descriptions are factual and scoped.

**Files**: `mcp_server/index.ts` (review only, likely no changes needed)

#### A4. Formal Test Cases for Reviewers (RECOMMENDED)
OpenAI reviewers will test the app using scenarios you provide. Having clear, realistic test prompts improves approval speed.

**Action**: Create `docs/OPENAI_REVIEWER_TEST_CASES.md` with 5–8 test scenarios including:
- "Show me robotics classes for kids in [city]" → triggers `signupassist.start`
- "Sign my daughter up for art camp" → triggers `signupassist.chat`
- Expected outputs for each

**Files**: `docs/OPENAI_REVIEWER_TEST_CASES.md` (new)

#### A5. Error Message Audit (NICE-TO-HAVE)
Ensure all error paths return user-friendly messages rather than raw stack traces or internal codes.

**Action**: Grep for `throw`, `catch`, error response patterns in MCP tool handlers and verify they return clean text.

**Files**: `mcp_server/index.ts`, `mcp_server/ai/APIOrchestrator.ts` (review, spot-fix if needed)

---

## Track B: Claude Marketplace Readiness

### Current Status: MCP Protocol Ready, AI Backend Needs Claude Support

The MCP protocol layer uses `@modelcontextprotocol/sdk` which is provider-agnostic — Claude can already connect to the MCP server. However, the **AI orchestration** (intent parsing, NLP, program matching) is OpenAI-only. The Claude Marketplace requires apps be "Claude-powered."

### Architecture for Dual-Provider Support

The current AI call sites are concentrated in ~7 files:
1. `mcp_server/lib/oai.ts` — OpenAI client singleton + model config
2. `mcp_server/lib/openaiHelpers.ts` — `callOpenAI_JSON()`, `callOpenAI_Text()`, safe parsing
3. `mcp_server/lib/intentParser.ts` — uses OpenAI for intent classification
4. `mcp_server/lib/aiIntentParser.ts` — AI-powered intent parsing
5. `mcp_server/ai/APIOrchestrator.ts` — imports `callOpenAI_JSON`
6. `mcp_server/ai/AIOrchestrator.ts` — AI orchestration
7. `mcp_server/ai/preLoginNarrowing.ts` — pre-login AI calls
8. `mcp_server/ai/aapTriageTool.ts` — triage tool
9. `mcp_server/ai/aapDiscoveryPlanner.ts` — discovery planner

**Strategy**: Create a provider-agnostic AI abstraction layer that dispatches to OpenAI or Claude based on an `AI_PROVIDER` env var. Both providers use similar chat completion APIs, so the abstraction is straightforward.

### Implementation Steps (B1–B6)

#### B1. Add Anthropic SDK Dependency (REQUIRED)
**Action**: `npm install @anthropic-ai/sdk`

**Files**: `package.json`

#### B2. Create AI Provider Abstraction Layer (REQUIRED)
Create a new `mcp_server/lib/aiProvider.ts` that:
- Exports `callAI_JSON()` and `callAI_Text()` with the same signatures as current `callOpenAI_*`
- Reads `AI_PROVIDER` env var (`openai` | `claude`, default: `openai`)
- Dispatches to OpenAI or Claude implementation
- Handles model mapping (e.g., `gpt-4o` → `claude-sonnet-4-6`)

```typescript
// mcp_server/lib/aiProvider.ts
const AI_PROVIDER = process.env.AI_PROVIDER || "openai";

export async function callAI_JSON(opts: AICallOpts): Promise<any> {
  if (AI_PROVIDER === "claude") return callClaude_JSON(opts);
  return callOpenAI_JSON(opts);
}
```

**Files**:
- `mcp_server/lib/aiProvider.ts` (new)
- `mcp_server/lib/claudeHelpers.ts` (new — Claude-specific implementation)

#### B3. Create Claude Helpers (REQUIRED)
Mirror `openaiHelpers.ts` for Claude:
- `callClaude_JSON()` — chat completion with JSON parsing
- `callClaude_Text()` — plain text completion
- Handle Claude-specific parameters (no `response_format`, use system prompts for JSON)
- Map temperature, max_tokens, etc.

**Files**: `mcp_server/lib/claudeHelpers.ts` (new)

#### B4. Update Call Sites to Use Provider Abstraction (REQUIRED)
Replace direct `callOpenAI_*` imports with `callAI_*` in all 7+ files listed above.

**Files**:
- `mcp_server/lib/intentParser.ts`
- `mcp_server/lib/aiIntentParser.ts`
- `mcp_server/ai/APIOrchestrator.ts`
- `mcp_server/ai/AIOrchestrator.ts`
- `mcp_server/ai/preLoginNarrowing.ts`
- `mcp_server/ai/aapTriageTool.ts`
- `mcp_server/ai/aapDiscoveryPlanner.ts`
- (any other files importing from `openaiHelpers.ts` or `oai.ts`)

#### B5. Add Environment Variables (REQUIRED)
Add to `.env.example`:
```
# AI Provider: "openai" (default) or "claude"
AI_PROVIDER=openai

# Anthropic (required if AI_PROVIDER=claude)
ANTHROPIC_API_KEY=
CLAUDE_MODEL=claude-sonnet-4-6
CLAUDE_MODEL_VISION=claude-sonnet-4-6
```

**Files**: `.env.example`

#### B6. Claude Marketplace Application Prep (REQUIRED)
The Claude Marketplace is in limited preview and requires applying through the partner waitlist.

**Action**:
- Create a `docs/CLAUDE_MARKETPLACE_SUBMISSION.md` documenting readiness
- Prepare application materials highlighting: enterprise audit logging, mandate system, family-safe design, MCP compliance
- Note: The partner waitlist is at [claude.com/platform/marketplace](https://claude.com/platform/marketplace)

**Files**: `docs/CLAUDE_MARKETPLACE_SUBMISSION.md` (new)

---

## Track C: General Repo Quality (NICE-TO-HAVE)

These don't block either submission but improve overall quality:

| Item | Priority | Notes |
|---|---|---|
| C1. Incomplete provider stubs (DaySmart, CampMinder) | Low | TODOs only — not exposed as tools, won't affect review |
| C2. Large `index.ts` (5,551 lines) | Low | Works fine, refactoring is cosmetic |
| C3. Console.log cleanup (435 instances) | Low | Switch to structured logger for production |

---

## Priority Order

1. **B1–B4** — Add Claude AI provider support (enables Claude Marketplace eligibility)
2. **B5** — Environment variables for Claude
3. **A1** — PNG logo
4. **A2** — Submission checklist
5. **A4** — Reviewer test cases
6. **B6** — Claude Marketplace application materials
7. **A3, A5** — Compliance review, error audit
8. **C1–C3** — Nice-to-have cleanup

---

## Estimated Scope

- **Track A (ChatGPT)**: 2 new docs, 1 PNG file, minor review — small effort
- **Track B (Claude)**: 2 new source files, ~7 file updates (import swaps), 1 new doc — medium effort
- **Track C**: Optional, no blockers
