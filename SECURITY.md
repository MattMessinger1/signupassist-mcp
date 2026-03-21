# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in SignupAssist, please report it responsibly.

**Email:** security@shipworx.ai

Please include:
- A description of the vulnerability
- Steps to reproduce the issue
- The potential impact

## Response Timeline

- **Acknowledgment:** Within 48 hours of receiving a report
- **Initial assessment:** Within 5 business days
- **Resolution target:** Critical vulnerabilities within 14 days; others within 30 days

## Scope

This policy covers:
- The SignupAssist MCP server (`mcp_server/`)
- Supabase edge functions (`supabase/functions/`)
- Public-facing APIs and endpoints
- Authentication and authorization flows

## Security Practices

- All secrets are stored in environment variables, never in source code
- Provider API keys are server-side only and passed via HTTP headers where possible
- No provider login credentials are stored by SignupAssist
- All data is encrypted at rest (Supabase) and in transit (TLS/HTTPS)
- Row-Level Security (RLS) is enforced on all user-facing database tables
- Authentication is handled via OAuth (Auth0)

## Out of Scope

- Third-party services (Supabase, Stripe, Bookeo) -- report directly to those providers
- Social engineering attacks
- Denial of service attacks
