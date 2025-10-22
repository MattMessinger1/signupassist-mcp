# AI Orchestrator Card-Based Flow

This document describes the refactored AI Orchestrator that returns structured card-based responses following the Design DNA pattern: **Message → Card → CTA**.

## Overview

The AI Orchestrator now returns standardized responses with:
- **Message**: Assistant text displayed above UI components
- **Cards**: Visual components rendered in the chat (provider cards, program carousel, confirmation)
- **CTAs**: Call-to-action buttons for user interaction

## Response Structure

```typescript
interface OrchestratorResponse {
  message: string;              // Required: Assistant message
  cards?: CardSpec[];           // Optional: Array of cards
  cta?: CTASpec[];              // Optional: Action buttons
  uiPayload?: Record<string, any>; // Legacy support
  contextUpdates?: Record<string, any>;
}

interface CardSpec {
  title: string;
  subtitle?: string;
  description?: string;
  metadata?: Record<string, any>;
  buttons?: Array<{
    label: string;
    action: string;
    variant?: "accent" | "outline";
  }>;
}
```

## Design DNA Compliance

### 1. **Tone**
- Friendly, concise, parent-friendly
- Example: "Great! Let's find your provider 🔍"

### 2. **Pattern**
- Always follows: Assistant message → Card → CTA
- Example:
  ```
  Message: "I found 3 matches for Blackhawk Ski Club"
  Cards: [Provider cards with "Select" buttons]
  ```

### 3. **Security Reminders**
- Automatic inclusion for sensitive operations
- Constant: `SECURITY_NOTE = "You'll log in directly with the provider; we never see or store your password."`

### 4. **Audit Logging**
- All tool invocations logged
- Pattern: `logAction("tool_invocation", { toolName, sessionId })`

### 5. **Error Handling**
- Graceful recovery with actionable CTAs
- Example: "Hmm, looks like something went wrong. [Retry]"

## Card Builders

### Provider Cards
```typescript
buildProviderCards(results: Provider[]): CardSpec[]
```
- Displays search results
- Buttons: "Yes – That's Mine" (accent), "Not This One" (outline)

### Program Cards
```typescript
buildProgramCards(programs: Program[]): CardSpec[]
```
- Carousel of available programs
- Shows: title, schedule, price
- Button: "Enroll" (accent)

### Confirmation Card
```typescript
buildConfirmationCard(context: SessionContext): CardSpec
```
- Final summary before submission
- Shows: child name, program, provider
- Buttons: "✅ Confirm & Register" (accent), "Cancel" (outline)

## Step-Aware Routing

The orchestrator routes through Steps 3-6:

### Step 3: Provider Search
```typescript
Input: "I need ski lessons"
Output: {
  message: "🔍 I found 2 matches for Blackhawk Ski Club",
  cards: [ProviderCard1, ProviderCard2]
}
```

### Step 4: Login
```typescript
Input: "Yes, that's mine"
Output: {
  message: "Great! Let's connect your account. [SECURITY_NOTE]",
  cards: [ConnectAccountCard]
}
```

### Step 5: Program Discovery
```typescript
Input: "Show programs"
Output: {
  message: "Here are the available programs 👇",
  cards: [ProgramCard1, ProgramCard2, ...]
}
```

### Step 6: Confirmation
```typescript
Input: "Enroll"
Output: {
  message: "✅ Review details and confirm",
  cards: [ConfirmationCard]
}
```

## Testing

### End-to-End Smoke Test
```bash
npm run test:orchestrator
```

Validates:
1. Provider search returns cards
2. Login step includes security note
3. Program discovery shows carousel
4. Confirmation includes summary card
5. All responses follow message + card pattern

### Manual Testing via Chat Test Harness
1. Navigate to `/chat-test`
2. Click "Test Connection" to verify MCP
3. Type: "I need ski lessons"
4. Observe console logs:
   ```
   [HARNESS] Provider search initiated
   [MCP] → calling tool: scp:find_programs
   [HARNESS] 📦 Rendering cards: 2
   [HARNESS]   Card 1: Blackhawk Ski Club
   [HARNESS]     Buttons: Yes – That's Mine, Not This One
   ```

## Error Recovery

All errors return structured responses with retry CTAs:

```typescript
{
  message: "Hmm, I had trouble searching. Let's try again.",
  cta: [{ label: "Retry Search", action: "retry_search", variant: "accent" }]
}
```

Never exposes:
- Stack traces
- Technical error codes
- Internal system details

## Audit Trail

Every action is logged:
```
[Audit] tool_invocation { toolName: "search_provider", sessionId: "..." }
[Audit] response_sent { step: "provider_search", hasCards: true }
```

PII is automatically masked before logging.

## Future Enhancements

1. **Persist to Supabase**: Replace in-memory sessions with `agentic_checkout_sessions` table
2. **Enhanced Cards**: Add images, progress indicators, ratings
3. **Structured Output**: Use OpenAI tool calling for consistent JSON responses
4. **Multi-Provider**: Support providers beyond skiclubpro

## Migration Guide

### From Old Format
```typescript
// Old
return {
  assistantMessage: "Message",
  uiPayload: { type: "cards", options: [...] },
  contextUpdates: {}
}
```

### To New Format
```typescript
// New
return this.formatResponse(
  "Message",
  buildProviderCards(results),
  undefined,
  {}
)
```

## Related Files

- `mcp_server/ai/AIOrchestrator.ts` - Main orchestrator
- `scripts/testOrchestratorFlow.ts` - End-to-end test
- `src/pages/ChatTestHarness.tsx` - UI test harness
- `docs/DESIGN_DNA.md` - Design principles (TBD)
