# Chat Test Harness - User Guide

## Quick Start

### Accessing the Test Harness

Navigate to `/chat-test` in your browser:
```
http://localhost:5173/chat-test
```

### Prerequisites

1. **Set up environment variables** in `.env`:
   ```env
   VITE_MCP_BASE_URL=http://localhost:8080  # Your MCP server URL
   VITE_MCP_ACCESS_TOKEN=your_token_here    # Optional: Auth token
   ```

2. **Start the MCP server** (in another terminal):
   ```bash
   npm run mcp:server
   ```

3. **Start the frontend**:
   ```bash
   npm run dev
   ```

---

## Testing the OAuth/Login Flow

### Option 1: Run the Automated Demo

1. Click the **"Run Demo Flow"** button in the header
2. Watch the automated sequence:
   - ✅ Login with test credentials
   - 🔍 Search for programs
   - 📝 Select a program
   - ✔️ Check prerequisites
   - 📤 Submit registration

This gives you a complete end-to-end test in ~10 seconds.

### Option 2: Manual Login Testing

#### Step 1: Enter login credentials manually

Type in the chat:
```
Login with test@example.com
```

Or click the login form when it appears and fill in:
- **Email**: `test@example.com`
- **Password**: `your_password`

#### Step 2: Watch the flow

The harness will:
1. Call `scp:login` tool via MCP server
2. Display the response (success or error)
3. Store the `session_ref` for subsequent calls
4. Show the next step (program search)

#### Step 3: Check the Debug Panel

The debug panel (bottom of page) shows:
```
[USER] User message: Login with test@example.com
[TOOL] Calling mcpLogin with args: { email: "test@...", orgRef: "..." }
[TOOL] mcpLogin response received: { success: true }
[ASSISTANT] Assistant message: ✅ Successfully logged in!
```

---

## Understanding the UI Components

### 1. **Message Bubbles**
- **User messages** (right, blue): Your input
- **Assistant messages** (left, gray): Bot responses

### 2. **Interactive Components**

#### Confirmation Cards
```
┌─────────────────────────────────┐
│ Confirm Registration            │
│                                 │
│ Program: Ski Lessons            │
│ Price: $299                     │
│                                 │
│ [Confirm]  [Cancel]             │
└─────────────────────────────────┘
```

#### Program Carousel
Scrollable list of program cards with:
- Title, description, price
- Age range, dates
- "Select" button

#### Forms
Interactive forms for:
- **Login**: Email + Password
- **Registration Details**: Child name, emergency contact, waiver

#### Status Chips
Visual indicators for prerequisites:
- 🟢 **Complete**: Waiver signed
- 🔴 **Missing**: Emergency contact
- 🟡 **Pending**: Payment required

### 3. **Debug Panel**

Toggle visibility with the **"Toggle Debug"** button.

Logs show:
- `[USER]` - User actions
- `[TOOL]` - MCP tool calls with arguments
- `[ASSISTANT]` - Bot responses
- `[ERROR]` - Failures (red)
- `[SUCCESS]` - Completions (green)

---

## Testing Different Scenarios

### Test Case 1: Successful Login

**Steps:**
1. Click "Run Demo Flow"
2. Observe login step succeeds
3. Check debug panel for `session_ref`

**Expected:**
```
✅ Successfully logged in!
session_ref: "sess_abc123..."
```

### Test Case 2: Failed Login (Invalid Credentials)

**Steps:**
1. Manually type: `Login with wrong@email.com`
2. Submit form with wrong password

**Expected:**
```
❌ Error: Invalid credentials
```

### Test Case 3: Login Required Flow

**Steps:**
1. Reset conversation (click "Reset")
2. Try to search for programs without logging in
3. Observe the prompt to login first

**Expected:**
```
Please log in first to search for programs.
```

### Test Case 4: Complete Registration Flow

**Steps:**
1. Run demo flow or manually:
   - Login
   - Search for "ski lessons"
   - Select a program
   - Confirm registration
   - Fill registration form
   - Submit

**Expected:**
```
🎉 Registration submitted successfully!
Child Name: Jane Doe
You'll receive a confirmation email shortly.
```

---

## Configuration & Customization

### Update Test Data

Edit `src/lib/config/testHarness.ts`:

```typescript
export const DEMO_TEST_DATA = {
  credentials: {
    email: "your_test@email.com",  // Change this
    password: "your_test_password", // Change this
  },
  searchQuery: "summer camp",       // Change this
  childInfo: {
    childName: "Alex Smith",        // Change this
    emergencyContact: "555-0100",
  },
};
```

### Add New Providers

```typescript
export const PROVIDERS = {
  skiclubpro: { /* existing */ },
  
  // Add new provider
  summercampz: {
    id: 'summercampz',
    name: 'SummerCampZ',
    defaultOrg: 'campz-org-1',
    tools: ['scz.login', 'scz.find_programs', /* ... */],
  },
};
```

### Extend the Flow

In `src/lib/chatFlowOrchestrator.ts`, add new flow functions:

```typescript
export async function executePayment(
  amount: number,
  context: OrchestratorContext
): Promise<OrchestratorResult> {
  // Call payment tool
  const result = await callMCPTool('scp:pay', {
    session_ref: context.sessionRef,
    amount_cents: amount * 100,
  });
  
  // Parse and return
  return parsePaymentResponse(result);
}
```

---

## Troubleshooting

### Issue: "MCP server not connected"

**Solution:**
1. Check if MCP server is running: `npm run mcp:server`
2. Verify `VITE_MCP_BASE_URL` in `.env`
3. Check browser console for connection errors

### Issue: Login fails with "Invalid credentials"

**Solution:**
1. Verify test credentials match what's in your provider
2. Check MCP server logs for auth errors
3. Use debug panel to inspect the actual request

### Issue: Debug panel not showing logs

**Solution:**
1. Click "Toggle Debug" button
2. Check browser console for JavaScript errors
3. Ensure `addLog` is being called (check ChatTestHarness.tsx)

### Issue: Forms not appearing

**Solution:**
1. Check that `componentType: "form"` is returned
2. Verify `MessageBubble.tsx` handles form rendering
3. Inspect `componentData` structure in debug logs

---

## Advanced Usage

### Inspecting Network Requests

Open browser DevTools > Network tab:
- Filter by "tools/call"
- Inspect request/response payloads
- Check response times

### Testing Error Handling

Intentionally cause errors:
- Use invalid credentials
- Disconnect MCP server mid-flow
- Send malformed data

Verify:
- Error messages are user-friendly
- App doesn't crash
- Debug logs capture the error

### Performance Testing

Run demo flow 5 times in a row:
- Check for memory leaks (DevTools > Memory)
- Monitor response times in debug logs
- Verify cleanup on reset

---

## Next Steps

Once you're comfortable with the test harness:

1. **Integrate with real MCP backend** - Update tool implementations
2. **Add 2FA support** - Extend login flow for two-factor auth
3. **Test payment flows** - Add Stripe integration testing
4. **Create test suites** - Automate common test scenarios
5. **Share with team** - Use for demos and QA testing

---

## Keyboard Shortcuts

- **Enter**: Send message
- **Cmd/Ctrl + K**: Focus chat input
- **Cmd/Ctrl + D**: Toggle debug panel
- **Cmd/Ctrl + R**: Reset conversation (after confirmation)

---

## Related Documentation

- [Architecture Overview](./CHAT_TEST_HARNESS.md)
- [MCP Integration Guide](../README.md)
- [Provider Configuration](../mcp_server/config/providers/)

---

*Happy Testing! 🚀*