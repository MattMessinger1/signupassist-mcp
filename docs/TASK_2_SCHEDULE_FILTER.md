# Task 2: Schedule Filter UI Implementation

## Overview
Implemented a schedule filter prompt that appears after login but before program discovery, allowing users to specify their preferred days and times for classes.

## Changes Made

### 1. Backend (AIOrchestrator.ts)

#### Added Schedule Filter Check
- Modified `handleAutoProgramDiscovery()` to check for schedule preferences before fetching programs
- If no preference exists and user hasn't declined, shows schedule filter prompt
- Feature flag: `FEATURE_SCHEDULE_FILTER` (default: enabled)

#### New Action Handlers
- `set_schedule_filter`: Stores user's day/time preferences and proceeds with discovery
- `skip_schedule_filter`: Marks filter as declined and proceeds without filtering

#### Schedule Filter UI Builder
- `buildScheduleFilterPrompt()`: Creates cards with day and time options
- Uses carousel component type for horizontal scrolling
- Options:
  - **Days**: Weekdays, Weekends, Any Day
  - **Times**: Mornings, Afternoons, Evenings, Any Time

#### Filter Application
- Schedule preferences are added to `scp.find_programs` args as:
  - `filter_day`: "weekday" | "weekend" | "any"
  - `filter_time`: "morning" | "afternoon" | "evening" | "any"
- Logged for audit trail

### 2. Types (types.ts)

Added to `SessionContext`:
```typescript
schedulePreference?: {
  dayOfWeek?: "weekday" | "weekend" | "any";
  timeOfDay?: "morning" | "afternoon" | "evening" | "any";
};
scheduleDeclined?: boolean;
```

### 3. Frontend (MessageBubble.tsx)

- Updated card rendering to support button payloads
- Buttons now pass `button.payload` instead of only `card.metadata`
- Supports flexible multi-button cards with proper variant styling

### 4. Interface Updates (AIOrchestrator.ts)

Updated `CardSpec` interface:
```typescript
buttons?: Array<{
  label: string;
  action: string;
  variant?: "accent" | "outline";
  payload?: any;  // TASK 2: Support payload for button actions
}>;
```

## User Flow

1. User confirms provider → Credentials submitted
2. **NEW**: Schedule filter prompt appears
   - "Quick question — when would you prefer classes?"
   - Shows day options (Weekdays/Weekends/Any)
   - Shows time options (Morning/Afternoon/Evening/Any)
   - "Skip — Show All" button to bypass filter
3. User selects preferences or skips
4. Program discovery proceeds with filters applied
5. Results are pre-filtered by schedule preferences

## Benefits

- **Better UX**: Helps users find relevant programs faster
- **Reduced Cognitive Load**: Fewer irrelevant programs to review
- **Optional**: Users can skip if they want to see everything
- **Audit Trail**: All selections logged for compliance

## Feature Flag

To disable schedule filter:
```bash
FEATURE_SCHEDULE_FILTER=false
```

## Next Steps (Task 3)

Implement Playwright pre-filtering to reduce extraction time by filtering DOM nodes before sending to OpenAI.

## Testing

Test scenarios:
1. Select "Weekdays" + "Mornings" → Should only show matching programs
2. Select "Any Day" + "Evenings" → Should filter by time only
3. Click "Skip — Show All" → Should show all programs unfiltered
4. Verify schedule preferences persist in context across actions
