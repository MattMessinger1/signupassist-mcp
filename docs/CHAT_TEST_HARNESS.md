# ChatTestHarness - SignupAssist Test Environment

A comprehensive ChatGPT-style testing environment for the SignupAssist MCP application.

## Quick Start

1. Start MCP server: `npm run mcp:server`
2. Start frontend: `npm run dev`
3. Navigate to `/chat-test-harness`
4. Click "Run Demo Flow" for automated test

## Architecture

### Modular Structure
- **Config**: `lib/config/testHarness.ts` - Centralized settings, test data, providers
- **Orchestrator**: `lib/chatFlowOrchestrator.ts` - Flow execution and coordination
- **Parser**: `lib/chatResponseParser.ts` - Response formatting
- **Logger**: `lib/debugLogger.ts` - Structured logging

### Components
- `HarnessHeader` - Title, status, actions
- `MessageList` - Chat display
- `MessageBubble` - Individual messages with UI components
- `ChatInput` - Message input
- `DebugPanel` - Event logging

## Key Features

✅ Real MCP backend integration
✅ Automated demo flow
✅ Debug logging panel
✅ Reset/retry capability
✅ Modular, extensible architecture
✅ Comprehensive documentation

## Extending

Add new providers in `testHarness.ts`, new flow steps in `chatFlowOrchestrator.ts`, new UI components in `chat-test/` directory.
