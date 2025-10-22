# Card Action Flow - Chat-Native Interaction System

This document describes how card button clicks automatically advance the conversation flow through the signup process.

## Architecture Overview

The card action system connects three layers:

1. **AI Orchestrator** (`mcp_server/ai/AIOrchestrator.ts`)
   - Contains `handleAction` method that processes action + payload
   - Updates session context and returns next orchestrator response
   - Manages flow state transitions (Steps 3-8)

2. **Chat Test Harness** (`src/pages/ChatTestHarness.tsx`)
   - Contains `handleCardAction` that routes UI actions
   - Connects card clicks to orchestrator logic
   - Manages local UI state and message display

3. **Message Components** (`src/components/chat-test/`)
   - `MessageBubble` renders cards with action buttons
   - `ConfirmationCard`, `OptionsCarousel` provide UI
   - Buttons trigger `onAction(action, payload)` callbacks

## Flow Step Constants

```typescript
export enum FlowStep {
  PROVIDER_SEARCH = 3,
  LOGIN = 4,
  PROGRAM_SELECTION = 5,
  PREREQUISITE_CHECK = 6,
  CONFIRMATION = 7,
  COMPLETED = 8
}
```

## Standardized Actions

All card actions follow this naming convention:

| Action | Triggered By | Result |
|--------|--------------|--------|
| `select_provider` | Provider card "Yes" button | Advances to login step |
| `reject_provider` | Provider card "No" button | Returns to search |
| `connect_account` | Login card "Connect" button | Simulates OAuth, advances to programs |
| `select_program` | Program carousel "Enroll" button | Advances to prerequisite check |
| `check_prereqs` | Prerequisites card button | Checks membership/waivers |
| `complete_prereqs` | After prereqs pass | Advances to confirmation |
| `confirm_registration` | Confirmation card "Confirm" | Submits registration |
| `cancel_registration` | Confirmation card "Cancel" | Cancels flow |
| `reset` / `retry_*` | Error recovery buttons | Resets to provider search |

## Interaction Flow

### 1. User Types Message
```
User: "I need ski lessons"
→ ChatTestHarness.handleSend()
→ executeSearch(query)
→ addAssistantMessage(text, componentData)
```

### 2. Card Rendered
```typescript
{
  message: "I found 2 matches",
  cards: [
    {
      title: "Blackhawk Ski Club",
      subtitle: "Middleton, WI",
      buttons: [
        { label: "Yes – That's Mine", action: "select_provider", variant: "accent" },
        { label: "Not This One", action: "reject_provider", variant: "outline" }
      ],
      metadata: { orgRef: "blackhawk" }
    }
  ]
}
```

### 3. User Clicks Button
```
User clicks "Yes – That's Mine"
→ MessageBubble.handleCardButtonClick("select_provider", metadata)
→ MessageList forwards to ChatTestHarness.handleCardAction
→ handleCardAction("select_provider", { orgRef: "blackhawk" })
```

### 4. Context Updated
```typescript
setState(prev => ({
  ...prev,
  orgRef: "blackhawk"
}));

// Orchestrator context also updates
orchestrator.updateContext(sessionId, {
  provider: { name: "Blackhawk Ski Club", orgRef: "blackhawk" },
  step: FlowStep.LOGIN
});
```

### 5. Next Step Rendered
```typescript
addAssistantMessage(
  "Great! Let's connect your account...",
  "form",
  {
    id: "login-form",
    fields: [...]
  }
);
```

## Console Logging Pattern

When card actions fire, you'll see this in the console:

```
[MessageBubble] Button clicked: select_provider { orgRef: "blackhawk" }
[HARNESS] Card action triggered: select_provider { orgRef: "blackhawk" }
[FLOW] select_provider → Blackhawk Ski Club
[CONTEXT] {
  "sessionId": "test-session-123",
  "step": 4,
  "provider": "Blackhawk Ski Club",
  "program": null,
  "loginCompleted": false,
  "confirmed": false
}
```

## Example: Complete Flow Trace

```
1. User: "I need ski lessons"
   [HARNESS] User input detected
   [MCP] → calling tool: scp:find_programs
   [UI] ProviderCard rendered

2. User clicks: "Yes – That's Mine"
   [USER] Click: select_provider "Blackhawk Ski Club"
   [CONTEXT] step=4 provider=Blackhawk
   [UI] LoginForm rendered

3. User submits login form
   [HARNESS] Form submitted: login-form
   [MCP] → calling tool: scp:login
   [CONTEXT] loginCompleted=true step=5

4. User clicks: "Enroll" on program
   [USER] Click: select_program "Beginner Ski Class"
   [CONTEXT] step=6 program="Beginner Ski Class"
   [MCP] → calling tool: scp:check_prerequisites

5. Prerequisites pass, confirmation card shown
   [UI] ConfirmationCard rendered

6. User clicks: "Confirm & Register"
   [USER] Click: confirm_registration
   [CONTEXT] step=8 confirmed=true
   [MCP] → calling tool: scp:register
   [FLOW] 🎉 Registration complete!
```

## Error Handling

If an unknown action is received:

```typescript
default:
  console.warn('[HARNESS] Unknown action:', action);
  return {
    message: "Hmm, I'm not sure what to do with that. Let's start over.",
    cta: [{ label: "Restart", action: "reset", variant: "accent" }]
  };
```

If an error occurs during action processing:

```typescript
catch (error) {
  console.error('[HARNESS] Action handler error:', error);
  return {
    message: "Oops, something went wrong. Let's try again securely.",
    cta: [{ label: "Retry", action: "retry_last", variant: "accent" }]
  };
}
```

## Context Snapshot Logging

The orchestrator logs context snapshots after every update:

```typescript
private logContextSnapshot(sessionId: string): void {
  const context = this.getContext(sessionId);
  console.log('[CONTEXT]', JSON.stringify({
    sessionId,
    step: context.step,
    provider: context.provider?.name,
    program: context.program?.name,
    loginCompleted: context.loginCompleted,
    confirmed: context.confirmed
  }, null, 2));
}
```

This helps debug state transitions and verify that context is updating correctly.

## Testing

### Manual Testing via Chat Test Harness

1. Navigate to `/chat-test`
2. Type: "I need ski lessons"
3. Click provider card button
4. Observe:
   - Console logs show action flow
   - Context updates correctly
   - Next step renders automatically
   - No errors in console

### Expected Console Output

```
[HARNESS] User input: I need ski lessons
[MCP] Tool invoked: search_provider
[HARNESS] 📦 Rendering cards: 1
[HARNESS]   Card 1: Blackhawk Ski Club
[HARNESS]     Buttons: Yes – That's Mine, Not This One
[MessageBubble] Button clicked: select_provider { orgRef: "blackhawk" }
[HARNESS] Card action triggered: select_provider { orgRef: "blackhawk" }
[FLOW] select_provider → the one
[CONTEXT] {
  "sessionId": "...",
  "step": 4,
  "provider": "Blackhawk Ski Club",
  ...
}
```

### Automated Testing

Run the end-to-end test:

```bash
npm run test:orchestrator
```

This validates:
- All actions route correctly
- Context updates properly
- Error handling works
- Flow progresses Steps 3→8

## Future Enhancements

1. **Persist Context to Supabase**
   - Replace in-memory sessions with `agentic_checkout_sessions` table
   - Enable resume from any step

2. **Real OAuth Integration**
   - Replace simulated login with actual provider OAuth
   - Handle token refresh

3. **Enhanced Cards**
   - Add progress indicators
   - Show program images
   - Display pricing breakdowns

4. **Analytics**
   - Track conversion rates per step
   - Identify drop-off points
   - Measure time-to-registration

## Related Files

- `mcp_server/ai/AIOrchestrator.ts` - Action handler and state management
- `src/pages/ChatTestHarness.tsx` - UI action routing
- `src/components/chat-test/MessageBubble.tsx` - Card rendering
- `docs/ORCHESTRATOR_CARD_FLOW.md` - Orchestrator response structure
- `docs/DESIGN_DNA.md` - Chat-native pattern guidelines
