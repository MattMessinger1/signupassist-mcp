# ChatGPT App Store Submission Checklist

## App Metadata

| Field | Value |
|---|---|
| App Name | SignupAssist |
| Short Description | AI-powered child activity registration assistant |
| Category | Productivity / Family |
| Privacy Policy URL | https://signupassist-mcp-production.up.railway.app/safety |
| Support Email | support@shipworx.ai |
| Company | ShipWorx AI |

## Required Assets

- [x] Logo: `public/logo-512.png` (512x512 PNG, transparent background)
- [x] Logo SVG: `public/logo-512.svg`
- [ ] Screenshots (3-5): Capture from a working ChatGPT session showing:
  1. Initial conversation — user asks to find an activity
  2. Program search results with cards
  3. Registration form filling flow
  4. Payment confirmation screen
  5. Success message with receipt

## Technical Requirements

- [x] MCP server over HTTPS (Railway production)
- [x] `.well-known/chatgpt-apps-manifest.json` with OAuth, MCP URL, logo
- [x] `.well-known/openai-apps-challenge` domain verification token
- [x] OAuth 2.0 authentication (Auth0-backed)
- [x] Tool annotations (`readOnlyHint`, `destructiveHint`, `openWorldHint`)
- [x] Privacy policy endpoint
- [x] `.well-known/oauth-protected-resource`

## Tools Registered

| Tool | Description | Annotations |
|---|---|---|
| `search_activities` | Start a new registration session | readOnly, openWorld |
| `register_for_activity` | Continue registration conversation | readOnly, openWorld |

## Submission Steps

1. Go to https://platform.openai.com/apps
2. Click "Create App"
3. Fill in metadata from table above
4. Upload `public/logo-512.png`
5. Enter MCP server URL: `https://signupassist-mcp-production.up.railway.app`
6. Configure OAuth settings (Auth0 credentials)
7. Upload screenshots
8. Submit for review

## Notes

- Tool descriptions are factual and scoped (no promotional language)
- Error messages return user-friendly text
- All API calls include proper error handling with fallbacks
