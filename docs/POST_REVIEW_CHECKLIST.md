# Post-Review Checklist: After OpenAI Approval

**Created:** January 17, 2026  
**Status:** WAITING FOR REVIEW APPROVAL  
**Last Updated:** January 17, 2026

---

## Overview

This document tracks all work items that must wait until after OpenAI approves the ChatGPT App Store submission. These items either:
- Touch the MCP server code
- Require database migrations
- Require edge function deployments
- Require environment variable changes
- Need to be merged to `main` branch

---

## Immediate Post-Approval (Day 1)

### 1. Merge Feature Branch
```bash
git checkout main
git pull origin main
git merge feature/business-infrastructure
git push origin main
# → Railway auto-deploys
```

### 2. Add Environment Variables to Railway

| Variable | Value | Service |
|----------|-------|---------|
| `SENTRY_DSN` | (from Sentry dashboard) | Web + Worker |
| `RESEND_API_KEY` | (from Resend dashboard) | Web |

### 3. Deploy Database Migrations
```bash
# Review what will be applied
supabase db diff

# Apply migrations
supabase db push
```

**Migrations to apply:**
- [ ] `email_preferences` table

### 4. Deploy Edge Functions
```bash
supabase functions deploy send-email
```

---

## Week 1 Post-Approval

### 5. Integrate Sentry into MCP Server

**Files to modify:**
- `mcp_server/index.ts` - Add Sentry initialization
- `package.json` - Add `@sentry/node` dependency

**Code to add:**
```typescript
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
  });
}
```

### 6. Hook Up Email Notifications

**Trigger points to add:**
- After `bookeo.confirm_booking` → send confirmation email
- After `scheduled_registrations` insert → send scheduled email
- Worker success → send success email
- Worker failure → send failure email

**Files to modify:**
- `mcp_server/worker/scheduledRegistrationWorker.ts`
- `mcp_server/providers/bookeo.ts`

### 7. Add Admin API Endpoints

**New endpoints:**
- `GET /admin/api/revenue` - Financial metrics
- `GET /admin/api/charges` - Charge listing
- `GET /admin/api/users` - User management
- `POST /admin/api/users/:id/disable` - Account actions

**File to modify:**
- `mcp_server/index.ts` (admin routes section)

---

## Week 2-4 Post-Approval (Scaling)

### 8. Redis Integration

**Purpose:** Distributed rate limiting + session cache

**New dependencies:**
```bash
npm install ioredis
```

**Environment variables:**
| Variable | Value | Service |
|----------|-------|---------|
| `REDIS_URL` | (from Upstash/Railway) | Web + Worker |

**Files to create:**
- `mcp_server/lib/redis.ts` - Redis client
- `mcp_server/lib/distributedRateLimit.ts` - Redis-backed rate limiter

**Files to modify:**
- `mcp_server/index.ts` - Replace in-memory rate limiting (lines 1584-1617)

### 9. Job Queue (BullMQ)

**Purpose:** Reliable job queuing for scheduled registrations

**New dependencies:**
```bash
npm install bullmq
```

**Files to create:**
- `mcp_server/lib/jobQueue.ts` - BullMQ setup

**Files to modify:**
- `mcp_server/worker/scheduledRegistrationWorker.ts` - Use queue instead of polling

### 10. SMS Notifications (Twilio)

**New dependencies:**
```bash
npm install twilio
```

**Environment variables:**
| Variable | Value | Service |
|----------|-------|---------|
| `TWILIO_ACCOUNT_SID` | (from Twilio) | Web |
| `TWILIO_AUTH_TOKEN` | (from Twilio) | Web |
| `TWILIO_PHONE_NUMBER` | (from Twilio) | Web |

**Files to create:**
- `supabase/functions/send-sms/index.ts`
- `src/pages/Settings.tsx` - SMS preferences UI

**Database migrations:**
- Add `sms_enabled` to `email_preferences` (rename to `notification_preferences`)

---

## Month 2+ Post-Approval (Enterprise)

### 11. Tax Compliance (Stripe Tax)

**Implementation:**
- Enable Stripe Tax in Stripe dashboard
- Update charge creation to include tax calculation
- Store tax amounts in `charges` table

**Database migrations:**
- Add `tax_amount_cents` to `charges`
- Add `tax_jurisdiction` to `charges`

### 12. SOC 2 Preparation

**Documents to create:**
- Security policies
- Access control matrix
- Incident response plan
- Vendor security assessments
- Employee security training materials

**Technical controls:**
- Implement session timeout
- Add MFA requirement for admin
- Audit log retention automation
- Data export/deletion automation

### 13. Provider Onboarding Portal

**New pages:**
- `src/pages/provider/ProviderSignup.tsx`
- `src/pages/provider/ProviderDashboard.tsx`
- `src/pages/provider/ProviderSettings.tsx`

**Database migrations:**
- `providers` table
- `provider_api_keys` table
- `provider_revenue_share` table

**API endpoints:**
- `POST /provider/register`
- `GET /provider/analytics`
- `POST /provider/api-keys`

### 14. Multi-Region Deployment

**Infrastructure:**
- Railway multi-region setup
- Supabase read replicas
- CDN for static assets

---

## Database Migrations Queue

| Migration | Tables Affected | Priority | Status |
|-----------|----------------|----------|--------|
| email_preferences | New table | P0 | Pending |
| notification_preferences rename | email_preferences | P1 | Pending |
| charges_tax_fields | charges | P2 | Pending |
| providers | New table | P3 | Pending |
| provider_api_keys | New table | P3 | Pending |

---

## Edge Functions to Deploy

| Function | Purpose | Priority | Status |
|----------|---------|----------|--------|
| send-email | Transactional emails | P0 | Written locally |
| send-sms | SMS notifications | P1 | Not started |
| user-data-export | GDPR compliance | P2 | Not started |
| user-data-delete | GDPR compliance | P2 | Not started |

---

## Environment Variables to Add

### Railway Web Service
| Variable | Purpose | Priority |
|----------|---------|----------|
| `SENTRY_DSN` | Error tracking | P0 |
| `RESEND_API_KEY` | Email sending | P0 |
| `REDIS_URL` | Rate limiting + cache | P1 |
| `TWILIO_ACCOUNT_SID` | SMS | P2 |
| `TWILIO_AUTH_TOKEN` | SMS | P2 |
| `TWILIO_PHONE_NUMBER` | SMS | P2 |

### Railway Worker Service
| Variable | Purpose | Priority |
|----------|---------|----------|
| `SENTRY_DSN` | Error tracking | P0 |
| `REDIS_URL` | Job queue | P1 |

### Supabase Edge Functions
| Variable | Purpose | Priority |
|----------|---------|----------|
| `RESEND_API_KEY` | Email sending | P0 |
| `TWILIO_ACCOUNT_SID` | SMS | P2 |
| `TWILIO_AUTH_TOKEN` | SMS | P2 |

---

## Estimated Timeline

```
Week 1:  Merge branch, deploy migrations, add Sentry, hook up emails
Week 2:  Admin API endpoints, SMS notifications
Week 3:  Redis integration for rate limiting
Week 4:  BullMQ job queue
Month 2: Tax compliance, SOC 2 prep
Month 3: Provider portal, multi-region
```

---

## Pre-Merge Checklist

Before merging feature branch to main:

- [ ] All tests pass locally
- [ ] No TypeScript errors
- [ ] Feature branch is up to date with main
- [ ] Railway deployment logs reviewed (last known good state)
- [ ] Supabase migrations tested locally
- [ ] Edge functions tested locally
- [ ] Environment variables documented

---

## Rollback Plan

If something breaks after merging:

1. **Immediate:** Revert to known-good commit
   ```bash
   git revert HEAD
   git push origin main
   ```

2. **Known-good commit:** `c3dee5f39fcc2af90c8c31c59ee8e1b9dc125a7f`
   (Per memory: baseline for SSE/OAuth before unauth discovery changes)

3. **Database rollback:** Keep migration rollback scripts ready

---

*This document should be updated as work progresses on the feature branch.*
