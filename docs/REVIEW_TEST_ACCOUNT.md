# Signup Assist — Review Team Test Account Guide

This document provides everything needed for external review teams (ChatGPT App Store, Claude MCP Directory) to test Signup Assist.

---

## Quick Start

### 1. Server URL

- **Production SSE endpoint:** `https://signupassist-mcp-production.up.railway.app/sse`
- **Health check:** `https://signupassist-mcp-production.up.railway.app/health`
- **Manifest:** `https://signupassist-mcp-production.up.railway.app/mcp/manifest.json`

### 2. OAuth Authentication

- **Authorization URL:** `https://signupassist-mcp-production.up.railway.app/oauth/authorize`
- **Token URL:** `https://signupassist-mcp-production.up.railway.app/oauth/token`
- **Scopes:** `openid profile email`

### 3. Test Credentials

Contact support@shipworx.ai to request review team test credentials. We will provision:
- A dedicated Auth0 test account
- Pre-populated sample data (child profiles, past registrations)
- A test-mode Stripe configuration that does not process real charges

---

## What to Test

### Read-Only Browsing (No Auth Required)

The `search_activities` tool works without authentication:

```
"What programs are available at AIM Design?" → triggers search_activities
"Show me robotics classes for my 9 year old" → triggers search_activities
```

Expected: Returns a plain-text bullet list of real programs from the AIM Design provider in Madison, WI.

### Full Registration Flow (Auth Required)

The `register_for_activity` tool requires OAuth:

```
"Sign up my child for a class at AIM Design" → triggers register_for_activity
```

Expected flow:
1. Step 1/5: Shows available programs, asks user to select one
2. Step 2/5: Collects account holder and participant info (email, name, DOB, participant details)
3. Step 3/5: Directs to Stripe-hosted Checkout for payment method setup
4. Step 4/5: Shows review summary, asks for explicit confirmation
5. Step 5/5: Creates the booking (in test mode, no real charges)

### Scheduled Registration ("Set and Forget")

```
"Sign up Alex for Summer Camp when registration opens next Monday at 9am"
```

Expected: Follows the same wizard steps, then schedules the registration for future execution rather than booking immediately.

---

## Sample Data

When using the test account, the following data is pre-populated:

### Available Programs (AIM Design, Madison WI)

Programs are fetched live from the Bookeo API. Typical programs include:
- Robotics classes (various levels, ages 6-14)
- STEM camps (seasonal)
- Coding workshops

### Test Payment

Stripe is in test mode. Use Stripe's test card numbers:
- **Success:** `4242 4242 4242 4242` (any future expiry, any CVC)
- **Decline:** `4000 0000 0000 0002`

The $20 success fee charge will appear in Stripe's test dashboard but is not a real charge.

---

## Safety Annotations

All tools include MCP safety annotations:

| Tool | readOnlyHint | destructiveHint |
|------|-------------|----------------|
| `search_activities` | true | false |
| `register_for_activity` | false | true |

The `register_for_activity` tool is marked destructive because it can create bookings and charge the success fee — but only after explicit user confirmation at Step 4/5.

---

## Privacy and COPPA

- The service is operated by adults (account holders must be 18+)
- Children never interact with the service directly
- Participant data (name, DOB only) is entered by the authenticated adult
- Full privacy policy: `/privacy` endpoint or `docs/PRIVACY_POLICY.md`
- Full safety policy: `/safety` endpoint or `docs/SAFETY_POLICY.md`

---

## Test Harness UI

For interactive testing outside of ChatGPT/Claude, we provide a web-based test harness:

- **URL:** `https://signupassist-mcp-production.up.railway.app/` (React SPA)
- **Pages:** Chat test harness, flow tester, admin console
- **Docs:** See `docs/CHAT_TEST_HARNESS_USER_GUIDE.md` for detailed instructions

---

## Support

- **Email:** support@shipworx.ai
- **Privacy questions:** privacy@shipworx.ai
- **Response time:** Within 1 business day for review team requests
