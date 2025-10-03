-- Create audit_events table for provider login attempts
CREATE TABLE public.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL, -- 'provider_login', 'provider_logout', etc.
  provider TEXT NOT NULL, -- 'skiclubpro', 'campminder', etc.
  org_ref TEXT, -- 'blackhawk-ski-club', etc.
  tool_name TEXT, -- 'scp.find_programs', 'scp.check_prerequisites', etc.
  mandate_id UUID REFERENCES public.mandates(id) ON DELETE SET NULL,
  user_id UUID, -- NOT a foreign key to auth.users, just a reference
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  finished_at TIMESTAMP WITH TIME ZONE,
  result TEXT, -- 'success', 'failure'
  details JSONB, -- flexible storage for login_strategy, verification, errors, etc.
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- Users can view their own audit events
CREATE POLICY "Users can view their audit events"
  ON public.audit_events
  FOR SELECT
  USING (auth.uid() = user_id);

-- Service role has full access
CREATE POLICY "Service role has full access to audit_events"
  ON public.audit_events
  FOR ALL
  USING (true);