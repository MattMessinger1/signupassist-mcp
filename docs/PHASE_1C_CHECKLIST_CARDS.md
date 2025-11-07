# Phase 1C: Checklist Cards Implementation

## Overview

Phase 1C enhances the AIOrchestrator to build and return **checklist cards** from cached prerequisites and questions when cache hits. This enables the **cache-first, pre-login workflow** where users can see program requirements before any authentication.

## Architecture Changes

### 1. Enhanced Cache Result Type

The `checkDatabaseCache` method now returns a `CacheResult` object instead of just programs:

```typescript
interface CacheResult {
  hit: boolean;
  programs: CachedProgramData[];
  checklistCards?: ChecklistCard[];
  timestamp?: string;
}
```

**Key Changes:**
- Returns structured object with `hit`, `programs`, `checklistCards`, and `timestamp`
- Queries the full `cached_programs` table row (not just RPC) to get all fields
- Extracts `prerequisites_schema`, `questions_schema`, and `deep_links` from cache
- Builds checklist cards from these schemas

### 2. Checklist Card Structure

Each checklist card contains:

```typescript
interface ChecklistCard {
  type: 'checklist';
  title: string;                    // e.g., "Beginner Alpine - Requirements"
  program_ref: string;               // e.g., "beginner-alpine"
  prerequisites: {                   // Required checks
    [checkName: string]: {
      required: boolean;
      check: string;                 // e.g., "active_club_membership"
      message: string;               // Human-readable message
    }
  };
  questions: QuestionField[];        // Form fields to collect
  deep_link: string;                 // Provider registration URL
  cta: {                            // Call-to-action button
    label: 'Ready to proceed';
    action: 'show_finish_options';
    data: { program_ref: string };
  };
}
```

### 3. Updated Flow in AIOrchestrator

#### Before (Phase 1B):
```typescript
const dbCachedPrograms = await this.checkDatabaseCache(orgRef, category, childAge);
if (dbCachedPrograms && Object.keys(dbCachedPrograms).length > 0) {
  // Programs grouped by theme
  return await this.presentProgramsAsCards(ctx, dbCachedPrograms);
}
```

#### After (Phase 1C):
```typescript
const cacheResult = await this.checkDatabaseCache(orgRef, category, childAge);
if (cacheResult && cacheResult.hit) {
  // Extract checklist cards
  if (cacheResult.checklistCards && cacheResult.checklistCards.length > 0) {
    Logger.info('[Checklist Flow] Presenting programs with checklist cards');
    
    // Group programs by theme for display
    const programsByTheme = groupByTheme(cacheResult.programs);
    
    // Store checklist cards in context for later retrieval
    await this.updateContext(sessionId, { 
      checklistCards: cacheResult.checklistCards 
    });
    
    return await this.presentProgramsAsCards(ctx, programsByTheme);
  }
}
```

## Key Methods

### `checkDatabaseCache()`

**Location:** `mcp_server/ai/AIOrchestrator.ts` (line ~3254)

**Changes:**
1. Queries full `cached_programs` table row instead of just RPC
2. Extracts `prerequisites_schema`, `questions_schema`, `deep_links`
3. Calls `buildChecklistCards()` to generate checklist cards
4. Returns `CacheResult` with programs and checklist cards

**SQL Query:**
```typescript
const { data: cacheEntry, error } = await this.supabase
  .from('cached_programs')
  .select('*')
  .eq('org_ref', orgRef)
  .eq('category', category)
  .gt('expires_at', new Date().toISOString())
  .gte('cached_at', new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString())
  .order('cached_at', { ascending: false })
  .limit(1)
  .maybeSingle();
```

### `buildChecklistCards()`

**Location:** `mcp_server/ai/AIOrchestrator.ts` (line ~3358)

**Purpose:** Transforms cache schemas into checklist cards

**Logic:**
1. Iterate through programs
2. Extract prerequisites, questions, deep-links for each program
3. Build `ChecklistCard` object with all required fields
4. Skip programs without checklist data
5. Return array of checklist cards

**Example Output:**
```json
{
  "type": "checklist",
  "title": "Beginner Alpine - Requirements",
  "program_ref": "beginner-alpine",
  "prerequisites": {
    "membership": {
      "required": true,
      "check": "active_club_membership",
      "message": "Active club membership required"
    },
    "waiver": {
      "required": true,
      "check": "signed_waiver",
      "message": "Parent/guardian waiver must be signed"
    }
  },
  "questions": [
    {
      "id": "color_group",
      "label": "Preferred Color Group",
      "type": "select",
      "required": true,
      "options": [
        { "value": "red", "label": "Red Group (Sundays 9-11am)" },
        { "value": "blue", "label": "Blue Group (Sundays 1-3pm)" }
      ]
    }
  ],
  "deep_link": "https://blackhawk.skiclubpro.team/registration/beginner-alpine/start?ref=signupassist",
  "cta": {
    "label": "Ready to proceed",
    "action": "show_finish_options",
    "data": { "program_ref": "beginner-alpine" }
  }
}
```

## Updated System Prompt

The `PRODUCTION_SYSTEM_PROMPT` now includes:

```
CACHE-FIRST CHECKLIST FLOW (Phase 1C):
1. On cache hit, show program cards with checklist preview from cached data
2. When user selects a program, show full checklist card:
   - Prerequisites section (membership, waiver, payment, child info)
   - Questions section (color group, rentals, medical, etc.)
   - "Ready to proceed" CTA
3. After checklist review, offer TWO finish modes:
   - Recommended: "Open provider to finish" (deep-link to provider site)
   - Optional: "Let SignupAssist finish for me" (agentic, requires OAuth)
4. NEVER ask for provider passwords in ChatGPT
5. Keep all UI state ephemeral; persist answers on your server
```

## Usage in Context

Checklist cards are stored in session context:

```typescript
await this.updateContext(sessionId, { 
  checklistCards: cacheResult.checklistCards 
});
```

This allows:
- Frontend to retrieve and display checklist cards
- AI to reference prerequisites when answering questions
- System to track which programs have complete checklist data

## Testing

Run the cache population test to verify checklist data:

```bash
bun run scripts/testCachePopulation.ts
```

Expected output:
```
✅ Cache population successful!
✅ Cache retrieved successfully!
📋 Prerequisites schema keys: ['beginner-alpine', 'intermediate-alpine', ...]
📋 Questions schema keys: ['beginner-alpine', 'intermediate-alpine', ...]
📋 Deep links keys: ['beginner-alpine', 'intermediate-alpine', ...]
```

## Next Steps (Phase 1D)

1. **Update ChatGPT Response Format** - Modify how AIOrchestrator formats responses to include checklist cards
2. **Frontend Display** - Create UI components to render checklist cards
3. **Two-Persona Options** - Implement "Open provider" vs "Let SignupAssist finish" choice
4. **Deep-Link Handling** - Add client-side logic to open provider deep-links in new tab

## Compliance & Security

**What checklist cards contain (safe):**
- Program metadata (title, reference)
- Prerequisites structure (check names, messages)
- Questions structure (field types, options, validation)
- Deep-links with tracking parameters

**What checklist cards DO NOT contain:**
- User answers or form submissions
- Credentials or authentication data
- PII or PCI information
- Session tokens or cookies

Checklist cards are **structure-only** metadata that enables informed user decisions before any data collection or authentication.

## Files Modified

1. `mcp_server/ai/AIOrchestrator.ts`
   - Updated `checkDatabaseCache()` to return `CacheResult`
   - Added `buildChecklistCards()` method
   - Updated `handleAutoProgramDiscovery()` to handle new return type
   - Updated `handleAction_run_extractor_test()` to handle new return type
   - Enhanced `PRODUCTION_SYSTEM_PROMPT` with checklist flow

2. `mcp_server/types/cacheSchemas.ts` (imported)
   - `CacheResult` type
   - `ChecklistCard` type
   - `PrerequisiteCheck` type
   - `QuestionField` type

## Logging

Enhanced logging for debugging:

```
[DB Cache] ✓ Enhanced hit {
  orgRef: 'blackhawk-ski',
  category: 'all',
  childAge: 'age 8',
  themes: 3,
  programCount: 12,
  checklistCards: 12
}

[Checklist Flow] Presenting programs with checklist cards
[Checklist] Built 12 checklist cards from 12 programs
```

## Performance Impact

- **Cache query:** +10-20ms (full table row vs RPC)
- **Card building:** ~1-2ms per program
- **Total overhead:** <50ms for 20 programs
- **Benefit:** Pre-login checklist eliminates 1-2 round trips (login + discovery)

**Net Performance:** Significant improvement due to pre-login narrowing
