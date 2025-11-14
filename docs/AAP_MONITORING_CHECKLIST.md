# AAP System Monitoring Checklist

Use this checklist before running Phase 4 cleanup to ensure the new AAP system is stable in production.

## Pre-Production Checklist

### ✅ Phase 1+2: Implementation Complete
- [x] New AAP tool files created (`aapTriageTool.ts`, `aapDiscoveryPlanner.ts`)
- [x] Feature flag `USE_NEW_AAP` added to AIOrchestrator
- [x] Legacy code marked with `@deprecated` tags
- [x] Test script created (`scripts/testNewAAP.ts`)

### ✅ Phase 3: Frontend Integration Complete
- [x] `orchestratorClient.ts` updated to send `currentAAP`
- [x] `ChatTestHarness.tsx` manages AAP state
- [x] Backend accepts and processes `currentAAP` parameter
- [x] Round-trip context preservation working

### ⏳ Testing Phase (Before Phase 4)
- [ ] All test cases pass (`tsx scripts/testNewAAP.ts`)
  - [ ] Test Case 1: Blackhawk ski loop fix
  - [ ] Test Case 2: Declined provider handling
  - [ ] Test Case 3: All-at-once input
- [ ] Manual testing in `/chat-test` with `USE_NEW_AAP=true`
  - [ ] Provider extraction works correctly
  - [ ] Age extraction works correctly
  - [ ] Activity extraction works correctly
  - [ ] No question loops occur
  - [ ] Context preserved across turns

## Production Monitoring Checklist

### Week 1: Initial Deployment
Enable `USE_NEW_AAP=true` in production and monitor:

#### Daily Checks
- [ ] **Day 1**: Check logs for `[NEW AAP]` entries
  - [ ] No errors in `[AAP Triage]` logs
  - [ ] No errors in `[AAP Discovery Planner]` logs
  - [ ] `ready_for_discovery` flag being set correctly
  
- [ ] **Day 2-3**: Monitor user flows
  - [ ] Users completing registration flows
  - [ ] No reports of repeated questions
  - [ ] Provider names being recognized
  
- [ ] **Day 4-5**: Check edge cases
  - [ ] Users saying "not sure" about provider
  - [ ] Users providing all AAP info at once
  - [ ] Users changing their mind mid-flow

- [ ] **Day 6-7**: Performance check
  - [ ] Response times acceptable (< 2s for triage)
  - [ ] OpenAI API calls completing successfully
  - [ ] No timeout errors

#### Key Metrics to Track

```bash
# Search logs for AAP activity
grep "\[NEW AAP\]" logs.txt | wc -l

# Check for triage errors
grep "\[AAP Triage\] Error" logs.txt

# Verify discovery readiness
grep "ready_for_discovery.*true" logs.txt | wc -l

# Look for question loops (should be 0)
grep "asked_age.*true.*asked_age.*true" logs.txt
```

#### Success Criteria for Week 1
- [ ] Zero `[AAP Triage] Error` entries
- [ ] Zero question loop reports from users
- [ ] At least 50 successful AAP extractions
- [ ] `ready_for_discovery` correctly set in 90%+ of cases
- [ ] Average triage time < 500ms
- [ ] Zero fallback to legacy system (if flag-based)

### Week 2: Stability Verification
Continue monitoring with focus on edge cases:

#### Daily Checks
- [ ] **Day 8-10**: Edge case validation
  - [ ] Typos in provider names handled
  - [ ] Informal age inputs (e.g., "elementary school") working
  - [ ] Multiple children scenarios working
  
- [ ] **Day 11-12**: Integration check
  - [ ] AAP data flowing to discovery planner
  - [ ] Feed queries being generated correctly
  - [ ] Program cards showing age-appropriate results
  
- [ ] **Day 13-14**: Final validation
  - [ ] No regression issues reported
  - [ ] User satisfaction maintained or improved
  - [ ] Support tickets related to AAP extraction: 0

#### Success Criteria for Week 2
- [ ] All Week 1 metrics maintained
- [ ] Zero critical bugs discovered
- [ ] Zero rollbacks to legacy system
- [ ] Positive user feedback on flow smoothness
- [ ] No increase in support tickets

## Ready for Phase 4?

**All items must be checked before proceeding with cleanup:**

### Prerequisites
- [ ] ✅ Production running with `USE_NEW_AAP=true` for 2 weeks
- [ ] ✅ All Week 1 success criteria met
- [ ] ✅ All Week 2 success criteria met
- [ ] ✅ Zero critical issues discovered
- [ ] ✅ Team consensus to proceed

### Backup Plan
- [ ] Database backup taken
- [ ] Legacy code still available in git history
- [ ] Rollback plan documented (see below)

### Final Checks Before Cleanup
```bash
# Run test suite one final time
tsx scripts/testNewAAP.ts

# Check for any remaining legacy AAP references
grep -r "parseIntentWithAI" mcp_server/
grep -r "parseAAPTriad" mcp_server/

# Verify no legacy system usage in recent logs
grep "\[LEGACY AAP\]" logs.txt --after-context=5
```

## Rollback Plan (If Issues Found)

If critical issues are discovered during monitoring:

1. **Immediate Rollback**:
   ```bash
   # Disable new system
   echo "USE_NEW_AAP=false" >> .env
   
   # Restart MCP server
   npm run mcp:server
   ```

2. **Investigate**:
   - Collect logs from failed flows
   - Identify specific AAP scenarios causing issues
   - Test fix in development with `USE_NEW_AAP=true`

3. **Re-enable After Fix**:
   - Deploy fix
   - Enable `USE_NEW_AAP=true` again
   - Restart 2-week monitoring period

## Phase 4 Cleanup Script

Once all checkboxes are complete:

```bash
# DRY RUN first (see what would change)
tsx scripts/aapCleanupPhase4.ts

# Review changes, then apply
tsx scripts/aapCleanupPhase4.ts --confirm
```

## Post-Cleanup Monitoring

After Phase 4 cleanup (first 48 hours):

- [ ] Application builds successfully
- [ ] No TypeScript errors
- [ ] No runtime errors in logs
- [ ] All integration tests pass
- [ ] User flows working normally
- [ ] No reports of broken functionality

## Sign-Off

**Monitoring completed by**: ___________________  
**Date**: ___________________  
**Phase 4 cleanup approved**: Yes / No  
**Notes**:

---

## Log Patterns to Watch

### Good Patterns ✅
```
[NEW AAP] Using structured AAP triage system
[AAP Triage] Result: { aap: { age: { status: 'known', ... } }, ready_for_discovery: true }
[NEW AAP DISCOVERY PLAN] { feed_query: { org_ref: 'blackhawk', ... } }
```

### Warning Patterns ⚠️
```
[AAP Triage] Error: OpenAI API call failed
[AAP Triage] Result: { followup_questions: [...] } // More than 1 question for same field
[AAP Discovery Planner] Error: Failed to generate plan
```

### Critical Patterns 🚨
```
[LEGACY AAP] Using parseIntentWithAI flow  // Should be ZERO with USE_NEW_AAP=true
[AAP Triage] Error: Timeout
[A-A-P AI] Preserving provider from context  // Legacy system active
```

## Support Resources

- **Test Script**: `tsx scripts/testNewAAP.ts`
- **Feature Flag Docs**: `docs/AAP_FEATURE_FLAG.md`
- **Migration Plan**: See conversation history for full implementation plan
- **Cleanup Script**: `scripts/aapCleanupPhase4.ts`
