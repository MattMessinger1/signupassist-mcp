# OpenAI Helpers Unit Tests

This file contains unit tests for the OpenAI parameter builders to ensure correct API family separation.

## Running Tests

### Run all tests
```bash
npx vitest run mcp_server/lib/openaiHelpers.test.ts
```

### Run in watch mode (during development)
```bash
npx vitest watch mcp_server/lib/openaiHelpers.test.ts
```

### Run with coverage
```bash
npx vitest run mcp_server/lib/openaiHelpers.test.ts --coverage
```

## Test Coverage

### `buildOpenAIBody`
- ✅ Responses API uses `text.format.type === "json"`
- ✅ Responses API does NOT include `response_format`
- ✅ Responses API uses `input` for messages
- ✅ Responses API uses `max_output_tokens`
- ✅ Chat Completions API uses `response_format.type === "json_object"`
- ✅ Chat Completions API does NOT include `text`
- ✅ Chat Completions API uses `messages` for messages
- ✅ Chat Completions API uses `max_tokens`
- ✅ Both APIs always include `model` field
- ✅ Chat API supports `tools` and `tool_choice`

### `supportsCustomTemperature`
- ✅ Returns `false` for GPT-5 models
- ✅ Returns `false` for O3/O4 reasoning models
- ✅ Returns `false` for vision-preview models
- ✅ Returns `true` for GPT-4o models
- ✅ Returns `true` for GPT-4.1 models
- ✅ Returns `true` for legacy GPT-4 models

### Temperature Handling
- ✅ Does NOT include temperature for vision-preview models
- ✅ Does NOT include temperature for GPT-5 models
- ✅ Does NOT include temperature for O3/O4 models
- ✅ Includes temperature for supporting models
- ✅ Omits temperature when undefined

### Integration Tests
- ✅ Full Responses API payload validation
- ✅ Full Chat Completions API payload validation

## What These Tests Prevent

1. **Invalid Parameter Families**: Catching mixups like sending `text.format` to Chat Completions or `response_format` to Responses API
2. **Temperature Errors**: Preventing `Unsupported value: 'temperature'` errors on models that don't support it
3. **Missing Model Field**: Ensuring the `model` field is always present
4. **Token Parameter Mixups**: Using correct `max_tokens` vs `max_output_tokens` per API
5. **Message Format Errors**: Using correct `input` vs `messages` per API

## CI/CD Integration

These tests run automatically on:
- Every pull request (`.github/workflows/openai-smoke-test.yml`)
- Every push to main
- Before Railway deployment

If tests fail, the build is blocked to prevent broken deployments.
