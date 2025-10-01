# SignupAssist MCP

This repository implements the MCP (Mandated Control Protocol) agent for automating responsible delegate actions such as logging in, discovering fields, and submitting forms on behalf of parents with explicit mandates.

It provides:

- **Antibot-aware login flows**: Human-like typing, randomized delays, and detection of hidden honeypot fields (`antibot_key`) to mimic real user behavior.
- **Form submission helpers**: Functions that wait for Antibot JavaScript tokens to populate before submitting, to avoid rejection by Drupal-based providers like SkiClubPro.
- **Mandate + scope enforcement**: All actions are logged and tied to explicit parent mandates, creating a transparent audit trail.

## Future Build: Verifiable Credentials (VCs)

Looking ahead, we plan to extend MCP to use **W3C Verifiable Credentials** or **cryptographic client tokens** to bypass legacy Antibot measures responsibly.

- **Why?** Today, Antibot blocks legitimate delegate automation by treating all automation as bots.
- **How VCs help:** MCP can issue signed credentials proving:
  - Parent consent was granted.
  - Scope of action (login, registration, payment).
- **Provider integration:** Providers like SkiClubPro could add a Drupal module to validate MCP-issued tokens. This would allow them to **trust MCP clients** and skip Antibot/Honeypot checks when mandates are cryptographically verified.

This approach aligns with the **Responsible Delegate Mode (RDM)** vision: moving from mimicking humans to presenting cryptographic proof of authorization.

## Getting Started

- Clone this repo
- Deploy with Supabase Edge Functions + MCP server
- Configure provider credentials via `cred-get`
- Run MCP server:
  ```bash
  npm run mcp:start
  ```

## Contributing

Future contributors should extend the `lib/login.ts` and `lib/formHelpers.ts` modules to:

- Add support for new providers.
- Integrate VC-based authentication once providers are ready.
- Expand Antibot detection and debugging capabilities.
