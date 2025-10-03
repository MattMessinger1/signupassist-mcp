# ACP Integration (Future Development)

This document captures how we plan to align SignupAssist MCP with OpenAI's **Agentic Commerce Protocol (ACP)** for AI-driven commerce.

## Why ACP?

ACP establishes standards for how AI agents can transact with e-commerce systems, focusing on:
- **Structured data feeds** for product/service discovery
- **Agentic checkout sessions** with clear state management
- **Delegated payments** with caps and expiry
- **Transparent authorization** with verifiable mandates
- **Source attribution** for all decisions and actions

For SignupAssist, adopting ACP principles means:
- ✅ **More accurate & faster program discovery** via structured feeds instead of scraping
- ✅ **Set-and-forget delegation** with one mandate covering login, registration, and payment
- ✅ **Secure credential reuse** across multiple plans with clear scopes
- ✅ **Notifications & reminders** for parents before and after registration attempts
- ✅ **Eventual ChatGPT integration**: "Shall I sign up Alice for ski lessons next Saturday?"

---

## How Our MCP Maps to ACP

| SignupAssist Concept | ACP Equivalent | Status |
|---------------------|----------------|--------|
| Program discovery via browser automation | Structured product feeds | 🔄 Future (ACP-P1, P2, P3) |
| Field discovery + form filling | Checkout session state machine | ✅ Current (can be enhanced) |
| Mandate with scopes | Delegated authorization token with caps | ✅ Current (enhanced in ACP-P6) |
| Credential storage | Reusable auth credentials | ✅ Current (evolution in ACP-P11) |
| Plan execution | Agentic checkout completion | ✅ Current |
| Audit trail | Source evidence & transparency | ✅ Current (enhanced in ACP-P10) |
| Stripe payment | Delegated payment with SPT | 🔄 Future (ACP-P7) |
| Email confirmations | Notifications + ICS calendar | 🔄 Future (ACP-P9) |

---

## ACP Lessons We've Applied

### 1. Feed-First Program Discovery
**Current:** We scrape program pages using Browserbase.  
**ACP-Aligned:** Providers publish structured feeds; we cache and index them. Scraping becomes a fallback.

**Benefits:**
- Faster loading (no browser session needed)
- More accurate data (structured vs. inferred)
- Lower cost (fewer Browserbase minutes)
- Better UX (instant search and filtering)

**Implementation:** See ACP-P1, P2, P3, P4, P5

---

### 2. Agentic Checkout Session Semantics
**Current:** We directly invoke MCP tools in a sequence.  
**ACP-Aligned:** Each plan has a checkout session with explicit state transitions.

**States:**
- `initiated` → user starts plan
- `details_confirmed` → prerequisites checked, fields gathered
- `authorization_granted` → mandate signed
- `scheduled` → worker queued
- `executing` → registration in progress
- `completed` / `failed` → final state

**Benefits:**
- Clear failure recovery points
- AI agents can query state and resume
- Better audit trail and debugging

**Implementation:** ACP-P1 (session table), ACP-P8 (agentic checkout façade)

---

### 3. Delegated Payments with Caps
**Current:** We store payment method; worker charges Stripe directly.  
**ACP-Aligned:** User issues a delegated payment token with explicit caps.

**Flow:**
1. User authorizes max amounts (provider charge + success fee)
2. SignupAssist receives a single-use payment token with those caps
3. Worker verifies amounts against caps before charging
4. Success fee only charged if registration succeeds

**Benefits:**
- User never loses control of payment
- Clear cap enforcement in code
- Aligns with Stripe Payment Tokens (SPT) model
- Transparent fee structure

**Implementation:** ACP-P6 (mandate v2 with caps), ACP-P7 (delegated payment token placeholder)

---

### 4. Single Mandate Per Plan
**Current:** ✅ Already implemented  
**Why It Matters:** Each plan gets one mandate containing all scopes and caps. No scope creep, no hidden authorizations.

**Scopes:**
- `scp:login` – Sign in to provider
- `scp:enroll` – Fill registration form
- `scp:write:register` – Submit and confirm
- `scp:pay` – Charge payment method (up to cap)
- `signupassist:fee` – Charge success fee (only on success)

**Implementation:** ✅ Current mandate system (see `mcp_server/lib/mandates.ts`, enhanced in ACP-P6)

---

### 5. Notifications and Reminders
**Current:** Basic email confirmation after execution.  
**ACP-Aligned:** Proactive notifications before registration opens + calendar invites.

**Flow:**
- User sets reminder preferences (email/SMS, 24h/1h/10m before)
- System sends countdown notifications
- Attach `.ics` file for calendar import
- Send post-execution status update

**Benefits:**
- Reduces anxiety ("Did it work?")
- Builds trust through transparency
- Calendar integration helps parents plan

**Implementation:** ✅ Reminders data model in place (M5), ACP-P9 for ICS generation

---

## Our Future Path

### Phase 1: Feed Infrastructure (ACP-P1, P2, P3)
**Goal:** Move from scraping to structured feeds as primary data source.

**Steps:**
1. ✅ Add `program_feeds` table (ACP-P1)
2. Create feed ingestion function (ACP-P2)
3. Update ProgramBrowser to prefer feed data (ACP-P3)
4. Add UI badges showing data source (ACP-P4)
5. Use feed hints in field discovery (ACP-P5)

**Outcome:** Faster, more accurate program discovery with lower cost.

---

### Phase 2: Enhanced Mandates & Audit (ACP-P6, P10)
**Goal:** Make mandates ACP-compliant with caps, windows, and source evidence.

**Steps:**
1. ✅ Embed caps in mandate details (done in M4)
2. Add execution window validation (ACP-P6)
3. Tag all audit events with data source (ACP-P10)
4. ✅ Add mandate JSON viewer in UI (done in M5)

**Outcome:** Transparent, auditable authorization with clear constraints.

---

### Phase 3: Countdown & Notifications (ACP-P9, P12)
**Goal:** Keep parents informed and confident.

**Steps:**
1. ✅ Capture reminder preferences (done in M5)
2. Generate `.ics` calendar files (ACP-P9)
3. Send countdown notifications via email/SMS
4. Update all UI copy to reflect ACP principles (ACP-P12)

**Outcome:** Set-and-forget experience with proactive communication.

---

### Phase 4: Delegated Payment Posture (ACP-P7)
**Goal:** Integrate Stripe Payment Tokens or similar for cap-enforced payments.

**Steps:**
1. Create placeholder delegated payment token function (ACP-P7)
2. Research Stripe SPT requirements
3. Implement token generation + verification in worker
4. Migrate existing payment flow to use tokens

**Outcome:** Payment authorization that users control, aligned with ACP standards.

---

### Phase 5: Agentic Checkout Façade (ACP-P8)
**Goal:** Enable ChatGPT and other AI agents to initiate registrations via API.

**Steps:**
1. Create `agentic_checkout_sessions` table (ACP-P1)
2. Build `/agentic-checkout` API endpoint (ACP-P8)
3. Expose as OpenAPI spec for ChatGPT actions
4. Handle natural language intents → structured plans

**Outcome:** "ChatGPT, sign up Alice for Saturday ski lessons" → SignupAssist handles the rest.

---

### Phase 6: Credential Evolution (ACP-P11)
**Goal:** Support OAuth tokens and session-based auth where providers offer it.

**Steps:**
1. Add `version` and `token_type` columns to `stored_credentials`
2. Document migration path (ACP-P11)
3. Implement OAuth flows for supported providers
4. Gradually migrate existing credentials

**Outcome:** More secure, provider-friendly authentication with clear versioning.

---

## Prompt Pack Index

All ACP prompts are ready to use in **[prompts/acp_prompt_pack.md](prompts/acp_prompt_pack.md)**. You can copy-paste any prompt directly into Lovable.

| Prompt | Purpose | Phase |
|--------|---------|-------|
| **ACP-P1** | DB feed + session schema | Phase 1 |
| **ACP-P2** | Feed ingest function | Phase 1 |
| **ACP-P3** | Feed-first program listing | Phase 1 |
| **ACP-P4** | UI badges for data source | Phase 1 |
| **ACP-P5** | Discover fields uses feed hints | Phase 1 |
| **ACP-P6** | Mandate v2 with caps | Phase 2 |
| **ACP-P7** | Delegated payment token placeholder | Phase 4 |
| **ACP-P8** | Agentic checkout façade | Phase 5 |
| **ACP-P9** | Countdown + ICS | Phase 3 |
| **ACP-P10** | Audit source evidence | Phase 2 |
| **ACP-P11** | Credential evolution | Phase 6 |
| **ACP-P12** | UI copy updates | Phase 3 |

---

## Current Status vs. ACP Goals

| ACP Principle | Current | ACP-Aligned Future |
|--------------|---------|-------------------|
| **Product discovery** | Browser automation | Structured feeds |
| **Authorization** | JWT mandate with scopes | ✅ + embedded caps & windows |
| **Payment** | Direct Stripe charge | Delegated payment token with caps |
| **Notifications** | Post-execution email | Countdown reminders + ICS + updates |
| **Transparency** | Audit logs | ✅ + source attribution + mandate JSON viewer |
| **AI agent access** | Manual web UI only | API for ChatGPT & other agents |
| **Credential types** | Encrypted password | ✅ + OAuth, session tokens |

✅ = Already implemented or in progress  
🔄 = Future enhancement

---

## How to Use This

1. **Review the prompt pack** ([prompts/acp_prompt_pack.md](prompts/acp_prompt_pack.md)) to understand each enhancement
2. **Pick a phase** based on your current priorities
3. **Copy a prompt** from the pack into Lovable
4. **Test thoroughly** before moving to the next prompt
5. **Update this README** as you implement each phase

---

## Why This Matters

By aligning with ACP, SignupAssist becomes:
- **More reliable:** Structured data beats scraping every time
- **More trustworthy:** Transparent authorization and clear caps
- **More scalable:** AI agents can use our platform programmatically
- **More parent-friendly:** Set-and-forget with proactive updates

This isn't just about following a protocol—it's about building the best possible experience for busy parents who trust us to handle their kids' activity registrations.

---

## Questions or Feedback?

This is a living document. As ACP evolves and we learn from implementation, we'll update these prompts and strategies.

For now, all prompts are **ready to use** but **not yet wired into production**. They're organized so you can implement piece by piece without breaking existing functionality.

**Let's make SignupAssist the reference implementation for ACP-compliant activity registration automation.** 🚀
