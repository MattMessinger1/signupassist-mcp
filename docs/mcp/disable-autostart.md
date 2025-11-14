# Disable MCP Auto-start in Lovable

To ensure Lovable never spawns a stale MCP server:

1. Open Lovable.
2. Click the MCP icon (sidebar) or Settings → MCP.
3. Find "Auto-start MCP server" and toggle it OFF.
4. Restart Lovable.

This step prevents Lovable from running old MCP code locally and ensures all connections go through the production Railway backend at `https://signupassist-mcp-production.up.railway.app`.

## Why This Matters

- **Prevents stale servers**: No outdated local MCP instances running
- **Consistent behavior**: All environments use the same production backend
- **Matches smoke tests**: Lovable behavior matches CI/CD smoke test environment
- **No cached state**: Eliminates issues from locally cached MCP sessions

## Verification

After disabling auto-start:
1. Navigate to `/chat-test` in your app
2. Verify the header shows "🚀 Railway Production" badge
3. Run the health check to confirm connection to production backend
