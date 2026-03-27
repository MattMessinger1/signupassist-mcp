# Signup Assist MCP — Usage Examples

These examples demonstrate end-to-end interactions with the Signup Assist MCP server.
All examples use JSON-RPC 2.0 over SSE/HTTP transport.

---

## Example 1: Browse Available Programs (Read-Only)

A parent wants to see what robotics classes are available for their 8-year-old.

### Request

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "search_activities",
    "arguments": {
      "query": "robotics classes for my 8 year old",
      "org_ref": "aim-design"
    }
  }
}
```

### Response

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Here are the available programs at AIM Design:\n\n- Intro to Robotics — Ages 6-10 • Saturdays 10am-12pm • $150\n- Advanced Robotics Lab — Ages 9-14 • Wednesdays 4pm-6pm • $180\n- STEM Camp: Robot Builders — Ages 7-12 • June 16-20 9am-3pm • $350\n\nTo sign up for any of these, say \"sign up for [program name]\"."
      }
    ]
  }
}
```

**Notes:**
- No authentication required — `search_activities` is read-only.
- The tool has `readOnlyHint: true` and `destructiveHint: false` in its annotations.
- No bookings are created and no payments are charged.

---

## Example 2: Full Signup Flow (Multi-Step Wizard)

A parent wants to register their child for Intro to Robotics. This uses the `register_for_activity` tool, which orchestrates a multi-step wizard (Steps 1-5).

### Step 1 — User expresses signup intent

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "register_for_activity",
    "arguments": {
      "input": "Sign up my child for Intro to Robotics",
      "sessionId": "session-abc-123",
      "userTimezone": "America/Chicago"
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Step 1/5 — Finding classes\n\nI found Intro to Robotics at AIM Design (Saturdays 10am-12pm, $150). This is for ages 6-10.\n\nWould you like to proceed with registration?"
      }
    ]
  }
}
```

### Step 2 — Collect account holder & participant info

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "register_for_activity",
    "arguments": {
      "input": "Yes, please proceed",
      "sessionId": "session-abc-123"
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Step 2/5 — Account holder & participant info\n\nI'll need a few details. First, what is the participant's first name and date of birth?"
      }
    ]
  }
}
```

### Step 3 — Payment method (Stripe Checkout)

After participant details are collected, the wizard directs the user to Stripe's hosted checkout page for payment method setup. Card numbers are never entered in chat.

### Step 4 — Review & consent

The orchestrator presents a summary of all details and asks for explicit confirmation before proceeding.

### Step 5 — Registration submitted

After explicit confirmation, the booking is created with the provider and the $20 success fee is charged.

**Notes:**
- OAuth authentication is required for `register_for_activity` (the user must be logged in).
- The tool has `destructiveHint: true` — it can create bookings and charge fees.
- Nothing is booked or charged until Step 5, after explicit user confirmation.
- All actions are logged in an immutable audit trail with SHA-256 integrity hashes.

---

## Example 3: Scheduled Auto-Registration ("Set and Forget")

A parent wants to register their child for Summer Camp when registration opens on a future date. The system schedules the registration to execute automatically at the specified time.

### User request

```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "method": "tools/call",
  "params": {
    "name": "register_for_activity",
    "arguments": {
      "input": "Sign up Alex for Summer STEM Camp when registration opens March 15 at 9am",
      "sessionId": "session-xyz-456",
      "userTimezone": "America/Chicago"
    }
  }
}
```

### Flow

The wizard follows the same Steps 1-5, collecting participant info, payment method, and explicit consent. At Step 5, instead of executing immediately, the orchestrator:

1. Creates a time-limited authorization mandate scoping exactly what is permitted
2. Schedules a registration job for the specified date/time
3. Confirms the scheduled registration to the user

### Final response

```json
{
  "jsonrpc": "2.0",
  "id": 15,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Step 5/5 — Registration scheduled\n\nYour registration for Summer STEM Camp is scheduled for March 15, 2026 at 9:00 AM CT.\n\nWhat will happen:\n- At 9:00 AM CT, we'll automatically register Alex Johnson\n- The $20 SignupAssist fee will be charged to your saved card\n- You'll receive a confirmation once complete\n\nYou can cancel this scheduled registration anytime before it executes by saying \"cancel my scheduled registration.\""
      }
    ]
  }
}
```

**Notes:**
- The "set and forget" feature uses a scheduled worker that executes at the specified time.
- The parent must complete all wizard steps (including payment setup and explicit consent) before the job is scheduled. No automatic actions run without prior explicit authorization.
- The authorization mandate is time-limited and scoped to the specific program and participant.
- The parent can cancel the scheduled registration at any time before execution.

---

## Tool Discovery

To list available tools, send:

```json
{
  "jsonrpc": "2.0",
  "id": 0,
  "method": "tools/list",
  "params": {}
}
```

The response includes each tool's `name`, `description`, `inputSchema`, and `annotations` (including `readOnlyHint` and `destructiveHint`).

---

## Authentication

Signup Assist uses OAuth 2.0 (Auth0-backed). The flow:

1. Client redirects to `/oauth/authorize` with standard OAuth parameters
2. User authenticates with Auth0
3. Auth0 redirects back to the client's callback URL with an authorization code
4. Client exchanges the code at `/oauth/token` for an access token
5. Client includes `Authorization: Bearer <token>` on subsequent tool calls

`search_activities` can be called without authentication (read-only program browsing).
`register_for_activity` requires a valid OAuth token for all operations.
