# AAP Phase 4 Cleanup - Runbook

## Overview

This runbook guides you through the final phase of the AAP system migration: removing the feature flag and legacy code.

**Timeline**: 30 minutes for execution + 2 weeks of prior monitoring

## Prerequisites

⚠️ **DO NOT PROCEED** unless:

1. ✅ `USE_NEW_AAP=true` has been in production for 2+ weeks
2. ✅ All items in `AAP_MONITORING_CHECKLIST.md` are checked
3. ✅ Zero critical issues discovered
4. ✅ Team sign-off obtained

## Step-by-Step Execution

### Step 0: Pre-Cleanup Verification (5 mins)

```bash
# Verify test suite passes
tsx scripts/testNewAAP.ts

# Expected output:
# Test Case 1 (Blackhawk Loop): ✅ PASS
# Test Case 2 (Declined Provider): ✅ PASS
# Test Case 3 (All-At-Once): ✅ PASS
# Overall: ✅ ALL TESTS PASSED
```

If any tests fail, **STOP** and investigate.

### Step 1: Create Backup (2 mins)

```bash
# Create git branch for cleanup
git checkout -b aap-phase4-cleanup

# Commit current state
git add .
git commit -m "Pre-Phase4: Stable state before AAP cleanup"
```

### Step 2: Dry Run Cleanup Script (5 mins)

```bash
# Run cleanup in dry-run mode
tsx scripts/aapCleanupPhase4.ts

# Review output carefully
# Verify it will:
# - Remove USE_NEW_AAP flag from AIOrchestrator
# - Delete preLoginNarrowing.ts
# - Remove parseIntentWithAI from aiIntentParser
# - Clean up legacy imports
# - Update documentation
```

### Step 3: Execute Cleanup (5 mins)

```bash
# Run actual cleanup
tsx scripts/aapCleanupPhase4.ts --confirm

# You will be prompted:
# "Have you monitored production for 1-2 weeks with no AAP issues? (yes/no):"
# Type: yes
```

### Step 4: Verify Changes (5 mins)

```bash
# Check what was modified
git status

# Expected changes:
# modified:   mcp_server/ai/AIOrchestrator.ts
# deleted:    mcp_server/ai/preLoginNarrowing.ts
# modified:   mcp_server/lib/aiIntentParser.ts
# modified:   docs/AAP_FEATURE_FLAG.md

# Review diffs
git diff mcp_server/ai/AIOrchestrator.ts
git diff mcp_server/lib/aiIntentParser.ts
```

Verify:
- [ ] `USE_NEW_AAP_SYSTEM` constant removed
- [ ] `if (USE_NEW_AAP_SYSTEM)` branch removed
- [ ] Only NEW AAP code remains
- [ ] Legacy imports removed
- [ ] `preLoginNarrowing.ts` deleted
- [ ] `parseIntentWithAI` removed from `aiIntentParser.ts`

### Step 5: Build Verification (5 mins)

```bash
# Type check
npm run build:check

# Expected: No TypeScript errors

# Run tests again
tsx scripts/testNewAAP.ts

# Expected: All tests still pass
```

### Step 6: Commit Changes (2 mins)

```bash
git add .
git commit -m "Phase 4: Remove AAP feature flag and legacy code

- Removed USE_NEW_AAP feature flag from AIOrchestrator
- Deleted deprecated preLoginNarrowing.ts
- Removed parseIntentWithAI from aiIntentParser.ts
- Cleaned up legacy imports
- Updated documentation to reflect Phase 4 completion

All tests passing. Monitoring period complete."
```

### Step 7: Deploy to Staging (if available) (5 mins)

```bash
# Push to staging branch
git push origin aap-phase4-cleanup

# Deploy to staging environment
# (Your deployment process here)

# Test in staging
# - Navigate to /chat-test
# - Try: "I'd like to sign up my kids for blackhawk ski"
# - Expect: Asks for age only, no provider re-ask
```

### Step 8: Deploy to Production (1 min)

```bash
# Merge to main
git checkout main
git merge aap-phase4-cleanup

# Push to production
git push origin main

# Production auto-deploys (or trigger deployment)
```

### Step 9: Post-Deployment Monitoring (48 hours)

**First Hour**:
```bash
# Watch logs for errors
tail -f logs.txt | grep "\[AAP\|ERROR\|FATAL"

# Should see:
# [NEW AAP] Using structured AAP triage system
# [AAP Triage] Result: ...
# [AAP Discovery Planner] ...

# Should NOT see:
# [LEGACY AAP] ...
# Error: USE_NEW_AAP is not defined
```

**First Day**:
- [ ] Monitor error rates (should be unchanged)
- [ ] Check user flow completion rates
- [ ] Verify no increase in support tickets
- [ ] Review logs for any AAP-related errors

**First Week**:
- [ ] Continued monitoring of key metrics
- [ ] User feedback remains positive
- [ ] No regression bugs reported

## Rollback Procedure

If critical issues are discovered **immediately after cleanup**:

### Emergency Rollback (5 mins)

```bash
# Revert to previous commit
git revert HEAD

# Or hard reset if needed
git reset --hard HEAD~1

# Force push (if already deployed)
git push origin main --force

# Redeploy previous version
```

### Restore Legacy Code (10 mins)

If you need to restore the feature flag system:

```bash
# Checkout the pre-cleanup commit
git checkout <pre-phase4-commit-sha>

# Create new branch
git checkout -b restore-aap-feature-flag

# Cherry-pick any critical fixes made after cleanup
git cherry-pick <fix-commit-sha>

# Deploy restored version
git push origin restore-aap-feature-flag
```

## Verification Checklist

After Phase 4 cleanup is complete:

### Immediate (Within 1 hour)
- [ ] Application starts without errors
- [ ] No TypeScript compilation errors
- [ ] Logs show `[NEW AAP]` entries
- [ ] Logs show NO `[LEGACY AAP]` entries
- [ ] Test suite passes
- [ ] Manual testing in /chat-test works

### First Day
- [ ] At least 20 successful AAP extractions logged
- [ ] Zero `USE_NEW_AAP is not defined` errors
- [ ] Zero AAP-related user complaints
- [ ] Support ticket volume normal

### First Week
- [ ] All metrics stable
- [ ] User satisfaction maintained
- [ ] No regression bugs discovered
- [ ] Team confirms cleanup success

## Files Modified in Phase 4

| File | Change Type | Description |
|------|-------------|-------------|
| `mcp_server/ai/AIOrchestrator.ts` | Modified | Removed feature flag, kept only new AAP code |
| `mcp_server/ai/preLoginNarrowing.ts` | Deleted | Legacy AAP extraction logic |
| `mcp_server/lib/aiIntentParser.ts` | Modified | Removed `parseIntentWithAI` function |
| `docs/AAP_FEATURE_FLAG.md` | Modified | Updated to reflect Phase 4 completion |

## Common Issues & Solutions

### Issue: "Cannot find module './preLoginNarrowing.js'"
**Cause**: Import still exists somewhere  
**Solution**: 
```bash
grep -r "preLoginNarrowing" mcp_server/
# Remove any remaining imports
```

### Issue: "USE_NEW_AAP_SYSTEM is not defined"
**Cause**: Feature flag reference not removed  
**Solution**: Check AIOrchestrator.ts for any remaining `USE_NEW_AAP_SYSTEM` references

### Issue: TypeScript errors after cleanup
**Cause**: Legacy type imports still present  
**Solution**: 
```bash
npm run build:check
# Review errors and remove legacy type imports
```

## Success Criteria

Phase 4 cleanup is successful when:

1. ✅ All tests pass
2. ✅ Application builds without errors
3. ✅ Production logs show only `[NEW AAP]` entries
4. ✅ No user-reported issues for 1 week post-cleanup
5. ✅ Team confirms cleanup success

## Sign-Off

**Executed by**: ___________________  
**Date**: ___________________  
**Deployment commit**: ___________________  
**Status**: Success / Rolled Back  
**Notes**:

---

## Next Steps After Phase 4

1. Archive this runbook for future reference
2. Update team documentation
3. Share learnings in team retrospective
4. Consider similar migration patterns for future refactors

## Support

- **Test Script**: `tsx scripts/testNewAAP.ts`
- **Monitoring**: `docs/AAP_MONITORING_CHECKLIST.md`
- **Cleanup Script**: `scripts/aapCleanupPhase4.ts`
- **Migration History**: See git commit history
