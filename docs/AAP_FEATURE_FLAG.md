# AAP System Feature Flag

## Overview

The AAP (Age-Activity-Provider) extraction system has been refactored to use a structured, tool-based approach with explicit state tracking and loop prevention. The new system is controlled by a feature flag for safe rollout.

## Feature Flag

**Environment Variable**: `USE_NEW_AAP`

**Default**: `false` (legacy system)

**To Enable**: Set `USE_NEW_AAP=true` in your `.env` file

## Systems

### Legacy System (Default)
- **Files**: `mcp_server/ai/preLoginNarrowing.ts`, `mcp_server/lib/aiIntentParser.ts`
- **Mechanism**: `parseIntentWithAI()` + `mapIntentToAAP()`
- **State**: Flat fields (`childAge`, `category`, `provider`)
- **Status**: Deprecated, will be removed in Phase 4

### New System (USE_NEW_AAP=true)
- **Files**: `mcp_server/ai/aapTriageTool.ts`, `mcp_server/ai/aapDiscoveryPlanner.ts`
- **Mechanism**: OpenAI function calling with structured JSON
- **State**: Structured `AAPTriad` with status/source tracking
- **Features**:
  - ✅ Loop prevention via `asked_flags`
  - ✅ Context preservation (never loses provider/activity/age)
  - ✅ Audit trail (tracks source: explicit/implicit/profile/assumed)
  - ✅ Discovery planning (generates feed queries)
  - ✅ Graceful "not sure" handling

## Testing

### Run New System Tests
```bash
npm run test:aap
```

Or directly:
```bash
tsx scripts/testNewAAP.ts
```

### Test Cases
1. **Blackhawk Ski Loop Fix**: Ensures provider is not re-asked after being mentioned
2. **Declined Provider**: Handles "not sure" without loops
3. **All-At-Once**: Processes complete AAP in single message

### Manual Testing

1. Enable new system:
   ```bash
   echo "USE_NEW_AAP=true" >> .env
   ```

2. Start MCP server:
   ```bash
   npm run mcp:server
   ```

3. Test in Chat Harness:
   - Navigate to `/chat-test`
   - Try: "I'd like to sign up my kids for blackhawk ski"
   - Expect: Asks for age ONLY, never re-asks provider

## Migration Phases

### ✅ Phase 1+2 (Complete): Foundation + Backend Integration
- New AAP tools created
- Feature flag integrated into AIOrchestrator
- Legacy code marked deprecated
- Tests written

### ✅ Phase 3 (Complete): Frontend Integration
- Updated `src/lib/orchestratorClient.ts` to send AAP object
- Updated `src/pages/ChatTestHarness.tsx` to manage AAP state
- Backend accepts `currentAAP` parameter from frontend
- Round-trip AAP context preservation working

### Phase 4 (Next): Production Rollout & Cleanup
- Enable `USE_NEW_AAP=true` in production
- Monitor for 1-2 weeks
- Remove `USE_NEW_AAP` flag
- Delete deprecated files:
  - `mcp_server/ai/preLoginNarrowing.ts`
  - `parseIntentWithAI` from `mcp_server/lib/aiIntentParser.ts`
- Update all references

## Rollback

If issues are found with the new system:

1. Set `USE_NEW_AAP=false` in `.env`
2. Restart MCP server
3. System reverts to legacy behavior immediately

## Key Differences

| Feature | Legacy | New System |
|---------|--------|------------|
| **Loop Prevention** | ❌ None | ✅ `asked_flags` |
| **Context Loss** | ❌ Common | ✅ Never loses fields |
| **Audit Trail** | ❌ No tracking | ✅ Full source tracking |
| **Discovery Planning** | ❌ Manual | ✅ Automated feed queries |
| **"Not Sure" Handling** | ❌ Loops | ✅ Graceful defaults |

## Monitoring

When new system is enabled, watch for these log entries:

- `[NEW AAP] Using structured AAP triage system`
- `[NEW AAP TRIAGE COMPLETE]` - Check `followup_questions` and `ready_for_discovery`
- `[NEW AAP DISCOVERY PLAN]` - Verify feed query structure

Compare against legacy logs:
- `[LEGACY AAP] Using parseIntentWithAI flow`
- `[A-A-P AI EXTRACTED]`

## Support

- **Documentation**: See migration plan in conversation history
- **Tests**: `scripts/testNewAAP.ts`
- **Issues**: Check logs for `[AAP Triage]` and `[AAP Discovery Planner]` entries
