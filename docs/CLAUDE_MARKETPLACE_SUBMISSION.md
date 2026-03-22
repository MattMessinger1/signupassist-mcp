# Claude Marketplace Submission — SignupAssist MCP

## Overview

SignupAssist is an MCP-compliant AI assistant that helps parents find and register children for activities (camps, classes, lessons, sports). It connects to provider APIs (Bookeo, ActiveNet, etc.) to search programs, fill forms, and process payments — all through natural conversation.

## Claude Integration Status

| Requirement | Status |
|---|---|
| MCP protocol compliance | Done |
| Claude as AI provider | Done (via AI_PROVIDER=claude) |
| Anthropic SDK integrated | Done (@anthropic-ai/sdk) |
| Provider-agnostic abstraction | Done (aiProvider.ts) |
| Model mapping (GPT → Claude) | Done |
| OAuth 2.0 authentication | Done (Auth0) |

## Architecture

```
User ↔ Claude Desktop/API ↔ MCP Protocol ↔ SignupAssist Server
                                              ├─ AI Layer (Claude or OpenAI)
                                              ├─ Provider APIs (Bookeo, ActiveNet)
                                              ├─ Program Search & Matching
                                              └─ Registration & Payment
```

### AI Provider Switching

Set `AI_PROVIDER=claude` in environment to use Claude for all AI operations:
- Intent parsing (activity, provider, age extraction)
- Program categorization and summarization
- Natural language question generation
- Input classification and normalization

Model mapping:
- `gpt-4o` → `claude-sonnet-4-6`
- `gpt-4o-mini` → `claude-haiku-4-5-20251001`

## Key Differentiators

1. **Family-Safe Design**: Built for parents registering children — all content is appropriate and helpful
2. **Enterprise Audit Logging**: Full audit trail for compliance
3. **Mandate System**: Configurable rules for provider-specific requirements
4. **Multi-Provider**: Connects to Bookeo, ActiveNet, and more via direct APIs
5. **No Scraping**: All data comes from official provider APIs

## MCP Tools

| Tool | Purpose |
|---|---|
| `signupassist.start` | Begin a new registration session |
| `signupassist.chat` | Continue an existing conversation |

Both tools include proper annotations:
- `readOnlyHint: true`
- `destructiveHint: false`
- `openWorldHint: true`

## Security

- OAuth 2.0 with Auth0
- VGS (Very Good Security) for PII tokenization
- No raw credentials stored
- HTTPS-only endpoints
- Input sanitization on all user data

## Environment Variables

```env
AI_PROVIDER=claude
ANTHROPIC_API_KEY=your-key
CLAUDE_MODEL=claude-sonnet-4-6
```

## Marketplace Application

- Partner waitlist: https://claude.com/platform/marketplace
- Contact: support@shipworx.ai
- Production URL: https://signupassist-mcp-production.up.railway.app
