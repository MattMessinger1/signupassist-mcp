# Chat Test Harness

A ChatGPT-style conversation simulator for testing the SignupAssist flow end-to-end with real MCP backend integration.

## Overview

This test harness mimics ChatGPT's conversational UI and behavior, allowing you to test the complete signup flow including:
- Provider search and disambiguation
- Login flow with credentials
- Program discovery and selection
- Prerequisite checking
- Form filling and registration
- Payment processing

## Setup

### 1. Configure Environment Variables

Create a `.env` file with the following variables (see `.env.example`):

```bash
# MCP Server URL (required)
VITE_MCP_BASE_URL=http://localhost:8080

# MCP Access Token (required for authenticated calls)
VITE_MCP_ACCESS_TOKEN=your-token-here
```

### 2. Start the MCP Server

The MCP server must be running for backend integration to work:

```bash
# In a separate terminal
npm run mcp:http
```

The server will start on port 8080 (or the port specified in your env).

### 3. Access the Test Harness

Navigate to `/chat-test` in your browser:

```
http://localhost:8080/chat-test
```

## Usage

### Connection Status

The header shows the MCP connection status:
- 🟢 **MCP Connected** - Backend is reachable, tools are available
- 🔴 **MCP Disconnected** - Backend is unreachable, check console logs

### Testing Flows

#### 1. Program Search Flow

Type a message like:
```
I need ski lessons for my child
```

This will:
- Call `scp:find_programs` to search for programs
- Display a carousel of matching programs
- Allow you to select a program

#### 2. Login Flow

When a form requests login credentials:
1. Fill in the email and password fields
2. Click "Submit"
3. Calls `scp:login` with credentials
4. On success, stores session reference and proceeds

#### 3. Registration Flow

After selecting a program and logging in:
1. Reviews prerequisites via `scp:check_prerequisites`
2. Shows prerequisite status chips
3. Requests additional information via form
4. Submits registration via `scp:register`

## Interactive Components

The harness demonstrates all SignupAssist UI components:

### Confirmation Cards
Shows summary information with Confirm/Cancel actions.

### Carousels
Horizontal scrollable list of selectable options (programs, dates, etc.).

### Forms
Inline forms for collecting information:
- Text inputs (email, name, phone)
- Checkboxes (waivers, agreements)
- Form validation

### Status Chips
Visual indicators for prerequisite completion:
- 🟢 Done (completed)
- 🟡 Pending (required)
- 🔴 Error (failed)

## Backend Integration

All UI interactions trigger real MCP tool calls:

| User Action | MCP Tool Called | Purpose |
|------------|----------------|---------|
| Search for programs | `scp:find_programs` | Discover available programs |
| Select program | `scp:check_prerequisites` | Verify requirements |
| Login | `scp:login` | Authenticate with provider |
| Submit registration | `scp:register` | Create enrollment |
| Complete payment | `scp:pay` | Process payment |

## Debugging

### Console Logs

All MCP calls are logged to the console with details:
```
[MCP] Calling tool: scp:find_programs { org_ref: "blackhawk-ski-club", query: "ski" }
[MCP] Tool call success: { success: true, programs: [...] }
```

### Network Tab

Check the Network tab for HTTP requests to `/tools/call`:
- Request payload shows tool name and arguments
- Response shows success/failure and data

### Toast Notifications

Errors are displayed as toast notifications in the UI.

## Conversation State

The harness maintains conversation state:

```typescript
{
  sessionRef: string;      // Login session from scp:login
  orgRef: string;          // Provider organization reference
  selectedProgram: object; // User's selected program
  childId: string;         // Child being registered
  registrationRef: string; // Registration confirmation
  prerequisites: array;    // Checked prerequisites
}
```

This state is used to pass context between tool calls.

## Extending the Harness

### Adding New Tool Calls

1. Add a convenience method in `src/lib/chatMcpClient.ts`:
```typescript
export async function mcpCustomTool(arg1: string) {
  return callMCPTool('scp:custom_tool', { arg1 });
}
```

2. Wire it to a handler in `ChatTestHarness.tsx`:
```typescript
const handleCustomAction = async () => {
  const result = await mcpCustomTool("value");
  if (result.success) {
    addAssistantMessage("Custom action completed!");
  }
};
```

### Adding New UI Components

Create a new component in `src/components/chat-test/` and add it to the message rendering logic.

## Known Limitations

- Currently uses mock data for some responses (program lists, prerequisites)
- Does not persist conversation history across page reloads
- Limited error recovery and retry logic
- No support for multi-step forms or conditional branching

## Future Enhancements

- [ ] Persist conversation history to Supabase
- [ ] Add support for 2FA login flows
- [ ] Implement real-time updates via websockets
- [ ] Add conversation export/import
- [ ] Support for multi-child registration
- [ ] Integration with Stripe test mode for payment testing
