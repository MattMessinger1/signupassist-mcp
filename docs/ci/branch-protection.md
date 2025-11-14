# Branch Protection Setup for Main

This document provides instructions for configuring GitHub branch protection rules to prevent direct pushes to `main` and ensure all changes go through CI validation.

## Overview

Branch protection ensures that:
- All code changes are reviewed before merging
- CI checks pass before deployment
- No accidental direct pushes break production
- Team maintains code quality standards

## Setup Instructions

### 1. Navigate to Branch Protection Settings

1. Go to your GitHub repository
2. Click **Settings** (top navigation)
3. Click **Branches** (left sidebar)
4. Click **Add branch protection rule** (or edit existing `main` rule)
5. Enter `main` in the "Branch name pattern" field

### 2. Enable Required Settings

Check the following boxes:

#### Core Protection
- ✅ **Require a pull request before merging**
  - Set "Required approvals" to **1**
  - ✅ Dismiss stale pull request approvals when new commits are pushed
  - ✅ Require review from Code Owners (if using CODEOWNERS file)

#### Status Checks
- ✅ **Require status checks to pass before merging**
  - ✅ Require branches to be up to date before merging
  - Add the following required checks (select from dropdown after they've run at least once):
    - `Deploy to Railway / deploy`
    - `OpenAI Smoke Test / smoke-test`
    - `Vercel deployment`
    - `PR Gatekeeper / validate` (after implementing)
    - `CRED_SEAL_KEY tests` (optional, if applicable)

#### Additional Protection
- ✅ **Require conversation resolution before merging**
- ✅ **Do not allow bypassing the above settings**
- ✅ **Restrict who can push to matching branches** (optional - restrict to admins only)

### 3. Save Changes

Click **Create** or **Save changes** at the bottom of the page.

## Required CI Checks

The following CI checks must pass before any PR can be merged:

### Deploy to Railway
- **What it does**: Validates that the application builds and deploys successfully
- **When it runs**: On every push to PR branches
- **Failure action**: PR blocked until deployment succeeds

### OpenAI Smoke Test
- **What it does**: Validates OpenAI API integration and parameter formatting
- **When it runs**: On every push to PR branches
- **Failure action**: PR blocked until API tests pass

### Vercel Deployment
- **What it does**: Validates frontend build and deployment
- **When it runs**: On every push to PR branches
- **Failure action**: PR blocked until frontend deploys successfully

### PR Gatekeeper (New)
- **What it does**: Validates TypeScript compilation, unit tests, API payloads, AAP logic, and latency budgets
- **When it runs**: On every PR to main
- **Failure action**: PR blocked until all validations pass

### CRED_SEAL_KEY Tests (Optional)
- **What it does**: Validates credential encryption/decryption
- **When it runs**: On every push to PR branches
- **Failure action**: PR blocked if encryption is broken

## Testing Branch Protection

After setup, verify protection is working:

1. Try to push directly to `main`:
   ```bash
   git push origin main
   ```
   This should be **rejected** by GitHub.

2. Create a PR and verify:
   - You cannot merge without approval
   - You cannot merge if CI checks fail
   - You must resolve conversations before merging

## Troubleshooting

### "Required status check not found"
- The check must run at least once before you can require it
- Push a PR to trigger the check, then add it to required checks

### "Cannot merge - required checks not complete"
- Wait for all CI checks to finish
- If a check fails, review the logs and fix the issue
- Push new commits to trigger re-checks

### "Bypass protection rules" option
- Do not enable this unless absolutely necessary
- If enabled, document why and add monitoring

## Maintenance

Review and update branch protection rules:
- **Quarterly**: Review required checks and add new CI validations
- **After incidents**: Add checks to prevent similar failures
- **When adding new workflows**: Update required checks list

## Related Documentation

- [PR Gatekeeper Workflow](../../.github/workflows/pr-gatekeeper.yml)
- [Lovable Bot Configuration](../../.github/lovable.yml)
- [OpenAI Smoke Tests](../CHATGPT_INTEGRATION.md)
