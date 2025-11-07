# Cache Population System

## Overview

The cache population system enables **cache-first, pre-login program discovery** by storing program metadata, prerequisites, questions, and deep-links in the `cached_programs` table.

This is Phase 1 of the Two-Persona Workflow implementation.

## Architecture

### Database Schema

The `cached_programs` table has been enhanced with three new JSONB columns:

1. **`prerequisites_schema`** - Prerequisite checks per program (membership, waiver, payment, child info)
2. **`questions_schema`** - Program questions with field metadata (type, options, required, helper text)
3. **`deep_links`** - Provider deep-link patterns (registration_start, account_creation, program_details)

### Components

#### 1. Database Function: `upsert_cached_programs_enhanced`

Located in: `supabase/migrations/`

Enhanced version of the cache upsert function that accepts the new schema fields.

**Parameters:**
- `p_org_ref` - Organization reference (e.g., "blackhawk-ski")
- `p_category` - Program category (e.g., "all", "alpine", "nordic")
- `p_programs_by_theme` - Programs grouped by theme (existing)
- `p_prerequisites_schema` - NEW: Prerequisites per program
- `p_questions_schema` - NEW: Questions per program
- `p_deep_links` - NEW: Deep-links per program
- `p_metadata` - Additional metadata
- `p_ttl_hours` - Cache TTL in hours (default: 24)

#### 2. Edge Function: `populate-program-cache`

Located in: `supabase/functions/populate-program-cache/index.ts`

Populates the cache with program data including prerequisites, questions, and deep-links.

**Request Body:**
```json
{
  "org_ref": "blackhawk-ski",
  "category": "all",
  "programs": [
    {
      "program_ref": "beginner-alpine",
      "title": "Beginner Alpine Skiing",
      "dates": "Jan 15 - Mar 15, 2025",
      "age_min": 6,
      "age_max": 12,
      "price": "$450",
      "theme": "alpine"
    }
  ],
  "ttl_hours": 24
}
```

**Response:**
```json
{
  "success": true,
  "cache_id": "uuid",
  "org_ref": "blackhawk-ski",
  "category": "all",
  "programs_count": 4,
  "cached_at": "2025-01-07T12:00:00Z"
}
```

#### 3. Deep-Link Generator

Located in: `providers/skiclubpro/lib/DeepLinkGenerator.ts`

Generates provider deep-links with SignupAssist tracking parameters.

**Usage:**
```typescript
import { DeepLinkGenerator } from './DeepLinkGenerator.js';

const generator = new DeepLinkGenerator('blackhawk-ski');

// Generate all links for a program
const links = generator.generateAll('beginner-alpine');
// {
//   registration_start: "https://blackhawk.skiclubpro.team/registration/beginner-alpine/start?ref=signupassist&utm_source=chatgpt_app&utm_medium=acp",
//   account_creation: "https://blackhawk.skiclubpro.team/user/register?ref=signupassist&prefill=guardian&utm_source=chatgpt_app",
//   program_details: "https://blackhawk.skiclubpro.team/registration/beginner-alpine?ref=signupassist&utm_source=chatgpt_app"
// }
```

#### 4. Shared Type Definitions

Located in: `mcp_server/types/cacheSchemas.ts`

Type-safe definitions for cache schemas used across the codebase.

**Key Types:**
- `PrerequisiteSchema` - Prerequisites per program
- `QuestionsSchema` - Questions per program
- `DeepLinksSchema` - Deep-links per program
- `ChecklistCard` - Checklist card format for pre-login display
- `CacheResult` - Cache lookup result with checklist cards

## Schema Examples

### Prerequisites Schema

```json
{
  "beginner-alpine": {
    "membership": {
      "required": true,
      "check": "active_club_membership",
      "message": "Active club membership required"
    },
    "waiver": {
      "required": true,
      "check": "signed_waiver",
      "message": "Parent/guardian waiver must be signed"
    },
    "payment_method": {
      "required": true,
      "check": "payment_on_file",
      "message": "Credit card on file for registration"
    },
    "child_profile": {
      "required": true,
      "check": "complete_profile",
      "message": "Child name, DOB, emergency contact required"
    }
  }
}
```

### Questions Schema

```json
{
  "beginner-alpine": {
    "fields": [
      {
        "id": "color_group",
        "label": "Preferred Color Group",
        "type": "select",
        "required": true,
        "options": [
          { "value": "red", "label": "Red Group (Sundays 9-11am)" },
          { "value": "blue", "label": "Blue Group (Sundays 1-3pm)" }
        ],
        "helper_text": "Each group has limited spots. We'll try to honor your preference."
      },
      {
        "id": "equipment_rental",
        "label": "Equipment Rentals Needed?",
        "type": "checkbox",
        "required": false,
        "options": [
          { "value": "skis", "label": "Skis (+$25)" },
          { "value": "boots", "label": "Boots (+$15)" }
        ],
        "isPriceBearing": true
      }
    ]
  }
}
```

### Deep-Links Schema

```json
{
  "beginner-alpine": {
    "registration_start": "https://blackhawk.skiclubpro.team/registration/beginner-alpine/start?ref=signupassist&utm_source=chatgpt_app&utm_medium=acp",
    "account_creation": "https://blackhawk.skiclubpro.team/user/register?ref=signupassist&prefill=guardian&utm_source=chatgpt_app",
    "program_details": "https://blackhawk.skiclubpro.team/registration/beginner-alpine?ref=signupassist&utm_source=chatgpt_app"
  }
}
```

## Testing

Run the test script to populate sample cache data:

```bash
bun run scripts/testCachePopulation.ts
```

This will:
1. Call the `populate-program-cache` edge function with sample programs
2. Verify the cache was populated
3. Retrieve and display the cached data including new fields
4. Show sample prerequisites, questions, and deep-links

## Next Steps (Phase 1C)

- Update `AIOrchestrator.ts` to use the new cache fields
- Build checklist cards from cached prerequisites and questions
- Return checklist cards in cache hit responses
- Update ChatGPT prompts to handle pre-login checklist flow

## Compliance Notes

**What is cached (safe):**
- Program metadata (title, dates, price, schedule)
- Prerequisites schema (field structure only)
- Questions schema (field structure, options, validation rules)
- Deep-links with tracking parameters

**What is NOT cached (PII/PCI):**
- User answers or form submissions
- Credit card information
- Provider passwords or session tokens
- Personally identifiable information

The cache stores **program structure**, not **user data**. This enables pre-login discovery while maintaining compliance with data security requirements.
