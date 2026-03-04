# PR #14 Conflict Resolution Runbook

This runbook is for resolving:

- **PR #14** `codex/implement-rate-limiting-and-throttling` -> `main`
- GitHub reports a conflict in `mcp_server/index.ts`

## What to do (quick path)

1. In GitHub PR #14, click **Resolve conflicts**.
2. In `mcp_server/index.ts`, keep both:
   - existing child-scope guardrail logic, and
   - new stable rate-limit keying + `/orchestrator/chat` throttles.
3. Remove conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).
4. Mark resolved and commit to the PR branch.
5. Re-run checks.
6. Merge when checks are green.

## Command-line path (recommended if web editor is painful)

```bash
git fetch origin

git checkout codex/implement-rate-limiting-and-throttling

git merge origin/main
# resolve conflicts in mcp_server/index.ts

git add mcp_server/index.ts
git commit -m "Resolve main conflict in index.ts; preserve guardrail + stable throttles"
git push origin codex/implement-rate-limiting-and-throttling
```

## What to keep in the conflict

When resolving `mcp_server/index.ts`, confirm these behaviors survive:

- Stable key derivation prefers user identity over IP fallback.
- `POST /orchestrator/chat` has explicit rate limit controls.
- Booking-like chat intents use stricter optional limit if configured.
- 429 response message is consistent and parent-friendly.
- Existing family-safe child-scope guardrail remains active before orchestration.

## Suggested PR comment

Use this on PR #14 after pushing the conflict-resolution commit:

> Resolved merge conflicts in `mcp_server/index.ts` by preserving both the existing child-scope guardrail and the new stable throttling changes (`/orchestrator/chat` + registration throttles). Re-ran rate-limit tests and build locally; ready for final review.

## Should you click “Create PR” now?

- If PR #14 already exists (it does), **do not** open a new PR.
- Instead, push a conflict-resolution commit to the same branch and continue that PR.
