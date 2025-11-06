# Pre-login Intent Gate Implementation

## Overview

The Pre-login Intent Gate ensures we collect three essential pieces of information before proceeding with login:
1. **Child's age** - For filtering programs by age range
2. **Activity type** - Lessons/Classes or Race Team/Events (maps to category)
3. **Provider/club** - Which organization to search

## Design Principles

- **Concise one-turn follow-up**: Ask for ALL missing items in a single question
- **Friendly, parent-centric tone**: Short, actionable questions
- **Quick options/chips**: Provide easy-to-tap choices where applicable
- **Respect user choice**: If user declines, proceed with defaults (category="all")
- **Brief confirmation**: When all three are known, confirm in 1 sentence and continue

## Implementation

### 1. Router System Prompt (AIOrchestrator.ts)

```typescript
const PRODUCTION_SYSTEM_PROMPT = `
You orchestrate SignupAssist deterministically for Steps 3–6. Follow Design DNA:
...

Pre-login narrowing (before any login/find):
- Ensure we have all three: {age, activity, provider}. 
  • activity → category mapping: lessons/classes → "lessons"; race team/events → "teams"; unknown → "all".
  • If any missing, ask only once, concisely; if user declines, proceed with best-effort defaults (category="all"), and say so.
- Once present (or user declined), proceed.
...
`;
```

**Location**: `mcp_server/ai/AIOrchestrator.ts` lines 27-79

### 2. Intent Question Builder (intentParser.ts)

```typescript
export function buildIntentQuestion(intent: ParsedIntent): string | null {
  // Builds concise single-turn questions like:
  // - "Which provider or club?"
  // - "Looking for Lessons/Classes or Race Team/Events?"
  // - "What's your child's age?"
  // - Combines multiple missing pieces: "Which provider? And what's your child's age?"
}

export function isIntentDeclined(message: string): boolean {
  // Detects user declining: "prefer not", "skip", "not sure", "just show all"
}
```

**Location**: `mcp_server/lib/intentParser.ts` lines 186-236

### 3. Intent Checker (AIOrchestrator.ts)

```typescript
async checkAndRequestMissingIntent(userMessage: string, sessionId: string): Promise<string | null> {
  // 1. Check if user is declining → use defaults
  if (isIntentDeclined(userMessage)) {
    Logger.info(`[Intent Declined] User declined, using defaults`);
    // Set category to "all" and proceed
    return null;
  }
  
  // 2. Parse intent using OpenAI (via parseIntent → parseIntentWithAI)
  const newIntent = await parseIntent(userMessage);
  
  // 3. Merge with existing partial intent
  const mergedIntent = { ...context.partialIntent, ...newIntent };
  
  // 4. Build question for missing parts (concise one-turn format)
  const question = buildIntentQuestion(mergedIntent);
  
  if (question) {
    return question; // Ask for missing info
  }
  
  // 5. All intent complete - proceed silently
  return null;
}
```

**Location**: `mcp_server/ai/AIOrchestrator.ts` lines 481-590

## OpenAI Integration Points

OpenAI is called throughout the system for intelligent parsing:

### Intent Parsing Chain
```
checkAndRequestMissingIntent
  └→ parseIntent (intentParser.ts)
     └→ parseIntentWithAI (aiIntentParser.ts)
        └→ callOpenAI_JSON (openaiHelpers.ts)
           └→ openai.chat.completions.create()
```

**Models Used**:
- Intent parsing: `gpt-4o-mini` (fast, cost-efficient)
- Email normalization: `gpt-4o-mini`
- Program grouping: `gpt-4o-mini`
- Program extraction: `gpt-5` (flagship for complex reasoning)

### Other OpenAI Usage
1. **Program Grouping** (`mcp_server/lib/programGrouping.ts` line 91)
   - Groups programs by theme (Lessons & Classes, Race Team, etc.)
   
2. **Three-Pass Extractor** (`mcp_server/lib/threePassExtractor.ts`)
   - Validates program listing pages (line 111)
   - Identifies program containers from screenshots (line 174)
   - Extracts structured program data (line 296)
   - Validates and deduplicates results (line 401)

3. **Field Discovery** (`mcp_server/lib/threePassExtractor.programs.ts` line 127)
   - Extracts form fields using JSON schema response format

## User Experience Flow

### Example 1: All intent provided upfront
```
User: "I need ski lessons at Blackhawk for my 9 year old"

System: (Parses intent silently)
  ✓ provider: "blackhawk-ski-club"
  ✓ category: "lessons"
  ✓ age: 9

System: (Proceeds directly to provider search)
```

### Example 2: Missing pieces
```
User: "I need ski lessons"

System: "Which provider or club? And what's your child's age?"

User: "Blackhawk, age 9"

System: (Now complete - proceeds)
```

### Example 3: User declines
```
User: "I need ski lessons at Blackhawk"

System: "What's your child's age?"

User: "prefer not to say"

System: (Uses defaults)
  ✓ provider: "blackhawk-ski-club"
  ✓ category: "lessons"
  ✓ age: undefined (will show all age ranges)

System: "I'll show all programs and you can filter later."
```

## Category Mapping

```typescript
// User says → System category
"lessons", "class", "clinic", "private" → "lessons"
"team", "race", "league" → "teams"
"camp" → "camps"
anything else → "all"
```

## Testing

### Manual Testing via Chat Test Harness
1. Navigate to `/chat-test`
2. Test various input patterns:
   - Complete intent: "blackhawk ski lessons, age 9"
   - Partial intent: "blackhawk ski lessons"
   - Declining: "prefer not to say"
3. Observe console logs:
   ```
   [Intent Parsing Debug] { userMessage, newIntent, mergedIntent }
   [Intent Complete] All three fields present
   [Intent Declined] User declined, using defaults
   ```

### Automated Testing
```bash
npm run test:orchestrator  # End-to-end flow test
```

## Environment Variables

```bash
# OpenAI API Key (required)
OPENAI_API_KEY=sk-...

# OpenAI Model Selection
OPENAI_MODEL=gpt-5              # Default: gpt-5 (flagship)
OPENAI_TEMPERATURE=0.3          # Default: 0.3 (consistent)

# Feature Flags
FEATURE_INTENT_UPFRONT=true     # Enable pre-login intent gate
```

## Related Files

- `mcp_server/ai/AIOrchestrator.ts` - Router system prompt and intent checker
- `mcp_server/lib/intentParser.ts` - Question builder and decline detection
- `mcp_server/lib/aiIntentParser.ts` - OpenAI-powered intent parsing
- `mcp_server/lib/openaiHelpers.ts` - OpenAI API wrapper
- `docs/ORCHESTRATOR_CARD_FLOW.md` - Overall card-based flow documentation

## Future Enhancements

1. **Chip-based UI**: Render quick-tap chips for category selection
2. **Location-aware suggestions**: Suggest nearby providers based on user location
3. **Multi-child support**: Handle multiple children in one conversation
4. **Intent caching**: Cache parsed intent across sessions (5 min TTL already implemented)
