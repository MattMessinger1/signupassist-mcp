# SignupAssist-MCP

**SignupAssist** is an MCP-native project designed to act as a responsible delegate for parents. Our system automates competitive signups for kids' activities (camps, sports, clubs), giving families peace of mind.

## Mission
Parents shouldn't have to wake up at midnight to grab a spot for their child. SignupAssist automates this process securely, reliably, and with a full audit trail.

## Value Propositions
1. **Set & Forget:** Parents schedule once, and our agent handles the signup.
2. **Fast Competitive Signup:** We trigger at the exact moment signups open, maximizing the chance of success.
3. **Credential Reuse:** Securely store and reuse login/payment info across providers.
4. **Reminders:** Parents receive alerts 30 days and 7 days before signups open.

## Revenue Model
We only get paid upon success. Each successful signup (with proof of confirmation) triggers billing via Stripe. Parents never pay for failures.

## Architecture
- **MCP-Native Design:** Each provider (e.g., SkiClubPro, DaySmart, CampMinder) is implemented as a set of MCP tools (login, register, pay).
- **Scheduler:** Jobs fire at exact signup open times.
- **Billing:** Stripe integration triggered only when signup success is logged.
- **Auth:** All credentials tokenized/encrypted; never stored in plaintext.
- **Audit Trail:** Every tool call is logged (inputs, outputs, timestamps, confirmations).

## Evals
We measure our product's performance continuously:
- **Coverage Score:** (# providers fully automated ÷ # providers targeted).
- **Win Rate:** (# successful competitive signups ÷ total attempts).
- **Reuse Rate:** (% of signups completed using stored credentials).
- **Billing Alignment:** % of successful signups correctly billed once and only once.

## Roadmap
- [ ] Stabilize Blackhawk (SkiClubPro) signup.
- [ ] Add DaySmart integration as MCP tools.
- [ ] Build out eval dashboards.
- [ ] Expand to more providers.