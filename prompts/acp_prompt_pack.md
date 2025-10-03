# ACP Prompt Pack for SignupAssist

This document contains all Agentic Commerce Protocol (ACP) integration prompts for future development. These prompts align SignupAssist MCP with OpenAI's ACP standards for AI-driven commerce.

---

## ACP-P1: DB Feed + Session Schema

**Purpose:** Add database tables for structured program feeds and agentic checkout sessions.

**Files to Update:**
- New migration via `supabase--migration` tool

**Implementation:**

```sql
-- Create program_feeds table for structured ACP feeds
CREATE TABLE IF NOT EXISTS program_feeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  org_ref text NOT NULL,
  feed_url text NOT NULL,
  last_fetched_at timestamp with time zone,
  feed_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(provider, org_ref)
);

-- Enable RLS
ALTER TABLE program_feeds ENABLE ROW LEVEL SECURITY;

-- Public read access for feeds
CREATE POLICY "Program feeds are viewable by everyone"
  ON program_feeds FOR SELECT
  USING (true);

-- Service role can manage feeds
CREATE POLICY "Service role has full access to program_feeds"
  ON program_feeds FOR ALL
  USING (true);

-- Create agentic_checkout_sessions table
CREATE TABLE IF NOT EXISTS agentic_checkout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plan_id uuid REFERENCES plans(id),
  session_state text NOT NULL DEFAULT 'initiated',
  intent jsonb NOT NULL,
  context jsonb,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE agentic_checkout_sessions ENABLE ROW LEVEL SECURITY;

-- Users can manage their own sessions
CREATE POLICY "Users can manage their own checkout sessions"
  ON agentic_checkout_sessions FOR ALL
  USING (auth.uid() = user_id);

-- Add indexes
CREATE INDEX idx_program_feeds_provider_org ON program_feeds(provider, org_ref);
CREATE INDEX idx_program_feeds_updated ON program_feeds(updated_at);
CREATE INDEX idx_checkout_sessions_user ON agentic_checkout_sessions(user_id);
CREATE INDEX idx_checkout_sessions_expires ON agentic_checkout_sessions(expires_at);

-- Trigger for updated_at
CREATE TRIGGER update_program_feeds_updated_at
  BEFORE UPDATE ON program_feeds
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_checkout_sessions_updated_at
  BEFORE UPDATE ON agentic_checkout_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

---

## ACP-P2: Feed Ingest Function

**Purpose:** Create edge function to fetch and store structured program feeds from providers.

**Files to Update:**
- `supabase/functions/ingest-program-feed/index.ts` (new)

**Implementation:**

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { provider, org_ref, feed_url } = await req.json();

    if (!provider || !org_ref || !feed_url) {
      throw new Error('Missing required fields: provider, org_ref, feed_url');
    }

    console.log(`Ingesting feed for ${provider}/${org_ref} from ${feed_url}`);

    // Fetch the feed
    const feedResponse = await fetch(feed_url);
    if (!feedResponse.ok) {
      throw new Error(`Failed to fetch feed: ${feedResponse.statusText}`);
    }

    const feed_data = await feedResponse.json();

    // Store in database
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data, error } = await supabase
      .from('program_feeds')
      .upsert({
        provider,
        org_ref,
        feed_url,
        feed_data,
        last_fetched_at: new Date().toISOString()
      }, {
        onConflict: 'provider,org_ref'
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`Feed ingested successfully: ${data.id}`);

    return new Response(
      JSON.stringify({ success: true, feed_id: data.id, programs: feed_data.programs?.length ?? 0 }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error ingesting feed:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

---

## ACP-P3: Feed-First Program Listing

**Purpose:** Update ProgramBrowser to prioritize feed data over scraping.

**Files to Update:**
- `src/components/ProgramBrowser.tsx`

**Implementation:**

```typescript
// Add to ProgramBrowser component
const loadProgramsFromFeed = async () => {
  try {
    const { data: feedData, error } = await supabase
      .from('program_feeds')
      .select('feed_data')
      .eq('provider', 'skiclubpro')
      .eq('org_ref', orgRef)
      .single();

    if (error) throw error;

    if (feedData?.feed_data?.programs) {
      setPrograms(feedData.feed_data.programs);
      setSourceMethod('feed');
      toast({ title: 'Programs loaded', description: 'Using structured feed data' });
      return;
    }
  } catch (e) {
    console.log('No feed available, falling back to discovery');
  }

  // Fallback to existing discovery method
  await discoverPrograms();
};
```

---

## ACP-P4: UI Badges

**Purpose:** Add visual indicators showing data source (feed vs. scraped).

**Files to Update:**
- `src/components/ProgramBrowser.tsx`

**Implementation:**

```tsx
import { Badge } from '@/components/ui/badge';
import { Database, Globe } from 'lucide-react';

// In program list rendering
<div className="flex items-center gap-2">
  <h3>{program.title}</h3>
  {sourceMethod === 'feed' ? (
    <Badge variant="secondary" className="gap-1">
      <Database className="h-3 w-3" />
      Structured
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1">
      <Globe className="h-3 w-3" />
      Discovered
    </Badge>
  )}
</div>
```

---

## ACP-P5: Discover Fields Uses Feed Hints

**Purpose:** Use feed metadata to improve field discovery accuracy.

**Files to Update:**
- `src/lib/fieldMapping.ts`
- Field discovery edge functions

**Implementation:**

```typescript
// In field discovery logic
export async function discoverFieldsWithHints(
  programRef: string,
  feedHints?: any
) {
  const discoveredFields = await discoverFields(programRef);

  // Merge with feed hints if available
  if (feedHints?.fields) {
    return discoveredFields.map(field => {
      const hint = feedHints.fields.find((h: any) => h.name === field.name);
      if (hint) {
        return {
          ...field,
          type: hint.type || field.type,
          required: hint.required ?? field.required,
          validation: hint.validation || field.validation,
          source: 'feed-enhanced'
        };
      }
      return field;
    });
  }

  return discoveredFields;
}
```

---

## ACP-P6: Mandate v2 with Caps

**Purpose:** Enhance mandate system with embedded caps and expiry semantics aligned with ACP.

**Files to Update:**
- `mcp_server/lib/mandates.ts`
- Database schema (if needed)

**Implementation:**

```typescript
// Enhanced mandate payload
export interface MandatePayloadV2 extends MandatePayload {
  caps: {
    max_provider_charge_cents: number;
    service_fee_cents: number;
    max_total_cents?: number;
  };
  execution_window?: {
    earliest_at: string;
    latest_at: string;
  };
  notification_prefs?: {
    channels: string[];
    offsets_sec: number[];
  };
}

// Verification includes cap checking
export async function verifyMandateV2(
  jws: string,
  context: {
    amount_cents?: number;
    execution_time?: Date;
  }
): Promise<VerifiedMandate> {
  const mandate = await verifyMandate(jws, 'scp:write:register', context);

  // Additional ACP-compliant checks
  const payload = mandate as MandatePayloadV2;

  if (context.amount_cents && payload.caps) {
    const maxTotal = payload.caps.max_total_cents ?? 
      (payload.caps.max_provider_charge_cents + payload.caps.service_fee_cents);
    
    if (context.amount_cents > maxTotal) {
      throw new Error(`Amount ${context.amount_cents} exceeds total cap ${maxTotal}`);
    }
  }

  if (context.execution_time && payload.execution_window) {
    const execTime = context.execution_time.getTime();
    const earliest = new Date(payload.execution_window.earliest_at).getTime();
    const latest = new Date(payload.execution_window.latest_at).getTime();

    if (execTime < earliest || execTime > latest) {
      throw new Error('Execution time outside mandate window');
    }
  }

  return mandate;
}
```

---

## ACP-P7: Delegated Payment Token Placeholder

**Purpose:** Prepare infrastructure for Stripe payment tokens and delegated payment posture.

**Files to Update:**
- `supabase/functions/create-delegated-payment-token/index.ts` (new)
- Database schema for payment tokens

**Implementation:**

```typescript
// Placeholder for future Stripe delegated payment integration
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DelegatedPaymentTokenRequest {
  mandate_id: string;
  max_amount_cents: number;
  description: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: DelegatedPaymentTokenRequest = await req.json();

    // TODO: Implement Stripe payment token creation
    // For now, return a placeholder structure
    const token = {
      token_id: `dpt_${crypto.randomUUID()}`,
      mandate_id: body.mandate_id,
      max_amount_cents: body.max_amount_cents,
      status: 'pending',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      created_at: new Date().toISOString()
    };

    console.log('Delegated payment token created (placeholder):', token.token_id);

    return new Response(
      JSON.stringify({ success: true, token }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error creating payment token:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

---

## ACP-P8: Agentic Checkout Façade

**Purpose:** Create API endpoint for ChatGPT and other AI agents to initiate checkout sessions.

**Files to Update:**
- `supabase/functions/agentic-checkout/index.ts` (new)

**Implementation:**

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CheckoutIntent {
  program_ref: string;
  child_name: string;
  preferred_slot?: string;
  user_intent: string; // Natural language intent from AI agent
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('No authorization header');

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) throw new Error('Unauthorized');

    const intent: CheckoutIntent = await req.json();

    // Create agentic checkout session
    const { data: session, error: sessionError } = await supabase
      .from('agentic_checkout_sessions')
      .insert({
        user_id: user.id,
        session_state: 'initiated',
        intent,
        context: {
          source: 'ai_agent',
          timestamp: new Date().toISOString()
        },
        expires_at: new Date(Date.now() + 3600000).toISOString() // 1 hour
      })
      .select()
      .single();

    if (sessionError) throw sessionError;

    console.log(`Agentic checkout session created: ${session.id}`);

    return new Response(
      JSON.stringify({
        session_id: session.id,
        next_action: 'confirm_details',
        message: 'Review program details and confirm to proceed with registration.'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in agentic checkout:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

---

## ACP-P9: Countdown + ICS

**Purpose:** Generate ICS calendar files and countdown notifications for registration opening times.

**Files to Update:**
- `supabase/functions/generate-ics/index.ts` (new)
- Notification system

**Implementation:**

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function generateICS(planDetails: any): string {
  const { program_title, opens_at, org_ref } = planDetails;
  const dtstart = new Date(opens_at).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const dtend = new Date(new Date(opens_at).getTime() + 900000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//SignupAssist//NONSGML v1.0//EN
BEGIN:VEVENT
UID:${crypto.randomUUID()}@signupassist.com
DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z
DTSTART:${dtstart}
DTEND:${dtend}
SUMMARY:${program_title} Registration Opens
DESCRIPTION:SignupAssist will automatically register at this time.
LOCATION:${org_ref}
STATUS:CONFIRMED
BEGIN:VALARM
TRIGGER:-PT24H
ACTION:DISPLAY
DESCRIPTION:Registration opens in 24 hours
END:VALARM
BEGIN:VALARM
TRIGGER:-PT1H
ACTION:DISPLAY
DESCRIPTION:Registration opens in 1 hour
END:VALARM
END:VEVENT
END:VCALENDAR`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { plan_id } = await req.json();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: plan, error } = await supabase
      .from('plans')
      .select('*, mandates(*)')
      .eq('id', plan_id)
      .single();

    if (error || !plan) throw new Error('Plan not found');

    const icsContent = generateICS({
      program_title: plan.program_ref,
      opens_at: plan.opens_at,
      org_ref: plan.provider
    });

    return new Response(icsContent, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/calendar',
        'Content-Disposition': `attachment; filename="registration-${plan_id}.ics"`
      }
    });

  } catch (error) {
    console.error('Error generating ICS:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

---

## ACP-P10: Audit Source Evidence

**Purpose:** Tag audit events with data source (feed vs. scraped) for transparency.

**Files to Update:**
- `mcp_server/middleware/audit.ts`
- `supabase/functions/_shared/auditLogin.ts`

**Implementation:**

```typescript
// Add to audit event structure
export interface AuditEventWithSource extends AuditEvent {
  details: {
    data_source?: 'feed' | 'scraped' | 'manual';
    feed_version?: string;
    confidence_score?: number;
    [key: string]: any;
  };
}

// In audit logging
export async function logAuditEvent(event: AuditEventWithSource) {
  const { data, error } = await supabase
    .from('audit_events')
    .insert({
      ...event,
      details: {
        ...event.details,
        data_source: event.details.data_source || 'scraped',
        audit_version: 'v2-acp'
      }
    });

  if (error) {
    console.error('Failed to log audit event:', error);
  }

  return { data, error };
}
```

---

## ACP-P11: Credential Evolution

**Purpose:** Document credential versioning and migration path for future authentication methods.

**Files to Update:**
- `docs/CREDENTIAL_EVOLUTION.md` (new)

**Implementation:**

```markdown
# Credential Evolution

## Current State (v1)
- Encrypted username/password stored in `stored_credentials`
- Sealed with `CRED_SEAL_KEY`
- One credential per provider per user

## ACP-Aligned Future (v2)
- Support OAuth tokens and session tokens
- Version field in credential schema
- Migration path from v1 to v2:
  1. Add `version` and `token_type` columns
  2. Create migration function to mark existing as v1
  3. New credentials use appropriate token_type
  4. Backward compatibility maintained

## Credential Types
- `password`: Current encrypted credentials
- `oauth_token`: OAuth 2.0 access tokens
- `session_token`: Provider session tokens
- `api_key`: Provider API keys

## Migration Strategy
- No forced migration; existing credentials continue working
- New integrations prefer OAuth when available
- Gradual migration prompted in UI
```

---

## ACP-P12: UI Copy Updates

**Purpose:** Update all user-facing text to align with ACP principles: transparency, delegation, control.

**Files to Update:**
- `src/components/MandateSummary.tsx`
- `src/components/ConsentModal.tsx`
- Other UI components with authorization copy

**Implementation:**

```tsx
// Updated copy examples
const ACP_ALIGNED_COPY = {
  mandate_lead: "One-time authorization that covers login, registration, and payment for this plan.",
  
  consent_actions: "I authorize SignupAssist to log in, fill forms, and submit my registration for this plan.",
  
  consent_fees: "I authorize payment up to the cap above and a success fee only if registration succeeds.",
  
  reminders_description: "We'll remind you before registration opens and update you after we try.",
  
  transparency_note: "You can view the exact authorization details in the mandate JSON below.",
  
  data_source_badge: {
    feed: "This program uses structured data for faster, more accurate registration.",
    scraped: "This program data was discovered from the provider's website."
  },
  
  delegation_summary: "SignupAssist will handle registration automatically at the right time, respecting your payment limits and preferences."
};

// Use in components
<CardDescription>
  {ACP_ALIGNED_COPY.mandate_lead}
</CardDescription>
```

---

## Implementation Order

For best results, implement prompts in this sequence:

1. **Infrastructure First**: ACP-P1, ACP-P2 (database + feed ingestion)
2. **Feed Integration**: ACP-P3, ACP-P4, ACP-P5 (use feeds in UI)
3. **Mandate Enhancement**: ACP-P6, ACP-P10 (better authorization + audit)
4. **User Experience**: ACP-P9, ACP-P12 (notifications + copy)
5. **Future Prep**: ACP-P7, ACP-P8, ACP-P11 (payment tokens + agentic checkout + credential evolution)

Each prompt can be used independently in Lovable. Test thoroughly after each implementation.
