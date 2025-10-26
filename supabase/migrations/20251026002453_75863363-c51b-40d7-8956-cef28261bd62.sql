-- Phase 1: Create mandate_audit table for comprehensive audit trail

CREATE TABLE IF NOT EXISTS public.mandate_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  provider TEXT,
  org_ref TEXT,
  program_ref TEXT,
  credential_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_mandate_audit_user ON public.mandate_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_mandate_audit_action ON public.mandate_audit(action);
CREATE INDEX IF NOT EXISTS idx_mandate_audit_created ON public.mandate_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_mandate_audit_provider ON public.mandate_audit(provider);

-- Enable RLS
ALTER TABLE public.mandate_audit ENABLE ROW LEVEL SECURITY;

-- Users can view their own audit logs
CREATE POLICY "Users can view own audit logs"
  ON public.mandate_audit
  FOR SELECT
  USING (auth.uid() = user_id);

-- Service role can insert audit logs
CREATE POLICY "Service role can insert audit logs"
  ON public.mandate_audit
  FOR INSERT
  WITH CHECK (true);

-- Phase 2: Update agentic_checkout_sessions for session persistence
-- Table already exists, just add indexes and TTL mechanism

CREATE INDEX IF NOT EXISTS idx_agentic_checkout_sessions_user 
  ON public.agentic_checkout_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_agentic_checkout_sessions_updated 
  ON public.agentic_checkout_sessions(updated_at);

-- Add expires_at column if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'agentic_checkout_sessions' 
    AND column_name = 'expires_at'
  ) THEN
    ALTER TABLE public.agentic_checkout_sessions 
    ADD COLUMN expires_at TIMESTAMPTZ DEFAULT (now() + interval '24 hours');
  END IF;
END $$;

-- Function to cleanup expired sessions
CREATE OR REPLACE FUNCTION public.cleanup_expired_checkout_sessions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.agentic_checkout_sessions 
  WHERE expires_at < now();
END;
$$;