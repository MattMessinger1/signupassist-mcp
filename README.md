# SignupAssist MCP Server

A Model Context Protocol (MCP) server for automated signup assistance across multiple platforms including SkiClubPro/Blackhawk, DaySmart, and CampMinder.

## Architecture

```
/mcp_server/        → Registers all MCP tools with the framework
/providers/
  /skiclubpro/      → Tools for Blackhawk signup (login, register, pay)
  /daysmart/        → Tools for DaySmart signup (to be added later)
  /campminder/      → Tools for CampMinder signup
/core/
  /scheduler/       → Cron/worker logic to trigger signups at exact open times
  /billing/         → Stripe integration + success-flag logic (we only get paid if signup succeeds)
  /auth/           → Credential handling and encryption
/evals/             → Evaluation scripts and metrics (Coverage, Win Rate, Credential Reuse, Billing alignment)
```

## Features

- **Multi-Provider Support**: Modular architecture supports multiple signup platforms
- **Scheduled Signups**: Precise timing for signup attempts at registration opening times
- **Success-Based Billing**: Users only pay when signups succeed
- **Secure Credential Storage**: Encrypted credential management with AES-256-GCM
- **Comprehensive Evaluation**: Metrics tracking for coverage, win rates, and billing alignment

## Provider Status

| Provider | Status | Features |
|----------|--------|----------|
| SkiClubPro/Blackhawk | 🔄 Structure Ready | Login, Register, Pay, Availability |
| DaySmart | 📋 Planned | TBD |
| CampMinder | 🔄 Structure Ready | Login, Register, Availability |

## MCP Tools

### SkiClubPro Tools
- `skiclubpro_login`: Login to SkiClubPro/Blackhawk system
- `skiclubpro_register`: Register for a program
- `skiclubpro_pay`: Complete payment flow
- `skiclubpro_check_availability`: Check program availability

### CampMinder Tools
- `campminder_login`: Login to CampMinder system
- `campminder_register`: Register for a camp session
- `campminder_check_availability`: Check session availability

### DaySmart Tools
- `daysmart_login`: Login to DaySmart system (placeholder)
- `daysmart_register`: Register for an activity (placeholder)

## Development

This is a clean, modular implementation ready for selective migration of working Playwright logic. The structure supports:

- Easy addition of new providers
- Scalable scheduling system
- Secure credential management
- Comprehensive monitoring and evaluation

## Original Lovable Project

**URL**: https://lovable.dev/projects/8721bd7e-6b19-4422-86f3-414abf704067

This project has been restructured as an MCP server. The original Lovable project technologies are preserved in the development environment:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS